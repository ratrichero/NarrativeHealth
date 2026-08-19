/**
 * P5-04-RT — Deterministic Safety / Approval / Permission Evaluator v1.
 *
 * Frozen contract source:
 *  - P5-04 §5–§11 Safety / Guardrail Model
 *  - P5-04 §13–§14 Approval Model
 *  - P5-04 §19 Execution Permission
 *  - P5-04 §38 Matrices
 *  - Owner-approved SG-010: V1 = ADVISORY-ONLY
 *
 * Evaluation order (per P5-04 §39 Core Flow):
 *   1. Applicability (advisory vs consequential)
 *   2. Safety (guardrail evaluation)
 *   3. Approval
 *   4. Permission
 *   5. Result assembly
 *
 * Hard boundaries (P5-04-RT §4):
 *  - PURE, DETERMINISTIC: same input = same result.
 *  - NO DB access, NO replay, NO persistence writes.
 *  - NO policy evaluation, NO explanation generation, NO execution.
 *  - NO new audit event types.
 *  - NO legacy P1 rule reuse, NO scores, NO thresholds, NO BUY/SELL.
 *  - Timestamps are metadata only; no Date.now() in conditions.
 *
 * V1 behavior:
 *  - ADVISORY-ONLY (SG-010)
 *  - Empty guardrail set → safety PASS
 *  - Approval: NOT_REQUIRED for all actions
 *  - Permission: NOT_APPLICABLE (advisory), NOT_GRANTED (consequential)
 */

import type {
  P5ActionType,
  P5BlockerReport,
  P5GuardrailResult,
  P5PermissionResult,
  P5SafetyAggregate,
} from "../types";
import type { P5PolicyEvaluationResult } from "../policy/types";
import type {
  P5SafetyApprovalRecord,
  P5SafetyAuditEntry,
  P5SafetyEvaluationInput,
  P5SafetyEvaluationResult,
  P5SafetyProvenance,
} from "./types";
import {
  P5_V1_ADVISORY_TYPES,
  P5_V1_APPROVAL_MODEL_VERSION,
  P5_V1_AUTOMATION_MODE,
  P5_V1_CONSEQUENTIAL_TYPES,
  P5_V1_GUARDRAIL_MODEL_VERSION,
} from "./types";

// ---------------------------------------------------------------------------
// Helper: create metadata timestamp (metadata only, never affects outcomes)
// ---------------------------------------------------------------------------

function metadataTimestamp(): string {
  return "evaluated";
}

// ---------------------------------------------------------------------------
// Helper: classify action type
// ---------------------------------------------------------------------------

function classifyAction(actionType: P5ActionType): "ADVISORY" | "CONSEQUENTIAL" {
  if ((P5_V1_CONSEQUENTIAL_TYPES as readonly string[]).includes(actionType)) {
    return "CONSEQUENTIAL";
  }
  return "ADVISORY";
}

// ---------------------------------------------------------------------------
// Helper: create safety provenance
// ---------------------------------------------------------------------------

function buildSafetyProvenance(
  policyResult: P5PolicyEvaluationResult,
): P5SafetyProvenance {
  return {
    policyProvenance: { ...policyResult.provenance },
    guardrailModelVersion: P5_V1_GUARDRAIL_MODEL_VERSION,
    guardrailVersions: [],
    approvalModelVersion: P5_V1_APPROVAL_MODEL_VERSION,
    automationMode: P5_V1_AUTOMATION_MODE,
    evaluatedAt: metadataTimestamp(),
  };
}

// ---------------------------------------------------------------------------
// Main evaluator
// ---------------------------------------------------------------------------

export class P5SafetyEvaluator {
  /**
   * Evaluate safety / approval / permission for a P5-03 policy result.
   *
   * Deterministic: same input = same result.
   * V1 ADVISORY-ONLY (SG-010):
   *  - Advisory: PASS, NOT_REQUIRED, NOT_APPLICABLE
   *  - Consequential: PASS, NOT_REQUIRED, NOT_GRANTED
   */
  evaluate(input: P5SafetyEvaluationInput): P5SafetyEvaluationResult {
    const audit: P5SafetyAuditEntry[] = [];
    const { policyResult } = input;

    // ------------------------------------------------------------------
    // Step 1: Applicability — classify action type (P5-04 §8)
    // ------------------------------------------------------------------
    const actionType = policyResult.selectedCandidate?.actionType;
    const actionClass = actionType ? classifyAction(actionType) : "ADVISORY";

    audit.push({
      ruleId: "APPLICABILITY",
      layer: "applicability",
      action: "CLASSIFY",
      detail: `ActionType "${actionType ?? "NONE"}" classified as ${actionClass}`,
    });

    // ------------------------------------------------------------------
    // Step 2: Safety evaluation (P5-04 §11)
    // V1: empty guardrail set → always PASS
    // ------------------------------------------------------------------
    const guardrailResults: P5GuardrailResult[] = [];
    let safetyOutcome: P5SafetyAggregate = "PASS";

    audit.push({
      ruleId: "SAFETY",
      layer: "safety",
      action: "PASS",
      detail: `V1 empty guardrail set — no violations to detect`,
    });

    // ------------------------------------------------------------------
    // Step 3: Approval evaluation (P5-04 §13–§14)
    // V1: always NOT_REQUIRED (SG-010)
    // ------------------------------------------------------------------
    const approvalState: P5SafetyApprovalRecord["state"] = "NOT_REQUIRED";
    const approvalRecord: P5SafetyApprovalRecord | null = null;

    audit.push({
      ruleId: "APPROVAL",
      layer: "approval",
      action: "NOT_REQUIRED",
      detail: `V1 ADVISORY-ONLY — no approval required`,
    });

    // ------------------------------------------------------------------
    // Step 4: Permission evaluation (P5-04 §19)
    // V1: advisory → NOT_APPLICABLE, consequential → NOT_GRANTED (SG-010)
    // ------------------------------------------------------------------
    let permissionState: P5PermissionResult;

    if (actionClass === "CONSEQUENTIAL") {
      permissionState = "NOT_GRANTED";
      audit.push({
        ruleId: "PERMISSION",
        layer: "permission",
        action: "NOT_GRANTED",
        detail: `Consequential action — V1 ADVISORY-ONLY (SG-010)`,
      });
    } else {
      permissionState = "NOT_APPLICABLE";
      audit.push({
        ruleId: "PERMISSION",
        layer: "permission",
        action: "NOT_APPLICABLE",
        detail: `Advisory action — no execution permission semantics`,
      });
    }

    // ------------------------------------------------------------------
    // Step 5: Blocker report
    // V1: no BLOCK → no blocker report
    // ------------------------------------------------------------------
    const blockerReport: P5BlockerReport | null = null;

    // ------------------------------------------------------------------
    // Step 6: Assemble result
    // ------------------------------------------------------------------
    return {
      safetyOutcome,
      guardrailResults,
      approvalState,
      approvalRecord,
      permissionState,
      blockerReport,
      provenance: buildSafetyProvenance(policyResult),
      audit,
      actionClass,
      policyOutcome: policyResult.outcome,
    };
  }
}
