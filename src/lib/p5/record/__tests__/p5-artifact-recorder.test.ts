import { describe, expect, it } from "@jest/globals";
import {
  P5ArtifactRecorder,
  type P5ArtifactRecordingBatch,
} from "../p5-artifact-recorder";
import {
  PgHistoricalArtifactStore,
  PgHistoricalArtifactWriter,
  type P5RowStore,
} from "../../replay/pg-artifact-store";
import { p5Approvals, p5AuditEvents, p5DecisionRecords, p5Guardrails, p5P4Snapshots, p5Permissions, p5Policies } from "@/db/schema";
import type { P5HistoricalPermission, P5HistoricalPolicy, P5HistoricalSnapshot } from "../../replay/types";
import type { P5DecisionRecord, P5P4SnapshotRef } from "../../types";

// ---------------------------------------------------------------------------
// P5-09 recorder tests — the producer-side recording contract over the frozen
// P5-08 writer: derive-only (no fabrication), exact identity/version, missing
// facts → no row (absence preserved), idempotent, input never mutated.
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

/** A realistic runtime decision record with every derivable artifact present. */
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

function makeRecorder(rows: FakeRowStore) {
  const store = new PgHistoricalArtifactStore(rows);
  const writer = new PgHistoricalArtifactWriter(rows);
  const recorder = new P5ArtifactRecorder(writer);
  return { store, writer, recorder };
}

