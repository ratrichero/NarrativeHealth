// RADAR-TG P4 — bot tự phục vụ (webhook Telegram).
//
// Kênh/group của người dùng thêm bot rồi gửi /start để đăng ký nhận alert
// Radar, /stop để tắt, /settings để xem trạng thái. Ba lớp an toàn:
//   1. Webhook bắt buộc header `X-Telegram-Bot-Api-Secret-Token` khớp
//      TELEGRAM_WEBHOOK_SECRET (timing-safe, fail-closed khi chưa set).
//   2. Rate limit theo chat (mặc định 5 lệnh/phút) chặn spam/loop.
//   3. Chỉ ba lệnh trên được xử lý; nội dung khác bỏ qua.
//
// Tách khỏi alert delivery: bot chỉ đọc/ghi `radar_subscribers`, không tự gửi
// alert — fan-out alert đọc các dòng ACTIVE như một kênh đích bình thường.

import { timingSafeEqual } from "node:crypto";
import { sendTelegramMessage } from "@/lib/services/alert-delivery.service";
import {
  clearRadarSubscriberMinScore,
  readRadarSubscriber,
  setRadarSubscriberMinScore,
  stopRadarSubscriber,
  upsertRadarSubscriber,
  type RadarSubscriber,
} from "./subscribers";

export const TELEGRAM_WEBHOOK_SECRET_ENV = "TELEGRAM_WEBHOOK_SECRET";
export const TELEGRAM_BOT_RATE_LIMIT_ENV = "TELEGRAM_BOT_RATE_LIMIT_PER_MINUTE";
export const TELEGRAM_WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";
export const DEFAULT_BOT_RATE_LIMIT_PER_MINUTE = 5;
export const BOT_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * So sánh timing-safe header `secret_token` của Telegram với env.
 * Fail-closed: chưa set env hoặc thiếu header → false (không có chế độ mở).
 */
