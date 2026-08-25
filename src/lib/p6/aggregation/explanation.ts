/**
 * P6-06D — Structured Explanation Generation (PD-06A-02 — ACCEPTED)
 *
 * All explanations are deterministic template fills from authoritative
 * evidence values. No LLM, no free-form prose, no inferred facts.
 *
 * Rules implemented:
 * - PD-06B-02: ranking = severity desc → recency desc → id asc
 * - PD-06B-03: why = template fills (regime transition + triggers + deltas)
 * - PD-06B-04: watch selection = HIGH/CRITICAL warnings → TRANSITIONING regime → material deltas
 * - PD-06B-08: cap 10 items per array
 * - IA-17: template purity; IA-25: arrays always present (possibly empty)
 */

import type { Severity } from "../warning/types";
import { SEVERITY_RANK } from "../warning/types";
import type {
  AggregationRegimeInput,
  AggregationSnapshotInput,
  ChangeDetectionResult,
  Explanation,
  ExplanationCategory,
  ExplanationItem,
  PreviousContextInput,
  WarningSummaryItem,
} from "./types";

/** Internal item carrying sort metadata before capping/mapping. */
interface RankedExplanationItem extends ExplanationItem {
  readonly _recency: number; // epoch ms — recency desc
  readonly _ref_id: number; // lower artifact id wins ties
}

// ─── RANKING (PD-06B-02) ──────────────────────────────────────────

export function rankExplanationItems(
  items: ReadonlyArray<RankedExplanationItem>
): RankedExplanationItem[] {
  return [...items].sort((a, b) => {
    const sa = a.severity ? SEVERITY_RANK[a.severity] : -1;
    const sb = b.severity ? SEVERITY_RANK[b.severity] : -1;
    if (sa !== sb) return sb - sa; // severity DESC
    if (a._recency !== b._recency) return b._recency - a._recency; // recency DESC
    return a._ref_id - b._ref_id; // id ASC
  });
}

function capAndStrip(
  items: ReadonlyArray<RankedExplanationItem>,
  cap: number
): ExplanationItem[] {
  return rankExplanationItems(items)
    .slice(0, cap)
    .map(({ category, text, evidence_ref, severity }) => ({
      category,
      text,
      evidence_ref,
      severity,
    }));
}

// ─── MATERIALITY HELPERS ──────────────────────────────────────────

const HEALTH_MATERIAL_DELTA = 10; // mirrors frozen PD-05B-04 health threshold

function isMaterialHealthDelta(delta: number | null): boolean {
  return delta !== null && Math.abs(delta) >= HEALTH_MATERIAL_DELTA;
}

function isHighOrCritical(severity: Severity | null): boolean {
  return severity === "HIGH" || severity === "CRITICAL";
}

// ─── WHAT CHANGED ─────────────────────────────────────────────────

