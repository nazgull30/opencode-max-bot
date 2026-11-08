import fs from "node:fs/promises";
import { createBot, restoreFollowedSessionOnPollingStart } from "../../bot/index.js";
import { createScheduledTaskDeliverySender } from "../../bot/messages/scheduled-task-delivery.js";
import { config } from "../../config.js";
import {
  notifyOpencodeReadyIfHealthy,
  registerOpenCodeReadyRefreshHandler,
} from "../../opencode/ready-refresh.js";
import { flushSettings, loadSettings } from "../stores/settings-store.js";
import { LocalCommandRegistry } from "../services/local-command-registry.js";
import { BUILT_IN_COMMAND_NAMES } from "../../bot/commands/definitions.js";
import {
  reconcileStoredModelSelection,
  startModelCatalogWarmup,
} from "../services/model-selection-service.js";
import { getBotVersion } from "../../runtime/bot-version.js";
import { getRuntimeMode } from "../../runtime/mode.js";
import { getRuntimePaths } from "../../runtime/paths.js";
import { clearServiceStateFile } from "../../runtime/service/manager.js";
import { getServiceStateFilePathFromEnv, isServiceChildProcess } from "../../runtime/service/env.js";
import { flushLogger, getLogFilePath, initializeLogger, logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { createAppContainer } from "./app-container.js";

const SHUTDOWN_TIMEOUT_MS = 5000;
const SETTINGS_FLUSH_TIMEOUT_MS = 1000;
const LOG_FLUSH_TIMEOUT_MS = 1000;
const MAX_STARTUP_RETRY_BASE_MS = 1000;
const MAX_STARTUP_RETRY_CAP_MS = 60_000;
const MAX_FATAL_TOKEN_CODES = new Set([401, 403, 404]);

function getErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  for (const field of ["status", "error_code"] as const) {
    const value = Reflect.get(error, field);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function isFatalMaxTokenError(error: unknown): boolean {
  const status = getErrorStatus(error);
  return status !== null && MAX_FATAL_TOKEN_CODES.has(status);
}

function isRetryableMaxStartupError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status !== null) {
    return status === 429 || (status >= 500 && status < 600);
  }

  if (error instanceof TypeError) {
    return true;
  }

  if (error instanceof Error && /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(error.message)) {
    return true;
  }

  return false;
}

