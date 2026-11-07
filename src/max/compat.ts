/**
 * MAX-backed chat framework.
 *
 * The application was written against a small chat framework. This module keeps the
 * same small surface (Bot, Context, Api, keyboards and InputFile) but talks to
 * the MAX Bot API only. It normalizes MAX updates into the shape the rest of the
 * code expects, so feature logic stays transport-neutral while the transport is
 * strictly MAX.
 */
import { Bot as MaxBot, type Api as MaxApiClass } from "@maxhub/max-bot-api";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as MaxApiTypes from "@maxhub/max-bot-api/types";
import type { Message as MaxMessage, Update as MaxUpdate, User as MaxUser } from "@maxhub/max-bot-api/types";
import type { MessageCallbackUpdate, MessageCreatedUpdate } from "@maxhub/max-bot-api/types";

interface MaxSendExtra {
  format?: "html" | "markdown";
  notify?: boolean;
  disable_link_preview?: boolean;
  link?: { type: "reply" | "forward"; mid: string };
  attachments?: MaxApiTypes.AttachmentRequest[];
}

interface MaxCallbackAnswer {
  message?: (MaxSendExtra & { text?: string | null }) | null;
  notification?: string | null;
}

interface MaxEditBody {
  text?: string | null;
  attachments?: MaxApiTypes.AttachmentRequest[] | null;
  link?: { type: "reply" | "forward"; mid: string } | null;
  notify?: boolean;
  format?: "html" | "markdown" | null;
  disable_link_preview?: boolean;
}

export type MessageId = string;

export interface User {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface Chat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
}

export interface PhotoSize {
  file_id: string;
  file_unique_id: string;
  width?: number;
  height?: number;
  file_size?: number;
}

export interface Document {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface Voice {
  file_id: string;
  file_unique_id: string;
  duration?: number;
  mime_type?: string;
  file_size?: number;
}

export interface Audio {
  file_id: string;
  file_unique_id: string;
  duration?: number;
  performer?: string;
  title?: string;
  mime_type?: string;
  file_size?: number;
}

export interface MessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
  user?: User;
  language?: string;
  emoji?: string;
}

export interface RichMessageBlock {
  type: string;
  [key: string]: unknown;
}

export interface Message {
  message_id: MessageId;
  message_thread_id?: number;
  from?: User;
  chat: Chat;
  date: number;
  text?: string;
  caption?: string;
  entities?: MessageEntity[];
  caption_entities?: MessageEntity[];
  photo?: PhotoSize[];
  document?: Document;
  voice?: Voice;
  audio?: Audio;
  video?: unknown;
  video_note?: unknown;
  animation?: unknown;
  sticker?: unknown;
  contact?: unknown;
  location?: unknown;
  poll?: unknown;
  dice?: unknown;
  media_group_id?: string;
  reply_to_message?: Message;
  rich_message?: { blocks: RichMessageBlock[] } | undefined;
  [key: string]: unknown;
}

export interface CallbackQuery {
  id: string;
  from: User;
  message?: Message;
  data?: string;
  chat_instance: string;
}

export class InputFile {
  readonly buffer: Buffer;
  readonly filename: string;

  constructor(buffer: Buffer, filename: string) {
    this.buffer = buffer;
    this.filename = filename;
  }

  /** Compatibility with callers that read the raw upload bytes. */
  async toRaw(): Promise<Buffer> {
    return this.buffer;
  }
}

