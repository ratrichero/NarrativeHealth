/**
 * P5-03-RT — Deterministic Policy Evaluator v1.
 *
 * Owner-approved ruleset: `pol-p5-v1` / `v1` (FROZEN 2026-08-17).
 * Source: `docs/P5_Upgrade/P5-03_POLICY_RULESET_V1_CANDIDATE.md`.
 *
 * Evaluation order (corrected for cross-layer routing rules):
 *   R-002 (pre-check) → C-102 (applicability) → C-101 →
 *   C-601/C-602 (cross-layer routing) → C-301 (blocking) →
 *   C-201…C-210 (eligibility) → C-501 (selection) → Result
 *
 * Hard boundaries (P5-03-RT §3):
 *  - PURE, DETERMINISTIC (PD-010): same input + same policy version = same result.
 *  - NO DB access, NO replay, NO persistence writes.
 *  - NO safety evaluation, NO approval, NO permission, NO execution.
 *  - NO new audit event types (P5-05 frozen taxonomy only).
 *  - NO legacy P1 rule reuse, NO scores, NO thresholds, NO BUY/SELL.
 *  - Timestamps are metadata only (PD-010); no Date.now() in conditions.
 *  - Rule iteration order is fixed: (layer → priority → ruleId) — stable.
 *
 * V1 outcome surface: SELECTED / NO_ACTION / NOT_DETERMINED.
 * No POLICY-BLOCKED and no SUPPRESSED trigger in V1 (classification retained).
 */

import type { P5DecisionOutcome } from "../types";
import type {
  P5ActionCandidate,
  P5EligibilityResult,
  P5PolicyBlockerReport,
  P5PolicyEvaluationInput,
  P5PolicyEvaluationResult,
  P5SuppressionResult,
} from "./types";
import type { P5EvaluationAuditEntry } from "./rules";
import {
  P5_V1_ACTION_TYPES,
  P5_V1_POLICY_ID,
  P5_V1_POLICY_VERSION,
  P5_V1_REASON_CODES,
  P5_V1_RULE_IDS,
  P5_V1_SNAPSHOT_REQUIRED_TYPES,
} from "./rules";

// Re-export the audit entry type used by the evaluator for observability.
export type { P5EvaluationAuditEntry } from "./rules";

// ---------------------------------------------------------------------------
// Helper: create a NOT_DETERMINED result early
// ---------------------------------------------------------------------------

function notDetermined(
  input: P5PolicyEvaluationInput,
  ruleId: string,
  reasonCode: string,
  ruleRefs: string[],
  audit: P5EvaluationAuditEntry[],
): P5PolicyEvaluationResult {
  const evaluationAt = metadataTimestamp();
  return {
    outcome: "NOT_DETERMINED",
    eligibility: { eligible: false, ruleIds: [], reasonCode },
    selectedCandidate: null,
    suppression: { suppressed: false, reasonCode: null },
    blockerReport: null,
    provenance: buildProvenance(input, evaluationAt, ruleRefs),
    reasonCodes: [reasonCode],
    audit,
  };
}

// ---------------------------------------------------------------------------
// Helper: create a completed-evaluation result
// ---------------------------------------------------------------------------

function completedResult(
  input: P5PolicyEvaluationInput,
  outcome: P5DecisionOutcome,
  eligibility: P5EligibilityResult,
  selectedCandidate: P5ActionCandidate | null,
  suppression: P5SuppressionResult,
  blockerReport: P5PolicyBlockerReport | null,
  ruleRefs: string[],
  reasonCodes: string[],
  audit: P5EvaluationAuditEntry[],
): P5PolicyEvaluationResult {
  const evaluationAt = metadataTimestamp();
  return {
    outcome,
    eligibility,
    selectedCandidate,
    suppression,
    blockerReport,
    provenance: buildProvenance(input, evaluationAt, ruleRefs),
    reasonCodes,
    audit,
  };
}

