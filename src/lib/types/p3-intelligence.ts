import type { P3AvailabilityState } from "@/lib/p3/availability";

export type { P3AvailabilityState };

/**
 * P3 Intelligence read model — a frontend-safe projection of an immutable,
 * persisted P3 narrative intelligence artifact.
 *
 * This is a READ MODEL ONLY. It is intentionally decoupled from the P3
 * calculation structures (`P3CalculationResult` / `P3MetricResult`) and is
 * never produced by re-running P3 calculations. It is built exclusively from
 * persisted `p3_narrative_intelligence` (and related) rows.
 */

/** A numeric stage with a pre-formatted display string (e.g. breadth). */
export interface P3StageViewModel {
  availabilityState: P3AvailabilityState;
  /** Raw persisted numeric value, or null when the stage is unavailable. */
  value: number | null;
  /** Human display string, e.g. "0.140" or "+14.03%". */
  display: string;
}

/** A classification stage (e.g. regime) carrying its persisted label. */
export interface P3ClassificationViewModel {
  availabilityState: P3AvailabilityState;
  /** Persisted classification, e.g. "NEUTRAL". Null only when unavailable. */
  classification: string | null;
  display: string;
}

/** Rotation stage: classification plus its 0-100 score. */
export interface P3RotationViewModel {
  availabilityState: P3AvailabilityState;
  classification: string | null;
  score: number | null;
  scoreDisplay: string;
}

/** Narrative leadership stage. */
export interface P3LeadershipViewModel {
  availabilityState: P3AvailabilityState;
  coinId: number | null;
  symbol: string | null;
  score: number | null;
  scoreDisplay: string;
}

/** Constituent membership summary for the artifact window. */
export interface P3ConstituentsViewModel {
  count: number | null;
  availabilityState: P3AvailabilityState;
}

export interface P3IntelligenceViewModel {
  artifactId: number;
  narrativeId: number;
  /** Calculation window label, e.g. "7D". */
  window: string;
  /** Window end as ISO UTC string (e.g. "2026-08-11T00:00:00.000Z"). */
  windowEnd: string;
  /** Human window-end label in UTC, e.g. "11 Aug 2026". */
  windowEndLabel: string;
  calculationMode: string;
  algorithmKey: string;
  algorithmVersion: string;
  availabilityState: P3AvailabilityState;
  regime: P3ClassificationViewModel;
  rotation: P3RotationViewModel;
  breadth: P3StageViewModel;
  momentum: P3StageViewModel;
  relativeStrength: P3StageViewModel;
  leadership: P3LeadershipViewModel;
  constituents: P3ConstituentsViewModel;
}
