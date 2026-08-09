import type { P3AvailabilityState, P3Window } from "@/lib/p3/availability";

export interface NarrativeMomentum {
  id: number;
  narrativeId: number;
  date: string;
  momentumScore: number | null;
  momentumType: string | null;
  health7dAgo: number | null;
  healthNow: number | null;
  createdAt: Date;
}

/**
 * Legacy P0-P2 Momentum result shape.
 * Preserved for existing API/consumers. Do not reinterpret as P3.
 */
export interface NarrativeMomentumResult {
  score: number;
  type: "accelerating" | "decelerating" | "stable";
  health7dAgo: number | null;
  healthNow: number | null;
}

/** Narrative-health observation used as P3 Momentum input. */
export interface NarrativeHealthObservation {
  /** UTC daily label YYYY-MM-DD */
  date: string;
  healthScore: number | null;
  /** Defaults to VALID when healthScore is present and finite in-range. */
  availabilityState?: P3AvailabilityState;
  reason?: string;
}

export type AccelerationClassification =
  | "accelerating"
  | "improving"
  | "stable"
  | "slowing"
  | "decelerating";

export interface AccelerationThresholds {
  /** Inclusive lower bound for Accelerating (default 5). */
  accelerating: number;
  /** Inclusive lower bound for Improving (default 2). */
  improving: number;
  /** Inclusive upper bound for Slowing band edge (default -2). */
  slowing: number;
  /** Inclusive upper bound for Decelerating (default -5). */
  decelerating: number;
}

export interface P3WindowMomentum {
  window: P3Window;
  value: number | null;
  state: P3AvailabilityState;
  reason?: string;
  endHealth: number | null;
  startHealth: number | null;
  endDate: string | null;
  startDate: string | null;
  endTargetDate: string;
  startTargetDate: string;
  endGapDays: number | null;
  startGapDays: number | null;
  degradedCoverage: boolean;
}

export interface P3AccelerationResult {
  value: number | null;
  state: P3AvailabilityState;
  reason?: string;
  classification: AccelerationClassification | null;
  formula: "delta3d_minus_delta1d";
  thresholds: AccelerationThresholds;
}

export interface P3MomentumCalculation {
  momentum1d: P3WindowMomentum;
  momentum3d: P3WindowMomentum;
  momentum7d: P3WindowMomentum;
  momentum14d: P3WindowMomentum;
  acceleration: P3AccelerationResult;
  availabilityState: P3AvailabilityState;
  availabilityReason?: string;
  /** Count of distinct UTC daily observations supplied (not calendar span). */
  observationCount: number;
  /**
   * Master Spec display requirement: >= 7 daily snapshots for full 7D display.
   * Distinct from endpoint Delta7D validity (2 endpoints).
   */
  fullSevenObservationCoverage: boolean;
  algorithmKey: string;
  algorithmVersion: string;
  provenance: Record<string, unknown>;
}