export interface ReplyMarkup {
  inline_keyboard?: InlineKeyboardButton[][];
  remove_keyboard?: boolean;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface SendMessageOptions {
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
  reply_markup?: InlineKeyboard | Keyboard | ReplyMarkup | ReplyKeyboardRemove | ForceReply;
  link_preview_options?: {
    is_disabled?: boolean;
    url?: string;
    prefer_small_media?: boolean;
    prefer_large_media?: boolean;
    show_above_text?: boolean;
  };
  disable_notification?: boolean;
  reply_parameters?: { message_id: MessageId; allow_sending_without_reply?: boolean };
  caption?: string;
  entities?: MessageEntity[];
  disable_web_page_preview?: boolean;
  message_thread_id?: number;
  protect_content?: boolean;
  [key: string]: unknown;
}

export type NextFunction = () => Promise<void>;
export type Middleware<C extends Context = Context> = (
  ctx: C,
  next: NextFunction,
) => Promise<void> | void;

export type CommandContext<T = unknown> = [T] extends [unknown] ? Context : Context;
export type RawApi = unknown;
export type InlineKeyboardMarkup = InlineKeyboard;
export type ReplyKeyboardMarkup = Keyboard;
export type ReplyKeyboardRemove = { remove_keyboard: true; inline_keyboard?: InlineKeyboardButton[][] };
export type ForceReply = { force_reply: true; input_field_placeholder?: string; inline_keyboard?: InlineKeyboardButton[][] };
export type RichText = string | Array<string | Record<string, unknown>>;
export type RichBlockTableCell = Record<string, unknown>;
export type RichBlockCaption = Record<string, unknown>;
export type RichBlock = Record<string, unknown>;

export interface BotCommand {
  command: string;
  description: string;
}

type Filter = string | RegExp | ((ctx: Context) => boolean);

const FILE_ID_PREFIX = "maxfile:";

export function encodeFileId(url: string): string {
  return `${FILE_ID_PREFIX}${Buffer.from(url, "utf8").toString("base64url")}`;
}

export function decodeFileId(fileId: string): string | null {
  if (!fileId.startsWith(FILE_ID_PREFIX)) {
    return null;
  }
  return Buffer.from(fileId.slice(FILE_ID_PREFIX.length), "base64url").toString("utf8");
}

function toUser(user: MaxUser | null | undefined): User | undefined {
  if (!user) {
    return undefined;
  }
  const result: User = {
    id: user.user_id,
    is_bot: user.is_bot,
    first_name: user.first_name,
  };
  if (user.last_name) result.last_name = user.last_name;
  if (user.username) result.username = user.username;
  return result;
}

function toChat(message: MaxMessage): Chat {
  const recipient = message.recipient;
  const isDialog = recipient.chat_type === "dialog";
  const id = isDialog ? (recipient.user_id ?? recipient.chat_id ?? 0) : (recipient.chat_id ?? 0);
  const chat: Chat = {
    id,
    type:
      recipient.chat_type === "dialog"
        ? "private"
        : recipient.chat_type === "channel"
          ? "channel"
          : "supergroup",
  };
  return chat;
}

function toMessage(raw: MaxMessage): Message {
  const attachments = raw.body.attachments ?? [];
  const images = attachments.filter((a): a is Extract<typeof a, { type: "image" }> => a.type === "image");
  const files = attachments.filter((a): a is Extract<typeof a, { type: "file" }> => a.type === "file");
  const audios = attachments.filter((a): a is Extract<typeof a, { type: "audio" }> => a.type === "audio");

  const message: Message = {
    message_id: raw.body.mid,
    chat: toChat(raw),
    date: Math.floor(raw.timestamp / 1000),
  };

  const sender = toUser(raw.sender);
  if (sender) {
    message.from = sender;
  }

  if (raw.body.text) {
    message.text = raw.body.text;
    if (attachments.length > 0) {
      message.caption = raw.body.text;
    }
  }

  if (images.length > 0) {
    message.photo = images.map((image) => {
      const size: PhotoSize = {
        file_id: encodeFileId(image.payload.url),
        file_unique_id: image.payload.token,
      };
      if (image.payload.photo_id !== undefined) {
        // photo_id is not a size; kept off the MAX-shaped field.
      }
      return size;
    });
  }

  const file = files[0];
  if (file) {
    const document: Document = {
      file_id: encodeFileId(file.payload.url),
      file_unique_id: file.payload.token,
      file_name: file.filename,
      file_size: file.size,
    };
    message.document = document;
  }

  const audio = audios[0];
  if (audio) {
    const voice: Voice = {
      file_id: encodeFileId(audio.payload.url),
      file_unique_id: audio.payload.token,
    };
    message.voice = voice;
    message.audio = { ...voice };
  }

  if (raw.link?.type === "reply") {
    message.reply_to_message = {
      message_id: raw.link.message.mid,
      chat: message.chat,
      date: Math.floor(raw.timestamp / 1000),
      ...(raw.link.message.text ? { text: raw.link.message.text } : {}),
    };
  }

  return message;
}

function normalizeUpdate(
  update: MaxUpdate,
  api: Api,
  botInfo: BotInfo | undefined,
): Context {
  return new Context(update, api, botInfo);
}

function toAttachment(
  markup: SendMessageOptions["reply_markup"] | undefined,
): MaxApiTypes.AttachmentRequest | null {
  if (!markup) {
    return null;
  }

  if (markup instanceof InlineKeyboard || markup instanceof Keyboard) {
    const attachment = markup.toAttachment();
    return attachment;
  }

  if ("remove_keyboard" in markup) {
    return null;
  }

  if (!("inline_keyboard" in markup)) {
    return null;
  }

  const rows = markup.inline_keyboard;
  if (!rows || rows.length === 0) {
    return null;
  }

  return {
    type: "inline_keyboard",
    payload: {
      buttons: rows
        .filter((row) => row.length > 0)
        .map((row) =>
          row.map((button) => {
            if (button.url) {
              return { type: "link" as const, text: button.text, url: button.url };
            }
            return {
              type: "callback" as const,
              text: button.text,
              payload: button.callback_data ?? button.text,
            };
          }),
        ),
    },
  };
}

function mapFormat(parseMode: SendMessageOptions["parse_mode"]): "html" | "markdown" | undefined {
  if (parseMode === "HTML") {
    return "html";
  }
  if (parseMode === "Markdown" || parseMode === "MarkdownV2") {
    return "markdown";
  }
  return undefined;
}

function buildSendExtra(options?: SendMessageOptions): MaxSendExtra {
  const extra: MaxSendExtra = {};
  const format = mapFormat(options?.parse_mode);
  if (format) {
    extra.format = format;
  }
  if (options?.disable_notification !== undefined) {
    extra.notify = !options.disable_notification;
  }
  if (options?.link_preview_options?.is_disabled || options?.disable_web_page_preview) {
    extra.disable_link_preview = true;
  }
  if (options?.reply_parameters?.message_id) {
    extra.link = { type: "reply", mid: options.reply_parameters.message_id };
  }
  const attachment = toAttachment(options?.reply_markup);
  if (attachment) {
    extra.attachments = [attachment];
  }
  return extra;
}

export class InlineKeyboard {
  inline_keyboard: InlineKeyboardButton[][] = [];

