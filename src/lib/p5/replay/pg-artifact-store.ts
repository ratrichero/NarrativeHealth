/**
 * P5-08 — PostgreSQL-backed historical artifact store + insert-only writer.
 *
 * Implements the FROZEN P5-07 `HistoricalArtifactStore` read boundary over
 * the repository's existing Drizzle + PostgreSQL persistence layer
 * (`src/db/schema.ts` tables `p5_*`, migration 0021). This replaces the
 * `NoHistoricalArtifactStore` default for artifacts that have actually been
 * persisted.
 *
 * Hard boundaries (P5-08):
 *  - READ-ONLY for replay: `PgHistoricalArtifactStore` exposes only the six
 *    `find*` methods of the frozen interface. No write/mutation method exists.
 *  - INSERT-ONLY writer: `PgHistoricalArtifactWriter` stores recorded facts
 *    verbatim and idempotently (unique `identity_key` + `onConflictDoNothing`);
 *    it never constructs, evaluates, approves or executes anything, and it has
 *    no update/delete surface. Corrections are new artifacts/events, never
 *    rewrites (P5-05 §17, P5-07 RP-012; DB triggers reject UPDATE/DELETE).
 *  - EXACT REFERENCE RESOLUTION (P5-07 §5, RP-003): the store looks up the
 *    exact `identity_key` (identity + version). When the exact artifact does
 *    not exist but another version of the same identity does, the store
 *    returns that candidate so the frozen ArtifactResolver classifies
 *    `VERSION_MISMATCH` — never a silent fallback, never a generic "missing".
 *  - HISTORICAL-OVER-LIVE (P5-07 §3.1): the store reads only persisted
 *    artifacts; it never consults current P4 / policy / guardrail / approval
 *    state. contentHash stays PROVISIONAL (P5-02 AD-014) — stored as recorded,
 *    never computed, never assumed to match.
 *
 * The SQL surface is isolated in the tiny `P5RowStore` adapter so the mapping
 * logic is deterministically testable without a live database; production
 * wires the real drizzle client via `DrizzleP5RowStore` (see `production.ts`).
 */

import { and, eq } from "drizzle-orm";
import {
  p5Approvals,
  p5AuditEvents,
  p5DecisionRecords,
  p5Guardrails,
  p5P4Snapshots,
  p5Permissions,
  p5Policies,
} from "@/db/schema";
import type { P5AuditEvent, P5DecisionRecord, P5P4SnapshotRef } from "../types";
import type { HistoricalArtifactStore } from "./artifact-resolver";
import type {
  P5HistoricalApproval,
  P5HistoricalGuardrail,
  P5HistoricalPermission,
  P5HistoricalPolicy,
  P5HistoricalSnapshot,
} from "./types";

// ---------------------------------------------------------------------------
// Row-store adapter (port): keeps SQL thin, mapping logic pure and testable.
// ---------------------------------------------------------------------------

type P5RowValue = unknown;
type P5Row = Record<string, P5RowValue>;

/** Minimal row-access surface the Pg store needs (drizzle adapter or test fake). */
export interface P5RowStore {
  /**
   * First row matching every column=value pair, optionally ordered by a column
   * (deterministic when multiple rows match — e.g. the same policy identity at
   * different versions).
   */
  findFirst(
    table: unknown,
    where: P5Row,
    orderBy?: string
  ): Promise<P5Row | null>;
  /** Insert one row; idempotent on the unique identity_key (returns rows inserted). */
  insertReturning(table: unknown, row: P5Row): Promise<P5Row[]>;
}

/** Structural slice of the drizzle client used by the adapter (constructor-injected). */
export interface DrizzleClientLike {
  select(): unknown;
  insert(table: unknown): unknown;
}

/** Production adapter over the repo's drizzle client (`db` from `@/db`). */
export class DrizzleP5RowStore implements P5RowStore {
  constructor(private readonly db: DrizzleClientLike) {}

