/**
 * P5-06C — Decision Presentation Model.
 *
 * PURE PRESENTATION TRANSFORMATION — no decision logic, no evaluation,
 * no scoring, no recommendation engine. This module transforms already-
 * frozen P5 decision data into user-facing natural language.
 *
 * Every text value is deterministically derived from the existing
 * P5ActionDecisionReadViewModel fields. No LLM, no external data,
 * no live P4 query.
 *
 * Anti-semantic-drift gates:
 *  - Does NOT change outcome
 *  - Does NOT change actionType
 *  - Does NOT create new scores / thresholds / rankings
 *  - Does NOT create a second recommendation engine
 *  - Does NOT query live P4 for historical decisions
 *  - Does NOT modify frozen P5-03/04/05/10/11
 */

import type {
  P5ActionDecisionReadViewModel,
  P5ActionType,
  P5DecisionOutcome,
  P5DecisionSummary,
  P5DisplayState,
  P5ReadAvailability,
} from "../types";

// ---------------------------------------------------------------------------
// Executive Decision Summary — "What does the system think?"
// ---------------------------------------------------------------------------

export interface P5ExecutiveSummary {
  /** The action type label (MONITOR / REVIEW / etc.) — only when SELECTED. */
  posture: string | null;
  /** One-sentence summary of what the system decided. */
  headline: string;
  /** Why this decision was made — plain-language. */
  rationale: string;
  /** What the user should do next — plain-language. */
  guidance: string;
}

// ---------------------------------------------------------------------------
// Plain-language WHY
// ---------------------------------------------------------------------------

export interface P5PlainWhy {
  /** Structured facts that led to the decision. */
  facts: Array<{ label: string; value: string }>;
  /** What did NOT happen and why. */
  alternatives: string[];
}

// ---------------------------------------------------------------------------
// Confidence Guidance
// ---------------------------------------------------------------------------

export interface P5ConfidenceGuidance {
  /** The raw confidence level from P4 (if available from provenance). */
  level: string | null;
  /** Plain-language explanation of what this confidence means. */
  meaning: string;
}

// ---------------------------------------------------------------------------
// Decision History Entry
// ---------------------------------------------------------------------------

export interface P5DecisionHistoryEntry {
  /** The action type or outcome label. */
  label: string;
  /** Human-readable date. */
  date: string;
  /** Is this the current (most recent) decision? */
  isCurrent: boolean;
}

// ---------------------------------------------------------------------------
// Full Presentation Model
// ---------------------------------------------------------------------------

export interface P5DecisionPresentationModel {
  /** Executive summary — the most prominent section. */
  executive: P5ExecutiveSummary;
  /** Plain-language explanation of why. */
  why: P5PlainWhy | null;
  /** Confidence guidance for the user. */
  confidence: P5ConfidenceGuidance;
  /** Decision history (may be empty). */
  history: P5DecisionHistoryEntry[];
  /** Display state for badge rendering. */
  displayState: P5DisplayState;
  /** Availability status. */
  availability: P5ReadAvailability;
  /** Whether a decision record exists. */
  hasDecision: boolean;
  /** Technical details — collapsed by default. */
  technical: {
    decisionId: string | null;
    candidateId: string | null;
    actionId: string | null;
    outcome: P5DecisionOutcome | null;
    actionType: P5ActionType | null;
    suppressed: boolean;
    blockerReport: { source: string; reason: string | null } | null;
    safetyAggregate: string | null;
    approvalState: string | null;
    permissionResult: string | null;
    executionState: string | null;
    policyVersion: string | null;
    ruleRefs: string[];
    auditEvents: Array<{ eventType: string; timestamp: string; actor: string | null }>;
    provenance: unknown;
  };
}

// ---------------------------------------------------------------------------
// Action type → user-facing posture
// ---------------------------------------------------------------------------

const ACTION_TYPE_POSTURE: Record<string, string> = {
  MONITOR: "MONITOR",
  REVIEW: "REVIEW",
  INVESTIGATE: "INVESTIGATE",
  REDUCE_EXPOSURE: "REDUCE EXPOSURE",
  INCREASE_EXPOSURE: "INCREASE EXPOSURE",
  REBALANCE: "REBALANCE",
};

