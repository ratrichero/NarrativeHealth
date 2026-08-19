/**
 * P5-04-RT — Safety / Approval / Permission Runtime v1.
 *
 * Barrel export. The evaluator is the only public entry point.
 */

export { P5SafetyEvaluator } from "./evaluator";
export type { P5SafetyAuditEntry } from "./types";
export type {
  P5SafetyApprovalRecord,
  P5SafetyEvaluationInput,
  P5SafetyEvaluationResult,
  P5SafetyProvenance,
} from "./types";
export {
  P5_V1_ADVISORY_TYPES,
  P5_V1_APPROVAL_MODEL_VERSION,
  P5_V1_AUTOMATION_MODE,
  P5_V1_CONSEQUENTIAL_TYPES,
  P5_V1_GUARDRAIL_MODEL_VERSION,
} from "./types";
