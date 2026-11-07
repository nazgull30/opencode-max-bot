import type { MessageEntity } from "../../max/compat.js";

/**
 * A block already converted to the MAX HTML representation. MAX accepts a
 * limited HTML subset, so this is the native form the bot delivers.
 */
export interface RenderedBlockData {
  html: string;
}

/**
 * A message ready to be delivered to MAX.
 *
 * `html` is the formatted representation; `fallbackText` is the plain
 * projection used when a formatted send is rejected. A part with
 * `source: "plain"` carries no HTML tags and its text already fits a message.
 */
export interface MAXRenderedPart {
  html: string;
  fallbackText: string;
  source: "html" | "plain";
  /** Plain representation metadata, currently used for reasoning quotes. */
  entities?: MessageEntity[] | undefined;
}

/** A single parsed block paired with its formatted and plain projections. */
export interface MAXRenderedBlock {
  block: RenderedBlockData;
  plainText: string;
}

/** Column alignment of a markdown table, as declared in its delimiter row. */
export type TableColumnAlign = "left" | "center" | "right";

/**
 * One entry of a list. The content is a block list so that nested lists, code
 * and quotes inside an item survive; `checked` is set only for task items.
 */
export interface MAXListItem {
  blocks: MAXBlock[];
  checked?: boolean;
}

export type MAXBlock =
  | { type: "paragraph"; inlines: InlineNode[] }
  | { type: "heading"; level: number; inlines: InlineNode[] }
  | { type: "blockquote"; blocks: MAXBlock[] }
  /** `start` continues the numbering when a list is written out in pieces. */
  | { type: "list"; ordered: boolean; items: MAXListItem[]; start?: number }
  | { type: "code"; language?: string | undefined; text: string }
  | { type: "table"; rows: string[][]; align?: TableColumnAlign[] }
  | { type: "rule" }
  | { type: "plain"; text: string };

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "bold"; children: InlineNode[] }
  | { type: "italic"; children: InlineNode[] }
  | { type: "strike"; children: InlineNode[] }
  | { type: "underline"; children: InlineNode[] }
  | { type: "spoiler"; children: InlineNode[] }
  | { type: "subscript"; children: InlineNode[] }
  | { type: "superscript"; children: InlineNode[] }
  | { type: "marked"; children: InlineNode[] }
  | { type: "code"; text: string }
  | { type: "link"; text: InlineNode[]; url: string };
