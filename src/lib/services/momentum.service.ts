/**
 * Narrative Momentum service ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â P0-P2 legacy + P3 extension.
 *
 * EXISTING (P0-P2) vs P3
 * ----------------------
 * Existing:
 *   - Input: last ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¤7 narrative_health rows (row count, not UTC calendar endpoints)
 *   - Min history: <3 observations ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ score 0, type "stable"
 *   - Formula: change7d = healthNow - health7dAgo; score = clamp(change7d * 10, -100, 100)
 *   - Acceleration: linear-slope(second half) - linear-slope(first half); type by |accel| < 0.5
 *   - Persistence: narrative_momentum upsert by (narrative_id, date)
 *   - Single implicit window only
 *
 * P3 (this extension):
 *   - Input: narrative_health observations at UTC calendar endpoints
 *   - Windows: 1D / 3D / 7D / 14D via resolveP3Window
 *   - Formula: ÃƒÆ’Ã†â€™Ãƒâ€¦Ã‚Â½ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂND = health(end_target) - health(start_target)  [signed health points]
 *   - Missing / insufficient / stale ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ null + availability state (never fabricated 0)
 *   - Acceleration: ÃƒÆ’Ã†â€™Ãƒâ€¦Ã‚Â½ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â3D - ÃƒÆ’Ã†â€™Ãƒâ€¦Ã‚Â½ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â1D (operational formula from p3.md)
 *   - Persistence: p3_narrative_intelligence via P3 persistence boundary (immutable)
 *   - Identity: algorithm_key + algorithm_version
 *
 * Legacy calculateNarrativeMomentum / saveMomentum are preserved unchanged.
 * P3 methods are additive and do not mutate narrative_momentum history.
 */

import { db } from "@/db";
import { narrativeMomentum, narrativeHealth } from "@/db/schema";
import { eq, and, desc, sql, lte, gte } from "drizzle-orm";
import type {
  NarrativeMomentumResult,
  NarrativeMomentum,
  NarrativeHealthObservation,
  P3MomentumCalculation,
  P3WindowMomentum,
  P3AccelerationResult,
  AccelerationClassification,
  AccelerationThresholds,
} from "@/lib/types/narrative-momentum";
import type { P3AvailabilityState, P3Window } from "@/lib/p3/availability";
import type { P3CalculationContext, P3CalculationResult, P3MetricResult } from "@/lib/p3/context";
import { normalizeResult } from "@/lib/p3/context";
import { resolveP3Window, utcDayStart } from "@/lib/p3/windows";
import { persistP3Calculation, type P3PersistenceOutcome } from "@/lib/p3/persistence";

// ---------------------------------------------------------------------------
// P3 version identity (reuses existing rule/feature/score config refs on context)
// ---------------------------------------------------------------------------

export const P3_MOMENTUM_ALGORITHM_KEY = "momentum";
export const P3_MOMENTUM_ALGORITHM_VERSION = "1";

