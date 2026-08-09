jest.mock("@/db", () => ({ db: {} }));

import {
  calculateAcceleration,
  calculateP3Momentum,
  calculateP3MomentumResult,
  calculateWindowMomentum,
  classifyAcceleration,
  DEFAULT_ACCELERATION_THRESHOLDS,
  P3_MOMENTUM_ALGORITHM_KEY,
  P3_MOMENTUM_ALGORITHM_VERSION,
  projectP3ToLegacy,
  MomentumService,
} from "@/lib/services/momentum.service";
import { createCalculationContext } from "../context";
import { resolveP3Window } from "../windows";
import type { NarrativeHealthObservation } from "@/lib/types/narrative-momentum";

/** window_end = 2026-08-09T00:00:00Z ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ end_target 2026-08-08, start targets per N. */
const WINDOW_END = new Date("2026-08-09T00:00:00.000Z");

function obs(date: string, healthScore: number | null, availabilityState?: NarrativeHealthObservation["availabilityState"], reason?: string): NarrativeHealthObservation {
  return {
    date,
    healthScore,
    ...(availabilityState ? { availabilityState } : {}),
    ...(reason ? { reason } : {}),
  };
}

/** Build consecutive daily observations ending at endDate (inclusive), oldest first. */
function series(endDate: string, scores: number[]): NarrativeHealthObservation[] {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return scores.map((score, indexFromEnd) => {
    const offset = scores.length - 1 - indexFromEnd;
    const d = new Date(end.getTime() - offset * 24 * 60 * 60 * 1000);
    return obs(d.toISOString().slice(0, 10), score);
  });
}

function momentumContext(version = P3_MOMENTUM_ALGORITHM_VERSION) {
  // Context window field is compositional; Momentum always resolves 1D/3D/7D/14D from windowEnd.
  const resolved = resolveP3Window("14D", WINDOW_END);
  return createCalculationContext({
    narrativeId: 42,
    calculationMode: "observed",
    window: "14D",
    windowStart: resolved.windowStart,
    windowEnd: resolved.windowEnd,
    calculatedAt: new Date("2026-08-09T01:00:00.000Z"),
    algorithmKey: P3_MOMENTUM_ALGORITHM_KEY,
    algorithmVersion: version,
    ruleVersionId: 1,
    featureVersionId: 2,
    scoreConfigId: 3,
    constituents: [],
    sourceAvailability: {},
  });
}

