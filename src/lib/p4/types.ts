import type { P3TrendState } from "@/lib/types/p3-intelligence-history";

/**
 * P4 — Decision Support domain types (P4-04-IMPL).
 *
 * Frozen contracts consumed from:
 * - P4-02 §5 EvidenceReference (reused verbatim — NOT redefined here).
 * - P4-03 §2 evidence normalization states + §3 signal catalog + §18 versioning.
 * - P4-04 §3 ExplanationItem + §21 versioning.
 *
 * These are read-model/contract types only. Nothing in this module imports the
 * P3 kernel (`@/lib/p3/*`); `P3TrendState` is imported from the frontend-safe
 * P3-18 read-model type (frozen trend contract), never from a calculation
 * module.
 */

// ---------------------------------------------------------------------------
// Versioning (P4-04 §21 / P4-03 §18 — frozen)
// ---------------------------------------------------------------------------

export const P4_EXPLANATION_VERSION = "1";
export const P4_ALGORITHM_VERSION = "p4-decision-support";
export const P4_SEMANTIC_VERSION = "1";
export const P4_INTERPRETATION_RULE_VERSION = "p4-03/v1";

// ---------------------------------------------------------------------------
// Core P4 semantic values (P4-02 §7/§8/§10/§11 — frozen)
// ---------------------------------------------------------------------------

export type P4DirectionState =
  | "POSITIVE"
  | "NEGATIVE"
  | "MIXED"
  | "NEUTRAL"
  | "UNKNOWN";

export type P4QualitativeValue = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";

export type P4SignalId =
  | "NARRATIVE_IMPROVEMENT"
  | "NARRATIVE_DETERIORATION"
  | "BROADENING"
  | "NARROWING"
  | "LEADERSHIP_CHANGE"
  | "REGIME_CHANGE"
  | "ROTATION_CHANGE"
  | "EVIDENCE_CONFLICT";

// ---------------------------------------------------------------------------
// EvidenceReference (P4-02 §5 — reused verbatim, NOT redefined)
// ---------------------------------------------------------------------------

export type P4SourceLayer = "P3" | "P2" | "P4";

export type P4InterpretationRole =
  | "primary"
  | "secondary"
  | "contextual"
  | "conflicting";

/**
 * Semantic evidence states — the P4-03 §2.1 normalization layer (frozen).
 * `UNAVAILABLE` is the P4 semantic state for a P3 `MISSING` stage.
 */
export type P4EvidenceStatus =
  | "VALID"
  | "PARTIAL"
  | "INVALID"
  | "STALE"
  | "AMBIGUOUS"
  | "UNAVAILABLE"
  | "INSUFFICIENT_HISTORY"
  | "NOT_APPLICABLE";

export interface P4EvidenceReference {
  sourceLayer: P4SourceLayer;
  sourceType: string;
  /** Persisted row id (P3 artifact id / P2 event id / P4 derived id). */
  sourceId: string;
  /** P3 artifact identity (narrative|algorithm|version|mode|window); null for P2/P4 refs. */
  artifactIdentity: string | null;
  narrativeIdentity: string;
  windowOrDate: string;
  /** Persisted/read-model field or derived move, e.g. "momentumMove", "trend.overall". */
  field: string;
  status: P4EvidenceStatus;
  interpretationRole: P4InterpretationRole;
}

// ---------------------------------------------------------------------------
// Human-readable value resolution (P4-04 §8 / Alternative B)
// ---------------------------------------------------------------------------
//
// `humanValue` was NOT added to EvidenceReference (P4-MASTER §25 decision).
// Display values are resolved OUTSIDE the reference, from the existing P3
// read-model display fields (e.g. `deltaDisplay`, `scoreDisplay`, persisted
// classifications). The P4-05 read path supplies these values; the engine
// never formats numbers itself.

