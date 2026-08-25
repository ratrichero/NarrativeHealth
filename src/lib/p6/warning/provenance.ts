/**
 * P6-05D — Warning Provenance Assembly
 *
 * EW-12: Provenance is complete.
 * EW-13: Provenance is immutable once persisted.
 * EW-28: Provenance references valid snapshot/regime IDs.
 *
 * Authority: P6-05C1 Decision Contract
 */

import type {
  WarningProvenance,
  WarningVersionTuple,
  WarningSnapshotInput,
  WarningRegimeInput,
  EntityType,
} from "./types";

// ─── ASSEMBLE PROVENANCE ──────────────────────────────────────────

/**
 * Assemble warning provenance from input data.
 * Full chain: warning → snapshot → regime/feature → observation.
 */
export function assembleWarningProvenance(params: {
  entityType: EntityType;
  entityId: number;
  sourceRecordId: number | null;
  currentSnapshot: WarningSnapshotInput;
  previousSnapshot: WarningSnapshotInput | null;
  currentRegime: WarningRegimeInput | null;
  healthDelta: number | null;
  warningVersion: WarningVersionTuple;
  detectionTime: Date;
  detectionWindow: Date;
  qualitySummary: Record<string, unknown> | null;
  freshnessSummary: Record<string, unknown> | null;
}): WarningProvenance {
  return {
    source_layer: "P6-05",
    source_entity: {
      entity_type: params.entityType,
      entity_id: params.entityId,
    },
    source_record_id: params.sourceRecordId,
    snapshot_identity: {
      entity_type: params.currentSnapshot.entity_type,
      entity_id: params.currentSnapshot.entity_id,
      snapshot_type:
        params.entityType === "coin" ? "COIN_HEALTH" : "NARRATIVE_HEALTH",
      window_end: params.currentSnapshot.window_end,
    },
    regime_state: params.currentRegime?.regime_state ?? null,
    previous_regime_state: params.currentRegime?.previous_state ?? null,
    regime_confidence: params.currentRegime?.confidence ?? null,
    health_score: params.currentSnapshot.health_score,
    previous_health_score: params.previousSnapshot?.health_score ?? null,
    health_delta: params.healthDelta,
    warning_version: params.warningVersion,
    detection_time: params.detectionTime,
    detection_window: params.detectionWindow,
    quality_summary: params.qualitySummary,
    freshness_summary: params.freshnessSummary,
  };
}

// ─── QUALITY SUMMARY ──────────────────────────────────────────────

/**
 * Assemble quality metadata summary from current snapshot.
 */
export function assembleQualitySummary(
  current: WarningSnapshotInput,
  previous: WarningSnapshotInput | null
): Record<string, unknown> {
  return {
    current_quality_status: current.quality_status ?? "VALID",
    previous_quality_status: previous?.quality_status ?? "VALID",
    quality_changed:
      (current.quality_status ?? "VALID") !== (previous?.quality_status ?? "VALID"),
  };
}

/**
 * Assemble freshness metadata summary from current snapshot.
 */
export function assembleFreshnessSummary(
  current: WarningSnapshotInput,
  previous: WarningSnapshotInput | null
): Record<string, unknown> {
  return {
    current_freshness_status: current.freshness_status ?? "UNKNOWN",
    previous_freshness_status: previous?.freshness_status ?? "UNKNOWN",
    freshness_changed:
      (current.freshness_status ?? "UNKNOWN") !==
      (previous?.freshness_status ?? "UNKNOWN"),
  };
}
