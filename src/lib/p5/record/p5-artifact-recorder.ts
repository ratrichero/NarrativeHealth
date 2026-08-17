/**
 * P5-09 — producer-side historical artifact recording.
 *
 * Connects a runtime P5 decision (produced upstream by P5-03/04/05 engines)
 * to the FROZEN P5-08 persistence layer. This is the single recording
 * integration point: a producer hands this recorder the decision record it
 * already produced; the recorder derives the P5-07 historical artifacts and
 * persists them through the existing `PgHistoricalArtifactWriter`.
 *
 * Hard boundaries (P5-09):
 *  - RECORDING ONLY — this service never creates a decision, evaluates
 *    policy, runs safety, grants approval/permission, or executes anything.
 *    It records facts that already exist in the runtime decision record.
 *  - NO FABRICATION (P5-09 §4): every artifact is derived 1:1 from the
 *    record's own fields (provenance / approvalRecord / safetyResult /
 *    auditEvents). If a fact is genuinely absent (e.g. no approval record),
 *    no row is written — absence is preserved and replay reports it
 *    explicitly (ARTIFACT_MISSING / REPLAY_UNAVAILABLE). Missing information
 *    is NEVER converted into NO_ACTION / DENIED / NOT_GRANTED / FAILED /
 *    EXECUTED.
 *  - PERMISSION GAP (P5-08 §10, P5-07-IMPL §11): the frozen decision record
 *    model has no permission-artifact reference, so a permission artifact is
 *    NEVER derived. It is recorded only when the producer supplies one
 *    explicitly (`P5ArtifactRecordingBatch.permission`).
 *  - IDEMPOTENT (P5-09 §7): repeated recording of the same decision is safe —
 *    the writer's unique `identity_key` + onConflictDoNothing ignores
 *    duplicates and the first recorded artifact remains authoritative.
 *  - EXACT IDENTITY/VERSION (P5-09 §8): derived artifacts carry the exact
 *    identity/version/asOf from the record; the current/live P4, policy,
 *    guardrail, approval or configuration state is never consulted.
 *  - contentHash stays PROVISIONAL (P5-02 AD-014): never computed; the
 *    snapshot artifact carries `contentHash: null` as recorded.
 *
 * Transaction boundary (P5-09 §6): the existing writer is per-artifact
 * idempotent insert; there is no multi-artifact transaction on the frozen
 * `P5RowStore` port. This recorder therefore performs a best-effort batch in
 * dependency order — auxiliary artifacts first, then the decision row (the
 * replay anchor), then audit events — and returns a per-artifact summary.
 * A mid-batch failure never produces a misleading *complete* record: replay
 * classifies any partial state explicitly (missing artifact →
 * REPLAY_UNAVAILABLE). Full multi-artifact atomicity would require a
 * transaction-capable store port and is documented as a limitation rather
 * than invented here. The writer's idempotency is internal (unique
 * `identity_key` + onConflictDoNothing), so this recorder reports write
 * success per artifact; duplicate safety is verified at the store level.
 */

import type {
  P5AuditEvent,
  P5DecisionRecord,
} from "../types";
import type { HistoricalArtifactWriter } from "../replay/pg-artifact-store";
import type {
  P5HistoricalApproval,
  P5HistoricalGuardrail,
  P5HistoricalPermission,
  P5HistoricalPolicy,
  P5HistoricalSnapshot,
} from "../replay/types";

// ---------------------------------------------------------------------------
// Recording contract
// ---------------------------------------------------------------------------

/** The batch a producer submits — the decision record it already produced. */
export interface P5ArtifactRecordingBatch {
  decision: P5DecisionRecord;
  /**
   * Optional producer-supplied permission artifact (P5-08 §10 gap: the record
   * model has no permission ref, so this is never derived). Omit it when the
   * producer has no permission artifact — absence is preserved.
   */
  permission?: P5HistoricalPermission;
}

export type P5RecordingStatus = "RECORDED" | "NOT_RECORDED";

export interface P5RecordingItem {
  artifact:
    | "decision"
    | "snapshot"
    | "policy"
    | "guardrail"
    | "approval"
    | "permission"
    | "auditEvent";
  /** Exact artifact identity (decisionId / snapshot identity key / policyId@version / …). */
  identity: string;
  status: P5RecordingStatus;
  /** Present only for NOT_RECORDED — why no row was written (missing identity, never a domain outcome). */
  reason: string | null;
}

export interface P5RecordingResult {
  decisionId: string;
  items: P5RecordingItem[];
  /** true iff every artifact the recorder attempted to persist was written successfully. */
  complete: boolean;
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

/**
 * Derives P5-07 historical artifacts from a runtime P5 decision record and
 * persists them through the frozen `HistoricalArtifactWriter`. Read-only with
 * respect to decision semantics: the input record is never mutated.
 */
export class P5ArtifactRecorder {
  constructor(private readonly writer: HistoricalArtifactWriter) {}

  /** Derive the snapshot artifact from the record's own p4SnapshotRef (never live P4). */
  static deriveSnapshot(record: P5DecisionRecord): P5HistoricalSnapshot | null {
    const ref = record.provenance.p4SnapshotRef;
    if (!ref) return null;
    return {
      narrativeIdentity: { ...ref.narrativeIdentity },
      asOf: ref.asOf,
      versionTuple: { ...ref.versionTuple },
      status: ref.status,
      // PROVISIONAL (P5-02 AD-014) — recorded as null, never computed.
      contentHash: ref.contentHash ?? null,
    };
  }

