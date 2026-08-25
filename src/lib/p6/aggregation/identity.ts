/**
 * P6-06D — Summary Identity & Window End
 *
 * PD-06B-05: SummaryIdentity = (entity_type, entity_id, timeframe, window_end)
 * PD-06C-01 (ACCEPTED): window_end precedence —
 *   1. snapshot.window_end
 *   2. regime.calculation_time
 *   3. max(warning.detection_window)
 * IA-23: Deterministic window end — never wall-clock.
 */

import type {
  AggregationRegimeInput,
  AggregationSnapshotInput,
  EntityType,
  Timeframe,
  WarningSummaryItem,
  WindowEndSource,
} from "./types";

export interface WindowEndResult {
  readonly window_end: Date;
  readonly source: WindowEndSource;
}

/**
 * Resolve summary window_end using the accepted PD-06C-01 precedence chain.
 * Returns null only when the authoritative population is empty (no usable source) —
 * a fabricated timestamp is never returned.
 */
export function resolveWindowEnd(
  snapshot: AggregationSnapshotInput | null,
  regime: AggregationRegimeInput | null,
  warnings: ReadonlyArray<WarningSummaryItem>
): WindowEndResult | null {
  // 1. snapshot.window_end
  if (snapshot !== null) {
    return { window_end: snapshot.window_end, source: "snapshot" };
  }

  // 2. regime.calculation_time
  if (regime !== null) {
    return { window_end: regime.calculation_time, source: "regime" };
  }

  // 3. max(warning.detection_window)
  if (warnings.length > 0) {
    const max = warnings.reduce((acc, w) =>
      w.detection_window.getTime() > acc.getTime() ? w.detection_window : acc
    , warnings[0].detection_window);
    return { window_end: max, source: "warning" };
  }

  // Empty population — no fabrication.
  return null;
}

/** Deterministic identity string for logging/dedup diagnostics. */
export function buildSummaryKey(
  entity_type: EntityType,
  entity_id: number,
  timeframe: Timeframe,
  window_end: Date
): string {
  return `${entity_type}:${entity_id}:${timeframe}:${window_end.toISOString()}`;
}