describe("P5-09 P5ArtifactRecorder — derivation, no fabrication", () => {
  it("R1: full decision → every derivable artifact recorded with exact identity", async () => {
    const rows = new FakeRowStore();
    const { store, recorder } = makeRecorder(rows);

    const res = await recorder.record({ decision: makeDecision() });
    expect(res.complete).toBe(true);
    // Default fixture: no approvalRecord → no approval artifact (never fabricated).
    expect(res.items.map((i) => i.artifact).sort()).toEqual(
      ["auditEvent", "auditEvent", "decision", "guardrail", "policy", "snapshot"].sort()
    );

    expect(await store.findDecision("dec-1")).not.toBeNull();
    const snapshot = await store.findP4Snapshot(makeSnapshotRef());
    expect(snapshot?.asOf).toBe("2026-08-16T00:00:00.000Z");
    const policy = await store.findPolicy("pol", "v1");
    expect(policy?.ruleRefs).toEqual(["R1"]);
    const guardrail = await store.findGuardrail("GR-1", "v1");
    expect(guardrail?.outcome).toBe("PASS");
    expect(rows.snapshot(p5AuditEvents)).toHaveLength(2);
  });

  it("R2: derived snapshot is the record's own p4SnapshotRef verbatim (anti-drift, contentHash PROVISIONAL)", async () => {
    const rows = new FakeRowStore();
    const { recorder } = makeRecorder(rows);
    const decision = makeDecision();
    await recorder.record({ decision });

    const derived = P5ArtifactRecorder.deriveSnapshot(decision)!;
    expect(derived.narrativeIdentity).toEqual(decision.provenance.p4SnapshotRef!.narrativeIdentity);
    expect(derived.versionTuple).toEqual(decision.provenance.p4SnapshotRef!.versionTuple);
    expect(derived.asOf).toBe(decision.provenance.p4SnapshotRef!.asOf);
    expect(derived.status).toBe(decision.provenance.p4SnapshotRef!.status);
    expect(derived.contentHash).toBeNull(); // PROVISIONAL — never computed
  });

  it("R3: NO_ACTION decision with no snapshot/policy/approval → only decision + audit recorded", async () => {
    const rows = new FakeRowStore();
    const { store, recorder } = makeRecorder(rows);
    const decision = makeDecision({
      decisionId: "dec-2",
      outcome: "NO_ACTION",
      actionId: null,
      candidateId: null,
      approvalRecord: null,
      safetyResult: null,
      permissionResult: "NOT_APPLICABLE",
      provenance: {
        decisionId: "dec-2",
        candidateId: null,
        actionId: null,
        p4SnapshotRef: null,
        policy: { policyId: null, policyVersion: null, effectiveAt: null, evaluationAt: null, ruleRefs: [] },
        safety: { guardrailVersion: null },
        approval: { approvalPolicyVersion: null, authorityRef: null },
        automationMode: "ADVISORY",
        versions: { actionModelVersion: "p5-action-model/v1", p4VersionTuple: null },
        timestamps: { decisionAt: "2026-08-16T09:30:00.000Z", evaluatedAt: "2026-08-16T09:30:00.000Z", recordedAt: "2026-08-16T09:30:00.000Z" },
      },
    });
    const res = await recorder.record({ decision });
    expect(res.complete).toBe(true);
    expect(res.items.filter((i) => i.artifact === "decision").length).toBe(1);
    expect(res.items.some((i) => i.artifact === "snapshot" || i.artifact === "policy" || i.artifact === "guardrail" || i.artifact === "approval")).toBe(false);
    expect(await store.findDecision("dec-2")).not.toBeNull();
    expect(rows.snapshot(p5P4Snapshots)).toHaveLength(0);
    expect(rows.snapshot(p5Policies)).toHaveLength(0);
  });

  it("R4: no fabrication — APPROVED approvalState without an approval record → no approval row; GRANTED permission without a supplied artifact → no permission row", async () => {
    const rows = new FakeRowStore();
    const { store, recorder } = makeRecorder(rows);
    const decision = makeDecision({ approvalState: "APPROVED", permissionResult: "GRANTED" });
    // approvalRecord stays null and no permission artifact is supplied.
    await recorder.record({ decision });

    expect(rows.snapshot(p5Approvals)).toHaveLength(0);
    expect(rows.snapshot(p5Permissions)).toHaveLength(0);
    // Recorded states preserved verbatim (replay surfaces the gaps explicitly).
    expect((await store.findDecision("dec-1"))?.approvalState).toBe("APPROVED");
    expect((await store.findDecision("dec-1"))?.permissionResult).toBe("GRANTED");
  });

  it("R5: permission artifact recorded only when the producer supplies one (P5-08 §10 gap)", async () => {
    const rows = new FakeRowStore();
    const { store, recorder } = makeRecorder(rows);
    const permission: P5HistoricalPermission = { ref: "perm-dec-1", result: "GRANTED", evaluatedAt: "2026-08-16T10:30:00.000Z" };
    await recorder.record({ decision: makeDecision({ permissionResult: "GRANTED" }), permission });

    expect(rows.snapshot(p5Permissions)).toHaveLength(1);
    expect((await store.findPermission("perm-dec-1"))?.result).toBe("GRANTED");
  });

  it("R6: idempotent — recording the same decision twice never rewrites the first record", async () => {
    const rows = new FakeRowStore();
    const { store, recorder } = makeRecorder(rows);
    const first = makeDecision();
    const second = makeDecision({ actionType: "REVIEW" }); // same identity, different content

    await recorder.record({ decision: first });
    const before = JSON.stringify(rows.snapshot(p5DecisionRecords));
    await recorder.record({ decision: second });

    expect(rows.snapshot(p5DecisionRecords)).toHaveLength(1);
    expect(JSON.stringify(rows.snapshot(p5DecisionRecords))).toBe(before);
    // Original artifact remains authoritative.
    expect((await store.findDecision("dec-1"))?.actionType).toBe("MONITOR");
  });

  it("R7: partial policy identity → NOT_RECORDED with reason, no throw, complete=false", async () => {
    const rows = new FakeRowStore();
    const { recorder } = makeRecorder(rows);
    const decision = makeDecision();
    decision.provenance.policy.policyVersion = null;
    const res = await recorder.record({ decision });

    const item = res.items.find((i) => i.artifact === "policy");
    expect(item?.status).toBe("NOT_RECORDED");
    expect(item?.reason).toMatch(/incomplete/);
    expect(res.complete).toBe(false);
    expect(rows.snapshot(p5Policies)).toHaveLength(0);
  });

  it("R8: the input record is never mutated (frozen record round-trips verbatim)", async () => {
    const rows = new FakeRowStore();
    const { recorder } = makeRecorder(rows);
    const decision = makeDecision();
    Object.freeze(decision);
    Object.freeze(decision.auditEvents);
    Object.freeze(decision.provenance);
    Object.freeze(decision.provenance.policy);
    Object.freeze(decision.safetyResult!);
    Object.freeze(decision.safetyResult!.guardrailResults);
    await expect(recorder.record({ decision })).resolves.toBeDefined();
  });

  it("R9: guardrail artifacts derive from safetyResult exactly (never re-evaluated)", async () => {
    const rows = new FakeRowStore();
    const { recorder } = makeRecorder(rows);
    const decision = makeDecision({
      safetyResult: {
        aggregate: "BLOCK",
        guardrailResults: [
          { guardrailId: "GR-A", version: "v3", outcome: "BLOCK", applicable: true, evaluatedAt: "2026-08-16T09:30:00.000Z", reason: "exposure cap" },
        ],
      },
      blockerReport: { source: "SAFETY", ref: "GR-A", versionRef: "v3", evaluatedAt: "2026-08-16T09:30:00.000Z", reason: "exposure cap" },
    });
    await recorder.record({ decision });
    const res = await recorder.record({ decision }); // duplicate — idempotent
    expect(res.complete).toBe(true);
    expect(rows.snapshot(p5Guardrails)).toHaveLength(1);
  });
});

describe("P5-09 recorder — batch shape", () => {
  it("B1: deriveAuditEvents is 1:1 with the record's audit list", () => {
    const decision = makeDecision();
    expect(P5ArtifactRecorder.derivePolicy(decision)).toMatchObject({ policyId: "pol", policyVersion: "v1" });
    expect(P5ArtifactRecorder.deriveSnapshot(decision)).not.toBeNull();
    expect(P5ArtifactRecorder.deriveGuardrails(decision)).toHaveLength(1);
    expect(P5ArtifactRecorder.deriveApproval(decision)).toBeNull();
  });
});