describe("P3 Momentum (extended MomentumService)", () => {
  describe("UTC window endpoints", () => {
    test("resolves 1D/3D/7D/14D health deltas against calendar endpoints", () => {
      // end_target = 2026-08-08. Provide exact endpoints for all windows.
      const observations = [
        obs("2026-07-25", 60), // 14D start = window_end - 15d
        obs("2026-08-01", 70), // 7D start  = window_end - 8d
        obs("2026-08-05", 75), // 3D start  = window_end - 4d
        obs("2026-08-07", 80), // 1D start  = window_end - 2d
        obs("2026-08-08", 90), // end_target
      ];

      expect(calculateWindowMomentum("1D", WINDOW_END, observations)).toMatchObject({
        value: 10, // 90 - 80
        state: "VALID",
        endTargetDate: "2026-08-08",
        startTargetDate: "2026-08-07",
      });
      expect(calculateWindowMomentum("3D", WINDOW_END, observations)).toMatchObject({
        value: 15, // 90 - 75
        state: "VALID",
        startTargetDate: "2026-08-05",
      });
      expect(calculateWindowMomentum("7D", WINDOW_END, observations)).toMatchObject({
        value: 20, // 90 - 70
        state: "VALID",
        startTargetDate: "2026-08-01",
      });
      expect(calculateWindowMomentum("14D", WINDOW_END, observations)).toMatchObject({
        value: 30, // 90 - 60
        state: "VALID",
        startTargetDate: "2026-07-25",
      });
    });

    test("rejects non-UTC-day-boundary window_end", () => {
      expect(() =>
        calculateWindowMomentum("1D", new Date("2026-08-09T07:00:00.000Z"), [obs("2026-08-08", 50)]),
      ).toThrow("UTC day boundary");
    });
  });

  describe("signed momentum values", () => {
    test("positive momentum", () => {
      const observations = [obs("2026-08-07", 70), obs("2026-08-08", 85)];
      expect(calculateWindowMomentum("1D", WINDOW_END, observations).value).toBe(15);
    });

    test("negative momentum", () => {
      const observations = [obs("2026-08-07", 90), obs("2026-08-08", 70)];
      expect(calculateWindowMomentum("1D", WINDOW_END, observations).value).toBe(-20);
    });

    test("zero momentum is VALID (equal endpoints), not missing", () => {
      const observations = [obs("2026-08-07", 72), obs("2026-08-08", 72)];
      const result = calculateWindowMomentum("1D", WINDOW_END, observations);
      expect(result).toMatchObject({ value: 0, state: "VALID" });
      expect(result.value).not.toBeNull();
    });
  });

  describe("missing / insufficient / stale semantics", () => {
    test("missing history is null + MISSING, never zero", () => {
      const result = calculateP3Momentum(WINDOW_END, []);
      expect(result.momentum1d).toMatchObject({ value: null, state: "MISSING" });
      expect(result.momentum7d.value).toBeNull();
      expect(result.availabilityState).not.toBe("VALID");
      expect(result.momentum1d.value).not.toBe(0);
    });

    test("insufficient history (gap > 1 UTC day) is null + INSUFFICIENT_HISTORY", () => {
      // end target 08-08 present; 1D start target 08-07 missing; only 08-05 (gap 2 days)
      const observations = [obs("2026-08-05", 60), obs("2026-08-08", 80)];
      const result = calculateWindowMomentum("1D", WINDOW_END, observations);
      expect(result).toMatchObject({ value: null, state: "INSUFFICIENT_HISTORY" });
      expect(result.value).not.toBe(0);
    });

    test("one-day as-of gap is allowed and marked degraded coverage", () => {
      // start target 08-07 missing; use 08-06 (gap 1) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â allowed
      const observations = [obs("2026-08-06", 70), obs("2026-08-08", 80)];
      const result = calculateWindowMomentum("1D", WINDOW_END, observations);
      expect(result).toMatchObject({
        value: 10,
        state: "VALID",
        startDate: "2026-08-06",
        startGapDays: 1,
        degradedCoverage: true,
      });
    });

    test("stale endpoint makes window STALE with null value", () => {
      const observations = [
        obs("2026-08-07", 70, "STALE", "Source older than approved max age"),
        obs("2026-08-08", 80),
      ];
      const result = calculateWindowMomentum("1D", WINDOW_END, observations);
      expect(result).toMatchObject({ value: null, state: "STALE" });
      expect(result.value).not.toBe(0);
    });

    test("invalid health score is not treated as zero momentum", () => {
      const observations = [obs("2026-08-07", 101), obs("2026-08-08", 80)];
      const result = calculateWindowMomentum("1D", WINDOW_END, observations);
      expect(result).toMatchObject({ value: null, state: "INVALID" });
    });

    test("null health score is MISSING, not health zero", () => {
      const observations = [obs("2026-08-07", null), obs("2026-08-08", 80)];
      const result = calculateWindowMomentum("1D", WINDOW_END, observations);
      expect(result).toMatchObject({ value: null, state: "MISSING" });
    });
  });

  describe("acceleration", () => {
    test("Acceleration = ÃƒÅ½Ã¢â‚¬Â3D - ÃƒÅ½Ã¢â‚¬Â1D exactly", () => {
      const observations = [
        obs("2026-08-05", 70), // 3D start
        obs("2026-08-07", 80), // 1D start
        obs("2026-08-08", 90), // end
      ];
      // ÃƒÅ½Ã¢â‚¬Â1D = 90-80 = 10; ÃƒÅ½Ã¢â‚¬Â3D = 90-70 = 20; accel = 10
      const calculated = calculateP3Momentum(WINDOW_END, observations);
      expect(calculated.momentum1d.value).toBe(10);
      expect(calculated.momentum3d.value).toBe(20);
      expect(calculated.acceleration).toMatchObject({
        value: 10,
        state: "VALID",
        formula: "delta3d_minus_delta1d",
        classification: "accelerating",
      });
    });

    test("acceleration unavailable when ÃƒÅ½Ã¢â‚¬Â1D missing", () => {
      const observations = [obs("2026-08-05", 70), obs("2026-08-08", 90)];
      // 1D start insufficient; 3D may still resolve via as-of on 08-05 for start? start target 08-05 exact.
      const calculated = calculateP3Momentum(WINDOW_END, observations);
      expect(calculated.momentum1d.state).not.toBe("VALID");
      expect(calculated.acceleration).toMatchObject({ value: null });
      expect(calculated.acceleration.classification).toBeNull();
    });

    test("classifies acceleration bands per p3.md defaults", () => {
      expect(classifyAcceleration(5)).toBe("accelerating");
      expect(classifyAcceleration(4.99)).toBe("improving");
      expect(classifyAcceleration(2)).toBe("improving");
      expect(classifyAcceleration(1.99)).toBe("stable");
      expect(classifyAcceleration(-1.99)).toBe("stable");
      expect(classifyAcceleration(-2)).toBe("slowing");
      expect(classifyAcceleration(-4.99)).toBe("slowing");
      expect(classifyAcceleration(-5)).toBe("decelerating");
      expect(classifyAcceleration(0)).toBe("stable");
    });

    test("zero acceleration (unchanged momentum) is VALID", () => {
      const momentum3d = calculateWindowMomentum("3D", WINDOW_END, [
        obs("2026-08-05", 80),
        obs("2026-08-08", 90),
      ]);
      const momentum1d = calculateWindowMomentum("1D", WINDOW_END, [
        obs("2026-08-07", 80),
        obs("2026-08-08", 90),
      ]);
      // ÃƒÅ½Ã¢â‚¬Â3D=10, ÃƒÅ½Ã¢â‚¬Â1D=10 ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ accel 0
      expect(calculateAcceleration(momentum3d, momentum1d)).toMatchObject({
        value: 0,
        state: "VALID",
        classification: "stable",
      });
    });

    test("uses supplied thresholds instead of inventing formula", () => {
      expect(
        classifyAcceleration(3, { ...DEFAULT_ACCELERATION_THRESHOLDS, accelerating: 3, improving: 1 }),
      ).toBe("accelerating");
    });
  });

  describe("determinism, versioning, kernel contract", () => {
    test("rejects invalid UTC dates and duplicate observations", () => {
      expect(() => calculateP3Momentum(WINDOW_END, [obs("2026-02-31", 50)])).toThrow("Invalid UTC date label");
      expect(() => calculateP3Momentum(WINDOW_END, [obs("2026-08-08", 50), obs("2026-08-08", 51)])).toThrow("Duplicate narrative health observation date");
    });

    test("same inputs produce identical outputs", () => {
      const observations = series("2026-08-08", [60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90]);
      const a = calculateP3Momentum(WINDOW_END, observations);
      const b = calculateP3Momentum(WINDOW_END, observations);
      expect(a).toEqual(b);
      expect(a.algorithmKey).toBe(P3_MOMENTUM_ALGORITHM_KEY);
      expect(a.algorithmVersion).toBe(P3_MOMENTUM_ALGORITHM_VERSION);
    });

    test("full seven-observation coverage flag is distinct from ÃƒÅ½Ã¢â‚¬Â7D validity", () => {
      // Only two endpoints for 7D ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ÃƒÅ½Ã¢â‚¬Â7D VALID, but fullSevenObservationCoverage false
      const sparse = [obs("2026-08-01", 50), obs("2026-08-08", 60)];
      const sparseResult = calculateP3Momentum(WINDOW_END, sparse);
      expect(sparseResult.momentum7d).toMatchObject({ value: 10, state: "VALID" });
      expect(sparseResult.fullSevenObservationCoverage).toBe(false);

      const dense = series("2026-08-08", [50, 51, 52, 53, 54, 55, 60]);
      const denseResult = calculateP3Momentum(WINDOW_END, dense);
      expect(denseResult.observationCount).toBe(7);
      expect(denseResult.fullSevenObservationCoverage).toBe(true);
    });

    test("normalizes through shared P3 result contract with metric keys for persistence", () => {
      const observations = [
        obs("2026-07-25", 50),
        obs("2026-08-01", 55),
        obs("2026-08-05", 60),
        obs("2026-08-07", 65),
        obs("2026-08-08", 70),
      ];
      const result = calculateP3MomentumResult(momentumContext(), observations);
      expect(result).toMatchObject({
        narrativeId: 42,
        windowEnd: WINDOW_END,
        algorithmKey: P3_MOMENTUM_ALGORITHM_KEY,
        algorithmVersion: P3_MOMENTUM_ALGORITHM_VERSION,
        availabilityState: "VALID",
      });
      expect(result.metrics.momentum1d).toMatchObject({ value: 5, state: "VALID" });
      expect(result.metrics.momentum3d).toMatchObject({ value: 10, state: "VALID" });
      expect(result.metrics.momentum7d).toMatchObject({ value: 15, state: "VALID" });
      expect(result.metrics.momentum14d).toMatchObject({ value: 20, state: "VALID" });
      expect(result.metrics.acceleration).toMatchObject({ value: 5, state: "VALID" }); // 10 - 5
      expect(result.provenance).toMatchObject({
        module: "momentum",
        algorithmKey: P3_MOMENTUM_ALGORITHM_KEY,
        accelerationFormula: "delta3d_minus_delta1d",
      });
    });
  });

  describe("legacy P0-P2 behavior preservation", () => {
    const service = new MomentumService();

    test("legacy calculateNarrativeMomentum still returns 0/stable for <3 observations", async () => {
      const result = await service.calculateNarrativeMomentum(1, "2026-08-08", [
        { date: "2026-08-07", healthScore: 50 },
        { date: "2026-08-08", healthScore: 60 },
      ]);
      expect(result).toEqual({ score: 0, type: "stable", health7dAgo: null, healthNow: null });
    });

    test("legacy formula still scales change7d * 10 and clamps", async () => {
      const history = [
        { date: "2026-08-02", healthScore: 50 },
        { date: "2026-08-03", healthScore: 52 },
        { date: "2026-08-04", healthScore: 54 },
        { date: "2026-08-05", healthScore: 56 },
        { date: "2026-08-06", healthScore: 58 },
        { date: "2026-08-07", healthScore: 60 },
        { date: "2026-08-08", healthScore: 65 },
      ];
      const result = await service.calculateNarrativeMomentum(1, "2026-08-08", history);
      // change7d = 65 - 50 = 15 ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ score 150 clamped to 100
      expect(result.score).toBe(100);
      expect(result.health7dAgo).toBe(50);
      expect(result.healthNow).toBe(65);
    });

    test("P3 does not silently adopt legacy zero-on-missing", () => {
      const p3 = calculateP3Momentum(WINDOW_END, []);
      expect(p3.momentum7d.value).toBeNull();
      expect(p3.momentum7d.state).toBe("MISSING");
    });

    test("compatibility projection maps VALID ÃƒÅ½Ã¢â‚¬Â7D to legacy scaled score without writing legacy store", () => {
      const observations = [
        obs("2026-08-01", 50),
        obs("2026-08-05", 55),
        obs("2026-08-07", 58),
        obs("2026-08-08", 60),
      ];
      const p3 = calculateP3Momentum(WINDOW_END, observations);
      const legacy = projectP3ToLegacy(p3);
      expect(legacy).not.toBeNull();
      // ÃƒÅ½Ã¢â‚¬Â7D = 10 ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ legacy score 100
      expect(legacy!.score).toBe(100);
      expect(legacy!.health7dAgo).toBe(50);
      expect(legacy!.healthNow).toBe(60);
    });

    test("compatibility projection returns null when ÃƒÅ½Ã¢â‚¬Â7D unavailable (no fake zero)", () => {
      const p3 = calculateP3Momentum(WINDOW_END, [obs("2026-08-08", 60)]);
      expect(projectP3ToLegacy(p3)).toBeNull();
    });
  });
});
