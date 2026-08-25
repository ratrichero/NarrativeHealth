/**
 * P6-06D — Intelligence Aggregation Types
 *
 * Planner-accepted decisions implemented:
 * - PD-06A-01: Summary scope (coherent view + structured explanation)
 * - PD-06A-02: Explanation format (structured arrays, template-derived)
 * - PD-06A-03: Change detection (current vs immediate previous only)
 * - PD-06A-04: Minimum population (≥1 authoritative input)
 * - PD-06C-01: window_end precedence (snapshot → regime → max warning)
 *
 * Authority: P6-06B Semantic Contract, P6-06C Inventory, P6-06C1 Decision Contract
 */

import type { Severity } from "../warning/types";

// ─── ENTITY & TIMEFRAME ───────────────────────────────────────────

export type EntityType = "coin" | "narrative";
export type Timeframe = "DAILY";

// ─── LIFECYCLE (PD-06B-06 — ACCEPTED DEFAULT) ─────────────────────

export type SummaryLifecycle = "CURRENT" | "SUPERSEDED";

// ─── VERSION TUPLE (PD-06A-10 — STANDALONE) ───────────────────────

export interface SummaryVersionTuple {
  readonly algorithm_version: string;
  readonly parameter_version: string;
  readonly schema_version: string;
  readonly config_hash: string;
}

export const SUMMARY_V1_VERSION: SummaryVersionTuple = {
  algorithm_version: "p6-summary-v1",
  parameter_version: "default-v1",
  schema_version: "v1",
  config_hash: "default-v1",
};

// ─── CONFIGURATION ────────────────────────────────────────────────

export interface SummaryConfig {
  /** PD-06B-08: Maximum explanation items per array */
  readonly explanationCap: number;
  /** PD-06B-07: Top-N member movers shown as context (narrative only) */
  readonly topNMovers: number;
}

export const DEFAULT_SUMMARY_CONFIG: SummaryConfig = {
  explanationCap: 10,
  topNMovers: 5,
};

// ─── EXPLANATION (PD-06A-02 — STRUCTURED ARRAYS) ──────────────────

export type ExplanationCategory =
  | "HEALTH"
  | "REGIME"
  | "WARNING"
  | "QUALITY"
  | "FRESHNESS";

export interface ExplanationItem {
  readonly category: ExplanationCategory;
  readonly text: string; // template-rendered, evidence-filled — never LLM prose
  readonly evidence_ref: string; // provenance pointer to source artifact
  readonly severity: Severity | null;
}

export interface Explanation {
  readonly what_changed: ReadonlyArray<ExplanationItem>;
  readonly why: ReadonlyArray<ExplanationItem>;
  readonly what_to_watch: ReadonlyArray<ExplanationItem>;
}

// ─── WARNING REPRESENTATION (read-only from P6-05) ────────────────

export interface WarningSummaryItem {
  readonly warning_id: number;
  readonly warning_type: string;
  readonly severity: Severity;
  readonly message: string;
  readonly detection_window: Date;
  readonly detected_at: Date;
  /** P6-05 lifecycle end bound — null while still active. */
  readonly effective_until: Date | null;
}

// ─── INPUT ARTIFACTS (authoritative frozen outputs) ──────────────

/** Current P6-03 snapshot (pass-through values). */
export interface AggregationSnapshotInput {
  readonly snapshot_id: number;
  readonly health_score: number | null;
  readonly confidence_score: number | null;
  readonly calculation_time: Date;
  readonly window_end: Date;
  readonly quality_status: string | null;
  readonly freshness_status: string | null;
  readonly quality_metadata: Record<string, unknown> | null;
  readonly freshness_metadata: Record<string, unknown> | null;
}

/** Current P6-04 regime state (display-only; never recomputed). */
export interface AggregationRegimeInput {
  readonly regime_id: number;
  readonly regime_state: string;
  readonly confidence: number | null;
  readonly calculation_time: Date;
}