  text(text: string, callbackData: string): this {
    this.ensureRow().push({ text, callback_data: callbackData });
    return this;
  }

  url(text: string, url: string): this {
    this.ensureRow().push({ text, url });
    return this;
  }

  row(): this {
    this.inline_keyboard.push([]);
    return this;
  }

  toAttachment(): MaxApiTypes.AttachmentRequest | null {
    const rows = this.inline_keyboard.filter((row) => row.length > 0);
    if (rows.length === 0) {
      return null;
    }
    return {
      type: "inline_keyboard",
      payload: {
        buttons: rows.map((row) =>
          row.map((button) => {
            if (button.url) {
              return { type: "link" as const, text: button.text, url: button.url };
            }
            return {
              type: "callback" as const,
              text: button.text,
              payload: button.callback_data ?? button.text,
            };
          }),
        ),
      },
    };
  }

  private ensureRow(): InlineKeyboardButton[] {
    if (this.inline_keyboard.length === 0) {
      this.inline_keyboard.push([]);
    }
    const row = this.inline_keyboard[this.inline_keyboard.length - 1];
    if (!row) {
      const created: InlineKeyboardButton[] = [];
      this.inline_keyboard.push(created);
      return created;
    }
    return row;
  }
}

/**
 * MAX has no MAX-style persistent reply keyboard. The same buttons are
 * delivered as an inline keyboard whose buttons send their own label as text,
 * which the message router already understands.
 */
export class Keyboard {
  private readonly rows: InlineKeyboardButton[][] = [];

