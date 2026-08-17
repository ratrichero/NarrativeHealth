import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ArtifactResolver,
  NoHistoricalArtifactStore,
  type HistoricalArtifactStore,
} from "../artifact-resolver";
import { P5_AUDIT_EVENT_TYPES, ReplayEngine } from "../replay-engine";
import type {
  P5HistoricalApproval,
  P5HistoricalGuardrail,
  P5HistoricalPermission,
  P5HistoricalPolicy,
  P5HistoricalSnapshot,
} from "../types";
import type { P5AuditEvent, P5DecisionRecord, P5P4SnapshotRef } from "../../types";

// ---------------------------------------------------------------------------
// P5-07-IMPL ReplayEngine semantic tests — decisionId anchor, historical-over-
// live, exact refs, anti-drift, replay namespace isolation, replay ≠
// execution, no hidden score, no BUY/SELL, P4-06 independence.
// ---------------------------------------------------------------------------

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

/** In-memory historical artifact store for tests (read-only; no mutation surface). */
class FakeStore implements HistoricalArtifactStore {
  constructor(
    private readonly data: {
      decisions?: Record<string, P5DecisionRecord>;
      snapshots?: Record<string, P5HistoricalSnapshot>;
      policies?: Record<string, P5HistoricalPolicy>;
      guardrails?: Record<string, P5HistoricalGuardrail>;
      approvals?: Record<string, P5HistoricalApproval>;
      permissions?: Record<string, P5HistoricalPermission>;
    } = {}
  ) {}

  async findDecision(decisionId: string): Promise<P5DecisionRecord | null> {
    return this.data.decisions?.[decisionId] ?? null;
  }
  async findP4Snapshot(ref: P5P4SnapshotRef): Promise<P5HistoricalSnapshot | null> {
    return this.data.snapshots?.[String(ref.narrativeIdentity.narrativeId)] ?? null;
  }
  async findPolicy(policyId: string, version: string): Promise<P5HistoricalPolicy | null> {
    return this.data.policies?.[`${policyId}@${version}`] ?? this.data.policies?.[policyId] ?? null;
  }
  async findGuardrail(guardrailId: string, _version: string | null): Promise<P5HistoricalGuardrail | null> {
    return this.data.guardrails?.[guardrailId] ?? null;
  }
  async findApproval(approvalId: string): Promise<P5HistoricalApproval | null> {
    return this.data.approvals?.[approvalId] ?? null;
  }
  async findPermission(ref: string): Promise<P5HistoricalPermission | null> {
    return this.data.permissions?.[ref] ?? null;
  }
}

/** A complete, consistent historical store — decision + snapshot + policy. */
function fullStore(record: P5DecisionRecord = makeRecord()): FakeStore {
  const snapshot = record.provenance.p4SnapshotRef ?? makeSnapshotRef();
  const policy = record.provenance.policy;
  const store: ConstructorParameters<typeof FakeStore>[0] = {
    decisions: { [record.decisionId]: record },
    snapshots: { "1": makeSnapshotArtifact() },
    policies: {
      [`${policy.policyId}@${policy.policyVersion}`]: makePolicy({
        policyId: policy.policyId,
        policyVersion: policy.policyVersion ?? undefined,
        effectiveAt: policy.effectiveAt ?? undefined,
        evaluationAt: policy.evaluationAt ?? undefined,
        ruleRefs: policy.ruleRefs,
      }),
    },
  };
  if (record.safetyResult?.guardrailResults?.[0]) {
    const gr = record.safetyResult.guardrailResults[0];
    store.guardrails = { [gr.guardrailId]: makeGuardrail({ guardrailId: gr.guardrailId, version: gr.version, outcome: gr.outcome }) };
  }
  if (record.approvalRecord) {
    store.approvals = {
      [record.approvalRecord.approvalId]: makeApproval({
        approvalId: record.approvalRecord.approvalId,
        decisionIdRef: record.approvalRecord.decisionIdRef,
        state: record.approvalRecord.state,
      }),
    };
  }
  if (record.permissionResult === "GRANTED") {
    store.permissions = { "perm-1": makePermission() };
  }
  return new FakeStore(store);
}

function engine(
  store: HistoricalArtifactStore,
  options: { inspectLiveContext?: (dimension: string, ref: string) => string | null } = {}
): ReplayEngine {
  return new ReplayEngine(new ArtifactResolver(store), {
    inspectLiveContext: options.inspectLiveContext,
  });
}

