import type {
  P4DegradationReason,
  P4DirectionState,
  P4EvidenceReference,
  P4FiredSignal,
  P4QualitativeValue,
} from "../types";

/**
 * P4-06 — Historical Decision Validation dataset contract (P4-06A spec).
 *
 * Replay-record types only. These types describe HOW the frozen P4-03 v1
 * interpretation is replayed over persisted historical P3 artifacts; they
 * introduce no interpretation, no scoring, no outcome semantics of their own.
 *
 * Provenance rule (P4-06A §4): every field in a replay record either is an
 * OBSERVATION (what P3 persisted), an INTERPRETATION (what P4 v1 concluded),
 * an OUTCOME (narrative-state evolution derived ONLY from persisted artifacts
 * at or after the evaluation horizon), or HUMAN REVIEW (never stored here).
 * Nothing is inferred from unavailable data.
 */

/** Canonical replay identity (P4-06A §2): a replay never mixes identities. */
export interface ReplayIdentity {
  narrativeId: number;
  window: string;
  algorithmKey: string;
  algorithmVersion: string;
  calculationMode: string;
}

export type ReplayStatus = "VALID" | "DEGRADED" | "UNAVAILABLE";

/** Conflict classification derived from the fired EVIDENCE_CONFLICT signal. */
export interface ReplayConflict {
  fired: boolean;
  /** Core-split materiality (P4-05A-REVIEW C1) — severity !== "low". */
  material: boolean;
  severity: "low" | "medium" | "high" | null;
}

/**
 * One replayed interpretation of a historical snapshot (P4-06A §3/§4-B).
 *
 * INTERPRETATION fields: status, direction, signals, opportunity, risk,
 * confidence, actionability, conflict, degradation, evidence (the references
 * are themselves observations of persisted rows with P4 roles attached).
 * OBSERVATION fields: identity, windowEnd, artifactId, precedingArtifactIds.
 */
export interface ReplayRecord {
  identity: ReplayIdentity;
  /** Replay evaluation point (window end, ISO UTC). */
  windowEnd: string;
  /** Current artifact (persisted `p3_narrative_intelligence` row id). */
  artifactId: number;
  /** Preceding same-identity artifacts in the replay series (excludes current). */
  precedingArtifactIds: number[];
  /** P4 semantic version tuple at replay time (frozen v1). */
  semanticVersion: string;
  interpretationRuleVersion: string;
  explanationVersion: string;
  status: ReplayStatus;
  direction: P4DirectionState;
  signals: P4FiredSignal[];
  opportunity: P4QualitativeValue;
  risk: P4QualitativeValue;
  confidence: P4QualitativeValue;
  actionability: P4QualitativeValue;
  conflict: ReplayConflict | null;
  degradation: P4DegradationReason[];
  evidence: P4EvidenceReference[];
  /** P2 scope present in the replay window's evidence (P4-03 §10). */
  p2Scope: "narrative-wide" | "multi-coin" | "coin-local" | "none";
  /**
   * Metadata-only read-time derivation timestamp. Excluded from semantic
   * equality/determinism assertions (P4-04-DOC §5).
   */
  generatedAt: string;
}

/**
 * Outcome-label catalog (P4-06A §5) — narrative-state evolution ONLY.
 *
 * Per P4-06A §5, P4 Opportunity is NOT a return prediction and P4 Risk is NOT
 * loss probability. No price-return labels are defined. Every outcome is
 * derived from persisted P3 fields of artifacts at or after the evaluation
 * horizon, using the frozen P3-14/P3-18 epsilon classification for
 * descriptive state comparison only (never a P4 threshold).
 */
export type OutcomeLabelId =
  | "trend_overall_evolution"
  | "regime_evolution"
  | "rotation_evolution"
  | "breadth_evolution"
  | "momentum_evolution"
  | "relative_strength_evolution"
  | "leadership_persistence";

export type OutcomeRelation =
  | "CONTINUATION"
  | "REVERSAL"
  | "CHANGE"
  | "PERSISTENCE"
  | "NOT_APPLICABLE";

export interface OutcomeLabel {
  id: OutcomeLabelId;
  /** P4 v1 qualitative value at the replay window (the interpretation). */
  interpretation: string;
  /** Persisted narrative state at the evaluation horizon (the observation). */
  observation: string;
  /** Descriptive relation between interpretation and observation. */
  relation: OutcomeRelation;
  /** Persisted artifact ids spanning the evaluation horizon (inclusive). */
  sourceArtifactIds: number[];
  /** Number of subsequent windows evaluated. */
  horizonWindows: number;
}
