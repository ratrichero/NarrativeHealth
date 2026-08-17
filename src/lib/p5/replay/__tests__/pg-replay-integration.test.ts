import { describe, expect, it } from "@jest/globals";
import { ArtifactResolver } from "../artifact-resolver";
import { ReplayEngine } from "../replay-engine";
import {
  PgHistoricalArtifactStore,
  PgHistoricalArtifactWriter,
  type P5RowStore,
} from "../pg-artifact-store";
import { p5AuditEvents, p5DecisionRecords, p5P4Snapshots, p5Policies } from "@/db/schema";
import type {
  P5HistoricalPolicy,
  P5HistoricalSnapshot,
} from "../types";
import type { P5DecisionRecord, P5P4SnapshotRef } from "../../types";

// ---------------------------------------------------------------------------
// P5-08 replay integration — the frozen ReplayEngine consumes persisted
// historical artifacts through the PgHistoricalArtifactStore boundary without
// any change to replay semantics (P5-07 G6 / Definition of Done).
// ---------------------------------------------------------------------------

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

function makePolicy(overrides: Partial<P5HistoricalPolicy> = {}): P5HistoricalPolicy {
  return {
    policyId: "pol",
    policyVersion: "v1",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    evaluationAt: "2026-08-16T09:30:00.000Z",
    ruleRefs: ["R1"],
    ...overrides,
  };
}

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

/** Seed a complete, consistent historical artifact set via the insert-only writer. */
async function seedFull(rows: FakeRowStore, record: P5DecisionRecord = makeRecord()): Promise<void> {
  const writer = new PgHistoricalArtifactWriter(rows);
  await writer.insertDecision(record);
  await writer.insertSnapshot(makeSnapshotArtifact());
  await writer.insertPolicy(makePolicy());
}