describe("P5-07-IMPL ReplayEngine — decisionId anchor + availability", () => {
  it("1: decisionId is the only replay anchor — unknown decisionId is REPLAY_UNAVAILABLE, never another decision", async () => {
    const record = makeRecord();
    const e = engine(fullStore(record));
    const report = await e.reconstruct("dec-999");
    expect(report.result).toBe("REPLAY_UNAVAILABLE");
    expect(report.reconstruction.decision).toBeNull();
    expect(report.reconstruction.outcome).toBeNull();
    // No narrative/current-state based lookup path exists on the engine.
    const proto = Object.getOwnPropertyNames(ReplayEngine.prototype);
    expect(proto).toEqual(expect.arrayContaining(["reconstruct", "validate", "compare", "constructor"]));
    expect(proto.some((n) => /subject|narrative|live/i.test(n))).toBe(false);
  });

  it("capability exists but historical data unavailable — default absence store → REPLAY_UNAVAILABLE with explicit classification", async () => {
    const e = new ReplayEngine(new ArtifactResolver(new NoHistoricalArtifactStore()));
    const report = await e.reconstruct("dec-1");
    expect(report.result).toBe("REPLAY_UNAVAILABLE");
    expect(report.validation.findings.some((f) => f.type === "ARTIFACT_MISSING" && f.dimension === "decision")).toBe(true);
    expect(report.sideEffects).toBe("NONE");
  });
});

describe("P5-07-IMPL historical-over-live + anti-drift", () => {
  it("2: historical artifact wins over live — live policy context is labeled LIVE_CONTEXT, never truth", async () => {
    const record = makeRecord();
    const e = engine(new FakeStore({ decisions: { [record.decisionId]: record } }), {
      inspectLiveContext: (dimension, ref) => (dimension === "policy" ? `current policy ${ref} v2 exists in live config` : null),
    });
    const report = await e.reconstruct("dec-1");
    // Historical policy artifact is MISSING → REPLAY_UNAVAILABLE despite live data.
    expect(report.result).toBe("REPLAY_UNAVAILABLE");
    expect(report.reconstruction.references.policy?.resolution).toBe("MISSING");
    expect(report.reconstruction.references.policy?.artifact).toBeNull();
    const liveFinding = report.validation.findings.find((f) => f.liveContext && f.dimension === "policy");
    expect(liveFinding).toBeDefined();
    expect(liveFinding?.detail).toMatch(/LIVE_CONTEXT/);
  });

  it("3: current/live P4 cannot replace the historical snapshot — SNAPSHOT_MISSING + LIVE_CONTEXT label", async () => {
    const record = makeRecord();
    const store = new FakeStore({
      decisions: { [record.decisionId]: record },
      policies: { "pol@v1": makePolicy() },
    });
    const e = engine(store, {
      inspectLiveContext: (dimension) => (dimension === "p4Snapshot" ? "current P4 view available" : null),
    });
    const report = await e.reconstruct("dec-1");
    expect(report.result).toBe("REPLAY_UNAVAILABLE");
    expect(report.reconstruction.snapshot.state).toBe("SNAPSHOT_MISSING");
    expect(report.reconstruction.snapshot.ref?.asOf).toBe("2026-08-16T00:00:00.000Z");
    const liveFinding = report.validation.findings.find((f) => f.liveContext && f.dimension === "p4Snapshot");
    expect(liveFinding).toBeDefined();
    expect(liveFinding?.detail).toMatch(/LIVE_CONTEXT/);
    // The live P4 view never became the reconstructed snapshot artifact.
    expect(report.reconstruction.snapshot.ref?.status).toBe("OK"); // recorded ref preserved as-is
  });
});