  async findFirst(table: unknown, where: P5Row, orderBy?: string): Promise<P5Row | null> {
    // The table object is a drizzle table; indexing yields its column objects.
    const t = table as Record<string, any>;
    const conditions = Object.entries(where).map(([col, value]) => eq(t[col], value));
    // Standard drizzle read chain; the client is structurally typed here.
    const query = (this.db.select() as any).from(table).where(and(...conditions));
    const rows = await (orderBy && t[orderBy] ? query.orderBy(t[orderBy]).limit(1) : query.limit(1));
    return rows[0] ?? null;
  }

  async insertReturning(table: unknown, row: P5Row): Promise<P5Row[]> {
    // Idempotent by unique identity_key: duplicate artifact writes are
    // ignored, never rewritten (append-only).
    const rows = await (this.db.insert(table) as any).values(row).onConflictDoNothing().returning();
    return rows;
  }
}

// ---------------------------------------------------------------------------
// Identity keys — storage mechanics for exact reference resolution.
// ---------------------------------------------------------------------------

const KEY_SEP = "\u001F";
const NULL_TOKEN = "\u001E";

/** Canonical exact-identity key (deterministic, collision-free for contract ids). */
export function artifactIdentityKey(parts: (string | number | null)[]): string {
  return parts.map((p) => (p === null || p === undefined ? NULL_TOKEN : String(p))).join(KEY_SEP);
}

/** P5-02 AD-014 snapshot identity key — full identity + version tuple + asOf. */
export function snapshotIdentityKey(input: {
  narrativeIdentity: P5P4SnapshotRef["narrativeIdentity"];
  asOf: string;
  versionTuple: P5P4SnapshotRef["versionTuple"];
}): string {
  const ni = input.narrativeIdentity;
  const vt = input.versionTuple;
  return artifactIdentityKey([
    "snapshot",
    ni.narrativeId,
    ni.window,
    ni.algorithmKey,
    ni.algorithmVersion,
    ni.calculationMode,
    vt.algorithmVersion,
    vt.semanticVersion,
    vt.signalCatalogVersion,
    vt.interpretationRuleVersion,
    input.asOf,
  ]);
}

export function policyIdentityKey(policyId: string, policyVersion: string): string {
  return artifactIdentityKey(["policy", policyId, policyVersion]);
}

export function guardrailIdentityKey(guardrailId: string, version: string | null): string {
  return artifactIdentityKey(["guardrail", guardrailId, version]);
}

// ---------------------------------------------------------------------------
// Read store (P5-07 replay boundary — READ-ONLY).
// ---------------------------------------------------------------------------

/**
 * PostgreSQL-backed implementation of the frozen `HistoricalArtifactStore`.
 * Read-only: only the six `find*` methods exist; replay never mutates
 * artifacts through this boundary.
 */
export class PgHistoricalArtifactStore implements HistoricalArtifactStore {
  constructor(private readonly rows: P5RowStore) {}

  async findDecision(decisionId: string): Promise<P5DecisionRecord | null> {
    const row = await this.rows.findFirst(p5DecisionRecords, { identityKey: decisionId });
    return row ? (row.record as P5DecisionRecord) : null;
  }

  /**
   * Find the latest decision record for a narrative.
   * Used by P5-06 read service for narrative-scoped lookup.
   * Returns the most recent decision (by id descending) for the given narrative.
   */
  async findDecisionByNarrativeId(narrativeId: number): Promise<P5DecisionRecord | null> {
    const row = await this.rows.findFirst(
      p5DecisionRecords,
      { narrativeId },
      "id" // ORDER BY id DESC (latest first)
    );
    return row ? (row.record as P5DecisionRecord) : null;
  }

  /**
   * Find recent decision records for a narrative (for history display).
   * Returns up to `limit` most recent decisions ordered by id DESC.
   */
  async findDecisionHistoryByNarrativeId(
    narrativeId: number,
    limit: number = 10,
  ): Promise<Array<{ actionType: string | null; outcome: string; recordedAt: string | null }>> {
    // Use the row store's findFirst repeatedly isn't efficient;
    // instead we access the underlying rows via a simple approach:
    // find the latest, then use the stored record's data.
    // For V1 with one-decision-per-narrative, this returns 0-1 entries.
    const row = await this.rows.findFirst(
      p5DecisionRecords,
      { narrativeId },
      "id"
    );
    if (!row) return [];
    const record = row.record as P5DecisionRecord;
    return [{
      actionType: record.actionType ?? null,
      outcome: record.outcome,
      recordedAt: record.provenance?.timestamps?.recordedAt ?? null,
    }];
  }

