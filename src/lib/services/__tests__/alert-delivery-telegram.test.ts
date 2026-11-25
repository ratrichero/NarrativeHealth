import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  escapeTelegramHtml,
  sendTelegramMessage,
} from "@/lib/services/alert-delivery.service";

const realFetch = globalThis.fetch;

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn(async () => new Response("{}", { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("sendTelegramMessage (RADAR-TG)", () => {
  it("gửi HTML tới đúng chat/topic, tắt preview và kèm nút URL", async () => {
    const ok = await sendTelegramMessage({
      token: "123:abc",
      chatId: "-100111",
      threadId: 42,
      html: "<b>$WIF</b>",
      buttons: [{ text: "Mở Radar", url: "https://coins.run.place/radar?symbol=WIF" }],
    });

    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(JSON.parse(String(init.body))).toEqual({
      chat_id: "-100111",
      text: "<b>$WIF</b>",
      parse_mode: "HTML",
      message_thread_id: 42,
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [
          [{ text: "Mở Radar", url: "https://coins.run.place/radar?symbol=WIF" }],
        ],
      },
    });
  });

  it("text thuần không bật parse_mode (giữ hành vi digest cũ) và không có topic", async () => {
    await sendTelegramMessage({ token: "123:abc", chatId: "99", text: "[a] plain" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.text).toBe("[a] plain");
    expect(body.parse_mode).toBeUndefined();
    expect(body.message_thread_id).toBeUndefined();
    expect(body.reply_markup).toBeUndefined();
  });

  it("thiếu token/chat hoặc nội dung rỗng → không gọi Telegram", async () => {
    expect(await sendTelegramMessage({ chatId: "-1", html: "x", token: "" })).toBe(false);
    expect(await sendTelegramMessage({ chatId: "", html: "x", token: "t" })).toBe(false);
    expect(await sendTelegramMessage({ chatId: "-1", text: "  ", token: "t" })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Telegram trả lỗi hoặc fetch throw → false, không throw", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("{}", { status: 429 }));
    expect(await sendTelegramMessage({ chatId: "-1", html: "x", token: "t" })).toBe(false);

    fetchMock.mockImplementationOnce(async () => {
      throw new Error("network down");
    });
    expect(await sendTelegramMessage({ chatId: "-1", html: "x", token: "t" })).toBe(false);
  });
});

describe("escapeTelegramHtml", () => {
  it("escape đủ ký tự phá HTML", () => {
    expect(escapeTelegramHtml('<b>&"it\'s"</b>')).toBe(
      "&lt;b&gt;&amp;&quot;it&#39;s&quot;&lt;/b&gt;"
    );
  });
});
