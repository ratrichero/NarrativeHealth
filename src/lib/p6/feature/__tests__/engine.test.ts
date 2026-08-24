// P6 Feature Engine — Comprehensive Test Suite
// Authority: P6-02B, P6-02C, P6-02C2
// Tests: quality gating, UNKNOWN inclusion, INVALID/MISSING exclusion,
// confidence formula edge cases, deterministic output, version propagation,
// provenance, freshness separation, backward compatibility

import { runP6FeatureEngine, computeConfidence, computeTrend, computeVolume, computeMomentum, computeDerivative, computeHealth } from "../engine";
import type { FeatureObservation, P6FeatureInput, FeatureVersionTuple, HealthDimensionName } from "../types";
import { DEFAULT_HEALTH_WEIGHTS, NEUTRAL_SCORE } from "../types";

// ─── TEST HELPERS ────────────────────────────────────────────────────

function makeObs(
  overrides: Partial<FeatureObservation> & { entity_id: number; metric: string }
): FeatureObservation {
  return {
    source: "BINANCE_SPOT",
    observed_at: new Date("2025-01-01"),
    timeframe: "DAILY",
    value: 100,
    quality_status: "VALID",
    freshness_status: "FRESH",
    ...overrides,
  } as FeatureObservation;
}

function makeTrendObs(n: number, opts: Partial<FeatureObservation> = {}): FeatureObservation[] {
  return Array.from({ length: n }, (_, i) =>
    makeObs({
      entity_id: 1,
      metric: "CLOSE",
      value: 100 + i * 0.5,
      observed_at: new Date(`2025-01-${String(i + 1).padStart(2, "0")}`),
      ...opts,
    })
  );
}

function makeVolumeObs(n: number, opts: Partial<FeatureObservation> = {}): FeatureObservation[] {
  return Array.from({ length: n }, (_, i) =>
    makeObs({
      entity_id: 1,
      metric: "VOLUME",
      value: 1000 + i * 100,
      observed_at: new Date(`2025-01-${String(i + 1).padStart(2, "0")}`),
      ...opts,
    })
  );
}

function makeFullInput(overrides: Partial<P6FeatureInput> = {}): P6FeatureInput {
  const trendObs = makeTrendObs(25);
  const volumeObs = makeVolumeObs(25);
  return {
    entity_id: 1,
    timeframe: "DAILY",
    trend_observations: trendObs,
    volume_observations: volumeObs,
    close_observations: trendObs,
    high_observations: trendObs.map((o) => ({ ...o, metric: "HIGH" as const, value: o.value + 2 })),
    low_observations: trendObs.map((o) => ({ ...o, metric: "LOW" as const, value: o.value - 2 })),
    oi_observations: [],
    fr_observations: [],
    source_availability: { BINANCE_SPOT: true, BINANCE_FUTURES: false, COINGECKO: false },
    all_observations: [...trendObs, ...volumeObs],
    expected_counts: { BINANCE_SPOT: 25, BINANCE_FUTURES: 0, COINGECKO: 0 },
    ...overrides,
  };
}

// ─── V1 FEATURES ─────────────────────────────────────────────────────

