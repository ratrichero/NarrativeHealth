import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ActionReadService,
  NoP5DecisionStore,
  type P5DecisionStore,
} from "../read/action-read.service";
import { deriveDisplayState } from "../read/display-state";
import type {
  P4DecisionSupportViewModel,
} from "@/lib/p4/types";
import type {
  P5ActionDecisionReadViewModel,
  P5DecisionRecord,
  P5P4SnapshotRef,
} from "../types";

// ---------------------------------------------------------------------------
// P5-06A semantic tests — the read layer must present records, never invent
// them: no UNKNOWN/DEGRADED/failure/absence → NO_ACTION, no BUY/SELL, no
// hidden score, permission ≠ execution, approval ≠ acknowledgement, audit
// read-only, provenance preserved, P4-06 independent.
// ---------------------------------------------------------------------------

/** Minimal P4 ViewModel fixture (the service reads status/identity/asOf/version only). */
function makeP4Vm(
  overrides: Partial<P4DecisionSupportViewModel> = {}
): P4DecisionSupportViewModel {
  return {
    status: "OK",
    version: {
      algorithmVersion: "p4-decision-support",
      semanticVersion: "1",
      signalCatalogVersion: "v1",
    },
    narrativeIdentity: {
      narrativeId: 1,
      window: "7D",
      algorithmKey: "p3-orchestrator",
      algorithmVersion: "1",
      calculationMode: "observed",
    },
    generatedAt: "2026-08-17T00:00:00.000Z",
    asOf: "2026-08-16T00:00:00.000Z",
    direction: "NEUTRAL",
    signals: [],
    opportunity: "LOW",
    risk: "LOW",
    confidence: "MEDIUM",
    actionability: "LOW",
    explanation: {} as P4DecisionSupportViewModel["explanation"],
    evidence: [],
    historicalContext: null,
    provenance: {
      sourceLayer: "P4",
      derivedFrom: [],
      p2EventRisk: false,
      semanticVersion: "1",
    },
    degradation: [],
    ...overrides,
  } as P4DecisionSupportViewModel;
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
        evaluationAt: "2026-08-16T00:00:00.000Z",
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
        decisionAt: "2026-08-16T00:00:00.000Z",
        evaluatedAt: "2026-08-16T00:00:00.000Z",
        recordedAt: "2026-08-16T00:00:00.000Z",
      },
    },
    auditEvents: [],
    ...overrides,
  };
}

/** Read-only in-memory store for tests — has no mutation surface. */
class FakeStore implements P5DecisionStore {
  constructor(private readonly records: P5DecisionRecord[]) {}
  async findByDecisionId(decisionId: string): Promise<P5DecisionRecord | null> {
    return this.records.find((r) => r.decisionId === decisionId) ?? null;
  }
  async findBySubject(subject: { narrativeId: number }): Promise<P5DecisionRecord | null> {
    return this.records.find((r) => r.subject.narrativeId === subject.narrativeId) ?? null;
  }
}

const p4Ok = async (): Promise<P4DecisionSupportViewModel | null> => makeP4Vm();
const p4Null = async (): Promise<P4DecisionSupportViewModel | null> => null;

function makeService(
  records: P5DecisionRecord[],
  getP4: (narrativeId: number) => Promise<P4DecisionSupportViewModel | null> = p4Ok
): ActionReadService {
  return new ActionReadService({ store: new FakeStore(records), getP4 });
}

describe("P5-06A Action Read Service — lookup and availability", () => {
  it("A: returns the recorded decision for a known decisionId (availability OK)", async () => {
    const record = makeRecord();
    const view = await makeService([record]).getDecisionByDecisionId("dec-1");
    expect(view.decisionPresence).toBe("PRESENT");
    expect(view.availability).toBe("OK");
    expect(view.decision?.decisionId).toBe("dec-1");
    expect(view.decision?.outcome).toBe("SELECTED");
  });

  it("B: missing decisionId → DECISION_NOT_FOUND, never NO_ACTION", async () => {
    const view = await makeService([]).getDecisionByDecisionId("nope");
    expect(view.decisionPresence).toBe("ABSENT");
    expect(view.availability).toBe("DECISION_NOT_FOUND");
    expect(view.displayState).toBe("ABSENT");
    expect(view.displayState).not.toBe("NO_ACTION");
  });

  it("J: subject with no record but live P4 context → NO_DECISION_RECORD, ABSENT", async () => {
    const view = await makeService([]).getNarrativeActionReadView(1);
    expect(view.decisionPresence).toBe("ABSENT");
    expect(view.availability).toBe("NO_DECISION_RECORD");
    expect(view.displayState).toBe("ABSENT");
    expect(view.context?.source).toBe("LIVE_P4_CONTEXT");
    expect(view.context?.p4SnapshotRef?.asOf).toBe("2026-08-16T00:00:00.000Z");
  });
});