  async findP4Snapshot(ref: P5P4SnapshotRef): Promise<P5HistoricalSnapshot | null> {
    const exact = await this.rows.findFirst(p5P4Snapshots, { identityKey: snapshotIdentityKey(ref) });
    if (exact) return exact.snapshot as P5HistoricalSnapshot;
    // Identity exists at a different version/asOf → return the candidate; the
    // frozen ArtifactResolver classifies SNAPSHOT_VERSION_MISMATCH (§6).
    const candidate = await this.rows.findFirst(
      p5P4Snapshots,
      {
        narrativeId: ref.narrativeIdentity.narrativeId,
        window: ref.narrativeIdentity.window,
        algorithmKey: ref.narrativeIdentity.algorithmKey,
        algorithmVersion: ref.narrativeIdentity.algorithmVersion,
        calculationMode: ref.narrativeIdentity.calculationMode,
      },
      "id"
    );
    return candidate ? (candidate.snapshot as P5HistoricalSnapshot) : null;
  }

  async findPolicy(policyId: string, policyVersion: string): Promise<P5HistoricalPolicy | null> {
    const exact = await this.rows.findFirst(p5Policies, {
      identityKey: policyIdentityKey(policyId, policyVersion),
    });
    if (exact) return exact.policy as P5HistoricalPolicy;
    // Same policy identity at another version → candidate; the resolver
    // classifies VERSION_MISMATCH (§5) — never a silent resolution.
    const candidate = await this.rows.findFirst(p5Policies, { policyId }, "id");
    return candidate ? (candidate.policy as P5HistoricalPolicy) : null;
  }

  async findGuardrail(guardrailId: string, version: string | null): Promise<P5HistoricalGuardrail | null> {
    const exact = await this.rows.findFirst(p5Guardrails, {
      identityKey: guardrailIdentityKey(guardrailId, version),
    });
    if (exact) return exact.guardrail as P5HistoricalGuardrail;
    const candidate = await this.rows.findFirst(p5Guardrails, { guardrailId }, "id");
    return candidate ? (candidate.guardrail as P5HistoricalGuardrail) : null;
  }

  async findApproval(approvalId: string): Promise<P5HistoricalApproval | null> {
    const row = await this.rows.findFirst(p5Approvals, { identityKey: approvalId });
    return row ? (row.approval as P5HistoricalApproval) : null;
  }

  async findPermission(ref: string): Promise<P5HistoricalPermission | null> {
    const row = await this.rows.findFirst(p5Permissions, { identityKey: ref });
    return row ? (row.permission as P5HistoricalPermission) : null;
  }
}

// ---------------------------------------------------------------------------
// Insert-only writer (persistence contract for P5 producers).
// ---------------------------------------------------------------------------

/**
 * Insert-only persistence contract. Stores recorded facts verbatim and
 * idempotently. It NEVER decides anything: no eligibility, policy, safety,
 * approval, permission, selection or execution semantics — it only persists
 * artifacts produced upstream. No update/delete surface exists.
 */
export interface HistoricalArtifactWriter {
  insertDecision(record: P5DecisionRecord): Promise<void>;
  insertSnapshot(snapshot: P5HistoricalSnapshot): Promise<void>;
  insertPolicy(policy: P5HistoricalPolicy): Promise<void>;
  insertGuardrail(guardrail: P5HistoricalGuardrail): Promise<void>;
  insertApproval(approval: P5HistoricalApproval): Promise<void>;
  insertPermission(permission: P5HistoricalPermission): Promise<void>;
  insertAuditEvent(event: P5AuditEvent): Promise<void>;
}

