import { describe, expect, it, vi } from "vitest";
import { finalizeAssistantResponse } from "../../../src/bot/streaming/finalize-assistant-response.js";

describe("bot/streaming/finalize-assistant-response", () => {
  it("completes the response stream and sends final text when streamer reports not streamed", async () => {
    const responseStreamer = {
      complete: vi.fn().mockResolvedValue({ streamed: false, messageIds: [] }),
    };
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendRenderedPart = vi.fn().mockResolvedValue(undefined);
    const keyboard = { keyboard: [[{ text: "A" }]] };

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageId: "m1",
      messageText: "final reply",
      responseStreamer,
      flushPendingServiceMessages,
      prepareStreamingPayload: vi.fn(() => ({
        parts: [
          {
            html: "",
            fallbackText: "final reply",
            source: "plain" as const,
          },
        ],
      })),
      renderFinalParts: vi.fn(() => [
        {
          html: "<b>part 1</b>",
          fallbackText: "part 1",
          source: "html" as const,
        },
        {
          html: "",
          fallbackText: "part 2",
          source: "plain" as const,
        },
      ]),
      getReplyKeyboard: vi.fn(() => keyboard),
      sendRenderedPart,
    });

    expect(responseStreamer.complete).toHaveBeenCalledWith("s1", "m1", {
      parts: [
        {
          html: "",
          fallbackText: "final reply",
          source: "plain",
        },
      ],
      sendOptions: { disable_notification: true, reply_markup: keyboard },
      editOptions: undefined,
    });
    expect(flushPendingServiceMessages).toHaveBeenCalledTimes(1);
    expect(sendRenderedPart).toHaveBeenCalledTimes(2);
    expect(sendRenderedPart).toHaveBeenNthCalledWith(
      1,
      {
        html: "<b>part 1</b>",
        fallbackText: "part 1",
        source: "html",
      },
      { disable_notification: true, reply_markup: keyboard },
    );
    expect(sendRenderedPart).toHaveBeenNthCalledWith(
      2,
      {
        html: "",
        fallbackText: "part 2",
        source: "plain",
      },
      { disable_notification: true, reply_markup: keyboard },
    );
  });

  it("finalizes streamed messages in place without re-sending", async () => {
    const responseStreamer = {
      complete: vi.fn().mockResolvedValue({ streamed: true, messageIds: [101] }),
    };
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendRenderedPart = vi.fn().mockResolvedValue(undefined);
    const prepareStreamingPayload = vi.fn(() => ({
      parts: [
        {
          html: "",
          fallbackText: "reply",
          source: "plain" as const,
        },
      ],
    }));
    const keyboard = { keyboard: [[{ text: "ctx" }]] };

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageId: "m1",
      messageText: "reply",
      responseStreamer,
      flushPendingServiceMessages,
      prepareStreamingPayload,
      renderFinalParts: vi.fn(() => [
        {
          html: "",
          fallbackText: "reply",
          source: "plain" as const,
        },
      ]),
      getReplyKeyboard: vi.fn(() => keyboard),
      sendRenderedPart,
    });

    expect(responseStreamer.complete).toHaveBeenCalledWith("s1", "m1", {
      parts: [
        {
          html: "",
          fallbackText: "reply",
          source: "plain",
        },
      ],
      sendOptions: { disable_notification: true, reply_markup: keyboard },
      editOptions: undefined,
    });
    expect(flushPendingServiceMessages).toHaveBeenCalledTimes(1);
    expect(sendRenderedPart).not.toHaveBeenCalled();
  });

  it("still sends rendered parts with keyboard when streamer reports not streamed", async () => {
    const responseStreamer = {
      complete: vi.fn().mockResolvedValue({ streamed: false, messageIds: [] }),
    };
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendRenderedPart = vi.fn().mockResolvedValue(undefined);
    const prepareStreamingPayload = vi.fn(() => ({
      parts: [
        {
          html: "",
          fallbackText: "reply",
          source: "plain" as const,
        },
      ],
    }));

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageId: "m1",
      messageText: "reply",
      responseStreamer,
      flushPendingServiceMessages,
      prepareStreamingPayload,
      renderFinalParts: vi.fn(() => [
        {
          html: "",
          fallbackText: "reply",
          source: "plain" as const,
        },
      ]),
      getReplyKeyboard: vi.fn(() => undefined),
      sendRenderedPart,
    });

    expect(sendRenderedPart).toHaveBeenCalledTimes(1);
    expect(sendRenderedPart).toHaveBeenCalledWith(
      {
        html: "",
        fallbackText: "reply",
        source: "plain",
      },
      { disable_notification: true },
    );
  });
});

