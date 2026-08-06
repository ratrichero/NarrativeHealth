import { describe, it, expect } from "@jest/globals";
import {
  calculateWeightedNarrativeHealth,
  scoreToStatus,
  type CoinHealthData,
} from "../narrative-health";

describe("calculateWeightedNarrativeHealth", () => {
  // ─── CRITICAL TEST CASE: CARV/BLUAI/TRUTH ───────────────────────────
  describe("CARV/BLUAI/TRUTH test case (market-cap weighting)", () => {
    const coins: CoinHealthData[] = [
      { coinId: 1, symbol: "CARV", healthScore: 95, confidenceScore: 90, marketCap: 500_000_000 },
      { coinId: 2, symbol: "BLUAI", healthScore: 93, confidenceScore: 88, marketCap: 200_000_000 },
      { coinId: 3, symbol: "TRUTH", healthScore: 15, confidenceScore: 50, marketCap: 5_000_000 },
    ];

    const result = calculateWeightedNarrativeHealth(1, "2026-01-01", coins, 1);

    it("should use market_cap weighting method", () => {
      expect(result.weightingMethod).toBe("market_cap");
    });

    it("should produce weighted health ≈ 93.86 (NOT simple avg 67.67)", () => {
      // totalMcap = 705,000,000
      // CARV weight = 500M/705M ≈ 0.7092
      // BLUAI weight = 200M/705M ≈ 0.2837
      // TRUTH weight = 5M/705M ≈ 0.0071
      // weightedHealth = 95×0.7092 + 93×0.2837 + 15×0.0071 ≈ 93.86
      expect(result.healthScore).toBeCloseTo(93.86, 0);
    });

    it("should return STRONG status (≥90), not NEUTRAL", () => {
      expect(result.status).toBe("STRONG");
    });

    it("should identify CARV as topCoin (highest healthScore)", () => {
      expect(result.topCoinId).toBe(1);
    });

    it("should identify TRUTH as weakestCoin (lowest healthScore)", () => {
      expect(result.weakestCoinId).toBe(3);
    });

    it("should have weightDetails with all 3 coins", () => {
      expect(Object.keys(result.weightDetails)).toHaveLength(3);
      expect(result.weightDetails["CARV"]).toBeDefined();
      expect(result.weightDetails["BLUAI"]).toBeDefined();
      expect(result.weightDetails["TRUTH"]).toBeDefined();
    });

    it("weight sum in weightDetails should ≈ 1.0", () => {
      const weightSum =
        result.weightDetails["CARV"].weight +
        result.weightDetails["BLUAI"].weight +
        result.weightDetails["TRUTH"].weight;
      expect(weightSum).toBeCloseTo(1.0, 3);
    });

    it("CARV should have the largest weight", () => {
      expect(result.weightDetails["CARV"].weight).toBeGreaterThan(
        result.weightDetails["BLUAI"].weight
      );
      expect(result.weightDetails["BLUAI"].weight).toBeGreaterThan(
        result.weightDetails["TRUTH"].weight
      );
    });
  });

  // ─── Equal weight fallback ──────────────────────────────────────────
  describe("Falls back to equal weight when ANY coin missing mcap", () => {
    const coins: CoinHealthData[] = [
      { coinId: 1, symbol: "COIN_A", healthScore: 80, confidenceScore: 85, marketCap: 500_000_000 },
      { coinId: 2, symbol: "COIN_B", healthScore: 70, confidenceScore: 75, marketCap: null }, // missing!
      { coinId: 3, symbol: "COIN_C", healthScore: 60, confidenceScore: 65, marketCap: 100_000_000 },
    ];

    const result = calculateWeightedNarrativeHealth(1, "2026-01-01", coins, 1);

    it("should use equal weighting method", () => {
      expect(result.weightingMethod).toBe("equal");
    });

    it("should produce simple average = (80+70+60)/3 = 70", () => {
      expect(result.healthScore).toBeCloseTo(70, 0);
    });

    it("all weights should be 1/3", () => {
      expect(result.weightDetails["COIN_A"].weight).toBeCloseTo(1 / 3, 4);
      expect(result.weightDetails["COIN_B"].weight).toBeCloseTo(1 / 3, 4);
      expect(result.weightDetails["COIN_C"].weight).toBeCloseTo(1 / 3, 4);
    });
  });

  // ─── Falls back when market cap is 0 ────────────────────────────────
  describe("Falls back to equal weight when market cap is 0", () => {
    const coins: CoinHealthData[] = [
      { coinId: 1, symbol: "COIN_A", healthScore: 80, confidenceScore: 85, marketCap: 0 },
      { coinId: 2, symbol: "COIN_B", healthScore: 70, confidenceScore: 75, marketCap: 100_000_000 },
    ];

    const result = calculateWeightedNarrativeHealth(1, "2026-01-01", coins, 1);

    it("should use equal weighting method", () => {
      expect(result.weightingMethod).toBe("equal");
    });
  });

  // ─── Score change calculation ───────────────────────────────────────
  describe("scoreChange calculation", () => {
    const coins: CoinHealthData[] = [
      { coinId: 1, symbol: "COIN_A", healthScore: 80, confidenceScore: 85, marketCap: 500_000_000 },
    ];

    it("should calculate scoreChange when previousScore provided", () => {
      const result = calculateWeightedNarrativeHealth(1, "2026-01-01", coins, 1, 75);
      expect(result.scoreChange).toBeCloseTo(5, 2); // 80 - 75 = 5
    });

    it("should return null scoreChange when no previousScore", () => {
      const result = calculateWeightedNarrativeHealth(1, "2026-01-01", coins, 1);
      expect(result.scoreChange).toBeNull();
    });

    it("should handle negative scoreChange", () => {
      const result = calculateWeightedNarrativeHealth(1, "2026-01-01", coins, 1, 85);
      expect(result.scoreChange).toBeCloseTo(-5, 2); // 80 - 85 = -5
    });
  });

  // ─── Top/weakest coin identification ────────────────────────────────
  describe("topCoin and weakestCoin identification", () => {
    it("should identify topCoin = highest healthScore coin", () => {
      const coins: CoinHealthData[] = [
        { coinId: 1, symbol: "LOW", healthScore: 30, confidenceScore: 50, marketCap: 100_000_000 },
        { coinId: 2, symbol: "HIGH", healthScore: 95, confidenceScore: 90, marketCap: 100_000_000 },
        { coinId: 3, symbol: "MID", healthScore: 60, confidenceScore: 70, marketCap: 100_000_000 },
      ];
      const result = calculateWeightedNarrativeHealth(1, "2026-01-01", coins, 1);
      expect(result.topCoinId).toBe(2); // HIGH
    });

    it("should identify weakestCoin = lowest healthScore coin", () => {
      const coins: CoinHealthData[] = [
        { coinId: 1, symbol: "LOW", healthScore: 30, confidenceScore: 50, marketCap: 100_000_000 },
        { coinId: 2, symbol: "HIGH", healthScore: 95, confidenceScore: 90, marketCap: 100_000_000 },
        { coinId: 3, symbol: "MID", healthScore: 60, confidenceScore: 70, marketCap: 100_000_000 },
      ];
      const result = calculateWeightedNarrativeHealth(1, "2026-01-01", coins, 1);
      expect(result.weakestCoinId).toBe(1); // LOW
    });
  });

  // ─── Average confidence ─────────────────────────────────────────────
  describe("avgConfidence calculation", () => {
    it("should calculate average confidence correctly", () => {
      const coins: CoinHealthData[] = [
        { coinId: 1, symbol: "A", healthScore: 80, confidenceScore: 90, marketCap: 100_000_000 },
        { coinId: 2, symbol: "B", healthScore: 70, confidenceScore: 60, marketCap: 100_000_000 },
      ];
      const result = calculateWeightedNarrativeHealth(1, "2026-01-01", coins, 1);
      expect(result.avgConfidence).toBeCloseTo(75, 0); // (90+60)/2 = 75
    });
  });

  // ─── Edge case: empty coins ─────────────────────────────────────────
  describe("edge case: empty coins array", () => {
    it("should handle empty coins gracefully", () => {
      const result = calculateWeightedNarrativeHealth(1, "2026-01-01", [], 1);
      expect(result.healthScore).toBe(0);
      expect(result.status).toBe("WEAK");
      expect(result.topCoinId).toBeNull();
      expect(result.weakestCoinId).toBeNull();
      expect(result.weightingMethod).toBe("equal");
    });
  });

  // ─── ruleVersionId passthrough ──────────────────────────────────────
  describe("ruleVersionId passthrough", () => {
    it("should pass ruleVersionId through to result", () => {
      const coins: CoinHealthData[] = [
        { coinId: 1, symbol: "A", healthScore: 80, confidenceScore: 85, marketCap: 100_000_000 },
      ];
      const result = calculateWeightedNarrativeHealth(1, "2026-01-01", coins, 42);
      expect(result.ruleVersionId).toBe(42);
    });
  });
});

describe("scoreToStatus", () => {
  it("≥ 90 → STRONG", () => {
    expect(scoreToStatus(90)).toBe("STRONG");
    expect(scoreToStatus(100)).toBe("STRONG");
  });

  it("≥ 80 → HEALTHY", () => {
    expect(scoreToStatus(80)).toBe("HEALTHY");
    expect(scoreToStatus(89)).toBe("HEALTHY");
  });

  it("≥ 65 → NEUTRAL", () => {
    expect(scoreToStatus(65)).toBe("NEUTRAL");
    expect(scoreToStatus(79)).toBe("NEUTRAL");
  });

  it("≥ 50 → CAUTION", () => {
    expect(scoreToStatus(50)).toBe("CAUTION");
    expect(scoreToStatus(64)).toBe("CAUTION");
  });

  it("< 50 → WEAK", () => {
    expect(scoreToStatus(49)).toBe("WEAK");
    expect(scoreToStatus(0)).toBe("WEAK");
  });
});