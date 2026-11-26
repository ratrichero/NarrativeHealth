import {
  ACTION_MIN_ENTRY,
  ACTION_MIN_SCORE,
  BIAS_TTL_HOURS,
  entryZoneTone,
  invalidationState,
  isTrustedBias,
  meetsActionable,
  wilsonInterval,
} from "@/lib/market/bias-state";

const AT = "2026-11-20T00:00:00.000Z";
const HOUR = 3_600_000;

describe("invalidationState", () => {
  const now = Date.parse(AT) + 2 * HOUR;

  it("nhãn tăng còn trên mốc là còn hiệu lực", () => {
    const result = invalidationState({
      bias: "continuation",
      price: 110,
      invalidationPrice: 100,
      at: AT,
      now,
    });
    expect(result.state).toBe("intact");
    expect(result.bufferPct).toBeCloseTo(9.09, 1);
  });

  it("giá thủng mốc = đã vô hiệu", () => {
    const result = invalidationState({
      bias: "continuation",
      price: 99,
      invalidationPrice: 100,
      at: AT,
      now,
    });
    expect(result.state).toBe("hit");
    expect(result.bufferPct).toBeLessThan(0);
  });

  it("nhãn giảm bị vô hiệu khi giá vượt lên trên mốc", () => {
    const result = invalidationState({
      bias: "exhaustion",
      price: 101,
      invalidationPrice: 100,
      at: AT,
      now,
    });
    expect(result.state).toBe("hit");
  });

  it("sát mốc (≤0.25 ATR) là gần vô hiệu", () => {
    const result = invalidationState({
      bias: "exhaustion",
      price: 101,
      invalidationPrice: 102,
      at: AT,
      now,
      atr: 4,
    });
    expect(result.state).toBe("near");
  });

  it("quá TTL của nhãn là hết hạn", () => {
    const result = invalidationState({
      bias: "exhaustion",
      price: 90,
      invalidationPrice: 120,
      at: AT,
      now: Date.parse(AT) + (BIAS_TTL_HOURS.exhaustion + 1) * HOUR,
    });
    expect(result.state).toBe("expired");
  });

  it("không có mốc hoặc nhãn trung tính trả none", () => {
    expect(
      invalidationState({ bias: "continuation", price: 100, invalidationPrice: null, at: AT, now })
        .state
    ).toBe("none");
    expect(
      invalidationState({ bias: "neutral", price: 100, invalidationPrice: 90, at: AT, now }).state
    ).toBe("none");
  });
});

describe("meetsActionable", () => {
  it("đủ điểm + độ mới + không đuổi giá", () => {
    expect(
      meetsActionable({ bias: "continuation", score: ACTION_MIN_SCORE, entryQuality: ACTION_MIN_ENTRY })
    ).toBe(true);
  });

  it("chaseRisk hoặc neutral bị loại", () => {
    expect(
      meetsActionable({
        bias: "continuation",
        score: 80,
        entryQuality: 80,
        chaseRisk: true,
      })
    ).toBe(false);
    expect(meetsActionable({ bias: "neutral", score: 90, entryQuality: 90 })).toBe(false);
  });
});

describe("entryZoneTone", () => {
  const entry = { entryLow: 98.5, entryHigh: 99.5 };

  it("long: trên vùng là chờ hồi, trong vùng là khớp, dưới vùng là đã qua", () => {
    expect(entryZoneTone(100, "BULLISH", entry)).toEqual({ tone: "wait", distancePct: 0.5 });
    expect(entryZoneTone(99, "BULLISH", entry)).toEqual({ tone: "in", distancePct: 0 });
    expect(entryZoneTone(97, "BULLISH", entry).tone).toBe("past");
  });

  it("short: dưới vùng là chờ hồi, trên vùng là đã qua", () => {
    const shortEntry = { entryLow: 100.5, entryHigh: 101.5 };
    expect(entryZoneTone(100, "BEARISH", shortEntry).tone).toBe("wait");
    expect(entryZoneTone(101, "BEARISH", shortEntry).tone).toBe("in");
    expect(entryZoneTone(103, "BEARISH", shortEntry).tone).toBe("past");
  });

  it("giá trị hỏng trả trạng thái trung tính, không phải đã qua vùng", () => {
    const unknown = { tone: "unknown", distancePct: null };
    expect(entryZoneTone(0, "BULLISH", entry)).toEqual(unknown);
    expect(entryZoneTone(100, "BULLISH", { entryLow: 0, entryHigh: 99.5 })).toEqual(unknown);
    expect(entryZoneTone(100, "BULLISH", { entryLow: 98.5, entryHigh: Number.NaN })).toEqual(unknown);
    expect(entryZoneTone(Number.NaN, "BEARISH", entry)).toEqual(unknown);
  });
});

describe("isTrustedBias", () => {
  it("cần đủ mẫu và hit rate ≥ 50%", () => {
    expect(isTrustedBias(60, 20)).toBe(true);
    expect(isTrustedBias(60, 4)).toBe(false);
    expect(isTrustedBias(40, 20)).toBe(false);
    expect(isTrustedBias(null, 20)).toBe(false);
  });
});

describe("wilsonInterval", () => {
  it("mẫu nhỏ cho khoảng rất rộng, mẫu lớn thu hẹp", () => {
    const small = wilsonInterval(3, 3);
    const large = wilsonInterval(300, 1000);
    expect(small).not.toBeNull();
    expect(large).not.toBeNull();
    expect((small!.high - small!.low)).toBeGreaterThan(20);
    expect((large!.high - large!.low)).toBeLessThan(10);
  });

  it("không có mẫu trả null", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
  });
});