export function generateWhatChanged(
  currentSnapshot: AggregationSnapshotInput | null,
  currentRegime: AggregationRegimeInput | null,
  previous: PreviousContextInput,
  changes: ChangeDetectionResult,
  activeWarnings: ReadonlyArray<WarningSummaryItem>,
  resolvedWarnings: ReadonlyArray<WarningSummaryItem>,
  windowEnd: Date
): RankedExplanationItem[] {
  const items: RankedExplanationItem[] = [];
  const prevSnapshot = previous.previous_snapshot;
  const t = windowEnd.getTime();

  // Health change
  if (
    currentSnapshot?.health_score != null &&
    prevSnapshot?.health_score == null &&
    changes.health_delta === null
  ) {
    items.push({
      category: "HEALTH",
      text: `First comparable health evaluation for this window: health score ${currentSnapshot.health_score}.`,
      evidence_ref: `p6-snapshot:${currentSnapshot.snapshot_id}`,
      severity: null,
      _recency: currentSnapshot.window_end.getTime(),
      _ref_id: currentSnapshot.snapshot_id,
    });
  } else if (changes.health_delta !== null) {
    const direction =
      changes.health_delta > 0 ? "improved" : changes.health_delta < 0 ? "declined" : "unchanged";
    items.push({
      category: "HEALTH",
      text: `Health score ${direction} by ${Math.abs(changes.health_delta)} points to ${currentSnapshot?.health_score ?? "n/a"}.`,
      evidence_ref: `p6-snapshot:${currentSnapshot?.snapshot_id ?? "unknown"} vs p6-snapshot:${prevSnapshot?.snapshot_id ?? "unknown"}`,
      severity:
        Math.abs(changes.health_delta) >= 20
          ? "HIGH"
          : Math.abs(changes.health_delta) >= HEALTH_MATERIAL_DELTA
            ? "MEDIUM"
            : "LOW",
      _recency: currentSnapshot?.window_end.getTime() ?? t,
      _ref_id: currentSnapshot?.snapshot_id ?? 0,
    });
  }

  // Confidence change
  if (
    currentSnapshot?.confidence_score != null &&
    prevSnapshot?.confidence_score != null
  ) {
    const confDelta = Math.round(
      (currentSnapshot.confidence_score - prevSnapshot.confidence_score) * 100
    ) / 100;
    if (Math.abs(confDelta) >= 20) {
      items.push({
        category: "HEALTH",
        text: `Snapshot confidence changed by ${confDelta} points to ${currentSnapshot.confidence_score}.`,
        evidence_ref: `p6-snapshot:${currentSnapshot.snapshot_id}`,
        severity: "LOW",
        _recency: currentSnapshot.window_end.getTime(),
        _ref_id: currentSnapshot.snapshot_id,
      });
    }
  }

  // Regime change (literal comparison incl. null↔value per PD-06C-04)
  if (changes.regime_changed) {
    const currentState = currentRegime?.regime_state ?? "unavailable";
    items.push({
      category: "REGIME",
      text: `Regime state changed from ${previous.previous_regime_state ?? "unavailable"} to ${currentState}.`,
      evidence_ref: currentRegime ? `p6-regime:${currentRegime.regime_id}` : "p6-regime-context",
      severity: previous.previous_regime_state === null ? "LOW" : "MEDIUM",
      _recency: currentRegime?.calculation_time.getTime() ?? t,
      _ref_id: currentRegime?.regime_id ?? 0,
    });
  }

  // New warnings
  for (const w of selectNew(activeWarnings, windowEnd)) {
    items.push({
      category: "WARNING",
      text: `New ${w.severity} warning: ${w.warning_type}.`,
      evidence_ref: `p6-warning:${w.warning_id}`,
      severity: w.severity,
      _recency: w.detected_at.getTime(),
      _ref_id: w.warning_id,
    });
  }

  // Resolved warnings
  for (const w of selectResolved(resolvedWarnings, previous)) {
    items.push({
      category: "WARNING",
      text: `Warning resolved: ${w.warning_type} (${w.severity}).`,
      evidence_ref: `p6-warning:${w.warning_id}`,
      severity: w.severity,
      _recency: w.effective_until?.getTime() ?? t,
      _ref_id: w.warning_id,
    });
  }

  void isMaterialHealthDelta;
  return items;

  function selectNew(
    list: ReadonlyArray<WarningSummaryItem>,
    we: Date
  ): WarningSummaryItem[] {
    const wt = we.getTime();
    return list.filter((w) => w.detection_window.getTime() === wt);
  }
  function selectResolved(
    list: ReadonlyArray<WarningSummaryItem>,
    ctx: PreviousContextInput
  ): WarningSummaryItem[] {
    if (ctx.previous_calculated_at === null) return [...list];
    const bound = ctx.previous_calculated_at.getTime();
    return list.filter(
      (w) => w.effective_until !== null && w.effective_until.getTime() > bound
    );
  }
}

// ─── WHY (PD-06B-03 — TEMPLATE FILLS ONLY) ────────────────────────

export function generateWhy(
  currentSnapshot: AggregationSnapshotInput | null,
  currentRegime: AggregationRegimeInput | null,
  previous: PreviousContextInput,
  changes: ChangeDetectionResult,
  activeWarnings: ReadonlyArray<WarningSummaryItem>
): RankedExplanationItem[] {
  const items: RankedExplanationItem[] = [];

  // Why from health delta trigger (mirrors P6-05 threshold semantics)
  if (isMaterialHealthDelta(changes.health_delta)) {
    items.push({
      category: "HEALTH",
      text: `A health movement of ${changes.health_delta} points met the 10-point material-change criterion.`,
      evidence_ref: `p6-snapshot:${currentSnapshot?.snapshot_id ?? "unknown"}`,
      severity: "LOW",
      _recency: currentSnapshot?.window_end.getTime() ?? 0,
      _ref_id: currentSnapshot?.snapshot_id ?? 0,
    });
  }

  // Why from regime transition
  if (changes.regime_changed && currentRegime !== null) {
    items.push({
      category: "REGIME",
      text: `Regime moved from ${previous.previous_regime_state ?? "unavailable"} to ${currentRegime.regime_state} per the frozen P6-04 state machine.`,
      evidence_ref: `p6-regime:${currentRegime.regime_id}`,
      severity: "LOW",
      _recency: currentRegime.calculation_time.getTime(),
      _ref_id: currentRegime.regime_id,
    });
  }

  // Why from active warning triggers (P6-05 already classified these)
  for (const w of activeWarnings) {
    items.push({
      category: "WARNING",
      text: `${w.warning_type} remains active (${w.severity}): ${w.message}`,
      evidence_ref: `p6-warning:${w.warning_id}`,
      severity: w.severity,
      _recency: w.detected_at.getTime(),
      _ref_id: w.warning_id,
    });
  }

  return items;
}