export function verifyTelegramWebhookSecret(
  got: string | null | undefined,
  expected: string | null | undefined = process.env[TELEGRAM_WEBHOOK_SECRET_ENV]
): boolean {
  const secret = (expected ?? "").trim();
  if (!secret || !got) return false;
  const a = Buffer.from(secret, "utf8");
  const b = Buffer.from(got, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Số lệnh tối đa/chat/phút; giá trị hỏng kẹp về mặc định. */
export function botRateLimitPerMinute(
  raw: string | undefined = process.env[TELEGRAM_BOT_RATE_LIMIT_ENV]
): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_BOT_RATE_LIMIT_PER_MINUTE;
  return Math.min(60, Math.floor(value));
}

export interface ChatRateLimiter {
  allow: (chatId: string, now?: number) => boolean;
  reset: (chatId?: string) => void;
}

/**
 * Sliding window trong bộ nhớ, mỗi chat một hàng đợi timestamp. Đủ để chặn
 * spam lệnh (bot chạy một instance pm2); alert thật đi qua outbox riêng.
 */
export function createChatRateLimiter(
  options: { limit?: number; windowMs?: number } = {}
): ChatRateLimiter {
  const limit = Math.max(1, options.limit ?? botRateLimitPerMinute());
  const windowMs = options.windowMs ?? BOT_RATE_LIMIT_WINDOW_MS;
  const hits = new Map<string, number[]>();

  return {
    allow(chatId, now = Date.now()) {
      const cutoff = now - windowMs;
      const recent = (hits.get(chatId) ?? []).filter((at) => at > cutoff);
      if (recent.length >= limit) {
        hits.set(chatId, recent);
        return false;
      }
      recent.push(now);
      hits.set(chatId, recent);
      return true;
    },
    reset(chatId) {
      if (chatId) hits.delete(chatId);
      else hits.clear();
    },
  };
}

let sharedLimiter: ChatRateLimiter | null = null;

function defaultBotRateLimiter(): ChatRateLimiter {
  if (!sharedLimiter) sharedLimiter = createChatRateLimiter();
  return sharedLimiter;
}

export interface ParsedBotCommand {
  command: string;
  args: string;
}

/** `/settings reset` hoặc `/settings auto` → xoá ngưỡng riêng. */
export function isMinScoreResetArg(args: string): boolean {
  const raw = args.trim().toLowerCase();
  return raw === "reset" || raw === "auto";
}

/**
 * `/settings <score>`: chỉ nhận một số nguyên 0–100 (không dấu, không thập
 * phân). Trả null khi sai để handler phản hồi cú pháp, không ghi DB.
 */
export function parseMinScoreArg(args: string): number | null {
  const raw = args.trim();
  if (!/^(0|[1-9]\d{0,2})$/.test(raw)) return null;
  const score = Number(raw);
  return score >= 0 && score <= 100 ? score : null;
}

/** `/start`, `/start@BotName`, `/settings 80` → {command, args}. */
export function parseBotCommand(text: string): ParsedBotCommand | null {
  const match = /^\/([A-Za-z0-9_]{1,32})(?:@[A-Za-z0-9_]{1,64})?(?:\s+([\s\S]*))?$/.exec(
    text.trim()
  );
  if (!match) return null;
  return { command: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
}

export interface TelegramBotMessage {
  chatId: string;
  /** 0 = chat không có topic. */
  threadId: number;
  chatType: string | null;
  title: string | null;
  telegramUserId: string | null;
  text: string;
}

/** Lấy message/channel_post đủ trường; thiếu chat id → null. */
export function extractBotMessage(update: unknown): TelegramBotMessage | null {
  const root = update as { message?: unknown; channel_post?: unknown } | null;
  const message = (root?.message ?? root?.channel_post) as
    | {
        text?: unknown;
        message_thread_id?: unknown;
        chat?: { id?: unknown; type?: unknown; title?: unknown; username?: unknown };
        from?: { id?: unknown };
      }
    | undefined;
  if (!message || typeof message.text !== "string") return null;

  const rawChatId = message.chat?.id;
  const chatId = typeof rawChatId === "number" || typeof rawChatId === "string" ? String(rawChatId) : "";
  if (!/^-?\d{1,20}$/.test(chatId)) return null;

  const thread = Number(message.message_thread_id);
  return {
    chatId,
    threadId: Number.isInteger(thread) && thread > 0 ? thread : 0,
    chatType: typeof message.chat?.type === "string" ? message.chat.type : null,
    title:
      typeof message.chat?.title === "string"
        ? message.chat.title
        : typeof message.chat?.username === "string"
          ? message.chat.username
          : null,
    telegramUserId:
      typeof message.from?.id === "number" || typeof message.from?.id === "string"
        ? String(message.from.id)
        : null,
    text: message.text,
  };
}

export interface TelegramBotDeps {
  upsert: typeof upsertRadarSubscriber;
  stop: typeof stopRadarSubscriber;
  read: typeof readRadarSubscriber;
  setMinScore: typeof setRadarSubscriberMinScore;
  clearMinScore: typeof clearRadarSubscriberMinScore;
  reply: (chatId: string, threadId: number, text: string) => Promise<boolean>;
}

export function telegramBotDeps(): TelegramBotDeps {
  return {
    upsert: upsertRadarSubscriber,
    stop: stopRadarSubscriber,
    read: readRadarSubscriber,
    setMinScore: setRadarSubscriberMinScore,
    clearMinScore: clearRadarSubscriberMinScore,
    reply: (chatId, threadId, text) =>
      sendTelegramMessage({
        chatId,
        ...(threadId > 0 ? { threadId } : {}),
        text,
      }),
  };
}

export interface BotHandleResult {
  handled: boolean;
  command?: string;
  rateLimited?: boolean;
}

function whereLabel(chatId: string, threadId: number): string {
  return threadId > 0 ? `chat ${chatId} / topic ${threadId}` : `chat ${chatId}`;
}

function statusLabel(subscriber: RadarSubscriber | null): string {
  if (!subscriber) return "chưa đăng ký";
  return subscriber.status === "ACTIVE" ? "đang bật" : "đang tắt";
}

/**
 * Xử lý một update đã qua xác thực secret. `deps`/`limiter` inject để test.
 * Luôn trả 200 ở route: Telegram retry non-2xx sẽ lặp lệnh.
 */
export async function handleTelegramUpdate(
  update: unknown,
  deps: TelegramBotDeps = telegramBotDeps(),
  limiter: ChatRateLimiter = defaultBotRateLimiter()
): Promise<BotHandleResult> {
  const message = extractBotMessage(update);
  if (!message) return { handled: false };

  const parsed = parseBotCommand(message.text);
  if (!parsed) return { handled: false };

  if (!limiter.allow(message.chatId)) {
    return { handled: true, command: parsed.command, rateLimited: true };
  }

  const { chatId, threadId } = message;

  if (parsed.command === "start") {
    const subscriber = await deps.upsert({
      chatId,
      threadId,
      chatType: message.chatType,
      title: message.title,
      telegramUserId: message.telegramUserId,
    });
    await deps.reply(
      chatId,
      threadId,
      [
        `✅ Đã bật cảnh báo Radar cho ${whereLabel(chatId, threadId)}.`,
        subscriber?.minScore != null
          ? `Ngưỡng riêng: score ≥ ${subscriber.minScore}.`
          : "Dùng ngưỡng alert chung của hệ thống.",
        "",
        "/settings — xem trạng thái",
        "/stop — tắt cảnh báo",
        "Không phải khuyến nghị đầu tư.",
      ].join("\n")
    );
    return { handled: true, command: "start" };
  }

  if (parsed.command === "stop") {
    const subscriber = await deps.stop(chatId, threadId);
    await deps.reply(
      chatId,
      threadId,
      subscriber
        ? `🛑 Đã tắt cảnh báo Radar cho ${whereLabel(chatId, threadId)}. Gửi /start để bật lại.`
        : `Chat này chưa đăng ký nhận cảnh báo Radar. Gửi /start để bật.`
    );
    return { handled: true, command: "stop" };
  }

  if (parsed.command === "settings") {
    if (isMinScoreResetArg(parsed.args)) {
      const existing = await deps.read(chatId, threadId);
      if (!existing) {
        await deps.reply(
          chatId,
          threadId,
          "Chat này chưa đăng ký nhận cảnh báo Radar. Gửi /start trước, rồi /settings reset."
        );
        return { handled: true, command: "settings" };
      }
      if (existing.minScore == null) {
        await deps.reply(
          chatId,
          threadId,
          `ℹ️ ${whereLabel(chatId, threadId)} đang dùng ngưỡng alert chung (chưa có ngưỡng riêng).`
        );
        return { handled: true, command: "settings" };
      }

      const cleared = await deps.clearMinScore(chatId, threadId);
      await deps.reply(
        chatId,
        threadId,
        cleared
          ? `✅ Đã xoá ngưỡng riêng cho ${whereLabel(chatId, threadId)}; quay lại ngưỡng alert chung. /settings để xem lại.`
          : `Chat này chưa đăng ký nhận cảnh báo Radar. Gửi /start trước, rồi /settings reset.`
      );
      return { handled: true, command: "settings" };
    }

    if (parsed.args) {
      const minScore = parseMinScoreArg(parsed.args);
      if (minScore === null) {
        await deps.reply(
          chatId,
          threadId,
          "⚠️ Ngưỡng phải là số nguyên 0–100, hoặc /settings reset để về ngưỡng chung. Ví dụ: /settings 80"
        );
        return { handled: true, command: "settings" };
      }

      const subscriber = await deps.setMinScore(chatId, threadId, minScore);
      await deps.reply(
        chatId,
        threadId,
        subscriber
          ? `✅ Đã đặt ngưỡng score ≥ ${minScore} cho ${whereLabel(chatId, threadId)}. /settings để xem lại.`
          : "Chat này chưa đăng ký nhận cảnh báo Radar. Gửi /start trước, rồi /settings <0–100>."
      );
      return { handled: true, command: "settings" };
    }

    const subscriber = await deps.read(chatId, threadId);
    await deps.reply(
      chatId,
      threadId,
      [
        `⚙️ Cảnh báo Radar — ${statusLabel(subscriber)}`,
        `Kênh: ${whereLabel(chatId, threadId)}`,
        subscriber?.minScore != null
          ? `Ngưỡng riêng: score ≥ ${subscriber.minScore}`
          : "Ngưỡng: dùng cấu hình chung",
        "Đặt ngưỡng riêng: /settings <0–100>",
        "Xoá ngưỡng riêng: /settings reset",
        "",
        subscriber ? "/stop — tắt cảnh báo" : "/start — bật cảnh báo",
      ].join("\n")
    );
    return { handled: true, command: "settings" };
  }

  return { handled: false, command: parsed.command };
}
