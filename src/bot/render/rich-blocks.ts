import { toBlockHtml, textListMarker } from "./blocks-to-html.js";
import type { InlineNode, MAXBlock, MAXRenderedBlock } from "./types.js";

export { textListMarker };

/** Lists are written out as text on MAX, which has no native list block. */
export function isTextRenderedList(block: Extract<MAXBlock, { type: "list" }>): boolean {
  return block.ordered || block.items.some((item) => item.checked !== undefined);
}

/**
 * MAX has no native nested list/table representation, so this is a no-op kept
 * for the pipeline's shape.
 */
export function liftTextListContent(blocks: MAXBlock[]): MAXBlock[] {
  return blocks;
}

/** Inline content projected to MAX HTML, used by tests and diagnostics. */
export function toRichText(nodes: InlineNode[]): string {
  return toBlockHtml({ type: "paragraph", inlines: nodes }).block.html;
}

export function toRichBlock(block: MAXBlock): MAXRenderedBlock["block"] {
  return toBlockHtml(block).block;
}

export function createParagraphBlock(text: string): MAXRenderedBlock["block"] {
  return toBlockHtml({ type: "plain", text }).block;
}

/** A rendered MAX block is one unit regardless of how much text it carries. */
export function countRichBlocks(_block: MAXRenderedBlock["block"]): number {
  return 1;
}

/** Character budget of a rendered MAX block, measured on the HTML that is sent. */
export function countRichChars(block: MAXRenderedBlock["block"]): number {
  return block.html.length;
}
