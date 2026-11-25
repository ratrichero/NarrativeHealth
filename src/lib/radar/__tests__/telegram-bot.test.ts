// RADAR-TG P4: xác thực secret webhook và rate limit theo chat.

import { describe, expect, it, jest } from "@jest/globals";
import {
  createChatRateLimiter,
  extractBotMessage,
  handleTelegramUpdate,
  parseBotCommand,
  parseMinScoreArg,
  verifyTelegramWebhookSecret,
  type TelegramBotDeps,
} from "@/lib/radar/bot";
import type { RadarSubscriber, RadarSubscriberUpsert } from "@/lib/radar/subscribers";

jest.mock("@/db", () => ({ db: {} }));

function update(text: string, options: { chatId?: number; threadId?: number } = {}) {
  return {
    update_id: 1,
    message: {
      text,
      chat: { id: options.chatId ?? -1001234567890, type: "supergroup", title: "Radar VIP" },
      from: { id: 42 },
      ...(options.threadId !== undefined ? { message_thread_id: options.threadId } : {}),
    },
  };
}

function subscriber(overrides: Partial<RadarSubscriber> = {}): RadarSubscriber {
  return {
    id: 1,
    chatId: "-1001234567890",
    threadId: 0,
    chatType: "supergroup",
    title: "Radar VIP",
    telegramUserId: "42",
    status: "ACTIVE",
    minScore: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function fakeDeps() {
  const upsert = jest.fn(
    async (input: RadarSubscriberUpsert): Promise<RadarSubscriber | null> =>
      subscriber({
        chatId: input.chatId,
        threadId: input.threadId ?? 0,
        chatType: input.chatType ?? null,
        title: input.title ?? null,
        telegramUserId: input.telegramUserId ?? null,
      })
  );
  const stop = jest.fn(
    async (_chatId: string, _threadId = 0): Promise<RadarSubscriber | null> =>
      subscriber({ status: "STOPPED" })
  );
  const read = jest.fn(
    async (_chatId: string, _threadId = 0): Promise<RadarSubscriber | null> => null
  );
  const setMinScore = jest.fn(
    async (
      _chatId: string,
      _threadId: number | undefined,
      minScore: number
    ): Promise<RadarSubscriber | null> => subscriber({ minScore })
  );
  const clearMinScore = jest.fn(
    async (_chatId: string, _threadId = 0): Promise<RadarSubscriber | null> =>
      subscriber({ minScore: null })
  );
  const reply = jest.fn(async (_chatId: string, _threadId: number, _text: string) => true);

  const deps: TelegramBotDeps = { upsert, stop, read, setMinScore, clearMinScore, reply };
  return { deps, upsert, stop, read, setMinScore, clearMinScore, reply };
}

describe("verifyTelegramWebhookSecret", () => {
  it("chỉ chấp nhận khi header khớp env (timing-safe)", () => {
    expect(verifyTelegramWebhookSecret("s3cret-token", "s3cret-token")).toBe(true);
    expect(verifyTelegramWebhookSecret("s3cret-token", "other-token")).toBe(false);
    expect(verifyTelegramWebhookSecret("short", "s3cret-token")).toBe(false);
    expect(verifyTelegramWebhookSecret("s3cret-token-x", "s3cret-token")).toBe(false);
  });

  it("fail-closed: thiếu header hoặc chưa set env đều từ chối", () => {
    expect(verifyTelegramWebhookSecret(null, "s3cret-token")).toBe(false);
    expect(verifyTelegramWebhookSecret("", "s3cret-token")).toBe(false);
    expect(verifyTelegramWebhookSecret("s3cret-token", null)).toBe(false);
    expect(verifyTelegramWebhookSecret("s3cret-token", "")).toBe(false);
    expect(verifyTelegramWebhookSecret("s3cret-token", "   ")).toBe(false);
  });
});

describe("createChatRateLimiter", () => {
  it("chặn sau limit lệnh trong cửa sổ, mỗi chat độc lập", () => {
    const limiter = createChatRateLimiter({ limit: 3, windowMs: 60_000 });
    const t0 = 1_000_000;

    expect(limiter.allow("chat-a", t0)).toBe(true);
    expect(limiter.allow("chat-a", t0 + 1)).toBe(true);
    expect(limiter.allow("chat-a", t0 + 2)).toBe(true);
    expect(limiter.allow("chat-a", t0 + 3)).toBe(false);

    // Chat khác không bị ảnh hưởng.
    expect(limiter.allow("chat-b", t0 + 3)).toBe(true);

    // Hết cửa sổ thì mở lại.
    expect(limiter.allow("chat-a", t0 + 60_001)).toBe(true);
  });

  it("reset xoá bộ đếm của một chat hoặc toàn bộ", () => {
    const limiter = createChatRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.allow("chat-a", 1)).toBe(true);
    expect(limiter.allow("chat-a", 2)).toBe(false);

    limiter.reset("chat-a");
    expect(limiter.allow("chat-a", 3)).toBe(true);

    limiter.reset();
    expect(limiter.allow("chat-b", 4)).toBe(true);
  });
});

describe("parseBotCommand", () => {
  it("nhận /start, /start@Bot, /settings kèm args", () => {
    expect(parseBotCommand("/start")).toEqual({ command: "start", args: "" });
    expect(parseBotCommand("/start@NarrativeHealthBot")).toEqual({ command: "start", args: "" });
    expect(parseBotCommand("/settings 80")).toEqual({ command: "settings", args: "80" });
    expect(parseBotCommand("  /STOP  ")).toEqual({ command: "stop", args: "" });
  });

  it("text thường hoặc lệnh rỗng → null", () => {
    expect(parseBotCommand("hello")).toBeNull();
    expect(parseBotCommand("/")).toBeNull();
    expect(parseBotCommand("")).toBeNull();
  });
});

describe("parseMinScoreArg", () => {
  it("nhận số nguyên 0–100", () => {
    expect(parseMinScoreArg("0")).toBe(0);
    expect(parseMinScoreArg("79")).toBe(79);
    expect(parseMinScoreArg("100")).toBe(100);
    expect(parseMinScoreArg("  85  ")).toBe(85);
  });

  it("từ chối ngoài khoảng, thập phân, chữ, nhiều token", () => {
    expect(parseMinScoreArg("101")).toBeNull();
    expect(parseMinScoreArg("-1")).toBeNull();
    expect(parseMinScoreArg("80.5")).toBeNull();
    expect(parseMinScoreArg("abc")).toBeNull();
    expect(parseMinScoreArg("1e2")).toBeNull();
    expect(parseMinScoreArg("80 90")).toBeNull();
    expect(parseMinScoreArg("")).toBeNull();
  });
});

describe("extractBotMessage", () => {
  it("lấy chat/topic/title; thiếu chat id hợp lệ → null", () => {
    expect(extractBotMessage(update("/start", { threadId: 42 }))).toEqual({
      chatId: "-1001234567890",
      threadId: 42,
      chatType: "supergroup",
      title: "Radar VIP",
      telegramUserId: "42",
      text: "/start",
    });
    expect(extractBotMessage({ message: { text: "/start", chat: { id: "abc" } } })).toBeNull();
    expect(extractBotMessage({ edited_message: { text: "/start" } })).toBeNull();
  });
});

describe("handleTelegramUpdate", () => {
  it("/start đăng ký đúng chat/topic và trả lời hướng dẫn", async () => {
    const { deps, upsert, reply } = fakeDeps();

    const result = await handleTelegramUpdate(
      update("/start", { threadId: 42 }),
      deps,
      createChatRateLimiter({ limit: 5 })
    );

    expect(result).toEqual({ handled: true, command: "start" });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "-1001234567890",
        threadId: 42,
        chatType: "supergroup",
        title: "Radar VIP",
        telegramUserId: "42",
      })
    );
    expect(String(reply.mock.calls[0][2])).toContain("Đã bật cảnh báo Radar");
  });

  it("/stop tắt và trả lời; /settings phản ánh trạng thái chưa đăng ký", async () => {
    const stopped = fakeDeps();
    await handleTelegramUpdate(update("/stop"), stopped.deps, createChatRateLimiter({ limit: 5 }));
    expect(stopped.stop).toHaveBeenCalledWith("-1001234567890", 0);
    expect(String(stopped.reply.mock.calls[0][2])).toContain("Đã tắt cảnh báo Radar");

    const settings = fakeDeps();
    await handleTelegramUpdate(
      update("/settings"),
      settings.deps,
      createChatRateLimiter({ limit: 5 })
    );
    expect(settings.read).toHaveBeenCalledWith("-1001234567890", 0);
    expect(String(settings.reply.mock.calls[0][2])).toContain("chưa đăng ký");
  });

  it("/stop khi chat chưa đăng ký → báo chưa đăng ký, không nói đã tắt", async () => {
    const { deps, stop, reply } = fakeDeps();
    stop.mockResolvedValueOnce(null);

    const result = await handleTelegramUpdate(
      update("/stop"),
      deps,
      createChatRateLimiter({ limit: 5 })
    );

    expect(result).toEqual({ handled: true, command: "stop" });
    expect(stop).toHaveBeenCalledWith("-1001234567890", 0);
    const text = String(reply.mock.calls[0][2]);
    expect(text).toContain("chưa đăng ký");
    expect(text).not.toContain("Đã tắt");
  });

  it("/settings <score> hợp lệ → lưu đúng chat/topic và xác nhận", async () => {
    const { deps, setMinScore, reply } = fakeDeps();

    const result = await handleTelegramUpdate(
      update("/settings 80", { threadId: 42 }),
      deps,
      createChatRateLimiter({ limit: 5 })
    );

    expect(result).toEqual({ handled: true, command: "settings" });
    expect(setMinScore).toHaveBeenCalledWith("-1001234567890", 42, 80);
    expect(String(reply.mock.calls[0][2])).toContain("Đã đặt ngưỡng score ≥ 80");
  });

  it("/settings <score> không hợp lệ → không ghi DB, trả lời cú pháp", async () => {
    for (const args of ["101", "-1", "abc", "80.5", "80 90"]) {
      const { deps, setMinScore, reply } = fakeDeps();

      const result = await handleTelegramUpdate(
        update(`/settings ${args}`),
        deps,
        createChatRateLimiter({ limit: 5 })
      );

      expect(result).toEqual({ handled: true, command: "settings" });
      expect(setMinScore).not.toHaveBeenCalled();
      expect(String(reply.mock.calls[0][2])).toContain("0–100");
    }
  });

  it("/settings <score> khi chat chưa đăng ký → không bật kênh, nhắc /start", async () => {
    const { deps, setMinScore, reply } = fakeDeps();
    setMinScore.mockResolvedValueOnce(null);

    await handleTelegramUpdate(
      update("/settings 70"),
      deps,
      createChatRateLimiter({ limit: 5 })
    );

    expect(setMinScore).toHaveBeenCalledWith("-1001234567890", 0, 70);
    expect(String(reply.mock.calls[0][2])).toContain("chưa đăng ký");
    expect(String(reply.mock.calls[0][2])).toContain("/start");
  });

  it("/settings reset xoá ngưỡng riêng đúng chat/topic và xác nhận", async () => {
    const { deps, read, clearMinScore, reply } = fakeDeps();
    read.mockResolvedValueOnce(subscriber({ threadId: 42, minScore: 80 }));

    const result = await handleTelegramUpdate(
      update("/settings RESET", { threadId: 42 }),
      deps,
      createChatRateLimiter({ limit: 5 })
    );

    expect(result).toEqual({ handled: true, command: "settings" });
    expect(read).toHaveBeenCalledWith("-1001234567890", 42);
    expect(clearMinScore).toHaveBeenCalledWith("-1001234567890", 42);
    const text = String(reply.mock.calls[0][2]);
    expect(text).toContain("Đã xoá ngưỡng riêng");
    expect(text).toContain("topic 42");
    expect(text).toContain("ngưỡng alert chung");
  });

  it("/settings auto khi chưa có ngưỡng riêng → không ghi DB, báo đang dùng ngưỡng chung", async () => {
    const { deps, read, clearMinScore, reply } = fakeDeps();
    read.mockResolvedValueOnce(subscriber({ threadId: 7, minScore: null }));

    const result = await handleTelegramUpdate(
      update("/settings auto", { threadId: 7 }),
      deps,
      createChatRateLimiter({ limit: 5 })
    );

    expect(result).toEqual({ handled: true, command: "settings" });
    expect(clearMinScore).not.toHaveBeenCalled();
    const text = String(reply.mock.calls[0][2]);
    expect(text).toContain("đang dùng ngưỡng alert chung");
    expect(text).toContain("chưa có ngưỡng riêng");
  });

  it("/settings reset khi chat chưa đăng ký → nhắc /start, không ghi DB", async () => {
    const { deps, read, clearMinScore, reply } = fakeDeps();
    read.mockResolvedValueOnce(null);

    await handleTelegramUpdate(
      update("/settings reset"),
      deps,
      createChatRateLimiter({ limit: 5 })
    );

    expect(clearMinScore).not.toHaveBeenCalled();
    const text = String(reply.mock.calls[0][2]);
    expect(text).toContain("chưa đăng ký");
    expect(text).toContain("/start");
  });

  it("vượt rate limit/chat → bỏ lệnh, không ghi DB", async () => {
    const { deps, upsert, reply } = fakeDeps();
    const limiter = createChatRateLimiter({ limit: 1, windowMs: 60_000 });

    const first = await handleTelegramUpdate(update("/start"), deps, limiter);
    const second = await handleTelegramUpdate(update("/start"), deps, limiter);

    expect(first).toEqual({ handled: true, command: "start" });
    expect(second).toEqual({ handled: true, command: "start", rateLimited: true });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it("lệnh lạ không ghi DB/không trả lời", async () => {
    const { deps, upsert, stop, reply } = fakeDeps();

    const result = await handleTelegramUpdate(
      update("/broadcast"),
      deps,
      createChatRateLimiter({ limit: 5 })
    );

    expect(result.handled).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("update không phải message → bỏ qua", async () => {
    const { deps } = fakeDeps();
    expect(await handleTelegramUpdate({ update_id: 2 }, deps)).toEqual({ handled: false });
  });
});
