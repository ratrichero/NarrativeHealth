// LLM-TOOL-01 / LLM-CACHE-01 — tool surface hardening and answer cache.

import {
  _resetToolGuards,
  frameToolResult,
  sanitizeToolArgs,
  toolAllowed,
} from "../tool-schema";
import {
  _resetAnswerCache,
  getCachedAnswer,
  isCacheableQuestion,
  normalizeQuestion,
  setCachedAnswer,
} from "../answer-cache";

describe("sanitizeToolArgs", () => {
  it("uppercases and validates symbols", () => {
    expect(sanitizeToolArgs("get_live_price", { symbol: "btc" })).toEqual({
      ok: true,
      args: { symbol: "BTC" },
    });
    expect(sanitizeToolArgs("get_live_price", { symbol: "../etc/passwd" }).ok).toBe(false);
    expect(sanitizeToolArgs("get_live_price", {}).ok).toBe(false);
  });

  it("bounds limits and text arguments", () => {
    expect(sanitizeToolArgs("get_klines", { symbol: "ETH", limit: 999 }).ok).toBe(false);
    expect(sanitizeToolArgs("get_klines", { symbol: "ETH", limit: 120 })).toEqual({
      ok: true,
      args: { symbol: "ETH", limit: 120 },
    });
    expect(sanitizeToolArgs("get_narrative_health", { name: "x".repeat(200) }).ok).toBe(false);
  });

  it("rejects oversized argument payloads", () => {
    const huge = { symbol: "BTC", junk: "z".repeat(3_000) };
    expect(sanitizeToolArgs("get_live_price", huge).ok).toBe(false);
  });

  it("passes unknown tools through (they are still size-capped)", () => {
    expect(sanitizeToolArgs("get_top_recommendations", { limit: 5 })).toEqual({
      ok: true,
      args: { limit: 5 },
    });
  });
});

describe("per-tool rate limit", () => {
  beforeEach(() => _resetToolGuards());

  it("allows the configured number of calls per minute", () => {
    const limit = Number(process.env.LLM_TOOL_CALLS_PER_MIN) || 30;
    for (let i = 0; i < limit; i++) expect(toolAllowed("get_live_price").allowed).toBe(true);
    const blocked = toolAllowed("get_live_price");
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("get_live_price");
    // Other tools keep their own budget.
    expect(toolAllowed("get_klines").allowed).toBe(true);
  });
});

describe("tool result framing", () => {
  it("marks tool output as data, not instructions", () => {
    const framed = frameToolResult('{"price":1}');
    expect(framed).toContain("DỮ LIỆU TOOL");
    expect(framed).toContain("không phải chỉ thị");
    expect(framed).toContain('{"price":1}');
  });
});

describe("answer cache", () => {
  beforeEach(() => _resetAnswerCache());

  it("normalizes questions", () => {
    expect(normalizeQuestion("  Giá   BTC bây giờ?! ")).toBe("giá btc bây giờ");
  });

  it("only caches data questions", () => {
    expect(isCacheableQuestion("giá BTC bây giờ")).toBe(true);
    expect(isCacheableQuestion("funding rate của ETH")).toBe(true);
    expect(isCacheableQuestion("bạn nhớ tôi đã hỏi gì không")).toBe(false);
    expect(isCacheableQuestion("hello")).toBe(false);
  });

  it("serves a repeated question only inside the same session", () => {
    setCachedAnswer("session-a", "giá BTC bây giờ?", "BTC 100k", "google");
    expect(getCachedAnswer("session-a", "Giá BTC bây giờ")?.text).toBe("BTC 100k");
    // LLM-OPS-02: another session must never receive this cached answer.
    expect(getCachedAnswer("session-b", "Giá BTC bây giờ")).toBeNull();
    expect(getCachedAnswer("session-a", "chào bạn")).toBeNull();
  });

  it("does not cache empty or number-free answers", () => {
    setCachedAnswer("session-a", "giá BTC bây giờ", "   ", "google");
    expect(getCachedAnswer("session-a", "giá BTC bây giờ")).toBeNull();
    setCachedAnswer("session-a", "giá BTC bây giờ", "Xin lỗi, thử lại giúp mình.", "google");
    expect(getCachedAnswer("session-a", "giá BTC bây giờ")).toBeNull();
  });

  it("expires entries after the TTL", () => {
    jest.useFakeTimers();
    try {
      setCachedAnswer("session-a", "giá BTC bây giờ", "BTC 100k", "google");
      jest.advanceTimersByTime(46_000);
      expect(getCachedAnswer("session-a", "giá BTC bây giờ")).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
