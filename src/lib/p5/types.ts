/**
 * P5-06A Read Model types (P5-06).
 *
 * P5-06 is the first P5 implementation task, strictly contract-driven.
 * Every type below uses the FROZEN vocabulary of P5-02 (Action Model),
 * P5-03 (Policy outcomes), P5-04 (Safety / Approval / Permission) and
 * P5-05 (Explanation / Audit). The read layer only *presents* records
 * produced upstream — it never creates decisions, evaluates policy,
 * evaluates safety, grants approval or permission, or executes anything.
 *
 * READ-ONLY: no write/mutation method exists anywhere in this module.
 */

import type {
  P4DirectionState,
  P4QualitativeValue,
  P4ViewModelStatus,
} from "@/lib/p4/types";

// ---------------------------------------------------------------------------
// P5-02 outcome vocabulary (AD-004) — produced by P5-03 policy evaluation.
// ---------------------------------------------------------------------------

/** P5-02 AD-004 decision outcomes. */
export type P5DecisionOutcome = "SELECTED" | "NO_ACTION" | "BLOCKED" | "NOT_DETERMINED";

/** P5-03 PD-018 blocker classification — a generic BLOCKED never exists without a source. */
export type P5BlockerSource = "POLICY" | "SAFETY" | "APPROVAL";

// ---------------------------------------------------------------------------
// P5-02 AD-009 orthogonal state dimensions — NEVER collapsed into one status.
// ---------------------------------------------------------------------------

export type P5DecisionState = "DECIDED" | "CANCELLED" | "SUPERSEDED" | "EXPIRED";
export type P5ApprovalState =
  | "NOT_REQUIRED"
  | "REQUIRED"
  | "PENDING"
  | "APPROVED"
  | "DENIED"
  | "EXPIRED"
  | "REVOKED";
export type P5ExecutionState = "NOT_APPLICABLE" | "PERMITTED" | "EXECUTED" | "FAILED" | "CANCELLED";

// ---------------------------------------------------------------------------
// P5-04 safety / approval / permission vocabulary.
// ---------------------------------------------------------------------------

/** P5-04 §10 guardrail outcomes — PASS/BLOCK/NOT_DETERMINED/UNAVAILABLE/ERROR are never collapsed. */
export type P5GuardrailOutcome =
  | "PASS"
  | "BLOCK"
  | "NOT_DETERMINED"
  | "UNAVAILABLE"
  | "ERROR"
  | "NOT_APPLICABLE";

/** P5-04 §11 aggregate safety result. */
export type P5SafetyAggregate = "PASS" | "BLOCK" | "NOT_DETERMINED";

/** P5-04 SG-011 execution permission — an authorization result, never "executed". */
export type P5PermissionResult = "GRANTED" | "NOT_GRANTED" | "NOT_APPLICABLE" | "UNAVAILABLE";

/**
 * P5-02 AD-005 provisional v1 taxonomy. EXECUTE and ESCALATE are CANDIDATE
 * (AD-006/AD-007) and are deliberately NOT v1 ActionTypes — the read layer
 * never maps to BUY/SELL semantics (P5-02 AD-008).
 */
export type P5ActionType =
  | "MONITOR"
  | "REVIEW"
  | "INVESTIGATE"
  | "REDUCE_EXPOSURE"
  | "INCREASE_EXPOSURE"
  | "REBALANCE";

// ---------------------------------------------------------------------------
// Provenance (P5-02 AD-014 snapshot ref; P5-05 §10/§12/§13/§14).
// ---------------------------------------------------------------------------

/** P5-02 AD-014 p4SnapshotRef — identity + version + asOf (+ PROVISIONAL contentHash). */
export interface P5P4SnapshotRef {
  narrativeIdentity: {
    narrativeId: number;
    window: string;
    algorithmKey: string;
    algorithmVersion: string;
    calculationMode: string;
  };
  asOf: string;
  versionTuple: {
    algorithmVersion: string;
    semanticVersion: string;
    signalCatalogVersion: string;
    interpretationRuleVersion: string;
  };
  status: P4ViewModelStatus;
  /** PROVISIONAL (P5-02 AD-014) — not computed in v1; always null until a later task. */
  contentHash: string | null;
}

/** P5-03 PD-018 / P5-04 §12 blocker report — self-describing, never opaque `blocked = true`. */
export interface P5BlockerReport {
  source: P5BlockerSource;
  /** POLICY: rule reference; SAFETY: guardrail reference; APPROVAL: approval record reference. */
  ref: string | null;
  versionRef: string | null;
  evaluatedAt: string | null;
  reason: string | null;
}

/** P5-04 §13 approval record — an explicit authorization event (SG-005). */
export interface P5ApprovalRecord {
  approvalId: string;
  decisionIdRef: string;
  state: P5ApprovalState;
  authorityRef: string | null;
  actor: string | null;
  timestamp: string | null;
  scope: string | null;
  approvalPolicyVersion: string | null;
  invalidation: { reason: string | null; occurredAt: string | null } | null;
}

/** P5-04 §10 per-guardrail result. */
export interface P5GuardrailResult {
  guardrailId: string;
  version: string | null;
  outcome: P5GuardrailOutcome;
  applicable: boolean;
  evaluatedAt: string | null;
  reason: string | null;
}

/** P5-04 §11 safety evaluation record. */
export interface P5SafetyResult {
  aggregate: P5SafetyAggregate;
  guardrailResults: P5GuardrailResult[];
}

/** P5-05 §17 audit event (frozen core vocabulary, P5-05 §16.1). */
export interface P5AuditEvent {
  eventId: string;
  eventType: string;
  timestamp: string;
  actor: string | null;
  decisionIdRef: string | null;
  previousState: string | null;
  newState: string | null;
  reason: string | null;
  policyVersionRef: string | null;
  guardrailRef: string | null;
  approvalRef: string | null;
}

