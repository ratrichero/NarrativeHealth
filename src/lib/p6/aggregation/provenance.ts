/**
 * P6-06D — Summary Provenance
 *
 * Full provenance chain per PD-06A-09:
 * aggregation → snapshot(s) → regime → warning occurrences.
 * IA-21: real IDs only; missing references recorded as null, never fabricated.
 */

import type {
  AggregationRegimeInput,
  AggregationSnapshotInput,
  PreviousContextInput,
  SummaryProvenance,
  SummaryVersionTuple,
  WarningSummaryItem,
  WindowEndSource,
} from "./types";

export function assembleSummaryProvenance(params: {
  entity_type: SummaryProvenance["entity"]["entity_type"];
  entity_id: number;
  currentSnapshot: AggregationSnapshotInput | null;
  currentRegime: AggregationRegimeInput | null;
  previous: PreviousContextInput;
  activeWarnings: ReadonlyArray<WarningSummaryItem>;
  calculation_time: Date;
  window_end: Date;
  window_end_source: WindowEndSource;
  version: SummaryVersionTuple;
}): SummaryProvenance {
  return {
    source_layer: "P6-06",
    entity: { entity_type: params.entity_type, entity_id: params.entity_id },
    input_snapshot_id: params.currentSnapshot?.snapshot_id ?? null,
    input_snapshot_window_end: params.currentSnapshot?.window_end ?? null,
    previous_snapshot_id: params.previous.previous_snapshot?.snapshot_id ?? null,
    input_regime_id: params.currentRegime?.regime_id ?? null,
    input_warning_ids: params.activeWarnings.map((w) => w.warning_id),
    calculation_time: params.calculation_time,
    window_end: params.window_end,
    window_end_source: params.window_end_source,
    summary_version: params.version,
    quality_summary: params.currentSnapshot?.quality_metadata ?? null,
    freshness_summary: params.currentSnapshot?.freshness_metadata ?? null,
  };
}
