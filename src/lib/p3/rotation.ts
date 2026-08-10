import type { P3AvailabilityState } from "./availability";
import type { P3CalculationContext, P3CalculationResult, P3MetricResult } from "./context";
import { normalizeResult } from "./context";
import { persistP3Calculation, type P3PersistenceOutcome } from "./persistence";

export const P3_ROTATION_ALGORITHM_KEY = "rotation";
export const P3_ROTATION_ALGORITHM_VERSION = "1";
export const P3_ROTATION_STATES = ["INFLOW", "ACCELERATING", "STABLE", "DECELERATING", "OUTFLOW"] as const;
export type P3RotationState = (typeof P3_ROTATION_STATES)[number];

export interface RotationInputs { healthMomentum: number | null; breadthMomentum: number | null; relativeStrength: number | null; volumeExpansion: number | null; oiConfirmation: number | null; confidence?: number | null; availabilityState?: P3AvailabilityState; }
export interface RotationThresholds { acceleratingMin: number; inflowMin: number; stableMin: number; deceleratingMin: number; }
export interface RotationResult { score: number | null; state: P3RotationState | null; availabilityState: P3AvailabilityState; reasons: readonly string[]; confidence: number | null; provenance: Record<string, unknown>; }

// ---------------------------------------------------------------------------
// Component Normalization Functions (P3-10A Final Contract)
// ---------------------------------------------------------------------------

/**
 * Clip a value to [0, 100] range.
 */