// ---------------------------------------------------------------------------
// Metadata timestamp — metadata only, never affects rule outcomes (PD-010)
// ---------------------------------------------------------------------------

function metadataTimestamp(): string {
  return "evaluated";
}

// ---------------------------------------------------------------------------
// Build provenance (PD-012; decision 17)
// ---------------------------------------------------------------------------

function buildProvenance(
  input: P5PolicyEvaluationInput,
  evaluationAt: string,
  ruleRefs: string[],
): P5PolicyEvaluationResult["provenance"] {
  return {
    policyId: input.policy.policyId,
    policyVersion: input.policy.policyVersion,
    effectiveAt: input.policy.effectiveAt,
    evaluationAt,
    ruleRefs: [...ruleRefs],
    p4SnapshotRef: { ...input.p4SnapshotRef },
    p4VersionTuple: { ...input.p4SnapshotRef.versionTuple },
    degradation: input.degradation ? [...input.degradation] : null,
  };
}

// ---------------------------------------------------------------------------
// Main evaluator
// ---------------------------------------------------------------------------

export class P5PolicyEvaluator {
  private readonly policyId: string;
  private readonly policyVersion: string;
  private readonly effectiveAt: string;

  constructor(options?: {
    policyId?: string;
    policyVersion?: string;
    effectiveAt?: string;
  }) {
    this.policyId = options?.policyId ?? P5_V1_POLICY_ID;
    this.policyVersion = options?.policyVersion ?? P5_V1_POLICY_VERSION;
    this.effectiveAt = options?.effectiveAt ?? "2026-08-17T00:00:00.000Z";
  }

