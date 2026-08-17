import { describe, expect, it } from "@jest/globals";
import {
  ArtifactResolver,
  NoHistoricalArtifactStore,
  type HistoricalArtifactStore,
} from "../artifact-resolver";
import type {
  P5HistoricalApproval,
  P5HistoricalGuardrail,
  P5HistoricalPermission,
  P5HistoricalPolicy,
  P5HistoricalSnapshot,
} from "../types";
import type { P5DecisionRecord, P5P4SnapshotRef } from "../../types";

// ---------------------------------------------------------------------------
// P5-07-IMPL resolver tests — exact identity + version resolution; FOUND /
// MISSING / VERSION_MISMATCH / HASH_MISMATCH / UNAVAILABLE never collapse
// into a generic "not found" (P5-07 §5, §6, §11).
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
  evaluationAt: "2026-08-16T00:00:00.000Z",
  ruleRefs: ["R1"],
  ...overrides,
});

const makeGuardrail = (overrides: Partial<P5HistoricalGuardrail> = {}): P5HistoricalGuardrail => ({
  guardrailId: "GR-1",
  version: "v1",
  outcome: "BLOCK",
  evaluatedAt: "2026-08-16T00:00:00.000Z",
  ...overrides,
});

const makeApproval = (overrides: Partial<P5HistoricalApproval> = {}): P5HistoricalApproval => ({
  approvalId: "ap-1",
  decisionIdRef: "dec-1",
  state: "APPROVED",
  authorityRef: "AUTH-1",
  actor: "owner",
  timestamp: "2026-08-16T00:00:00.000Z",
  approvalPolicyVersion: "ap/v1",
  ...overrides,
});

const makePermission = (overrides: Partial<P5HistoricalPermission> = {}): P5HistoricalPermission => ({
  ref: "perm-1",
  result: "GRANTED",
  evaluatedAt: "2026-08-16T00:00:00.000Z",
  ...overrides,
});

/**
 * In-memory store for tests. The policy map's fallback key (`pol` without
 * version) simulates a store that ignores the requested version — the
 * resolver must still enforce exactness itself.
 */
class FakeStore implements HistoricalArtifactStore {
  constructor(
    private readonly data: {
      snapshots?: Record<string, P5HistoricalSnapshot>;
      policies?: Record<string, P5HistoricalPolicy>;
      guardrails?: Record<string, P5HistoricalGuardrail>;
      approvals?: Record<string, P5HistoricalApproval>;
      permissions?: Record<string, P5HistoricalPermission>;
    } = {}
  ) {}

  async findDecision(): Promise<P5DecisionRecord | null> {
    return null;
  }

