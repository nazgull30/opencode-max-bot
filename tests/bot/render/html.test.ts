import { describe, expect, it } from "vitest";
import { renderMAXBlocks, renderMAXParts } from "../../../src/bot/render/pipeline.js";
import { escapeHtml } from "../../../src/bot/render/blocks-to-html.js";

describe("bot/render/html", () => {
  it("escapes user text for MAX HTML", () => {
    expect(escapeHtml("<b>&</b>")).toBe("&lt;b&gt;&amp;&lt;/b&gt;");
  });

  it("renders common markdown as MAX HTML blocks", () => {
    const [block] = renderMAXBlocks("**bold** and `code`");
    expect(block?.block.html).toBe("<b>bold</b> and <code>code</code>");
    expect(block?.plainText).toBe("bold and code");
  });

  it("renders headings, quotes and lists as HTML", () => {
    const blocks = renderMAXBlocks("# Title\n\n> quote\n\n- one\n- two");
    expect(blocks.map((block) => block.block.html)).toEqual([
      "<h3>Title</h3>",
      "<blockquote>quote</blockquote>",
      "• one\n• two",
    ]);
  });

  it("splits a long answer into parts that fit a MAX message", () => {
    const text = Array.from({ length: 600 }, (_, index) => `line ${index} with some text`).join("\n\n");
    const parts = renderMAXParts(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.html.length).toBeLessThanOrEqual(3800);
      expect(part.fallbackText.length).toBeLessThanOrEqual(3800);
    }
  });

  it("keeps raw text as plain parts", () => {
    const parts = renderMAXParts("plain");
    expect(parts[0]?.source).toBe("html");
  });
});
