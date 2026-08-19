/**
 * P5-04-RT — Safety / Approval / Permission Runtime v1 types.
 *
 * Frozen contract source:
 *  - P5-04 §9–§11 Guardrail Model
 *  - P5-04 §13–§14 Approval Model
 *  - P5-04 §19 Execution Permission
 *  - P5-04 §38 Matrices
 *  - Owner-approved SG-010: V1 = ADVISORY-ONLY
 *
 * Hard boundary:
 *  - This module defines types ONLY; the evaluator is in `evaluator.ts`.
 *  - No DB access, no replay, no policy/execution logic.
 *  - No new outcomes added to P5-02 AD-004 vocabulary.
 */

import type {
  P5ActionType,
  P5BlockerReport,
  P5GuardrailOutcome,
  P5GuardrailResult,
  P5PermissionResult,
  P5SafetyAggregate,
} from "../types";
import type { P5PolicyEvaluationResult } from "../policy/types";

// ---------------------------------------------------------------------------
// V1 Constants (FROZEN — SG-010)
// ---------------------------------------------------------------------------

/** V1 automation mode — ADVISORY-ONLY. */
export const P5_V1_AUTOMATION_MODE = "ADVISORY" as const;

/** V1 guardrail model version — empty set, no concrete guardrails. */
export const P5_V1_GUARDRAIL_MODEL_VERSION = "v1" as const;

/** V1 approval model version — no approval rules. */
export const P5_V1_APPROVAL_MODEL_VERSION = "v1" as const;

// ---------------------------------------------------------------------------
// Action class (P5-02 AD-005)
// ---------------------------------------------------------------------------

/** Advisory action types — no execution permission required. */
export const P5_V1_ADVISORY_TYPES: readonly P5ActionType[] = [
  "MONITOR",
  "REVIEW",
  "INVESTIGATE",
] as const;

/** Consequential action types — full safety/approval/permission pipeline. */
export const P5_V1_CONSEQUENTIAL_TYPES: readonly P5ActionType[] = [
  "REDUCE_EXPOSURE",
  "INCREASE_EXPOSURE",
  "REBALANCE",
] as const;

// ---------------------------------------------------------------------------
// Approval record (P5-04 §13)
// ---------------------------------------------------------------------------

/** P5-04 §13 approval record — an explicit authorization event. */
export interface P5SafetyApprovalRecord {
  approvalId: string;
  decisionIdRef: string;
  state: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "REVOKED";
  authorityRef: string | null;
  actor: string | null;
  timestamp: string | null;
  scope: string | null;
  approvalPolicyVersion: string | null;
  invalidation: { reason: string | null; occurredAt: string | null } | null;
}

// ---------------------------------------------------------------------------
// Safety evaluation audit entry
// ---------------------------------------------------------------------------

/** Per-guardrail evaluation trace (observability, not a contract type). */
export interface P5SafetyAuditEntry {
  ruleId: string;
  layer: "applicability" | "safety" | "approval" | "permission";
  action: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Safety provenance (P5-04 §27)
// ---------------------------------------------------------------------------

/** Safety evaluation provenance record. */
export interface P5SafetyProvenance {
  /** Policy evaluation result provenance (preserved from P5-03). */
  policyProvenance: P5PolicyEvaluationResult["provenance"];
  /** Guardrail model version. */
  guardrailModelVersion: string;
  /** Guardrail versions evaluated (empty in V1). */
  guardrailVersions: string[];
  /** Approval model version. */
  approvalModelVersion: string;
  /** Automation mode. */
  automationMode: "ADVISORY";
  /** Evaluation timestamp (metadata only). */
  evaluatedAt: string;
}

// ---------------------------------------------------------------------------
// Safety evaluation result (P5-04 §11)
// ---------------------------------------------------------------------------

/**
 * P5-04 §11 — Safety evaluation result.
 * Produced by P5SafetyEvaluator; consumed by P5-05 and P5-10.
 *
 * V1 behavior:
 *  - safetyOutcome = PASS (empty guardrails)
 *  - guardrailResults = []
 *  - approvalState = NOT_REQUIRED
 *  - permissionState = NOT_APPLICABLE (advisory) or NOT_GRANTED (consequential)
 */
export interface P5SafetyEvaluationResult {
  /** Safety aggregate outcome (SG-003). */
  safetyOutcome: P5SafetyAggregate;

  /** Per-guardrail results (empty in V1). */
  guardrailResults: P5GuardrailResult[];

  /** Approval state (SG-006). */
  approvalState: P5SafetyApprovalRecord["state"];

  /** Approval record (null when NOT_REQUIRED). */
  approvalRecord: P5SafetyApprovalRecord | null;

  /** Execution permission result (SG-011). */
  permissionState: P5PermissionResult;

  /** Safety blocker report (null when no BLOCK). */
  blockerReport: P5BlockerReport | null;

  /** Safety provenance record. */
  provenance: P5SafetyProvenance;

  /** Safety evaluation trace (observability). */
  audit: P5SafetyAuditEntry[];

  /** Action type classification. */
  actionClass: "ADVISORY" | "CONSEQUENTIAL";

  /** Upstream policy outcome (preserved, never mutated). */
  policyOutcome: P5PolicyEvaluationResult["outcome"];
}

// ---------------------------------------------------------------------------
// Safety evaluation input
// ---------------------------------------------------------------------------

/**
 * Input to the P5SafetyEvaluator.
 * Wraps the P5-03-RT output plus any additional metadata needed by P5-04.
 */
export interface P5SafetyEvaluationInput {
  /** P5-03-RT policy evaluation result. */
  policyResult: P5PolicyEvaluationResult;
}
