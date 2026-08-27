/**
 * P6-08D — Historical Intelligence / Temporal Comparison Types
 *
 * Frozen decisions:
 * - PD-08A-01: Derive on-read (no persistence)
 * - PD-08A-02: Windows = 7d, 30d, baseline
 * - PD-08A-03: Membership at comparison time
 * - PD-08C-03: Warning matching = entity_type + entity_id + warning_type + detection_window
 * - PD-08C-04: Membership reconstruction = latest event per coin at effective_at ≤ T
 *
 * Authority: P6-08B Semantic Contract, P6-08C1 Decision Contract, P6-08C2 Planner Acceptance
 */

// ─── VERSION ──────────────────────────────────────────────────────

export interface HistoricalVersionTuple {
  readonly comparison_algorithm_version: string;
  readonly snapshot_version: string;
  readonly regime_version: string;
  readonly warning_version: string;
}

export const HISTORICAL_V1_VERSION: HistoricalVersionTuple = {
  comparison_algorithm_version: "p6-comparison-v1",
  snapshot_version: "p6-snapshot-v1",
  regime_version: "p6-regime-v1",
  warning_version: "p6-warning-v1",
};

// ─── COMPARISON WINDOWS (PD-08A-02) ──────────────────────────────

export type ComparisonWindow = "7d" | "30d" | "baseline";

export const WINDOW_DAYS: Record<string, number> = {
  "7d": 7,
  "30d": 30,
};

// ─── ENTITY ───────────────────────────────────────────────────────

export type EntityType = "coin" | "narrative";
export type SnapshotType = "COIN_HEALTH" | "NARRATIVE_HEALTH";

// ─── TIMELINE ─────────────────────────────────────────────────────

export interface TimelineDataPoint {
  readonly window_end: string;
  readonly health_score: number | null;
  readonly confidence_score: number | null;
  readonly regime_state: string | null;
  readonly warning_count: number;
  readonly has_data: boolean;
  readonly snapshot_id: number | null;
}

export interface HealthTimeline {
  readonly entity_type: EntityType;
  readonly entity_id: number;
  readonly data_points: ReadonlyArray<TimelineDataPoint>;
  readonly history_length: number;
  readonly first_snapshot_window_end: string | null;
  readonly last_snapshot_window_end: string | null;
}

// ─── COMPARISON RESULT ────────────────────────────────────────────

export interface ComparisonDelta {
  readonly health_delta: number | null;
  readonly health_change_pct: number | null;
  readonly confidence_delta: number | null;
  readonly regime_changed: boolean;
  readonly current_regime: string | null;
  readonly historical_regime: string | null;
  readonly warning_count_delta: number;
}

export interface ComparisonArtifactReference {
  readonly snapshot_id: number;
  readonly window_end: string;
  readonly health_score: number;
  readonly confidence_score: number | null;
}

export interface ComparisonProvenance {
  readonly comparison_algorithm: string;
  readonly calculated_at: string;
  readonly current_snapshot_id: number;
  readonly current_snapshot_window_end: string;
  readonly historical_snapshot_id: number;
  readonly historical_snapshot_window_end: string;
  readonly membership_reconstructed: boolean;
  readonly membership_event_count: number;
}

export interface HistoricalComparisonResult {
  readonly entity_type: EntityType;
  readonly entity_id: number;
  readonly comparison_type: string;
  readonly comparison_window: ComparisonWindow;
  readonly requested_window_days: number | null;
  readonly actual_window_days: number | null;
  readonly insufficient_history: boolean;

  readonly current: ComparisonArtifactReference | null;
  readonly historical: ComparisonArtifactReference | null;
  readonly delta: ComparisonDelta | null;

  readonly current_regime: string | null;
  readonly historical_regime: string | null;
  readonly current_warnings: ReadonlyArray<ComparisonWarning>;
  readonly historical_warnings: ReadonlyArray<ComparisonWarning>;
  readonly matched_warnings: ReadonlyArray<WarningMatch>;
  readonly new_warnings: ReadonlyArray<ComparisonWarning>;
  readonly resolved_warnings: ReadonlyArray<ComparisonWarning>;

  readonly membership_changed: boolean | null;
  readonly current_member_count: number | null;
  readonly historical_member_count: number | null;

  readonly quality_metadata: Record<string, unknown> | null;
  readonly freshness_metadata: Record<string, unknown> | null;
  readonly provenance: ComparisonProvenance;
  readonly version: HistoricalVersionTuple;
}

// ─── WARNING COMPARISON ───────────────────────────────────────────

export interface ComparisonWarning {
  readonly warning_id: number;
  readonly warning_type: string;
  readonly severity: string;
  readonly lifecycle: string;
  readonly detection_window: string;
}

export interface WarningMatch {
  readonly warning_type: string;
  readonly detection_window: string;
  readonly current_severity: string;
  readonly historical_severity: string;
  readonly severity_changed: boolean;
}

// ─── MEMBERSHIP ───────────────────────────────────────────────────

export interface MembershipEvent {
  readonly id: number;
  readonly coin_id: number;
  readonly event_type: string;
  readonly is_primary: boolean | null;
  readonly effective_at: Date;
}

export interface HistoricalMembership {
  readonly narrative_id: number;
  readonly as_of: Date;
  readonly members: ReadonlyArray<{
    readonly coin_id: number;
    readonly is_primary: boolean;
  }>;
  readonly member_count: number;
  readonly membership_changed: boolean;
  readonly event_count: number;
}