describe("P5-07-IMPL exact reference + missing/mismatch semantics", () => {
  it("4: exact version resolution — record refs v1; store only has v2 → VERSION_MISMATCH, never silent v2 use", async () => {
    const record = makeRecord();
    const store = new FakeStore({
      decisions: { [record.decisionId]: record },
      snapshots: { "1": makeSnapshotArtifact() },
      policies: { pol: makePolicy({ policyVersion: "v2" }) }, // fallback key — store ignores version
    });
    const report = await engine(store).reconstruct("dec-1");
    expect(report.result).toBe("REPLAY_UNAVAILABLE");
    expect(report.validation.findings.some((f) => f.type === "ARTIFACT_VERSION_MISMATCH" && f.dimension === "policy")).toBe(true);
    expect(report.reconstruction.references.policy?.resolution).toBe("VERSION_MISMATCH");
  });

  it("5: missing required artifact → REPLAY_UNAVAILABLE with ARTIFACT_MISSING classification", async () => {
    const record = makeRecord();
    const store = new FakeStore({ decisions: { [record.decisionId]: record } }); // no snapshot, no policy
    const report = await engine(store).reconstruct("dec-1");
    expect(report.result).toBe("REPLAY_UNAVAILABLE");
    expect(report.validation.findings.some((f) => f.type === "ARTIFACT_MISSING" && f.dimension === "policy")).toBe(true);
    expect(report.validation.findings.some((f) => f.type === "ARTIFACT_MISSING" && f.dimension === "p4Snapshot")).toBe(true);
  });

  it("6: version mismatch is a distinct finding, not a generic not-found", async () => {
    const record = makeRecord();
    const store = new FakeStore({
      decisions: { [record.decisionId]: record },
      snapshots: { "1": makeSnapshotArtifact() },
      policies: { pol: makePolicy({ policyVersion: "v3" }) },
    });
    const report = await engine(store).validate("dec-1");
    const finding = report.validation.findings.find((f) => f.dimension === "policy");
    expect(finding?.type).toBe("ARTIFACT_VERSION_MISMATCH");
    expect(finding?.type).not.toBe("ARTIFACT_MISSING");
  });

  it("7: hash mismatch — recorded hash differs from stored → SNAPSHOT_HASH_MISMATCH + REPLAY_UNAVAILABLE", async () => {
    const record = makeRecord({
      provenance: { ...makeRecord().provenance, p4SnapshotRef: makeSnapshotRef({ contentHash: "abc123" }) },
    });
    const store = new FakeStore({
      decisions: { [record.decisionId]: record },
      snapshots: { "1": makeSnapshotArtifact({ contentHash: "def456" }) },
      policies: { "pol@v1": makePolicy() },
    });
    const report = await engine(store).validate("dec-1");
    expect(report.result).toBe("REPLAY_UNAVAILABLE");
    expect(report.reconstruction.snapshot.state).toBe("SNAPSHOT_HASH_MISMATCH");
    expect(report.validation.findings.some((f) => f.type === "ARTIFACT_HASH_MISMATCH")).toBe(true);
  });
});

describe("P5-07-IMPL contradiction handling", () => {
  it("8: decision APPROVED vs audit DENIED → CONTRADICTION, evidence preserved", async () => {
    const audit: P5AuditEvent[] = [
      { eventId: "e1", eventType: P5_AUDIT_EVENT_TYPES.APPROVAL_REQUESTED, timestamp: "2026-08-16T09:40:00.000Z", actor: "system", decisionIdRef: "dec-1", previousState: null, newState: "PENDING", reason: null, policyVersionRef: null, guardrailRef: null, approvalRef: null },
      { eventId: "e2", eventType: P5_AUDIT_EVENT_TYPES.APPROVAL_DENIED, timestamp: "2026-08-16T10:00:00.000Z", actor: "owner", decisionIdRef: "dec-1", previousState: "PENDING", newState: "DENIED", reason: "not authorized", policyVersionRef: null, guardrailRef: null, approvalRef: "ap-1" },
    ];
    const record = makeRecord({ approvalState: "APPROVED", approvalRecord: null, auditEvents: audit });
    const store = new FakeStore({
      decisions: { [record.decisionId]: record },
      snapshots: { "1": makeSnapshotArtifact() },
      policies: { "pol@v1": makePolicy() },
    });
    const report = await engine(store).validate("dec-1");
    expect(report.result).toBe("CONTRADICTION");
    expect(report.equivalence).toBe("NON_EQUIVALENT"); // conflicting artifacts ⇒ non-equivalence (§13)
    const contradiction = report.validation.findings.find((f) => f.type === "ARTIFACT_CONTRADICTION");
    expect(contradiction).toBeDefined();
    // Evidence preserved verbatim.
    expect(report.reconstruction.auditEvents).toEqual(audit);
    expect(report.reconstruction.decision?.approvalState).toBe("APPROVED");
  });

  it("approval record referencing an obsolete decision → UNRESOLVED, no silent fix", async () => {
    const record = makeRecord({
      approvalState: "APPROVED",
      approvalRecord: {
        approvalId: "ap-1",
        decisionIdRef: "dec-999", // obsolete reference
        state: "APPROVED",
        authorityRef: "AUTH-1",
        actor: "owner",
        timestamp: "2026-08-16T10:00:00.000Z",
        scope: null,
        approvalPolicyVersion: "ap/v1",
        invalidation: null,
      },
    });
    const store = new FakeStore({
      decisions: { [record.decisionId]: record },
      snapshots: { "1": makeSnapshotArtifact() },
      policies: { "pol@v1": makePolicy() },
      approvals: { "ap-1": makeApproval({ decisionIdRef: "dec-999", state: "APPROVED" }) },
    });
    const report = await engine(store).validate("dec-1");
    expect(report.result).toBe("CONTRADICTION");
    expect(report.validation.findings.some((f) => f.type === "UNRESOLVED")).toBe(true);
  });
});