export interface P4EventScope {
  kind: "coin-local" | "multi-coin" | "narrative-wide";
  /** Constituent symbols (coin-local: [symbol]; multi-coin: ≥2). */
  symbols?: string[];
  /** P2 qualitative risk level (P2 semantics — not P4 thresholds). */
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export interface P4EvidenceValue {
  /** Full readable clause usable in a sentence, e.g. "Momentum is deteriorating". */
  clause: string;
  /** Compact phrase for corroborator slots, e.g. "deteriorating momentum". */
  phrase: string;
  /** Default display value, e.g. "NEUTRAL", "BLUAI", "−6.0". */
  display: string;
  /** Raw frozen delta (for the Tier-4 ordinal explanatory-value ranking); null when non-numeric. */
  numericValue?: number | null;
  /** P2 event scope — P2_EVENT_RISK references only. */
  scope?: P4EventScope;
}

// ---------------------------------------------------------------------------
// P4-03 interpretation result — the engine's input contract (P4-04 §19)
// ---------------------------------------------------------------------------
//
// The engine consumes the typed P4-03 interpretation output + its evidence
// references. It never recomputes any P4-03 decision.

export interface P4FiredSignal {
  /** Signal identity: (signalId, narrativeId, windowEnd) — P4-03 §3.11. */
  id: P4SignalId;
  narrativeId: number;
  windowEnd: string;
  /** EVIDENCE_CONFLICT materiality severity (P4-03 §9) — presentation-only. */
  severity?: "low" | "medium" | "high";
  /** Evidence identity keys that fired the signal (primary side). */
  evidenceKeys: string[];
  /** Opposing evidence identity keys (conflict side) — kept visible. */
  conflictingEvidenceKeys?: string[];
  /** Directional lean (P4-02 §3.1) — set by the P4-03 interpretation. */
  directionRelation?: P4DirectionRelation;
}

export type P4DegradationCode =
  | "NO_VALID_CURRENT"
  | "INSUFFICIENT_HISTORY"
  | "CRITICAL_EVIDENCE_MISSING"
  | "STALE"
  | "INVALID"
  | "AMBIGUOUS"
  | "IDENTITY_AMBIGUOUS"
  | "P2_UNAVAILABLE";

export interface P4DegradationReason {
  code: P4DegradationCode;
  /** Affected field (for INVALID/AMBIGUOUS templates). */
  field?: string;
}

export interface P4InterpretationContext {
  /** Frozen P3-18 overall trend (P3-14 D.1). */
  historicalTrend: P3TrendState | null;
  dataSufficiency: {
    comparableArtifacts: number;
    requiredMinimum: number;
    sufficient: boolean;
  } | null;
  /** True when P2 event risk was expected for this narrative (missing → caveat). */
  p2Expected: boolean;
}

export interface P4InterpretationResult {
  status: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
  narrativeId: number;
  windowEnd: string;
  direction: P4DirectionState;
  opportunity: P4QualitativeValue;
  risk: P4QualitativeValue;
  confidence: P4QualitativeValue;
  actionability: P4QualitativeValue;
  /** Fired signals (P4-03 §3) — the engine only explains fired signals. */
  signals: P4FiredSignal[];
  /** Evidence references the P4-03 interpretation used. */
  evidence: P4EvidenceReference[];
  /** Human-readable values keyed by evidence identity key. */
  values: Record<string, P4EvidenceValue>;
  context: P4InterpretationContext;
  /** Why a degraded/UNKNOWN interpretation exists (P4-03 §4 gates). */
  degradation: P4DegradationReason[];
  /** Evidence identity keys per P4 output (the P4-03 trace, P4-04 §5 Tier 1). */
  conclusionEvidence?: Partial<
    Record<"direction" | "opportunity" | "risk" | "confidence" | "actionability", string[]>
  >;
}

// ---------------------------------------------------------------------------
// ExplanationItem (P4-04 §3.1 — frozen)
// ---------------------------------------------------------------------------

export type P4ExplanationItemRole = "primary" | "conflicting" | "contextual" | "caveat";

export interface P4ExplanationItem {
  /** Stable item id within the explanation, e.g. "exp:direction:1". */
  id: string;
  /** Template-derived, human-readable sentence (P4-04 §9-§12). */
  statement: string;
  /** Item role in the composition (P4-04 §16). */
  role: P4ExplanationItemRole;
  /** Evidence that supports the statement (≥1 unless a structural label). */
  supportingEvidence: P4EvidenceReference[];
  /** Evidence that argues against the statement (kept visible). */
  conflictingEvidence: P4EvidenceReference[];
  /** Historical/secondary context. */
  contextualEvidence: P4EvidenceReference[];
  /** Only when justified by P4-03 conflict severity — presentation-only. */
  severity?: "low" | "medium" | "high";
  /** Artifact ids / event ids referenced. */
  sourceReferences: string[];
  semanticVersion: string;
  algorithmVersion: string;
  explanationVersion: string;
  /** Read-time derivation timestamp — metadata only, excluded from semantic equality. */
  generatedAt: string;
}

export interface P4ExplanationAttribution {
  algorithmVersion: string;
  semanticVersion: string;
  interpretationRuleVersion: string;
  explanationVersion: string;
}

export interface P4ExplanationResult {
  items: P4ExplanationItem[];
  attribution: P4ExplanationAttribution;
  /** Metadata-only read-time derivation timestamp — excluded from semantic equality. */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// P4-05A — Decision Support read service domain (P4-02 §8 ViewModel contract)
// ---------------------------------------------------------------------------

/** Directional move of a metric over the latest step (P4-03 §2.3 — frozen). */
export type P4Move = "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "UNKNOWN";

/** The five interpreted moves + leadership score move (P4-03 §2.3). */
export interface P4Moves {
  regime: P4Move;
  rotationScore: P4Move;
  momentum: P4Move;
  breadth: P4Move;
  relativeStrength: P4Move;
  leadershipScore: P4Move;
}

/** Directional relation of a fired signal (P4-02 §3.1). */
export type P4DirectionRelation = P4DirectionState;

/** P4-02 §3.1 signal occurrence exposed on the ViewModel. */
export interface P4Signal {
  /** Catalog id, e.g. "NARRATIVE_DETERIORATION". */
  id: P4SignalId;
  /** Human display title (P4-04 §10). */
  label: string;
  /** Directional lean of the signal. */
  directionRelation: P4DirectionRelation;
  /** Qualitative conflict severity (EVIDENCE_CONFLICT only). */
  severity?: "low" | "medium" | "high";
  /** Evidence references that produced the signal. */
  evidenceRefs: P4EvidenceReference[];
}

/** ViewModel availability status (P4-02 §8). */
export type P4ViewModelStatus = "OK" | "DEGRADED" | "NO_EVIDENCE" | "ERROR";

/**
 * P4DecisionSupportViewModel (P4-02 §8 — read-time derived, NOT persisted).
 * `explanation` carries the P4-04 ExplanationItems + attribution (Master §16).
 */
export interface P4DecisionSupportViewModel {
  status: P4ViewModelStatus;
  version: {
    algorithmVersion: string;
    semanticVersion: string;
    signalCatalogVersion: string;
  };
  narrativeIdentity: {
    narrativeId: number;
    window: string;
    algorithmKey: string;
    algorithmVersion: string;
    calculationMode: string;
  };
  /** Read-time derivation timestamp (metadata; excluded from semantic equality). */
  generatedAt: string;
  /** Latest artifact window end (ISO UTC). */
  asOf: string;
  direction: P4DirectionState;
  signals: P4Signal[];
  opportunity: P4QualitativeValue;
  risk: P4QualitativeValue;
  confidence: P4QualitativeValue;
  actionability: P4QualitativeValue;
  explanation: P4ExplanationResult;
  evidence: P4EvidenceReference[];
  historicalContext: {
    seriesLength: number;
    steps: number;
    overallTrend: P3TrendState;
    dataSufficiency: { comparableArtifacts: number; requiredMinimum: number; sufficient: boolean };
    current: {
      artifactId: number;
      windowEnd: string;
      availabilityState: string;
    } | null;
    previous: {
      artifactId: number;
      windowEnd: string;
      availabilityState: string;
    } | null;
  } | null;
  provenance: {
    sourceLayer: "P4";
    derivedFrom: string[];
    p2EventRisk: boolean;
    semanticVersion: string;
  };
  /** Why a degraded/UNKNOWN interpretation exists (P4-03 §14). */
  degradation: P4DegradationReason[];
}
