/**
 * P6-06D — Change Detection (PD-06A-03 — ACCEPTED)
 *
 * Two-point comparison only: current vs immediate previous.
 * - PD-06C-03: health_change_pct = delta/prev*100; prev=0/null → null
 * - PD-06C-04: regime change = literal comparison incl. null↔value
 * - PD-06C-05: new/resolved warning identification
 *
 * IA-15: never historical multi-window analytics.
 */

import type {
  AggregationSnapshotInput,
  ChangeDetectionResult,
  PreviousContextInput,
  WarningSummaryItem,
} from "./types";

/** Round to 2 decimals (consistent with P6-03 rounding convention). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * health_delta = current − previous, rounded to 2 decimals.
 * Null when either value is missing — never invented (IA-16).
 */
export function computeHealthDelta(
  current: number | null,
  previous: number | null
): number | null {
  if (current === null || previous === null) return null;
  return round2(current - previous);
}

/**
 * PD-06C-03: pct = delta / previous × 100, rounded to 2 decimals.
 * previous = 0 or null → null (no invented percentage).
 */
export function computeHealthChangePct(
  current: number | null,
  previous: number | null
): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return round2(((current - previous) / previous) * 100);
}

/**
 * PD-06C-04: regime change is a LITERAL comparison between previous and
 * current regime state strings. null ↔ value transitions count as changed.
 */
export function computeRegimeChange(
  previous: string | null,
  current: string | null
): boolean {
  return previous !== current;
}

/**
 * PD-06C-05: new warnings = ACTIVE warnings whose detection_window equals
 * the current summary window_end (deterministic time equality).
 */
export function selectNewWarnings(
  activeWarnings: ReadonlyArray<WarningSummaryItem>,
  windowEnd: Date
): WarningSummaryItem[] {
  const t = windowEnd.getTime();
  return activeWarnings.filter((w) => w.detection_window.getTime() === t);
}

/**
 * PD-06C-05: resolved warnings = RESOLVED warnings whose effective_until is
 * after the previous evaluation's calculated_at. If no previous evaluation
 * exists, all recently-resolved warnings in the fetched set count.
 */
export function selectResolvedWarnings(
  resolvedWarnings: ReadonlyArray<WarningSummaryItem>,
  previousCalculatedAt: Date | null
): WarningSummaryItem[] {
  if (previousCalculatedAt === null) return [...resolvedWarnings];
  const bound = previousCalculatedAt.getTime();
  return resolvedWarnings.filter(
    (w) => w.effective_until !== null && w.effective_until.getTime() > bound
  );
}

/** Full two-point change detection. */
export function detectChanges(
  currentSnapshot: AggregationSnapshotInput | null,
  previous: PreviousContextInput,
  activeWarnings: ReadonlyArray<WarningSummaryItem>,
  resolvedWarnings: ReadonlyArray<WarningSummaryItem>,
  currentRegimeState: string | null,
  windowEnd: Date
): ChangeDetectionResult {
  const prevSnapshot = previous.previous_snapshot;

  const health_delta = computeHealthDelta(
    currentSnapshot?.health_score ?? null,
    prevSnapshot?.health_score ?? null
  );
  const health_change_pct = computeHealthChangePct(
    currentSnapshot?.health_score ?? null,
    prevSnapshot?.health_score ?? null
  );
  const regime_changed = computeRegimeChange(
    previous.previous_regime_state,
    currentRegimeState
  );

  const newWarnings = selectNewWarnings(activeWarnings, windowEnd);
  const resolved = selectResolvedWarnings(
    resolvedWarnings,
    previous.previous_calculated_at
  );

  return {
    health_delta,
    health_change_pct,
    regime_changed,
    new_warning_count: newWarnings.length,
    resolved_warning_count: resolved.length,
  };
}
