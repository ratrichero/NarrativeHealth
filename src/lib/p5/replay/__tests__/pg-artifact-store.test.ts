import { describe, expect, it } from "@jest/globals";
import {
  ArtifactResolver,
  type HistoricalArtifactStore,
} from "../artifact-resolver";
import {
  PgHistoricalArtifactStore,
  PgHistoricalArtifactWriter,
  type P5RowStore,
} from "../pg-artifact-store";
import { p5AuditEvents, p5Policies } from "@/db/schema";
import type {
  P5HistoricalApproval,
  P5HistoricalGuardrail,
  P5HistoricalPermission,
  P5HistoricalPolicy,
  P5HistoricalSnapshot,
} from "../types";
import type { P5AuditEvent, P5DecisionRecord, P5P4SnapshotRef } from "../../types";

// ---------------------------------------------------------------------------
// P5-08 store/writer tests — exact identity+version resolution over persisted
// rows; historical-over-live; immutability/idempotency; permission boundary.
// The Pg store is exercised through an in-memory row store (the SQL surface is
// isolated in the P5RowStore adapter), so no live database is required.
// ---------------------------------------------------------------------------

/** In-memory row store implementing the same port as DrizzleP5RowStore. */
class FakeRowStore implements P5RowStore {
  private readonly tables = new Map<unknown, Record<string, unknown>[]>();

  async findFirst(
    table: unknown,
    where: Record<string, unknown>,
    orderBy?: string
  ): Promise<Record<string, unknown> | null> {
    const rows = this.tables.get(table) ?? [];
    const matched = rows.filter((r) =>
      Object.entries(where).every(([col, value]) => r[col] === value)
    );
    if (matched.length === 0) return null;
    if (orderBy) {
      matched.sort((a, b) => {
        const av = a[orderBy];
        const bv = b[orderBy];
        if (av === bv) return 0;
        return av === null || av === undefined ? -1 : bv === null || bv === undefined ? 1 : av < bv ? -1 : 1;
      });
    }
    return matched[0] ?? null;
  }

  async insertReturning(table: unknown, row: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const rows = this.tables.get(table) ?? [];
    // Unique identity_key: a duplicate exact artifact is ignored, never rewritten.
    if (rows.some((r) => r.identityKey === row.identityKey)) return [];
    rows.push(row);
    this.tables.set(table, rows);
    return [row];
  }

  snapshot(table: unknown): Record<string, unknown>[] {
    return this.tables.get(table) ?? [];
  }
}

function makeSnapshotRef(overrides: Partial<P5P4SnapshotRef> = {}): P5P4SnapshotRef {
  return {
    narrativeIdentity: {
      narrativeId: 1,
      window: "7D",
      algorithmKey: "p3-orchestrator",
      algorithmVersion: "1",
      calculationMode: "observed",
    },
    asOf: "2026-08-16T00:00:00.000Z",
    versionTuple: {
      algorithmVersion: "p4-decision-support",
      semanticVersion: "1",
      signalCatalogVersion: "v1",
      interpretationRuleVersion: "p4-03/v1",
    },
    status: "OK",
    contentHash: null,
    ...overrides,
  };
}

function makeSnapshotArtifact(overrides: Partial<P5HistoricalSnapshot> = {}): P5HistoricalSnapshot {
  const ref = makeSnapshotRef();
  return {
    narrativeIdentity: { ...ref.narrativeIdentity },
    asOf: ref.asOf,
    versionTuple: { ...ref.versionTuple },
    status: "OK",
    contentHash: null,
    ...overrides,
  };
}

const makePolicy = (overrides: Partial<P5HistoricalPolicy> = {}): P5HistoricalPolicy => ({
  policyId: "pol",
  policyVersion: "v1",
  effectiveAt: "2026-08-01T00:00:00.000Z",
  evaluationAt: "2026-08-16T09:30:00.000Z",
  ruleRefs: ["R1"],
  ...overrides,
});

const makeGuardrail = (overrides: Partial<P5HistoricalGuardrail> = {}): P5HistoricalGuardrail => ({
  guardrailId: "GR-1",
  version: "v1",
  outcome: "BLOCK",
  evaluatedAt: "2026-08-16T09:30:00.000Z",
  ...overrides,
});

const makeApproval = (overrides: Partial<P5HistoricalApproval> = {}): P5HistoricalApproval => ({
  approvalId: "ap-1",
  decisionIdRef: "dec-1",
  state: "APPROVED",
  authorityRef: "AUTH-1",
  actor: "owner",
  timestamp: "2026-08-16T10:00:00.000Z",
  approvalPolicyVersion: "ap/v1",
  ...overrides,
});