/** p3.md ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§9 default acceleration classification thresholds (configurable via scoreConfigs). */
export const DEFAULT_ACCELERATION_THRESHOLDS: AccelerationThresholds = {
  accelerating: 5,
  improving: 2,
  slowing: -2,
  decelerating: -5,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_AS_OF_GAP_DAYS = 1;
const P3_WINDOWS: readonly P3Window[] = ["1D", "3D", "7D", "14D"];

// ---------------------------------------------------------------------------
// Legacy slope helper (P0-P2 only)
// ---------------------------------------------------------------------------

function linearSlope(points: Array<{ healthScore: number }>): number {
  if (points.length < 2) return 0;
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += points[i].healthScore;
    sumXY += i * points[i].healthScore;
    sumX2 += i * i;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

// ---------------------------------------------------------------------------
// P3 pure helpers
// ---------------------------------------------------------------------------

function isUtcDateLabel(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function utcDateLabel(value: Date): string {
  const day = utcDayStart(value);
  return day.toISOString().slice(0, 10);
}

export function parseUtcDateLabel(label: string): Date {
  if (!isUtcDateLabel(label)) {
    throw new Error(`Invalid UTC date label: ${label}`);
  }
  const [year, month, day] = label.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dayDiffUtc(later: Date, earlier: Date): number {
  return Math.round((utcDayStart(later).getTime() - utcDayStart(earlier).getTime()) / MS_PER_DAY);
}

function isValidHealthScore(score: number | null | undefined): score is number {
  return score != null && Number.isFinite(score) && score >= 0 && score <= 100;
}

interface IndexedObservation {
  date: string;
  dateUtc: Date;
  healthScore: number | null;
  availabilityState: P3AvailabilityState;
  reason?: string;
}

function indexObservations(observations: readonly NarrativeHealthObservation[]): IndexedObservation[] {
  const byDate = new Map<string, IndexedObservation>();

  for (const raw of observations) {
    if (!isUtcDateLabel(raw.date)) throw new Error(`Invalid UTC date label: ${raw.date}`);
    const dateUtc = parseUtcDateLabel(raw.date);
    let state: P3AvailabilityState = raw.availabilityState ?? "VALID";
    let reason = raw.reason;

    if (state === "VALID") {
      if (raw.healthScore == null) {
        state = "MISSING";
        reason = reason ?? "Health score is null";
      } else if (!isValidHealthScore(raw.healthScore)) {
        state = "INVALID";
        reason = reason ?? "Health must be finite and within 0..100";
      }
    }

    // Latest write for a date wins (deterministic: last in input order after sort by date).
    if (byDate.has(raw.date)) throw new Error(`Duplicate narrative health observation date: ${raw.date}`);
    byDate.set(raw.date, {
      date: raw.date,
      dateUtc,
      healthScore: raw.healthScore,
      availabilityState: state,
      reason,
    });
  }

  return [...byDate.values()].sort((a, b) => a.dateUtc.getTime() - b.dateUtc.getTime());
}

interface EndpointSelection {
  observation: IndexedObservation | null;
  gapDays: number | null;
  state: P3AvailabilityState;
  reason?: string;
  degradedCoverage: boolean;
}

/**
 * Select observation at or before target with at most one UTC day as-of gap.
 * Data Contract: larger gaps ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ INSUFFICIENT_HISTORY; never use post-target observations.
 */
function selectEndpoint(indexed: readonly IndexedObservation[], target: Date): EndpointSelection {
  const targetDay = utcDayStart(target);
  let best: IndexedObservation | null = null;

  for (const obs of indexed) {
    if (obs.dateUtc.getTime() > targetDay.getTime()) break;
    best = obs;
  }

  if (!best) {
    return {
      observation: null,
      gapDays: null,
      state: "MISSING",
      reason: `No narrative health observation on or before ${utcDateLabel(targetDay)}`,
      degradedCoverage: false,
    };
  }

  const gapDays = dayDiffUtc(targetDay, best.dateUtc);
  if (gapDays > MAX_AS_OF_GAP_DAYS) {
    return {
      observation: null,
      gapDays,
      state: "INSUFFICIENT_HISTORY",
      reason: `As-of gap of ${gapDays} UTC day(s) exceeds maximum ${MAX_AS_OF_GAP_DAYS} for target ${utcDateLabel(targetDay)}`,
      degradedCoverage: false,
    };
  }

  if (best.availabilityState === "STALE") {
    return {
      observation: best,
      gapDays,
      state: "STALE",
      reason: best.reason ?? `Health observation on ${best.date} is stale`,
      degradedCoverage: gapDays > 0,
    };
  }

  if (best.availabilityState !== "VALID" || !isValidHealthScore(best.healthScore)) {
    return {
      observation: best,
      gapDays,
      state: best.availabilityState === "VALID" ? "INVALID" : best.availabilityState,
      reason: best.reason ?? `Health observation on ${best.date} is unavailable`,
      degradedCoverage: gapDays > 0,
    };
  }

  return {
    observation: best,
    gapDays,
    state: "VALID",
    degradedCoverage: gapDays > 0,
  };
}

function metric(
  metricName: string,
  value: number | null,
  state: P3AvailabilityState,
  reason?: string,
): P3MetricResult<number> {
  return { metric: metricName, value, state, ...(reason ? { reason } : {}) };
}

function worstAvailability(states: readonly P3AvailabilityState[]): P3AvailabilityState {
  if (states.length === 0) return "INSUFFICIENT_HISTORY";
  if (states.every((s) => s === "VALID")) return "VALID";
  const priority: P3AvailabilityState[] = [
    "INVALID",
    "AMBIGUOUS",
    "STALE",
    "MISSING",
    "INSUFFICIENT_HISTORY",
    "NOT_APPLICABLE",
  ];
  for (const state of priority) {
    if (states.includes(state)) return state;
  }
  return "INSUFFICIENT_HISTORY";
}

/**
 * Compute health delta for one P3 window at window_end (UTC day boundary).
 * ÃƒÆ’Ã†â€™Ãƒâ€¦Ã‚Â½ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â = health(end_target) - health(start_target). Zero is valid when endpoints equal.
 */
export function calculateWindowMomentum(
  window: P3Window,
  windowEnd: Date,
  observations: readonly NarrativeHealthObservation[],
): P3WindowMomentum {
  const resolved = resolveP3Window(window, windowEnd);
  const indexed = indexObservations(observations);
  const endTargetDate = utcDateLabel(resolved.endTarget);
  const startTargetDate = utcDateLabel(resolved.startTarget);

  const endSel = selectEndpoint(indexed, resolved.endTarget);
  const startSel = selectEndpoint(indexed, resolved.startTarget);

  if (endSel.state !== "VALID" || startSel.state !== "VALID") {
    const failed = endSel.state !== "VALID" ? endSel : startSel;
    return {
      window,
      value: null,
      state: failed.state,
      reason: failed.reason,
      endHealth: endSel.observation && isValidHealthScore(endSel.observation.healthScore) ? endSel.observation.healthScore : null,
      startHealth: startSel.observation && isValidHealthScore(startSel.observation.healthScore) ? startSel.observation.healthScore : null,
      endDate: endSel.observation?.date ?? null,
      startDate: startSel.observation?.date ?? null,
      endTargetDate,
      startTargetDate,
      endGapDays: endSel.gapDays,
      startGapDays: startSel.gapDays,
      degradedCoverage: endSel.degradedCoverage || startSel.degradedCoverage,
    };
  }

  const endHealth = endSel.observation!.healthScore as number;
  const startHealth = startSel.observation!.healthScore as number;
  const value = endHealth - startHealth;

  return {
    window,
    value,
    state: "VALID",
    endHealth,
    startHealth,
    endDate: endSel.observation!.date,
    startDate: startSel.observation!.date,
    endTargetDate,
    startTargetDate,
    endGapDays: endSel.gapDays,
    startGapDays: startSel.gapDays,
    degradedCoverage: endSel.degradedCoverage || startSel.degradedCoverage,
  };
}

/**
 * Classify acceleration per p3.md ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§9 using configurable thresholds.
 * Default bands: >=5 Accelerating, >=2 Improving, >-2 Stable, >-5 Slowing, else Decelerating.
 */
export function classifyAcceleration(
  acceleration: number,
  thresholds: AccelerationThresholds = DEFAULT_ACCELERATION_THRESHOLDS,
): AccelerationClassification {
  if (acceleration >= thresholds.accelerating) return "accelerating";
  if (acceleration >= thresholds.improving) return "improving";
  if (acceleration > thresholds.slowing) return "stable";
  if (acceleration > thresholds.decelerating) return "slowing";
  return "decelerating";
}

/**
 * Operational acceleration from p3.md: Acceleration = ÃƒÆ’Ã†â€™Ãƒâ€¦Ã‚Â½ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â3D - ÃƒÆ’Ã†â€™Ãƒâ€¦Ã‚Â½ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â1D.
 * Unavailable when either required momentum window is unavailable.
 */
export function calculateAcceleration(
  momentum3d: P3WindowMomentum,
  momentum1d: P3WindowMomentum,
  thresholds: AccelerationThresholds = DEFAULT_ACCELERATION_THRESHOLDS,
): P3AccelerationResult {
  if (momentum3d.state !== "VALID" || momentum3d.value == null) {
    return {
      value: null,
      state: momentum3d.state === "VALID" ? "INSUFFICIENT_HISTORY" : momentum3d.state,
      reason: momentum3d.reason ?? "ÃƒÆ’Ã†â€™Ãƒâ€¦Ã‚Â½ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â3D momentum is unavailable for acceleration",
      classification: null,
      formula: "delta3d_minus_delta1d",
      thresholds,
    };
  }
  if (momentum1d.state !== "VALID" || momentum1d.value == null) {
    return {
      value: null,
      state: momentum1d.state === "VALID" ? "INSUFFICIENT_HISTORY" : momentum1d.state,
      reason: momentum1d.reason ?? "ÃƒÆ’Ã†â€™Ãƒâ€¦Ã‚Â½ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â1D momentum is unavailable for acceleration",
      classification: null,
      formula: "delta3d_minus_delta1d",
      thresholds,
    };
  }

  const value = momentum3d.value - momentum1d.value;
  return {
    value,
    state: "VALID",
    classification: classifyAcceleration(value, thresholds),
    formula: "delta3d_minus_delta1d",
    thresholds,
  };
}

/**
 * Full P3 Momentum + Acceleration over 1D/3D/7D/14D UTC windows.
 * Does not fabricate values for missing/stale/insufficient history.
 */
export function calculateP3Momentum(
  windowEnd: Date,
  observations: readonly NarrativeHealthObservation[],
  options: {
    thresholds?: AccelerationThresholds;
    algorithmKey?: string;
    algorithmVersion?: string;
  } = {},
): P3MomentumCalculation {
  const thresholds = options.thresholds ?? DEFAULT_ACCELERATION_THRESHOLDS;
  const algorithmKey = options.algorithmKey ?? P3_MOMENTUM_ALGORITHM_KEY;
  const algorithmVersion = options.algorithmVersion ?? P3_MOMENTUM_ALGORITHM_VERSION;

  // Validate window end is UTC day boundary (resolveP3Window enforces this).
  const momentum1d = calculateWindowMomentum("1D", windowEnd, observations);
  const momentum3d = calculateWindowMomentum("3D", windowEnd, observations);
  const momentum7d = calculateWindowMomentum("7D", windowEnd, observations);
  const momentum14d = calculateWindowMomentum("14D", windowEnd, observations);
  const acceleration = calculateAcceleration(momentum3d, momentum1d, thresholds);

  const windows = [momentum1d, momentum3d, momentum7d, momentum14d];
  const mandatoryWindows = [momentum1d, momentum3d, momentum7d];
  const mandatoryStates: P3AvailabilityState[] = [...mandatoryWindows.map((w) => w.state), acceleration.state];
  const optionalStates: P3AvailabilityState[] = [momentum14d.state];
  const stageAvailability = worstAvailability(mandatoryStates);
  const windowAvailability = worstAvailability([...mandatoryStates, ...optionalStates]);
  const firstUnavailable = [...windows, acceleration].find((item) => item.state !== "VALID");

  const indexed = indexObservations(observations);
  const observationCount = indexed.length;
  const endTarget = resolveP3Window("7D", windowEnd).endTarget;
  const fullSevenObservationCoverage = Array.from({ length: 7 }, (_, offset) => {
    const requiredDate = utcDateLabel(new Date(endTarget.getTime() - offset * MS_PER_DAY));
    const observation = indexed.find((item) => item.date === requiredDate);
    return observation?.availabilityState === "VALID" && isValidHealthScore(observation.healthScore);
  }).every(Boolean);

  return {
    momentum1d,
    momentum3d,
    momentum7d,
    momentum14d,
    acceleration,
    availabilityState: stageAvailability,
    ...(stageAvailability !== "VALID" && firstUnavailable && "reason" in firstUnavailable && firstUnavailable.reason
      ? { availabilityReason: firstUnavailable.reason }
      : stageAvailability !== "VALID"
        ? { availabilityReason: "One or more mandatory momentum windows or acceleration is unavailable" }
        : {}),
    observationCount,
    fullSevenObservationCoverage,
    algorithmKey,
    algorithmVersion,
    provenance: {
      module: "momentum",
      algorithmKey,
      algorithmVersion,
      formula: "health_delta_endpoint",
      accelerationFormula: "delta3d_minus_delta1d",
      windows: P3_WINDOWS,
      maxAsOfGapDays: MAX_AS_OF_GAP_DAYS,
      accelerationThresholds: thresholds,
      observationCount,
      fullSevenObservationCoverage,
      windowEnd: windowEnd.toISOString(),
      degradedWindows: windows.filter((w) => w.degradedCoverage).map((w) => w.window),
      stageAvailability,
      windowAvailability,
      legacyNote:
        "P0-P2 MomentumService.calculateNarrativeMomentum remains a separate compatibility path and is not this formula",
    },
  };
}

/**
 * Normalize P3 Momentum into the shared P3 calculation result contract for persistence.
 */
export function calculateP3MomentumResult(
  context: P3CalculationContext,
  observations: readonly NarrativeHealthObservation[],
  thresholds: AccelerationThresholds = DEFAULT_ACCELERATION_THRESHOLDS,
): P3CalculationResult {
  const calculated = calculateP3Momentum(context.windowEnd, observations, {
    thresholds,
    algorithmKey: context.algorithmKey,
    algorithmVersion: context.algorithmVersion,
  });

  return normalizeResult(context, {
    availabilityState: calculated.availabilityState,
    confidence: null,
    metrics: {
      momentum1d: metric("momentum1d", calculated.momentum1d.value, calculated.momentum1d.state, calculated.momentum1d.reason),
      momentum3d: metric("momentum3d", calculated.momentum3d.value, calculated.momentum3d.state, calculated.momentum3d.reason),
      momentum7d: metric("momentum7d", calculated.momentum7d.value, calculated.momentum7d.state, calculated.momentum7d.reason),
      momentum14d: metric("momentum14d", calculated.momentum14d.value, calculated.momentum14d.state, calculated.momentum14d.reason),
      acceleration: metric(
        "acceleration",
        calculated.acceleration.value,
        calculated.acceleration.state,
        calculated.acceleration.reason,
      ),
    },
    explanation: {
      momentum1d: calculated.momentum1d.value,
      momentum3d: calculated.momentum3d.value,
      momentum7d: calculated.momentum7d.value,
      momentum14d: calculated.momentum14d.value,
      acceleration: calculated.acceleration.value,
      accelerationClassification: calculated.acceleration.classification,
      fullSevenObservationCoverage: calculated.fullSevenObservationCoverage,
      observationCount: calculated.observationCount,
      ...(calculated.availabilityReason ? { availabilityReason: calculated.availabilityReason } : {}),
    },
    provenance: calculated.provenance,
  });
}

/**
 * Compatibility projection: map P3 ÃƒÆ’Ã†â€™Ãƒâ€¦Ã‚Â½ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â7D (+ optional acceleration) into the legacy result shape.
 * Used only for transitional consumers. Does not write legacy narrative_momentum.
 *
 * - Unavailable ÃƒÆ’Ã†â€™Ãƒâ€¦Ã‚Â½ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â7D ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ score null is not representable on legacy type; callers should prefer P3.
 *   This projection returns score 0 only when explicitly projecting VALID zero, otherwise keeps
 *   the legacy shape by omitting projection (returns null).
 */
export function projectP3ToLegacy(calculation: P3MomentumCalculation): NarrativeMomentumResult | null {
  const m7 = calculation.momentum7d;
  if (m7.state !== "VALID" || m7.value == null || m7.endHealth == null) {
    return null;
  }

  // Legacy scaled score: change7d * 10 clamped to [-100, 100]
  const legacyScore = Math.round(Math.max(-100, Math.min(100, m7.value * 10)));

  let type: NarrativeMomentumResult["type"] = "stable";
  if (calculation.acceleration.state === "VALID" && calculation.acceleration.classification) {
    const c = calculation.acceleration.classification;
    if (c === "accelerating" || c === "improving") type = "accelerating";
    else if (c === "slowing" || c === "decelerating") type = "decelerating";
    else type = "stable";
  }

  return {
    score: legacyScore,
    type,
    health7dAgo: m7.startHealth,
    healthNow: m7.endHealth,
  };
}

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

export class MomentumService {
  /**
   * LEGACY P0-P2 formula ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â preserved for backward compatibility.
   * Do not use for P3 intelligence. See calculateP3Momentum.
   */
  async calculateNarrativeMomentum(
    narrativeId: number,
    date: string,
    healthHistory: Array<{ date: string; healthScore: number }>,
  ): Promise<NarrativeMomentumResult> {
    if (healthHistory.length < 3) {
      return { score: 0, type: "stable", health7dAgo: null, healthNow: null };
    }

    const recent = healthHistory.slice(-7);
    const now = recent[recent.length - 1].healthScore;
    const ago7d = recent[0].healthScore;

    const change7d = now - ago7d;

    const midpoint = Math.floor(recent.length / 2);
    const firstHalfSlope = linearSlope(recent.slice(0, midpoint));
    const secondHalfSlope = linearSlope(recent.slice(midpoint));
    const acceleration = secondHalfSlope - firstHalfSlope;

    let type: "accelerating" | "decelerating" | "stable";
    if (Math.abs(acceleration) < 0.5) type = "stable";
    else if (acceleration > 0) type = "accelerating";
    else type = "decelerating";

    const momentumScore = Math.round(Math.max(-100, Math.min(100, change7d * 10)));

    return {
      score: momentumScore,
      type,
      health7dAgo: ago7d,
      healthNow: now,
    };
  }

  /**
   * LEGACY persistence into narrative_momentum (mutable upsert).
   * P3 must not use this path ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â use persistP3Momentum / persistP3Calculation.
   */
  async saveMomentum(narrativeId: number, date: string): Promise<void> {
    const history = await db
      .select({
        date: narrativeHealth.date,
        healthScore: narrativeHealth.healthScore,
      })
      .from(narrativeHealth)
      .where(
        and(
          eq(narrativeHealth.narrativeId, narrativeId),
          sql`${narrativeHealth.date} <= ${date}`,
        ),
      )
      .orderBy(desc(narrativeHealth.date))
      .limit(7);

    const reversedHistory = history
      .map((h) => ({
        date: typeof h.date === "string" ? h.date : String(h.date),
        healthScore:
          typeof h.healthScore === "number"
            ? h.healthScore
            : h.healthScore
              ? parseFloat(h.healthScore as unknown as string)
              : 0,
      }))
      .reverse();

    const result = await this.calculateNarrativeMomentum(narrativeId, date, reversedHistory);

    await db
      .insert(narrativeMomentum)
      .values({
        narrativeId,
        date,
        momentumScore: String(result.score),
        momentumType: result.type,
        health7dAgo: result.health7dAgo != null ? String(result.health7dAgo) : null,
        healthNow: result.healthNow != null ? String(result.healthNow) : null,
      })
      .onConflictDoUpdate({
        target: [narrativeMomentum.narrativeId, narrativeMomentum.date],
        set: {
          momentumScore: String(result.score),
          momentumType: result.type,
          health7dAgo: result.health7dAgo != null ? String(result.health7dAgo) : null,
          healthNow: result.healthNow != null ? String(result.healthNow) : null,
        },
      });
  }

  async getMomentumHistory(narrativeId: number, days: number): Promise<NarrativeMomentum[]> {
    const result = await db
      .select()
      .from(narrativeMomentum)
      .where(eq(narrativeMomentum.narrativeId, narrativeId))
      .orderBy(desc(narrativeMomentum.date))
      .limit(days);

    return result.map((r) => ({
      ...r,
      momentumScore: r.momentumScore ? parseFloat(r.momentumScore) : null,
      health7dAgo: r.health7dAgo ? parseFloat(r.health7dAgo) : null,
      healthNow: r.healthNow ? parseFloat(r.healthNow) : null,
    })) as NarrativeMomentum[];
  }

  /**
   * Load narrative_health observations for P3 lookbacks at window_end.
   * Fetches from (window_end - 16d) through (window_end - 1d) to cover 14D + 1-day as-of gap.
   */
  async loadHealthObservations(
    narrativeId: number,
    windowEnd: Date,
  ): Promise<NarrativeHealthObservation[]> {
    const resolved = resolveP3Window("14D", windowEnd);
    // One extra day before start target for as-of gap tolerance.
    const rangeStart = new Date(resolved.startTarget.getTime() - MS_PER_DAY);
    const rangeEnd = resolved.endTarget;
    const startLabel = utcDateLabel(rangeStart);
    const endLabel = utcDateLabel(rangeEnd);

    const rows = await db
      .select({
        date: narrativeHealth.date,
        healthScore: narrativeHealth.healthScore,
      })
      .from(narrativeHealth)
      .where(
        and(
          eq(narrativeHealth.narrativeId, narrativeId),
          gte(narrativeHealth.date, startLabel),
          lte(narrativeHealth.date, endLabel),
        ),
      )
      .orderBy(narrativeHealth.date);

    return rows.map((row) => {
      const date = typeof row.date === "string" ? row.date : String(row.date);
      const raw =
        typeof row.healthScore === "number"
          ? row.healthScore
          : row.healthScore != null
            ? parseFloat(row.healthScore as unknown as string)
            : null;
      const healthScore = raw != null && Number.isFinite(raw) ? raw : null;
      return {
        date,
        healthScore,
        availabilityState: healthScore == null ? ("MISSING" as const) : ("VALID" as const),
        ...(healthScore == null ? { reason: "Narrative health score is null" } : {}),
      };
    });
  }

  /**
   * Calculate P3 Momentum for a narrative at window_end from persisted narrative_health.
   */
  async calculateP3MomentumForNarrative(
    narrativeId: number,
    windowEnd: Date,
    thresholds: AccelerationThresholds = DEFAULT_ACCELERATION_THRESHOLDS,
  ): Promise<P3MomentumCalculation> {
    const observations = await this.loadHealthObservations(narrativeId, windowEnd);
    return calculateP3Momentum(windowEnd, observations, { thresholds });
  }

  /**
   * Calculate + normalize P3 Momentum result ready for immutable persistence.
   */
  async buildP3MomentumResult(
    context: P3CalculationContext,
    observations?: readonly NarrativeHealthObservation[],
    thresholds: AccelerationThresholds = DEFAULT_ACCELERATION_THRESHOLDS,
  ): Promise<P3CalculationResult> {
    const obs =
      observations ??
      (await this.loadHealthObservations(context.narrativeId, context.windowEnd));
    return calculateP3MomentumResult(context, obs, thresholds);
  }

  /**
   * Persist P3 Momentum through the P3 persistence boundary (append-only / idempotent).
   * Does not write narrative_momentum and does not overwrite historical P3 records.
   */
  async persistP3Momentum(
    context: P3CalculationContext,
    options: {
      observations?: readonly NarrativeHealthObservation[];
      thresholds?: AccelerationThresholds;
      membershipSource?: string;
      membershipMode?: string;
    } = {},
  ): Promise<{ result: P3CalculationResult; persistence: P3PersistenceOutcome }> {
    const result = await this.buildP3MomentumResult(
      context,
      options.observations,
      options.thresholds ?? DEFAULT_ACCELERATION_THRESHOLDS,
    );
    const persistence = await persistP3Calculation({
      context,
      result,
      membershipSource: options.membershipSource ?? "momentum_health_history",
      membershipMode: options.membershipMode ?? context.calculationMode,
    });
    return { result, persistence };
  }
}

export const momentumService = new MomentumService();