  async findP4Snapshot(ref: P5P4SnapshotRef): Promise<P5HistoricalSnapshot | null> {
    return this.data.snapshots?.[String(ref.narrativeIdentity.narrativeId)] ?? null;
  }
  async findPolicy(policyId: string, _version: string): Promise<P5HistoricalPolicy | null> {
    return this.data.policies?.[`${policyId}@${_version}`] ?? this.data.policies?.[policyId] ?? null;
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

describe("P5-07-IMPL ArtifactResolver — exact reference resolution", () => {
  it("4a: exact policy version resolves FOUND; a different requested version never silently uses another", async () => {
    // Store has only v2; the record references v1.
    const resolver = new ArtifactResolver(new FakeStore({ policies: { pol: makePolicy({ policyVersion: "v2" }) } }));
    const res = await resolver.resolvePolicy("pol", "v1");
    expect(res.resolution).toBe("VERSION_MISMATCH");
    expect(res.requestedVersion).toBe("v1");
    expect(res.artifact?.policyVersion).toBe("v2");
    expect(res.resolution).not.toBe("FOUND"); // never silently resolved to v2

    // Exact v2 resolves FOUND.
    const exact = await resolver.resolvePolicy("pol", "v2");
    expect(exact.resolution).toBe("FOUND");
  });

  it("4b: missing policy → MISSING, distinct from VERSION_MISMATCH", async () => {
    const resolver = new ArtifactResolver(new FakeStore({}));
    const res = await resolver.resolvePolicy("pol", "v1");
    expect(res.resolution).toBe("MISSING");
    expect(res.artifact).toBeNull();
  });

  it("5: snapshot anti-drift — missing snapshot artifact → SNAPSHOT_MISSING, never live MATCH", async () => {
    const resolver = new ArtifactResolver(new FakeStore({}));
    const res = await resolver.resolveP4Snapshot(makeSnapshotRef());
    expect(res.resolution).toBe("MISSING");
    expect(res.snapshotState).toBe("SNAPSHOT_MISSING");
  });

  it("snapshot version mismatch — stored artifact at a different versionTuple → SNAPSHOT_VERSION_MISMATCH", async () => {
    const resolver = new ArtifactResolver(
      new FakeStore({
        snapshots: {
          "1": makeSnapshotArtifact({
            versionTuple: {
              algorithmVersion: "p4-decision-support",
              semanticVersion: "2", // recorded ref is semanticVersion "1"
              signalCatalogVersion: "v1",
              interpretationRuleVersion: "p4-03/v1",
            },
          }),
        },
      })
    );
    const res = await resolver.resolveP4Snapshot(makeSnapshotRef());
    expect(res.resolution).toBe("VERSION_MISMATCH");
    expect(res.snapshotState).toBe("SNAPSHOT_VERSION_MISMATCH");
  });

  it("7a: hash mismatch — recorded contentHash present and differs from stored → SNAPSHOT_HASH_MISMATCH", async () => {
    const ref = makeSnapshotRef({ contentHash: "abc123" });
    const resolver = new ArtifactResolver(
      new FakeStore({ snapshots: { "1": makeSnapshotArtifact({ contentHash: "def456" }) } })
    );
    const res = await resolver.resolveP4Snapshot(ref);
    expect(res.resolution).toBe("HASH_MISMATCH");
    expect(res.snapshotState).toBe("SNAPSHOT_HASH_MISMATCH");
  });

  it("7b: recorded hash with no stored hash → UNAVAILABLE, never assumed to match (G10)", async () => {
    const ref = makeSnapshotRef({ contentHash: "abc123" });
    const resolver = new ArtifactResolver(new FakeStore({ snapshots: { "1": makeSnapshotArtifact({ contentHash: null }) } }));
    const res = await resolver.resolveP4Snapshot(ref);
    expect(res.resolution).toBe("UNAVAILABLE");
    expect(res.snapshotState).toBe("SNAPSHOT_UNAVAILABLE");
    expect(res.detail).toMatch(/never assumed to match/);
  });

  it("7c: no recorded contentHash → SNAPSHOT_MATCH with no hash check (PROVISIONAL preserved)", async () => {
    const resolver = new ArtifactResolver(new FakeStore({ snapshots: { "1": makeSnapshotArtifact() } }));
    const res = await resolver.resolveP4Snapshot(makeSnapshotRef());
    expect(res.resolution).toBe("FOUND");
    expect(res.snapshotState).toBe("SNAPSHOT_MATCH");
  });

  it("guardrail / approval / permission resolve by exact ref and never cross-resolve", async () => {
    const resolver = new ArtifactResolver(
      new FakeStore({
        guardrails: { "GR-1": makeGuardrail() },
        approvals: { "ap-1": makeApproval() },
        permissions: { "perm-1": makePermission() },
      })
    );
    const guardrail = await resolver.resolveGuardrail("GR-1", "v1");
    expect(guardrail.resolution).toBe("FOUND");

    const approval = await resolver.resolveApproval("ap-1");
    expect(approval.resolution).toBe("FOUND");
    expect(approval.artifact?.approvalId).toBe("ap-1");

    const permission = await resolver.resolvePermission("perm-1");
    expect(permission.resolution).toBe("FOUND");

    const missingApproval = await resolver.resolveApproval("ap-999");
    expect(missingApproval.resolution).toBe("MISSING");
  });

  it("default NoHistoricalArtifactStore is read-only and returns absence (capability ≠ data availability)", async () => {
    const resolver = new ArtifactResolver(new NoHistoricalArtifactStore());
    const decision = await resolver.resolveDecision("dec-1");
    expect(decision.resolution).toBe("MISSING");
    const policy = await resolver.resolvePolicy("pol", "v1");
    expect(policy.resolution).toBe("MISSING");

    // The store boundary exposes only read methods.
    const proto = Object.getOwnPropertyNames(NoHistoricalArtifactStore.prototype).sort();
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
});