describe("P5-08 replay integration — ReplayEngine over persisted artifacts", () => {
  it("G1: persisted artifacts → RECONSTRUCT completes (REPLAY_COMPLETE, EXACT), zero side effects", async () => {
    const rows = new FakeRowStore();
    await seedFull(rows);
    const store = new PgHistoricalArtifactStore(rows);
    const engine = new ReplayEngine(new ArtifactResolver(store));

    const report = await engine.reconstruct("dec-1");
    expect(report.result).toBe("REPLAY_COMPLETE");
    expect(report.equivalence).toBe("EXACT");
    expect(report.reconstruction.outcome).toBe("SELECTED");
    expect(report.reconstruction.snapshot.state).toBe("SNAPSHOT_MATCH");
    expect(report.reconstruction.references.policy?.resolution).toBe("FOUND");
    expect(report.sideEffects).toBe("NONE");
  });

  it("G2: all three modes run over the persisted store on the same deterministic core", async () => {
    const rows = new FakeRowStore();
    await seedFull(rows);
    const engine = new ReplayEngine(new ArtifactResolver(new PgHistoricalArtifactStore(rows)));

    const reconstruct = await engine.reconstruct("dec-1");
    const validate = await engine.validate("dec-1");
    const compare = await engine.compare("dec-1");
    expect(reconstruct.result).toBe("REPLAY_COMPLETE");
    expect(validate.result).toBe(reconstruct.result);
    expect(compare.result).toBe(reconstruct.result);
    expect(validate.reconstruction).toEqual(reconstruct.reconstruction);
  });

  it("E1: missing persisted artifacts → REPLAY_UNAVAILABLE, never NO_ACTION/NOT_DETERMINED", async () => {
    const rows = new FakeRowStore();
    const engine = new ReplayEngine(new ArtifactResolver(new PgHistoricalArtifactStore(rows)));

    const report = await engine.reconstruct("dec-1");
    expect(report.result).toBe("REPLAY_UNAVAILABLE");
    expect(report.result).not.toBe("NO_ACTION");
    expect(report.result).not.toBe("NOT_DETERMINED");
    expect(report.reconstruction.outcome).toBeNull();
    expect(report.validation.findings.some((f) => f.type === "ARTIFACT_MISSING" && f.dimension === "decision")).toBe(true);
  });

  it("B1: historical-over-live — persisted v1 wins; live v2 is labeled LIVE_CONTEXT, never truth", async () => {
    const rows = new FakeRowStore();
    await seedFull(rows); // historical policy v1 persisted
    const engine = new ReplayEngine(new ArtifactResolver(new PgHistoricalArtifactStore(rows)), {
      inspectLiveContext: (dimension, ref) =>
        dimension === "policy" ? `current policy ${ref} v2 exists in live config` : null,
    });

    const report = await engine.reconstruct("dec-1");
    expect(report.result).toBe("REPLAY_COMPLETE");
    expect(report.reconstruction.references.policy?.resolution).toBe("FOUND");
    expect(report.reconstruction.references.policy?.artifact?.policyVersion).toBe("v1");
    // The live inspector was never consulted because the historical artifact exists.
    expect(report.validation.findings.some((f) => f.liveContext)).toBe(false);
  });

  it("B2: historical artifact missing → stays missing even when live data exists (labeled LIVE_CONTEXT only)", async () => {
    const rows = new FakeRowStore();
    const writer = new PgHistoricalArtifactWriter(rows);
    await writer.insertDecision(makeRecord()); // no snapshot, no policy persisted
    const engine = new ReplayEngine(new ArtifactResolver(new PgHistoricalArtifactStore(rows)), {
      inspectLiveContext: (dimension, ref) =>
        dimension === "p4Snapshot" ? `current P4 view available for ${ref}` : null,
    });

    const report = await engine.reconstruct("dec-1");
    expect(report.result).toBe("REPLAY_UNAVAILABLE");
    expect(report.reconstruction.snapshot.state).toBe("SNAPSHOT_MISSING");
    const live = report.validation.findings.find((f) => f.liveContext && f.dimension === "p4Snapshot");
    expect(live).toBeDefined();
    expect(live?.detail).toMatch(/LIVE_CONTEXT/);
  });

  it("version mismatch through the store — record refs v1, persisted only v2 → VERSION_MISMATCH + REPLAY_UNAVAILABLE", async () => {
    const rows = new FakeRowStore();
    const writer = new PgHistoricalArtifactWriter(rows);
    await writer.insertDecision(makeRecord());
    await writer.insertSnapshot(makeSnapshotArtifact());
    await writer.insertPolicy(makePolicy({ policyVersion: "v2" })); // only v2 persisted

    const engine = new ReplayEngine(new ArtifactResolver(new PgHistoricalArtifactStore(rows)));
    const report = await engine.validate("dec-1");
    expect(report.result).toBe("REPLAY_UNAVAILABLE");
    expect(report.reconstruction.references.policy?.resolution).toBe("VERSION_MISMATCH");
    expect(report.validation.findings.some((f) => f.type === "ARTIFACT_VERSION_MISMATCH")).toBe(true);
  });

  it("H1: mutation protection — replay never writes; persisted rows are byte-identical after all three modes", async () => {
    const rows = new FakeRowStore();
    await seedFull(rows);
    const before = {
      decisions: JSON.stringify(rows.snapshot(p5DecisionRecords)),
      snapshots: JSON.stringify(rows.snapshot(p5P4Snapshots)),
      policies: JSON.stringify(rows.snapshot(p5Policies)),
      audit: JSON.stringify(rows.snapshot(p5AuditEvents)),
    };
    const engine = new ReplayEngine(new ArtifactResolver(new PgHistoricalArtifactStore(rows)));
    await engine.reconstruct("dec-1");
    await engine.validate("dec-1");
    await engine.compare("dec-1");

    expect(JSON.stringify(rows.snapshot(p5DecisionRecords))).toBe(before.decisions);
    expect(JSON.stringify(rows.snapshot(p5P4Snapshots))).toBe(before.snapshots);
    expect(JSON.stringify(rows.snapshot(p5Policies))).toBe(before.policies);
    expect(JSON.stringify(rows.snapshot(p5AuditEvents))).toBe(before.audit);
  });

  it("P1: granted permission without a persisted permission artifact → explicit ARTIFACT_UNAVAILABLE, never fabricated", async () => {
    const rows = new FakeRowStore();
    const writer = new PgHistoricalArtifactWriter(rows);
    await writer.insertDecision(makeRecord({ permissionResult: "GRANTED" }));
    await writer.insertSnapshot(makeSnapshotArtifact());
    await writer.insertPolicy(makePolicy());

    const engine = new ReplayEngine(new ArtifactResolver(new PgHistoricalArtifactStore(rows)));
    const report = await engine.reconstruct("dec-1");
    const finding = report.validation.findings.find((f) => f.dimension === "permission");
    expect(finding?.type).toBe("ARTIFACT_UNAVAILABLE");
    // Recorded permissionResult preserved; never interpreted as executed.
    expect(report.reconstruction.decision?.permissionResult).toBe("GRANTED");
    expect(report.reconstruction.orthogonalStates.executionState).toBe("NOT_APPLICABLE");
  });
});