  /** Derive the policy artifact from the record's own policy provenance (1:1). */
  static derivePolicy(record: P5DecisionRecord): P5HistoricalPolicy | null {
    const p = record.provenance.policy;
    if (!p.policyId || !p.policyVersion) return null;
    return {
      policyId: p.policyId,
      policyVersion: p.policyVersion,
      effectiveAt: p.effectiveAt,
      evaluationAt: p.evaluationAt,
      ruleRefs: [...p.ruleRefs],
    };
  }

  /** Derive guardrail artifacts from the record's own safety result (never re-evaluated). */
  static deriveGuardrails(record: P5DecisionRecord): P5HistoricalGuardrail[] {
    const results = record.safetyResult?.guardrailResults ?? [];
    return results
      .filter((g) => g.guardrailId !== null && g.guardrailId !== undefined)
      .map((g) => ({
        guardrailId: g.guardrailId,
        version: g.version,
        outcome: g.outcome,
        evaluatedAt: g.evaluatedAt,
      }));
  }

  /** Derive the approval artifact from the record's own approval record (1:1). */
  static deriveApproval(record: P5DecisionRecord): P5HistoricalApproval | null {
    const a = record.approvalRecord;
    if (!a) return null;
    return {
      approvalId: a.approvalId,
      decisionIdRef: a.decisionIdRef,
      state: a.state,
      authorityRef: a.authorityRef,
      actor: a.actor,
      timestamp: a.timestamp,
      approvalPolicyVersion: a.approvalPolicyVersion,
    };
  }

  /**
   * Record the batch. Order: auxiliary artifacts → decision row (anchor) →
   * audit events, so a mid-batch failure never leaves a decision row
   * silently missing its referenced artifacts (replay classifies the gap).
   */
  async record(batch: P5ArtifactRecordingBatch): Promise<P5RecordingResult> {
    const { decision } = batch;
    const items: P5RecordingItem[] = [];

    // --- auxiliary artifacts (dependency order) -----------------------------

    const snapshot = P5ArtifactRecorder.deriveSnapshot(decision);
    if (snapshot) {
      await this.writer.insertSnapshot(snapshot);
      items.push({
        artifact: "snapshot",
        identity: `${snapshot.narrativeIdentity.narrativeId}:${snapshot.narrativeIdentity.window}:${snapshot.versionTuple.semanticVersion}:${snapshot.asOf}`,
        status: "RECORDED",
        reason: null,
      });
    }

    const policy = P5ArtifactRecorder.derivePolicy(decision);
    if (policy) {
      await this.writer.insertPolicy(policy);
      items.push({
        artifact: "policy",
        identity: `${policy.policyId}@${policy.policyVersion}`,
        status: "RECORDED",
        reason: null,
      });
    } else if (decision.provenance.policy.policyId || decision.provenance.policy.policyVersion) {
      // Partial identity present but not exact → NOT_RECORDED (exact-reference rule).
      items.push({
        artifact: "policy",
        identity: `${decision.provenance.policy.policyId ?? ""}@${decision.provenance.policy.policyVersion ?? ""}`,
        status: "NOT_RECORDED",
        reason: "policy identity is incomplete (policyId and policyVersion both required)",
      });
    }

    const guardrails = P5ArtifactRecorder.deriveGuardrails(decision);
    for (const g of guardrails) {
      await this.writer.insertGuardrail(g);
      items.push({
        artifact: "guardrail",
        identity: `${g.guardrailId}@${g.version ?? ""}`,
        status: "RECORDED",
        reason: null,
      });
    }

    const approval = P5ArtifactRecorder.deriveApproval(decision);
    if (approval) {
      await this.writer.insertApproval(approval);
      items.push({
        artifact: "approval",
        identity: approval.approvalId,
        status: "RECORDED",
        reason: null,
      });
    }

    // Permission is NEVER derived (record-model gap) — only producer-supplied.
    if (batch.permission) {
      await this.writer.insertPermission(batch.permission);
      items.push({
        artifact: "permission",
        identity: batch.permission.ref,
        status: "RECORDED",
        reason: null,
      });
    }

    // --- decision row (replay anchor) ----------------------------------------

    await this.writer.insertDecision(decision);
    items.push({
      artifact: "decision",
      identity: decision.decisionId,
      status: "RECORDED",
      reason: null,
    });

    // --- audit events (append-only, unique eventId; duplicates ignored) ------

    for (const event of decision.auditEvents) {
      await this.writer.insertAuditEvent(event);
      items.push({
        artifact: "auditEvent",
        identity: event.eventId,
        status: "RECORDED",
        reason: null,
      });
    }

    return {
      decisionId: decision.decisionId,
      items,
      complete: items.every((i) => i.status !== "NOT_RECORDED"),
    };
  }
}

/** Convenience: derive a full audit-event list (1:1 from the record). */
export function deriveAuditEvents(record: P5DecisionRecord): P5AuditEvent[] {
  return [...record.auditEvents];
}
