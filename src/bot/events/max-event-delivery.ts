import { InputFile, type Api } from "../../max/compat.js";
import type { CodeFileData } from "../../app/formatters/summary-formatter.js";
import { logger } from "../../utils/logger.js";
import {
  AGENT_TEXT_LINK_PREVIEW_OPTIONS,
  completeDraftPart,
  editRenderedBotPart,
  getMAXRenderedPartSignature,
  sendDraftBotPart,
  sendRenderedBotPart,
} from "../messages/max-text.js";
import type { MAXRenderedPart } from "../render/types.js";

type MAXApi = Api;
type SendMessageOptions = Parameters<MAXApi["sendMessage"]>[2];
type SendDocumentOptions = Parameters<MAXApi["sendDocument"]>[2];
type RenderedSendOptions = Parameters<typeof sendRenderedBotPart>[0]["options"];
type RenderedEditOptions = Parameters<typeof editRenderedBotPart>[0]["options"];
type DraftCompleteOptions = Parameters<typeof completeDraftPart>[0]["options"];

/** Where a session's messages go. */
export interface MaxDestination {
  api: MAXApi;
  chatId: number;
}

/**
 * Decides, per session, where its messages go and whether it is the session
 * the user follows. The two answers are independent on purpose.
 */
export interface SessionTargetPolicy {
  getDestination(sessionId: string): MaxDestination | null;
  isForegroundSession(sessionId: string): boolean;
}

function getLowerCaseErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
}

function isMessageNotModifiedError(error: unknown): boolean {
  return getLowerCaseErrorMessage(error).includes("message is not modified");
}

function isMessageToDeleteMissingError(error: unknown): boolean {
  const errorMessage = getLowerCaseErrorMessage(error);
  return (
    errorMessage.includes("message to delete not found") ||
    errorMessage.includes("message identifier is not specified") ||
    errorMessage.includes("message not found")
  );
}

/**
 * MAX primitives for the event bridge. Every call names its destination; only
 * "not modified" edits and already-missing deletes are tolerated, anything else
 * reaches the caller so the streamers can retry.
 */
export class MaxEventDelivery {
  private nextDraftId = 1;

  async sendText(
    destination: MaxDestination,
    text: string,
    options?: SendMessageOptions,
  ): Promise<string> {
    const sentMessage = options
      ? await destination.api.sendMessage(destination.chatId, text, options)
      : await destination.api.sendMessage(destination.chatId, text);
    return sentMessage.message_id;
  }

  async editText(destination: MaxDestination, messageId: string, text: string): Promise<void> {
    try {
      await destination.api.editMessageText(destination.chatId, messageId, text);
    } catch (error) {
      if (isMessageNotModifiedError(error)) {
        return;
      }

      throw error;
    }
  }

  async deleteText(destination: MaxDestination, messageId: string): Promise<void> {
    await destination.api.deleteMessage(destination.chatId, messageId).catch((error) => {
      if (isMessageToDeleteMissingError(error)) {
        return;
      }

      throw error;
    });
  }

  async sendDocument(
    destination: MaxDestination,
    fileData: CodeFileData,
    options?: SendDocumentOptions,
  ): Promise<void> {
    logger.debug(`[Bot] Sending code file: ${fileData.filename} (${fileData.buffer.length} bytes)`);

    await destination.api.sendDocument(
      destination.chatId,
      new InputFile(fileData.buffer, fileData.filename),
      {
        caption: fileData.caption,
        ...options,
      },
    );
  }

  sendRenderedPart(
    destination: MaxDestination,
    part: MAXRenderedPart,
    options?: RenderedSendOptions,
    allowPlainFallback?: boolean,
  ) {
    return sendRenderedBotPart({
      api: destination.api,
      chatId: destination.chatId,
      part,
      options: { ...options, ...AGENT_TEXT_LINK_PREVIEW_OPTIONS },
      ...(allowPlainFallback === undefined ? {} : { allowPlainFallback }),
    });
  }

  async editRenderedPart(
    destination: MaxDestination,
    messageId: string,
    part: MAXRenderedPart,
    options?: RenderedEditOptions,
  ) {
    try {
      return await editRenderedBotPart({
        api: destination.api,
        chatId: destination.chatId,
        messageId,
        part,
        options: { ...options, ...AGENT_TEXT_LINK_PREVIEW_OPTIONS },
        allowPlainFallback: false,
      });
    } catch (error) {
      if (isMessageNotModifiedError(error)) {
        return { deliveredSignature: getMAXRenderedPartSignature(part) };
      }

      throw error;
    }
  }

  /** MAX has no drafts; a draft is an ordinary message that is edited in place. */
  async sendDraftPart(destination: MaxDestination, part: MAXRenderedPart) {
    const draftId = this.nextDraftId;
    this.nextDraftId += 1;
    const result = await this.editDraftPart(destination, draftId, part);
    return { messageId: String(draftId), deliveredSignature: result.deliveredSignature };
  }

  editDraftPart(destination: MaxDestination, draftId: string | number, part: MAXRenderedPart) {
    return sendDraftBotPart({
      api: destination.api,
      chatId: destination.chatId,
      draftId,
      part,
    });
  }

  completeDraftPart(
    destination: MaxDestination,
    part: MAXRenderedPart,
    options?: DraftCompleteOptions,
  ) {
    return completeDraftPart({
      api: destination.api,
      chatId: destination.chatId,
      part,
      options: { ...options, ...AGENT_TEXT_LINK_PREVIEW_OPTIONS },
    });
  }

  resetDraftIds(): void {
    this.nextDraftId = 1;
  }
}
