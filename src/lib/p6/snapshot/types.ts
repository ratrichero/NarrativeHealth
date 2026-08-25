// P6 Intelligence Snapshot Types
// Authority: P6-03B (Snapshot Contract), P6-03C2 (Planner Decision Contract)
// Frozen: P6-01B/C/D/E, P6-02B/C/C2/D/E

// ─── SNAPSHOT VOCABULARY ─────────────────────────────────────────────

export type EntityType = "coin" | "narrative";
export type SnapshotType = "COIN_HEALTH" | "NARRATIVE_HEALTH";
export type SnapshotStatus = "CURRENT" | "SUPERSEDED";
export type SnapshotTimeframe = "DAILY";

// ─── SNAPSHOT VERSION TUPLE (PD-03B-08) ─────────────────────────────
// Standalone — distinct from P6-02 feature version

export interface SnapshotVersionTuple {
  algorithm_version: string;
  parameter_version: string;
  schema_version: string;
  config_hash: string;
}

// ─── SNAPSHOT IDENTITY (PD-03B-03, PD-03B-07, IS-03, IS-04, IS-28) ─

export interface SnapshotIdentity {
  entity_type: EntityType;
  entity_id: number;
  snapshot_type: SnapshotType;
  timeframe: SnapshotTimeframe;
  window_end: Date;
}

// ─── COIN SNAPSHOT INPUT (PD-03B-10, PD-03B-12) ────────────────────

export interface CoinSnapshotInput {
  entity_id: number;
  // From persisted P6 feature record
  health_score: number;
  trend_score: number | null;
  volume_score: number | null;
  momentum_score: number | null;
  derivative_score: number | null;
  confidence_score: number | null;
  data_completeness: number | null;
  // Feature record identity (C-1: provenance feature_id fix)
  feature_record_id: number | null; // FK to features table row
  // Feature version
  feature_version_id: number | null;
  feature_algorithm_version: string;
  feature_parameter_version: string;
  feature_schema_version: string;
  feature_config_hash: string;
  // Quality/freshness metadata from feature
  quality_metadata: Record<string, unknown> | null;
  freshness_metadata: Record<string, unknown> | null;
  // Feature provenance
  feature_provenance: Record<string, unknown> | null;
}

// ─── NARRATIVE SNAPSHOT INPUT (PD-03B-02, PD-03B-04, PD-03B-11, PD-03B-14) ─

export interface NarrativeMemberInput {
  coin_id: number;
  coin_symbol: string;
  health_score: number;
  market_cap: number | null;
  data_completeness: number | null;
  snapshot_id: number;
  quality_metadata: Record<string, unknown> | null;
}

export interface NarrativeSnapshotInput {
  entity_id: number;
  narrative_name: string;
  members: NarrativeMemberInput[];
  membership_source: string; // "coin_narratives" (PD-03B-14)
}

// ─── SNAPSHOT OUTPUT ─────────────────────────────────────────────────

export interface CoinSnapshotOutput {
  identity: SnapshotIdentity;
  health_score: number;
  confidence_score: number;
  data_completeness: number;
  health_dimensions: {
    name: string;
    score: number;
    weight: number;
    available: boolean;
  }[];
  quality_metadata: Record<string, unknown> | null;
  freshness_metadata: Record<string, unknown> | null;
  snapshot_version: SnapshotVersionTuple;
  feature_version_id: number | null;
  feature_version_tuple: {
    algorithm_version: string;
    parameter_version: string;
    schema_version: string;
    config_hash: string;
  };
  calculation_time: Date;
  provenance: SnapshotProvenance;
}

export interface NarrativeSnapshotOutput {
  identity: SnapshotIdentity;
  health_score: number;
  data_completeness: number;
  member_count_expected: number;
  member_count_actual: number;
  member_scores: {
    coin_id: number;
    coin_symbol: string;
    health_score: number;
    weight: number;
    included: boolean;
    exclusion_reason: string | null;
  }[];
  snapshot_version: SnapshotVersionTuple;
  calculation_time: Date;
  provenance: NarrativeSnapshotProvenance;
}

// ─── PROVENANCE (PD-03B-06, IS-11, IS-12) ───────────────────────────

export interface SnapshotProvenance {
  calculation_time: Date;
  snapshot_version: SnapshotVersionTuple;
  input_features: {
    feature_id: number | null;
    feature_name: string;
    feature_score: number;
    feature_p6_version_id: number | null;
    feature_calculated_at: Date | null;
  }[];
  input_observations_count: number;
  data_completeness: number;
  quality_summary: Record<string, unknown> | null;
  freshness_summary: Record<string, unknown> | null;
  input_window_start: Date | null;
  input_window_end: Date;
  entity_snapshot_time: Date;
}

export interface NarrativeSnapshotProvenance extends SnapshotProvenance {
  member_coin_snapshots: {
    snapshot_id: number;
    coin_id: number;
    health_score: number;
    weight: number;
  }[];
  member_count: number;
  aggregation_method: string;
  weighting_method: string;
}

// ─── NEUTRAL DEFAULTS ────────────────────────────────────────────────

export const SNAPSHOT_NEUTRAL_SCORE = 50;
export const SNAPSHOT_V1_VERSION: SnapshotVersionTuple = {
  algorithm_version: "p6-snapshot-v1",
  parameter_version: "default-v1",
  schema_version: "v1",
  config_hash: "default-v1",
};