describe("P5-06A outcome semantics — 8 situations never collapsed", () => {
  it("C: recorded NO_ACTION → displayState NO_ACTION", async () => {
    const view = await makeService([makeRecord({ outcome: "NO_ACTION", actionType: null })]).getNarrativeActionReadView(1);
    expect(view.decision?.outcome).toBe("NO_ACTION");
    expect(view.displayState).toBe("NO_ACTION");
  });

  it("D: BLOCKED outcome (source POLICY) → POLICY_BLOCKED", async () => {
    const view = await makeService([
      makeRecord({
        outcome: "BLOCKED",
        actionType: null,
        blockerReport: { source: "POLICY", ref: "R2", versionRef: "v1", evaluatedAt: "2026-08-16T00:00:00.000Z", reason: "consequential action on degraded context" },
      }),
    ]).getNarrativeActionReadView(1);
    expect(view.displayState).toBe("POLICY_BLOCKED");
    expect(view.decision?.blockerReport?.source).toBe("POLICY");
  });

  it("E: NOT_DETERMINED → displayState NOT_DETERMINED", async () => {
    const view = await makeService([makeRecord({ outcome: "NOT_DETERMINED", actionType: null })]).getNarrativeActionReadView(1);
    expect(view.displayState).toBe("NOT_DETERMINED");
  });

  it("F: SUPPRESSED layer result → SUPPRESSED, never NO_ACTION", async () => {
    const view = await makeService([
      makeRecord({ suppressed: true, outcome: "NO_ACTION", actionType: null }),
    ]).getNarrativeActionReadView(1);
    expect(view.decision?.suppressed).toBe(true);
    expect(view.displayState).toBe("SUPPRESSED");
    expect(view.displayState).not.toBe("NO_ACTION");
  });

  it("G: SELECTED → displayState SELECTED", async () => {
    const view = await makeService([makeRecord()]).getNarrativeActionReadView(1);
    expect(view.displayState).toBe("SELECTED");
  });

  it("H: SELECTED + safety BLOCK → SAFETY_BLOCKED (distinct from POLICY_BLOCKED)", async () => {
    const view = await makeService([
      makeRecord({
        safetyResult: {
          aggregate: "BLOCK",
          guardrailResults: [
            { guardrailId: "GR-1", version: "v1", outcome: "BLOCK", applicable: true, evaluatedAt: "2026-08-16T00:00:00.000Z", reason: "stale P4 context" },
          ],
        },
      }),
    ]).getNarrativeActionReadView(1);
    expect(view.displayState).toBe("SAFETY_BLOCKED");
    expect(view.decision?.safetyResult?.aggregate).toBe("BLOCK");
  });

  it("I: SELECTED + approval DENIED → APPROVAL_DENIED (distinct from both blocks)", async () => {
    const view = await makeService([
      makeRecord({
        approvalState: "DENIED",
        approvalRecord: { approvalId: "ap-1", decisionIdRef: "dec-1", state: "DENIED", authorityRef: "AUTH-1", actor: "owner", timestamp: "2026-08-16T00:00:00.000Z", scope: "v1", approvalPolicyVersion: "ap/v1", invalidation: null },
      }),
    ]).getNarrativeActionReadView(1);
    expect(view.displayState).toBe("APPROVAL_DENIED");
    expect(view.decision?.approvalState).toBe("DENIED");
  });

  it("S: service failure → SERVICE_ERROR + UNAVAILABLE, never NO_ACTION", async () => {
    const store = {
      findByDecisionId: async () => {
        throw new Error("db down");
      },
      findBySubject: async () => {
        throw new Error("db down");
      },
    } satisfies P5DecisionStore;
    const service = new ActionReadService({ store, getP4: p4Ok });
    const view = await service.getNarrativeActionReadView(1);
    expect(view.availability).toBe("SERVICE_ERROR");
    expect(view.displayState).toBe("UNAVAILABLE");
    expect(view.error?.code).toBe("SERVICE_ERROR");
    expect(view.displayState).not.toBe("NO_ACTION");
  });
});

describe("P5-06A UNKNOWN / DEGRADED P4 evidence", () => {
  it("K: UNKNOWN/DEGRADED P4 condition is preserved, never rendered as NO_ACTION", async () => {
    const degraded = makeP4Vm({
      status: "DEGRADED",
      direction: "UNKNOWN",
      degradation: [{ code: "CRITICAL_EVIDENCE_MISSING" }],
    });
    const view = await makeService([], async () => degraded).getNarrativeActionReadView(1);
    expect(view.availability).toBe("NO_DECISION_RECORD");
    expect(view.context?.p4SnapshotRef?.status).toBe("DEGRADED");
    expect(view.displayState).toBe("ABSENT");
    expect(view.displayState).not.toBe("NO_ACTION");
  });

  it("L: P4 context unavailable (null) → P4_CONTEXT_UNAVAILABLE, not NO_ACTION and not 200-ok", async () => {
    const view = await makeService([], p4Null).getNarrativeActionReadView(1);
    expect(view.availability).toBe("P4_CONTEXT_UNAVAILABLE");
    expect(view.displayState).toBe("UNAVAILABLE");
    expect(view.context).toBeNull();
    expect(view.displayState).not.toBe("NO_ACTION");
  });
});

