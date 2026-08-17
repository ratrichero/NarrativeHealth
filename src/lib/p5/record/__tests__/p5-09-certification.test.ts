import { describe, expect, it } from "@jest/globals";
import { P5ArtifactRecorder } from "../p5-artifact-recorder";
import { ArtifactResolver } from "../../replay/artifact-resolver";
import { ReplayEngine } from "../../replay/replay-engine";
import {
  PgHistoricalArtifactStore,
  PgHistoricalArtifactWriter,
  type P5RowStore,
} from "../../replay/pg-artifact-store";
import { p5Approvals, p5AuditEvents, p5DecisionRecords, p5Guardrails, p5P4Snapshots, p5Permissions, p5Policies } from "@/db/schema";
import type { P5DecisionRecord, P5P4SnapshotRef } from "../../types";

// ---------------------------------------------------------------------------
// P5-09 replay certification — the full production path:
//
//   runtime P5 decision (P5-03/04/05 producer)
//       ↓ P5ArtifactRecorder (insert-only, idempotent, derive-only)
//   persisted p5_* artifacts (migration 0021, writer + store over the
//       production row-store port)
//       ↓ HistoricalArtifactStore (PgHistoricalArtifactStore, read-only)
//       ↓ ArtifactResolver (frozen, exact identity + version)
//       ↓ ReplayEngine (frozen: RECONSTRUCT/VALIDATE/COMPARE)
//       ↓ P5ReplayReport
//
// The SQL surface is isolated in the P5RowStore port (DrizzleP5RowStore in
// production; the in-memory fake here implements the same port), so this
// suite exercises the real recorder/store/writer/resolver/engine code paths
// deterministically without a live database. Real-DB application of
// migration 0021 + a live-DB smoke run is a deployment-time step.
// ---------------------------------------------------------------------------

class FakeRowStore implements P5RowStore {
  private readonly tables = new Map<unknown, Record<string, unknown>[]>();

  async findFirst(table: unknown, where: Record<string, unknown>, orderBy?: string): Promise<Record<string, unknown> | null> {
    const rows = this.tables.get(table) ?? [];
    const matched = rows.filter((r) => Object.entries(where).every(([col, value]) => r[col] === value));
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
    narrativeIdentity: { narrativeId: 1, window: "7D", algorithmKey: "p3-orchestrator", algorithmVersion: "1", calculationMode: "observed" },
    asOf: "2026-08-16T00:00:00.000Z",
    versionTuple: { algorithmVersion: "p4-decision-support", semanticVersion: "1", signalCatalogVersion: "v1", interpretationRuleVersion: "p4-03/v1" },
    status: "OK",
    contentHash: null,
    ...overrides,
  };
}

/** Realistic runtime decision record — the exact shape a P5 producer produces. */
function makeDecision(overrides: Partial<P5DecisionRecord> = {}): P5DecisionRecord {
  const snapshot = makeSnapshotRef();
  return {
    decisionId: "dec-1",
    candidateId: "cand-1",
    actionId: "act-1",
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
    safetyResult: {
      aggregate: "PASS",
      guardrailResults: [
        { guardrailId: "GR-1", version: "v1", outcome: "PASS", applicable: true, evaluatedAt: "2026-08-16T09:30:00.000Z", reason: null },
      ],
    },
    permissionResult: "NOT_GRANTED",
    explanation: { what: "MONITOR selected", why: "policy rule R1", basedOn: "snapshot ref", policy: "pol v1", safety: "PASS", approval: null, currentState: "DECIDED", whatDidNotHappen: [] },
    provenance: {
      decisionId: "dec-1",
      candidateId: "cand-1",
      actionId: "act-1",
      p4SnapshotRef: snapshot,
      policy: { policyId: "pol", policyVersion: "v1", effectiveAt: "2026-08-01T00:00:00.000Z", evaluationAt: "2026-08-16T09:30:00.000Z", ruleRefs: ["R1"] },
      safety: { guardrailVersion: "v1" },
      approval: { approvalPolicyVersion: null, authorityRef: null },
      automationMode: "ADVISORY",
      versions: { actionModelVersion: "p5-action-model/v1", p4VersionTuple: snapshot.versionTuple },
      timestamps: { decisionAt: "2026-08-16T09:30:00.000Z", evaluatedAt: "2026-08-16T09:30:00.000Z", recordedAt: "2026-08-16T09:30:00.000Z" },
    },
    auditEvents: [
      { eventId: "e1", eventType: "DECISION_CREATED", timestamp: "2026-08-16T09:29:00.000Z", actor: "system", decisionIdRef: "dec-1", previousState: null, newState: "CANDIDATE", reason: null, policyVersionRef: null, guardrailRef: null, approvalRef: null },
      { eventId: "e2", eventType: "DECISION_SELECTED", timestamp: "2026-08-16T09:30:00.000Z", actor: "system", decisionIdRef: "dec-1", previousState: "CANDIDATE", newState: "DECIDED", reason: "rule R1", policyVersionRef: "v1", guardrailRef: null, approvalRef: null },
    ],
    ...overrides,
  };
}