  /**
   * Evaluate a single candidate against the V1 frozen policy ruleset.
   *
   * Deterministic (PD-010): same input + same policy version = same result.
   * The evaluator follows the frozen PD-004 six-step precedence order,
   * with cross-layer routing (C-601/C-602) and blocking (C-301) checked
   * before eligibility to ensure status-based NOT_DETERMINED is never
   * masked by an eligibility early-return.
   */
  evaluate(input: P5PolicyEvaluationInput): P5PolicyEvaluationResult {
    const audit: P5EvaluationAuditEntry[] = [];
    const ruleRefs: string[] = [];

    // ------------------------------------------------------------------
    // R-002: Input layer unavailable / P4 context absent (PD-008)
    // ------------------------------------------------------------------
    if (input.status === "ERROR") {
      ruleRefs.push(P5_V1_RULE_IDS.R002);
      audit.push({
        ruleId: P5_V1_RULE_IDS.R002,
        layer: "pre-check",
        action: "NOT_DETERMINED",
        detail: "P4 status ERROR — input layer unavailable",
      });
      return notDetermined(
        input,
        P5_V1_RULE_IDS.R002,
        P5_V1_REASON_CODES.POLICY_INPUT_UNAVAILABLE,
        ruleRefs,
        audit,
      );
    }

    // ------------------------------------------------------------------
    // Layer 1 — Applicability (C-101 / C-102)
    // ------------------------------------------------------------------
    const isScopeApproved = (P5_V1_ACTION_TYPES as readonly string[]).includes(
      input.candidate.actionType,
    );

    if (!isScopeApproved) {
      ruleRefs.push(P5_V1_RULE_IDS.C102);
      audit.push({
        ruleId: P5_V1_RULE_IDS.C102,
        layer: "applicability",
        action: "NOT_DETERMINED",
        detail: `ActionType "${input.candidate.actionType}" is outside approved V1 scope`,
      });
      return notDetermined(
        input,
        P5_V1_RULE_IDS.C102,
        P5_V1_REASON_CODES.NOT_ELIGIBLE,
        ruleRefs,
        audit,
      );
    }

    ruleRefs.push(P5_V1_RULE_IDS.C101);
    audit.push({
      ruleId: P5_V1_RULE_IDS.C101,
      layer: "applicability",
      action: "PROCEED",
      detail: `ActionType "${input.candidate.actionType}" is in V1 scope`,
    });

    // ------------------------------------------------------------------
    // Cross-layer — C-601: NO_EVIDENCE → NOT_DETERMINED (decision 11)
    // Fires BEFORE eligibility to prevent masking by ineligible status.
    // ------------------------------------------------------------------
    if (input.status === "NO_EVIDENCE") {
      ruleRefs.push(P5_V1_RULE_IDS.C601);
      audit.push({
        ruleId: P5_V1_RULE_IDS.C601,
        layer: "routing",
        action: "NOT_DETERMINED",
        detail: "P4 status NO_EVIDENCE — required evidence unavailable",
      });
      return notDetermined(
        input,
        P5_V1_RULE_IDS.C601,
        P5_V1_REASON_CODES.NOT_ELIGIBLE,
        ruleRefs,
        audit,
      );
    }

    // ------------------------------------------------------------------
    // Layer 3 — Blocking (C-301): consequential + DEGRADED → NOT_DETERMINED
    // Fires BEFORE eligibility for consequential types (decisions 10/11).
    // ------------------------------------------------------------------
    if (
      P5_V1_SNAPSHOT_REQUIRED_TYPES.includes(input.candidate.actionType) &&
      input.status === "DEGRADED"
    ) {
      ruleRefs.push(P5_V1_RULE_IDS.C301);
      audit.push({
        ruleId: P5_V1_RULE_IDS.C301,
        layer: "blocking",
        action: "NOT_DETERMINED",
        detail: `Consequential candidate with DEGRADED status`,
      });
      return notDetermined(
        input,
        P5_V1_RULE_IDS.C301,
        P5_V1_REASON_CODES.NOT_ELIGIBLE,
        ruleRefs,
        audit,
      );
    }

    // ------------------------------------------------------------------
    // Layer 2 — Eligibility (C-201…C-210)
    // ------------------------------------------------------------------
    const eligibility = this.evaluateEligibility(input, ruleRefs, audit);

    if (!eligibility.eligible) {
      const outcome =
        eligibility.reasonCode === "PARAMETER_UNAVAILABLE"
          ? "NOT_DETERMINED"
          : "NO_ACTION";

      if (outcome === "NOT_DETERMINED") {
        return notDetermined(
          input,
          eligibility.ruleIds[0] ?? P5_V1_RULE_IDS.C210,
          P5_V1_REASON_CODES.NOT_ELIGIBLE,
          ruleRefs,
          audit,
        );
      }
      return completedResult(
        input,
        "NO_ACTION",
        eligibility,
        null,
        { suppressed: false, reasonCode: null },
        null,
        ruleRefs,
        [P5_V1_REASON_CODES.NO_ELIGIBLE_ACTION],
        audit,
      );
    }

    audit.push({
      ruleId: eligibility.ruleIds[0] ?? "C-ELIGIBLE",
      layer: "eligibility",
      action: "ELIGIBLE",
      detail: `Candidate ${input.candidate.candidateId} is eligible`,
    });

    // ------------------------------------------------------------------
    // Layer 4 — Suppression (C-401 / C-402)
    // DEFERRED in V1 — no V1 trigger.
    // ------------------------------------------------------------------
    const suppression: P5SuppressionResult = {
      suppressed: false,
      reasonCode: null,
    };

    // ------------------------------------------------------------------
    // Layer 5 — Selection (C-501)
    // ------------------------------------------------------------------
    ruleRefs.push(P5_V1_RULE_IDS.C501);
    audit.push({
      ruleId: P5_V1_RULE_IDS.C501,
      layer: "selection",
      action: "SELECTED",
      detail: `Candidate ${input.candidate.candidateId} selected (single-candidate predicate)`,
    });

    return completedResult(
      input,
      "SELECTED",
      eligibility,
      input.candidate,
      suppression,
      null,
      ruleRefs,
      [P5_V1_REASON_CODES.SELECTED],
      audit,
    );
  }

