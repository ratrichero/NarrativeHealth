import type { KlineData } from "@/lib/collectors/binance";
import { computeImpulse } from "@/lib/market/metrics";
import { classifyRegime, percentileRank } from "@/lib/market/radar";
import { computeSpotLeadership } from "@/lib/market/spot";

const HOUR = 3_600_000;
const T0 = Date.parse("2026-01-01T00:00:00Z");

function candle(i: number, o: number, h: number, l: number, c: number, vol = 1_000): KlineData {
  return {
    openTime: T0 + i * HOUR,
    open: String(o),
    high: String(h),
    low: String(l),
    close: String(c),
    closeTime: T0 + (i + 1) * HOUR - 1,
    volume: "1",
    quoteVolume: String(vol),
  };
}

describe("computeImpulse", () => {
  it("tìm impulse 1h, tính tuổi, extension và số nến nén", () => {
    const candles: KlineData[] = [];
    for (let i = 0; i < 60; i += 1) candles.push(candle(i, 100, 100.25, 99.75, 100, 1_000));
    candles.push(candle(60, 100, 103, 99.8, 102.8, 4_000));
    for (let i = 61; i < 71; i += 1) candles.push(candle(i, 102.8, 102.95, 102.65, 102.85, 900));

    const impulse = computeImpulse(candles);
    expect(impulse).not.toBeNull();
    expect(impulse!.direction).toBe("up");
    expect(impulse!.ageHours).toBeGreaterThanOrEqual(9);
    expect(impulse!.ageHours).toBeLessThanOrEqual(11);
    expect(impulse!.extensionAtr).toBeGreaterThan(2);
    expect(impulse!.consolidationBars).toBeGreaterThanOrEqual(5);
    expect(impulse!.volumeRatio).toBeGreaterThan(2.5);
  });

  it("trả null khi không có impulse hoặc thiếu dữ liệu", () => {
    const flat = Array.from({ length: 60 }, (_, i) => candle(i, 100, 100.2, 99.8, 100, 1_000));
    expect(computeImpulse(flat)).toBeNull();
    expect(computeImpulse([])).toBeNull();
  });
});

describe("classifyRegime + percentileRank", () => {
  it("phân loại risk-on/off/neutral", () => {
    expect(classifyRegime(2, "up", 60)).toBe("risk-on");
    expect(classifyRegime(-2, "down", 40)).toBe("risk-off");
    expect(classifyRegime(0.2, "flat", 50)).toBe("neutral");
    expect(classifyRegime(2, null, 60)).toBe("risk-on");
  });

  it("percentile rank theo phân phối change", () => {
    const values = [-10, -5, 0, 5, 10];
    expect(percentileRank(values, 10)).toBe(100);
    expect(percentileRank(values, 0)).toBe(60);
    expect(percentileRank([], 3)).toBeNull();
  });
});

describe("computeSpotLeadership", () => {
  it("spot dẫn khi spot tăng mạnh hơn perp", () => {
    const result = computeSpotLeadership(5, 100, {
      lastPrice: "99.5",
      priceChangePercent: "7.2",
      quoteVolume: "9000000",
    });
    expect(result).not.toBeNull();
    expect(result!.spotLed).toBe(true);
    expect(result!.basisPct).toBeCloseTo(0.5, 2);
  });

  it("perp dẫn khi spot yếu hơn, và null khi thiếu spot", () => {
    const result = computeSpotLeadership(8, 100, {
      lastPrice: "100",
      priceChangePercent: "2",
      quoteVolume: "1000000",
    });
    expect(result!.spotLed).toBe(false);
    expect(computeSpotLeadership(8, 100, undefined)).toBeNull();
  });
});
