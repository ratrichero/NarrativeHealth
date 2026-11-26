import type { MarketMetrics } from "@/lib/market/metrics";
import {
  compositeScore,
  decideBias,
  scoreForSide,
  scoreGainer,
  scoreLoser,
  scoreUnusual,
} from "@/lib/market/scoring";

const base: MarketMetrics = {
  price: 100,
  changePct: 5,
  quoteVolume: 50_000_000,
  trades: 10_000,
  high24h: 105,
  low24h: 95,
  rangePosition: 0.5,
  distanceFromHighPct: 5,
  volumeRatio7d: 2,
  volumeZ: 1,
  atrPct: 2,
  changeAtrMultiple: 2.5,
  ema20: 101,
  ema50: 99,
  ema20_1h: null,
  rsi14: 60,
  high7d: 104,
  low7d: 90,
  rangePct7d: 14,
  isBreakout7d: false,
  distanceFrom7dHighPct: 4,
  fundingRate: 0.0001,
  oiChangePct: 6,
  longShortRatio: 1.1,
  listingAgeDays: 200,
};

function m(overrides: Partial<MarketMetrics>): MarketMetrics {
  return { ...base, ...overrides };
}

describe("scoreGainer", () => {
  it("ưu tiên continuation khi trend + volume + OI xác nhận", () => {
    const result = scoreGainer(
      m({
        changePct: 7,
        atrPct: 1.5,
        changeAtrMultiple: 4.6,
        volumeRatio7d: 3,
        oiChangePct: 12,
        fundingRate: 0.00005,
        rangePosition: 0.7,
        ema20: 105,
        ema50: 98,
        rsi14: 65,
        distanceFrom7dHighPct: 1,
      })
    );
    expect(result.bias).toBe("continuation");
    expect(result.score).toBeGreaterThanOrEqual(45);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("chuyển sang exhaustion khi move quá xa, funding nóng, OI giảm", () => {
    const result = scoreGainer(
      m({
        changePct: 42,
        atrPct: 6,
        changeAtrMultiple: 7,
        volumeRatio7d: 9,
        oiChangePct: -8,
        fundingRate: 0.0009,
        rangePosition: 0.98,
        distanceFromHighPct: 0.1,
        rsi14: 82,
        ema20: 150,
        ema50: 120,
        // Phiếu thứ hai: giá đã đóng dưới EMA20 1h (mất cấu trúc ngắn hạn).
        ema20_1h: 101,
      })
    );
    expect(result.bias).toBe("exhaustion");
    expect(result.score).toBeGreaterThanOrEqual(55);
    expect(result.entryQuality).toBeLessThan(40);
    expect(result.warnings.join(" ")).toContain("climax");
  });

  it("entryQuality giảm khi move đã đi nhiều ATR", () => {
    const fresh = scoreGainer(m({ changePct: 4, changeAtrMultiple: 1.2, rangePosition: 0.6 }));
    const extended = scoreGainer(m({ changePct: 35, changeAtrMultiple: 7, rangePosition: 0.98, fundingRate: 0.0008 }));
    expect(fresh.entryQuality).toBeGreaterThan(extended.entryQuality);
  });
});

describe("scoreLoser", () => {
  it("nhận diện flush bounce khi OI giảm, funding âm, RSI thấp", () => {
    const result = scoreLoser(
      m({
        changePct: -25,
        changeAtrMultiple: 5,
        atrPct: 5,
        volumeRatio7d: 3,
        oiChangePct: -15,
        fundingRate: -0.0008,
        rangePosition: 0.1,
        rsi14: 25,
        ema20: 80,
        ema50: 110,
      })
    );
    expect(result.bias).toBe("flush-bounce");
    expect(result.score).toBeGreaterThanOrEqual(55);
  });

  it("nhận diện breakdown khi OI tăng dù giá giảm", () => {
    const result = scoreLoser(
      m({
        changePct: -12,
        changeAtrMultiple: 4,
        atrPct: 3,
        volumeRatio7d: 2,
        oiChangePct: 12,
        fundingRate: -0.0001,
        rangePosition: 0.15,
        rsi14: 35,
        ema20: 80,
        ema50: 110,
        distanceFrom7dHighPct: 12,
      })
    );
    expect(result.bias).toBe("breakdown");
    expect(result.score).toBeGreaterThanOrEqual(50);
  });
});

describe("scoreUnusual", () => {
  it("gắn accumulation khi volume z-score và OI cao nhưng giá chưa chạy", () => {
    const result = scoreUnusual(
      m({
        changePct: 2,
        volumeZ: 4.2,
        volumeRatio7d: 3.2,
        oiChangePct: 10,
        rangePct7d: 7,
        rangePosition: 0.5,
        fundingRate: 0.0001,
        isBreakout7d: false,
        distanceFrom7dHighPct: 2,
      })
    );
    expect(result.bias).toBe("accumulation");
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("gắn breakout khi vượt đỉnh 7 ngày với volume xác nhận", () => {
    const result = scoreUnusual(
      m({
        changePct: 5,
        volumeZ: 2.6,
        volumeRatio7d: 3,
        oiChangePct: 8,
        isBreakout7d: true,
        distanceFrom7dHighPct: -1,
      })
    );
    expect(result.bias).toBe("breakout");
    expect(result.reasons.join(" ")).toContain("vượt đỉnh");
  });

  it("neutral khi không có bất thường", () => {
    const result = scoreUnusual(
      m({
        changePct: 1,
        volumeZ: 0.4,
        volumeRatio7d: 1,
        oiChangePct: 0,
        rangePct7d: 30,
        isBreakout7d: false,
      })
    );
    expect(result.bias).toBe("neutral");
  });
});

describe("scoreForSide + composite", () => {
  it("dispatch đúng hàm theo side", () => {
    const metrics = m({ changePct: 42, atrPct: 6, changeAtrMultiple: 7, fundingRate: 0.0009, oiChangePct: -8, rsi14: 82, ema20_1h: 101 });
    expect(scoreForSide(metrics, "gainer").bias).toBe("exhaustion");
    expect(scoreForSide(metrics, "loser").bias).not.toBe("flush-bounce");
    expect(scoreForSide(m({ changePct: 1, volumeZ: 4, volumeRatio7d: 3, oiChangePct: 9, rangePct7d: 7 }), "unusual").bias).toBe(
      "accumulation"
    );
  });

  it("composite ưu tiên score nhưng vẫn phạt move cũ", () => {
    expect(compositeScore(80, 20)).toBe(56);
    expect(compositeScore(80, 80)).toBe(80);
  });
});

describe("decideBias — margin + hysteresis", () => {
  it("hai phe sát nhau (< margin) → neutral, không đoán", () => {
    const decision = decideBias({
      candidates: [
        { bias: "continuation", score: 55, threshold: 45 },
        { bias: "exhaustion", score: 50, threshold: 55 },
      ],
    });
    expect(decision.bias).toBe("neutral");
    expect(decision.reason).toBe("tight");
  });

  it("hai phe sát nhau nhưng đã có bias cũ → giữ bias cũ", () => {
    const decision = decideBias({
      prevBias: "continuation",
      candidates: [
        { bias: "continuation", score: 55, threshold: 45 },
        { bias: "exhaustion", score: 50, threshold: 55 },
      ],
    });
    expect(decision.bias).toBe("continuation");
    expect(decision.reason).toBe("held");
  });

  it("đổi phe phải vượt switchMargin, vượt rồi thì đổi", () => {
    const held = decideBias({
      prevBias: "exhaustion",
      candidates: [
        { bias: "continuation", score: 70, threshold: 45 },
        { bias: "exhaustion", score: 60, threshold: 55 },
      ],
    });
    expect(held.bias).toBe("exhaustion");
    expect(held.reason).toBe("held");

    const switched = decideBias({
      prevBias: "exhaustion",
      candidates: [
        { bias: "continuation", score: 80, threshold: 45 },
        { bias: "exhaustion", score: 60, threshold: 55 },
      ],
    });
    expect(switched.bias).toBe("continuation");
    expect(switched.reason).toBe("switched");
  });

  it("phe dẫn chưa đủ ngưỡng → neutral thay vì nhãn yếu", () => {
    const decision = decideBias({
      candidates: [
        { bias: "continuation", score: 40, threshold: 45 },
        { bias: "exhaustion", score: 20, threshold: 55 },
      ],
    });
    expect(decision.bias).toBe("neutral");
    expect(decision.reason).toBe("low-score");
  });
});

describe("exhaustion cần xác nhận đảo chiều", () => {
  it("move quá xa nhưng chưa xác nhận thì không gọi kiệt sức", () => {
    const result = scoreGainer(
      m({
        price: 110,
        changePct: 42,
        atrPct: 6,
        changeAtrMultiple: 7,
        volumeRatio7d: 9,
        oiChangePct: 12,
        fundingRate: 0.0009,
        rangePosition: 0.98,
        distanceFromHighPct: 0.1,
        rsi14: 82,
        ema20_1h: 90,
      })
    );
    expect(result.bias).not.toBe("exhaustion");
    expect(result.warnings.join(" ")).toContain("xác nhận");
  });

  it("hai phiếu (OI giảm + mất EMA20 1h) mới gọi kiệt sức", () => {
    const result = scoreGainer(
      m({
        changePct: 42,
        atrPct: 6,
        changeAtrMultiple: 7,
        volumeRatio7d: 9,
        oiChangePct: -8,
        fundingRate: 0.0009,
        rangePosition: 0.98,
        distanceFromHighPct: 0.1,
        rsi14: 82,
        ema20_1h: 101,
      })
    );
    expect(result.bias).toBe("exhaustion");
  });

  it("OI giảm một mình chỉ là một phiếu — không đoán đảo chiều", () => {
    const result = scoreGainer(
      m({
        changePct: 42,
        atrPct: 6,
        changeAtrMultiple: 7,
        volumeRatio7d: 9,
        oiChangePct: -8,
        fundingRate: 0.0009,
        rangePosition: 0.98,
        distanceFromHighPct: 0.1,
        rsi14: 82,
        ema20_1h: null,
      })
    );
    expect(result.bias).not.toBe("exhaustion");
    expect(result.warnings.join(" ")).toContain("phiếu");
  });

  it("hysteresis giữ exhaustion khi bằng chứng chưa đổi phe", () => {
    const metrics = m({
      changePct: 42,
      atrPct: 6,
      changeAtrMultiple: 7,
      volumeRatio7d: 9,
      oiChangePct: -8,
      fundingRate: 0.0009,
      rangePosition: 0.98,
      distanceFromHighPct: 0.1,
      rsi14: 82,
      ema20_1h: 101,
    });
    expect(scoreGainer(metrics, { prevBias: "exhaustion" }).bias).toBe("exhaustion");
    // Bằng chứng đủ mạnh (chênh > switch margin) vẫn đổi được sang continuation.
    expect(scoreGainer(metrics, { prevBias: "continuation" }).bias).toBe("exhaustion");
  });
});

describe("giá vô hiệu bias", () => {
  it("continuation vô hiệu khi đóng dưới EMA20 1h", () => {
    const result = scoreGainer(m({ ema20_1h: 98.5 }));
    expect(result.bias).toBe("continuation");
    expect(result.invalidationPrice).toBe(98.5);
    expect(result.invalidationNote).toContain("EMA20");
  });

  it("exhaustion vô hiệu khi vượt đỉnh 24h", () => {
    const result = scoreGainer(
      m({
        changePct: 42,
        atrPct: 6,
        changeAtrMultiple: 7,
        fundingRate: 0.0009,
        oiChangePct: -8,
        rsi14: 82,
        rangePosition: 0.98,
        distanceFromHighPct: 0.1,
        ema20_1h: 101,
      })
    );
    expect(result.bias).toBe("exhaustion");
    expect(result.invalidationPrice).toBe(105);
    expect(result.invalidationNote).toContain("24h");
  });

  it("flush-bounce vô hiệu khi thủng đáy 24h", () => {
    const result = scoreLoser(
      m({
        changePct: -25,
        changeAtrMultiple: 5,
        atrPct: 5,
        volumeRatio7d: 3,
        oiChangePct: -15,
        fundingRate: -0.0008,
        rangePosition: 0.1,
        rsi14: 25,
        ema20: 80,
        ema50: 110,
      })
    );
    expect(result.bias).toBe("flush-bounce");
    expect(result.invalidationPrice).toBe(95);
  });

  it("neutral không có mốc vô hiệu", () => {
    const result = scoreUnusual(m({ changePct: 0.5, volumeZ: 0.3, volumeRatio7d: 1, oiChangePct: 0, rangePct7d: 40 }));
    expect(result.bias).toBe("neutral");
    expect(result.invalidationPrice).toBeNull();
  });
});
