import { logger } from "../../utils/logger.js";
import {
  DEFAULT_MAX_PART_BLOCKS,
  DEFAULT_MAX_PART_CHARS,
  PLAIN_MAX_PART_CHARS,
} from "./limits.js";
import { countRichBlocks, countRichChars } from "./rich-blocks.js";
import { splitTextIntoChunks } from "./text-splitter.js";
import type { MAXRenderedBlock, MAXRenderedPart } from "./types.js";

const DEFAULT_BLOCK_SEPARATOR = "\n\n";

export interface MAXChunkerOptions {
  maxChars?: number;
  maxBlocks?: number;
}

export interface PlainChunkerOptions {
  maxChars?: number;
}

/**
 * Cuts text into parts that fit a plain MAX text message. Used by raw
 * format mode and by every degradation from native blocks to plain text.
 */
export function chunkPlainText(
  text: string,
  options?: PlainChunkerOptions,
): MAXRenderedPart[] {
  const maxChars = Math.max(1, Math.floor(options?.maxChars ?? PLAIN_MAX_PART_CHARS));

  return splitTextIntoChunks(text, maxChars).map((chunk) => ({
    html: "",
    fallbackText: chunk,
    source: "plain" as const,
  }));
}

/**
 * Groups rendered blocks so that every group stays within both MAX
 * budgets. Blocks are expected to fit individually already (see
 * `block-splitter.ts`); an oversize one lands in a group of its own.
 */
function groupRenderedBlocks(
  blocks: MAXRenderedBlock[],
  options?: MAXChunkerOptions,
): MAXRenderedBlock[][] {
  const maxChars = Math.max(1, Math.floor(options?.maxChars ?? DEFAULT_MAX_PART_CHARS));
  const maxBlocks = Math.max(1, Math.floor(options?.maxBlocks ?? DEFAULT_MAX_PART_BLOCKS));

  const groups: MAXRenderedBlock[][] = [];
  let current: MAXRenderedBlock[] = [];
  let currentChars = 0;
  let currentUnits = 0;

  for (const rendered of blocks) {
    const chars = countRichChars(rendered.block) + DEFAULT_BLOCK_SEPARATOR.length;
    const units = countRichBlocks(rendered.block);

    if (
      current.length > 0 &&
      (currentChars + chars > maxChars || currentUnits + units > maxBlocks)
    ) {
      groups.push(current);
      current = [];
      currentChars = 0;
      currentUnits = 0;
    }

    current.push(rendered);
    currentChars += chars;
    currentUnits += units;
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

/**
 * Packs rendered blocks into messages, respecting both MAX budgets:
 * characters and block count.
 */
export function chunkMAXRenderedBlocks(
  blocks: MAXRenderedBlock[],
  options?: MAXChunkerOptions,
): MAXRenderedPart[] {
  const parts = groupRenderedBlocks(blocks, options).map((group) => ({
    html: group
      .map((rendered) => rendered.block.html)
      .filter(Boolean)
      .join(DEFAULT_BLOCK_SEPARATOR),
    fallbackText: group
      .map((rendered) => rendered.plainText)
      .filter(Boolean)
      .join(DEFAULT_BLOCK_SEPARATOR),
    source: "html" as const,
  }));

  if (parts.length > 1) {
    logger.debug("[MAXRender] Rendered blocks chunked", {
      blockCount: blocks.length,
      partCount: parts.length,
    });
  }

  return parts;
}
