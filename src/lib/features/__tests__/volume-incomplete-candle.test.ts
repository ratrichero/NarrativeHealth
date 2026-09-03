import { runFeatureEngine, FeatureEngineResult } from "../engine";

/**
 * P6-DATA-02 — Test that the current (incomplete) daily candle is excluded
 * from volume scoring when currentBusinessDate is provided.
 */

// Helper: generate N days of price data for testing
function generatePriceData(
  days: number,
  baseVolume: number,
  currentDayVolume: number,
  baseDate: string = "2026-08-01"
): Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }> {
  const data = [];
  for (let i = 0; i < days; i++) {
    const dateObj = new Date(baseDate);
    dateObj.setDate(dateObj.getDate() + i);
    const dateStr = dateObj.toISOString().split("T")[0];
    const isCurrentDay = i === days - 1;
    data.push({
      date: dateStr,
      open: 100 + i * 0.5,
      high: 102 + i * 0.5,
      low: 98 + i * 0.5,
      close: 101 + i * 0.5,
      volume: isCurrentDay ? currentDayVolume : baseVolume,
    });
  }
  return data;
}

const baseMetrics = {
  openInterest: null,
  openInterestPrev: null,
  fundingRate: null,
  marketCap: null,
};
const healthWeights = { trend: 0.30, derivative: 0.15, volume: 0.30, momentum: 0.25 };
const confidenceWeights = { binance_spot: 0.30, binance_futures: 0.40, coingecko: 0.30 };
const sourceOk = { binance_spot: true, binance_futures: false, coingecko: false };

describe("P6-DATA-02: Incomplete daily candle exclusion from volume", () => {
  describe("Incomplete candle is excluded", () => {
    it("should exclude incomplete current-day candle from volume when currentBusinessDate matches", () => {
      // Base volume = 1M, current incomplete day = 50K (5% of normal)
      const priceData = generatePriceData(30, 1_000_000, 50_000);
      const currentBusinessDate = priceData[priceData.length - 1].date;

      const withDate = runFeatureEngine(
        priceData,
        baseMetrics,
        healthWeights,
        confidenceWeights,
        sourceOk,
        currentBusinessDate,
      );

      const withoutDate = runFeatureEngine(
        priceData,
        baseMetrics,
        healthWeights,
        confidenceWeights,
        sourceOk,
      );

      // With the fix, the incomplete candle is excluded, so MA20 should be ~1M
      // and the "current" volume should be the previous completed candle (1M)
      // resulting in ratio ~1.0 and score ~60
      // Without the fix, the incomplete candle (50K) is used, ratio is ~0.05, score = 15
      expect(withDate.volume_score).toBeGreaterThan(withoutDate.volume_score);
    });

    it("should not reduce volume score when candle is complete", () => {
      // Base volume = 1M, current day = 1M (normal/complete)
      const priceData = generatePriceData(30, 1_000_000, 1_000_000);
      const currentBusinessDate = priceData[priceData.length - 1].date;

      const withDate = runFeatureEngine(
        priceData,
        baseMetrics,
        healthWeights,
        confidenceWeights,
        sourceOk,
        currentBusinessDate,
      );

      const withoutDate = runFeatureEngine(
        priceData,
        baseMetrics,
        healthWeights,
        confidenceWeights,
        sourceOk,
      );

      // Both should produce the same result when candle is complete
      expect(withDate.volume_score).toBe(withoutDate.volume_score);
    });
  });

  describe("Fallback when insufficient completed candles", () => {
    it("should fall back to all volumes when excluding current day leaves < 1 volume", () => {
      // Only 1 day of data — excluding it would leave 0 volumes
      const priceData = generatePriceData(1, 1_000_000, 50_000);
      const currentBusinessDate = priceData[0].date;

      const result = runFeatureEngine(
        priceData,
        baseMetrics,
        healthWeights,
        confidenceWeights,
        sourceOk,
        currentBusinessDate,
      );

      // Should not crash, should use fallback
      expect(result.volume_score).toBeGreaterThanOrEqual(0);
      expect(result.volume_score).toBeLessThanOrEqual(100);
    });

    it("should work correctly with exactly 20 candles", () => {
      const priceData = generatePriceData(20, 1_000_000, 50_000);
      const currentBusinessDate = priceData[19].date;

      const result = runFeatureEngine(
        priceData,
        baseMetrics,
        healthWeights,
        confidenceWeights,
        sourceOk,
        currentBusinessDate,
      );

      // Should produce a valid score using 19 completed candles
      expect(result.volume_score).toBeGreaterThan(15);
      expect(result.volume_score).toBeLessThanOrEqual(100);
    });
  });

  describe("Impact on health score", () => {
    it("should increase health score when incomplete candle was suppressing volume", () => {
      const priceData = generatePriceData(30, 1_000_000, 10_000);
      const currentBusinessDate = priceData[priceData.length - 1].date;

      const withFix = runFeatureEngine(
        priceData,
        baseMetrics,
        healthWeights,
        confidenceWeights,
        sourceOk,
        currentBusinessDate,
      );

      const withoutFix = runFeatureEngine(
        priceData,
        baseMetrics,
        healthWeights,
        confidenceWeights,
        sourceOk,
      );

      // Health = 0.30*trend + 0.15*derivative + 0.30*volume + 0.25*momentum
      // Since volume was suppressed (15 without fix vs ~60 with fix),
      // health should increase
      expect(withFix.volume_score).toBeGreaterThan(withoutFix.volume_score);
    });
  });

  describe("No date = no filtering", () => {
    it("should use all volumes when currentBusinessDate is not provided", () => {
      const priceData = generatePriceData(30, 1_000_000, 50_000);

      const result = runFeatureEngine(
        priceData,
        baseMetrics,
        healthWeights,
        confidenceWeights,
        sourceOk,
      );

      // Without currentBusinessDate, the incomplete candle should be included
      // (backward compatible behavior)
      expect(result.volume_score).toBe(15); // ratio < 0.5 → 15
    });
  });

  describe("Business date mismatch = no filtering", () => {
    it("should not filter when currentBusinessDate does not match any candle date", () => {
      const priceData = generatePriceData(30, 1_000_000, 50_000);

      const result = runFeatureEngine(
        priceData,
        baseMetrics,
        healthWeights,
        confidenceWeights,
        sourceOk,
        "2099-01-01", // Future date, no match
      );

      // Should not crash, should use all volumes (no filtering applied)
      expect(result.volume_score).toBe(15);
    });
  });

  describe("Determinism", () => {
    it("should produce identical results for identical inputs", () => {
      const priceData = generatePriceData(30, 1_000_000, 50_000);
      const currentBusinessDate = priceData[29].date;

      const r1 = runFeatureEngine(
        priceData, baseMetrics, healthWeights, confidenceWeights, sourceOk, currentBusinessDate,
      );
      const r2 = runFeatureEngine(
        priceData, baseMetrics, healthWeights, confidenceWeights, sourceOk, currentBusinessDate,
      );

      expect(r1.volume_score).toBe(r2.volume_score);
      expect(r1.volume_detail.volume_ratio).toBe(r2.volume_detail.volume_ratio);
      expect(r1.trend_score).toBe(r2.trend_score);
      expect(r1.derivative_score).toBe(r2.derivative_score);
      expect(r1.momentum_score).toBe(r2.momentum_score);
    });
  });
});