// ─── WHAT TO WATCH (PD-06B-04 PRIORITY ORDERING) ──────────────────

export function generateWhatToWatch(
  currentRegime: AggregationRegimeInput | null,
  changes: ChangeDetectionResult,
  activeWarnings: ReadonlyArray<WarningSummaryItem>,
  currentSnapshot: AggregationSnapshotInput | null,
  windowEnd: Date
): RankedExplanationItem[] {
  const items: RankedExplanationItem[] = [];

  // 1. HIGH/CRITICAL active warnings first
  for (const w of activeWarnings) {
    if (isHighOrCritical(w.severity)) {
      items.push({
        category: "WARNING",
        text: `Monitor active ${w.severity} warning ${w.warning_type}: ${w.message}`,
        evidence_ref: `p6-warning:${w.warning_id}`,
        severity: w.severity,
        _recency: w.detected_at.getTime(),
        _ref_id: w.warning_id,
      });
    }
  }

  // 2. TRANSITIONING regime
  if (currentRegime?.regime_state === "TRANSITIONING") {
    items.push({
      category: "REGIME",
      text: `Regime is TRANSITIONING; next qualifying snapshot may confirm a new stable regime.`,
      evidence_ref: `p6-regime:${currentRegime.regime_id}`,
      severity: "MEDIUM",
      _recency: currentRegime.calculation_time.getTime(),
      _ref_id: currentRegime.regime_id,
    });
  }

  // 3. Material deltas
  if (isMaterialHealthDelta(changes.health_delta)) {
    items.push({
      category: "HEALTH",
      text: `Watch continued health movement (current delta ${changes.health_delta}).`,
      evidence_ref: `p6-snapshot:${currentSnapshot?.snapshot_id ?? "unknown"}`,
      severity: "LOW",
      _recency: currentSnapshot?.window_end.getTime() ?? windowEnd.getTime(),
      _ref_id: currentSnapshot?.snapshot_id ?? 0,
    });
  }

  // Remaining non-high active warnings as lowest-priority watch context
  for (const w of activeWarnings) {
    if (!isHighOrCritical(w.severity)) {
      items.push({
        category: "WARNING",
        text: `Active ${w.severity} warning ${w.warning_type}: ${w.message}`,
        evidence_ref: `p6-warning:${w.warning_id}`,
        severity: w.severity,
        _recency: w.detected_at.getTime(),
        _ref_id: w.warning_id,
      });
    }
  }

  return items;
}

// ─── FULL EXPLANATION ASSEMBLY (IA-25: arrays always present) ─────

export function generateExplanation(
  currentSnapshot: AggregationSnapshotInput | null,
  currentRegime: AggregationRegimeInput | null,
  previous: PreviousContextInput,
  changes: ChangeDetectionResult,
  activeWarnings: ReadonlyArray<WarningSummaryItem>,
  resolvedWarnings: ReadonlyArray<WarningSummaryItem>,
  windowEnd: Date,
  explanationCap: number
): Explanation {
  return {
    what_changed: capAndStrip(
      generateWhatChanged(
        currentSnapshot,
        currentRegime,
        previous,
        changes,
        activeWarnings,
        resolvedWarnings,
        windowEnd
      ),
      explanationCap
    ),
    why: capAndStrip(
      generateWhy(currentSnapshot, currentRegime, previous, changes, activeWarnings),
      explanationCap
    ),
    what_to_watch: capAndStrip(
      generateWhatToWatch(
        currentRegime,
        changes,
        activeWarnings,
        currentSnapshot,
        windowEnd
      ),
      explanationCap
    ),
  };
}
