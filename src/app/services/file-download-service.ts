import type { Api } from "../../max/compat.js";
import { logger } from "../../utils/logger.js";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export interface DownloadedFile {
  buffer: Buffer;
  filePath: string;
  mimeType?: string;
}

/** Kept as an identity helper for callers that still name a file URL. */
export function buildMAXFileUrl(filePath: string): string {
  return filePath;
}

export async function downloadMAXFile(api: Api, fileId: string): Promise<DownloadedFile> {
  logger.debug(`[FileDownload] Getting file info for fileId=${fileId}`);

  const file = await api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("File URL not available from MAX");
  }

  const response = await fetch(file.file_path);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (declaredLength / (1024 * 1024)).toFixed(2);
    throw new Error(`File too large: ${sizeMb}MB (max 20MB)`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  logger.debug(`[FileDownload] Downloaded ${buffer.length} bytes`);
  return { buffer, filePath: file.file_path };
}

export function toDataUri(buffer: Buffer, mimeType: string): string {
  const base64 = buffer.toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

export function isFileSizeAllowed(fileSize: number | undefined, maxSizeKb: number): boolean {
  if (!fileSize) {
    return true;
  }

  const maxBytes = maxSizeKb * 1024;
  return fileSize <= maxBytes;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const APPLICATION_TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-yaml",
  "application/sql",
]);

const TEXT_FILE_EXTENSIONS = new Set([
  "svelte",
  "vue",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "txt",
  "xml",
  "csv",
  "tsv",
  "sql",
  "env",
  "lock",
  "conf",
  "properties",
  "tf",
  "go",
  "rs",
  "rb",
  "py",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  "swift",
  "kt",
  "kts",
  "sh",
  "bash",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "md",
  "mdx",
  "css",
  "scss",
  "less",
  "html",
  "htm",
  "graphql",
  "gql",
  "proto",
  "gradle",
]);

// Text files that carry no extension, plus dotfiles whose whole name is the marker.
const TEXT_FILE_NAMES = new Set([
  "makefile",
  "dockerfile",
  "license",
  "readme",
  "changelog",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".env",
  ".env.example",
  ".npmrc",
  ".prettierrc",
  ".eslintrc",
]);

/**
 * Whether a local file looks like text, judging by its name alone.
 *
 * Files picked from the /ls browser carry no MIME type - MAX only provides one for
 * uploaded documents - so `isTextMimeType` cannot be used for them.
 */
export function isTextFileName(filename: string): boolean {
  const baseName = filename.split(/[\\/]/).pop()?.toLowerCase();
  if (!baseName) {
    return false;
  }

  if (TEXT_FILE_NAMES.has(baseName)) {
    return true;
  }

  const ext = baseName.includes(".") ? baseName.split(".").pop() : undefined;
  return Boolean(ext && TEXT_FILE_EXTENSIONS.has(ext));
}

export function isTextMimeType(mimeType: string | undefined, filename?: string): boolean {
  if (!mimeType) {
    return false;
  }

  if (mimeType.startsWith("text/")) {
    return true;
  }

  if (APPLICATION_TEXT_MIME_TYPES.has(mimeType)) {
    return true;
  }

  if (filename) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext && TEXT_FILE_EXTENSIONS.has(ext)) {
      return true;
    }
  }

  return false;
}
