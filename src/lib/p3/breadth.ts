import type { P3AvailabilityState } from "./availability";
import type { P3CalculationContext, P3CalculationResult, P3MetricResult } from "./context";
import { normalizeResult } from "./context";

export interface BreadthConstituent {
  coinId: number;
  health: number | null;
  availabilityState: P3AvailabilityState;
  availabilityReason?: string;
}

export interface BreadthCalculation {
  totalCoins: number;
  bullishCoins: number;
  neutralCoins: number;
  weakCoins: number;
  bullishRatio: number | null;
  strongBreadth: number | null;
  availabilityState: P3AvailabilityState;
  availabilityReason?: string;
  provenance: Record<string, unknown>;
}

function metric(metricName: string, value: number | null, state: P3AvailabilityState, reason?: string): P3MetricResult<number> {
  return { metric: metricName, value, state, ...(reason ? { reason } : {}) };
}

export function calculateBreadth(
  constituents: readonly BreadthConstituent[],
  provenance: Record<string, unknown> = {},
): BreadthCalculation {
  const totalCoins = constituents.length;
  if (totalCoins === 0) {
    return {
      totalCoins: 0,
      bullishCoins: 0,
      neutralCoins: 0,
      weakCoins: 0,
      bullishRatio: null,
      strongBreadth: null,
      availabilityState: "INSUFFICIENT_HISTORY",
      availabilityReason: "No active constituents were supplied",
      provenance: { ...provenance, denominator: "total_active_coins" },
    };
  }

  let bullishCoins = 0;
  let neutralCoins = 0;
  let weakCoins = 0;
  let strongCoins = 0;
  const unavailableInputs: Array<{ coinId: number; state: P3AvailabilityState; reason?: string }> = [];

  for (const constituent of constituents) {
    if (constituent.availabilityState !== "VALID" || constituent.health == null) {
      unavailableInputs.push({ coinId: constituent.coinId, state: constituent.availabilityState, reason: constituent.availabilityReason });
      continue;
    }
    if (!Number.isFinite(constituent.health) || constituent.health < 0 || constituent.health > 100) {
      unavailableInputs.push({ coinId: constituent.coinId, state: "INVALID", reason: "Health must be finite and within 0..100" });
      continue;
    }
    if (constituent.health >= 65) bullishCoins += 1;
    else if (constituent.health >= 50) neutralCoins += 1;
    else weakCoins += 1;
    if (constituent.health >= 80) strongCoins += 1;
  }

  const hasUnavailableInputs = unavailableInputs.length > 0;
  return {
    totalCoins,
    bullishCoins,
    neutralCoins,
    weakCoins,
    bullishRatio: hasUnavailableInputs ? null : bullishCoins / totalCoins,
    strongBreadth: hasUnavailableInputs ? null : strongCoins / totalCoins,
    availabilityState: hasUnavailableInputs ? "MISSING" : "VALID",
    ...(hasUnavailableInputs ? { availabilityReason: "One or more constituent health values were unavailable" } : {}),
    provenance: {
      ...provenance,
      denominator: "total_active_coins",
      bullishThreshold: 65,
      strongThreshold: 80,
      neutralLowerBound: 50,
      bullishLowerBound: 65,
      unavailableCount: unavailableInputs.length,
      unavailableInputs,
    },
  };
}

export function calculateBreadthResult(context: P3CalculationContext, constituents: readonly BreadthConstituent[]): P3CalculationResult {
  const breadth = calculateBreadth(constituents, { ...context.provenance, module: "breadth" });
  return normalizeResult(context, {
    availabilityState: breadth.availabilityState,
    confidence: null,
    metrics: {
      breadth: metric("breadth", breadth.bullishRatio, breadth.bullishRatio == null ? breadth.availabilityState : "VALID", breadth.availabilityReason),
      strongBreadth: metric("strongBreadth", breadth.strongBreadth, breadth.strongBreadth == null ? breadth.availabilityState : "VALID", breadth.availabilityReason),
      totalCoins: metric("totalCoins", breadth.totalCoins, "VALID"),
      bullishCoins: metric("bullishCoins", breadth.bullishCoins, "VALID"),
      neutralCoins: metric("neutralCoins", breadth.neutralCoins, "VALID"),
      weakCoins: metric("weakCoins", breadth.weakCoins, "VALID"),
    },
    explanation: {
      totalCoins: breadth.totalCoins,
      bullishCoins: breadth.bullishCoins,
      neutralCoins: breadth.neutralCoins,
      weakCoins: breadth.weakCoins,
      ...(breadth.availabilityReason ? { availabilityReason: breadth.availabilityReason } : {}),
    },
    provenance: breadth.provenance,
  });
}