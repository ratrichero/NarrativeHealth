// P6 Data Quality V1 — Classification Logic
// Authority: P6-01D-B (Contract), P6-01D-C2 (Frozen Decisions)
//
// Maps evidence lists to quality states.
// Pure function: same evidence → same classification.

import type {
  Metric,
  QualityState,
  QualityEvidence,
  MetricRule,
} from "./types";
import { METRIC_RULES } from "./types";

// ─── SINGLE-METRIC CLASSIFICATION ─────────────────────────────────────

/**
 * Classify a single metric given its evidence list.
 *
 * Frozen mapping (PD-01-RES, PD-02-RES):
 * - No evidence (value absent) → MISSING
 * - NUMERIC_PARSE FAIL present → INVALID (PD-02-RES)
 * - Any FAIL present → INVALID
 * - All evidence PASS/NOT_APPLICABLE, none FAIL → VALID
 *
 * NOT_EVALUABLE in evidence does NOT automatically produce UNKNOWN —
 * it is informational context. UNKNOWN is only produced by the caller
 * for specific situations (e.g., OHLC group key unresolvable).
 */
export function classifyFromEvidence(
  evidence: QualityEvidence[],
  valuePresent: boolean
): QualityState {
  // Absent value → MISSING (DQ-08: absence cannot be INVALID)
  if (!valuePresent) {
    return "MISSING";
  }

  // Value present — check evidence outcomes
  if (evidence.length === 0) {
    // Value present but no checks ran — should not happen in normal flow,
    // but defensively treat as VALID (no evidence of failure)
    return "VALID";
  }

  const hasFailure = evidence.some((e) => e.outcome === "FAIL");
  if (hasFailure) {
    return "INVALID";
  }

  return "VALID";
}

// ─── OHLC GROUP CLASSIFICATION (PD-03-RES) ────────────────────────────

/**
 * After field-level classification, apply OHLC group relational rules.
 *
 * PD-03-RES: scope = OHLC SET. If any relational check FAILs,
 * ALL FOUR members' observation_status is set to INVALID.
 *
 * If observed_at is null (UNKNOWN), relational checks are NOT_EVALUABLE
 * and do not affect member statuses.
 */
export function applyOHLCGroupScope(
  members: Record<Metric, { quality_status: QualityState; evidence: QualityEvidence[] }>,
  groupEvidence: QualityEvidence[]
): void {
  const hasRelationalFailure = groupEvidence.some(
    (e) => e.outcome === "FAIL"
  );

  if (!hasRelationalFailure) {
    return;
  }

  // PD-03-RES: ALL FOUR members get INVALID observation_status
  for (const metric of ["OPEN", "HIGH", "LOW", "CLOSE"] as Metric[]) {
    if (members[metric].quality_status !== "MISSING") {
      members[metric].quality_status = "INVALID";
    }
  }
}

// ─── PER-METRIC RULE ACCESS ───────────────────────────────────────────

/**
 * Get the frozen V1 rule for a metric.
 */
export function getMetricRule(metric: Metric): MetricRule {
  return METRIC_RULES[metric];
}