describe("P6 Feature Engine", () => {
  describe("V1 Features", () => {
    test("TREND: computes EMA-based score from quality-gated CLOSE observations", () => {
      const input = makeFullInput();
      const result = runP6FeatureEngine(input);
      expect(result.trend_score).toBeGreaterThanOrEqual(0);
      expect(result.trend_score).toBeLessThanOrEqual(100);
      expect(result.trend_detail).toBeDefined();
      expect(result.trend_detail.ema20).toBeGreaterThan(0);
    });

    test("VOLUME: computes MA-20 volume ratio score", () => {
      const input = makeFullInput();
      const result = runP6FeatureEngine(input);
      expect(result.volume_score).toBeGreaterThanOrEqual(0);
      expect(result.volume_score).toBeLessThanOrEqual(100);
      expect(result.volume_detail).toBeDefined();
      expect(result.volume_detail.volume_ma20).toBeGreaterThan(0);
    });

    test("MOMENTUM: computes ROC+ATR score from CLOSE/HIGH/LOW", () => {
      const input = makeFullInput();
      const result = runP6FeatureEngine(input);
      expect(result.momentum_score).toBeGreaterThanOrEqual(0);
      expect(result.momentum_score).toBeLessThanOrEqual(100);
      expect(result.momentum_detail).toBeDefined();
    });

    test("DERIVATIVE: returns neutral when no OI/FR observations", () => {
      const input = makeFullInput();
      const result = runP6FeatureEngine(input);
      expect(result.derivative_score).toBe(NEUTRAL_SCORE);
      expect(result.derivative_detail.no_futures).toBe(true);
    });

    test("HEALTH: aggregates 4 dimensions with equal weights", () => {
      const input = makeFullInput();
      const result = runP6FeatureEngine(input);
      expect(result.health_score).toBeGreaterThanOrEqual(0);
      expect(result.health_score).toBeLessThanOrEqual(100);
      expect(result.health_dimensions).toHaveLength(4);
      for (const dim of result.health_dimensions) {
        expect(dim.weight).toBe(0.25);
      }
    });

    test("CONFIDENCE: quality-adjusted formula returns valid score", () => {
      const input = makeFullInput();
      const result = runP6FeatureEngine(input);
      expect(result.confidence_score).toBeGreaterThanOrEqual(0);
      expect(result.confidence_score).toBeLessThanOrEqual(100);
      expect(result.data_completeness).toBeGreaterThanOrEqual(0);
      expect(result.data_completeness).toBeLessThanOrEqual(100);
    });
  });

  // ─── QUALITY GATING ────────────────────────────────────────────────

  describe("Quality Gating", () => {
    test("VALID observations are included", () => {
      const obs = makeTrendObs(25, { quality_status: "VALID" });
      const result = computeTrend(obs);
      expect(result.score).not.toBe(NEUTRAL_SCORE);
    });

    test("INVALID observations are excluded", () => {
      const obs = makeTrendObs(25, { quality_status: "INVALID" });
      const result = computeTrend(obs);
      // All excluded → returns neutral
      expect(result.score).toBe(NEUTRAL_SCORE);
    });

    test("MISSING observations are excluded", () => {
      const obs = makeTrendObs(25, { quality_status: "MISSING" });
      const result = computeTrend(obs);
      expect(result.score).toBe(NEUTRAL_SCORE);
    });

    test("UNKNOWN observations are INCLUDED (not excluded)", () => {
      const obs = makeTrendObs(25, { quality_status: "UNKNOWN" });
      const result = computeTrend(obs);
      expect(result.score).not.toBe(NEUTRAL_SCORE);
    });

    test("Mixed VALID + INVALID: only VALID used", () => {
      const validObs = makeTrendObs(20, { quality_status: "VALID" });
      const invalidObs = makeTrendObs(5, { quality_status: "INVALID" });
      const result = computeTrend([...validObs, ...invalidObs]);
      expect(result.score).not.toBe(NEUTRAL_SCORE);
    });

    test("Mixed VALID + MISSING: only VALID used", () => {
      const validObs = makeTrendObs(20, { quality_status: "VALID" });
      const missingObs = makeTrendObs(5, { quality_status: "MISSING" });
      const result = computeTrend([...validObs, ...missingObs]);
      expect(result.score).not.toBe(NEUTRAL_SCORE);
    });

    test("Mixed VALID + UNKNOWN: both included", () => {
      const validObs = makeTrendObs(20, { quality_status: "VALID" });
      const unknownObs = makeTrendObs(5, { quality_status: "UNKNOWN" });
      const validResult = computeTrend(validObs);
      const mixedResult = computeTrend([...validObs, ...unknownObs]);
      // UNKNOWN included → more data → potentially different score
      expect(mixedResult.score).not.toBe(NEUTRAL_SCORE);
    });

    test("INVALID per-metric: INVALID CLOSE does not exclude VOLUME", () => {
      const input = makeFullInput({
        close_observations: makeTrendObs(25, { quality_status: "INVALID" }),
        trend_observations: makeTrendObs(25, { quality_status: "INVALID" }),
        high_observations: makeTrendObs(25, { quality_status: "INVALID" }).map((o) => ({
          ...o,
          metric: "HIGH" as const,
          value: o.value + 2,
        })),
        low_observations: makeTrendObs(25, { quality_status: "INVALID" }).map((o) => ({
          ...o,
          metric: "LOW" as const,
          value: o.value - 2,
        })),
      });
      const result = runP6FeatureEngine(input);
      // VOLUME observations are still VALID
      expect(result.volume_score).not.toBe(NEUTRAL_SCORE);
    });
  });

  // ─── CONFIDENCE EDGE CASES ─────────────────────────────────────────

  describe("Confidence Formula Edge Cases", () => {
    test("denominator=0 (no sources available) → confidence=0", () => {
      const result = computeConfidence(
        [],
        { BINANCE_SPOT: false, BINANCE_FUTURES: false, COINGECKO: false },
        { BINANCE_SPOT: 0.4, BINANCE_FUTURES: 0.4, COINGECKO: 0.2 }
      );
      expect(result.confidence_score).toBe(0);
      expect(result.data_completeness).toBe(0);
      expect(result.missing_sources).toContain("binance_spot");
      expect(result.missing_sources).toContain("binance_futures");
      expect(result.missing_sources).toContain("coingecko");
    });

    test("all sources available, all VALID → confidence=100", () => {
      const obs = [
        ...makeTrendObs(10, { source: "BINANCE_SPOT", quality_status: "VALID" }),
        ...makeTrendObs(10, { source: "BINANCE_FUTURES", quality_status: "VALID" }),
        ...makeTrendObs(10, { source: "COINGECKO", quality_status: "VALID" }),
      ];
      const result = computeConfidence(
        obs,
        { BINANCE_SPOT: true, BINANCE_FUTURES: true, COINGECKO: true },
        { BINANCE_SPOT: 0.4, BINANCE_FUTURES: 0.4, COINGECKO: 0.2 }
      );
      expect(result.confidence_score).toBe(100);
    });

    test("some INVALID → confidence < 100", () => {
      const obs = [
        ...makeTrendObs(5, { source: "BINANCE_SPOT", quality_status: "VALID" }),
        ...makeTrendObs(5, { source: "BINANCE_SPOT", quality_status: "INVALID" }),
        ...makeTrendObs(10, { source: "BINANCE_FUTURES", quality_status: "VALID" }),
        ...makeTrendObs(10, { source: "COINGECKO", quality_status: "VALID" }),
      ];
      const result = computeConfidence(
        obs,
        { BINANCE_SPOT: true, BINANCE_FUTURES: true, COINGECKO: true },
        { BINANCE_SPOT: 0.4, BINANCE_FUTURES: 0.4, COINGECKO: 0.2 }
      );
      // Spot quality_ratio = 5/10 = 0.5
      // (0.4*0.5 + 0.4*1.0 + 0.2*1.0) / (0.4+0.4+0.2) = (0.2+0.4+0.2)/1.0 = 0.8 = 80.0
      expect(result.confidence_score).toBe(80.0);
    });

    test("UNKNOWN quality not counted as VALID", () => {
      const obs = [
        ...makeTrendObs(10, { source: "BINANCE_SPOT", quality_status: "UNKNOWN" }),
        ...makeTrendObs(10, { source: "BINANCE_FUTURES", quality_status: "VALID" }),
        ...makeTrendObs(10, { source: "COINGECKO", quality_status: "VALID" }),
      ];
      const result = computeConfidence(
        obs,
        { BINANCE_SPOT: true, BINANCE_FUTURES: true, COINGECKO: true },
        { BINANCE_SPOT: 0.4, BINANCE_FUTURES: 0.4, COINGECKO: 0.2 }
      );
      // Spot quality_ratio = 0/10 = 0 (UNKNOWN not counted as VALID)
      // (0.4*0 + 0.4*1.0 + 0.2*1.0) / (0.4+0.4+0.2) = 0.6/1.0 = 60.0
      expect(result.confidence_score).toBe(60.0);
    });

    test("MISSING quality not counted as VALID", () => {
      const obs = [
        ...makeTrendObs(10, { source: "BINANCE_SPOT", quality_status: "MISSING" }),
        ...makeTrendObs(10, { source: "BINANCE_FUTURES", quality_status: "VALID" }),
        ...makeTrendObs(10, { source: "COINGECKO", quality_status: "VALID" }),
      ];
      const result = computeConfidence(
        obs,
        { BINANCE_SPOT: true, BINANCE_FUTURES: true, COINGECKO: true },
        { BINANCE_SPOT: 0.4, BINANCE_FUTURES: 0.4, COINGECKO: 0.2 }
      );
      // Spot quality_ratio = 0/10 = 0 (MISSING not counted as VALID)
      expect(result.confidence_score).toBe(60.0);
    });

    test("rounding to 1 decimal", () => {
      const obs = [
        ...makeTrendObs(7, { source: "BINANCE_SPOT", quality_status: "VALID" }),
        ...makeTrendObs(3, { source: "BINANCE_SPOT", quality_status: "INVALID" }),
      ];
      const result = computeConfidence(
        obs,
        { BINANCE_SPOT: true, BINANCE_FUTURES: false, COINGECKO: false },
        { BINANCE_SPOT: 0.4, BINANCE_FUTURES: 0.4, COINGECKO: 0.2 }
      );
      // Only spot available: quality_ratio = 7/10 = 0.7
      // confidence = (0.4 * 0.7) / 0.4 = 0.7 = 70.0
      expect(result.confidence_score).toBe(70.0);
    });

    test("clamp to [0, 100]", () => {
      const result = computeConfidence(
        [],
        { BINANCE_SPOT: true, BINANCE_FUTURES: true, COINGECKO: true },
        { BINANCE_SPOT: 0.4, BINANCE_FUTURES: 0.4, COINGECKO: 0.2 }
      );
      expect(result.confidence_score).toBeGreaterThanOrEqual(0);
      expect(result.confidence_score).toBeLessThanOrEqual(100);
    });

    test("freshness NOT used in confidence formula", () => {
      const freshObs = makeTrendObs(10, {
        source: "BINANCE_SPOT",
        quality_status: "VALID",
        freshness_status: "FRESH",
      });
      const staleObs = makeTrendObs(10, {
        source: "BINANCE_SPOT",
        quality_status: "VALID",
        freshness_status: "STALE",
      });
      const freshResult = computeConfidence(
        freshObs,
        { BINANCE_SPOT: true, BINANCE_FUTURES: false, COINGECKO: false },
        { BINANCE_SPOT: 0.4, BINANCE_FUTURES: 0.4, COINGECKO: 0.2 }
      );
      const staleResult = computeConfidence(
        staleObs,
        { BINANCE_SPOT: true, BINANCE_FUTURES: false, COINGECKO: false },
        { BINANCE_SPOT: 0.4, BINANCE_FUTURES: 0.4, COINGECKO: 0.2 }
      );
      expect(freshResult.confidence_score).toBe(staleResult.confidence_score);
    });
  });

  // ─── DETERMINISM ───────────────────────────────────────────────────

  describe("Determinism", () => {
    test("same inputs produce same output", () => {
      const input = makeFullInput();
      const result1 = runP6FeatureEngine(input);
      const result2 = runP6FeatureEngine(input);
      expect(result1.trend_score).toBe(result2.trend_score);
      expect(result1.volume_score).toBe(result2.volume_score);
      expect(result1.momentum_score).toBe(result2.momentum_score);
      expect(result1.derivative_score).toBe(result2.derivative_score);
      expect(result1.health_score).toBe(result2.health_score);
      expect(result1.confidence_score).toBe(result2.confidence_score);
    });

    test("different inputs produce different output", () => {
      const input1 = makeFullInput();
      // Decreasing prices → lower trend score
      const decreasingObs = Array.from({ length: 25 }, (_, i) =>
        makeObs({
          entity_id: 1,
          metric: "CLOSE",
          value: 200 - i * 2,
          observed_at: new Date(`2025-01-${String(i + 1).padStart(2, "0")}`),
        })
      );
      const input2 = makeFullInput({
        trend_observations: decreasingObs,
        close_observations: decreasingObs,
        high_observations: decreasingObs.map((o) => ({ ...o, metric: "HIGH" as const, value: o.value + 2 })),
        low_observations: decreasingObs.map((o) => ({ ...o, metric: "LOW" as const, value: o.value - 2 })),
      });
      const result1 = runP6FeatureEngine(input1);
      const result2 = runP6FeatureEngine(input2);
      expect(result1.trend_score).not.toBe(result2.trend_score);
    });
  });

  // ─── VERSION PROPAGATION ───────────────────────────────────────────

  describe("Version Propagation", () => {
    test("result contains version tuple", () => {
      const input = makeFullInput();
      const result = runP6FeatureEngine(input);
      expect(result.version).toBeDefined();
      expect(result.version.algorithm_version).toBe("1.0.0");
      expect(result.version.parameter_version).toBe("1.0.0");
      expect(result.version.schema_version).toBe("1.0.0");
      expect(result.version.config_hash).toBe("default-v1");
    });

    test("version is deterministic", () => {
      const input = makeFullInput();
      const r1 = runP6FeatureEngine(input);
      const r2 = runP6FeatureEngine(input);
      expect(r1.version).toEqual(r2.version);
    });
  });

  // ─── PROVENANCE ────────────────────────────────────────────────────

  describe("Provenance", () => {
    test("result contains complete provenance", () => {
      const input = makeFullInput();
      const result = runP6FeatureEngine(input);
      expect(result.provenance).toBeDefined();
      expect(result.provenance.input_observations.length).toBeGreaterThan(0);
      expect(result.provenance.algorithm_version).toBe("1.0.0");
      expect(result.provenance.parameter_version).toBe("1.0.0");
      expect(result.provenance.schema_version).toBe("1.0.0");
      expect(result.provenance.calculated_at).toBeInstanceOf(Date);
      expect(result.provenance.total_inputs_expected).toBeGreaterThanOrEqual(0);
      expect(result.provenance.total_inputs_used).toBeGreaterThanOrEqual(0);
    });

    test("provenance records quality_status per input", () => {
      const input = makeFullInput({
        trend_observations: makeTrendObs(25, { quality_status: "VALID" }),
        close_observations: makeTrendObs(25, { quality_status: "VALID" }),
        high_observations: makeTrendObs(25, { quality_status: "VALID" }).map((o) => ({
          ...o,
          metric: "HIGH" as const,
          value: o.value + 2,
        })),
        low_observations: makeTrendObs(25, { quality_status: "VALID" }).map((o) => ({
          ...o,
          metric: "LOW" as const,
          value: o.value - 2,
        })),
        volume_observations: makeVolumeObs(25, { quality_status: "VALID" }),
      });
      const result = runP6FeatureEngine(input);
      for (const obs of result.provenance.input_observations) {
        expect(obs.quality_status).toBeDefined();
        expect(["VALID", "INVALID", "MISSING", "UNKNOWN"]).toContain(obs.quality_status);
      }
    });

    test("provenance records excluded inputs", () => {
      const input = makeFullInput({
        trend_observations: [
          ...makeTrendObs(20, { quality_status: "VALID" }),
          ...makeTrendObs(5, { quality_status: "INVALID" }),
        ],
        close_observations: [
          ...makeTrendObs(20, { quality_status: "VALID" }),
          ...makeTrendObs(5, { quality_status: "INVALID" }),
        ],
        high_observations: [
          ...makeTrendObs(20, { quality_status: "VALID" }).map((o) => ({
            ...o,
            metric: "HIGH" as const,
            value: o.value + 2,
          })),
          ...makeTrendObs(5, { quality_status: "INVALID" }).map((o) => ({
            ...o,
            metric: "HIGH" as const,
            value: o.value + 2,
          })),
        ],
        low_observations: [
          ...makeTrendObs(20, { quality_status: "VALID" }).map((o) => ({
            ...o,
            metric: "LOW" as const,
            value: o.value - 2,
          })),
          ...makeTrendObs(5, { quality_status: "INVALID" }).map((o) => ({
            ...o,
            metric: "LOW" as const,
            value: o.value - 2,
          })),
        ],
        volume_observations: makeVolumeObs(25, { quality_status: "VALID" }),
      });
      const result = runP6FeatureEngine(input);
      expect(result.provenance.excluded_inputs.length).toBeGreaterThan(0);
      for (const excl of result.provenance.excluded_inputs) {
        expect(excl.reason).toContain("quality_status=INVALID");
      }
    });
  });

  // ─── FRESHNESS SEPARATION ──────────────────────────────────────────

  describe("Freshness Separation", () => {
    test("freshness does not affect quality gating", () => {
      const freshObs = makeTrendObs(25, {
        quality_status: "VALID",
        freshness_status: "FRESH",
      });
      const staleObs = makeTrendObs(25, {
        quality_status: "VALID",
        freshness_status: "STALE",
      });
      const freshResult = computeTrend(freshObs);
      const staleResult = computeTrend(staleObs);
      // Same quality, different freshness → same score (freshness not used in V1)
      expect(freshResult.score).toBe(staleResult.score);
    });

    test("STALE + VALID is still included", () => {
      const obs = makeTrendObs(25, {
        quality_status: "VALID",
        freshness_status: "STALE",
      });
      const result = computeTrend(obs);
      expect(result.score).not.toBe(NEUTRAL_SCORE);
    });

    test("FRESH + INVALID is still excluded", () => {
      // computeTrend only sees the trend observations passed to it
      // If ALL trend observations are INVALID, they're all excluded → neutral
      const obs = makeTrendObs(25, {
        quality_status: "INVALID",
        freshness_status: "FRESH",
      });
      const result = computeTrend(obs);
      expect(result.score).toBe(NEUTRAL_SCORE);
    });
  });

  // ─── HEALTH DIMENSIONS ─────────────────────────────────────────────

  describe("Health Dimensions", () => {
    test("equal weights default (25% each)", () => {
      const result = computeHealth(
        { TREND: 80, MOMENTUM: 60, VOLUME: 70, DERIVATIVE: 50 },
        { TREND: true, MOMENTUM: true, VOLUME: true, DERIVATIVE: true }
      );
      expect(result.dimensions).toHaveLength(4);
      for (const dim of result.dimensions) {
        expect(dim.weight).toBe(0.25);
      }
      // (80*0.25 + 60*0.25 + 70*0.25 + 50*0.25) / 1.0 = 65
      expect(result.score).toBe(65);
    });

    test("unavailable dimension returns neutral (50)", () => {
      const result = computeHealth(
        { TREND: 80, MOMENTUM: 60, VOLUME: 70, DERIVATIVE: 50 },
        { TREND: true, MOMENTUM: true, VOLUME: true, DERIVATIVE: false }
      );
      // DERIVATIVE unavailable → 50
      // (80*0.25 + 60*0.25 + 70*0.25 + 50*0.25) / 1.0 = 65
      expect(result.score).toBe(65);
      const derivDim = result.dimensions.find((d) => d.name === "DERIVATIVE");
      expect(derivDim?.available).toBe(false);
      expect(derivDim?.score).toBe(NEUTRAL_SCORE);
    });

    test("all unavailable → neutral (50)", () => {
      const result = computeHealth(
        { TREND: 80, MOMENTUM: 60, VOLUME: 70, DERIVATIVE: 50 },
        { TREND: false, MOMENTUM: false, VOLUME: false, DERIVATIVE: false }
      );
      expect(result.score).toBe(NEUTRAL_SCORE);
    });

    test("data_completeness reflects available dimensions", () => {
      const result = computeHealth(
        { TREND: 80, MOMENTUM: 60, VOLUME: 70, DERIVATIVE: 50 },
        { TREND: true, MOMENTUM: true, VOLUME: false, DERIVATIVE: false }
      );
      expect(result.data_completeness).toBe(50); // 2/4
    });
  });

  // ─── BACKWARD COMPATIBILITY ────────────────────────────────────────

  describe("Backward Compatibility", () => {
    test("output fields match legacy FeatureEngineResult shape", () => {
      const input = makeFullInput();
      const result = runP6FeatureEngine(input);
      // All legacy fields present
      expect(typeof result.trend_score).toBe("number");
      expect(typeof result.volume_score).toBe("number");
      expect(typeof result.momentum_score).toBe("number");
      expect(typeof result.derivative_score).toBe("number");
      expect(typeof result.confidence_score).toBe("number");
      expect(typeof result.data_completeness).toBe("number");
      expect(Array.isArray(result.missing_sources)).toBe(true);
      expect(typeof result.trend_detail).toBe("object");
      expect(typeof result.volume_detail).toBe("object");
      expect(typeof result.momentum_detail).toBe("object");
      expect(typeof result.derivative_detail).toBe("object");
    });

    test("all scores in [0, 100]", () => {
      const input = makeFullInput();
      const result = runP6FeatureEngine(input);
      expect(result.trend_score).toBeGreaterThanOrEqual(0);
      expect(result.trend_score).toBeLessThanOrEqual(100);
      expect(result.volume_score).toBeGreaterThanOrEqual(0);
      expect(result.volume_score).toBeLessThanOrEqual(100);
      expect(result.momentum_score).toBeGreaterThanOrEqual(0);
      expect(result.momentum_score).toBeLessThanOrEqual(100);
      expect(result.derivative_score).toBeGreaterThanOrEqual(0);
      expect(result.derivative_score).toBeLessThanOrEqual(100);
      expect(result.health_score).toBeGreaterThanOrEqual(0);
      expect(result.health_score).toBeLessThanOrEqual(100);
      expect(result.confidence_score).toBeGreaterThanOrEqual(0);
      expect(result.confidence_score).toBeLessThanOrEqual(100);
    });

    test("missing_sources is array of lowercase source names", () => {
      const input = makeFullInput({
        source_availability: { BINANCE_SPOT: true, BINANCE_FUTURES: false, COINGECKO: false },
      });
      const result = runP6FeatureEngine(input);
      expect(result.missing_sources).toContain("binance_futures");
      expect(result.missing_sources).toContain("coingecko");
      expect(result.missing_sources).not.toContain("binance_spot");
    });
  });

  // ─── EDGE CASES ────────────────────────────────────────────────────

  describe("Edge Cases", () => {
    test("insufficient data returns neutral defaults", () => {
      const input = makeFullInput({
        trend_observations: makeTrendObs(5),
        close_observations: makeTrendObs(5),
        high_observations: makeTrendObs(5).map((o) => ({
          ...o,
          metric: "HIGH" as const,
          value: o.value + 2,
        })),
        low_observations: makeTrendObs(5).map((o) => ({
          ...o,
          metric: "LOW" as const,
          value: o.value - 2,
        })),
        volume_observations: makeVolumeObs(5),
      });
      const result = runP6FeatureEngine(input);
      expect(result.trend_score).toBe(NEUTRAL_SCORE);
      expect(result.momentum_score).toBe(NEUTRAL_SCORE);
    });

    test("derivative with OI + FR data computes score", () => {
      const input = makeFullInput({
        oi_observations: [
          makeObs({ entity_id: 1, metric: "OPEN_INTEREST", value: 1000, source: "BINANCE_FUTURES" }),
          makeObs({ entity_id: 1, metric: "OPEN_INTEREST", value: 1100, source: "BINANCE_FUTURES" }),
        ],
        fr_observations: [
          makeObs({ entity_id: 1, metric: "FUNDING_RATE", value: -0.0005, source: "BINANCE_FUTURES" }),
        ],
        source_availability: { BINANCE_SPOT: true, BINANCE_FUTURES: true, COINGECKO: false },
        all_observations: [
          ...makeTrendObs(25),
          ...makeVolumeObs(25),
          makeObs({ entity_id: 1, metric: "OPEN_INTEREST", value: 1000, source: "BINANCE_FUTURES" }),
          makeObs({ entity_id: 1, metric: "OPEN_INTEREST", value: 1100, source: "BINANCE_FUTURES" }),
          makeObs({ entity_id: 1, metric: "FUNDING_RATE", value: -0.0005, source: "BINANCE_FUTURES" }),
        ],
      });
      const result = runP6FeatureEngine(input);
      expect(result.derivative_score).not.toBe(NEUTRAL_SCORE);
      expect(result.derivative_detail.no_futures).toBe(false);
      expect(result.derivative_detail.oi_current).toBe(1100);
      expect(result.derivative_detail.oi_prev).toBe(1000);
    });
  });
});