describe("P5-06A approval / permission semantics", () => {
  it("M: acknowledgement ≠ approval — a legacy ack event never produces APPROVED", async () => {
    const view = await makeService([
      makeRecord({
        approvalState: "PENDING",
        auditEvents: [
          {
            eventId: "e1",
            eventType: "AlertAcknowledged",
            timestamp: "2026-08-16T00:00:00.000Z",
            actor: "admin",
            decisionIdRef: "dec-1",
            previousState: null,
            newState: null,
            reason: null,
            policyVersionRef: null,
            guardrailRef: null,
            approvalRef: null,
          },
        ],
      }),
    ]).getNarrativeActionReadView(1);
    expect(view.decision?.approvalState).toBe("PENDING");
    expect(view.decision?.approvalRecord).toBeNull();
    expect(view.displayState).not.toBe("APPROVAL_DENIED");
  });

  it("N: permission ≠ execution — GRANTED never implies EXECUTED", async () => {
    const view = await makeService([
      makeRecord({ permissionResult: "GRANTED", executionState: "NOT_APPLICABLE" }),
    ]).getNarrativeActionReadView(1);
    expect(view.decision?.permissionResult).toBe("GRANTED");
    expect(view.decision?.executionState).toBe("NOT_APPLICABLE");
    expect(view.decision?.executionState).not.toBe("EXECUTED");
  });
});

describe("P5-06A no BUY/SELL, no hidden score, provenance, audit read-only, P4-06", () => {
  it("O: the read view contains no BUY/SELL/LONG/SHORT/ORDER/TRADE semantics", async () => {
    const view = await makeService([makeRecord()]).getNarrativeActionReadView(1);
    const serialized = JSON.stringify(view).toUpperCase();
    for (const token of ["BUY", "SELL", "LONG", "SHORT", "ORDER", "TRADE"]) {
      expect(serialized).not.toContain(token);
    }
  });

  it("P: the read view contains no hidden score/threshold fields", async () => {
    const view = await makeService([makeRecord()]).getNarrativeActionReadView(1);
    const serialized = JSON.stringify(view).toUpperCase();
    expect(serialized).not.toContain("SCORE");
    expect(serialized).not.toContain("THRESHOLD");
  });

  it("Q: provenance is preserved 1:1 (snapshot ref, policy, versions)", async () => {
    const snapshot = makeSnapshotRef();
    const view = await makeService([
      makeRecord({
        provenance: {
          ...makeRecord().provenance,
          p4SnapshotRef: snapshot,
        },
      }),
    ]).getNarrativeActionReadView(1);
    expect(view.decision?.provenance.p4SnapshotRef).toEqual(snapshot);
    expect(view.decision?.provenance.policy.policyVersion).toBe("v1");
    expect(view.decision?.provenance.versions.p4VersionTuple?.interpretationRuleVersion).toBe("p4-03/v1");
    expect(view.context?.source).toBe("DECISION_RECORD");
  });

  it("R: audit history is read-only — records are never mutated by the service", async () => {
    const record = makeRecord();
    Object.freeze(record);
    Object.freeze(record.auditEvents);
    const before = JSON.stringify(record);
    const view = await makeService([record]).getNarrativeActionReadView(1);
    expect(view.decision?.auditEvents).toEqual(record.auditEvents);
    expect(JSON.stringify(record)).toBe(before);

    // The store boundary exposes only read methods.
    const proto = Object.getOwnPropertyNames(NoP5DecisionStore.prototype).sort();
    expect(proto).toEqual(["constructor", "findByDecisionId", "findBySubject"]);
  });

  it("T: the read layer is independent of P4-06 (no provisional-rule references in source)", () => {
    const sourceFiles = [
      join(__dirname, "..", "types.ts"),
      join(__dirname, "..", "read", "action-read.service.ts"),
      join(__dirname, "..", "read", "display-state.ts"),
    ];
    for (const file of sourceFiles) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/P4-06|INSUFFICIENT_EVIDENCE|provisional rule|promote/i);
    }
  });
});

describe("deriveDisplayState — presentation classification precedence", () => {
  it("maps every absence/failure to ABSENT/UNAVAILABLE, never NO_ACTION", () => {
    const absent: P5ActionDecisionReadViewModel = {
      decisionPresence: "ABSENT",
      decision: null,
      context: null,
      availability: "NO_DECISION_RECORD",
      displayState: "ABSENT",
      error: null,
    };
    const unavailable: P5ActionDecisionReadViewModel = {
      ...absent,
      availability: "P4_CONTEXT_UNAVAILABLE",
      displayState: "UNAVAILABLE",
    };
    expect(deriveDisplayState(absent)).toBe("ABSENT");
    expect(deriveDisplayState(unavailable)).toBe("UNAVAILABLE");
  });
});
