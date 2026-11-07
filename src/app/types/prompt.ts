import type { FilePartInput } from "@opencode-ai/sdk/v2";

export type MAXPhotoSource = "standalone" | "album" | "rich";

export interface MAXPhotoInput {
  fileId: string;
  filename: string;
  source: MAXPhotoSource;
  fileSize?: number;
}

export interface IncomingPrompt {
  text: string;
  fileParts: FilePartInput[];
  photos: MAXPhotoInput[];
}

export function createIncomingPrompt(
  text: string,
  options: {
    fileParts?: FilePartInput[];
    photos?: MAXPhotoInput[];
  } = {},
): IncomingPrompt {
  return {
    text,
    fileParts: options.fileParts ?? [],
    photos: options.photos ?? [],
  };
}