const makePermission = (overrides: Partial<P5HistoricalPermission> = {}): P5HistoricalPermission => ({
  ref: "perm-1",
  result: "GRANTED",
  evaluatedAt: "2026-08-16T10:30:00.000Z",
  ...overrides,
});

function makeRecord(overrides: Partial<P5DecisionRecord> = {}): P5DecisionRecord {
  const snapshot = makeSnapshotRef();
  return {
    decisionId: "dec-1",
    candidateId: "cand-1",
    actionId: null,
    subject: { narrativeId: 1 },
    outcome: "SELECTED",
    suppressed: false,
    blockerReport: null,
    actionType: "MONITOR",
    parameters: null,
    decisionState: "DECIDED",
    approvalState: "NOT_REQUIRED",
    executionState: "NOT_APPLICABLE",
    approvalRecord: null,
    safetyResult: null,
    permissionResult: "NOT_GRANTED",
    explanation: {
      what: "MONITOR selected",
      why: "policy rule R1 under policy v1",
      basedOn: "p4 snapshot ref",
      policy: "policy v1",
      safety: null,
      approval: null,
      currentState: "DECIDED",
      whatDidNotHappen: [],
    },
    provenance: {
      decisionId: "dec-1",
      candidateId: "cand-1",
      actionId: null,
      p4SnapshotRef: snapshot,
      policy: {
        policyId: "pol",
        policyVersion: "v1",
        effectiveAt: "2026-08-01T00:00:00.000Z",
        evaluationAt: "2026-08-16T09:30:00.000Z",
        ruleRefs: ["R1"],
      },
      safety: { guardrailVersion: null },
      approval: { approvalPolicyVersion: null, authorityRef: null },
      automationMode: "ADVISORY",
      versions: {
        actionModelVersion: "p5-action-model/v1",
        p4VersionTuple: snapshot.versionTuple,
      },
      timestamps: {
        decisionAt: "2026-08-16T09:30:00.000Z",
        evaluatedAt: "2026-08-16T09:30:00.000Z",
        recordedAt: "2026-08-16T09:30:00.000Z",
      },
    },
    auditEvents: [],
    ...overrides,
  };
}

function makeAuditEvent(overrides: Partial<P5AuditEvent> = {}): P5AuditEvent {
  return {
    eventId: "e1",
    eventType: "DECISION_CREATED",
    timestamp: "2026-08-16T09:30:00.000Z",
    actor: "system",
    decisionIdRef: "dec-1",
    previousState: null,
    newState: "DECIDED",
    reason: null,
    policyVersionRef: null,
    guardrailRef: null,
    approvalRef: null,
    ...overrides,
  };
}

describe("P5-08 PgHistoricalArtifactStore — exact identity/version resolution", () => {
  it("A1: exact policy id+version round-trips FOUND through the resolver", async () => {
    const rows = new FakeRowStore();
    const store: HistoricalArtifactStore = new PgHistoricalArtifactStore(rows);
    const writer = new PgHistoricalArtifactWriter(rows);
    await writer.insertPolicy(makePolicy());

    const resolver = new ArtifactResolver(store);
    const res = await resolver.resolvePolicy("pol", "v1");
    expect(res.resolution).toBe("FOUND");
    expect(res.artifact?.policyId).toBe("pol");
    expect(res.artifact?.policyVersion).toBe("v1");
    expect(res.artifact?.ruleRefs).toEqual(["R1"]);
  });

  it("A2: identity exists at another version → store returns the candidate so the resolver classifies VERSION_MISMATCH", async () => {
    const rows = new FakeRowStore();
    const store = new PgHistoricalArtifactStore(rows);
    const writer = new PgHistoricalArtifactWriter(rows);
    await writer.insertPolicy(makePolicy({ policyVersion: "v2" })); // only v2 persisted

    const resolver = new ArtifactResolver(store);
    const res = await resolver.resolvePolicy("pol", "v1");
    expect(res.resolution).toBe("VERSION_MISMATCH");
    expect(res.requestedVersion).toBe("v1");
    expect(res.artifact?.policyVersion).toBe("v2"); // candidate exposed, never silently used
  });

  it("A3: missing id → MISSING (store returns null; resolver classifies)", async () => {
    const rows = new FakeRowStore();
    const store = new PgHistoricalArtifactStore(rows);
    const resolver = new ArtifactResolver(store);
    const res = await resolver.resolvePolicy("pol", "v1");
    expect(res.resolution).toBe("MISSING");
    expect(res.artifact).toBeNull();
  });

  it("decision and approval resolve by exact id; missing → null", async () => {
    const rows = new FakeRowStore();
    const store = new PgHistoricalArtifactStore(rows);
    const writer = new PgHistoricalArtifactWriter(rows);
    await writer.insertDecision(makeRecord());
    await writer.insertApproval(makeApproval());

    const decision = await store.findDecision("dec-1");
    expect(decision?.decisionId).toBe("dec-1");
    expect(decision?.outcome).toBe("SELECTED");
    expect(await store.findDecision("dec-999")).toBeNull();

    const approval = await store.findApproval("ap-1");
    expect(approval?.approvalId).toBe("ap-1");
    expect(approval?.state).toBe("APPROVED");
    expect(await store.findApproval("ap-999")).toBeNull();
  });

  it("guardrail resolves by exact id+version; different version → candidate (VERSION_MISMATCH at resolver)", async () => {
    const rows = new FakeRowStore();
    const store = new PgHistoricalArtifactStore(rows);
    const writer = new PgHistoricalArtifactWriter(rows);
    await writer.insertGuardrail(makeGuardrail({ version: "v2" }));

    const resolver = new ArtifactResolver(store);
    const exact = await resolver.resolveGuardrail("GR-1", "v2");
    expect(exact.resolution).toBe("FOUND");

    const mismatch = await resolver.resolveGuardrail("GR-1", "v1");
    expect(mismatch.resolution).toBe("VERSION_MISMATCH");
  });
});

