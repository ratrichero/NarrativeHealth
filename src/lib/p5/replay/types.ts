/**
 * P5-07-IMPL — Replay Validation types.
 *
 * Implements the FROZEN P5-07 replay contract (P5-07 R2):
 *   - `decisionId` is the canonical replay anchor (RP-001); replay never
 *     starts from a narrative identity or current P4 state;
 *   - historical artifacts over live state — replay never consults current
 *     P4 / policy / guardrail / approval state (RP-002, §3.1); live data may
 *     appear only as labeled LIVE_CONTEXT diagnostics (§11.3), never truth;
 *   - exact reference resolution, never "latest/current/active" (RP-003);
 *   - replay ≠ re-execution: zero side effects, not a retry (RP-006);
 *   - missing artifacts → explicit classification + REPLAY_UNAVAILABLE,
 *     never NO_ACTION / current value / guessed value (RP-007, §11);
 *   - contradictions → CONTRADICTION / UNRESOLVED, no latest-wins, no
 *     scoring, evidence preserved (RP-010, §12);
 *   - equivalence: EXACT / SEMANTIC / NON_EQUIVALENT, no fuzzy matching
 *     (RP-011, §13);
 *   - replay results live in the replay-validation namespace (REPLAY_* /
 *     CONTRADICTION) and are never DecisionOutcome / ActionType (RP-016);
 *   - replay failure ⇒ REPLAY_UNAVAILABLE, never a decision outcome
 *     (RP-015);
 *   - contentHash stays PROVISIONAL (P5-02 AD-014) — hash checks run only
 *     when a hash is actually recorded (RP-009, §6).
 *
 * READ-ONLY and side-effect-free by contract (§8). No write or mutation
 * method exists anywhere in this module.
 */

import type {
  P4ViewModelStatus,
  P5ApprovalState,
  P5AuditEvent,
  P5DecisionOutcome,
  P5DecisionRecord,
  P5DecisionState,
  P5ExecutionState,
  P5GuardrailOutcome,
  P5P4SnapshotRef,
  P5PermissionResult,
} from "../types";

// ---------------------------------------------------------------------------
// Historical artifacts (P5-07 §21.2 Artifact Reference Matrix).
// ---------------------------------------------------------------------------

/** P5-02 AD-014 — stored P4 snapshot artifact (contentHash PROVISIONAL). */
export interface P5HistoricalSnapshot {
  narrativeIdentity: P5P4SnapshotRef["narrativeIdentity"];
  asOf: string;
  versionTuple: P5P4SnapshotRef["versionTuple"];
  status: P4ViewModelStatus;
  contentHash: string | null;
}

/** P5-03 — stored policy artifact (exact identity + version). */
export interface P5HistoricalPolicy {
  policyId: string | null;
  policyVersion: string | null;
  effectiveAt: string | null;
  evaluationAt: string | null;
  ruleRefs: string[];
}

/** P5-04 §8 — stored guardrail artifact (exact identity + version). */
export interface P5HistoricalGuardrail {
  guardrailId: string;
  version: string | null;
  outcome: P5GuardrailOutcome;
  evaluatedAt: string | null;
}

/** P5-04 §13 — stored approval artifact (explicit authorization event, SG-005). */
export interface P5HistoricalApproval {
  approvalId: string;
  decisionIdRef: string | null;
  state: P5ApprovalState;
  authorityRef: string | null;
  actor: string | null;
  timestamp: string | null;
  approvalPolicyVersion: string | null;
}

/** P5-04 SG-011 — stored permission artifact (authorization result, never "executed"). */
export interface P5HistoricalPermission {
  ref: string;
  result: P5PermissionResult;
  evaluatedAt: string | null;
}

// ---------------------------------------------------------------------------
// Resolution + findings (P5-07 §5, §6, §11, §16).
// ---------------------------------------------------------------------------

/** P5-07 §5/§6/§11 — artifact resolution outcomes; never collapsed into a generic "not found". */
export type P5ArtifactResolution =
  | "FOUND"
  | "MISSING"
  | "VERSION_MISMATCH"
  | "HASH_MISMATCH"
  | "UNAVAILABLE"
  | "CONTRADICTION";

/** P5-07 §6 P4 snapshot states — identity + version + asOf alignment; hash checked only when recorded. */
export type P5SnapshotState =
  | "SNAPSHOT_MATCH"
  | "SNAPSHOT_MISSING"
  | "SNAPSHOT_VERSION_MISMATCH"
  | "SNAPSHOT_HASH_MISMATCH"
  | "SNAPSHOT_UNAVAILABLE";

