import type { Context } from "../../max/compat.js";
import { createIncomingPrompt, type IncomingPrompt } from "../../app/types/prompt.js";
import { flushPendingPrompt } from "./message-merger.js";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";
import {
  rejectQueuedMediaBeforePreparation,
  takeArrivalTicket,
  tryEnqueuePromptIfBusy,
} from "./prompt-queue-dispatch.js";

export interface PhotoHandlerDeps extends ProcessPromptDeps {
  processPrompt?: (
    ctx: Context,
    input: IncomingPrompt,
    deps: ProcessPromptDeps,
  ) => Promise<boolean>;
}

export async function handlePhotoMessage(ctx: Context, deps: PhotoHandlerDeps): Promise<void> {
  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) {
    return;
  }

  flushPendingPrompt(ctx.chat!.id);
  const ticket = takeArrivalTicket();

  const caption = ctx.message.caption || "";
  // MAX delivers several images of one message in a single photo array; each
  // carries its own encoded file id. Thumbnail size variants share one
  // image, so keep the largest of those.
  const maxPhotos = photos.filter((photo) => photo.file_id.startsWith("maxfile:"));
  const selectedPhotos = maxPhotos.length > 0 ? maxPhotos : photos.slice(-1);
  const photoInputs = selectedPhotos.map((photo, index) => ({
    fileId: photo.file_id,
    filename: selectedPhotos.length > 1 ? `photo-${index + 1}.jpg` : "photo.jpg",
    source: "standalone" as const,
  }));
  const mediaBytes = selectedPhotos.reduce((total, photo) => total + (photo.file_size ?? 0), 0);
  const input = createIncomingPrompt(caption, { photos: photoInputs });
  if (await rejectQueuedMediaBeforePreparation(ctx, mediaBytes || undefined)) {
    return;
  }
  if (
    await tryEnqueuePromptIfBusy(
      ctx,
      {
        ...input,
        displayText: caption.trim() || "[Photo]",
        ...(mediaBytes > 0 ? { mediaBytes } : {}),
      },
      ticket,
    )
  ) {
    return;
  }

  await (deps.processPrompt ?? processUserPrompt)(ctx, input, deps);
}
