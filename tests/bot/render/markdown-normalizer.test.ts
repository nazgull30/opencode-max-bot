import { describe, expect, it } from "vitest";
import {
  normalizeMarkdownForMAXBlockParsing,
  normalizeMarkdownForMAXRendering,
} from "../../../src/bot/render/markdown-normalizer.js";

describe("bot/render/markdown-normalizer", () => {
  it("normalizes headings, quotes, horizontal rules, and checklists", () => {
    const input = [
      "# Main heading",
      "",
      "> quoted line",
      "Quote continues",
      "",
      "- [ ] Open task",
      "- [x] Done task",
      "1. [ ] Numbered task",
      "",
      "---",
    ].join("\n");

    expect(normalizeMarkdownForMAXRendering(input)).toBe(
      [
        "**Main heading**",
        "",
        "> quoted line",
        "> Quote continues",
        "",
        "🔲 Open task",
        "✅ Done task",
        "🔲 Numbered task",
        "",
        "──────────",
      ].join("\n"),
    );
  });

  it("normalizes checklists inside quotes and preserves quote mode", () => {
    const input = ["> - [ ] Review", "Follow-up line", "- [x] Outside quote"].join("\n");

    expect(normalizeMarkdownForMAXRendering(input)).toBe(
      ["> 🔲 Review", "> Follow-up line", "> ✅ Outside quote"].join("\n"),
    );
  });

  it("resets quote mode after an empty line", () => {
    const input = ["> quoted line", "", "Plain line"].join("\n");

    expect(normalizeMarkdownForMAXRendering(input)).toBe(
      ["> quoted line", "", "Plain line"].join("\n"),
    );
  });

  it("keeps fenced code blocks untouched", () => {
    const input = [
      "```ts",
      "# Not a heading",
      "> not a quote",
      "- [ ] not a checklist",
      "---",
      "```",
    ].join("\n");

    expect(normalizeMarkdownForMAXRendering(input)).toBe(input);
  });

  it("preserves malformed emphasis text without dropping content", () => {
    const input = "*text: *value**";

    expect(normalizeMarkdownForMAXRendering(input)).toBe(input);
  });

  it("keeps structural markdown for parser-safe normalization", () => {
    const input = [
      "# Main heading",
      "",
      "> - [ ] Review",
      "Follow-up line",
      "",
      "- [x] Done task",
      "",
      "---",
    ].join("\n");

    expect(normalizeMarkdownForMAXBlockParsing(input)).toBe(
      [
        "# Main heading",
        "",
        "> - [ ] Review",
        "> Follow-up line",
        "",
        "- [x] Done task",
        "",
        "---",
      ].join("\n"),
    );
  });
});