function nextMaxStartupRetryDelayMs(attempt: number): number {
  return Math.min(
    MAX_STARTUP_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1),
    MAX_STARTUP_RETRY_CAP_MS,
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function startBotApp(): Promise<void> {
  await initializeLogger();

  const mode = getRuntimeMode();
  const runtimePaths = getRuntimePaths();
  const version = await getBotVersion();
  const logFilePath = getLogFilePath();

  logger.info(`Starting OpenCode MAX Bot v${version}...`);
  logger.info(`Node.js ${process.version} on ${process.platform} ${process.arch}`);
  logger.info(`Config loaded from ${runtimePaths.envFilePath}`);
  if (logFilePath) {
    logger.info(`Logs are written to ${logFilePath}`);
  }
  logger.info(`Allowed User ID: ${config.max.allowedUserId}`);
  logger.debug(`[Runtime] Application start mode: ${mode}`);

  let serviceStateCleared = false;

  const clearManagedServiceState = async (): Promise<void> => {
    if (!isServiceChildProcess() || serviceStateCleared) {
      return;
    }

    const stateFilePath = getServiceStateFilePathFromEnv();
    if (!stateFilePath) {
      return;
    }

    try {
      await fs.access(stateFilePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        serviceStateCleared = true;
        return;
      }

      throw error;
    }

    await clearServiceStateFile(stateFilePath);
    serviceStateCleared = true;
  };

  // Bounded so a stalled write cannot cancel an emergency exit.
  const flushSettingsWithTimeout = (): Promise<void> =>
    Promise.race([
      flushSettings(),
      new Promise<void>((resolve) => setTimeout(resolve, SETTINGS_FLUSH_TIMEOUT_MS)),
    ]);

  // Same bound for the file log, so the records written right before the exit
  // (the crash report or the forcing-exit warning itself) reach the file.
  const flushLoggerWithTimeout = (): Promise<void> =>
    Promise.race([
      flushLogger(),
      new Promise<void>((resolve) => setTimeout(resolve, LOG_FLUSH_TIMEOUT_MS)),
    ]);

  // Keep the process alive: a single unhandled rejection must not take the bot
  // down while the user is away and there is no supervisor to restart it.
  const unhandledRejectionHandler = (reason: unknown): void => {
    logger.error("[App] Unhandled promise rejection", reason);
  };

  const uncaughtExceptionHandler = (error: Error): void => {
    logger.error("[App] Uncaught exception", error);
    void clearManagedServiceState()
      .catch(() => {})
      .then(() => flushSettingsWithTimeout())
      .then(() => flushLoggerWithTimeout())
      .finally(() => process.exit(1));
  };

  process.on("unhandledRejection", unhandledRejectionHandler);
  process.on("uncaughtException", uncaughtExceptionHandler);

  await loadSettings();
  // The server may have been started together with the bot and still be registering providers.
  startModelCatalogWarmup();
  await reconcileStoredModelSelection();
  const container = createAppContainer();
  registerOpenCodeReadyRefreshHandler(container);
  const { healthServer, opencodeAutoRestartService, scheduledTaskRuntime } = container;
  await healthServer.start(config.health.port, version);
  const localCommandRegistry = await LocalCommandRegistry.load({
    directoryPath: runtimePaths.localCommandsDirPath,
    builtInCommands: BUILT_IN_COMMAND_NAMES,
  });
  const bot = createBot(container, localCommandRegistry);
  await scheduledTaskRuntime.initialize(
    bot,
    createScheduledTaskDeliverySender(bot.api, config.max.allowedUserId),
  );
  safeBackgroundTask({
    taskName: "app.opencodeStartup",
    task: async () => {
      await opencodeAutoRestartService.start();
      await notifyOpencodeReadyIfHealthy("startup", container);
    },
  });

  let shutdownStarted = false;
  let shutdownTimeout: ReturnType<typeof setTimeout> | null = null;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    logger.info(`[App] Received ${signal}, shutting down...`);
    container.cleanupProcess(`app_shutdown_${signal.toLowerCase()}`);
    opencodeAutoRestartService.stop();
    scheduledTaskRuntime.shutdown();
    void healthServer.stop();

    shutdownTimeout = setTimeout(() => {
      logger.warn(`[App] Shutdown did not finish in ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit.`);
      void flushSettingsWithTimeout()
        .then(() => flushLoggerWithTimeout())
        .finally(() => process.exit(0));
    }, SHUTDOWN_TIMEOUT_MS);
    shutdownTimeout.unref?.();

    try {
      bot.stop();
    } catch (error) {
      logger.warn("[App] Failed to stop MAX bot cleanly", error);
    }

    void clearManagedServiceState().catch((error) => {
      logger.warn("[App] Failed to clear managed service state", error);
    });
  };

  const handleSigint = (): void => shutdown("SIGINT");
  const handleSigterm = (): void => shutdown("SIGTERM");
  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);

  const isShutdown = (): boolean => shutdownStarted;
  let startupAttempt = 0;

  try {
    while (true) {
    if (isShutdown()) {
      return;
    }

    try {
      await bot.start({
        drop_pending_updates: true,
        onStart: (botInfo) => {
          logger.info(`Bot @${botInfo.username ?? botInfo.id} started!`);
          restoreFollowedSessionOnPollingStart(bot, container);
        },
      });
      break;
    } catch (error) {
      if (isShutdown()) {
        return;
      }

      if (isFatalMaxTokenError(error)) {
        logger.error("[App] MAX rejected the bot token; not retrying", error);
        throw error;
      }

      if (!isRetryableMaxStartupError(error)) {
        logger.error("[App] MAX startup failed; not retrying", error);
        throw error;
      }

      startupAttempt += 1;
      const delayMs = nextMaxStartupRetryDelayMs(startupAttempt);
      logger.warn(
        `[App] MAX startup failed (attempt ${startupAttempt}); retrying in ${delayMs}ms`,
        error,
      );
      await wait(delayMs);
    }
  }

  } finally {
    process.off("unhandledRejection", unhandledRejectionHandler);
    process.off("uncaughtException", uncaughtExceptionHandler);
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
    if (shutdownTimeout) {
      clearTimeout(shutdownTimeout);
      shutdownTimeout = null;
    }
    container.cleanupProcess("app_shutdown_complete");
    opencodeAutoRestartService.stop();
    scheduledTaskRuntime.shutdown();
    await healthServer.stop();
    await clearManagedServiceState().catch((error) => {
      logger.warn("[App] Failed to clear managed service state", error);
    });
    await flushSettings();
  }
}
