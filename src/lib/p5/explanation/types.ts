/**
 * P5-05-RT — Explanation / Audit Runtime v1 types.
 *
 * Frozen contract source:
 *  - P5-05 §6 Explanation Model (slots)
 *  - P5-05 §10 Provenance Model
 *  - P5-05 §16 Audit Event Vocabulary
 *  - P5-05 §17 Audit Event Contract
 *  - P5-05 §22 Explanation Levels
 *
 * Hard boundary:
 *  - This module defines types ONLY; the evaluator is in `evaluator.ts`.
 *  - No DB access, no replay, no policy/safety/execution logic.
 *  - No new audit event types beyond the frozen P5-05 vocabulary.
 *  - No LLM dependency.
 */

import type {
  P5ApprovalState,
  P5AuditEvent,
  P5DecisionOutcome,
  P5DecisionState,
  P5ExecutionState,
  P5ExplanationRecord,
  P5GuardrailResult,
  P5P4SnapshotRef,
  P5PermissionResult,
  P5ProvenanceRecord,
  P5SafetyAggregate,
} from "../types";
import type { P5PolicyEvaluationResult } from "../policy/types";
import type { P5SafetyEvaluationResult } from "../safety/types";

// ---------------------------------------------------------------------------
// P5-05 §16.1 — Frozen audit event types (core vocabulary)
// ---------------------------------------------------------------------------

export type P5AuditEventType =
  | "DecisionProduced"
  | "DecisionSuppressed"
  | "DecisionSuperseded"
  | "DecisionExpired"
  | "DecisionCancelled"
  | "ApprovalRequired"
  | "ApprovalGranted"
  | "ApprovalDenied"
  | "ApprovalExpired"
  | "ApprovalRevoked"
  | "PermissionGranted"
  | "PermissionRevoked"
  | "PermissionExpired";

// ---------------------------------------------------------------------------
// P5-05 §16.1 — V1 applicable audit events
// ---------------------------------------------------------------------------

/** V1 audit events that may actually fire. */
export const P5_V1_APPLICABLE_EVENTS: readonly P5AuditEventType[] = [
  "DecisionProduced",
] as const;

// ---------------------------------------------------------------------------
// P5-05 §6 — Explanation slots (derived from authoritative records)
// ---------------------------------------------------------------------------

/**
 * Structured explanation for a P5 decision.
 * Every field maps to the frozen P5-05 §6 explanation slots.
 * No orphan claims — every clause maps to a recorded fact.
 */
export interface P5StructuredExplanation {
  /** WHAT: decision outcome + action type + parameters (if SELECTED). */
  what: string;
  /** WHY: policy rationale — rule refs, reason codes (from P5-03). */
  why: string;
  /** BASED ON WHAT: the P4 evidence snapshot consumed. */
  basedOn: string;
  /** POLICY: policy identity + version + effective/evaluation time. */
  policy: string;
  /** SAFETY / GUARDRAIL: guardrail results evaluated (empty in V1). */
  safety: string;
  /** APPROVAL: approval state + record (NOT_REQUIRED in V1). */
  approval: string;
  /** CURRENT STATE: decisionState / approvalState / executionState. */
  currentState: string;
  /** WHAT DID NOT HAPPEN: alternatives considered, suppression, blockers. */
  whatDidNotHappen: string[];
}

// ---------------------------------------------------------------------------
// P5-05 §22 — Explanation levels (PROVISIONAL)
// ---------------------------------------------------------------------------

export type P5ExplanationLevel = "SUMMARY" | "DETAILED" | "AUDIT";

// ---------------------------------------------------------------------------
// P5-05 §17 — Extended audit event (with provenance)
// ---------------------------------------------------------------------------

/**
 * Extended audit event for P5-05-RT runtime.
 * Carries the frozen P5-05 §17 event contract fields.
 */
export interface P5ExplanationAuditEvent {
  /** MANDATORY — stable identity (idempotent recording key). */
  eventId: string;
  /** MANDATORY — from §16.1 vocabulary. */
  eventType: P5AuditEventType;
  /** MANDATORY — when the fact occurred. */
  timestamp: string;
  /** MANDATORY (non-system) / CONDITIONAL — SYSTEM for deterministic evaluation. */
  actor: string | null;
  /** MANDATORY (decision events) — absent only for DecisionSuppressed / CandidateCreated. */
  decisionIdRef: string | null;
  /** CONDITIONAL — candidate ref (blocked/suppressed/selected). */
  candidateIdRef: string | null;
  /** CONDITIONAL — exists iff SELECTED. */
  actionIdRef: string | null;
  /** CONDITIONAL — transition events only. */
  previousState: string | null;
  /** CONDITIONAL — transition events; DecisionProduced carries decisionOutcome. */
  newState: string | null;
  /** CONDITIONAL — blocker/failure/suppression reason refs. */
  reason: string | null;
  /** CONDITIONAL (policy-origin) — P5-03. */
  policyVersionRef: string | null;
  /** CONDITIONAL (safety-origin) — P5-04. */
  guardrailRef: string | null;
  /** CONDITIONAL (approval-origin) — P5-04. */
  approvalRef: string | null;
  /** MANDATORY — refs required to reconstruct the event. */
  provenance: P5ProvenanceRecord;
}

// ---------------------------------------------------------------------------
// P5-05-RT — Explanation/Audit evaluation input
// ---------------------------------------------------------------------------

/**
 * Input to the P5-05-RT Explanation/Audit evaluator.
 * Consumes the frozen outputs of P5-03-RT and P5-04-RT.
 */
export interface P5ExplanationInput {
  /** Decision identity (P5-02 AD-013). */
  decisionId: string;
  /** Candidate identity (P5-02 AD-013). */
  candidateId: string | null;
  /** Action identity — present iff SELECTED (P5-02 AD-013). */
  actionId: string | null;
  /** Narrative subject. */
  subject: { narrativeId: number };
  /** P5-03 policy evaluation result. */
  policyResult: P5PolicyEvaluationResult;
  /** P5-04 safety evaluation result. */
  safetyResult: P5SafetyEvaluationResult;
  /** Decision state (P5-02 AD-022). */
  decisionState: P5DecisionState;
}

// ---------------------------------------------------------------------------
// P5-05-RT — Explanation/Audit evaluation result
// ---------------------------------------------------------------------------

/**
 * Output of the P5-05-RT Explanation/Audit evaluator.
 * Carries the explanation, provenance, and audit events for downstream
 * P5-10 Decision Producer and P5-09 Artifact Recorder.
 */
export interface P5ExplanationResult {
  /** Structured explanation (§6 slots). */
  explanation: P5ExplanationRecord;
  /** Full provenance record (§10). */
  provenance: P5ProvenanceRecord;
  /** Audit events (§16-§17) — append-only lifecycle events. */
  auditEvents: P5ExplanationAuditEvent[];
  /** Audit trace (observability, not a contract type). */
  audit: Array<{
    ruleId: string;
    layer: "explanation" | "audit" | "provenance";
    action: string;
    detail: string;
  }>;
}