  // -------------------------------------------------------------------------
  // Layer 2 — Eligibility evaluation
  // -------------------------------------------------------------------------

  private evaluateEligibility(
    input: P5PolicyEvaluationInput,
    ruleRefs: string[],
    audit: P5EvaluationAuditEntry[],
  ): P5EligibilityResult {
    const { actionType } = input.candidate;

    // C-210: Required parameter unavailable check (AD-015).
    if (
      input.candidate.parameters === null ||
      input.candidate.parameters === undefined
    ) {
      ruleRefs.push(P5_V1_RULE_IDS.C210);
      audit.push({
        ruleId: P5_V1_RULE_IDS.C210,
        layer: "eligibility",
        action: "NOT_DETERMINED",
        detail: "Required parameters are unavailable",
      });
      return {
        eligible: false,
        ruleIds: [P5_V1_RULE_IDS.C210],
        reasonCode: "PARAMETER_UNAVAILABLE",
      };
    }

    switch (actionType) {
      case "MONITOR":
        return this.eligibilityMonitor(input, ruleRefs, audit);
      case "REVIEW":
        return this.eligibilityReview(input, ruleRefs, audit);
      case "INVESTIGATE":
        return this.eligibilityInvestigate(input, ruleRefs, audit);
      case "REDUCE_EXPOSURE":
        return this.eligibilityConsequential(input, ruleRefs, audit);
      case "INCREASE_EXPOSURE":
        return this.eligibilityConsequential(input, ruleRefs, audit);
      case "REBALANCE":
        return this.eligibilityRebalance(input, ruleRefs, audit);
      default:
        return {
          eligible: false,
          ruleIds: [],
          reasonCode: "UNKNOWN_TYPE",
        };
    }
  }

  // C-201: MONITOR — snapshot present AND Direction ≠ UNKNOWN.
  private eligibilityMonitor(
    input: P5PolicyEvaluationInput,
    ruleRefs: string[],
    audit: P5EvaluationAuditEntry[],
  ): P5EligibilityResult {
    const snapshotPresent = input.status === "OK" || input.status === "DEGRADED";
    const directionUsable = input.direction !== "UNKNOWN";

    if (snapshotPresent && directionUsable) {
      ruleRefs.push(P5_V1_RULE_IDS.C201);
      return { eligible: true, ruleIds: [P5_V1_RULE_IDS.C201], reasonCode: null };
    }

    ruleRefs.push(P5_V1_RULE_IDS.C201);
    audit.push({
      ruleId: P5_V1_RULE_IDS.C201,
      layer: "eligibility",
      action: "INELIGIBLE",
      detail: `MONITOR: snapshot=${snapshotPresent}, direction=${input.direction} (UNKNOWN=${!directionUsable})`,
    });
    return {
      eligible: false,
      ruleIds: [P5_V1_RULE_IDS.C201],
      reasonCode: !snapshotPresent ? "SNAPSHOT_UNAVAILABLE" : "DIRECTION_UNKNOWN",
    };
  }

  // C-202: REVIEW — P4 snapshot present.
  private eligibilityReview(
    input: P5PolicyEvaluationInput,
    ruleRefs: string[],
    audit: P5EvaluationAuditEntry[],
  ): P5EligibilityResult {
    const snapshotPresent = input.status === "OK" || input.status === "DEGRADED";

    if (snapshotPresent) {
      ruleRefs.push(P5_V1_RULE_IDS.C202);
      return { eligible: true, ruleIds: [P5_V1_RULE_IDS.C202], reasonCode: null };
    }

    ruleRefs.push(P5_V1_RULE_IDS.C202);
    audit.push({
      ruleId: P5_V1_RULE_IDS.C202,
      layer: "eligibility",
      action: "INELIGIBLE",
      detail: `REVIEW: snapshot not present (status=${input.status})`,
    });
    return {
      eligible: false,
      ruleIds: [P5_V1_RULE_IDS.C202],
      reasonCode: "SNAPSHOT_UNAVAILABLE",
    };
  }

