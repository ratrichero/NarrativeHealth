/**
 * P6-05D — Early Warning Engine Types
 *
 * Frozen decisions:
 * - PD-05B-01: Warning vocabulary (7 types)
 * - PD-05B-02: Severity vocabulary (5 levels)
 * - PD-05B-03: Severity determination (multi-factor)
 * - PD-05B-04: Material thresholds (configurable)
 * - PD-05C-01: Warning identity (occurrence-based)
 * - PD-05B-10: Warning lifecycle (4 states)
 *
 * Authority: P6-05B Semantic Contract, P6-05C1 Decision Contract
 */

// ─── WARNING VOCABULARY (PD-05B-01 — FROZEN) ─────────────────────

export type WarningType =
  | "HEALTH_DETERIORATION"
  | "HEALTH_IMPROVEMENT"
  | "REGIME_CHANGE"
  | "REGIME_TRANSITION"
  | "CONFIDENCE_DETERIORATION"
  | "DATA_QUALITY_DEGRADATION"
  | "FRESHNESS_DEGRADATION";

export const ALL_WARNING_TYPES: readonly WarningType[] = [
  "HEALTH_DETERIORATION",
  "HEALTH_IMPROVEMENT",
  "REGIME_CHANGE",
  "REGIME_TRANSITION",
  "CONFIDENCE_DETERIORATION",
  "DATA_QUALITY_DEGRADATION",
  "FRESHNESS_DEGRADATION",
];

// ─── SEVERITY VOCABULARY (PD-05B-02 — FROZEN) ────────────────────

export type Severity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const SEVERITY_ORDER: readonly Severity[] = [
  "INFO",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
];

export const SEVERITY_RANK: Record<Severity, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

// ─── LIFECYCLE (PD-05B-10 — FROZEN) ──────────────────────────────

export type WarningLifecycle =
  | "DETECTED"
  | "ACTIVE"
  | "RESOLVED"
  | "SUPERSEDED";

// ─── ENTITY TYPE ──────────────────────────────────────────────────

export type EntityType = "coin" | "narrative";

// ─── WARNING CONFIGURATION (PD-05B-04 — FROZEN) ──────────────────

export interface WarningConfig {
  /** PD-05B-04: Health score delta threshold (absolute, inclusive) */
  readonly healthDeltaThreshold: number;
  /** PD-05B-04: Confidence delta threshold (absolute, inclusive) */
  readonly confidenceDeltaThreshold: number;
  /** PD-05B-08: Cooldown period in hours */
  readonly cooldownHours: number;
  /** Minimum snapshots required for comparison */
  readonly minSnapshotsForComparison: number;
}

export const DEFAULT_WARNING_CONFIG: WarningConfig = {
  healthDeltaThreshold: 10,
  confidenceDeltaThreshold: 20,
  cooldownHours: 24,
  minSnapshotsForComparison: 2,
};

// ─── SEVERITY DETERMINATION (PD-05B-03 — FROZEN) ─────────────────

export interface SeverityFactor {
  readonly factor: "health_delta" | "regime_context" | "confidence_context" | "warning_type_baseline";
  readonly severity: Severity;
  readonly description: string;
}

// ─── WARNING VERSION (PD-05B-12) ─────────────────────────────────

export interface WarningVersionTuple {
  readonly algorithm_version: string;
  readonly parameter_version: string;
  readonly schema_version: string;
  readonly config_hash: string;
}

export const WARNING_V1_VERSION: WarningVersionTuple = {
  algorithm_version: "p6-warning-v1",
  parameter_version: "default-v1",
  schema_version: "v1",
  config_hash: "default-v1",
};

// ─── WARNING IDENTITY (PD-05C-01 — FROZEN) ───────────────────────

export interface WarningIdentity {
  readonly entity_type: EntityType;
  readonly entity_id: number;
  readonly warning_type: WarningType;
  readonly detection_window: Date;
}

// ─── PROVENANCE ───────────────────────────────────────────────────

export interface WarningProvenance {
  readonly source_layer: "P6-05";
  readonly source_entity: { entity_type: EntityType; entity_id: number };
  readonly source_record_id: number | null;
  readonly snapshot_identity: {
    entity_type: EntityType;
    entity_id: number;
    snapshot_type: string;
    window_end: Date;
  } | null;
  readonly regime_state: string | null;
  readonly previous_regime_state: string | null;
  readonly regime_confidence: number | null;
  readonly health_score: number;
  readonly previous_health_score: number | null;
  readonly health_delta: number | null;
  readonly warning_version: WarningVersionTuple;
  readonly detection_time: Date;
  readonly detection_window: Date;
  readonly quality_summary: Record<string, unknown> | null;
  readonly freshness_summary: Record<string, unknown> | null;
}

