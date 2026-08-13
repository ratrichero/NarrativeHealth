import type { P3Availability, P3AvailabilityState, P3Window } from "./availability";

export interface P3Constituent {
  coinId: number;
  membershipState: string;
  inclusionReason?: string | null;
  availabilityState: P3AvailabilityState;
  inputManifest?: Record<string, unknown> | null;
}

export interface P3CalculationContext {
  narrativeId: number;
  calculationMode: string;
  window: P3Window;
  windowStart: Date;
  windowEnd: Date;
  calculatedAt: Date;
  algorithmKey: string;
  algorithmVersion: string;
  ruleVersionId?: number | null;
  featureVersionId?: number | null;
  scoreConfigId?: number | null;
  membershipSnapshotId?: number | null;
  constituents: readonly P3Constituent[];
  sourceAvailability: Readonly<Record<string, P3Availability<unknown>>>;
  btcBenchmark?: P3Availability<unknown>;
  provenance: Readonly<Record<string, unknown>>;
}

export interface P3MetricResult<T> extends P3Availability<T> {
  metric: string;
}

export interface P3CalculationResult {
  narrativeId: number;
  windowStart: Date;
  windowEnd: Date;
  algorithmKey: string;
  algorithmVersion: string;
  calculationMode: string;
  availabilityState: P3AvailabilityState;
  confidence: number | null;
  metrics: Readonly<Record<string, P3MetricResult<number | string>>>;
  explanation?: Record<string, unknown>;
  provenance: Record<string, unknown>;
}

export function createCalculationContext(input: Omit<P3CalculationContext, "provenance"> & { provenance?: Record<string, unknown> }): P3CalculationContext {
  return {
    ...input,
    provenance: {
      ...input.provenance,
      kernel: "p3-core",
      context: {
        narrativeId: input.narrativeId,
        calculationMode: input.calculationMode,
        window: input.window,
        windowStart: input.windowStart.toISOString(),
        windowEnd: input.windowEnd.toISOString(),
        algorithmKey: input.algorithmKey,
        algorithmVersion: input.algorithmVersion,
      },
    },
  };
}

export function calculationIdentity(context: Pick<P3CalculationContext, "narrativeId" | "windowEnd" | "algorithmKey" | "algorithmVersion" | "calculationMode">): string {
  return [context.narrativeId, context.windowEnd.toISOString(), context.algorithmKey, context.algorithmVersion, context.calculationMode].join("|");
}

export function normalizeResult(context: P3CalculationContext, result: Omit<P3CalculationResult, "narrativeId" | "windowStart" | "windowEnd" | "algorithmKey" | "algorithmVersion" | "calculationMode" | "provenance"> & { provenance?: Record<string, unknown> }): P3CalculationResult {
  return {
    ...result,
    narrativeId: context.narrativeId,
    windowStart: context.windowStart,
    windowEnd: context.windowEnd,
    algorithmKey: context.algorithmKey,
    algorithmVersion: context.algorithmVersion,
    calculationMode: context.calculationMode,
    provenance: { ...context.provenance, ...result.provenance },
  };
}
