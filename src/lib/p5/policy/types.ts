/**
 * P5-03-RT — Policy Evaluation Runtime v1 types.
 *
 * Frozen contract source:
 *  - P5-03 §6 Policy Input Model (inputs)
 *  - P5-02 AD-004 outcome vocabulary (SELECTED / NO_ACTION / BLOCKED / NOT_DETERMINED)
 *  - P5-03 §33 / PD-002 eligibility semantics
 *  - P5-03 §34.3 Outcome Matrix
 *  - P5-03 PD-018 blocker classification
 *  - P5-03 PD-019 suppression layer result
 *  - P5-03 PD-012 policy provenance
 *  - Owner-approved ruleset: `pol-p5-v1` / `v1` (FROZEN 2026-08-17)
 *
 * Hard boundary:
 *  - This module defines types ONLY; the evaluator is in `evaluator.ts`.
 *  - No DB access, no replay, no safety/approval/permission/execution logic.
 *  - No new outcomes added to P5-02 AD-004 vocabulary.
 */

import type {
  P4DirectionState,
  P4QualitativeValue,
  P4ViewModelStatus,
} from "@/lib/p4/types";
import type { P5ActionType, P5DecisionOutcome } from "../types";

// ---------------------------------------------------------------------------
// Policy identity (P5-03 PD-012; owner-approved ODR-1)
// ---------------------------------------------------------------------------

export interface P5PolicyIdentity {
  policyId: string;
  policyVersion: string;
  effectiveAt: string;
}

// ---------------------------------------------------------------------------
// P5-02 ActionCandidate (P5-03 §6.C)
// ---------------------------------------------------------------------------

export interface P5ActionCandidate {
  candidateId: string;
  actionType: P5ActionType;
  /** Parameters per AD-015 — presence validation only; no field invention. */
  parameters: Record<string, unknown>;
  subject: { narrativeId: number };
}

// ---------------------------------------------------------------------------
// P4 snapshot ref (P5-02 AD-014 — identity + version)
// ---------------------------------------------------------------------------

export interface P5PolicySnapshotRef {
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
}

// ---------------------------------------------------------------------------
// P5-03 §6 — Policy Evaluation Input (declared inputs only)
// ---------------------------------------------------------------------------

/**
 * The complete input bundle for a single policy evaluation.
 * Every field maps to an explicit P5-03 §6 declared input.
 * P5-03 consumes ONLY what is declared here — no P4 re-derivation,
 * no invented inputs.
 */
export interface P5PolicyEvaluationInput {
  /** Policy identity (PD-012). */
  policy: P5PolicyIdentity;

  /** P4 snapshot ref (AD-014) — exact ref, never live/current. */
  p4SnapshotRef: P5PolicySnapshotRef;

  /** P4 VM status (P5-03 §6.A — REQUIRED). */
  status: P4ViewModelStatus;

  /** P4 direction (P5-03 §6 — REQUIRED). */
  direction: P4DirectionState;

  /** P4 opportunity (P5-03 §6 — REQUIRED; consumed as-is, PD-014). */
  opportunity: P4QualitativeValue;

  /** P4 risk (P5-03 §6 — REQUIRED; consumed as-is, PD-014). */
  risk: P4QualitativeValue;

  /** P4 confidence (P5-03 §6 — REQUIRED; consumed as-is, PD-014). */
  confidence: P4QualitativeValue;

  /** P4 actionability (P5-03 §6 — REQUIRED; consumed as-is, PD-014). */
  actionability: P4QualitativeValue;

  /** P4 fired signals (P5-03 §6 — OPTIONAL; context conditions only, PD-014). */
  signalIds: string[];

  /** P4 degradation reasons (REQUIRED when status DEGRADED; preserved in provenance). */
  degradation: Array<{ code: string; field?: string }> | null;

  /** The candidate being evaluated (P5-03 §6.C). */
  candidate: P5ActionCandidate;

  /**
   * V1: empty — no declared context inputs exist in V1.
   * Future: cooldown / duplicate history / temporal context.
   */
  declaredContext: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Eligibility result (P5-03 PD-002; ELIGIBLE is a policy evaluation result, not a state)
// ---------------------------------------------------------------------------

export interface P5EligibilityResult {
  eligible: boolean;
  /** The ruleId(s) that determined eligibility or non-eligibility. */
  ruleIds: string[];
  /** Why ineligible / what precondition failed. */
  reasonCode: string | null;
}

// ---------------------------------------------------------------------------
// Suppression result (PD-019) — present for V1 completeness, no V1 trigger
// ---------------------------------------------------------------------------

export interface P5SuppressionResult {
  suppressed: boolean;
  reasonCode: string | null;
}

// ---------------------------------------------------------------------------
// Blocker report (PD-018) — present for V1 completeness, no V1 trigger
// ---------------------------------------------------------------------------

export interface P5PolicyBlockerReport {
  source: "POLICY";
  ruleId: string | null;
  reasonCode: string | null;
}

// ---------------------------------------------------------------------------
// Policy evaluation result (P5-03 §33; consumed by P5-04 / P5-10 / P5-09)
// ---------------------------------------------------------------------------

export interface P5PolicyEvaluationResult {
  /** The policy outcome from P5-02 AD-004 vocabulary. */
  outcome: P5DecisionOutcome;

  /** Eligibility result (per-candidate). */
  eligibility: P5EligibilityResult;

  /**
   * The selected action candidate — present IFF outcome = SELECTED.
   * This is `selectedActionRef` from the ruleset (C-501).
   */
  selectedCandidate: P5ActionCandidate | null;

  /** Suppression layer result — V1: always { suppressed: false, reasonCode: null }. */
  suppression: P5SuppressionResult;

  /** Blocker report — V1: always null (no POLICY-BLOCKED trigger in V1). */
  blockerReport: P5PolicyBlockerReport | null;

  /** Policy provenance (PD-012; decision 17). */
  provenance: {
    policyId: string;
    policyVersion: string;
    effectiveAt: string;
    evaluationAt: string;
    /** All ruleIds that were evaluated and fired. */
    ruleRefs: string[];
    /** P4 snapshot ref consumed (exact reference). */
    p4SnapshotRef: P5PolicySnapshotRef;
    /** P4 version tuple (for cross-referencing). */
    p4VersionTuple: P5PolicyEvaluationInput["p4SnapshotRef"]["versionTuple"];
    /** Degradation refs when status DEGRADED (verbatim from input). */
    degradation: Array<{ code: string; field?: string }> | null;
  };

  /** Reason code(s) for audit/explanation (approved vocabulary ODR-12). */
  reasonCodes: string[];

  /**
   * Per-rule evaluation trace — observability/debugging aid.
   * Not part of the frozen P5-02 contract; flows into P5-05 audit events
   * when the decision pipeline is wired.
   */
  audit: Array<{
    ruleId: string;
    layer: string;
    action: string;
    detail: string;
  }>;
}