  text(text: string): this {
    if (this.rows.length === 0) {
      this.rows.push([]);
    }
    const row = this.rows[this.rows.length - 1];
    if (row) {
      row.push({ text });
    }
    return this;
  }

  row(): this {
    this.rows.push([]);
    return this;
  }

  resized(): this {
    return this;
  }

  persistent(): this {
    return this;
  }

  oneTime(): this {
    return this;
  }

  placeholder(): this {
    return this;
  }

  get inline_keyboard(): InlineKeyboardButton[][] {
    return this.rows;
  }

  /** MAX-shaped alias kept for callers that inspect the button grid. */
  get keyboard(): InlineKeyboardButton[][] {
    return this.rows;
  }

  get resize_keyboard(): boolean {
    return true;
  }

  get is_persistent(): boolean {
    return true;
  }

  get one_time_keyboard(): boolean {
    return false;
  }

  toAttachment(): MaxApiTypes.AttachmentRequest | null {
    const rows = this.rows.filter((row) => row.length > 0);
    if (rows.length === 0) {
      return null;
    }
    return {
      type: "inline_keyboard",
      payload: {
        buttons: rows.map((row) =>
          row.map((button) => ({ type: "message" as const, text: button.text })),
        ),
      },
    };
  }
}

export type BotError = Error & { ctx?: Context };

export interface BotInfo {
  id: number;
  is_bot: true;
  first_name: string;
  username?: string;
}

export interface File {
  file_id: string;
  file_path?: string;
  file_size?: number;
}

export interface WebhookInfo {
  url: string;
  pending_update_count: number;
}

export interface ApiConfig {
  use(
    transformer: (
      prev: (method: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>,
      method: string,
      payload: unknown,
      signal?: AbortSignal,
    ) => Promise<unknown>,
  ): void;
}

export class Api {
  readonly max: MaxApiClass;
  readonly config: ApiConfig;
  private transformer:
    | ((
        prev: (method: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>,
        method: string,
        payload: unknown,
        signal?: AbortSignal,
      ) => Promise<unknown>)
    | null = null;
  private readonly dialogIds = new Set<number>();

  constructor(max: MaxApiClass) {
    this.max = max;
    this.config = {
      use: (transformer) => {
        this.transformer = transformer;
      },
    };
  }

  registerDialogId(id: number): void {
    this.dialogIds.add(id);
  }

  async getMe(): Promise<BotInfo> {
    const info = await this.max.getMyInfo();
    const result: BotInfo = {
      id: info.user_id,
      is_bot: true,
      first_name: info.first_name,
    };
    if (info.username) result.username = info.username;
    return result;
  }

  async getWebhookInfo(): Promise<WebhookInfo> {
    return { url: "", pending_update_count: 0 };
  }

  async deleteWebhook(): Promise<boolean> {
    return true;
  }

  async setMyCommands(commands: BotCommand[], _options?: unknown): Promise<void> {
    if (commands.length === 0) {
      await this.call("deleteMyCommands", {});
      return;
    }
    await this.call("setMyCommands", {
      commands: commands.map((command) => ({
        name: command.command,
        description: command.description,
      })),
    });
  }

  async sendMessage(chatId: number, text: string, options?: SendMessageOptions): Promise<Message> {
    const extra = buildSendExtra(options);
    const message = await this.makeMessage(chatId, text, extra);
    return toMessage(message);
  }

  async editMessageText(
    _chatId: number,
    messageId: MessageId,
    text: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    const extra = buildSendExtra(options);
    const body: Record<string, unknown> = { text };
    if (extra.format) body.format = extra.format;
    if (extra.disable_link_preview) body.disable_link_preview = true;
    if (extra.attachments) body.attachments = extra.attachments;
    await this.call("editMessage", { messageId, body });
  }

  async editMessageReplyMarkup(
    _chatId: number,
    messageId: MessageId,
    options?: SendMessageOptions,
  ): Promise<void> {
    const attachment = toAttachment(options?.reply_markup);
    await this.call("editMessage", {
      messageId,
      body: { attachments: attachment ? [attachment] : [] },
    });
  }

  async deleteMessage(_chatId: number, messageId: MessageId): Promise<void> {
    await this.call("deleteMessage", { messageId });
  }

  async sendDocument(chatId: number, file: InputFile, options?: SendMessageOptions): Promise<void> {
    const uploaded = await this.uploadWithName(file, "document");
    const attachment: MaxApiTypes.AttachmentRequest = {
      type: "file",
      payload: { token: uploaded.token },
    };
    const text = options?.caption ?? "";
    await this.makeMessage(chatId, text, {
      ...buildSendExtra(options),
      attachments: [attachment],
    });
  }

  async sendAudio(chatId: number, file: InputFile, options?: SendMessageOptions): Promise<void> {
    const uploaded = await this.uploadWithName(file, "audio");
    const attachment: MaxApiTypes.AttachmentRequest = {
      type: "audio",
      payload: { token: uploaded.token },
    };
    await this.makeMessage(chatId, options?.caption ?? "", {
      ...buildSendExtra(options),
      attachments: [attachment],
    });
  }

  async sendPhoto(
    chatId: number,
    file: InputFile | string,
    options?: SendMessageOptions,
  ): Promise<void> {
    const uploaded =
      typeof file === "string"
        ? await this.max.upload.image({ url: file })
        : await this.max.upload.image({ source: file.buffer });
    const attachment: MaxApiTypes.AttachmentRequest =
      "url" in uploaded
        ? { type: "image", payload: { url: uploaded.url } }
        : { type: "image", payload: { photos: uploaded.photos } };
    await this.makeMessage(chatId, options?.caption ?? "", {
      ...buildSendExtra(options),
      attachments: [attachment],
    });
  }

  async sendChatAction(chatId: number, _action: string): Promise<void> {
    try {
      await this.max.sendAction(chatId, "typing_on");
    } catch {
      // MAX documents typing as a group-chat action; dialogs may not support it.
    }
  }

  async pinChatMessage(
    chatId: number,
    messageId: MessageId,
    _options?: unknown,
  ): Promise<void> {
    try {
      await this.call("pinMessage", { chatId, messageId });
    } catch {
      // MAX pins only in group chats/channels where the bot is an admin. A DM
      // dashboard still exists as a normal message that is edited in place.
    }
  }

  async unpinChatMessage(chatId: number, _messageId?: MessageId): Promise<void> {
    try {
      await this.call("unpinMessage", { chatId });
    } catch {
      // Nothing to unpin in a dialog.
    }
  }

  async getFile(fileId: string): Promise<File> {
    const url = decodeFileId(fileId);
    if (!url) {
      throw new Error("Unsupported MAX file id");
    }
    return { file_id: fileId, file_path: url };
  }

  private async makeMessage(
    chatId: number,
    text: string,
    extra: MaxSendExtra,
  ): Promise<MaxMessage> {
    if (this.dialogIds.has(chatId)) {
      return this.call("sendMessageToUser", { userId: chatId, text, extra });
    }
    return this.call("sendMessageToChat", { chatId, text, extra });
  }

  private async call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    const base = (name: string, data: unknown): Promise<unknown> => this.dispatch(name, data);
    if (this.transformer) {
      return (await this.transformer(base, method, payload)) as T;
    }
    return (await base(method, payload)) as T;
  }

