import { parseMAXBlocks } from "./block-parser.js";
import { splitOversizeMAXBlocks, type BlockSplitLimits } from "./block-splitter.js";
import { chunkMAXRenderedBlocks, type MAXChunkerOptions } from "./chunker.js";
import { liftTextListContent } from "./rich-blocks.js";
import { toBlockHtml } from "./blocks-to-html.js";
import type { MAXBlock, MAXRenderedBlock } from "./types.js";
import type { MAXRenderedPart } from "./types.js";

/** Pairs every parsed block with its MAX HTML form and its plain projection. */
export function toRenderedBlocks(
  blocks: MAXBlock[],
  limits?: Partial<BlockSplitLimits>,
): MAXRenderedBlock[] {
  return splitOversizeMAXBlocks(liftTextListContent(blocks), limits).map((block) =>
    toBlockHtml(block),
  );
}

export function renderMAXBlocks(
  markdown: string,
  limits?: Partial<BlockSplitLimits>,
): MAXRenderedBlock[] {
  return toRenderedBlocks(parseMAXBlocks(markdown), limits);
}

export function renderMAXParts(
  markdown: string,
  options?: MAXChunkerOptions,
): MAXRenderedPart[] {
  return chunkMAXRenderedBlocks(renderMAXBlocks(markdown, options), options);
}
