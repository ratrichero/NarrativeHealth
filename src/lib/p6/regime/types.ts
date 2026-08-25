/**
 * P6-04D — Trend / Regime Detection Types
 *
 * Frozen decisions:
 * - PD-04B-01: RegimeState vocabulary (6 states)
 * - PD-04B-04: Transition threshold = 10 points
 * - PD-04B-05: Minimum persistence = 2 consecutive snapshots
 *
 * Authority: P6-04B Semantic Contract, P6-04C1 Decision Contract
 */

// ─── REGIME VOCABULARY (PD-04B-01 — FROZEN) ──────────────────────

export type RegimeState =
  | "STRONG"
  | "STABLE"
  | "WEAK"
  | "TRANSITIONING"
  | "INSUFFICIENT_DATA"
  | "UNKNOWN";

export type EntityType = "coin" | "narrative";

// ─── REGIME CONFIGURATION (PD-04B-04, PD-04B-05 — FROZEN) ────────

export interface RegimeConfig {
  /** PD-04B-04: 10 points absolute on 0–100 scale (FROZEN) */
  readonly threshold: number;
  /** PD-04B-05: 2 consecutive qualifying snapshots (FROZEN) */
  readonly minPersistence: number;
  /** PD-04B-03: 14 daily snapshots (safe default) */
  readonly lookbackWindow: number;
  /** PD-04B-07: Tolerate ≤ 3 consecutive missing daily snapshots */
  readonly maxGapDays: number;
}

export const DEFAULT_REGIME_CONFIG: RegimeConfig = {
  threshold: 10,
  minPersistence: 2,
  lookbackWindow: 14,
  maxGapDays: 3,
};

// Derived boundaries from threshold = 10
// STRONG: health_score >= 80
// STABLE: 40 <= health_score <= 60
// WEAK:   health_score <= 20
// Neutral bands: 20-40 and 60-80

export const BOUNDARY_STRONG = 80;  // threshold + 70 (center of STRONG zone)
export const BOUNDARY_STABLE_UPPER = 60;
export const BOUNDARY_STABLE_LOWER = 40;
export const BOUNDARY_WEAK = 20;    // threshold below center of WEAK zone

// ─── STATE PROPERTIES (P6-04B §6.4) ─────────────────────────────

export interface RegimeStateProperties {
  readonly current_state: RegimeState;
  readonly previous_state: RegimeState | null;
  readonly transition_started_at: Date | null;
  readonly transition_target: RegimeState | null;
  readonly consecutive_count: number;
  readonly score_at_transition: number | null;
}

// ─── REGIME VERSION (PD-04B-08, P6-04B §11) ─────────────────────

export interface RegimeVersionTuple {
  readonly algorithm_version: string;
  readonly parameter_version: string;
  readonly schema_version: string;
  readonly config_hash: string;
}

export const REGIME_V1_VERSION: RegimeVersionTuple = {
  algorithm_version: "p6-regime-v1",
  parameter_version: "default-v1",
  schema_version: "v1",
  config_hash: "default-v1",
};

// ─── QUALITY / FRESHNESS METADATA ────────────────────────────────

export interface RegimeQualityMetadata {
  readonly input_snapshots_total: number;
  readonly input_snapshots_valid: number;
  readonly input_snapshots_invalid: number;
  readonly input_snapshots_missing: number;
  readonly input_snapshots_unknown_quality: number;
  readonly data_sufficiency: number; // 0-100
}

export interface RegimeFreshnessMetadata {
  readonly input_snapshots_fresh: number;
  readonly input_snapshots_stale: number;
  readonly input_snapshots_unknown_freshness: number;
  readonly freshness_coverage: number; // 0-100
}

// ─── PROVENANCE (P6-04B §12) ─────────────────────────────────────

export interface RegimeProvenance {
  readonly calculation_time: Date;
  readonly regime_version: RegimeVersionTuple;
  readonly input_snapshot_ids: ReadonlyArray<{
    readonly snapshot_id: number;
    readonly entity_type: EntityType;
    readonly entity_id: number;
    readonly health_score: number;
    readonly calculation_time: Date;
  }>;
  readonly lookback_window: number;
  readonly input_window_start: Date | null;
  readonly input_window_end: Date | null;
  readonly transition_from: RegimeState | null;
  readonly transition_to: RegimeState | null;
  readonly transition_confidence: number;
  readonly quality_summary: RegimeQualityMetadata | null;
  readonly freshness_summary: RegimeFreshnessMetadata | null;
}

// ─── REGIME INPUT ─────────────────────────────────────────────────

export interface RegimeSnapshotInput {
  readonly snapshot_id: number;
  readonly entity_type: EntityType;
  readonly entity_id: number;
  readonly health_score: number;
  readonly calculation_time: Date;
  readonly quality_status?: string; // VALID | INVALID | MISSING | UNKNOWN
  readonly freshness_status?: string; // FRESH | STALE | UNKNOWN
}

export interface RegimeInput {
  readonly entity_type: EntityType;
  readonly entity_id: number;
  readonly current_snapshot: RegimeSnapshotInput;
  readonly historical_snapshots: ReadonlyArray<RegimeSnapshotInput>;
  readonly regime_version: RegimeVersionTuple;
  readonly calculation_time: Date;
}

// ─── REGIME OUTPUT ────────────────────────────────────────────────

export interface RegimeOutput {
  readonly entity_type: EntityType;
  readonly entity_id: number;
  readonly regime_state: RegimeState;
  readonly previous_state: RegimeState | null;
  readonly confidence: number;
  readonly consecutive_count: number;
  readonly health_score: number;
  readonly regime_version: RegimeVersionTuple;
  readonly snapshot_version_id: number | null;
  readonly provenance: RegimeProvenance;
  readonly quality_metadata: RegimeQualityMetadata;
  readonly freshness_metadata: RegimeFreshnessMetadata;
  readonly calculation_time: Date;
}

// ─── PERSISTENCE ──────────────────────────────────────────────────

export type RegimeStatus = "CURRENT" | "SUPERSEDED";

export interface PersistRegimeInput {
  readonly entity_type: EntityType;
  readonly entity_id: number;
  readonly regime_state: RegimeState;
  readonly previous_state: RegimeState | null;
  readonly confidence: number;
  readonly consecutive_count: number;
  readonly health_score: number;
  readonly regime_version: RegimeVersionTuple;
  readonly snapshot_version_id: number | null;
  readonly provenance: RegimeProvenance;
  readonly quality_metadata: RegimeQualityMetadata;
  readonly freshness_metadata: RegimeFreshnessMetadata;
  readonly calculation_time: Date;
}