// ─── WARNING RECORD ───────────────────────────────────────────────

export interface WarningRecord {
  readonly id: number;
  readonly entity_type: EntityType;
  readonly entity_id: number;
  readonly warning_type: WarningType;
  readonly severity: Severity;
  readonly lifecycle: WarningLifecycle;
  readonly message: string;
  readonly health_score: number;
  readonly previous_health_score: number | null;
  readonly health_delta: number | null;
  readonly regime_state: string | null;
  readonly previous_regime_state: string | null;
  readonly confidence: number;
  readonly dedup_key: string;
  readonly quality_metadata: Record<string, unknown> | null;
  readonly freshness_metadata: Record<string, unknown> | null;
  readonly evidence: Record<string, unknown> | null;
  readonly version: WarningVersionTuple;
  readonly provenance: WarningProvenance;
  readonly detection_window: Date;
  readonly detected_at: Date;
  readonly effective_from: Date;
  readonly effective_until: Date | null;
  readonly superseded_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

// ─── WARNING INPUT (for engine) ──────────────────────────────────

export interface WarningSnapshotInput {
  readonly snapshot_id: number;
  readonly entity_type: EntityType;
  readonly entity_id: number;
  readonly health_score: number;
  readonly confidence_score: number | null;
  readonly calculation_time: Date;
  readonly window_end: Date;
  readonly quality_status: string | null;
  readonly freshness_status: string | null;
  readonly quality_metadata: Record<string, unknown> | null;
  readonly freshness_metadata: Record<string, unknown> | null;
}

export interface WarningRegimeInput {
  readonly entity_type: EntityType;
  readonly entity_id: number;
  readonly regime_state: string;
  readonly previous_state: string | null;
  readonly confidence: number;
  readonly consecutive_count: number;
  readonly health_score: number;
  readonly calculation_time: Date;
}

export interface WarningEngineInput {
  readonly entity_type: EntityType;
  readonly entity_id: number;
  readonly current_snapshot: WarningSnapshotInput;
  readonly previous_snapshot: WarningSnapshotInput | null;
  readonly current_regime: WarningRegimeInput | null;
  readonly previous_regime: WarningRegimeInput | null;
  readonly warning_version: WarningVersionTuple;
  readonly calculation_time: Date;
  readonly existing_active_warnings: ReadonlyArray<WarningRecord>;
}

// ─── WARNING OUTPUT ───────────────────────────────────────────────

export interface WarningOutput {
  readonly warnings: ReadonlyArray<WarningCandidate>;
  readonly warnings_to_resolve: ReadonlyArray<WarningRecord>;
  readonly warnings_to_supersede: ReadonlyArray<WarningRecord>;
}

export interface WarningCandidate {
  readonly warning_type: WarningType;
  readonly severity: Severity;
  readonly severity_factors: ReadonlyArray<SeverityFactor>;
  readonly message: string;
  readonly health_score: number;
  readonly previous_health_score: number | null;
  readonly health_delta: number | null;
  readonly regime_state: string | null;
  readonly previous_regime_state: string | null;
  readonly confidence: number;
  readonly dedup_key: string;
  readonly quality_metadata: Record<string, unknown> | null;
  readonly freshness_metadata: Record<string, unknown> | null;
  readonly evidence: Record<string, unknown>;
  readonly provenance: WarningProvenance;
  readonly detection_window: Date;
  readonly detected_at: Date;
}

// ─── PERSIST INPUT ────────────────────────────────────────────────

export interface PersistWarningInput {
  readonly entity_type: EntityType;
  readonly entity_id: number;
  readonly warning_type: WarningType;
  readonly severity: Severity;
  readonly lifecycle: WarningLifecycle;
  readonly message: string;
  readonly health_score: number;
  readonly previous_health_score: number | null;
  readonly health_delta: number | null;
  readonly regime_state: string | null;
  readonly previous_regime_state: string | null;
  readonly confidence: number;
  readonly dedup_key: string;
  readonly quality_metadata: Record<string, unknown> | null;
  readonly freshness_metadata: Record<string, unknown> | null;
  readonly evidence: Record<string, unknown> | null;
  readonly version: WarningVersionTuple;
  readonly provenance: WarningProvenance;
  readonly detection_window: Date;
  readonly detected_at: Date;
  readonly effective_from: Date;
}
