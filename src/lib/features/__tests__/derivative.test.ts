import { calculateDerivativeScore } from "../derivative";

describe("calculateDerivativeScore", () => {
  // ═══════════════════════════════════════════════════════
  // MONOTONICITY TESTS
  // ═══════════════════════════════════════════════════════

  describe("Monotonicity — OI change", () => {
    it("should increase score as OI change increases (fixed funding)", () => {
      const fundingRate = 0; // neutral
      const scores: number[] = [];
      for (const oiPct of [-20, -10, -5, 0, 5, 10, 20, 30]) {
        const oiCurrent = 1000 + (oiPct / 100) * 1000;
        const result = calculateDerivativeScore(oiCurrent, 1000, fundingRate, true);
        scores.push(result.score);
      }
      // Each subsequent score should be >= previous (monotonic non-decreasing)
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
      }
    });
  });

  describe("Monotonicity — Funding rate", () => {
    it("should increase score as funding rate decreases (fixed OI)", () => {
      const oiCurrent = 1100; // +10% OI
      const scores: number[] = [];
      for (const rate of [0.001, 0.0005, 0.0002, 0, -0.0002, -0.0005, -0.001]) {
        const result = calculateDerivativeScore(oiCurrent, 1000, rate, true);
        scores.push(result.score);
      }
      // Each subsequent score should be >= previous (monotonic non-decreasing as rate decreases)
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
      }
    });
  });

  // ═══════════════════════════════════════════════════════
  // BOUNDARY TESTS
  // ═══════════════════════════════════════════════════════

  describe("Boundary — neutral inputs", () => {
    it("should return ~50 for zero OI change and zero funding", () => {
      const result = calculateDerivativeScore(1000, 1000, 0, true);
      expect(result.score).toBeGreaterThanOrEqual(48);
      expect(result.score).toBeLessThanOrEqual(55);
      expect(result.detail.oi_change_pct).toBe(0);
    });
  });

  describe("Boundary — extreme bullish", () => {
    it("should return high score for large OI increase + negative funding", () => {
      const result = calculateDerivativeScore(1500, 1000, -0.001, true);
      expect(result.score).toBeGreaterThan(70);
      expect(result.detail.oi_change_pct).toBe(50);
      expect(result.detail.accumulation_bonus).toBe(10);
    });
  });

  describe("Boundary — extreme bearish", () => {
    it("should return low score for large OI decrease + positive funding", () => {
      const result = calculateDerivativeScore(500, 1000, 0.001, true);
      expect(result.score).toBeLessThan(35);
      expect(result.detail.oi_change_pct).toBe(-50);
    });
  });

  describe("Boundary — score clipping", () => {
    it("should never exceed 100", () => {
      const result = calculateDerivativeScore(10000, 1000, -0.001, true);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it("should never go below 0", () => {
      const result = calculateDerivativeScore(1, 1000, 0.001, true);
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  // ═══════════════════════════════════════════════════════
  // MISSING / INVALID DATA
  // ═══════════════════════════════════════════════════════

  describe("Missing data — no futures", () => {
    it("should return 50 when hasFutures is false", () => {
      const result = calculateDerivativeScore(1000, 1000, 0, false);
      expect(result.score).toBe(50);
      expect(result.detail.no_futures).toBe(true);
      expect(result.detail.oi_change_pct).toBe(0);
    });
  });

  describe("Missing data — null OI", () => {
    it("should handle null OI current", () => {
      const result = calculateDerivativeScore(null, 1000, 0, true);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.detail.oi_change_pct).toBe(0);
    });

    it("should handle null OI previous", () => {
      const result = calculateDerivativeScore(1000, null, 0, true);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.detail.oi_change_pct).toBe(0);
    });

    it("should handle both OI null", () => {
      const result = calculateDerivativeScore(null, null, 0, true);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  describe("Missing data — null funding rate", () => {
    it("should handle null funding rate with default component", () => {
      const result = calculateDerivativeScore(1100, 1000, null, true);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.detail.funding_rate).toBeNull();
    });
  });

  describe("Missing data — zero previous OI", () => {
    it("should handle zero previous OI without division by zero", () => {
      const result = calculateDerivativeScore(1000, 0, 0, true);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.detail.oi_change_pct).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════
  // DETERMINISTIC OUTPUT
  // ═══════════════════════════════════════════════════════

  describe("Deterministic output", () => {
    it("should return the same score for the same inputs", () => {
      const r1 = calculateDerivativeScore(1100, 1000, -0.0003, true);
      const r2 = calculateDerivativeScore(1100, 1000, -0.0003, true);
      expect(r1.score).toBe(r2.score);
      expect(r1.detail.oi_change_pct).toBe(r2.detail.oi_change_pct);
    });

    it("should return the same score across multiple calls", () => {
      for (let i = 0; i < 10; i++) {
        const result = calculateDerivativeScore(1050, 1000, 0.0001, true);
        expect(result.score).toBe(calculateDerivativeScore(1050, 1000, 0.0001, true).score);
      }
    });
  });

  // ═══════════════════════════════════════════════════════
  // POSITIVE / NEGATIVE EXTREMES
  // ═══════════════════════════════════════════════════════

  describe("Positive extremes", () => {
    it("should handle very large OI increase", () => {
      const result = calculateDerivativeScore(10000, 1000, -0.001, true);
      expect(result.score).toBeGreaterThan(70);
      expect(result.detail.oi_change_pct).toBe(900);
    });

    it("should handle very negative funding", () => {
      const result = calculateDerivativeScore(1100, 1000, -0.01, true);
      expect(result.score).toBeGreaterThan(60);
    });
  });

  describe("Negative extremes", () => {
    it("should handle OI going to zero", () => {
      const result = calculateDerivativeScore(0, 1000, 0.001, true);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThan(40);
    });

    it("should handle very positive funding", () => {
      const result = calculateDerivativeScore(900, 1000, 0.01, true);
      expect(result.score).toBeLessThan(40);
    });
  });

  // ═══════════════════════════════════════════════════════
  // SEMANTIC DIRECTION
  // ═══════════════════════════════════════════════════════

  describe("Semantic direction", () => {
    it("bullish signal (OI↑ + negative funding) should score higher than bearish (OI↓ + positive funding)", () => {
      const bullish = calculateDerivativeScore(1200, 1000, -0.0005, true);
      const bearish = calculateDerivativeScore(800, 1000, 0.0005, true);
      expect(bullish.score).toBeGreaterThan(bearish.score);
    });

    it("neutral should score between bullish and bearish", () => {
      const bullish = calculateDerivativeScore(1200, 1000, -0.0005, true);
      const neutral = calculateDerivativeScore(1000, 1000, 0, true);
      const bearish = calculateDerivativeScore(800, 1000, 0.0005, true);
      expect(bullish.score).toBeGreaterThan(neutral.score);
      expect(neutral.score).toBeGreaterThan(bearish.score);
    });
  });

  // ═══════════════════════════════════════════════════════
  // CONTINUOUS OUTPUT
  // ═══════════════════════════════════════════════════════

  describe("Continuous output", () => {
    it("should produce more than 12 unique values across a range of inputs", () => {
      const scores = new Set<number>();
      for (let oi = 800; oi <= 1200; oi += 10) {
        for (let fund = -0.0005; fund <= 0.0005; fund += 0.00005) {
          const result = calculateDerivativeScore(oi, 1000, fund, true);
          scores.add(result.score);
        }
      }
      expect(scores.size).toBeGreaterThan(12);
    });

    it("should produce fractional scores (not just integers)", () => {
      const scores = new Set<number>();
      for (let oi = 900; oi <= 1100; oi += 5) {
        const result = calculateDerivativeScore(oi, 1000, 0.0001, true);
        scores.add(result.score);
      }
      // Should have at least one non-integer score
      const hasFraction = [...scores].some(s => s !== Math.floor(s));
      expect(hasFraction).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════
  // DETAIL FIELDS
  // ═══════════════════════════════════════════════════════

  describe("Detail fields", () => {
    it("should populate all detail fields correctly", () => {
      const result = calculateDerivativeScore(1100, 1000, -0.0003, true);
      expect(result.detail.oi_current).toBe(1100);
      expect(result.detail.oi_prev).toBe(1000);
      expect(result.detail.oi_change_pct).toBe(10);
      expect(result.detail.funding_rate).toBe(-0.0003);
      expect(result.detail.no_futures).toBe(false);
      expect(typeof result.detail.oi_component).toBe("number");
      expect(typeof result.detail.funding_component).toBe("number");
    });

    it("should set no_futures correctly", () => {
      const withFutures = calculateDerivativeScore(1100, 1000, 0, true);
      const withoutFutures = calculateDerivativeScore(1100, 1000, 0, false);
      expect(withFutures.detail.no_futures).toBe(false);
      expect(withoutFutures.detail.no_futures).toBe(true);
    });
  });
});
