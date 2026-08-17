import type { P5ActionDecisionReadViewModel, P5DisplayState } from "../types";

/**
 * Derive the presentation classification for a P5 read view (P5-06C).
 *
 * This is a PRESENTATION-ONLY summary. It never replaces the orthogonal
 * decisionState / approvalState / executionState fields (P5-02 AD-009) and
 * it never claims a domain outcome that is not recorded. Precedence
 * (first match wins):
 *
 *   1. SERVICE_ERROR / P4_CONTEXT_UNAVAILABLE  → UNAVAILABLE
 *   2. decision record absent                  → ABSENT
 *   3. P5-03 layer result SUPPRESSED           → SUPPRESSED
 *   4. recorded outcome NO_ACTION              → NO_ACTION
 *   5. recorded outcome NOT_DETERMINED         → NOT_DETERMINED
 *   6. recorded outcome BLOCKED                → POLICY_BLOCKED
 *      (the BLOCKED decision outcome is policy-origin by construction,
 *       P5-03 PD-018; SAFETY/APPROVAL are downstream results, not outcomes)
 *   7. SELECTED + safety aggregate BLOCK       → SAFETY_BLOCKED
 *   8. SELECTED + approvalState DENIED         → APPROVAL_DENIED
 *   9. SELECTED                                → SELECTED
 *
 * NO_ACTION is returned ONLY for a recorded NO_ACTION outcome — never for
 * absence, unavailability, failure, suppression, or any blocked state
 * (P5-06 §5, §10). No UNKNOWN → NO_ACTION, DEGRADED → NO_ACTION,
 * FAILURE → NO_ACTION, BLOCKED → NO_ACTION, or SUPPRESSED → NO_ACTION
 * mapping exists here.
 */
export function deriveDisplayState(view: P5ActionDecisionReadViewModel): P5DisplayState {
  if (view.availability === "SERVICE_ERROR" || view.availability === "P4_CONTEXT_UNAVAILABLE") {
    return "UNAVAILABLE";
  }

  if (view.decisionPresence === "ABSENT" || view.decision === null) {
    return "ABSENT";
  }

  const decision = view.decision;

  if (decision.suppressed) {
    return "SUPPRESSED";
  }

  switch (decision.outcome) {
    case "NO_ACTION":
      return "NO_ACTION";
    case "NOT_DETERMINED":
      return "NOT_DETERMINED";
    case "BLOCKED":
      // The BLOCKED decision outcome carries blockerReport.source = POLICY
      // (P5-03 PD-018). SAFETY-BLOCKED / APPROVAL-DENIED are downstream
      // P5-04 results that follow a DECIDED (SELECTED) action — they are
      // handled below, not here.
      return "POLICY_BLOCKED";
    case "SELECTED":
      if (decision.safetyResult?.aggregate === "BLOCK") {
        return "SAFETY_BLOCKED";
      }
      if (decision.approvalState === "DENIED") {
        return "APPROVAL_DENIED";
      }
      return "SELECTED";
  }
}