/** Immediate-previous context for two-point change detection (PD-06A-03). */
export interface PreviousContextInput {
  readonly previous_snapshot: {
    readonly snapshot_id: number;
    readonly health_score: number | null;
    readonly confidence_score: number | null;
    readonly window_end: Date;
  } | null;
  readonly previous_regime_state: string | null;
  /** calculated_at of the previous aggregation evaluation (bounds resolved-warning window). */
  readonly previous_calculated_at: Date | null;
}

/** Full engine input. */
export interface SummaryEngineInput {
  readonly entity_type: EntityType;
  readonly entity_id: number;
  readonly timeframe: Timeframe;
  readonly current_snapshot: AggregationSnapshotInput | null;
  readonly current_regime: AggregationRegimeInput | null;
  readonly active_warnings: ReadonlyArray<WarningSummaryItem>;
  readonly recently_resolved_warnings: ReadonlyArray<WarningSummaryItem>;
  readonly previous: PreviousContextInput;
  readonly version: SummaryVersionTuple;
  readonly config: SummaryConfig;
  /** Wall-clock time of this evaluation — recorded, never used in classification. */
  readonly calculation_time: Date;
}

// ─── CHANGE DETECTION RESULT ──────────────────────────────────────

export interface ChangeDetectionResult {
  readonly health_delta: number | null;
  readonly health_change_pct: number | null;
  readonly regime_changed: boolean;
  readonly new_warning_count: number;
  readonly resolved_warning_count: number;
}

// ─── OUTPUT ARTIFACT (PD-06B-05 identity) ─────────────────────────

export interface IntelligenceSummary {
  // Identity
  readonly entity_type: EntityType;
  readonly entity_id: number;
  readonly timeframe: Timeframe;

  // Current state (pass-through from frozen layers)
  readonly health_score: number | null; // from P6-03, as-is
  readonly snapshot_confidence: number | null; // from P6-03, as-is
  readonly regime_state: string | null; // from P6-04, as-is
  readonly regime_confidence: number | null; // from P6-04, as-is

  // Warning synthesis (from P6-05, read-only)
  readonly active_warning_count: number;
  readonly highest_severity: Severity | null;
  readonly active_warnings: ReadonlyArray<WarningSummaryItem>;

  // Change detection (PD-06A-03: vs immediate previous only)
  readonly health_delta: number | null;
  readonly health_change_pct: number | null;
  readonly regime_changed: boolean;
  readonly previous_regime_state: string | null;
  readonly new_warning_count: number;
  readonly resolved_warning_count: number;

  // Explanation output (PD-06A-02)
  readonly what_changed: ReadonlyArray<ExplanationItem>;
  readonly why: ReadonlyArray<ExplanationItem>;
  readonly what_to_watch: ReadonlyArray<ExplanationItem>;

  // Metadata
  readonly quality_metadata: Record<string, unknown> | null;
  readonly freshness_metadata: Record<string, unknown> | null;

  // Traceability
  readonly provenance: SummaryProvenance;
  readonly version: SummaryVersionTuple;

  // Timestamps
  readonly calculated_at: Date;
  readonly window_end: Date;
}

// ─── PROVENANCE ───────────────────────────────────────────────────

export interface SummaryProvenance {
  readonly source_layer: "P6-06";
  readonly entity: { readonly entity_type: EntityType; readonly entity_id: number };
  readonly input_snapshot_id: number | null;
  readonly input_snapshot_window_end: Date | null;
  readonly previous_snapshot_id: number | null;
  readonly input_regime_id: number | null;
  readonly input_warning_ids: ReadonlyArray<number>;
  readonly calculation_time: Date;
  readonly window_end: Date;
  readonly window_end_source: WindowEndSource;
  readonly summary_version: SummaryVersionTuple;
  readonly quality_summary: Record<string, unknown> | null;
  readonly freshness_summary: Record<string, unknown> | null;
}

export type WindowEndSource = "snapshot" | "regime" | "warning";