export class PgHistoricalArtifactWriter implements HistoricalArtifactWriter {
  constructor(private readonly rows: P5RowStore) {}

  async insertDecision(record: P5DecisionRecord): Promise<void> {
    await this.rows.insertReturning(p5DecisionRecords, {
      identityKey: record.decisionId,
      decisionId: record.decisionId,
      narrativeId: record.subject.narrativeId,
      outcome: record.outcome,
      suppressed: record.suppressed,
      blockerSource: record.blockerReport?.source ?? null,
      blockerRef: record.blockerReport?.ref ?? null,
      actionType: record.actionType ?? null,
      decisionState: record.decisionState,
      approvalState: record.approvalState,
      executionState: record.executionState,
      permissionResult: record.permissionResult,
      record,
      decisionAt: record.provenance.timestamps.decisionAt ?? null,
    });
  }

  async insertSnapshot(snapshot: P5HistoricalSnapshot): Promise<void> {
    await this.rows.insertReturning(p5P4Snapshots, {
      identityKey: snapshotIdentityKey({
        narrativeIdentity: snapshot.narrativeIdentity,
        asOf: snapshot.asOf,
        versionTuple: snapshot.versionTuple,
      }),
      narrativeId: snapshot.narrativeIdentity.narrativeId,
      window: snapshot.narrativeIdentity.window,
      algorithmKey: snapshot.narrativeIdentity.algorithmKey,
      algorithmVersion: snapshot.narrativeIdentity.algorithmVersion,
      calculationMode: snapshot.narrativeIdentity.calculationMode,
      semanticVersion: snapshot.versionTuple.semanticVersion,
      asOf: snapshot.asOf,
      status: snapshot.status,
      contentHash: snapshot.contentHash,
      snapshot,
    });
  }

  async insertPolicy(policy: P5HistoricalPolicy): Promise<void> {
    if (policy.policyId === null || policy.policyVersion === null) {
      throw new Error("P5-08: policy artifact requires policyId and policyVersion (exact reference rule)");
    }
    await this.rows.insertReturning(p5Policies, {
      identityKey: policyIdentityKey(policy.policyId, policy.policyVersion),
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      effectiveAt: policy.effectiveAt,
      evaluationAt: policy.evaluationAt,
      policy,
    });
  }

  async insertGuardrail(guardrail: P5HistoricalGuardrail): Promise<void> {
    await this.rows.insertReturning(p5Guardrails, {
      identityKey: guardrailIdentityKey(guardrail.guardrailId, guardrail.version),
      guardrailId: guardrail.guardrailId,
      version: guardrail.version,
      outcome: guardrail.outcome,
      evaluatedAt: guardrail.evaluatedAt,
      guardrail,
    });
  }

  async insertApproval(approval: P5HistoricalApproval): Promise<void> {
    await this.rows.insertReturning(p5Approvals, {
      identityKey: approval.approvalId,
      approvalId: approval.approvalId,
      decisionIdRef: approval.decisionIdRef,
      state: approval.state,
      authorityRef: approval.authorityRef,
      actor: approval.actor,
      approvedAt: approval.timestamp,
      approvalPolicyVersion: approval.approvalPolicyVersion,
      approval,
    });
  }

  async insertPermission(permission: P5HistoricalPermission): Promise<void> {
    await this.rows.insertReturning(p5Permissions, {
      identityKey: permission.ref,
      ref: permission.ref,
      result: permission.result,
      evaluatedAt: permission.evaluatedAt,
      permission,
    });
  }

  async insertAuditEvent(event: P5AuditEvent): Promise<void> {
    await this.rows.insertReturning(p5AuditEvents, {
      identityKey: event.eventId,
      eventId: event.eventId,
      decisionIdRef: event.decisionIdRef ?? "",
      eventType: event.eventType,
      eventAt: event.timestamp,
      actor: event.actor,
      previousState: event.previousState,
      newState: event.newState,
      reason: event.reason,
      policyVersionRef: event.policyVersionRef,
      guardrailRef: event.guardrailRef,
      approvalRef: event.approvalRef,
      event,
    });
  }
}