/** P5-05 §10 provenance record — every explanation claim maps to a recorded fact. */
export interface P5ProvenanceRecord {
  decisionId: string;
  candidateId: string | null;
  actionId: string | null;
  p4SnapshotRef: P5P4SnapshotRef | null;
  policy: {
    policyId: string | null;
    policyVersion: string | null;
    effectiveAt: string | null;
    evaluationAt: string | null;
    ruleRefs: string[];
  };
  safety: { guardrailVersion: string | null };
  approval: { approvalPolicyVersion: string | null; authorityRef: string | null };
  automationMode: "ADVISORY" | null;
  versions: {
    actionModelVersion: string;
    p4VersionTuple: {
      algorithmVersion: string;
      semanticVersion: string;
      signalCatalogVersion: string;
      interpretationRuleVersion: string;
    } | null;
  };
  timestamps: { decisionAt: string | null; evaluatedAt: string | null; recordedAt: string | null };
}

/** P5-05 §6 explanation slots — derived from authoritative records, never invented. */
export interface P5ExplanationRecord {
  what: string;
  why: string | null;
  basedOn: string | null;
  policy: string | null;
  safety: string | null;
  approval: string | null;
  currentState: string | null;
  whatDidNotHappen: string[];
}

/**
 * A P5 decision record — the persisted shape a future P5-03/04/05 storage
 * produces. P5-06A consumes records through the P5DecisionStore boundary;
 * it never creates or mutates them.
 */
export interface P5DecisionRecord {
  decisionId: string;
  candidateId: string | null;
  /** Created iff outcome SELECTED (P5-02 AD-013). */
  actionId: string | null;
  subject: { narrativeId: number };
  outcome: P5DecisionOutcome;
  /** P5-03 layer result (PD-019) — SUPPRESSED is NOT a P5-02 outcome and never becomes NO_ACTION. */
  suppressed: boolean;
  blockerReport: P5BlockerReport | null;
  actionType: P5ActionType | null;
  parameters: Record<string, unknown> | null;
  decisionState: P5DecisionState;
  approvalState: P5ApprovalState;
  executionState: P5ExecutionState;
  approvalRecord: P5ApprovalRecord | null;
  safetyResult: P5SafetyResult | null;
  permissionResult: P5PermissionResult;
  explanation: P5ExplanationRecord;
  provenance: P5ProvenanceRecord;
  auditEvents: P5AuditEvent[];
}

// ---------------------------------------------------------------------------
// Read view model (P5-06A output; P5-06B wire contract; P5-06C UI input).
// ---------------------------------------------------------------------------

/**
 * Read-layer availability (P5-06 §16) — an infrastructure/availability fact,
 * NEVER a domain outcome. It is what prevents "404 → NO_ACTION",
 * "db failure → NO_ACTION" and "missing snapshot → NO_ACTION".
 */
export type P5ReadAvailability =
  | "OK" // decision record present and readable
  | "NO_DECISION_RECORD" // subject has no P5 decision record
  | "DECISION_NOT_FOUND" // lookup by decisionId found nothing
  | "P4_CONTEXT_UNAVAILABLE" // P4 context could not be derived
  | "SERVICE_ERROR"; // read-layer infrastructure failure

/**
 * Presentation classification for the 8 distinct situations (P5-06 §5, §10).
 * DERIVED for display only — it never replaces the orthogonal
 * decisionState / approvalState / executionState fields and never claims a
 * domain outcome that is not recorded.
 */
export type P5DisplayState =
  | "NO_ACTION"
  | "POLICY_BLOCKED"
  | "NOT_DETERMINED"
  | "SUPPRESSED"
  | "SELECTED"
  | "SAFETY_BLOCKED"
  | "APPROVAL_DENIED"
  | "ABSENT"
  | "UNAVAILABLE";

/** Decision fields exposed by the read layer (flattened, 1:1 from the record). */
export interface P5DecisionSummary {
  decisionId: string;
  candidateId: string | null;
  actionId: string | null;
  outcome: P5DecisionOutcome;
  suppressed: boolean;
  blockerReport: P5BlockerReport | null;
  actionType: P5ActionType | null;
  parameters: Record<string, unknown> | null;
  decisionState: P5DecisionState;
  approvalState: P5ApprovalState;
  executionState: P5ExecutionState;
  approvalRecord: P5ApprovalRecord | null;
  safetyResult: P5SafetyResult | null;
  permissionResult: P5PermissionResult;
  explanation: P5ExplanationRecord;
  provenance: P5ProvenanceRecord;
  auditEvents: P5AuditEvent[];
}

/**
 * P5-06A read view model. When no decision record exists, `context` may carry
 * the LIVE P4 context under source = "LIVE_P4_CONTEXT" — explicitly NOT the
 * basis of any decision (P5-05 §11 anti-drift). A decision record's snapshot
 * is only ever exposed via the record provenance (source = "DECISION_RECORD").
 */
export interface P5ActionDecisionReadViewModel {
  decisionPresence: "PRESENT" | "ABSENT";
  decision: P5DecisionSummary | null;
  context: {
    source: "LIVE_P4_CONTEXT" | "DECISION_RECORD";
    p4SnapshotRef: P5P4SnapshotRef | null;
  } | null;
  availability: P5ReadAvailability;
  /** Derived presentation classification — see deriveDisplayState(). */
  displayState: P5DisplayState;
  /** Present only for SERVICE_ERROR — carries the underlying failure detail. */
  error: { code: "SERVICE_ERROR"; message: string } | null;
}

// Re-exported P4 primitives that the UI renders verbatim (frozen values only).
export type { P4DirectionState, P4QualitativeValue, P4ViewModelStatus };
