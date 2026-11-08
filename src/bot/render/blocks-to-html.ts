import { buildAlignedTableText, toBlockPlainText } from "./block-plain-text.js";
import type {
  InlineNode,
  MAXBlock,
  MAXListItem,
  MAXRenderedBlock,
} from "./types.js";

/** Escapes text for MAX's HTML subset. */
export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function renderInlineNodes(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return escapeHtml(node.text);
        case "bold":
          return `<b>${renderInlineNodes(node.children)}</b>`;
        case "italic":
          return `<i>${renderInlineNodes(node.children)}</i>`;
        case "strike":
          return `<s>${renderInlineNodes(node.children)}</s>`;
        case "underline":
          return `<u>${renderInlineNodes(node.children)}</u>`;
        case "marked":
          return `<mark>${renderInlineNodes(node.children)}</mark>`;
        case "code":
          return `<code>${escapeHtml(node.text)}</code>`;
        case "link":
          return `<a href="${escapeHtml(node.url)}">${renderInlineNodes(node.text)}</a>`;
        // MAX has no counterpart for these, so only the content survives.
        case "spoiler":
        case "subscript":
        case "superscript":
          return renderInlineNodes(node.children);
        default: {
          const exhaustiveCheck: never = node;
          throw new Error(`Unsupported inline node: ${JSON.stringify(exhaustiveCheck)}`);
        }
      }
    })
    .join("");
}

function taskMarker(checked: boolean | undefined): string {
  if (checked === undefined) {
    return "";
  }
  return checked ? "✅ " : "🔲 ";
}

export function textListMarker(
  item: MAXListItem,
  index: number,
  ordered: boolean,
  start = 1,
): string {
  const task = taskMarker(item.checked);
  if (ordered) {
    return `${start + index}. ${task}`;
  }
  return task || "• ";
}

function renderListItem(item: MAXListItem, index: number, ordered: boolean, start: number): string {
  const marker = textListMarker(item, index, ordered, start);
  const continuation = " ".repeat(marker.length);
  const body = item.blocks
    .map(renderBlockHtml)
    .filter(Boolean)
    .join("\n");

  return body
    .split("\n")
    .map((line, lineIndex) => `${lineIndex === 0 ? marker : continuation}${line}`)
    .join("\n");
}

function renderBlockHtml(block: MAXBlock): string {
  switch (block.type) {
    case "paragraph":
      return renderInlineNodes(block.inlines);
    case "heading":
      return `<h3>${renderInlineNodes(block.inlines)}</h3>`;
    case "blockquote":
      return `<blockquote>${block.blocks
        .map(renderBlockHtml)
        .filter(Boolean)
        .join("\n")}</blockquote>`;
    case "list":
      return block.items
        .map((item, index) => renderListItem(item, index, block.ordered, block.start ?? 1))
        .join("\n");
    case "code":
      return `<pre>${escapeHtml(block.text)}</pre>`;
    case "table":
      return `<pre>${escapeHtml(buildAlignedTableText(block.rows))}</pre>`;
    case "rule":
      return "──────────";
    case "plain":
      return escapeHtml(block.text);
    default: {
      const exhaustiveCheck: never = block;
      throw new Error(`Unsupported block: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

export function toBlockHtml(block: MAXBlock): MAXRenderedBlock {
  return {
    block: { html: renderBlockHtml(block) },
    plainText: toBlockPlainText(block),
  };
}