// ---------------------------------------------------------------------------
// Action type → user-facing guidance
// ---------------------------------------------------------------------------

const ACTION_TYPE_GUIDANCE: Record<string, string> = {
  MONITOR:
    "Continue monitoring this narrative. No stronger action is recommended by the current decision system.",
  REVIEW:
    "Review the available evidence for this narrative. The system has identified patterns that warrant closer examination.",
  INVESTIGATE:
    "Investigate this narrative further. The system has detected signals that require deeper analysis.",
  REDUCE_EXPOSURE:
    "Consider reducing exposure to assets in this narrative. The system has identified risk factors.",
  INCREASE_EXPOSURE:
    "Consider increasing exposure to assets in this narrative. The system has identified opportunity factors.",
  REBALANCE:
    "Consider rebalancing positions within this narrative. The system has identified allocation opportunities.",
};

// ---------------------------------------------------------------------------
// Outcome → user-facing headline
// ---------------------------------------------------------------------------

function outcomeHeadline(outcome: P5DecisionOutcome, actionType: string | null): string {
  switch (outcome) {
    case "SELECTED":
      return actionType
        ? `The system recommends ${actionType.toLowerCase()} for this narrative.`
        : "The system has selected an action for this narrative.";
    case "NO_ACTION":
      return "No action is recommended for this narrative at this time.";
    case "NOT_DETERMINED":
      return "The system could not determine a clear recommendation for this narrative.";
    case "BLOCKED":
      return "A policy rule prevented an action from being selected for this narrative.";
    default:
      return "Decision status is unknown.";
  }
}

// ---------------------------------------------------------------------------
// Outcome → user-facing rationale
// ---------------------------------------------------------------------------

function outcomeRationale(view: P5ActionDecisionReadViewModel): string {
  const decision = view.decision;
  if (!decision) {
    return "No decision record is available for this narrative.";
  }

  const p4Status = view.context?.p4SnapshotRef?.status;
  const direction = view.context?.p4SnapshotRef?.status;

  switch (decision.outcome) {
    case "SELECTED": {
      const parts: string[] = [];
      if (p4Status === "OK") {
        parts.push("The current data snapshot is available and valid");
      } else if (p4Status === "DEGRADED") {
        parts.push("The data snapshot is partially available (degraded)");
      }
      if (decision.explanation.why) {
        parts.push(decision.explanation.why);
      }
      return parts.length > 0
        ? parts.join(". ") + "."
        : `The policy system selected ${decision.actionType ?? "an action"} based on available evidence.`;
    }
    case "NO_ACTION":
      return "The policy system evaluated the available evidence and determined that no action is warranted at this time.";
    case "NOT_DETERMINED": {
      const parts: string[] = [];
      if (p4Status === "ERROR") {
        parts.push("The data layer is unavailable");
      } else if (p4Status === "NO_EVIDENCE") {
        parts.push("Required evidence is not available");
      } else if (p4Status === "DEGRADED") {
        parts.push("The data is partially available but insufficient for a clear determination");
      } else {
        parts.push("The available evidence is insufficient for a reliable determination");
      }
      return parts.join(". ") + ". The system chose not to make a recommendation rather than guess.";
    }
    case "BLOCKED":
      return decision.blockerReport?.reason
        ? `A policy rule blocked the action: ${decision.blockerReport.reason}.`
        : "A policy rule prevented an action from being selected.";
    default:
      return "Decision status is being evaluated.";
  }
}

// ---------------------------------------------------------------------------
// Plain-language WHY facts
// ---------------------------------------------------------------------------

