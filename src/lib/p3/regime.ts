import type { P3AvailabilityState } from "./availability";
import type { P3CalculationContext, P3CalculationResult, P3MetricResult } from "./context";
import { normalizeResult } from "./context";
import { persistP3Calculation, type P3PersistenceOutcome } from "./persistence";

export const P3_REGIME_ALGORITHM_KEY = "regime";
export const P3_REGIME_ALGORITHM_VERSION = "1";
export const P3_REGIMES = ["EMERGING", "STRONG", "MATURE", "WEAKENING", "DEAD"] as const;
export type P3Regime = (typeof P3_REGIMES)[number];

export interface RegimeInputs {
  health: number | null;
  healthChange: number | null;
  breadth: number | null;
  breadthChange: number | null;
  momentum: number | null;
  acceleration: number | null;
  relativeStrength: number | null;
  relativeStrengthChange: number | null;
  confidence?: number | null;
  availabilityState?: P3AvailabilityState;
}

export interface RegimeThresholds {
  healthHigh: number;
  healthLow: number;
  breadthHigh: number;
  breadthLow: number;
  momentumPositive: number;
  momentumNegative: number;
  accelerationDeclining: number;
  healthImproving: number;
  breadthIncreasing: number;
  relativeStrengthImproving: number;
  healthDeclining: number;
  breadthDeclining: number;
  momentumWeakening: number;
  relativeStrengthPositive: number;
  relativeStrengthNegative: number;
}

export interface RegimeResult {
  regime: P3Regime | null;
  availabilityState: P3AvailabilityState;
  reasons: readonly string[];
  confidence: number | null;
  provenance: Record<string, unknown>;
}

function valid(value: number | null): value is number { return value != null && Number.isFinite(value); }
function validateThresholds(thresholds: RegimeThresholds): void {
  if (Object.values(thresholds).some((value) => !Number.isFinite(value))) throw new Error("Regime thresholds must be finite");
  if (thresholds.healthHigh <= thresholds.healthLow) throw new Error("Regime healthHigh must exceed healthLow");
  if (thresholds.breadthHigh <= thresholds.breadthLow) throw new Error("Regime breadthHigh must exceed breadthLow");
}
function validateContext(context: P3CalculationContext): void {
  if (context.algorithmKey !== P3_REGIME_ALGORITHM_KEY || context.algorithmVersion !== P3_REGIME_ALGORITHM_VERSION) throw new Error("Regime context must use algorithm identity regime/1");
}
function unavailable(inputs: RegimeInputs): RegimeResult {
  return { regime: null, availabilityState: inputs.availabilityState && inputs.availabilityState !== "VALID" ? inputs.availabilityState : "MISSING", reasons: ["Required regime input is unavailable"], confidence: null, provenance: { module: "regime" } };
}

export function classifyRegime(inputs: RegimeInputs, thresholds: RegimeThresholds): RegimeResult {
  validateThresholds(thresholds);
  const values = [inputs.health, inputs.healthChange, inputs.breadth, inputs.breadthChange, inputs.momentum, inputs.acceleration, inputs.relativeStrength, inputs.relativeStrengthChange];
  if (values.some((value) => !valid(value))) return unavailable(inputs);
  const h = inputs.health as number, dh = inputs.healthChange as number, b = inputs.breadth as number, db = inputs.breadthChange as number, m = inputs.momentum as number, a = inputs.acceleration as number, rs = inputs.relativeStrength as number, drs = inputs.relativeStrengthChange as number;
  const matches: Array<{ regime: P3Regime; reasons: string[] }> = [];
  if (dh >= thresholds.healthImproving && m > thresholds.momentumPositive && db >= thresholds.breadthIncreasing && drs >= thresholds.relativeStrengthImproving) matches.push({ regime: "EMERGING", reasons: ["health_improving", "momentum_positive", "breadth_increasing", "relative_strength_improving"] });
  if (h >= thresholds.healthHigh && b >= thresholds.breadthHigh && m > thresholds.momentumPositive && rs > thresholds.relativeStrengthPositive) matches.push({ regime: "STRONG", reasons: ["health_high", "breadth_high", "momentum_positive", "relative_strength_positive"] });
  if (h >= thresholds.healthHigh && b >= thresholds.breadthHigh && m <= thresholds.momentumPositive && a <= thresholds.accelerationDeclining) matches.push({ regime: "MATURE", reasons: ["health_high", "breadth_high", "momentum_slowing", "acceleration_declining"] });
  if ((dh <= thresholds.healthDeclining || db <= thresholds.breadthDeclining) && m <= thresholds.momentumWeakening) matches.push({ regime: "WEAKENING", reasons: ["health_or_breadth_declining", "momentum_weakening"] });
  if (h <= thresholds.healthLow && b <= thresholds.breadthLow && m < thresholds.momentumNegative && rs < thresholds.relativeStrengthNegative) matches.push({ regime: "DEAD", reasons: ["health_low", "breadth_low", "momentum_negative", "relative_strength_negative"] });
  if (matches.length !== 1) return { regime: null, availabilityState: matches.length === 0 ? "NOT_APPLICABLE" : "AMBIGUOUS", reasons: matches.length === 0 ? ["No regime rule matched"] : matches.flatMap((match) => [`matched_${match.regime.toLowerCase()}`, ...match.reasons]), confidence: inputs.confidence ?? null, provenance: { module: "regime", thresholds, matched: matches.map((match) => match.regime) } };
  return { regime: matches[0].regime, availabilityState: "VALID", reasons: matches[0].reasons, confidence: inputs.confidence ?? null, provenance: { module: "regime", thresholds, matched: [matches[0].regime] } };
}

function metric(name: string, value: string | null, state: P3AvailabilityState, reason?: string): P3MetricResult<string> { return { metric: name, value, state, ...(reason ? { reason } : {}) }; }
export function calculateRegimeResult(context: P3CalculationContext, inputs: RegimeInputs, thresholds: RegimeThresholds): P3CalculationResult {
  validateContext(context);
  const result = classifyRegime(inputs, thresholds);
  return normalizeResult(context, { availabilityState: result.availabilityState, confidence: result.confidence, metrics: { regime: metric("regime", result.regime, result.availabilityState, result.reasons.join(", ")) }, explanation: { reasons: result.reasons }, provenance: result.provenance });
}

export async function persistRegime(context: P3CalculationContext, inputs: RegimeInputs, thresholds: RegimeThresholds): Promise<{ result: P3CalculationResult; persistence: P3PersistenceOutcome }> {
  validateContext(context);
  const result = calculateRegimeResult(context, inputs, thresholds);
  const persistence = await persistP3Calculation({ context, result, membershipSource: "p3_constituent_snapshot", membershipMode: context.calculationMode });
  return { result, persistence };
}
