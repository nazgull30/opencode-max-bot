import type { Context, NextFunction } from "../../max/compat.js";
import { createIncomingPrompt, type IncomingPrompt } from "../../app/types/prompt.js";

const incomingPromptKey: unique symbol = Symbol("incomingPrompt");

type ContextWithIncomingPrompt = Context & {
  [incomingPromptKey]?: IncomingPrompt;
};

export interface RichMessageConversion {
  text: string;
  photos: never[];
  skippedMediaCount: number;
}

export function setIncomingPrompt(ctx: Context, input: IncomingPrompt): void {
  (ctx as ContextWithIncomingPrompt)[incomingPromptKey] = input;
}

export function getIncomingPrompt(ctx: Context): IncomingPrompt | null {
  const stored = (ctx as ContextWithIncomingPrompt)[incomingPromptKey];
  if (stored) {
    return stored;
  }

  const text = ctx.message?.text;
  return text === undefined ? null : createIncomingPrompt(text);
}

/** MAX has no MAX rich-message update type, so this is a pass-through. */
export async function normalizeRichMessage(_ctx: Context, next: NextFunction): Promise<void> {
  await next();
}

/** Kept for call sites that ask whether a message carried unsupported media. */
export function convertRichMessage(): RichMessageConversion {
  return { text: "", photos: [], skippedMediaCount: 0 };
}