  // C-203: INVESTIGATE — target ref resolves (signal or degradation exists).
  private eligibilityInvestigate(
    input: P5PolicyEvaluationInput,
    ruleRefs: string[],
    audit: P5EvaluationAuditEntry[],
  ): P5EligibilityResult {
    const hasSignal = input.signalIds.length > 0;
    const hasDegradation =
      input.degradation !== null && input.degradation.length > 0;

    if (hasSignal || hasDegradation) {
      ruleRefs.push(P5_V1_RULE_IDS.C203);
      return { eligible: true, ruleIds: [P5_V1_RULE_IDS.C203], reasonCode: null };
    }

    ruleRefs.push(P5_V1_RULE_IDS.C203);
    audit.push({
      ruleId: P5_V1_RULE_IDS.C203,
      layer: "eligibility",
      action: "INELIGIBLE",
      detail: "INVESTIGATE: no signals or degradation present",
    });
    return {
      eligible: false,
      ruleIds: [P5_V1_RULE_IDS.C203],
      reasonCode: "NO_SIGNAL_OR_DEGRADATION",
    };
  }

  // C-204/C-205: REDUCE_EXPOSURE / INCREASE_EXPOSURE — snapshot usable.
  private eligibilityConsequential(
    input: P5PolicyEvaluationInput,
    ruleRefs: string[],
    audit: P5EvaluationAuditEntry[],
  ): P5EligibilityResult {
    const snapshotUsable = this.isSnapshotUsable(input);

    if (snapshotUsable) {
      const ruleId =
        input.candidate.actionType === "REDUCE_EXPOSURE"
          ? P5_V1_RULE_IDS.C204
          : P5_V1_RULE_IDS.C205;
      ruleRefs.push(ruleId);
      return { eligible: true, ruleIds: [ruleId], reasonCode: null };
    }

    const ruleId =
      input.candidate.actionType === "REDUCE_EXPOSURE"
        ? P5_V1_RULE_IDS.C204
        : P5_V1_RULE_IDS.C205;
    ruleRefs.push(ruleId);
    audit.push({
      ruleId,
      layer: "eligibility",
      action: "INELIGIBLE",
      detail: `${input.candidate.actionType}: snapshot not usable (status=${input.status})`,
    });
    return {
      eligible: false,
      ruleIds: [ruleId],
      reasonCode: "SNAPSHOT_NOT_USABLE",
    };
  }

  // C-206: REBALANCE — snapshot usable + subject set valid.
  private eligibilityRebalance(
    input: P5PolicyEvaluationInput,
    ruleRefs: string[],
    audit: P5EvaluationAuditEntry[],
  ): P5EligibilityResult {
    const snapshotUsable = this.isSnapshotUsable(input);
    const subjectValid = input.candidate.subject?.narrativeId != null;

    if (snapshotUsable && subjectValid) {
      ruleRefs.push(P5_V1_RULE_IDS.C206);
      return { eligible: true, ruleIds: [P5_V1_RULE_IDS.C206], reasonCode: null };
    }

    ruleRefs.push(P5_V1_RULE_IDS.C206);
    audit.push({
      ruleId: P5_V1_RULE_IDS.C206,
      layer: "eligibility",
      action: "INELIGIBLE",
      detail: `REBALANCE: snapshot=${snapshotUsable}, subject=${subjectValid}`,
    });
    return {
      eligible: false,
      ruleIds: [P5_V1_RULE_IDS.C206],
      reasonCode: !snapshotUsable ? "SNAPSHOT_NOT_USABLE" : "INVALID_SUBJECT",
    };
  }

  // Snapshot usability for consequential types.
  // V1: DEGRADED is treated as usable (no temporal staleness — decision 15).
  private isSnapshotUsable(input: P5PolicyEvaluationInput): boolean {
    return input.status === "OK" || input.status === "DEGRADED";
  }
}