/** P5-07 §9 replay modes — a replay request declares its mode explicitly. */
export type P5ReplayMode = "RECONSTRUCT" | "VALIDATE" | "COMPARE";

/** P5-07 Appendix B — replay completion results (replay-validation namespace, never DecisionOutcome). */
export type P5ReplayResult = "REPLAY_COMPLETE" | "REPLAY_PARTIAL" | "REPLAY_UNAVAILABLE" | "CONTRADICTION";

/** P5-07 §13 replay equivalence — no fuzzy matching anywhere. */
export type P5ReplayEquivalence = "EXACT" | "SEMANTIC" | "NON_EQUIVALENT";

/** Replay dimensions referenced by the reconstruction / validation layers. */
export type P5ReplayDimension =
  | "decision"
  | "p4Snapshot"
  | "policy"
  | "guardrail"
  | "approval"
  | "permission"
  | "chronology"
  | "contradiction";

/** P5-07 §11.1 / §16 — finding classifications (artifact + chronology + unresolved). */
export type P5ReplayFindingType =
  | "ARTIFACT_MISSING"
  | "ARTIFACT_UNAVAILABLE"
  | "ARTIFACT_VERSION_MISMATCH"
  | "ARTIFACT_HASH_MISMATCH"
  | "ARTIFACT_CONTRADICTION"
  | "UNRESOLVED"
  | "CHRONOLOGY_DUPLICATE"
  | "CHRONOLOGY_GAP"
  | "CHRONOLOGY_ORDER";

/** A single validation finding — exact reference, never an opaque "not found". */
export interface P5ReplayFinding {
  findingId: string;
  dimension: P5ReplayDimension;
  type: P5ReplayFindingType;
  ref: string | null;
  detail: string | null;
  /** true only when the finding carries a labeled LIVE_CONTEXT diagnostic (§11.3) — never reconstructed truth. */
  liveContext: boolean;
}

/** P5-07 §5/§6/§21.2 — result of resolving one historical reference by exact identity + version. */
export interface P5ArtifactResolutionResult<T> {
  dimension: P5ReplayDimension;
  resolution: P5ArtifactResolution;
  artifact: T | null;
  requestedRef: string | null;
  requestedVersion: string | null;
  snapshotState: P5SnapshotState | null;
  liveContext: boolean;
  detail: string | null;
}

// ---------------------------------------------------------------------------
// Replay report (P5-07 Appendix A).
// ---------------------------------------------------------------------------

/** P5-07 Appendix A — a replay report (conceptual contract implemented here). */
export interface P5ReplayReport {
  replayContractVersion: string;
  mode: P5ReplayMode;
  decisionId: string;
  /** Replay-validation result (RP-016) — never a DecisionOutcome / ActionType. */
  result: P5ReplayResult;
  reconstruction: {
    decision: P5DecisionRecord | null;
    outcome: P5DecisionOutcome | null;
    suppressed: boolean | null;
    /** P5-02 AD-009 orthogonal state dimensions — never collapsed into one status. */
    orthogonalStates: {
      decisionState: P5DecisionState | null;
      approvalState: P5ApprovalState | null;
      executionState: P5ExecutionState | null;
    };
    identityChain: { candidateId: string | null; actionId: string | null };
    snapshot: { state: P5SnapshotState | null; ref: P5P4SnapshotRef | null };
    references: {
      policy: P5ArtifactResolutionResult<P5HistoricalPolicy> | null;
      guardrail: P5ArtifactResolutionResult<P5HistoricalGuardrail> | null;
      approval: P5ArtifactResolutionResult<P5HistoricalApproval> | null;
      permission: P5ArtifactResolutionResult<P5HistoricalPermission> | null;
    };
    auditEvents: P5AuditEvent[];
  };
  validation: {
    perArtifact: P5ArtifactResolutionResult<unknown>[];
    findings: P5ReplayFinding[];
    /** P5-07 §14 — the per-dimension version tuple actually used (no universal version). */
    versionTupleUsed: Record<string, string | null>;
  };
  equivalence: P5ReplayEquivalence | "REPLAY_UNAVAILABLE";
  /** P5-07 §8 invariant — replay creates no side effects. */
  sideEffects: "NONE";
}
