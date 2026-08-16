import type { P4DirectionState, P4QualitativeValue } from "../types";

/**
 * Human-language template families (P4-04 §9–§12 — frozen).
 *
 * Every sentence is reconstructible from actual evidence values: placeholders
 * are filled by the engine from resolved evidence values (never free prose).
 * No LLM, no hidden inference, no unsupported adjectives.
 *
 * These functions are pure and exported so the P4-05 UI can also render
 * per-field "why" chips; the engine itself composes them into ExplanationItems
 * (P4-04 §16).
 */

// ---------------------------------------------------------------------------
// 9.1 Direction
// ---------------------------------------------------------------------------

export function renderDirection(state: P4DirectionState, reasonOrEvidence: string): string {
  switch (state) {
    case "POSITIVE":
      return reasonOrEvidence.length > 0
        ? `Direction is positive: ${reasonOrEvidence}.`
        : "Direction is positive.";
    case "NEGATIVE":
      return reasonOrEvidence.length > 0
        ? `Direction is negative: ${reasonOrEvidence}.`
        : "Direction is negative.";
    case "MIXED":
      // Both sides are rendered explicitly via renderDirectionMixed(supporting, conflicting);
      // the single-arg form never emits literal placeholders.
      return "Direction is mixed.";
    case "NEUTRAL":
      return "Direction is neutral: evidence shows no material change.";
    case "UNKNOWN":
      return `Direction is unavailable: ${reasonOrEvidence}.`;
  }
}

export function renderDirectionMixed(supporting: string, conflicting: string): string {
  return `Direction is mixed: ${supporting} while ${conflicting}.`;
}

// ---------------------------------------------------------------------------
// 9.2 Opportunity
// ---------------------------------------------------------------------------

export function renderOpportunity(state: P4QualitativeValue, detail: string): string {
  switch (state) {
    case "HIGH":
      return detail.length > 0
        ? `Opportunity context is favorable: ${detail}.`
        : "Opportunity context is favorable.";
    case "MEDIUM":
      return detail.length > 0
        ? `Opportunity context is moderately favorable: ${detail}.`
        : "Opportunity context is moderately favorable.";
    case "LOW":
      return `Opportunity context is limited: ${detail}.`;
    case "UNKNOWN":
      return `Opportunity cannot be assessed: ${detail}.`;
  }
}

// ---------------------------------------------------------------------------
// 9.3 Risk
// ---------------------------------------------------------------------------

export function renderRisk(state: P4QualitativeValue, detail: string): string {
  switch (state) {
    case "HIGH":
      return detail.length > 0 ? `Risk is elevated: ${detail}.` : "Risk is elevated.";
    case "MEDIUM":
      return detail.length > 0 ? `Risk is moderate: ${detail}.` : "Risk is moderate.";
    case "LOW":
      return detail.length > 0 ? `Risk is low: ${detail}.` : "Risk is low.";
    case "UNKNOWN":
      return `Risk cannot be assessed: ${detail}.`;
  }
}

// ---------------------------------------------------------------------------
// 9.4 Confidence
// ---------------------------------------------------------------------------

export function renderConfidence(state: P4QualitativeValue, detail: string): string {
  switch (state) {
    case "HIGH":
      return detail.length > 0
        ? `Confidence is high: evidence is ${detail}.`
        : "Confidence is high.";
    case "MEDIUM":
      return detail.length > 0 ? `Confidence is moderate: ${detail}.` : "Confidence is moderate.";
    case "LOW":
      return detail.length > 0 ? `Confidence is limited: ${detail}.` : "Confidence is limited.";
    case "UNKNOWN":
      return `Confidence is unavailable: ${detail}.`;
  }
}

// ---------------------------------------------------------------------------
// 9.5 Actionability
// ---------------------------------------------------------------------------

export function renderActionability(state: P4QualitativeValue, detail: string): string {
  switch (state) {
    case "HIGH":
      return detail.length > 0 ? `This warrants attention: ${detail}.` : "This warrants attention.";
    case "MEDIUM":
      return detail.length > 0 ? `Worth watching: ${detail}.` : "Worth watching.";
    case "LOW":
      return "No decision-relevant change right now.";
    case "UNKNOWN":
      return `Actionability cannot be assessed: ${detail}.`;
  }
}

// ---------------------------------------------------------------------------
// §10 Signal statements (all 8)
// ---------------------------------------------------------------------------

