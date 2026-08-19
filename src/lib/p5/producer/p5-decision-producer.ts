/**
 * P5-10 — Production Decision Producer.
 *
 * Frozen contract source:
 *  - P5-02 AD-013/AD-018 (decision identity)
 *  - P5-02 AD-004 (outcome vocabulary)
 *  - P5-02 AD-009 (orthogonal state dimensions)
 *  - P5-10 §5 (input contract)
 *  - P5-10 §6 (commit boundary)
 *  - P5-10 §10 (field mapping)
 *  - P5-10 §11 (recorder integration)
 *  - P5-10 §13 (dependency boundary)
 *
 * Hard boundaries (P5-10 §6):
 *  - PRODUCER ≠ DECISION ENGINE: no eligibility, no selection, no safety,
 *    no approval, no permission evaluation inside the producer.
 *  - PURE PRODUCTION: same input + same pipeline = same P5DecisionRecord.
 *  - NO DB access, NO replay, NO persistence writes in producer core.
 *  - NO policy/safety/approval/permission evaluation in producer.
 *  - NO new audit event types.
 *  - NO BUY/SELL/LONG/SHORT/ORDER/TRADE.
 *  - NO scores, NO thresholds, NO ranking.
 *  - Timestamps are metadata only.
 *
 * Two-stage lifecycle (P5-10 §11):
 *  1. buildDecision(input) — assemble P5DecisionRecord (NO recording)
 *  2. commitDecision(record) — invoke P5ArtifactRecorder.record() exactly once
 *
 * Decision identity (P5-02 AD-013/AD-018):
 *  - Unique over (subject + p4SnapshotRef + policyVersion + actionModelVersion).
 *  - Same tuple ⇒ same decision.
 *  - decisionId ≠ idempotencyKey ≠ contentHash.
 *  - Generated deterministically from the frozen tuple.
 */

import type {
  P5DecisionRecord,
  P5ExplanationRecord,
  P5ProvenanceRecord,
  P5AuditEvent,
  P5BlockerReport,
  P5DecisionOutcome,
  P5DecisionState,
  P5ApprovalState,
  P5ExecutionState,
  P5PermissionResult,
} from "../types";
import type { P5PolicyEvaluationResult } from "../policy/types";
import type { P5SafetyEvaluationResult } from "../safety/types";
import type { P5ExplanationResult } from "../explanation/types";
import type { P5RecordingResult } from "../record/p5-artifact-recorder";
import type { P5ProducerInput, P5ProducerOptions, P5CommitResult } from "./types";

// ---------------------------------------------------------------------------
// Minimal recorder interface (P5-09 §6 contract — record only)
// ---------------------------------------------------------------------------

/** The minimal interface the producer needs from P5ArtifactRecorder. */
export interface P5Recorder {
  record(batch: { decision: import("../types").P5DecisionRecord }): Promise<P5RecordingResult>;
}

// ---------------------------------------------------------------------------
// Decision Identity Generation (P5-02 AD-013/AD-018)
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic decisionId from the frozen identity tuple.
 *
 * Per AD-018: unique over (subject + p4SnapshotRef + policyVersion + actionModelVersion).
 * Same tuple ⇒ same decision.
 *
 * The identity is a composite of the immutable input elements, NOT derived
 * from Date.now(), Math.random(), or wall-clock time.
 */
function generateDecisionId(
  subject: { narrativeId: number },
  policyResult: P5PolicyEvaluationResult,
): string {
  const snapshotRef = policyResult.provenance.p4SnapshotRef;
  const policyVersion = policyResult.provenance.policyVersion;
  const actionModelVersion = "p5-action-model/v1";

  // Composite tuple: narrativeId + snapshot asOf + snapshot status + policyVersion + actionModelVersion
  const tuple = [
    `n:${subject.narrativeId}`,
    `s:${snapshotRef.asOf}`,
    `st:${snapshotRef.status}`,
    `pv:${policyVersion}`,
    `am:${actionModelVersion}`,
  ].join(":");

  // Deterministic hash-like identifier (no crypto — just a stable composite key)
  return `p5d-${simpleHash(tuple)}`;
}

