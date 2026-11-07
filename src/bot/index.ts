import { Bot, Context } from "../max/compat.js";
import { config } from "../config.js";
import { getCurrentProject } from "../app/stores/settings-store.js";
import type { AppContainer } from "../app/bootstrap/app-container.js";
import {
  configureAttachPresentation,
  restoreAttachedCurrentSession,
} from "../app/services/attach-service.js";
import { refreshModelViewsAfterLateCatalogSettle } from "./services/model-views.js";
import { logger } from "../utils/logger.js";
import { safeBackgroundTask } from "../utils/safe-background-task.js";
import { LocalCommandRegistry } from "../app/services/local-command-registry.js";
import { registerCallbackRouter } from "./callbacks/callback-router.js";
import {
  dispatchNextQueuedPrompt,
  initializePromptQueueDispatch,
} from "./handlers/prompt-queue-dispatch.js";
import { initializePromptHandover } from "./handlers/prompt-handover.js";
import { normalizeRichMessage } from "./handlers/rich-message-handler.js";
import { authMiddleware } from "./middleware/auth.js";
import { interactionGuardMiddleware } from "./middleware/interaction-guard.js";
import { staleUpdateMiddleware } from "./middleware/stale-update.js";
import {
  ensureCommandsInitialized,
  registerCommandRouter,
} from "./routers/command-router.js";
import { registerMessageRouter } from "./routers/message-router.js";
import { createAttachPresentation } from "./services/attach-presentation.js";
import { createMaxBotOptions } from "./max-client-options.js";

export function createBot(
  container: AppContainer,
  localCommandRegistry = LocalCommandRegistry.empty(),
): Bot<Context> {
  container.resetInteractions("bot_startup");
  container.attachManager.clear("bot_startup");
  container.resetRuntimeStreams("bot_startup");

  const bot = new Bot(config.max.token, createMaxBotOptions(config.max));
  bot.api.registerDialogId(config.max.allowedUserId);

  configureAttachPresentation(createAttachPresentation(container));

  container.setMAXContext(bot, config.max.allowedUserId);

  initializePromptQueueDispatch({ ...container, bot });
  initializePromptHandover({ ...container, bot }, dispatchNextQueuedPrompt);

  container.setReadyRestoreHandler(async (reason) => {
    const restored = await restoreAttachedCurrentSession({
      ...container,
      bot,
      chatId: config.max.allowedUserId,
      forceFullRestore: true,
    });
    refreshModelViewsAfterLateCatalogSettle(container, reason);

    if (restored) {
      logger.info(`[Bot] Restored followed session after OpenCode ready: reason=${reason}`);
      return;
    }

    const currentProject = getCurrentProject();
    if (config.bot.trackBackgroundSessions && currentProject?.worktree) {
      await container.ensureEventSubscription(currentProject.worktree);
      logger.info(
        `[Bot] Started background session tracking after OpenCode ready: reason=${reason}, directory=${currentProject.worktree}`,
      );
    }
  });

  container.startHeartbeat();

  bot.use((ctx, next) => {
    logger.debug(
      `[DEBUG] Incoming update: type=${ctx.update.update_type}, hasCallback=${!!ctx.callbackQuery}, hasMessage=${!!ctx.message}`,
    );
    return next();
  });

  bot.use(authMiddleware);
  bot.use(staleUpdateMiddleware);
  bot.on("message:rich_message", normalizeRichMessage);
  bot.use((ctx, next) => ensureCommandsInitialized(ctx, next, localCommandRegistry));
  const guardDeps = { ...container, localCommandRegistry };
  bot.use((ctx, next) => interactionGuardMiddleware(ctx, next, guardDeps));

  registerCommandRouter(bot, { container, localCommandRegistry });
  registerCallbackRouter(bot, { container });
  registerMessageRouter(bot, { container });

  bot.catch((err) => {
    logger.error("[Bot] Unhandled error in bot:", err);
    container.resetInteractions("bot_unhandled_error");
    if (err.ctx) {
      logger.error(
        "[Bot] Error context - update type:",
        err.ctx.update ? err.ctx.update.update_type : "unknown",
      );
    }
  });

  return bot;
}

export function restoreFollowedSessionOnPollingStart(
  bot: Bot<Context>,
  container: AppContainer,
): void {
  safeBackgroundTask({
    taskName: "bot.restoreAfterPollingStart",
    task: () =>
      restoreAttachedCurrentSession({
        ...container,
        bot,
        chatId: config.max.allowedUserId,
        forceFullRestore: true,
      }),
  });
}