describe("P5-07-IMPL determinism + replay ≠ execution", () => {
  it("9: deterministic — same inputs produce identical reports", async () => {
    const store = fullStore();
    const e = engine(store);
    const first = await e.reconstruct("dec-1");
    const second = await e.reconstruct("dec-1");
    expect(second).toEqual(first);
    expect(first.replayContractVersion).toBe("p5-replay/v1");
  });

  it("10: replay != execution — zero side effects, no execution/retry/mutation surface", async () => {
    const report = await engine(fullStore()).reconstruct("dec-1");
    expect(report.sideEffects).toBe("NONE");
    // No engine method can execute, retry, approve or mutate.
    const proto = Object.getOwnPropertyNames(ReplayEngine.prototype);
    for (const name of proto) {
      expect(name.toLowerCase()).not.toMatch(/execute|retry|approve|mutate|write|persist|dispatch/);
    }
  });
});

describe("P5-07-IMPL replay namespace isolation + outcome preservation", () => {
  it("11/12/13: replay failure is never NO_ACTION and never NOT_DETERMINED", async () => {
    const report = await engine(new FakeStore({})).reconstruct("dec-1");
    expect(report.result).toBe("REPLAY_UNAVAILABLE");
    expect(report.result).not.toBe("NO_ACTION");
    expect(report.result).not.toBe("NOT_DETERMINED");
    expect(report.reconstruction.outcome).toBeNull();
    expect(report.reconstruction.outcome).not.toBe("NO_ACTION");
    expect(report.reconstruction.outcome).not.toBe("NOT_DETERMINED");
    // Replay results are not DecisionOutcomes (RP-016).
    expect(["REPLAY_COMPLETE", "REPLAY_PARTIAL", "REPLAY_UNAVAILABLE", "CONTRADICTION"]).toContain(report.result);
  });

  it("14: SUPPRESSED remains SUPPRESSED — never collapsed into a no-action narrative", async () => {
    const record = makeRecord({ suppressed: true, outcome: "NO_ACTION", actionType: null });
    const store = fullStore(record);
    const report = await engine(store).reconstruct("dec-1");
    expect(report.reconstruction.decision?.suppressed).toBe(true);
    expect(report.reconstruction.suppressed).toBe(true);
    // The recorded outcome is preserved exactly as recorded.
    expect(report.reconstruction.outcome).toBe("NO_ACTION");
    expect(report.result).toBe("REPLAY_COMPLETE");
  });

  it("15: SAFETY_BLOCKED remains SAFETY_BLOCKED with guardrail provenance reconstructed", async () => {
    const record = makeRecord({
      safetyResult: {
        aggregate: "BLOCK",
        guardrailResults: [
          { guardrailId: "GR-1", version: "v1", outcome: "BLOCK", applicable: true, evaluatedAt: "2026-08-16T09:30:00.000Z", reason: "stale P4 context" },
        ],
      },
      provenance: { ...makeRecord().provenance, safety: { guardrailVersion: "v1" } },
    });
    const store = fullStore(record);
    const report = await engine(store).reconstruct("dec-1");
    expect(report.reconstruction.decision?.safetyResult?.aggregate).toBe("BLOCK");
    expect(report.reconstruction.references.guardrail?.resolution).toBe("FOUND");
    expect(report.reconstruction.references.guardrail?.artifact?.outcome).toBe("BLOCK");
    expect(report.result).toBe("REPLAY_COMPLETE");
  });

  it("16: APPROVAL_DENIED remains APPROVAL_DENIED with approval provenance reconstructed", async () => {
    const record = makeRecord({
      approvalState: "DENIED",
      approvalRecord: {
        approvalId: "ap-1",
        decisionIdRef: "dec-1",
        state: "DENIED",
        authorityRef: "AUTH-1",
        actor: "owner",
        timestamp: "2026-08-16T10:00:00.000Z",
        scope: "v1",
        approvalPolicyVersion: "ap/v1",
        invalidation: null,
      },
    });
    const store = fullStore(record);
    const report = await engine(store).reconstruct("dec-1");
    expect(report.reconstruction.decision?.approvalState).toBe("DENIED");
    expect(report.reconstruction.references.approval?.resolution).toBe("FOUND");
    expect(report.reconstruction.references.approval?.artifact?.state).toBe("DENIED");
    expect(report.result).toBe("REPLAY_COMPLETE");
    expect(report.reconstruction.decision?.approvalState).not.toBe("EXECUTED");
  });

  it("granted permission without a recorded permission ref → explicit unavailable finding, not fabricated ref", async () => {
    const record = makeRecord({ permissionResult: "GRANTED" });
    const store = fullStore(record);
    const report = await engine(store).reconstruct("dec-1");
    const finding = report.validation.findings.find((f) => f.dimension === "permission");
    expect(finding?.type).toBe("ARTIFACT_UNAVAILABLE");
    expect(report.result).toBe("REPLAY_PARTIAL");
    // permissionResult preserved as recorded, never interpreted as executed.
    expect(report.reconstruction.decision?.permissionResult).toBe("GRANTED");
    expect(report.reconstruction.orthogonalStates.executionState).toBe("NOT_APPLICABLE");
  });
});