/**
 * Simple deterministic hash for identity generation.
 * NOT cryptographic — just a stable, unique, short identifier.
 * Same input always produces the same output.
 */
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  // Convert to hex and ensure positive
  return Math.abs(hash).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Build P5DecisionRecord (Phase 4)
// ---------------------------------------------------------------------------

/**
 * Assemble a P5DecisionRecord from declared upstream facts.
 *
 * This function has ZERO evaluation logic:
 * - No eligibility computation
 * - No selection logic
 * - No safety evaluation
 * - No approval evaluation
 * - No permission evaluation
 * - No explanation generation
 *
 * It maps declared facts 1:1 into the frozen record shape.
 */
function buildDecisionRecord(
  input: P5ProducerInput,
): P5DecisionRecord {
  const { policyResult, safetyResult, explanationResult, subject } = input;

  // Generate decision identity (AD-013/AD-018)
  const decisionId = generateDecisionId(subject, policyResult);

  // Extract outcome from policy result (the ONLY source of outcome)
  const outcome: P5DecisionOutcome = policyResult.outcome;

  // Candidate identity (from policy evaluation)
  const candidateId: string | null = policyResult.selectedCandidate?.candidateId ?? null;

  // Action identity (AD-013: non-null iff SELECTED)
  const actionId: string | null = outcome === "SELECTED"
    ? `action-${decisionId}`
    : null;

  // Action type (from selected candidate, null unless SELECTED)
  const actionType = policyResult.selectedCandidate?.actionType ?? null;

  // Parameters (from selected candidate, null unless SELECTED)
  const parameters: Record<string, unknown> | null = policyResult.selectedCandidate?.parameters ?? null;

  // Suppressed (P5-03 PD-019)
  const suppressed: boolean = policyResult.suppression.suppressed;

  // Blocker report (3-way: POLICY / SAFETY / APPROVAL)
  const blockerReport: P5BlockerReport | null = buildBlockerReport(policyResult, safetyResult);

  // Decision state (AD-009: new decision starts as DECIDED)
  const decisionState: P5DecisionState = "DECIDED";

  // Approval state (from P5-04 safety result)
  const approvalState: P5ApprovalState = mapApprovalState(safetyResult);

  // Execution state (V1: NOT_APPLICABLE unless real evidence)
  const executionState: P5ExecutionState = "NOT_APPLICABLE";

  // Approval record (from P5-04, null when NOT_REQUIRED)
  const approvalRecord = safetyResult.approvalRecord
    ? {
        approvalId: safetyResult.approvalRecord.approvalId,
        decisionIdRef: decisionId,
        state: safetyResult.approvalRecord.state,
        authorityRef: safetyResult.approvalRecord.authorityRef,
        actor: safetyResult.approvalRecord.actor,
        timestamp: safetyResult.approvalRecord.timestamp,
        scope: safetyResult.approvalRecord.scope,
        approvalPolicyVersion: safetyResult.approvalRecord.approvalPolicyVersion,
        invalidation: safetyResult.approvalRecord.invalidation,
      }
    : null;

  // Safety result (from P5-04)
  const safetyResultRecord = {
    aggregate: safetyResult.safetyOutcome,
    guardrailResults: safetyResult.guardrailResults,
  };

  // Permission result (from P5-04)
  const permissionResult: P5PermissionResult = safetyResult.permissionState;

  // Explanation (from P5-05)
  const explanation: P5ExplanationRecord = explanationResult.explanation;

  // Provenance (from P5-05)
  const provenance: P5ProvenanceRecord = explanationResult.provenance;

  // Audit events (from P5-05)
  const auditEvents: P5AuditEvent[] = explanationResult.auditEvents.map((e) => ({
    eventId: e.eventId,
    eventType: e.eventType,
    timestamp: e.timestamp,
    actor: e.actor,
    decisionIdRef: e.decisionIdRef,
    previousState: e.previousState,
    newState: e.newState,
    reason: e.reason,
    policyVersionRef: e.policyVersionRef,
    guardrailRef: e.guardrailRef,
    approvalRef: e.approvalRef,
  }));

  return {
    decisionId,
    candidateId,
    actionId,
    subject: { narrativeId: subject.narrativeId },
    outcome,
    suppressed,
    blockerReport,
    actionType,
    parameters,
    decisionState,
    approvalState,
    executionState,
    approvalRecord,
    safetyResult: safetyResultRecord,
    permissionResult,
    explanation,
    provenance,
    auditEvents,
  };
}