export function renderSignalNarrativeImprovement(corroborator: string, opposingClause: string | null): string {
  const base =
    corroborator.length > 0
      ? `Narrative is improving: overall trend is improving with ${corroborator}.`
      : "Narrative is improving: overall trend is improving.";
  return opposingClause ? `${base.slice(0, -1)}, although ${opposingClause}.` : base;
}

export function renderSignalNarrativeDeterioration(corroborator: string, opposingClause: string | null): string {
  const base =
    corroborator.length > 0
      ? `Narrative is weakening: overall trend is deteriorating with ${corroborator}.`
      : "Narrative is weakening: overall trend is deteriorating.";
  return opposingClause ? `${base.slice(0, -1)}, although ${opposingClause}.` : base;
}

export function renderSignalBroadening(): string {
  return "Participation is broadening: breadth increased.";
}

export function renderSignalNarrowing(): string {
  return "Participation is narrowing: breadth declined.";
}

export function renderSignalLeadershipChange(previousSymbol: string, currentSymbol: string): string {
  return `Narrative leader changed from ${previousSymbol} to ${currentSymbol}.`;
}

export function renderSignalRegimeChange(previous: string, current: string): string {
  return `Regime moved from ${previous} to ${current}.`;
}

export function renderSignalRotationChange(previous: string, current: string, scoreDelta: string): string {
  return scoreDelta.length > 0
    ? `Rotation moved from ${previous} to ${current} (score ${scoreDelta}).`
    : `Rotation moved from ${previous} to ${current}.`;
}

export function renderSignalEvidenceConflict(supportingClause: string, conflictingClause: string): string {
  return `${supportingClause}, while ${conflictingClause}.`;
}

// ---------------------------------------------------------------------------
// §11 UNKNOWN / degraded explanations (reasons drawn from actual status)
// ---------------------------------------------------------------------------

export function renderDegradedNoValidCurrent(): string {
  return "No valid P3 intelligence artifact is available for this narrative.";
}

export function renderDegradedInsufficientHistory(): string {
  return "Direction is unavailable because historical evidence is insufficient to support the required interpretation.";
}

export function renderDegradedCriticalEvidenceMissing(fields: string): string {
  return fields.length > 0
    ? `Direction is unavailable because critical evidence (${fields}) is unavailable.`
    : "Direction is unavailable because critical evidence is unavailable.";
}

export function renderDegradedInvalid(field: string): string {
  return `Interpretation is unavailable because ${field} evidence is INVALID.`;
}

export function renderDegradedAmbiguous(field: string): string {
  return `Interpretation is unavailable because ${field} evidence is AMBIGUOUS.`;
}

export function renderDegradedIdentityAmbiguous(): string {
  return "Interpretation is unavailable because evidence identity is ambiguous.";
}

export function renderDegradedStaleConfidence(): string {
  return "Confidence is limited because required evidence is stale.";
}

export function renderDegradedP2Unavailable(): string {
  return "Event-risk evidence is unavailable; structural narrative evidence remains available.";
}

export function renderCaveatSingleArtifact(): string {
  return "Only one same-identity artifact is available.";
}

// ---------------------------------------------------------------------------
// §8 Contextual evidence (historical divergence / stability)
// ---------------------------------------------------------------------------

export function renderContextPositiveVsDeterioratingTrend(): string {
  return "Current conditions are positive, although historical trend remains deteriorating.";
}

export function renderContextNegativeVsImprovingTrend(): string {
  return "Current conditions are negative, although historical trend has been improving.";
}

export function renderContextStableTrend(): string {
  return "Historical trend is stable.";
}

// ---------------------------------------------------------------------------
// §12 P2 Event Risk (scope preserved)
// ---------------------------------------------------------------------------

export function renderP2CoinLocal(symbol: string): string {
  return `A high event-risk signal affects one tracked constituent (${symbol}).`;
}

export function renderP2MultiCoin(count: number): string {
  return `High event-risk signals affect ${count} tracked constituents.`;
}

export function renderP2NarrativeWide(): string {
  return "A narrative-wide event-risk signal is active.";
}

// ---------------------------------------------------------------------------
// Banned language (P4-04 §15) — enforced by tests, never generated by templates
// ---------------------------------------------------------------------------

export const BANNED_PHRASES = [
  "likely to pump",
  "will rise",
  "guaranteed",
  "safe trade",
  "buy now",
  "sell now",
  "strong investment",
  "high return",
  "probability of profit",
] as const;
