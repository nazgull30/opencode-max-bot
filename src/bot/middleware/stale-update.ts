import type { Context, NextFunction } from "../../max/compat.js";
import { logger } from "../../utils/logger.js";

// MAX keeps updates for a limited time and long polling can be interrupted.
// Acting on an old message would start tasks the user no longer expects.
const MAX_MESSAGE_AGE_SECONDS = 60;

export async function staleUpdateMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  // Only `ctx.message` carries the time the user acted. `ctx.msg` also resolves
  // to `ctx.callbackQuery.message`, which is the bot's own message holding the
  // buttons - using it here would drop every press under an older message.
  const message = ctx.message;
  if (!message) {
    await next();
    return;
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - message.date;
  if (ageSeconds <= MAX_MESSAGE_AGE_SECONDS) {
    await next();
    return;
  }

  logger.warn(
    `[StaleUpdate] Ignored stale message: ageSeconds=${ageSeconds}, messageId=${message.message_id}`,
  );
}