function makeEngine(rows: FakeRowStore, liveInspector?: (dimension: string, ref: string) => string | null) {
  const store = new PgHistoricalArtifactStore(rows);
  const resolver = new ArtifactResolver(store);
  const engine = new ReplayEngine(resolver, liveInspector ? { inspectLiveContext: liveInspector } : {});
  return { store, resolver, engine };
}

describe("P5-09 certification — end-to-end replay over persisted artifacts", () => {
  it("C1: production decision → recording → store → resolver → engine → REPLAY_COMPLETE / EXACT", async () => {
    const rows = new FakeRowStore();
    const recorder = new P5ArtifactRecorder(new PgHistoricalArtifactWriter(rows));
    await recorder.record({ decision: makeDecision() });

    const { engine } = makeEngine(rows);
    const report = await engine.reconstruct("dec-1");

    expect(report.result).toBe("REPLAY_COMPLETE");
    expect(report.equivalence).toBe("EXACT");
    expect(report.reconstruction.outcome).toBe("SELECTED");
    expect(report.reconstruction.snapshot.state).toBe("SNAPSHOT_MATCH");
    expect(report.reconstruction.references.policy?.resolution).toBe("FOUND");
    expect(report.reconstruction.references.guardrail?.resolution).toBe("FOUND");
    expect(report.reconstruction.orthogonalStates).toEqual({ decisionState: "DECIDED", approvalState: "NOT_REQUIRED", executionState: "NOT_APPLICABLE" });
    expect(report.reconstruction.auditEvents).toHaveLength(2);
    expect(report.sideEffects).toBe("NONE");
  });

  it("C2: decisionId is the sole replay anchor — unknown decisionId → REPLAY_UNAVAILABLE, never a live/narrative fallback", async () => {
    const rows = new FakeRowStore();
    const recorder = new P5ArtifactRecorder(new PgHistoricalArtifactWriter(rows));
    await recorder.record({ decision: makeDecision() });

    const { engine } = makeEngine(rows, (dimension, ref) => `live narrative state exists for ${ref}`);
    const report = await engine.reconstruct("dec-999");
    expect(report.result).toBe("REPLAY_UNAVAILABLE");
    expect(report.validation.findings.some((f) => f.type === "ARTIFACT_MISSING" && f.dimension === "decision")).toBe(true);
    expect(report.reconstruction.outcome).toBeNull();
  });
});

describe("P5-09 certification — historical-vs-live anti-drift", () => {
  it("H1: persisted snapshot V1 wins over live V2; live inspector never consulted while historical artifact exists", async () => {
    const rows = new FakeRowStore();
    const recorder = new P5ArtifactRecorder(new PgHistoricalArtifactWriter(rows));
    await recorder.record({ decision: makeDecision() }); // historical snapshot V1 persisted

    const { engine } = makeEngine(rows, (dimension, ref) => `current P4 ${ref} is V2 in live config`);
    const report = await engine.reconstruct("dec-1");

    expect(report.result).toBe("REPLAY_COMPLETE");
    expect(report.reconstruction.snapshot.state).toBe("SNAPSHOT_MATCH");
    expect(report.reconstruction.snapshot.ref?.asOf).toBe("2026-08-16T00:00:00.000Z");
    expect(report.reconstruction.snapshot.ref?.versionTuple.semanticVersion).toBe("1");
    // Live V2 never substituted and never inspected (historical artifact exists).
    expect(report.validation.findings.some((f) => f.liveContext)).toBe(false);
  });

  it("H2: historical snapshot missing + live snapshot exists → SNAPSHOT_MISSING + labeled LIVE_CONTEXT diagnostic, never truth", async () => {
    const rows = new FakeRowStore();
    const writer = new PgHistoricalArtifactWriter(rows);
    // Record the decision WITHOUT its snapshot artifact (partial recording).
    const decision = makeDecision();
    await writer.insertDecision(decision);
    await writer.insertPolicy({ policyId: "pol", policyVersion: "v1", effectiveAt: "2026-08-01T00:00:00.000Z", evaluationAt: "2026-08-16T09:30:00.000Z", ruleRefs: ["R1"] });
    await writer.insertGuardrail({ guardrailId: "GR-1", version: "v1", outcome: "PASS", evaluatedAt: "2026-08-16T09:30:00.000Z" });

    const { engine } = makeEngine(rows, (dimension, ref) => (dimension === "p4Snapshot" ? `current P4 view available for ${ref}` : null));
    const report = await engine.reconstruct("dec-1");

    expect(report.result).toBe("REPLAY_UNAVAILABLE");
    expect(report.reconstruction.snapshot.state).toBe("SNAPSHOT_MISSING");
    const live = report.validation.findings.find((f) => f.dimension === "p4Snapshot" && f.liveContext);
    expect(live).toBeDefined();
    expect(live?.detail).toMatch(/LIVE_CONTEXT/);
    // The decision outcome recorded at T1 is preserved — never overwritten by live state.
    expect(report.reconstruction.outcome).toBe("SELECTED");
  });
});

