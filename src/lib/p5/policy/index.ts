/**
 * P5-03-RT — Policy Evaluation Runtime v1.
 *
 * Barrel export. The evaluator is the only public entry point.
 */

export { P5PolicyEvaluator } from "./evaluator";
export type { P5EvaluationAuditEntry } from "./rules";
export type {
  P5ActionCandidate,
  P5EligibilityResult,
  P5PolicyBlockerReport,
  P5PolicyEvaluationInput,
  P5PolicyEvaluationResult,
  P5PolicyIdentity,
  P5PolicySnapshotRef,
  P5SuppressionResult,
} from "./types";
export {
  P5_V1_ACTION_TYPES,
  P5_V1_POLICY_ID,
  P5_V1_POLICY_VERSION,
  P5_V1_REASON_CODES,
  P5_V1_RULE_IDS,
} from "./rules";
