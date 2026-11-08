import type { Context } from "../../max/compat.js";
import { config } from "../../config.js";
import { getTtsMode } from "../../app/stores/settings-store.js";
import {
  isSttConfigured,
  transcribeAudio,
  type SttResult,
} from "../../app/services/stt-service.js";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";
import { createIncomingPrompt, type IncomingPrompt } from "../../app/types/prompt.js";
import { flushPendingPrompt } from "./message-merger.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { buildQuotedNotification } from "../../app/services/quoted-notification.js";
import { editBotText } from "../messages/max-text.js";
import { takeArrivalTicket, tryEnqueuePromptIfBusy } from "./prompt-queue-dispatch.js";

const DOWNLOAD_TIMEOUT_MS = 30_000;

export interface VoiceMessageDeps extends ProcessPromptDeps {
  isSttConfigured?: () => boolean;
  downloadMAXFile?: (
    ctx: Context,
    fileId: string,
  ) => Promise<{ buffer: Buffer; filename: string } | null>;
  transcribeAudio?: (audioBuffer: Buffer, filename: string) => Promise<SttResult>;
  processPrompt?: (
    ctx: Context,
    input: IncomingPrompt,
    deps: ProcessPromptDeps,
    options?: { responseMode?: "text_only" | "text_and_tts" },
  ) => Promise<boolean>;
}

/**
 * Downloads the audio file from MAX servers.
 *
 * @returns Buffer with file content, or null on failure
 */
async function downloadMAXFile(
  ctx: Context,
  fileId: string,
): Promise<{ buffer: Buffer; filename: string } | null> {
  try {
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) {
      logger.error("[Voice] MAX getFile returned no URL");
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(file.file_path, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      logger.error(`[Voice] Download failed with HTTP ${response.status}`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    let filename = new URL(file.file_path).pathname.split("/").pop() || "audio.ogg";
    if (filename.endsWith(".oga")) {
      filename = filename.slice(0, -4) + ".ogg";
    }

    logger.debug(`[Voice] Downloaded file: ${filename} (${buffer.length} bytes)`);
    return { buffer, filename };
  } catch (err) {
    logger.error("[Voice] Error downloading file from MAX:", err);
    return null;
  }
}

/**
 * Creates the voice message handler function.
 *
 * The factory pattern is used so that `bot` and `ensureEventSubscription` dependencies
 * can be injected from createBot() without circular imports.
 */
export function createVoiceHandler(deps: VoiceMessageDeps) {
  return async (ctx: Context): Promise<void> => {
    await handleVoiceMessage(ctx, deps);
  };
}

/**
 * Handles incoming voice and audio messages:
 * 1. Checks if STT is configured
 * 2. Downloads the audio file from MAX
 * 3. Sends "recognizing..." status message
 * 4. Calls STT API
 * 5. Shows recognized text
 * 6. Passes text to processUserPrompt
 */
export async function handleVoiceMessage(ctx: Context, deps: VoiceMessageDeps): Promise<void> {
  const sttConfigured = deps.isSttConfigured ?? isSttConfigured;
  const downloadFile = deps.downloadMAXFile ?? downloadMAXFile;
  const transcribe = deps.transcribeAudio ?? transcribeAudio;
  const processPrompt = deps.processPrompt ?? processUserPrompt;

  // Determine file_id from voice or audio message
  const voice = ctx.message?.voice;
  const audio = ctx.message?.audio;
  const fileId = voice?.file_id ?? audio?.file_id;

  if (!fileId) {
    logger.warn("[Voice] Received voice/audio message with no file_id");
    return;
  }

  flushPendingPrompt(ctx.chat!.id);
  const ticket = takeArrivalTicket();

  // Check if STT is configured
  if (!sttConfigured()) {
    await ctx.reply(t("stt.not_configured"));
    return;
  }

  // Send "recognizing..." status message (will be edited later)
  const statusMessage = await ctx.reply(t("stt.recognizing"));

  try {
    // Download the audio file from MAX
    const fileData = await downloadFile(ctx, fileId);
    if (!fileData) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMessage.message_id,
        t("stt.error", { error: "download failed" }),
      );
      return;
    }

    // Transcribe the audio
    const result = await transcribe(fileData.buffer, fileData.filename);

    const recognizedText = result.text.trim();
    if (!recognizedText) {
      await ctx.api.editMessageText(ctx.chat!.id, statusMessage.message_id, t("stt.empty_result"));
      return;
    }

    // Show the recognized text by editing the status message.
    // IMPORTANT: even if this edit fails (e.g. MAX message length limits),
    // we still send the recognized text to OpenCode as a prompt.
    try {
      const notification = buildQuotedNotification(t("stt.recognized"), recognizedText, {
        blankLineAfterTitle: false,
      });
      await editBotText({
        api: ctx.api,
        chatId: ctx.chat!.id,
        messageId: statusMessage.message_id,
        text: notification.text,
        rawFallbackText: notification.rawFallbackText,
        format: "markdown_v2",
      });
    } catch (editError) {
      logger.warn("[Voice] Failed to edit status message with recognized text:", editError);
    }

    logger.info(`[Voice] Transcribed audio: ${recognizedText.length} chars`);

    let textForLLM = recognizedText;
    const notePrompt = config.stt.notePrompt.trim();

    if (notePrompt && notePrompt.toLowerCase() !== "false" && notePrompt !== "0") {
      const llmNote = `[Note: ${notePrompt}]`;
      logger.debug(`[Voice] Added STT note to LLM prompt: ${llmNote}`);
      textForLLM = `${llmNote}\n${recognizedText}`;
    }

    // Process the recognized text as a prompt
    const currentTtsMode = getTtsMode();
    const responseMode =
      currentTtsMode === "all" || currentTtsMode === "auto" ? "text_and_tts" : "text_only";
    if (
      await tryEnqueuePromptIfBusy(
        ctx,
        {
          ...createIncomingPrompt(textForLLM),
          displayText: recognizedText,
          responseMode,
        },
        ticket,
      )
    ) {
      return;
    }
    await processPrompt(ctx, createIncomingPrompt(textForLLM), deps, { responseMode });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "unknown error";
    logger.error("[Voice] Error processing voice message:", err);

    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMessage.message_id,
        t("stt.error", { error: errorMessage }),
      );
    } catch {
      // If we can't edit the status message, try sending a new one
      await ctx.reply(t("stt.error", { error: errorMessage })).catch(() => {});
    }
  }
}
