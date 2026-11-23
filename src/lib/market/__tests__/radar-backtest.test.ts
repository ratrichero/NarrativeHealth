import { describe, expect, it } from "@jest/globals";
import {
  RADAR_BACKTEST_MIN_PICKS,
  RADAR_BACKTEST_SEED,
  buildRadarBacktest,
  type RadarBacktestObservation,
} from "@/lib/market/radar-backtest";

/** 4 ngày × (3 actionable +2 nền âm): chiến lược rõ ràng hơn basket. */
function observations(): RadarBacktestObservation[] {
  const out: RadarBacktestObservation[] = [];
  for (let day = 1; day <= 4; day += 1) {
    for (let index = 0; index < 3; index += 1) {
      out.push({
        day: `2026-11-0${day}`,
        symbol: `UP${index}`,
        bias: "continuation",
        actionable: true,
        edgePct: 2,
      });
    }
    for (let index = 0; index < 2; index += 1) {
      out.push({
        day: `2026-11-0${day}`,
        symbol: `DOWN${index}`,
        bias: "neutral",
        actionable: false,
        edgePct: -1,
      });
    }
  }
  return out;
}

describe("radar backtest — chiến lược vs basket vs random", () => {
  it("tính alpha so với basket và xác suất vượt random", () => {
    const result = buildRadarBacktest(observations());
    expect(result.actionablePicks).toBe(12);
    expect(result.days).toBe(4);
    expect(result.strategy.totalPct).toBe(24);
    expect(result.strategy.avgPct).toBe(2);
    expect(result.strategy.hitRate).toBe(100);
    // basket = (24 + 8×−1) / 20 = 0.8
    expect(result.basket.avgPct).toBe(0.8);
    expect(result.alphaVsBasketPct).toBe(1.2);
    expect(result.random).not.toBeNull();
    expect(result.random!.trials).toBe(1000);
    expect(result.random!.probBeats).toBeGreaterThan(0);
    expect(result.random!.probBeats).toBeLessThanOrEqual(1);
    expect(["beats-both", "beats-basket-only"]).toContain(result.verdict);
  });

  it("cùng seed → cùng kết quả (trang công khai không nhảy số)", () => {
    const a = buildRadarBacktest(observations());
    const b = buildRadarBacktest(observations());
    expect(a.random).toEqual(b.random);
    expect(a.alphaVsRandomPct).toBe(b.alphaVsRandomPct);
  });

  it("seed khác → phân phối random khác nhưng cùng quy mô", () => {
    const a = buildRadarBacktest(observations(), { seed: 1 });
    const b = buildRadarBacktest(observations(), { seed: 2 });
    expect(a.random!.meanPct).not.toBe(RADAR_BACKTEST_SEED);
    expect(Math.abs(a.random!.meanPct - b.random!.meanPct)).toBeLessThan(5);
  });

  it("dưới ngưỡng mẫu → insufficient, không có random", () => {
    const few = observations().filter((obs) => obs.actionable).slice(0, RADAR_BACKTEST_MIN_PICKS - 1);
    const result = buildRadarBacktest(few);
    expect(result.verdict).toBe("insufficient");
    expect(result.random).toBeNull();
    expect(result.alphaVsBasketPct).toBeNull();
  });

  it("bỏ row edge không hữu hạn thay vì coi là 0", () => {
    const withBad = [
      ...observations(),
      {
        day: "2026-11-05",
        symbol: "BAD",
        bias: "continuation",
        actionable: true,
        edgePct: Number.NaN,
      },
    ];
    const result = buildRadarBacktest(withBad);
    expect(result.actionablePicks).toBe(12);
    expect(result.basket.picks).toBe(20);
  });

  it("chiến lược tệ hơn basket → verdict lags", () => {
    const losing = observations().map((obs) =>
      obs.actionable ? { ...obs, edgePct: -2 } : { ...obs, edgePct: 1 }
    );
    const result = buildRadarBacktest(losing);
    expect(result.alphaVsBasketPct).toBeLessThan(0);
    expect(result.verdict).toBe("lags");
  });
});