// ---------------------------------------------------------------------------
// Build blocker report (3-way provenance)
// ---------------------------------------------------------------------------

function buildBlockerReport(
  policyResult: P5PolicyEvaluationResult,
  safetyResult: P5SafetyEvaluationResult,
): P5BlockerReport | null {
  // Policy blocker (if present)
  if (policyResult.blockerReport) {
    return {
      source: "POLICY",
      ref: policyResult.blockerReport.ruleId,
      versionRef: policyResult.provenance.policyVersion,
      evaluatedAt: policyResult.provenance.evaluationAt,
      reason: policyResult.blockerReport.reasonCode,
    };
  }

  // Safety blocker (if present)
  if (safetyResult.blockerReport) {
    return safetyResult.blockerReport;
  }

  // No blocker
  return null;
}

// ---------------------------------------------------------------------------
// Map approval state (AD-009)
// ---------------------------------------------------------------------------

function mapApprovalState(safetyResult: P5SafetyEvaluationResult): P5ApprovalState {
  const state = safetyResult.approvalState;
  // P5-04 V1: always NOT_REQUIRED
  return state as P5ApprovalState;
}

// ---------------------------------------------------------------------------
// Main Producer Class
// ---------------------------------------------------------------------------

export class P5DecisionProducer {
  constructor(
    private readonly recorder: P5Recorder,
    private readonly options?: P5ProducerOptions,
  ) {}

  /**
   * Build an immutable P5DecisionRecord from declared upstream facts.
   *
   * This is the ASSEMBLY phase — no recording, no persistence, no evaluation.
   * The record is frozen after this call and must not be mutated.
   *
   * Deterministic: same input + same pipeline = same record.
   */
  buildDecision(input: P5ProducerInput): P5DecisionRecord {
    // Validate required inputs
    if (!input.policyResult) {
      throw new Error("P5-10: policyResult is required — cannot construct decision without policy evaluation");
    }
    if (!input.safetyResult) {
      throw new Error("P5-10: safetyResult is required — cannot construct decision without safety evaluation");
    }
    if (!input.explanationResult) {
      throw new Error("P5-10: explanationResult is required — cannot construct decision without explanation");
    }

    return buildDecisionRecord(input);
  }

  /**
   * Commit an immutable P5DecisionRecord through the frozen P5ArtifactRecorder.
   *
   * This is the COMMIT phase — the single recording boundary.
   * The recorder is idempotent (same decisionId = same artifacts).
   * The decision record is NOT mutated after commit.
   *
   * Returns the recording result with per-artifact status.
   */
  async commitDecision(decision: P5DecisionRecord): Promise<P5CommitResult> {
    const recording = await this.recorder.record({ decision });
    return { decision, recording };
  }

  /**
   * Convenience: build + commit in one call.
   *
   * For callers who want the full pipeline without manual build/commit separation.
   * The two-stage lifecycle is still respected internally.
   */
  async produce(input: P5ProducerInput): Promise<P5CommitResult> {
    const decision = this.buildDecision(input);
    return this.commitDecision(decision);
  }
}
