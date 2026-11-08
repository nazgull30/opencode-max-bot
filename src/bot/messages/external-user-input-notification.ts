import type { Api } from "../../max/compat.js";
import {
  buildExternalUserInputNotification,
  type ExternalUserInputNotification,
} from "../../app/services/external-user-input-service.js";
import { sendBotText } from "./max-text.js";

type SendMessageApi = Api;

interface DeliverExternalUserInputParams {
  api: SendMessageApi;
  chatId: number;
  isForegroundSession: boolean;
  sessionId: string;
  text: string;
  consumeSuppressedInput: (sessionId: string, text: string) => boolean;
}

async function sendExternalUserInputNotification(
  api: SendMessageApi,
  chatId: number,
  notification: ExternalUserInputNotification,
): Promise<void> {
  await sendBotText({
    api,
    chatId,
    text: notification.text,
    rawFallbackText: notification.rawFallbackText,
    format: "markdown_v2",
  });
}

export async function deliverExternalUserInputNotification({
  api,
  chatId,
  isForegroundSession,
  sessionId,
  text,
  consumeSuppressedInput,
}: DeliverExternalUserInputParams): Promise<boolean> {
  const notification = buildExternalUserInputNotification(text);
  if (!notification || !isForegroundSession) {
    return false;
  }

  if (consumeSuppressedInput(sessionId, text)) {
    return false;
  }

  await sendExternalUserInputNotification(api, chatId, notification);
  return true;
}