function buildPlainWhy(view: P5ActionDecisionReadViewModel): P5PlainWhy | null {
  const decision = view.decision;
  if (!decision) return null;

  const facts: Array<{ label: string; value: string }> = [];

  // P4 snapshot status
  const p4Status = view.context?.p4SnapshotRef?.status;
  if (p4Status) {
    const statusText =
      p4Status === "OK"
        ? "Available and valid"
        : p4Status === "DEGRADED"
          ? "Partially available"
          : p4Status === "NO_EVIDENCE"
            ? "Not available"
            : p4Status === "ERROR"
              ? "Error state"
              : p4Status;
    facts.push({ label: "Data snapshot", value: statusText });
  }

  // Outcome
  const outcomeText =
    decision.outcome === "SELECTED"
      ? "Action selected"
      : decision.outcome === "NO_ACTION"
        ? "No action needed"
        : decision.outcome === "NOT_DETERMINED"
          ? "Could not determine"
          : decision.outcome === "BLOCKED"
            ? "Blocked by policy"
            : decision.outcome;
  facts.push({ label: "Decision outcome", value: outcomeText });

  // Action type (only when SELECTED)
  if (decision.outcome === "SELECTED" && decision.actionType) {
    facts.push({ label: "Recommended action", value: ACTION_TYPE_POSTURE[decision.actionType] ?? decision.actionType });
  }

  // Safety
  if (decision.safetyResult) {
    const safetyText =
      decision.safetyResult.aggregate === "PASS"
        ? "Safety checks passed"
        : decision.safetyResult.aggregate === "BLOCK"
          ? "Safety constraints not met"
          : `Safety: ${decision.safetyResult.aggregate}`;
    facts.push({ label: "Safety evaluation", value: safetyText });
  }

  // Approval
  if (decision.approvalState) {
    const approvalText =
      decision.approvalState === "NOT_REQUIRED"
        ? "No approval required (advisory mode)"
        : decision.approvalState === "APPROVED"
          ? "Approved"
          : decision.approvalState === "DENIED"
            ? "Approval denied"
            : `Approval: ${decision.approvalState}`;
    facts.push({ label: "Approval status", value: approvalText });
  }

  // Suppressed
  if (decision.suppressed) {
    facts.push({ label: "Suppression", value: "Decision was suppressed (cooldown or duplicate)" });
  }

  // Blocker
  if (decision.blockerReport) {
    facts.push({
      label: "Blocker",
      value: `${decision.blockerReport.source}${decision.blockerReport.reason ? `: ${decision.blockerReport.reason}` : ""}`,
    });
  }

  // Alternatives
  const alternatives = decision.explanation.whatDidNotHappen ?? [];

  return { facts, alternatives };
}

// ---------------------------------------------------------------------------
// Confidence guidance
// ---------------------------------------------------------------------------

function buildConfidenceGuidance(view: P5ActionDecisionReadViewModel): P5ConfidenceGuidance {
  const decision = view.decision;
  const p4Status = view.context?.p4SnapshotRef?.status;

  // Derive confidence from P4 status + decision outcome
  let level: string | null = null;
  let meaning: string;

  if (!decision) {
    meaning = "No decision has been made, so there is no confidence level to assess.";
  } else if (decision.outcome === "NOT_DETERMINED") {
    level = "LOW";
    meaning =
      "The system could not reach a confident determination. This usually means the available data is insufficient, conflicting, or unavailable.";
  } else if (decision.outcome === "NO_ACTION") {
    level = "MEDIUM";
    meaning =
      "The system evaluated the evidence and determined no action is needed. This is a confident negative — the system checked and found nothing requiring action.";
  } else if (decision.outcome === "SELECTED") {
    if (p4Status === "DEGRADED") {
      level = "MEDIUM";
      meaning =
        "The system selected an action based on partially available evidence. The recommendation may change as more data becomes available.";
    } else if (p4Status === "OK") {
      level = "HIGH";
      meaning =
        "The system selected an action based on available and valid evidence. This is a confident positive recommendation.";
    } else {
      level = "MEDIUM";
      meaning = "The system selected an action, but the data quality affects confidence.";
    }
  } else if (decision.outcome === "BLOCKED") {
    level = "HIGH";
    meaning = "A policy rule blocked the action with high confidence. The block is definitive.";
  } else {
    meaning = "Confidence level cannot be determined from available data.";
  }

  return { level, meaning };
}

// ---------------------------------------------------------------------------
// Technical details (collapsed section)
// ---------------------------------------------------------------------------

