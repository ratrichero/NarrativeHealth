/**
 * P6-06D — Intelligence Aggregation Engine
 *
 * Orchestration:
 *   1. Minimum population check (PD-06A-04)
 *   2. Deterministic window_end resolution (PD-06C-01)
 *   3. Two-point change detection (PD-06A-03, PD-06C-03/04/05)
 *   4. Structured explanation generation (PD-06A-02)
 *   5. Provenance + standalone version tuple
 *
 * IA-01: consumes only frozen P6-03/04/05 outputs.
 * IA-14: health/confidence pass through unchanged.
 * IA-19: regime displayed as-is.
 * IA-16: nulls propagate; no fabricated values.
 */

import { SEVERITY_RANK } from "../warning/types";
import type { Severity } from "../warning/types";
import {
  DEFAULT_SUMMARY_CONFIG,
  type AggregationRegimeInput,
  type AggregationSnapshotInput,
  type ChangeDetectionResult,
  type EntityType,
  type IntelligenceSummary,
  type PreviousContextInput,
  type SummaryConfig,
  type SummaryEngineInput,
  type Timeframe,
  type WarningSummaryItem,
} from "./types";
import { resolveWindowEnd } from "./identity";
import { detectChanges } from "./change";
import { generateExplanation } from "./explanation";
import { assembleSummaryProvenance } from "./provenance";

/**
 * PD-06A-04: at least ONE authoritative input is required —
 * current snapshot, current regime, or ≥1 active/recently-resolved warning.
 * Population size is distinct from QualityState (IA-11): INVALID inputs count.
 */
export function hasMinimumPopulation(
  snapshot: AggregationSnapshotInput | null,
  regime: AggregationRegimeInput | null,
  activeWarnings: ReadonlyArray<WarningSummaryItem>,
  resolvedWarnings: ReadonlyArray<WarningSummaryItem>
): boolean {
  return (
    snapshot !== null || regime !== null || activeWarnings.length > 0 || resolvedWarnings.length > 0
  );
}

/** Highest severity among active warnings; null when none. */
export function computeHighestSeverity(
  warnings: ReadonlyArray<WarningSummaryItem>
): Severity | null {
  let highest: Severity | null = null;
  for (const w of warnings) {
    if (highest === null || SEVERITY_RANK[w.severity] > SEVERITY_RANK[highest]) {
      highest = w.severity;
    }
  }
  return highest;
}

/**
 * Aggregate authoritative P6 inputs into a deterministic intelligence summary.
 * Returns null when the population is empty (no summary persisted, nothing fabricated).
 */
export function aggregateIntelligence(input: SummaryEngineInput): IntelligenceSummary | null {
  const config: SummaryConfig = input.config ?? DEFAULT_SUMMARY_CONFIG;

  // ── PD-06A-04: minimum population ──
  if (!hasMinimumPopulation(
    input.current_snapshot,
    input.current_regime,
    input.active_warnings,
    input.recently_resolved_warnings
  )) {
    return null;
  }

  // ── PD-06C-01: deterministic window_end ──
  const resolved = resolveWindowEnd(
    input.current_snapshot,
    input.current_regime,
    mergeWarningPopulations(input)
  );
  if (resolved === null) return null; // unreachable given population check, kept as guard

  const windowEnd = resolved.window_end;

  // ── PD-06A-03 / PD-06C-03/04/05: change detection ──
  const currentRegimeState = input.current_regime?.regime_state ?? null;
  const changes: ChangeDetectionResult = detectChanges(
    input.current_snapshot,
    input.previous,
    input.active_warnings,
    input.recently_resolved_warnings,
    currentRegimeState,
    windowEnd
  );

  // ── PD-06A-02: structured explanations ──
  const explanation = generateExplanation(
    input.current_snapshot,
    input.current_regime,
    input.previous,
    changes,
    input.active_warnings,
    input.recently_resolved_warnings,
    windowEnd,
    config.explanationCap
  );

  // Deterministic warning ordering: severity desc → recency desc → id asc
  const orderedActive = [...input.active_warnings].sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity];
    const sb = SEVERITY_RANK[b.severity];
    if (sa !== sb) return sb - sa;
    if (a.detected_at.getTime() !== b.detected_at.getTime()) {
      return b.detected_at.getTime() - a.detected_at.getTime();
    }
    return a.warning_id - b.warning_id;
  });

  const provenance = assembleSummaryProvenance({
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    currentSnapshot: input.current_snapshot,
    currentRegime: input.current_regime,
    previous: input.previous,
    activeWarnings: input.active_warnings,
    calculation_time: input.calculation_time,
    window_end: windowEnd,
    window_end_source: resolved.source,
    version: input.version,
  });

  return {
    entity_type: input.entity_type as EntityType,
    entity_id: input.entity_id,
    timeframe: input.timeframe as Timeframe,

    health_score: input.current_snapshot?.health_score ?? null,
    snapshot_confidence: input.current_snapshot?.confidence_score ?? null,
    regime_state: currentRegimeState,
    regime_confidence: input.current_regime?.confidence ?? null,

    active_warning_count: input.active_warnings.length,
    highest_severity: computeHighestSeverity(input.active_warnings),
    active_warnings: orderedActive,

    health_delta: changes.health_delta,
    health_change_pct: changes.health_change_pct,
    regime_changed: changes.regime_changed,
    previous_regime_state: input.previous.previous_regime_state,
    new_warning_count: changes.new_warning_count,
    resolved_warning_count: changes.resolved_warning_count,

    what_changed: explanation.what_changed,
    why: explanation.why,
    what_to_watch: explanation.what_to_watch,

    quality_metadata: input.current_snapshot?.quality_metadata ?? null,
    freshness_metadata: input.current_snapshot?.freshness_metadata ?? null,

    provenance,
    version: input.version,

    calculated_at: input.calculation_time,
    window_end: windowEnd,
  };
}

function mergeWarningPopulations(
  input: SummaryEngineInput
): ReadonlyArray<WarningSummaryItem> {
  // Only ACTIVE warnings participate in the max(detection_window) fallback —
  // resolved warnings are historical context for change detection only.
  return input.active_warnings;
}
