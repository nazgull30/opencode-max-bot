import { describe, expect, it } from "vitest";
import { convertToMaxMarkdown } from "../../../src/bot/render/markdown-to-max.js";

describe("summary/markdown-to-max-v2", () => {
  it("converts common inline markdown and escapes MAX MarkdownV2 text", () => {
    expect(convertToMaxMarkdown("Use **bold** and *italic* with a+b!")).toBe(
      "Use *bold* and _italic_ with a\\+b\\!",
    );
  });

  it("escapes code and link delimiters that would break MarkdownV2", () => {
    const output = convertToMaxMarkdown(
      "Use `C:\\temp` and [docs](https://example.com/a_(b))",
    );

    expect(output).toContain("`C:\\\\temp`");
    expect(output).toContain("[docs](https://example.com/a_(b\\))");
  });

  it("renders lists and tables as escaped plain MAX MarkdownV2 text", () => {
    const output = convertToMaxMarkdown(
      ["- item", "", "| A | B |", "| --- | --- |", "| C | D |"].join("\n"),
    );

    expect(output).toContain("\\- item");
    expect(output).toContain("\\| A \\| B \\|");
    expect(output).toContain("\\| \\-\\-\\- \\| \\-\\-\\- \\|");
    expect(output).toContain("\\| C \\| D \\|");
  });

  it("preserves malformed markdown content instead of throwing", () => {
    const input = [
      "*text: *value**",
      "<div>raw_html</div>",
      "[broken](https://example.com/foo",
    ].join("\n\n");

    expect(() => convertToMaxMarkdown(input)).not.toThrow();

    const output = convertToMaxMarkdown(input);
    expect(output).toContain("text");
    expect(output).toContain("value");
    expect(output).toContain("raw\\_html");
    expect(output).toContain("broken");
  });
});