  private async uploadWithName(
    file: InputFile,
    kind: "document" | "audio",
  ): Promise<{ token: string }> {
    // The SDK derives a buffer upload name from a random UUID. A temporary file
    // keeps the original filename on the MAX attachment and is removed at once.
    const dir = await mkdtemp(join(tmpdir(), "opencode-max-upload-"));
    const path = join(dir, file.filename || "upload.bin");
    try {
      await writeFile(path, file.buffer);
      return kind === "document"
        ? await this.max.upload.file({ source: path })
        : await this.max.upload.audio({ source: path });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async dispatch(method: string, payload: unknown): Promise<unknown> {
    switch (method) {
      case "sendMessageToUser": {
        const data = payload as { userId: number; text: string; extra: MaxSendExtra };
        const message = await this.max.sendMessageToUser(data.userId, data.text, data.extra);
        return message;
      }
      case "sendMessageToChat": {
        const data = payload as { chatId: number; text: string; extra: MaxSendExtra };
        const message = await this.max.sendMessageToChat(data.chatId, data.text, data.extra);
        return message;
      }
      case "editMessage": {
        const data = payload as { messageId: string; body: MaxEditBody };
        return this.max.editMessage(data.messageId, data.body);
      }
      case "deleteMessage": {
        const data = payload as { messageId: string };
        return this.max.deleteMessage(data.messageId);
      }
      case "pinMessage": {
        const data = payload as { chatId: number; messageId: string };
        return this.max.pinMessage(data.chatId, data.messageId);
      }
      case "unpinMessage": {
        const data = payload as { chatId: number };
        return this.max.unpinMessage(data.chatId);
      }
      case "setMyCommands": {
        const commands = (payload as { commands: MaxApiTypes.BotCommand[] }).commands;
        return this.max.setMyCommands(commands);
      }
      case "deleteMyCommands":
        return this.max.deleteMyCommands();
      default:
        throw new Error(`Unsupported MAX API method: ${method}`);
    }
  }
}

export class Context<U extends MaxUpdate = MaxUpdate> {
  readonly update: U & { update_id?: number };
  readonly api: Api;
  readonly botInfo: BotInfo | undefined;
  message!: Message;
  callbackQuery!: CallbackQuery;
  chat!: Chat;
  from: User | undefined;
  me!: BotInfo;
  match: string | RegExpExecArray | undefined;
  msg!: Message;

  constructor(update: U, apiOrBotInfo: Api | BotInfo | undefined, botInfo?: BotInfo) {
    this.update = update as U & { update_id?: number };
    if (apiOrBotInfo instanceof Api) {
      this.api = apiOrBotInfo;
      this.botInfo = botInfo;
    } else {
      throw new Error("Context requires an Api instance");
    }
    this.me = this.botInfo as BotInfo;

    this.normalize();
  }

  private normalize(): void {
    const update = this.update;

    if (update.update_type === "message_created" || update.update_type === "message_edited") {
      const raw = (update as MessageCreatedUpdate).message;
      this.message = toMessage(raw);
      this.msg = this.message;
      this.chat = this.message.chat;
      this.from = this.message.from;
      this.api.registerDialogId(this.chat.id);
      return;
    }

    if (update.update_type === "message_callback") {
      const callbackUpdate = update as MessageCallbackUpdate;
      if (callbackUpdate.message) {
        this.message = toMessage(callbackUpdate.message);
        this.msg = this.message;
        this.chat = this.message.chat;
        this.api.registerDialogId(this.chat.id);
      }
      const from = toUser(callbackUpdate.callback.user);
      this.from = from ?? this.message?.from;
      this.callbackQuery = {
        id: callbackUpdate.callback.callback_id,
        from: from ?? { id: 0, is_bot: false, first_name: "" },
        chat_instance: "",
        ...(callbackUpdate.callback.payload ? { data: callbackUpdate.callback.payload } : {}),
        ...(this.message ? { message: this.message } : {}),
      };
      return;
    }

    if ("chat_id" in update && typeof update.chat_id === "number") {
      this.chat = { id: update.chat_id, type: "private" };
    }
    if ("user" in update) {
      this.from = toUser(update.user);
    }
  }

  async reply(text: string, extra?: SendMessageOptions): Promise<Message> {
    const chatId = this.chat?.id;
    if (chatId === undefined) {
      throw new Error("Cannot reply without a chat");
    }
    return this.api.sendMessage(chatId, text, extra);
  }

  async editMessageText(
    chatId: number,
    messageId: string,
    text: string,
    extra?: SendMessageOptions,
  ): Promise<unknown>;
  async editMessageText(text: string): Promise<unknown>;
  async editMessageText(text: string, extra?: SendMessageOptions): Promise<unknown>;
  async editMessageText(
    textOrChatId: string | number,
    textOrMessageId?: string | SendMessageOptions,
    textOrOptions?: string | SendMessageOptions,
    extra?: SendMessageOptions,
  ): Promise<unknown> {
    const chatId = this.chat.id;

    if (typeof textOrChatId === "number") {
      await this.api.editMessageText(
        chatId,
        String(textOrMessageId ?? ""),
        String(textOrOptions ?? ""),
        extra,
      );
      return;
    }

    if (typeof textOrMessageId === "string") {
      await this.api.editMessageText(
        chatId,
        textOrMessageId,
        textOrChatId,
        textOrOptions as SendMessageOptions | undefined,
      );
      return;
    }

    if (!this.message?.message_id) {
      throw new Error("Cannot edit message without a message");
    }
    await this.api.editMessageText(chatId, this.message.message_id, textOrChatId, textOrMessageId);
  }

  async editMessageReplyMarkup(options?: SendMessageOptions): Promise<unknown> {
    if (!this.message?.message_id) {
      throw new Error("Cannot edit reply markup without a message");
    }
    await this.api.editMessageReplyMarkup(this.chat?.id ?? 0, this.message.message_id, options);
    return undefined;
  }

  async deleteMessage(messageId?: MessageId): Promise<unknown> {
    const id = messageId ?? this.message?.message_id;
    if (!id) {
      throw new Error("Cannot delete message without an id");
    }
    await this.api.deleteMessage(this.chat?.id ?? 0, id);
    return undefined;
  }

  async answerCallbackQuery(extra?: {
    text?: string;
    show_alert?: boolean;
    url?: string;
    cache_time?: number;
  }): Promise<unknown> {
    if (!this.callbackQuery) {
      return undefined;
    }
    const payload: MaxCallbackAnswer = {};
    if (extra?.text) {
      payload.notification = extra.text;
    }
    await this.api.max.answerOnCallback(this.callbackQuery.id, payload);
    return undefined;
  }

  async replyWithDocument(file: InputFile, extra?: SendMessageOptions): Promise<unknown> {
    await this.api.sendDocument(this.chat?.id ?? 0, file, extra);
    return undefined;
  }
}

type Handler = (ctx: Context, next: NextFunction) => Promise<void> | void;

function parseCommand(text: string, name: string): RegExpExecArray | null {
  const match = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(text);
  if (!match || match[1] !== name) {
    return null;
  }
  return match;
}

function matchesFilter(filter: Filter, ctx: Context): boolean {
  if (typeof filter === "function") {
    return filter(ctx);
  }

  if (filter instanceof RegExp) {
    return filter.test(ctx.message?.text ?? "");
  }

  const [scope, subtype] = filter.split(":") as [string, string | undefined];
  if (scope === "callback_query") {
    return ctx.callbackQuery !== undefined;
  }
  if (scope !== "message") {
    return false;
  }
  if (!ctx.message) {
    return false;
  }
  switch (subtype) {
    case undefined:
      return true;
    case "text":
      return (ctx.message.text ?? "").length > 0 && ctx.message.photo === undefined && ctx.message.document === undefined && ctx.message.voice === undefined && ctx.message.audio === undefined;
    case "voice":
      return ctx.message.voice !== undefined;
    case "audio":
      return ctx.message.audio !== undefined;
    case "photo":
      return ctx.message.photo !== undefined;
    case "document":
      return ctx.message.document !== undefined;
    default:
      return false;
  }
}

export class Bot<C extends Context = Context> {
  readonly max: MaxBot;
  readonly api: Api;
  botInfo: BotInfo | undefined;
  private readonly stack: Handler[] = [];
  private errorHandler: ((error: unknown, ctx: Context) => Promise<void> | void) | null = null;

  constructor(token: string, _options?: unknown) {
    this.max = new MaxBot(token);
    this.api = new Api(this.max.api);

    this.max.use(async (maxCtx, next) => {
      const ctx = normalizeUpdate(maxCtx.update, this.api, this.botInfo) as C;
      ctx.api.registerDialogId(ctx.chat?.id ?? 0);
      await this.run(ctx as Context);
      await next();
    });

    this.max.catch((error, maxCtx) => {
      const ctx = normalizeUpdate(maxCtx.update, this.api, this.botInfo);
      return this.errorHandler?.(error, ctx);
    });
  }

  use(middleware: Middleware<Context>): this {
    this.stack.push(async (ctx, next) => {
      await middleware(ctx, next);
    });
    return this;
  }

  on(filter: Filter, handler: Handler): this {
    this.stack.push(async (ctx, next) => {
      if (!matchesFilter(filter, ctx)) {
        await next();
        return;
      }
      await this.invoke(handler, ctx, next);
    });
    return this;
  }

  command(name: string, handler: Handler): this {
    this.stack.push(async (ctx, next) => {
      const text = ctx.message?.text;
      const match = text ? parseCommand(text, name) : null;
      if (!match) {
        await next();
        return;
      }
      ctx.match = match[2] ?? "";
      await this.invoke(handler, ctx, next);
    });
    return this;
  }

  hears(pattern: string | RegExp, handler: Handler): this {
    this.stack.push(async (ctx, next) => {
      const text = ctx.message?.text;
      if (text === undefined) {
        await next();
        return;
      }
      if (typeof pattern === "string") {
        if (text !== pattern) {
          await next();
          return;
        }
        ctx.match = undefined;
      } else {
        const match = pattern.exec(text);
        if (!match) {
          await next();
          return;
        }
        ctx.match = match;
      }
      await this.invoke(handler, ctx, next);
    });
    return this;
  }

  catch(handler: (error: BotError, ctx: Context) => Promise<void> | void): this {
    this.errorHandler = handler as (error: unknown, ctx: Context) => Promise<void> | void;
    return this;
  }

  async start(options?: {
    drop_pending_updates?: boolean;
    onStart?: (botInfo: BotInfo) => void;
  }): Promise<void> {
    const info = await this.api.getMe();
    this.botInfo = info;
    options?.onStart?.(info);
    await this.max.startPolling({ retry: true });
  }

  stop(): void {
    this.max.stopPolling();
  }

  private async invoke(handler: Handler, ctx: Context, next: NextFunction): Promise<void> {
    if (handler.length >= 2) {
      await handler(ctx, next);
      return;
    }
    await handler(ctx, async () => {});
  }

  private async run(ctx: Context): Promise<void> {
    let index = -1;
    const dispatch = async (position: number): Promise<void> => {
      if (position <= index) {
        throw new Error("next() called multiple times");
      }
      index = position;
      const middleware = this.stack[position];
      if (!middleware) {
        return;
      }
      await middleware(ctx, () => dispatch(position + 1));
    };
    await dispatch(0);
  }
}

export type { MaxApiTypes };
