import type { Api, MessageEntity, SendMessageOptions } from "../../max/compat.js";
import { logger } from "../../utils/logger.js";
import { chunkPlainText } from "../render/chunker.js";
import { MAX_TEXT_MESSAGE_LIMIT } from "../render/limits.js";
import { escapeHtml } from "../render/blocks-to-html.js";
import { getMAXRenderedPartSignature } from "../render/part-signature.js";
import type { MAXRenderedPart } from "../render/types.js";

/** MAX keeps link previews by default; agent text opts into them explicitly. */
export const AGENT_TEXT_LINK_PREVIEW_OPTIONS = {
  link_preview_options: { is_disabled: false },
} as const;

export type MAXTextFormat = "raw" | "markdown_v2";

interface SendBotTextParams {
  api: Api;
  chatId: number;
  text: string;
  rawFallbackText?: string | undefined;
  options?: SendMessageOptions | undefined;
  format?: MAXTextFormat | undefined;
}

interface EditBotTextParams {
  api: Api;
  chatId: number;
  messageId: string;
  text: string;
  rawFallbackText?: string | undefined;
  options?: SendMessageOptions | undefined;
  format?: MAXTextFormat | undefined;
}

interface SendRenderedBotPartParams {
  api: Api;
  chatId: number;
  part: MAXRenderedPart;
  options?: SendMessageOptions;
  allowPlainFallback?: boolean;
}

interface EditRenderedBotPartParams {
  api: Api;
  chatId: number;
  messageId: string;
  part: MAXRenderedPart;
  options?: SendMessageOptions;
  allowPlainFallback?: boolean;
}

interface RenderedPartDeliveryResult {
  deliveredSignature: string;
  degradedToPlain?: boolean;
}

interface RenderedPartSendResult extends RenderedPartDeliveryResult {
  messageId: string;
}

export { getMAXRenderedPartSignature };

function plainHtml(part: MAXRenderedPart): string | null {
  if (!part.entities?.length) {
    return null;
  }

  let result = "";
  let cursor = 0;
  for (const entity of part.entities) {
    result += escapeHtml(part.fallbackText.slice(cursor, entity.offset));
    const body = escapeHtml(
      part.fallbackText.slice(entity.offset, entity.offset + entity.length),
    );
    result += entity.type.includes("blockquote") ? `<blockquote>${body}</blockquote>` : body;
    cursor = entity.offset + entity.length;
  }
  result += escapeHtml(part.fallbackText.slice(cursor));
  return result;
}

function plainSignature(text: string, entities?: MessageEntity[]): string {
  return getMAXRenderedPartSignature({
    html: "",
    fallbackText: text,
    source: "plain",
    ...(entities ? { entities } : {}),
  });
}

/** Removes MAX MarkdownV2 escaping so the text reads correctly on MAX. */
export function markdownV2ToPlain(text: string): string {
  return text.replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, "$1");
}

function prepareText(
  text: string,
  format: MAXTextFormat,
  fallback: string | undefined,
): { text: string; fallback: string; parseMode: "HTML" | undefined } {
  if (format === "markdown_v2") {
    const plain = markdownV2ToPlain(text);
    return { text: plain, fallback: fallback ? markdownV2ToPlain(fallback) : plain, parseMode: undefined };
  }
  return { text, fallback: fallback ?? text, parseMode: undefined };
}

export async function sendBotText({
  api,
  chatId,
  text,
  rawFallbackText,
  options,
  format = "raw",
}: SendBotTextParams): Promise<void> {
  const prepared = prepareText(text, format, rawFallbackText);
  try {
    await api.sendMessage(chatId, prepared.text, {
      ...options,
      ...(prepared.parseMode ? { parse_mode: prepared.parseMode } : {}),
    });
  } catch (error) {
    if (prepared.fallback === prepared.text) {
      throw error;
    }
    logger.warn("[Bot] Formatted send failed, retrying as plain text", error);
    await api.sendMessage(chatId, prepared.fallback, options);
  }
}

