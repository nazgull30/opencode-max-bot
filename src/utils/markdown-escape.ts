const MARKDOWN_V2_RESERVED_CHARS = /([_\*\[\]\(\)~`>#+\-=|{}.!\\])/g;

export function escapePlainTextForMarkdown(text: string): string {
  return text.replace(MARKDOWN_V2_RESERVED_CHARS, "\\$1");
}
