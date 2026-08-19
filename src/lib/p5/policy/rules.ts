/**
 * P5-03-RT — Frozen V1 Policy Rules.
 *
 * Owner-approved 2026-08-17; policyId `pol-p5-v1`, policyVersion `v1`.
 * Source: `docs/P5_Upgrade/P5-03_POLICY_RULESET_V1_CANDIDATE.md` §4, §21.
 *
 * Every constant below is either:
 *  - A CONTRACT rule (R-…): direct restatement of a FROZEN P5-03 clause.
 *  - A FROZEN-APPROVED rule (C-…): explicitly approved by the owner (§21.2).
 *
 * ABSOLUTE RULE:
 *  - No invented thresholds, scores, numeric values.
 *  - No BUY/SELL/LONG/SHORT/ORDER/TRADE.
 *  - No hidden scoring engine.
 *  - No legacy P1 rule reuse.
 *  - No temporal semantics in V1.
 */

import type { P5ActionType } from "../types";

// ---------------------------------------------------------------------------
// Audit entry — per-rule evaluation trace (observability, not a contract type)
// ---------------------------------------------------------------------------

export interface P5EvaluationAuditEntry {
  ruleId: string;
  layer: "pre-check" | "applicability" | "eligibility" | "blocking" | "suppression" | "routing" | "selection";
  action: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Policy identity (FROZEN — ODR-1)
// ---------------------------------------------------------------------------

export const P5_V1_POLICY_ID = "pol-p5-v1" as const;
export const P5_V1_POLICY_VERSION = "v1" as const;

// ---------------------------------------------------------------------------
// Approved V1 action-type scope (FROZEN — ODR-2)
// ---------------------------------------------------------------------------

export const P5_V1_ACTION_TYPES: readonly P5ActionType[] = [
  "MONITOR",
  "REVIEW",
  "INVESTIGATE",
  "REDUCE_EXPOSURE",
  "INCREASE_EXPOSURE",
  "REBALANCE",
] as const;

/** Action types requiring snapshot usability (consequential types). */
export const P5_V1_SNAPSHOT_REQUIRED_TYPES: readonly P5ActionType[] = [
  "REDUCE_EXPOSURE",
  "INCREASE_EXPOSURE",
  "REBALANCE",
] as const;

// ---------------------------------------------------------------------------
// Rule IDs (for provenance and deterministic tie-break, PD-004 step 6)
// ---------------------------------------------------------------------------

export const P5_V1_RULE_IDS = {
  // CONTRACT rules — frozen P5-03 clauses
  R001: "R-001",
  R002: "R-002",
  R003: "R-003",
  R004: "R-004",
  R005: "R-005",
  R006: "R-006",
  R007: "R-007",
  R008: "R-008",
  // V1 business rules — FROZEN-APPROVED
  C101: "C-101",
  C102: "C-102",
  C201: "C-201",
  C202: "C-202",
  C203: "C-203",
  C204: "C-204",
  C205: "C-205",
  C206: "C-206",
  C210: "C-210",
  C301: "C-301",
  C302: "C-302",
  C501: "C-501",
  C601: "C-601",
  C602: "C-602",
} as const;

// ---------------------------------------------------------------------------
// Reason codes (FROZEN — ODR-12)
// ---------------------------------------------------------------------------

export const P5_V1_REASON_CODES = {
  /** R-001: policy evaluation technical failure. */
  POLICY_EVALUATION_FAILURE: "POLICY_EVALUATION_FAILURE",
  /** R-002: input layer unavailable / P4 context absent. */
  POLICY_INPUT_UNAVAILABLE: "POLICY_INPUT_UNAVAILABLE",
  /** R-003: evaluation completed, nothing eligible. */
  NO_ELIGIBLE_ACTION: "NO_ELIGIBLE_ACTION",
  /** R-004: candidate suppressed (deferred in V1). */
  SUPPRESSED: "SUPPRESSED",
  /** R-008: blocking rule fired (deferred in V1 — no trigger). */
  POLICY_BLOCKED: "POLICY_BLOCKED",
  /** C-102/C-210/C-301/C-302/C-601/C-602: not eligible / input unavailable / not determined. */
  NOT_ELIGIBLE: "NOT_ELIGIBLE",
  /** C-501: candidate selected. */
  SELECTED: "SELECTED",
} as const;

// ---------------------------------------------------------------------------
// Evaluation rule ordering — frozen PD-004 six-step precedence
// (layer → priority → ruleId)
//
// The evaluator processes rules in this exact order. This is deterministic
// and stable. The `ruleId` tie-break at step 6 is purely technical (PD-004).
// ---------------------------------------------------------------------------

/** Rule execution order by (layer, priority, ruleId). */
export const P5_V1_RULE_ORDER: readonly string[] = [
  // Layer 1 — Applicability (priority 1)
  P5_V1_RULE_IDS.C101,
  P5_V1_RULE_IDS.C102,
  // Layer 2 — Eligibility (priority 2)
  P5_V1_RULE_IDS.C201,
  P5_V1_RULE_IDS.C202,
  P5_V1_RULE_IDS.C203,
  P5_V1_RULE_IDS.C204,
  P5_V1_RULE_IDS.C205,
  P5_V1_RULE_IDS.C206,
  P5_V1_RULE_IDS.C210,
  // Layer 3 — Blocking (priority 3)
  P5_V1_RULE_IDS.C301,
  P5_V1_RULE_IDS.C302,
  // Layer 5 — Selection (priority 5)
  P5_V1_RULE_IDS.C501,
  // Cross-layer — UNKNOWN/DEGRADED routing (priority 3)
  P5_V1_RULE_IDS.C601,
  P5_V1_RULE_IDS.C602,
] as const;