describe("P5-08 snapshot handling (anti-drift, P5-07 §6)", () => {
  it("D1: exact snapshot ref → FOUND / SNAPSHOT_MATCH; stored verbatim", async () => {
    const rows = new FakeRowStore();
    const store = new PgHistoricalArtifactStore(rows);
    const writer = new PgHistoricalArtifactWriter(rows);
    await writer.insertSnapshot(makeSnapshotArtifact());

    const resolver = new ArtifactResolver(store);
    const res = await resolver.resolveP4Snapshot(makeSnapshotRef());
    expect(res.resolution).toBe("FOUND");
    expect(res.snapshotState).toBe("SNAPSHOT_MATCH");
    expect(res.artifact?.asOf).toBe("2026-08-16T00:00:00.000Z");
  });

  it("D2: no stored snapshot → SNAPSHOT_MISSING, never a live substitute", async () => {
    const rows = new FakeRowStore();
    const store = new PgHistoricalArtifactStore(rows);
    const resolver = new ArtifactResolver(store);
    const res = await resolver.resolveP4Snapshot(makeSnapshotRef());
    expect(res.resolution).toBe("MISSING");
    expect(res.snapshotState).toBe("SNAPSHOT_MISSING");
  });

  it("D3: identity exists at a different semanticVersion → SNAPSHOT_VERSION_MISMATCH", async () => {
    const rows = new FakeRowStore();
    const store = new PgHistoricalArtifactStore(rows);
    const writer = new PgHistoricalArtifactWriter(rows);
    const ref = makeSnapshotRef();
    await writer.insertSnapshot(
      makeSnapshotArtifact({
        versionTuple: { ...ref.versionTuple, semanticVersion: "2" },
      })
    );

    const resolver = new ArtifactResolver(store);
    const res = await resolver.resolveP4Snapshot(ref);
    expect(res.resolution).toBe("VERSION_MISMATCH");
    expect(res.snapshotState).toBe("SNAPSHOT_VERSION_MISMATCH");
  });

  it("D4: recorded hash vs stored hash — mismatch → SNAPSHOT_HASH_MISMATCH; no stored hash → SNAPSHOT_UNAVAILABLE; no recorded hash → MATCH (contentHash PROVISIONAL)", async () => {
    const rows = new FakeRowStore();
    const writer = new PgHistoricalArtifactWriter(rows);

    // Recorded hash "abc" vs stored "def" → HASH_MISMATCH.
    await writer.insertSnapshot(makeSnapshotArtifact({ contentHash: "def" }));
    let resolver = new ArtifactResolver(new PgHistoricalArtifactStore(rows));
    let res = await resolver.resolveP4Snapshot(makeSnapshotRef({ contentHash: "abc" }));
    expect(res.snapshotState).toBe("SNAPSHOT_HASH_MISMATCH");

    // Recorded hash "abc" vs stored null → UNAVAILABLE (never assumed to match).
    const rows2 = new FakeRowStore();
    const writer2 = new PgHistoricalArtifactWriter(rows2);
    await writer2.insertSnapshot(makeSnapshotArtifact({ contentHash: null }));
    resolver = new ArtifactResolver(new PgHistoricalArtifactStore(rows2));
    res = await resolver.resolveP4Snapshot(makeSnapshotRef({ contentHash: "abc" }));
    expect(res.snapshotState).toBe("SNAPSHOT_UNAVAILABLE");

    // No recorded hash → MATCH with no hash check (PROVISIONAL preserved).
    const rows3 = new FakeRowStore();
    const writer3 = new PgHistoricalArtifactWriter(rows3);
    await writer3.insertSnapshot(makeSnapshotArtifact());
    resolver = new ArtifactResolver(new PgHistoricalArtifactStore(rows3));
    res = await resolver.resolveP4Snapshot(makeSnapshotRef());
    expect(res.snapshotState).toBe("SNAPSHOT_MATCH");
  });
});