function clip(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Normalize Health Momentum to 0-100.
 * Contract: clip(50 + healthChange × 2.5, 0, 100)
 * -20 health points → 0, 0 → 50, +20 → 100
 */
export function normalizeHealthMomentum(healthChange: number): number {
  return clip(50 + healthChange * 2.5);
}

/**
 * Normalize Breadth Momentum to 0-100.
 * Contract: clip(50 + breadthChange × 50, 0, 100)
 * Breadth is in [0,1], so breadthChange is in [-1, +1]
 * -1.0 → 0, 0 → 50, +1.0 → 100
 */
export function normalizeBreadthMomentum(breadthChange: number): number {
  return clip(50 + breadthChange * 50);
}

/**
 * Normalize Relative Strength to 0-100.
 * Contract: clip(50 + RS_percent × 5, 0, 100)
 * -10% → 0, 0% → 50, +10% → 100
 */
export function normalizeRelativeStrength(rsPercent: number): number {
  return clip(50 + rsPercent * 5);
}

/**
 * Normalize Volume Expansion to 0-100.
 * Contract: clip(volumeRatio × 50, 0, 100)
 * 0.0x → 0, 1.0x → 50, 2.0x → 100
 */
export function normalizeVolumeExpansion(volumeRatio: number): number {
  return clip(volumeRatio * 50);
}

/**
 * OI Confirmation matrix.
 * Contract: Deterministic mapping of price direction × OI direction to 0-100.
 */
export type Direction = "positive" | "zero" | "negative";

export function getDirection(value: number): Direction {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "zero";
}

export function calculateOIConfirmation(priceChange: number, oiChange: number): number {
  const priceDir = getDirection(priceChange);
  const oiDir = getDirection(oiChange);

  // Authoritative matrix from P3-10A contract
  const matrix: Record<Direction, Record<Direction, number>> = {
    positive: { positive: 100, zero: 75, negative: 50 },
    zero: { positive: 50, zero: 50, negative: 50 },
    negative: { positive: 0, zero: 25, negative: 50 },
  };

  return matrix[priceDir][oiDir];
}

function valid(value: number | null): value is number { return value != null && Number.isFinite(value); }
function validateContext(context: P3CalculationContext): void {
  if (context.algorithmKey !== P3_ROTATION_ALGORITHM_KEY || context.algorithmVersion !== P3_ROTATION_ALGORITHM_VERSION) throw new Error("Rotation context must use algorithm identity rotation/1");
}
export function calculateRotation(inputs: RotationInputs, thresholds: RotationThresholds): RotationResult {
  const values = [inputs.healthMomentum, inputs.breadthMomentum, inputs.relativeStrength, inputs.volumeExpansion, inputs.oiConfirmation];
  const missing = values.filter((value) => !valid(value)).length;
  if (missing) return { score: null, state: null, availabilityState: inputs.availabilityState && inputs.availabilityState !== "VALID" ? inputs.availabilityState : "MISSING", reasons: [`${missing}_required_rotation_inputs_unavailable`], confidence: inputs.confidence ?? null, provenance: { module: "rotation", thresholds, missingInputs: missing, weights: { healthMomentum: 0.3, breadthMomentum: 0.2, relativeStrength: 0.2, volumeExpansion: 0.15, oiConfirmation: 0.15 } } };
  if (values.some((value) => (value as number) < 0 || (value as number) > 100)) return { score: null, state: null, availabilityState: "INVALID", reasons: ["Rotation components must be normalized to 0-100"], confidence: inputs.confidence ?? null, provenance: { module: "rotation", thresholds } };
  const score = (inputs.healthMomentum as number) * 0.3 + (inputs.breadthMomentum as number) * 0.2 + (inputs.relativeStrength as number) * 0.2 + (inputs.volumeExpansion as number) * 0.15 + (inputs.oiConfirmation as number) * 0.15;
  const matches: Array<{ state: P3RotationState; reason: string }> = [];
  if (Object.values(thresholds).some((value) => !Number.isFinite(value))) throw new Error("Rotation thresholds must be finite");
  if (!(thresholds.acceleratingMin > thresholds.inflowMin && thresholds.inflowMin > thresholds.stableMin && thresholds.stableMin > thresholds.deceleratingMin)) throw new Error("Rotation thresholds must be strictly descending");
  if (score >= thresholds.acceleratingMin) matches.push({ state: "ACCELERATING", reason: "rotation_score_accelerating" });
  else if (score >= thresholds.inflowMin) matches.push({ state: "INFLOW", reason: "rotation_score_inflow" });
  else if (score >= thresholds.stableMin) matches.push({ state: "STABLE", reason: "rotation_score_stable" });
  else if (score >= thresholds.deceleratingMin) matches.push({ state: "DECELERATING", reason: "rotation_score_decelerating" });
  else matches.push({ state: "OUTFLOW", reason: "rotation_score_outflow" });
  if (matches.length !== 1) return { score, state: null, availabilityState: matches.length ? "AMBIGUOUS" : "NOT_APPLICABLE", reasons: matches.length ? matches.map((match) => match.reason) : ["No rotation threshold matched"], confidence: inputs.confidence ?? null, provenance: { module: "rotation", thresholds, matches: matches.map((match) => match.state) } };
  return { score, state: matches[0].state, availabilityState: "VALID", reasons: [matches[0].reason], confidence: inputs.confidence ?? null, provenance: { module: "rotation", thresholds, matches: [matches[0].state], weights: { healthMomentum: 0.3, breadthMomentum: 0.2, relativeStrength: 0.2, volumeExpansion: 0.15, oiConfirmation: 0.15 } } };
}

function metric(name: string, value: number | string | null, state: P3AvailabilityState, reason?: string): P3MetricResult<number | string> { return { metric: name, value, state, ...(reason ? { reason } : {}) }; }
export function calculateRotationResult(context: P3CalculationContext, inputs: RotationInputs, thresholds: RotationThresholds): P3CalculationResult {
  validateContext(context);
  const result = calculateRotation(inputs, thresholds);
  return normalizeResult(context, { availabilityState: result.availabilityState, confidence: result.confidence, metrics: { rotationScore: metric("rotationScore", result.score, result.score == null ? result.availabilityState : "VALID"), rotation: metric("rotation", result.state, result.availabilityState, result.reasons.join(", ")) }, explanation: { reasons: result.reasons }, provenance: result.provenance });
}

export async function persistRotation(context: P3CalculationContext, inputs: RotationInputs, thresholds: RotationThresholds): Promise<{ result: P3CalculationResult; persistence: P3PersistenceOutcome }> {
  validateContext(context);
  const result = calculateRotationResult(context, inputs, thresholds);
  const persistence = await persistP3Calculation({ context, result, membershipSource: "p3_constituent_snapshot", membershipMode: context.calculationMode });
  return { result, persistence };
}
