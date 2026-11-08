import type { Api, SendMessageOptions } from "../../max/compat.js";

type SendMessageApi = Pick<Api, "sendMessage">;
type EditMessageApi = Pick<Api, "editMessageText">;

interface SendMessageWithMarkdownFallbackParams {
  api: SendMessageApi;
  chatId: number;
  text: string;
  rawFallbackText?: string | undefined;
  options?: SendMessageOptions | undefined;
  parseMode?: "Markdown" | "MarkdownV2" | undefined;
}

interface EditMessageWithMarkdownFallbackParams {
  api: EditMessageApi;
  chatId: number;
  messageId: string;
  text: string;
  rawFallbackText?: string | undefined;
  options?: SendMessageOptions | undefined;
  parseMode?: "Markdown" | "MarkdownV2" | undefined;
}

/** Removes MAX MarkdownV2 backslash escaping. */
function unescapeMarkdownV2(text: string): string {
  return text.replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, "$1");
}

function stripFormatting(options: SendMessageOptions | undefined): SendMessageOptions | undefined {
  if (!options) {
    return options;
  }
  const copy = { ...options };
  delete copy.parse_mode;
  return copy;
}

export async function sendMessageWithMarkdownFallback({
  api,
  chatId,
  text,
  rawFallbackText,
  options,
  parseMode,
}: SendMessageWithMarkdownFallbackParams) {
  if (!parseMode) {
    return api.sendMessage(chatId, text, options);
  }

  const plain = rawFallbackText ?? unescapeMarkdownV2(text);
  try {
    return await api.sendMessage(chatId, text, options);
  } catch {
    return api.sendMessage(chatId, plain, stripFormatting(options));
  }
}

export async function editMessageWithMarkdownFallback({
  api,
  chatId,
  messageId,
  text,
  rawFallbackText,
  options,
  parseMode,
}: EditMessageWithMarkdownFallbackParams) {
  if (!parseMode) {
    return api.editMessageText(chatId, messageId, text, options);
  }

  const plain = rawFallbackText ?? unescapeMarkdownV2(text);
  try {
    return await api.editMessageText(chatId, messageId, text, options);
  } catch {
    return api.editMessageText(chatId, messageId, plain, stripFormatting(options));
  }
}
