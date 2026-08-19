/**
 * P5-05-RT — Deterministic Explanation / Audit Evaluator v1.
 *
 * Frozen contract source:
 *  - P5-05 §6 Explanation Model (slots)
 *  - P5-05 §10 Provenance Model
 *  - P5-05 §16 Audit Event Vocabulary
 *  - P5-05 §17 Audit Event Contract
 *  - P5-05 §22 Explanation Levels
 *
 * Evaluation order (per P5-05 §35 Conceptual Flow):
 *   1. Provenance construction (from upstream facts)
 *   2. Explanation construction (structured slots from recorded facts)
 *   3. Audit event generation (DecisionProduced for V1)
 *   4. Result assembly
 *
 * Hard boundaries (P5-05-RT):
 *  - PURE, DETERMINISTIC: same input = same result.
 *  - NO DB access, NO replay, NO persistence writes.
 *  - NO policy evaluation, NO safety evaluation, NO execution.
 *  - NO new audit event types beyond frozen P5-05 vocabulary.
 *  - NO LLM dependency.
 *  - NO hidden scores, NO thresholds, NO BUY/SELL.
 *  - Timestamps are metadata only; no Date.now() in conditions.
 *  - Input objects are never mutated.
 *
 * V1 behavior:
 *  - Explanation constructed from P5-03 and P5-04 upstream facts.
 *  - Audit events: DecisionProduced only (V1 no suppression/approval/permission events).
 *  - Explanation is deterministic and template-derived.
 *  - Every explanation claim maps to a recorded fact (no orphan claims).
 */

