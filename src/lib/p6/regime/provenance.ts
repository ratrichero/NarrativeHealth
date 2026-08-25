/**
 * P6-04D — Regime Provenance Assembly
 *
 * P6-04B §12: Minimum provenance chain:
 * regime → snapshot → feature → observation
 *
 * TR-16: Provenance immutable once persisted.
 *
 * Authority: P6-04B Semantic Contract
 */

import type {
  RegimeProvenance,
  RegimeVersionTuple,
  RegimeQualityMetadata,
  RegimeFreshnessMetadata,
  RegimeSnapshotInput,
  RegimeState,
} from "./types";

/**
 * Assemble regime provenance from input snapshots and computed state.
 */
export function assembleRegimeProvenance(
  snapshots: ReadonlyArray<RegimeSnapshotInput>,
  regimeVersion: RegimeVersionTuple,
  calculationTime: Date,
  transitionFrom: RegimeState | null,
  transitionTo: RegimeState | null,
  transitionConfidence: number,
  qualitySummary: RegimeQualityMetadata,
  freshnessSummary: RegimeFreshnessMetadata
): RegimeProvenance {
  const sorted = [...snapshots].sort(
    (a, b) => a.calculation_time.getTime() - b.calculation_time.getTime()
  );

  return {
    calculation_time: calculationTime,
    regime_version: regimeVersion,
    input_snapshot_ids: snapshots.map((s) => ({
      snapshot_id: s.snapshot_id,
      entity_type: s.entity_type,
      entity_id: s.entity_id,
      health_score: s.health_score,
      calculation_time: s.calculation_time,
    })),
    lookback_window: snapshots.length,
    input_window_start: sorted.length > 0 ? sorted[0].calculation_time : null,
    input_window_end: sorted.length > 0 ? sorted[sorted.length - 1].calculation_time : null,
    transition_from: transitionFrom,
    transition_to: transitionTo,
    transition_confidence: transitionConfidence,
    quality_summary: qualitySummary,
    freshness_summary: freshnessSummary,
  };
}

/**
 * Assemble quality metadata from input snapshots.
 */
export function assembleQualityMetadata(
  snapshots: ReadonlyArray<RegimeSnapshotInput>
): RegimeQualityMetadata {
  const total = snapshots.length;
  const valid = snapshots.filter((s) => s.quality_status === "VALID" || !s.quality_status).length;
  const invalid = snapshots.filter((s) => s.quality_status === "INVALID").length;
  const missing = snapshots.filter((s) => s.quality_status === "MISSING").length;
  const unknownQuality = snapshots.filter((s) => s.quality_status === "UNKNOWN").length;

  return {
    input_snapshots_total: total,
    input_snapshots_valid: valid,
    input_snapshots_invalid: invalid,
    input_snapshots_missing: missing,
    input_snapshots_unknown_quality: unknownQuality,
    data_sufficiency: total > 0 ? Math.round((valid / total) * 100) : 0,
  };
}

/**
 * Assemble freshness metadata from input snapshots.
 */
export function assembleFreshnessMetadata(
  snapshots: ReadonlyArray<RegimeSnapshotInput>
): RegimeFreshnessMetadata {
  const total = snapshots.length;
  const fresh = snapshots.filter((s) => s.freshness_status === "FRESH").length;
  const stale = snapshots.filter((s) => s.freshness_status === "STALE").length;
  const unknownFreshness = total - fresh - stale;

  return {
    input_snapshots_fresh: fresh,
    input_snapshots_stale: stale,
    input_snapshots_unknown_freshness: unknownFreshness,
    freshness_coverage: total > 0 ? Math.round((fresh / total) * 100) : 0,
  };
}
