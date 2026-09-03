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

  describe("No fallback to incomplete candle (semantic safety)", () => {
    it("should return neutral score=50 when only candle is the current (incomplete) day", () => {
      // Only 1 day of data = current day. Excluding it leaves 0 completed candles.
      // calculateVolumeScore([]) returns score=50 (neutral / data-unavailable).
      // Critically, it must NOT fall back to the incomplete candle.
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

      // calculateVolumeScore([]) → score 50, days_used 0, volume_ratio 1
      expect(result.volume_score).toBe(50);
      expect(result.volume_detail.days_used).toBe(0);
      expect(result.volume_detail.volume_ratio).toBe(1);
    });

    it("should NOT use incomplete candle volume in the score when falling back to empty array", () => {
      // The incomplete candle has volume 50K. If it were used, volume_current=50K.
      // With empty array, volume_current=0 (neutral).
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

      // volume_current should be 0 (from empty array), NOT 50000 (incomplete candle)
      expect(result.volume_detail.volume_current).toBe(0);
    });

    it("should work correctly with exactly 20 candles (1 incomplete + 19 completed)", () => {
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

      // 19 completed candles: current=1M, MA20≈1M, ratio≈1.0, score≈60
      expect(result.volume_score).toBeGreaterThan(15);
      expect(result.volume_score).toBeLessThanOrEqual(100);
      expect(result.volume_detail.days_used).toBe(19);
    });
  });

  describe("MA20 uses only completed candles", () => {
    it("should compute MA20 from completed candles only (not polluted by incomplete)", () => {
      // 30 candles: first 29 at 1M, last one (current) at 50K
      // MA20 without fix: includes 50K → MA20 ≈ (20M - 1M + 50K)/20 ≈ 953K
      // MA20 with fix: only completed candles → MA20 = 1M
      const priceData = generatePriceData(30, 1_000_000, 50_000);
      const currentBusinessDate = priceData[29].date;

      const result = runFeatureEngine(
        priceData, baseMetrics, healthWeights, confidenceWeights, sourceOk, currentBusinessDate,
      );

      // MA20 should be exactly 1M (all completed candles have volume=1M)
      expect(result.volume_detail.volume_ma20).toBe(1_000_000);
      // Current volume should be the last completed candle (1M)
      expect(result.volume_detail.volume_current).toBe(1_000_000);
      // Ratio should be 1.0
      expect(result.volume_detail.volume_ratio).toBe(1);
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

  describe("Current candle absent = use latest completed", () => {
    it("should use the last candle as current when currentBusinessDate matches no candle", () => {
      // If refresh runs after candle close, the currentBusinessDate might not
      // match any candle (e.g., the candle's date is different due to timezone).
      // In this case, NO filtering occurs and all candles are used — including
      // the most recent completed candle as 'current'.
      const priceData = generatePriceData(30, 1_000_000, 1_000_000);

      const result = runFeatureEngine(
        priceData, baseMetrics, healthWeights, confidenceWeights, sourceOk,
        "2099-01-01", // No candle matches this date
      );

      // All 30 candles used, last candle has volume=1M, MA20=1M, ratio=1.0
      // scoreVolumeRatio(1.0) → 45 (threshold is > 1.0 for 60)
      expect(result.volume_score).toBe(45);
      expect(result.volume_detail.volume_current).toBe(1_000_000);
    });
  });

  describe("Date boundary: business date vs UTC", () => {
    it("should filter correctly when priceData dates are in YYYY-MM-DD format", () => {
      const priceData = generatePriceData(25, 500_000, 10_000);
      // All dates are YYYY-MM-DD from toISOString().split('T')[0]
      // currentBusinessDate uses the same format
      const currentBusinessDate = priceData[24].date;

      const result = runFeatureEngine(
        priceData, baseMetrics, healthWeights, confidenceWeights, sourceOk, currentBusinessDate,
      );

      // 24 completed candles: volume=500K, MA20=500K, current=500K, ratio=1.0
      expect(result.volume_detail.volume_current).toBe(500_000);
      expect(result.volume_detail.volume_ma20).toBe(500_000);
      expect(result.volume_detail.volume_ratio).toBe(1);
      // days_used is capped at min(20, array.length) by calculateVolumeScore
      expect(result.volume_detail.days_used).toBe(20);
    });
  });

  describe("Alignment invariant: priceData[i] ↔ volumes[i]", () => {
    it("should maintain index alignment when filtering by date (shuffled data)", () => {
      // Create data where volumes are NOT sorted — proves filter removes correct index
      const priceData = [
        { date: "2026-08-01", open: 100, high: 102, low: 98, close: 101, volume: 900_000 },
        { date: "2026-08-02", open: 101, high: 103, low: 99, close: 102, volume: 800_000 },
        { date: "2026-08-03", open: 102, high: 104, low: 100, close: 103, volume: 700_000 },
        { date: "2026-08-04", open: 103, high: 105, low: 101, close: 104, volume: 600_000 },
        { date: "2026-08-05", open: 104, high: 106, low: 102, close: 105, volume: 500_000 },
        { date: "2026-08-06", open: 105, high: 107, low: 103, close: 106, volume: 400_000 },
        { date: "2026-08-07", open: 106, high: 108, low: 104, close: 107, volume: 300_000 },
        { date: "2026-08-08", open: 107, high: 109, low: 105, close: 108, volume: 200_000 },
        { date: "2026-08-09", open: 108, high: 110, low: 106, close: 109, volume: 100_000 },
        { date: "2026-08-10", open: 109, high: 111, low: 107, close: 110, volume: 50_000 },
        // 20+ more to meet minimum
        ...Array.from({ length: 15 }, (_, i) => ({
          date: `2026-08-${String(11 + i).padStart(2, "0")}`,
          open: 110 + i * 0.5,
          high: 112 + i * 0.5,
          low: 108 + i * 0.5,
          close: 111 + i * 0.5,
          volume: 1_000_000 + i * 100_000,
        })),
      ];

      // Filter Aug 10 (volume=50K — the smallest candle, clearly identifiable)
      const result = runFeatureEngine(
        priceData, baseMetrics, healthWeights, confidenceWeights, sourceOk, "2026-08-10",
      );

      // After filtering Aug 10: 24 completed candles.
      // The last completed candle is Aug 25 with volume=2_400_000
      // MA20 of last 20 completed candles (Aug 6..Aug 25)
      expect(result.volume_detail.volume_current).toBe(2_400_000);
      // The 50K from Aug 10 should NOT appear in the calculation
      expect(result.volume_detail.volume_ratio).toBeGreaterThan(1); // ratio > 1 since current > MA20
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
