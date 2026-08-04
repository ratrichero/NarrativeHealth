import { describe, it, expect } from "@jest/globals";
import { calculateRiskLevels } from "../risk";
import { KlineData } from "../types";

/**
 * Create mock KlineData with enough candles to produce a valid ATR.
 * Uses a simple uptrending price with small volatility so ATR > 0.
 */
function createMockKlineData(count: number): KlineData[] {
  const data: KlineData[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = price + 1; // slight uptrend
    const high = close + 0.5;
    const low = open - 0.5;
    data.push({
      openTime: i * 3600000,
      open,
      high,
      low,
      close,
      volume: 1000,
      closeTime: i * 3600000 + 3599999,
      quoteVolume: 1000 * close,
    });
    price = close;
  }
  return data;
}

const mockData = createMockKlineData(50);

describe("calculateRiskLevels - Strength Scale", () => {
  it("compositeScore=20 → strength=20 → uses weak multipliers", () => {
    // strength=20 < 40 → slMult=1.5, tp1Mult=1.5
    // rrRatio = 1.5/1.5 = 1.0
    const result = calculateRiskLevels(mockData, "LONG", 20);
    expect(result?.rrRatio).toBeCloseTo(1.0, 1);
  });

  it("compositeScore=50 → strength=50 → uses medium multipliers", () => {
    // strength=50, 40<=50<65 → slMult=1.8, tp1Mult=1.8
    // rrRatio = 1.8/1.8 = 1.0
    const result = calculateRiskLevels(mockData, "LONG", 50);
    expect(result?.rrRatio).toBeCloseTo(1.0, 1);
  });

  it("compositeScore=75 → strength=75 → uses strong multipliers", () => {
    // strength=75 >= 65 → slMult=2.0, tp1Mult=2.0
    // rrRatio = 2.0/2.0 = 1.0
    const result = calculateRiskLevels(mockData, "LONG", 75);
    expect(result?.rrRatio).toBeCloseTo(1.0, 1);
  });

  it("weak signal has smaller SL distance than strong signal", () => {
    const weakResult = calculateRiskLevels(mockData, "LONG", 20);
    const strongResult = calculateRiskLevels(mockData, "LONG", 75);
    // slMult: 1.5 vs 2.0 → weak has smaller SL distance
    expect(weakResult?.slPct).toBeLessThan(strongResult?.slPct ?? 0);
  });

  it("negative compositeScore uses absolute value", () => {
    const longResult = calculateRiskLevels(mockData, "LONG", 75);
    const shortResult = calculateRiskLevels(mockData, "SHORT", -75);
    expect(longResult?.rrRatio).toBe(shortResult?.rrRatio);
  });

  it("OLD BUG regression: weak score should NOT equal strong score TP", () => {
    const weakResult = calculateRiskLevels(mockData, "LONG", 20);
    const strongResult = calculateRiskLevels(mockData, "LONG", 75);
    // With old bug: both had strength=100, same TP
    // With fix: different TP multipliers
    expect(weakResult?.tp1).not.toBeCloseTo(strongResult?.tp1 ?? 0, 0);
  });
});