import type {
  P5ActionType,
  P5ApprovalState,
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
import type {
  P5ExplanationAuditEvent,
  P5ExplanationInput,
  P5ExplanationResult,
} from "./types";

// ---------------------------------------------------------------------------
// Helper: deterministic event ID (not random — P5-05 §17 idempotency)
// ---------------------------------------------------------------------------

function deterministicEventId(
  decisionId: string,
  eventType: string,
): string {
  return `${decisionId}:${eventType}`;
}

// ---------------------------------------------------------------------------
// Helper: metadata timestamp (metadata only, never affects rule outcomes)
// ---------------------------------------------------------------------------

function metadataTimestamp(): string {
  return "evaluated";
}

// ---------------------------------------------------------------------------
// Helper: build explanation slots from upstream facts (§6)
// ---------------------------------------------------------------------------

function buildExplanation(
  input: P5ExplanationInput,
): P5ExplanationRecord {
  const { policyResult, safetyResult, decisionState, decisionId } = input;
  const outcome = policyResult.outcome;

  // WHAT
  const actionType = policyResult.selectedCandidate?.actionType;
  const what = buildWhatSlot(outcome, actionType);

  // WHY
  const why = buildWhySlot(policyResult, outcome);

  // BASED ON WHAT
  const basedOn = buildBasedOnSlot(policyResult);

  // POLICY
  const policy = buildPolicySlot(policyResult);

  // SAFETY
  const safety = buildSafetySlot(safetyResult);

  // APPROVAL
  const approval = buildApprovalSlot(safetyResult);

  // CURRENT STATE
  const currentState = buildCurrentStateSlot(
    decisionState,
    safetyResult.approvalState,
    safetyResult.permissionState,
  );

  // WHAT DID NOT HAPPEN
  const whatDidNotHappen = buildWhatDidNotHappenSlot(outcome, policyResult);

  return {
    what,
    why,
    basedOn,
    policy,
    safety,
    approval,
    currentState,
    whatDidNotHappen,
  };
}

// ---------------------------------------------------------------------------
// Explanation slot builders
// ---------------------------------------------------------------------------

function buildWhatSlot(
  outcome: P5DecisionOutcome,
  actionType: P5ActionType | null | undefined,
): string {
  if (outcome === "SELECTED" && actionType) {
    return `Decision outcome is SELECTED with action type ${actionType}`;
  }
  if (outcome === "NO_ACTION") {
    return "Decision outcome is NO_ACTION — evaluation completed, nothing selected";
  }
  if (outcome === "BLOCKED") {
    return "Decision outcome is BLOCKED";
  }
  if (outcome === "NOT_DETERMINED") {
    return "Decision outcome is NOT_DETERMINED — could not reliably determine";
  }
  return `Decision outcome is ${outcome}`;
}

function buildWhySlot(
  policyResult: P5PolicyEvaluationResult,
  outcome: P5DecisionOutcome,
): string {
  const ruleRefs = policyResult.provenance.ruleRefs.join(", ");
  const reasonCodes = policyResult.reasonCodes.join(", ");

  if (outcome === "SELECTED") {
    return `Selected by policy rules [${ruleRefs}] with reason codes [${reasonCodes}]`;
  }
  if (outcome === "NO_ACTION") {
    return `No action selected — evaluation completed with reason codes [${reasonCodes}]`;
  }
  if (outcome === "NOT_DETERMINED") {
    return `Could not determine — reason codes [${reasonCodes}]`;
  }
  if (outcome === "BLOCKED" && policyResult.blockerReport) {
    const br = policyResult.blockerReport;
    return `Blocked by ${br.source} — rule ${br.ruleId ?? "unknown"}, reason ${br.reasonCode ?? "unknown"}`;
  }
  return `Outcome ${outcome} — reason codes [${reasonCodes}]`;
}

function buildBasedOnSlot(policyResult: P5PolicyEvaluationResult): string {
  const ref = policyResult.provenance.p4SnapshotRef;
  const status = ref.status;
  const narrativeId = ref.narrativeIdentity.narrativeId;
  const asOf = ref.asOf;
  return `Based on P4 snapshot for narrative ${narrativeId} as of ${asOf} (status: ${status})`;
}

function buildPolicySlot(policyResult: P5PolicyEvaluationResult): string {
  const p = policyResult.provenance;
  return `Policy ${p.policyId}@${p.policyVersion} (effective: ${p.effectiveAt}, evaluated: ${p.evaluationAt})`;
}

function buildSafetySlot(safetyResult: P5SafetyEvaluationResult): string {
  const aggregate = safetyResult.safetyOutcome;
  const guardrailCount = safetyResult.guardrailResults.length;
  return `Safety: ${aggregate} (${guardrailCount} guardrails evaluated)`;
}

function buildApprovalSlot(safetyResult: P5SafetyEvaluationResult): string {
  const state = safetyResult.approvalState;
  if (state === "NOT_REQUIRED") {
    return "Approval: NOT_REQUIRED (V1 advisory-only)";
  }
  return `Approval: ${state}`;
}

function buildCurrentStateSlot(
  decisionState: P5DecisionState,
  approvalState: P5ApprovalState,
  permissionState: P5PermissionResult,
): string {
  return `Decision state: ${decisionState}, Approval: ${approvalState}, Permission: ${permissionState}`;
}

function buildWhatDidNotHappenSlot(
  outcome: P5DecisionOutcome,
  policyResult: P5PolicyEvaluationResult,
): string[] {
  const items: string[] = [];

  if (outcome === "SELECTED") {
    items.push("No alternatives were rejected (single-candidate V1)");
  } else if (outcome === "NO_ACTION") {
    items.push("No action was taken — evaluation completed with no eligible candidate");
  } else if (outcome === "NOT_DETERMINED") {
    items.push("No decision was produced — evaluation could not complete");
  } else if (outcome === "BLOCKED") {
    items.push("Action was blocked — no execution occurred");
  }

  if (policyResult.suppression.suppressed) {
    items.push("Suppression was applied — no decision produced");
  }

  return items;
}

// ---------------------------------------------------------------------------
// Helper: build provenance record (§10)
// ---------------------------------------------------------------------------

function buildProvenance(input: P5ExplanationInput): P5ProvenanceRecord {
  const { policyResult, safetyResult } = input;

  return {
    decisionId: input.decisionId,
    candidateId: input.candidateId,
    actionId: input.actionId,
    p4SnapshotRef: { ...policyResult.provenance.p4SnapshotRef, contentHash: null },
    policy: {
      policyId: policyResult.provenance.policyId,
      policyVersion: policyResult.provenance.policyVersion,
      effectiveAt: policyResult.provenance.effectiveAt,
      evaluationAt: policyResult.provenance.evaluationAt,
      ruleRefs: [...policyResult.provenance.ruleRefs],
    },
    safety: {
      guardrailVersion: safetyResult.provenance.guardrailModelVersion,
    },
    approval: {
      approvalPolicyVersion: safetyResult.provenance.approvalModelVersion,
      authorityRef: safetyResult.approvalRecord?.authorityRef ?? null,
    },
    automationMode: safetyResult.provenance.automationMode,
    versions: {
      actionModelVersion: "p5-action-model/v1",
      p4VersionTuple: { ...policyResult.provenance.p4VersionTuple },
    },
    timestamps: {
      decisionAt: null,
      evaluatedAt: safetyResult.provenance.evaluatedAt,
      recordedAt: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: generate audit events (§16-§17)
// ---------------------------------------------------------------------------

function generateAuditEvents(
  input: P5ExplanationInput,
  provenance: P5ProvenanceRecord,
): P5ExplanationAuditEvent[] {
  const events: P5ExplanationAuditEvent[] = [];
  const outcome = input.policyResult.outcome;

  // V1: DecisionProduced fires for every completed evaluation
  events.push({
    eventId: deterministicEventId(input.decisionId, "DecisionProduced"),
    eventType: "DecisionProduced",
    timestamp: metadataTimestamp(),
    actor: "SYSTEM",
    decisionIdRef: input.decisionId,
    candidateIdRef: input.candidateId,
    actionIdRef: input.actionId,
    previousState: null,
    newState: outcome,
    reason: input.policyResult.reasonCodes.join(", ") || null,
    policyVersionRef: `${input.policyResult.provenance.policyId}@${input.policyResult.provenance.policyVersion}`,
    guardrailRef: null,
    approvalRef: null,
    provenance,
  });

  // V1: DecisionSuppressed fires only if suppression was applied
  if (input.policyResult.suppression.suppressed) {
    events.push({
      eventId: deterministicEventId(input.decisionId, "DecisionSuppressed"),
      eventType: "DecisionSuppressed",
      timestamp: metadataTimestamp(),
      actor: "SYSTEM",
      decisionIdRef: null,
      candidateIdRef: input.candidateId,
      actionIdRef: null,
      previousState: null,
      newState: "SUPPRESSED",
      reason: input.policyResult.suppression.reasonCode,
      policyVersionRef: null,
      guardrailRef: null,
      approvalRef: null,
      provenance,
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Main evaluator
// ---------------------------------------------------------------------------

export class P5ExplanationEvaluator {
  /**
   * Produce explanation, provenance, and audit events for a P5 decision.
   *
   * Deterministic: same input = same result.
   * Pure: no DB, no persistence, no live data.
   * Every explanation claim maps to a recorded fact (no orphan claims).
   */
  evaluate(input: P5ExplanationInput): P5ExplanationResult {
    const audit: P5ExplanationResult["audit"] = [];

    // Step 1: Build provenance (§10)
    const provenance = buildProvenance(input);
    audit.push({
      ruleId: "PROVENANCE",
      layer: "provenance",
      action: "CONSTRUCTED",
      detail: `Provenance built for decision ${input.decisionId}`,
    });

    // Step 2: Build explanation (§6)
    const explanation = buildExplanation(input);
    audit.push({
      ruleId: "EXPLANATION",
      layer: "explanation",
      action: "CONSTRUCTED",
      detail: `Explanation built with ${explanation.whatDidNotHappen.length} "what did not happen" items`,
    });

    // Step 3: Generate audit events (§16-§17)
    const auditEvents = generateAuditEvents(input, provenance);
    audit.push({
      ruleId: "AUDIT",
      layer: "audit",
      action: "GENERATED",
      detail: `Generated ${auditEvents.length} audit event(s)`,
    });

    return {
      explanation,
      provenance,
      auditEvents,
      audit,
    };
  }
}