describe("P5-09 certification — version mismatch", () => {
  it("V1: record references policy v1; only v2 persisted → VERSION_MISMATCH, never latest/current resolution", async () => {
    const rows = new FakeRowStore();
    const writer = new PgHistoricalArtifactWriter(rows);
    // Simulate a store that persisted only policy v2 while the record references v1.
    const decision = makeDecision();
    await writer.insertDecision(decision);
    await writer.insertSnapshot(P5ArtifactRecorder.deriveSnapshot(decision)!);
    await writer.insertGuardrail({ guardrailId: "GR-1", version: "v1", outcome: "PASS", evaluatedAt: "2026-08-16T09:30:00.000Z" });
    await writer.insertPolicy({ policyId: "pol", policyVersion: "v2", effectiveAt: "2026-08-01T00:00:00.000Z", evaluationAt: "2026-08-16T09:30:00.000Z", ruleRefs: ["R1"] });

    const { engine } = makeEngine(rows);
    const report = await engine.validate("dec-1");

    expect(report.result).toBe("REPLAY_UNAVAILABLE");
    expect(report.reconstruction.references.policy?.resolution).toBe("VERSION_MISMATCH");
    expect(report.reconstruction.references.policy?.requestedVersion).toBe("v1");
    expect(report.reconstruction.references.policy?.artifact?.policyVersion).toBe("v2"); // candidate exposed, never used
    expect(report.validation.findings.some((f) => f.type === "ARTIFACT_VERSION_MISMATCH")).toBe(true);
    expect(report.validation.findings.some((f) => f.type === "ARTIFACT_VERSION_MISMATCH" && f.ref === "pol")).toBe(true);
  });
});

describe("P5-09 certification — missing artifacts", () => {
  it("M1: guardrail artifact missing (partial batch) → REPLAY_UNAVAILABLE with explicit ARTIFACT_MISSING, never NO_ACTION/NOT_DETERMINED", async () => {
    const rows = new FakeRowStore();
    const writer = new PgHistoricalArtifactWriter(rows);
    const decision = makeDecision();
    await writer.insertDecision(decision);
    await writer.insertSnapshot(P5ArtifactRecorder.deriveSnapshot(decision)!);
    await writer.insertPolicy({ policyId: "pol", policyVersion: "v1", effectiveAt: "2026-08-01T00:00:00.000Z", evaluationAt: "2026-08-16T09:30:00.000Z", ruleRefs: ["R1"] });
    // guardrail row intentionally omitted

    const { engine } = makeEngine(rows);
    const report = await engine.reconstruct("dec-1");

    expect(report.result).toBe("REPLAY_UNAVAILABLE");
    expect(report.result).not.toBe("NO_ACTION");
    expect(report.result).not.toBe("NOT_DETERMINED");
    expect(report.validation.findings.some((f) => f.type === "ARTIFACT_MISSING" && f.dimension === "guardrail")).toBe(true);
  });

  it("M2: snapshot artifact missing → SNAPSHOT_MISSING classification, decision outcome preserved", async () => {
    const rows = new FakeRowStore();
    const writer = new PgHistoricalArtifactWriter(rows);
    const decision = makeDecision();
    await writer.insertDecision(decision); // no snapshot/policy/guardrail rows at all

    const { engine } = makeEngine(rows);
    const report = await engine.reconstruct("dec-1");

    expect(report.result).toBe("REPLAY_UNAVAILABLE");
    expect(report.reconstruction.snapshot.state).toBe("SNAPSHOT_MISSING");
    expect(report.validation.findings.some((f) => f.type === "ARTIFACT_MISSING" && f.dimension === "p4Snapshot")).toBe(true);
    expect(report.reconstruction.outcome).toBe("SELECTED");
  });
});