export async function sendRenderedBotPart({
  api,
  chatId,
  part,
  options,
  allowPlainFallback = true,
}: SendRenderedBotPartParams): Promise<RenderedPartSendResult> {
  logger.debug("[Bot] Sending rendered part", {
    source: part.source,
    htmlLength: part.html.length,
    fallbackTextLength: part.fallbackText.length,
  });

  if (part.source === "plain" || !part.html) {
    const html = plainHtml(part);
    const sent = html
      ? await api.sendMessage(chatId, html, { ...options, parse_mode: "HTML" })
      : await api.sendMessage(chatId, part.fallbackText, options);
    return {
      messageId: sent.message_id,
      deliveredSignature: plainSignature(part.fallbackText, part.entities),
    };
  }

  try {
    const sent = await api.sendMessage(chatId, part.html, {
      ...options,
      parse_mode: "HTML",
    });
    return {
      messageId: sent.message_id,
      deliveredSignature: getMAXRenderedPartSignature(part),
    };
  } catch (error) {
    if (!allowPlainFallback) {
      throw error;
    }

    logger.warn("[Bot] HTML send failed, retrying part as plain text", error);
    const chunks = chunkPlainText(part.fallbackText);
    let firstMessageId: string | null = null;
    for (const chunk of chunks) {
      const sent = await api.sendMessage(chatId, chunk.fallbackText, options);
      firstMessageId ??= sent.message_id;
    }

    if (firstMessageId === null) {
      throw error;
    }

    return {
      messageId: firstMessageId,
      deliveredSignature: plainSignature(part.fallbackText),
      degradedToPlain: true,
    };
  }
}

export async function editRenderedBotPart({
  api,
  chatId,
  messageId,
  part,
  options,
  allowPlainFallback = true,
}: EditRenderedBotPartParams): Promise<RenderedPartDeliveryResult> {
  if (part.source === "plain" || !part.html) {
    const html = plainHtml(part);
    if (html) {
      await api.editMessageText(chatId, messageId, html, { ...options, parse_mode: "HTML" });
    } else {
      await api.editMessageText(chatId, messageId, part.fallbackText, options);
    }
    return { deliveredSignature: plainSignature(part.fallbackText, part.entities) };
  }

  try {
    await api.editMessageText(chatId, messageId, part.html, {
      ...options,
      parse_mode: "HTML",
    });
    return { deliveredSignature: getMAXRenderedPartSignature(part) };
  } catch (error) {
    if (
      !allowPlainFallback ||
      part.fallbackText.length > MAX_TEXT_MESSAGE_LIMIT
    ) {
      throw error;
    }

    logger.warn("[Bot] HTML edit failed, retrying as plain text", error);
    await api.editMessageText(chatId, messageId, part.fallbackText, options);
    return {
      deliveredSignature: plainSignature(part.fallbackText),
      degradedToPlain: true,
    };
  }
}

/**
 * MAX has no draft API. Streaming drafts are delivered as ordinary messages
 * that the streamer edits in place.
 */
export async function sendDraftBotPart(params: {
  api: Api;
  chatId: number;
  draftId: number | string;
  part: MAXRenderedPart;
}): Promise<{ messageId: string; deliveredSignature: string }> {
  const sent = await sendRenderedBotPart({
    api: params.api,
    chatId: params.chatId,
    part: params.part,
  });
  return { messageId: sent.messageId, deliveredSignature: sent.deliveredSignature };
}

export async function completeDraftPart(params: {
  api: Api;
  chatId: number;
  part: MAXRenderedPart;
  options?: SendMessageOptions;
}): Promise<RenderedPartSendResult> {
  return sendRenderedBotPart({
    api: params.api,
    chatId: params.chatId,
    part: params.part,
    ...(params.options ? { options: params.options } : {}),
  });
}

export async function editBotText({
  api,
  chatId,
  messageId,
  text,
  rawFallbackText,
  options,
  format = "raw",
}: EditBotTextParams): Promise<void> {
  const prepared = prepareText(text, format, rawFallbackText);
  await api.editMessageText(chatId, messageId, prepared.text, options);
}