describe("P5-07-IMPL audit chronology + immutability", () => {
  it("17: chronology validation detects duplicates, gaps and timestamp disorder — never repairs", async () => {
    const audit: P5AuditEvent[] = [
      { eventId: "e1", eventType: P5_AUDIT_EVENT_TYPES.DECISION_CREATED, timestamp: "2026-08-16T09:30:00.000Z", actor: "system", decisionIdRef: "dec-1", previousState: null, newState: "DECIDED", reason: null, policyVersionRef: null, guardrailRef: null, approvalRef: null },
      { eventId: "e2", eventType: P5_AUDIT_EVENT_TYPES.DECISION_SELECTED, timestamp: "2026-08-16T09:31:00.000Z", actor: "system", decisionIdRef: "dec-1", previousState: null, newState: "SELECTED", reason: null, policyVersionRef: "v1", guardrailRef: null, approvalRef: null },
      { eventId: "e2", eventType: P5_AUDIT_EVENT_TYPES.DECISION_SELECTED, timestamp: "2026-08-16T09:32:00.000Z", actor: "system", decisionIdRef: "dec-1", previousState: null, newState: "SELECTED", reason: null, policyVersionRef: "v1", guardrailRef: null, approvalRef: null }, // duplicate eventId
      { eventId: "e4", eventType: P5_AUDIT_EVENT_TYPES.APPROVAL_DENIED, timestamp: "2026-08-16T09:20:00.000Z", actor: "owner", decisionIdRef: "dec-1", previousState: null, newState: "DENIED", reason: null, policyVersionRef: null, guardrailRef: null, approvalRef: null }, // no APPROVAL_REQUESTED + timestamp disorder
    ];
    const record = makeRecord({ auditEvents: audit });
    const store = fullStore(record);
    const report = await engine(store).validate("dec-1");
    const types = report.validation.findings.map((f) => f.type);
    expect(types).toContain("CHRONOLOGY_DUPLICATE");
    expect(types).toContain("CHRONOLOGY_GAP");
    expect(types).toContain("CHRONOLOGY_ORDER");
    expect(report.result).toBe("REPLAY_PARTIAL");
    // Audit events untouched.
    expect(report.reconstruction.auditEvents).toEqual(audit);
  });

  it("18: no mutation of historical records — frozen records pass through all three modes unchanged", async () => {
    const record = makeRecord();
    Object.freeze(record);
    Object.freeze(record.auditEvents);
    Object.freeze(record.provenance);
    const before = JSON.stringify(record);
    const store = fullStore(record);
    const e = engine(store);
    await e.reconstruct("dec-1");
    await e.validate("dec-1");
    await e.compare("dec-1");
    expect(JSON.stringify(record)).toBe(before);
  });
});