describe("P5-08 permission artifact boundary (P5-04 SG-011, P5-07 §4.3)", () => {
  it("F1: persisted permission artifact resolves exactly; missing → null; never fabricated", async () => {
    const rows = new FakeRowStore();
    const store = new PgHistoricalArtifactStore(rows);
    const writer = new PgHistoricalArtifactWriter(rows);
    await writer.insertPermission(makePermission());

    const found = await store.findPermission("perm-1");
    expect(found?.result).toBe("GRANTED");
    expect(await store.findPermission("perm-999")).toBeNull();
    // A missing permission artifact must never surface as DENIED / NOT_GRANTED.
    expect(await store.findPermission("perm-999")).not.toBe(
      expect.objectContaining({ result: "DENIED" })
    );
  });
});

describe("P5-08 immutability + idempotency", () => {
  it("C1: duplicate exact artifact write is ignored — the first recorded artifact is never rewritten", async () => {
    const rows = new FakeRowStore();
    const store = new PgHistoricalArtifactStore(rows);
    const writer = new PgHistoricalArtifactWriter(rows);

    const first = makePolicy();
    const second = makePolicy({ ruleRefs: ["R1", "R2"] }); // same identity, different content
    await writer.insertPolicy(first);
    await writer.insertPolicy(second);

    const artifact = await store.findPolicy("pol", "v1");
    expect(artifact?.ruleRefs).toEqual(["R1"]); // first write preserved verbatim
    expect(rows.snapshot(p5Policies)).toHaveLength(1);
  });

  it("C2: frozen decision record survives write→read round trip unchanged", async () => {
    const rows = new FakeRowStore();
    const store = new PgHistoricalArtifactStore(rows);
    const writer = new PgHistoricalArtifactWriter(rows);
    const record = makeRecord();
    Object.freeze(record);
    Object.freeze(record.auditEvents);
    Object.freeze(record.provenance);

    await writer.insertDecision(record);
    const readBack = await store.findDecision("dec-1");
    expect(JSON.stringify(readBack)).toBe(JSON.stringify(record));
  });

  it("C3: audit events append by unique eventId; duplicates ignored (chronology preserved)", async () => {
    const rows = new FakeRowStore();
    const store = new PgHistoricalArtifactStore(rows);
    const writer = new PgHistoricalArtifactWriter(rows);
    await writer.insertAuditEvent(makeAuditEvent());
    await writer.insertAuditEvent(makeAuditEvent({ reason: "duplicate" }));
    expect(rows.snapshot(p5AuditEvents)).toHaveLength(1);
    expect((await store.findDecision("dec-1"))).toBeNull(); // audit is not a decision
  });
});

describe("P5-08 read-only / insert-only boundaries", () => {
  it("G1: the store exposes ONLY the six find methods (replay never mutates)", () => {
    const proto = Object.getOwnPropertyNames(PgHistoricalArtifactStore.prototype).sort();
    expect(proto).toEqual([
      "constructor",
      "findApproval",
      "findDecision",
      "findGuardrail",
      "findP4Snapshot",
      "findPermission",
      "findPolicy",
    ]);
  });

  it("G2: the writer exposes ONLY insert methods (no update/delete/rewrite surface)", () => {
    const proto = Object.getOwnPropertyNames(PgHistoricalArtifactWriter.prototype).sort();
    expect(proto).toEqual([
      "constructor",
      "insertApproval",
      "insertAuditEvent",
      "insertDecision",
      "insertGuardrail",
      "insertPermission",
      "insertPolicy",
      "insertSnapshot",
    ]);
  });

  it("E1: every artifact class missing → explicit null (resolver classifies), never a decision outcome", async () => {
    const rows = new FakeRowStore();
    const store = new PgHistoricalArtifactStore(rows);
    expect(await store.findDecision("x")).toBeNull();
    expect(await store.findP4Snapshot(makeSnapshotRef())).toBeNull();
    expect(await store.findPolicy("x", "v1")).toBeNull();
    expect(await store.findGuardrail("x", "v1")).toBeNull();
    expect(await store.findApproval("x")).toBeNull();
    expect(await store.findPermission("x")).toBeNull();
  });
});
