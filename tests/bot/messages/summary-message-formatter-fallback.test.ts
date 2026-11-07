import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  convertToMaxMarkdown: vi.fn(),
}));

vi.mock("../../../src/bot/render/markdown-to-max.js", () => ({
  convertToMaxMarkdown: mocked.convertToMaxMarkdown,
}));

describe("bot/messages/summary-message-formatter markdown fallback", () => {
  beforeEach(() => {
    mocked.convertToMaxMarkdown.mockReset();
  });

  it("keeps summary delivery alive when markdown conversion fails", async () => {
    mocked.convertToMaxMarkdown.mockImplementation(() => {
      throw new Error("conversion failed");
    });

    const { formatSummaryWithMode } = await import(
      "../../../src/bot/messages/summary-message-formatter.js"
    );

    expect(formatSummaryWithMode("**raw** text!", "markdown")).toEqual(["**raw** text!"]);
    expect(mocked.convertToMaxMarkdown).toHaveBeenCalledOnce();
  });
});
