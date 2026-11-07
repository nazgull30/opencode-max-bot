import { describe, expect, it } from "vitest";
import {
  Bot,
  Context,
  InlineKeyboard,
  Keyboard,
  decodeFileId,
  encodeFileId,
} from "../../src/max/compat.js";

const BOT_INFO = { id: 1, is_bot: true as const, first_name: "Bot" };

function messageUpdate() {
  return {
    update_type: "message_created" as const,
    timestamp: Date.now(),
    message: {
      sender: { user_id: 7, first_name: "User", is_bot: false, name: "User", username: "user", last_activity_time: Date.now() },
      recipient: { chat_id: null, chat_type: "dialog" as const, user_id: 7, post_id: null },
      timestamp: Date.now(),
      body: {
        mid: "mid-1",
        seq: 0,
        text: "hello",
        attachments: [
          {
            type: "image" as const,
            payload: { photo_id: 1, token: "img-token", url: "https://cdn.example/img.jpg" },
          },
          {
            type: "file" as const,
            payload: { token: "file-token", url: "https://cdn.example/doc.txt" },
            filename: "doc.txt",
            size: 12,
          },
        ],
      },
    },
  };
}

describe("max/compat", () => {
  it("normalizes a MAX dialog message", () => {
    const bot = new Bot("token");
    const ctx = new Context(messageUpdate(), bot.api, BOT_INFO);

    expect(ctx.message.text).toBe("hello");
    expect(ctx.message.caption).toBe("hello");
    expect(ctx.chat.id).toBe(7);
    expect(ctx.chat.type).toBe("private");
    expect(ctx.message.message_id).toBe("mid-1");
    expect(ctx.message.photo).toHaveLength(1);
    expect(ctx.message.document?.file_name).toBe("doc.txt");
    expect(decodeFileId(ctx.message.photo?.[0]?.file_id ?? "")).toBe(
      "https://cdn.example/img.jpg",
    );
  });

  it("round-trips an encoded MAX file id", () => {
    const url = "https://cdn.example/voice.ogg";
    expect(decodeFileId(encodeFileId(url))).toBe(url);
  });

  it("converts an inline keyboard to MAX buttons", () => {
    const keyboard = new InlineKeyboard()
      .text("One", "callback:1")
      .url("Site", "https://example.com")
      .row()
      .text("Two", "callback:2");

    expect(keyboard.toAttachment()).toEqual({
      type: "inline_keyboard",
      payload: {
        buttons: [
          [
            { type: "callback", text: "One", payload: "callback:1" },
            { type: "link", text: "Site", url: "https://example.com" },
          ],
          [{ type: "callback", text: "Two", payload: "callback:2" }],
        ],
      },
    });
  });

  it("keeps the main keyboard grid and sends its labels as messages", () => {
    const keyboard = new Keyboard().text("Agent").text("Context").row().text("Model").row();

    expect(keyboard.keyboard).toEqual([
      [{ text: "Agent" }, { text: "Context" }],
      [{ text: "Model" }],
      [],
    ]);
    expect(keyboard.toAttachment()).toEqual({
      type: "inline_keyboard",
      payload: {
        buttons: [
          [{ type: "message", text: "Agent" }, { type: "message", text: "Context" }],
          [{ type: "message", text: "Model" }],
        ],
      },
    });
  });
});