describe("P5-07-IMPL COMPARE + equivalence", () => {
  it("19: COMPARE never triggers live policy/safety evaluation — recorded vs reconstructed only", async () => {
    const liveSpy = jest.fn(() => null);
    const e = new ReplayEngine(new ArtifactResolver(fullStore()), {
      inspectLiveContext: liveSpy,
    });
    const report = await e.compare("dec-1");
    // All historical artifacts resolved; the live inspector was never consulted.
    expect(liveSpy).not.toHaveBeenCalled();
    expect(report.result).toBe("REPLAY_COMPLETE");
    expect(report.equivalence).toBe("EXACT");
    expect(report.sideEffects).toBe("NONE");
  });

  it("equivalence EXACT — identity, outcome, states, provenance and versions identical", async () => {
    const report = await engine(fullStore()).reconstruct("dec-1");
    expect(report.result).toBe("REPLAY_COMPLETE");
    expect(report.equivalence).toBe("EXACT");
    expect(report.reconstruction.identityChain).toEqual({ candidateId: "cand-1", actionId: null });
  });

  it("equivalence SEMANTIC — stored policy metadata differs while identity+version match", async () => {
    const record = makeRecord();
    const store = new FakeStore({
      decisions: { [record.decisionId]: record },
      snapshots: { "1": makeSnapshotArtifact() },
      policies: { "pol@v1": makePolicy({ evaluationAt: "2026-08-16T11:00:00.000Z" }) }, // differs from recorded 09:30
    });
    const report = await engine(store).reconstruct("dec-1");
    expect(report.result).toBe("REPLAY_COMPLETE");
    expect(report.equivalence).toBe("SEMANTIC");
  });

  it("version mismatch certification — REPLAY_UNAVAILABLE, never fuzzy/approximately-equal (§13)", async () => {
    const record = makeRecord();
    const store = new FakeStore({
      decisions: { [record.decisionId]: record },
      snapshots: { "1": makeSnapshotArtifact() },
      policies: { pol: makePolicy({ policyVersion: "v2" }) },
    });
    const report = await engine(store).compare("dec-1");
    expect(report.result).toBe("REPLAY_UNAVAILABLE");
    expect(report.equivalence).toBe("REPLAY_UNAVAILABLE");
    expect(report.reconstruction.references.policy?.resolution).toBe("VERSION_MISMATCH");
  });

  it("all three modes share the deterministic core — only the declared mode differs", async () => {
    const store = fullStore();
    const e = engine(store);
    const reconstruct = await e.reconstruct("dec-1");
    const validate = await e.validate("dec-1");
    const compare = await e.compare("dec-1");
    expect(reconstruct.mode).toBe("RECONSTRUCT");
    expect(validate.mode).toBe("VALIDATE");
    expect(compare.mode).toBe("COMPARE");
    expect(validate.result).toBe(reconstruct.result);
    expect(compare.result).toBe(reconstruct.result);
    expect(validate.reconstruction).toEqual(reconstruct.reconstruction);
  });
});

describe("P5-07-IMPL no hidden score, no BUY/SELL, P4-06 independence", () => {
  it("20: no hidden score/threshold in reports or source", async () => {
    const report = await engine(fullStore()).reconstruct("dec-1");
    const serialized = JSON.stringify(report).toUpperCase();
    expect(serialized).not.toContain("SCORE");
    expect(serialized).not.toContain("THRESHOLD");
    const sourceFiles = [
      join(__dirname, "..", "types.ts"),
      join(__dirname, "..", "artifact-resolver.ts"),
      join(__dirname, "..", "replay-engine.ts"),
    ];
    for (const file of sourceFiles) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/\b(score|threshold)\b/i);
    }
  });

  it("21: no BUY/SELL/LONG/SHORT/ORDER/TRADE semantics in reports or source", async () => {
    const report = await engine(fullStore()).reconstruct("dec-1");
    const serialized = JSON.stringify(report).toUpperCase();
    for (const token of ["BUY", "SELL", "LONG", "SHORT", "ORDER", "TRADE"]) {
      expect(serialized).not.toContain(token);
    }
    const sourceFiles = [
      join(__dirname, "..", "types.ts"),
      join(__dirname, "..", "artifact-resolver.ts"),
      join(__dirname, "..", "replay-engine.ts"),
    ];
    for (const file of sourceFiles) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/\b(BUY|SELL|LONG|SHORT|TRADE)\b/);
    }
  });

  it("22: P4-06 independence — replay source never references P4-06 or provisional rules", async () => {
    const sourceFiles = [
      join(__dirname, "..", "types.ts"),
      join(__dirname, "..", "artifact-resolver.ts"),
      join(__dirname, "..", "replay-engine.ts"),
    ];
    for (const file of sourceFiles) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/P4-06|INSUFFICIENT_EVIDENCE|provisional rule|promote/i);
    }
  });
});
