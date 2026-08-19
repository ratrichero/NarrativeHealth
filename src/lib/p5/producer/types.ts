/**
 * P5-10 — Production Decision Producer types.
 *
 * Frozen contract source:
 *  - P5-02 AD-013/AD-018 (decision identity)
 *  - P5-02 AD-004 (outcome vocabulary)
 *  - P5-02 AD-009 (orthogonal state dimensions)
 *  - P5-10 §5 (input contract)
 *  - P5-10 §10 (field mapping)
 *
 * Hard boundary:
 *  - This module defines types ONLY; the producer is in `p5-decision-producer.ts`.
 *  - No DB access, no replay, no persistence writes.
 *  - No policy/safety/approval/permission evaluation.
 *  - No business rule invention.
 */

import type {
  P5DecisionOutcome,
  P5DecisionRecord,
  P5ExplanationRecord,
  P5ProvenanceRecord,
  P5AuditEvent,
  P5BlockerReport,
  P5GuardrailResult,
  P5SafetyResult,
  P5ApprovalRecord,
  P5PermissionResult,
  P5ActionType,
  P5DecisionState,
  P5ApprovalState,
  P5ExecutionState,
} from "../types";
import type { P5PolicyEvaluationResult } from "../policy/types";
import type { P5SafetyEvaluationResult } from "../safety/types";
import type { P5ExplanationResult } from "../explanation/types";
import type { P5RecordingResult } from "../record/p5-artifact-recorder";

// ---------------------------------------------------------------------------
// P5-10 §5 — Producer Input (declared facts, never derived)
// ---------------------------------------------------------------------------

/**
 * The complete input bundle for a single P5 decision production.
 * Every field maps to an explicit P5-10 §5 declared input.
 * The producer consumes ONLY what is declared here — no P4 re-derivation,
 * no invented inputs.
 */
export interface P5ProducerInput {
  /** Narrative subject (from P4 snapshot identity). */
  subject: { narrativeId: number };

  /** P5-03 policy evaluation result — ONLY source of outcome. */
  policyResult: P5PolicyEvaluationResult;

  /** P5-04 safety evaluation result. */
  safetyResult: P5SafetyEvaluationResult;

  /** P5-05 explanation/audit result. */
  explanationResult: P5ExplanationResult;

  /**
   * Optional producer-supplied permission artifact (P5-08 §10 gap).
   * Absence is preserved — never fabricated.
   */
  permission?: {
    ref: string;
    decisionIdRef: string;
    grantedAt: string | null;
    grantedBy: string | null;
    expiresAt: string | null;
    scope: string | null;
  };
}

// ---------------------------------------------------------------------------
// P5-10 §6 — Producer Options
// ---------------------------------------------------------------------------

export interface P5ProducerOptions {
  /** Policy identity (overridable for testing). */
  policyId?: string;
  /** Policy version (overridable for testing). */
  policyVersion?: string;
}

// ---------------------------------------------------------------------------
// P5-10 §11 — Commit Result
// ---------------------------------------------------------------------------

/**
 * The result of a successful decision commit.
 * Contains the immutable decision record and the recording outcome.
 */
export interface P5CommitResult {
  /** The immutable decision record produced. */
  decision: P5DecisionRecord;
  /** The recording outcome from P5ArtifactRecorder. */
  recording: P5RecordingResult;
}