function buildTechnicalDetails(view: P5ActionDecisionReadViewModel) {
  const decision = view.decision;
  return {
    decisionId: decision?.decisionId ?? null,
    candidateId: decision?.candidateId ?? null,
    actionId: decision?.actionId ?? null,
    outcome: decision?.outcome ?? null,
    actionType: decision?.actionType ?? null,
    suppressed: decision?.suppressed ?? false,
    blockerReport: decision?.blockerReport
      ? { source: decision.blockerReport.source, reason: decision.blockerReport.reason }
      : null,
    safetyAggregate: decision?.safetyResult?.aggregate ?? null,
    approvalState: decision?.approvalState ?? null,
    permissionResult: decision?.permissionResult ?? null,
    executionState: decision?.executionState ?? null,
    policyVersion: decision?.provenance?.policy?.policyVersion ?? null,
    ruleRefs: decision?.provenance?.policy?.ruleRefs ?? [],
    auditEvents: (decision?.auditEvents ?? []).map((e) => ({
      eventType: e.eventType,
      timestamp: e.timestamp,
      actor: e.actor,
    })),
    provenance: decision?.provenance ?? null,
  };
}

// ---------------------------------------------------------------------------
// Main transformation
// ---------------------------------------------------------------------------

/**
 * Transform a P5ActionDecisionReadViewModel into a user-facing presentation model.
 *
 * This is a PURE FUNCTION — same input always produces same output.
 * No side effects, no external calls, no evaluation logic.
 */
export function buildPresentationModel(
  view: P5ActionDecisionReadViewModel,
  history: Array<{ actionType: string | null; outcome: string; recordedAt: string | null }> = [],
): P5DecisionPresentationModel {
  const decision = view.decision;
  const hasDecision = view.decisionPresence === "PRESENT" && decision !== null;

  // Executive summary
  const executive: P5ExecutiveSummary = (() => {
    if (!hasDecision) {
      return {
        posture: null,
        headline: "No decision has been made for this narrative yet.",
        rationale: view.availability === "NO_DECISION_RECORD"
          ? "The system has not yet evaluated this narrative. A decision will be created when the narrative is first processed."
          : view.availability === "P4_CONTEXT_UNAVAILABLE"
            ? "The system could not evaluate this narrative because the underlying data is unavailable."
            : "No decision record is available.",
        guidance: "Wait for the system to process this narrative, or check that data sources are available.",
      };
    }

    const posture = decision.outcome === "SELECTED" && decision.actionType
      ? ACTION_TYPE_POSTURE[decision.actionType] ?? decision.actionType
      : null;

    return {
      posture,
      headline: outcomeHeadline(decision.outcome, decision.actionType),
      rationale: outcomeRationale(view),
      guidance: decision.outcome === "SELECTED" && decision.actionType
        ? ACTION_TYPE_GUIDANCE[decision.actionType] ?? "Review the decision details."
        : decision.outcome === "NO_ACTION"
          ? "No action is needed at this time. The system will re-evaluate on the next data refresh."
          : decision.outcome === "NOT_DETERMINED"
            ? "The system cannot make a recommendation right now. Wait for more data or check data source availability."
            : decision.outcome === "BLOCKED"
              ? "A policy rule prevents action. Review the policy configuration if you believe this is incorrect."
              : "Review the decision details for more information.",
    };
  })();

  // Plain WHY
  const why = hasDecision ? buildPlainWhy(view) : null;

  // Confidence
  const confidence = buildConfidenceGuidance(view);

  // History
  const historyEntries: P5DecisionHistoryEntry[] = history.map((h, i) => ({
    label: h.outcome === "SELECTED" ? (ACTION_TYPE_POSTURE[h.actionType ?? ""] ?? h.actionType ?? h.outcome) : h.outcome,
    date: h.recordedAt
      ? new Date(h.recordedAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
      : "Unknown date",
    isCurrent: i === 0,
  }));

  return {
    executive,
    why,
    confidence,
    history: historyEntries,
    displayState: view.displayState,
    availability: view.availability,
    hasDecision,
    technical: buildTechnicalDetails(view),
  };
}