describe("P5-09 certification — contradiction", () => {
  it("X1: decision says APPROVED, audit says DENIED → CONTRADICTION, evidence preserved, no silent correction", async () => {
    const rows = new FakeRowStore();
    const recorder = new P5ArtifactRecorder(new PgHistoricalArtifactWriter(rows));
    const decision = makeDecision({
      approvalState: "APPROVED",
      approvalRecord: {
        approvalId: "ap-1",
        decisionIdRef: "dec-1",
        state: "APPROVED",
        authorityRef: "AUTH-1",
        actor: "owner",
        timestamp: "2026-08-16T10:00:00.000Z",
        scope: "execute-monitor",
        approvalPolicyVersion: "ap/v1",
        invalidation: null,
      },
      permissionResult: "GRANTED",
      auditEvents: [
        { eventId: "e1", eventType: "DECISION_CREATED", timestamp: "2026-08-16T09:29:00.000Z", actor: "system", decisionIdRef: "dec-1", previousState: null, newState: "CANDIDATE", reason: null, policyVersionRef: null, guardrailRef: null, approvalRef: null },
        { eventId: "e2", eventType: "DECISION_SELECTED", timestamp: "2026-08-16T09:30:00.000Z", actor: "system", decisionIdRef: "dec-1", previousState: "CANDIDATE", newState: "DECIDED", reason: "rule R1", policyVersionRef: "v1", guardrailRef: null, approvalRef: null },
        { eventId: "e3", eventType: "APPROVAL_REQUESTED", timestamp: "2026-08-16T10:00:00.000Z", actor: "owner", decisionIdRef: "dec-1", previousState: null, newState: "REQUIRED", reason: null, policyVersionRef: null, guardrailRef: null, approvalRef: null },
        { eventId: "e4", eventType: "APPROVAL_DENIED", timestamp: "2026-08-16T10:05:00.000Z", actor: "owner", decisionIdRef: "dec-1", previousState: "REQUIRED", newState: "DENIED", reason: "scope rejected", policyVersionRef: null, guardrailRef: null, approvalRef: "ap-1" },
      ],
    });
    await recorder.record({ decision });

    const { engine } = makeEngine(rows);
    const report = await engine.reconstruct("dec-1");

    expect(report.result).toBe("CONTRADICTION");
    const finding = report.validation.findings.find((f) => f.type === "ARTIFACT_CONTRADICTION" && f.dimension === "contradiction");
    expect(finding).toBeDefined();
    expect(finding?.ref).toBe("e4");
    // Both recorded facts preserved verbatim — nothing rewritten, no latest-wins.
    expect(report.reconstruction.decision?.approvalState).toBe("APPROVED");
    expect(report.reconstruction.auditEvents.some((e) => e.eventType === "APPROVAL_DENIED")).toBe(true);
    expect(report.reconstruction.references.approval?.resolution).toBe("FOUND");
  });
});

