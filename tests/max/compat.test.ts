import { describe, expect, it, vi } from "vitest";
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
      recipient: { chat_id: 70, chat_type: "dialog" as const, user_id: 1, post_id: null },
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
    expect(ctx.chat.id).toBe(70);
    expect(ctx.chat.type).toBe("private");
    expect(ctx.message.message_id).toBe("mid-1");
    expect(ctx.message.photo).toHaveLength(1);
    expect(ctx.message.document?.file_name).toBe("doc.txt");
    expect(decodeFileId(ctx.message.photo?.[0]?.file_id ?? "")).toBe(
      "https://cdn.example/img.jpg",
    );
  });

  it("gives the SDK bot info before starting long polling", async () => {
    const bot = new Bot("token");
    const rawInfo = {
      user_id: 1,
      first_name: "Bot",
      name: "Bot",
      username: "test_bot",
      is_bot: true,
      last_activity_time: Date.now(),
    };

    vi.spyOn(bot.max.api, "getMyInfo").mockResolvedValue(rawInfo);
    vi.spyOn(bot.max, "startPolling").mockResolvedValue(undefined);

    await bot.start();

    expect(bot.max.botInfo).toBe(rawInfo);
    expect(bot.botInfo).toEqual({
      id: 1,
      is_bot: true,
      first_name: "Bot",
      username: "test_bot",
    });
  });

  it("replies to the dialog chat id, not the bot user id", async () => {
    const bot = new Bot("token");
    const ctx = new Context(messageUpdate(), bot.api, BOT_INFO);
    const rawMessage = {
      recipient: { chat_id: 70, chat_type: "dialog", user_id: 1 },
      timestamp: Date.now(),
      body: { mid: "mid-2", seq: 0, text: "reply" },
      sender: {
        user_id: 1,
        first_name: "Bot",
        is_bot: true,
        username: "bot",
        name: "Bot",
        last_activity_time: Date.now(),
      },
    };

    const sendToChat = vi
      .spyOn(bot.max.api, "sendMessageToChat")
      .mockResolvedValue(rawMessage as never);
    const sendToUser = vi
      .spyOn(bot.max.api, "sendMessageToUser")
      .mockResolvedValue(rawMessage as never);

    await ctx.reply("reply");

    expect(sendToChat).toHaveBeenCalledWith(70, "reply", expect.anything());
    expect(sendToUser).not.toHaveBeenCalled();
  });

  it("answers callbacks with a no-op notification when no text is given", async () => {
    const bot = new Bot("token");
    const update = {
      update_type: "message_callback" as const,
      timestamp: Date.now(),
      callback: {
        callback_id: "callback-1",
        payload: "project:1",
        user: { user_id: 7, first_name: "User", is_bot: false, name: "User", username: "user", last_activity_time: Date.now() },
      },
      message: messageUpdate().message,
    };
    const ctx = new Context(update as never, bot.api, BOT_INFO);
    const answer = vi
      .spyOn(bot.max.api, "answerOnCallback")
      .mockResolvedValue({ success: true } as never);

    await ctx.answerCallbackQuery();

    expect(answer).toHaveBeenCalledWith("callback-1", { notification: "\u200B" });
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