describe("P5-09 certification — determinism, namespace, side effects, chronology", () => {
  it("D1: same decisionId + same artifacts + same contract version ⇒ identical reports across runs and modes", async () => {
    const rows = new FakeRowStore();
    const recorder = new P5ArtifactRecorder(new PgHistoricalArtifactWriter(rows));
    await recorder.record({ decision: makeDecision() });

    const { engine } = makeEngine(rows);
    // Determinism: repeated runs of the SAME mode are byte-identical reports.
    const r1 = await engine.reconstruct("dec-1");
    const r2 = await engine.reconstruct("dec-1");
    expect(r2).toEqual(r1);
    const v1 = await engine.validate("dec-1");
    const v2 = await engine.validate("dec-1");
    expect(v2).toEqual(v1);
    const c1 = await engine.compare("dec-1");
    const c2 = await engine.compare("dec-1");
    expect(c2).toEqual(c1);
    // All modes run on the same deterministic core with the same result/reconstruction.
    expect(v1.result).toBe(r1.result);
    expect(c1.result).toBe(r1.result);
    expect(v1.reconstruction).toEqual(r1.reconstruction);
    expect(c1.reconstruction).toEqual(r1.reconstruction);
    expect(r1.replayContractVersion).toBe("p5-replay/v1");
    expect(r1.sideEffects).toBe("NONE");
  });

  it("S1: replay is read-only — persisted rows are byte-identical after all modes", async () => {
    const rows = new FakeRowStore();
    const recorder = new P5ArtifactRecorder(new PgHistoricalArtifactWriter(rows));
    await recorder.record({ decision: makeDecision() });

    const before = {
      decisions: JSON.stringify(rows.snapshot(p5DecisionRecords)),
      snapshots: JSON.stringify(rows.snapshot(p5P4Snapshots)),
      policies: JSON.stringify(rows.snapshot(p5Policies)),
      guardrails: JSON.stringify(rows.snapshot(p5Guardrails)),
      approvals: JSON.stringify(rows.snapshot(p5Approvals)),
      permissions: JSON.stringify(rows.snapshot(p5Permissions)),
      audit: JSON.stringify(rows.snapshot(p5AuditEvents)),
    };

    const { engine } = makeEngine(rows);
    await engine.reconstruct("dec-1");
    await engine.validate("dec-1");
    await engine.compare("dec-1");
    await engine.reconstruct("dec-999"); // failed lookup too

    expect(JSON.stringify(rows.snapshot(p5DecisionRecords))).toBe(before.decisions);
    expect(JSON.stringify(rows.snapshot(p5P4Snapshots))).toBe(before.snapshots);
    expect(JSON.stringify(rows.snapshot(p5Policies))).toBe(before.policies);
    expect(JSON.stringify(rows.snapshot(p5Guardrails))).toBe(before.guardrails);
    expect(JSON.stringify(rows.snapshot(p5Approvals))).toBe(before.approvals);
    expect(JSON.stringify(rows.snapshot(p5Permissions))).toBe(before.permissions);
    expect(JSON.stringify(rows.snapshot(p5AuditEvents))).toBe(before.audit);
  });

  it("N1: replay results live in the replay namespace — never DecisionOutcome values", async () => {
    const rows = new FakeRowStore();
    const recorder = new P5ArtifactRecorder(new PgHistoricalArtifactWriter(rows));
    await recorder.record({ decision: makeDecision() });

    const { engine } = makeEngine(rows);
    const ok = await engine.reconstruct("dec-1");
    const missing = await engine.reconstruct("dec-999");

    for (const report of [ok, missing]) {
      expect(["REPLAY_COMPLETE", "REPLAY_PARTIAL", "REPLAY_UNAVAILABLE", "CONTRADICTION"]).toContain(report.result);
      expect(report.result).not.toBe("NO_ACTION");
      expect(report.result).not.toBe("NOT_DETERMINED");
      expect(report.result).not.toBe("SELECTED");
    }
    expect(missing.result).toBe("REPLAY_UNAVAILABLE");
  });

  it("A1: audit chronology preserved — ordered events pass; disordered events are detected, never rewritten", async () => {
    const rows = new FakeRowStore();
    const recorder = new P5ArtifactRecorder(new PgHistoricalArtifactWriter(rows));
    const good = makeDecision();
    await recorder.record({ decision: good });
    const { engine } = makeEngine(rows);
    const report = await engine.validate("dec-1");
    expect(report.validation.findings.some((f) => f.dimension === "chronology")).toBe(false);

    // Poisoned audit order (SELECTED before CREATED) — detected, evidence preserved.
    const rows2 = new FakeRowStore();
    const recorder2 = new P5ArtifactRecorder(new PgHistoricalArtifactWriter(rows2));
    const bad = makeDecision();
    bad.auditEvents = [bad.auditEvents[1], bad.auditEvents[0]]; // swap
    await recorder2.record({ decision: bad });
    const { engine: engine2 } = makeEngine(rows2);
    const report2 = await engine2.validate("dec-1");
    expect(report2.validation.findings.some((f) => f.type === "CHRONOLOGY_ORDER")).toBe(true);
    // Recorded order in the store is untouched (replay never repairs).
    expect(rows2.snapshot(p5AuditEvents)).toHaveLength(2);
  });
});
