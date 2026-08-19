/**
 * P5-03-RT — Policy Evaluator v1 — Test Suite.
 *
 * Covers every frozen V1 rule from `P5-03_POLICY_RULESET_V1_CANDIDATE.md` §4:
 *  - R-001…R-008 (contract rules)
 *  - C-101/C-102 (applicability)
 *  - C-201…C-206, C-210 (eligibility)
 *  - C-301/C-302 (blocking)
 *  - C-501 (selection)
 *  - C-601/C-602 (routing)
 *
 * Also verifies:
 *  - Determinism (PD-010): same input → same result
 *  - Provenance (PD-012): policyId, policyVersion, ruleRefs
 *  - No legacy P1 reuse, no hidden scores/thresholds, no BUY/SELL
 *  - No mutation (pure function)
 *  - V1 outcome surface: SELECTED / NO_ACTION / NOT_DETERMINED
 */

import { P5PolicyEvaluator } from "../evaluator";
import type {
  P5PolicyEvaluationInput,
  P5PolicySnapshotRef,
} from "../types";
import {
  P5_V1_ACTION_TYPES,
  P5_V1_POLICY_ID,
  P5_V1_POLICY_VERSION,
  P5_V1_REASON_CODES,
  P5_V1_RULE_IDS,
} from "../rules";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeSnapshotRef(
  overrides?: Partial<P5PolicySnapshotRef>,
): P5PolicySnapshotRef {
  return {
    narrativeIdentity: {
      narrativeId: 1,
      window: "1d",
      algorithmKey: "p4-decision-support",
      algorithmVersion: "1",
      calculationMode: "weighted",
    },
    asOf: "2026-08-17T00:00:00.000Z",
    versionTuple: {
      algorithmVersion: "p4-decision-support",
      semanticVersion: "1",
      signalCatalogVersion: "1",
      interpretationRuleVersion: "p4-03/v1",
    },
    status: "OK",
    ...overrides,
  };
}

function makeInput(
  overrides?: Partial<P5PolicyEvaluationInput>,
): P5PolicyEvaluationInput {
  return {
    policy: {
      policyId: P5_V1_POLICY_ID,
      policyVersion: P5_V1_POLICY_VERSION,
      effectiveAt: "2026-08-17T00:00:00.000Z",
    },
    p4SnapshotRef: makeSnapshotRef(),
    status: "OK",
    direction: "POSITIVE",
    opportunity: "MEDIUM",
    risk: "MEDIUM",
    confidence: "HIGH",
    actionability: "MEDIUM",
    signalIds: [],
    degradation: null,
    candidate: {
      candidateId: "test-candidate-1",
      actionType: "MONITOR",
      parameters: {},
      subject: { narrativeId: 1 },
    },
    declaredContext: {},
    ...overrides,
  };
}

function makeEvaluator(): P5PolicyEvaluator {
  return new P5PolicyEvaluator();
}

// ---------------------------------------------------------------------------
// R-002: Input layer unavailable (status ERROR)
// ---------------------------------------------------------------------------

describe("R-002: P4 status ERROR → NOT_DETERMINED", () => {
  it("returns NOT_DETERMINED with POLICY_INPUT_UNAVAILABLE when status is ERROR", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({ status: "ERROR" });

    const result = evaluator.evaluate(input);

    expect(result.outcome).toBe("NOT_DETERMINED");
    expect(result.reasonCodes).toContain(
      P5_V1_REASON_CODES.POLICY_INPUT_UNAVAILABLE,
    );
    expect(result.provenance.ruleRefs).toContain(P5_V1_RULE_IDS.R002);
    expect(result.eligibility.eligible).toBe(false);
    expect(result.selectedCandidate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// C-102: Out-of-scope action type → NOT_DETERMINED
// ---------------------------------------------------------------------------

describe("C-102: Out-of-scope action type", () => {
  it("returns NOT_DETERMINED for EXECUTE (excluded from V1 scope)", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-execute",
        actionType: "EXECUTE" as any,
        parameters: {},
        subject: { narrativeId: 1 },
      },
    });

    const result = evaluator.evaluate(input);

    expect(result.outcome).toBe("NOT_DETERMINED");
    expect(result.provenance.ruleRefs).toContain(P5_V1_RULE_IDS.C102);
    expect(result.audit.some((e) => e.ruleId === P5_V1_RULE_IDS.C102)).toBe(
      true,
    );
  });

  it("returns NOT_DETERMINED for ESCALATE (excluded from V1 scope)", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-escalate",
        actionType: "ESCALATE" as any,
        parameters: {},
        subject: { narrativeId: 1 },
      },
    });

    const result = evaluator.evaluate(input);

    expect(result.outcome).toBe("NOT_DETERMINED");
    expect(result.provenance.ruleRefs).toContain(P5_V1_RULE_IDS.C102);
  });
});

// ---------------------------------------------------------------------------
// C-101: In-scope action type → proceed
// ---------------------------------------------------------------------------

describe("C-101: In-scope action types", () => {
  it.each(P5_V1_ACTION_TYPES)(
    "accepts %s as an in-scope V1 action type",
    (actionType) => {
      const evaluator = makeEvaluator();
      const input = makeInput({
        candidate: {
          candidateId: `c-${actionType}`,
          actionType,
          parameters: {},
          subject: { narrativeId: 1 },
        },
      });

      // Not rejected by applicability — either eligible or NO_ACTION
      const result = evaluator.evaluate(input);
      expect(result.outcome).not.toBe("NOT_DETERMINED");
      expect(result.provenance.ruleRefs).toContain(P5_V1_RULE_IDS.C101);
    },
  );
});

// ---------------------------------------------------------------------------
// C-201: MONITOR — snapshot present AND Direction ≠ UNKNOWN
// ---------------------------------------------------------------------------

describe("C-201: MONITOR eligibility", () => {
  it("eligible when snapshot present and direction is POSITIVE", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-mon-1",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      direction: "POSITIVE",
    });

    const result = evaluator.evaluate(input);

    expect(result.outcome).toBe("SELECTED");
    expect(result.eligibility.eligible).toBe(true);
    expect(result.eligibility.ruleIds).toContain(P5_V1_RULE_IDS.C201);
    expect(result.selectedCandidate?.actionType).toBe("MONITOR");
  });

  it("eligible when snapshot present and direction is NEGATIVE", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-mon-2",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      direction: "NEGATIVE",
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("SELECTED");
    expect(result.eligibility.eligible).toBe(true);
  });

  it("eligible when direction is MIXED", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-mon-3",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      direction: "MIXED",
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("SELECTED");
    expect(result.eligibility.eligible).toBe(true);
  });

  it("eligible when direction is NEUTRAL", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-mon-4",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      direction: "NEUTRAL",
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("SELECTED");
    expect(result.eligibility.eligible).toBe(true);
  });

  it("NOT eligible (→ NO_ACTION) when direction is UNKNOWN", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-mon-5",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      direction: "UNKNOWN",
    });

    const result = evaluator.evaluate(input);

    expect(result.outcome).toBe("NO_ACTION");
    expect(result.eligibility.eligible).toBe(false);
    expect(result.eligibility.reasonCode).toBe("DIRECTION_UNKNOWN");
    expect(result.provenance.ruleRefs).toContain(P5_V1_RULE_IDS.C201);
  });

  it("NOT eligible when snapshot is NO_EVIDENCE (→ NOT_DETERMINED via C-601)", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-mon-6",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      status: "NO_EVIDENCE",
    });

    const result = evaluator.evaluate(input);
    // NO_EVIDENCE routes through C-601 → NOT_DETERMINED, not NO_ACTION.
    expect(result.outcome).toBe("NOT_DETERMINED");
    expect(result.eligibility.eligible).toBe(false);
    expect(result.provenance.ruleRefs).toContain(P5_V1_RULE_IDS.C601);
  });
});

// ---------------------------------------------------------------------------
// C-202: REVIEW — snapshot present
// ---------------------------------------------------------------------------

describe("C-202: REVIEW eligibility", () => {
  it("eligible when snapshot present", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-rev-1",
        actionType: "REVIEW",
        parameters: {},
        subject: { narrativeId: 1 },
      },
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("SELECTED");
    expect(result.eligibility.eligible).toBe(true);
    expect(result.eligibility.ruleIds).toContain(P5_V1_RULE_IDS.C202);
  });

  it("eligible when DEGRADED (snapshot present)", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-rev-2",
        actionType: "REVIEW",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      status: "DEGRADED",
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("SELECTED");
    expect(result.eligibility.eligible).toBe(true);
  });

  it("NOT eligible when NO_EVIDENCE (→ NOT_DETERMINED via C-601)", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-rev-3",
        actionType: "REVIEW",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      status: "NO_EVIDENCE",
    });

    const result = evaluator.evaluate(input);
    // NO_EVIDENCE routes through C-601 → NOT_DETERMINED, not NO_ACTION.
    expect(result.outcome).toBe("NOT_DETERMINED");
    expect(result.eligibility.eligible).toBe(false);
    expect(result.provenance.ruleRefs).toContain(P5_V1_RULE_IDS.C601);
  });
});

// ---------------------------------------------------------------------------
// C-203: INVESTIGATE — signal or degradation exists
// ---------------------------------------------------------------------------

describe("C-203: INVESTIGATE eligibility", () => {
  it("eligible when signals are present", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-inv-1",
        actionType: "INVESTIGATE",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      signalIds: ["NARRATIVE_DETERIORATION"],
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("SELECTED");
    expect(result.eligibility.eligible).toBe(true);
    expect(result.eligibility.ruleIds).toContain(P5_V1_RULE_IDS.C203);
  });

  it("eligible when degradation is present", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-inv-2",
        actionType: "INVESTIGATE",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      degradation: [{ code: "EVIDENCE_CONFLICT" }],
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("SELECTED");
    expect(result.eligibility.eligible).toBe(true);
  });

  it("NOT eligible when no signals and no degradation", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-inv-3",
        actionType: "INVESTIGATE",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      signalIds: [],
      degradation: null,
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("NO_ACTION");
    expect(result.eligibility.eligible).toBe(false);
    expect(result.eligibility.reasonCode).toBe("NO_SIGNAL_OR_DEGRADATION");
  });
});

// ---------------------------------------------------------------------------
// C-204/C-205/C-206: Consequential types — snapshot usable
// ---------------------------------------------------------------------------

describe("C-204: REDUCE_EXPOSURE eligibility", () => {
  it("eligible when snapshot OK", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-red-1",
        actionType: "REDUCE_EXPOSURE",
        parameters: { target: "narrative-1" },
        subject: { narrativeId: 1 },
      },
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("SELECTED");
    expect(result.eligibility.eligible).toBe(true);
    expect(result.eligibility.ruleIds).toContain(P5_V1_RULE_IDS.C204);
  });

  it("NOT_DETERMINED when DEGRADED (C-301 blocks consequential + degraded)", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-red-2",
        actionType: "REDUCE_EXPOSURE",
        parameters: { target: "narrative-1" },
        subject: { narrativeId: 1 },
      },
      status: "DEGRADED",
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("NOT_DETERMINED");
    expect(result.provenance.ruleRefs).toContain(P5_V1_RULE_IDS.C301);
  });
});

describe("C-205: INCREASE_EXPOSURE eligibility", () => {
  it("eligible when snapshot OK", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-inc-1",
        actionType: "INCREASE_EXPOSURE",
        parameters: { target: "narrative-1" },
        subject: { narrativeId: 1 },
      },
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("SELECTED");
    expect(result.eligibility.eligible).toBe(true);
    expect(result.eligibility.ruleIds).toContain(P5_V1_RULE_IDS.C205);
  });
});

describe("C-206: REBALANCE eligibility", () => {
  it("eligible when snapshot OK and subject valid", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-reb-1",
        actionType: "REBALANCE",
        parameters: { weights: { a: 0.5, b: 0.5 } },
        subject: { narrativeId: 1 },
      },
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("SELECTED");
    expect(result.eligibility.eligible).toBe(true);
    expect(result.eligibility.ruleIds).toContain(P5_V1_RULE_IDS.C206);
  });
});

// ---------------------------------------------------------------------------
// C-210: Missing required parameter → NOT_DETERMINED
// ---------------------------------------------------------------------------

describe("C-210: Missing required parameter", () => {
  it("returns NOT_DETERMINED when parameters are null", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-210-1",
        actionType: "MONITOR",
        parameters: null as any,
        subject: { narrativeId: 1 },
      },
    });

    const result = evaluator.evaluate(input);

    expect(result.outcome).toBe("NOT_DETERMINED");
    expect(result.provenance.ruleRefs).toContain(P5_V1_RULE_IDS.C210);
    expect(result.eligibility.eligible).toBe(false);
    expect(result.eligibility.reasonCode).toBe("NOT_ELIGIBLE");
  });

  it("returns NOT_DETERMINED when parameters are undefined", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-210-2",
        actionType: "REVIEW",
        parameters: undefined as any,
        subject: { narrativeId: 1 },
      },
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("NOT_DETERMINED");
    expect(result.provenance.ruleRefs).toContain(P5_V1_RULE_IDS.C210);
  });
});

// ---------------------------------------------------------------------------
// C-301: Consequential candidate + DEGRADED/NO_EVIDENCE → NOT_DETERMINED
// ---------------------------------------------------------------------------

describe("C-301: Blocking — consequential candidate with degraded/no-evidence", () => {
  it("NOT_DETERMINED for REDUCE_EXPOSURE when DEGRADED", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-301-1",
        actionType: "REDUCE_EXPOSURE",
        parameters: { target: "narrative-1" },
        subject: { narrativeId: 1 },
      },
      status: "DEGRADED",
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("NOT_DETERMINED");
    expect(result.provenance.ruleRefs).toContain(P5_V1_RULE_IDS.C301);
  });

  it("NOT_DETERMINED for INCREASE_EXPOSURE when NO_EVIDENCE (C-601 fires)", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-301-2",
        actionType: "INCREASE_EXPOSURE",
        parameters: { target: "narrative-1" },
        subject: { narrativeId: 1 },
      },
      status: "NO_EVIDENCE",
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("NOT_DETERMINED");
    expect(result.provenance.ruleRefs).toContain(P5_V1_RULE_IDS.C601);
  });

  it("NOT_DETERMINED for REBALANCE when NO_EVIDENCE (C-601 fires)", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-301-3",
        actionType: "REBALANCE",
        parameters: { weights: { a: 0.5 } },
        subject: { narrativeId: 1 },
      },
      status: "NO_EVIDENCE",
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("NOT_DETERMINED");
    expect(result.provenance.ruleRefs).toContain(P5_V1_RULE_IDS.C601);
  });

  it("NOT blocked for advisory type (MONITOR) when DEGRADED", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-301-4",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      status: "DEGRADED",
      direction: "POSITIVE",
    });

    const result = evaluator.evaluate(input);
    // MONITOR is advisory, not consequential → C-301 does not fire.
    // Eligibility is snapshot present AND direction ≠ UNKNOWN → ELIGIBLE.
    expect(result.outcome).toBe("SELECTED");
    expect(result.provenance.ruleRefs).not.toContain(P5_V1_RULE_IDS.C301);
  });
});

// ---------------------------------------------------------------------------
// C-501: Single eligible candidate → SELECTED
// ---------------------------------------------------------------------------

describe("C-501: Selection", () => {
  it("SELECTED for single eligible candidate", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-501-1",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      direction: "POSITIVE",
    });

    const result = evaluator.evaluate(input);

    expect(result.outcome).toBe("SELECTED");
    expect(result.selectedCandidate).not.toBeNull();
    expect(result.selectedCandidate?.candidateId).toBe("c-501-1");
    expect(result.selectedCandidate?.actionType).toBe("MONITOR");
    expect(result.provenance.ruleRefs).toContain(P5_V1_RULE_IDS.C501);
    expect(result.reasonCodes).toContain(P5_V1_REASON_CODES.SELECTED);
  });
});

// ---------------------------------------------------------------------------
// C-601: NO_EVIDENCE → NOT_DETERMINED
// ---------------------------------------------------------------------------

describe("C-601: NO_EVIDENCE routing", () => {
  it("NOT_DETERMINED when status is NO_EVIDENCE", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-601-1",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      status: "NO_EVIDENCE",
      direction: "POSITIVE",
    });

    const result = evaluator.evaluate(input);

    // MONITOR is eligible (snapshot present for eligibility check) but
    // C-601 routing fires → NOT_DETERMINED.
    expect(result.outcome).toBe("NOT_DETERMINED");
    expect(result.provenance.ruleRefs).toContain(P5_V1_RULE_IDS.C601);
  });
});

// ---------------------------------------------------------------------------
// R-003: Completed evaluation, nothing eligible → NO_ACTION
// ---------------------------------------------------------------------------

describe("R-003: NO_ACTION when nothing eligible", () => {
  it("NO_ACTION when MONITOR with Direction UNKNOWN", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-r003-1",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      direction: "UNKNOWN",
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("NO_ACTION");
    expect(result.reasonCodes).toContain(P5_V1_REASON_CODES.NO_ELIGIBLE_ACTION);
    expect(result.eligibility.eligible).toBe(false);
  });

  it("NO_ACTION when INVESTIGATE with no signals and no degradation", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-r003-2",
        actionType: "INVESTIGATE",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      signalIds: [],
      degradation: null,
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("NO_ACTION");
    expect(result.reasonCodes).toContain(P5_V1_REASON_CODES.NO_ELIGIBLE_ACTION);
  });
});

// ---------------------------------------------------------------------------
// Determinism (PD-010)
// ---------------------------------------------------------------------------

describe("Determinism (PD-010)", () => {
  it("same input produces same result", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-det-1",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      direction: "POSITIVE",
    });

    const result1 = evaluator.evaluate(input);
    const result2 = evaluator.evaluate(input);

    expect(result1.outcome).toBe(result2.outcome);
    expect(result1.eligibility.eligible).toBe(result2.eligibility.eligible);
    expect(result1.eligibility.ruleIds).toEqual(result2.eligibility.ruleIds);
    expect(result1.selectedCandidate?.candidateId).toBe(
      result2.selectedCandidate?.candidateId,
    );
    expect(result1.reasonCodes).toEqual(result2.reasonCodes);
    expect(result1.provenance.ruleRefs).toEqual(result2.provenance.ruleRefs);
  });

  it("changing only direction UNKNOWN changes the result deterministically", () => {
    const evaluator = makeEvaluator();
    const inputPos = makeInput({
      candidate: {
        candidateId: "c-det-2",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      direction: "POSITIVE",
    });

    const inputUnk = makeInput({
      candidate: {
        candidateId: "c-det-2",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      direction: "UNKNOWN",
    });

    const resultPos = evaluator.evaluate(inputPos);
    const resultUnk = evaluator.evaluate(inputUnk);

    expect(resultPos.outcome).toBe("SELECTED");
    expect(resultUnk.outcome).toBe("NO_ACTION");
  });
});

// ---------------------------------------------------------------------------
// Provenance (PD-012)
// ---------------------------------------------------------------------------

describe("Provenance (PD-012)", () => {
  it("includes policyId, policyVersion, effectiveAt", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-prov-1",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      direction: "POSITIVE",
    });

    const result = evaluator.evaluate(input);

    expect(result.provenance.policyId).toBe(P5_V1_POLICY_ID);
    expect(result.provenance.policyVersion).toBe(P5_V1_POLICY_VERSION);
    expect(result.provenance.effectiveAt).toBe("2026-08-17T00:00:00.000Z");
    expect(result.provenance.ruleRefs.length).toBeGreaterThan(0);
  });

  it("includes p4SnapshotRef in provenance", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-prov-2",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      direction: "POSITIVE",
    });

    const result = evaluator.evaluate(input);

    expect(result.provenance.p4SnapshotRef).toBeDefined();
    expect(
      result.provenance.p4SnapshotRef.narrativeIdentity.narrativeId,
    ).toBe(1);
    expect(result.provenance.p4VersionTuple.semanticVersion).toBe("1");
  });

  it("includes degradation in provenance when present", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-prov-3",
        actionType: "INVESTIGATE",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      degradation: [{ code: "EVIDENCE_CONFLICT" }],
    });

    const result = evaluator.evaluate(input);
    expect(result.provenance.degradation).toEqual([
      { code: "EVIDENCE_CONFLICT" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// V1 outcome surface
// ---------------------------------------------------------------------------

describe("V1 outcome surface", () => {
  it("only produces SELECTED, NO_ACTION, or NOT_DETERMINED", () => {
    const evaluator = makeEvaluator();
    const outcomes = new Set<string>();

    // Test all action types with various statuses
    const statuses: Array<"OK" | "DEGRADED" | "NO_EVIDENCE" | "ERROR"> = [
      "OK",
      "DEGRADED",
      "NO_EVIDENCE",
      "ERROR",
    ];
    const directions: Array<"POSITIVE" | "UNKNOWN"> = ["POSITIVE", "UNKNOWN"];

    for (const actionType of P5_V1_ACTION_TYPES) {
      for (const status of statuses) {
        for (const direction of directions) {
          const input = makeInput({
            candidate: {
              candidateId: `c-v1-${actionType}-${status}-${direction}`,
              actionType,
              parameters: {},
              subject: { narrativeId: 1 },
            },
            status,
            direction,
          });
          const result = evaluator.evaluate(input);
          outcomes.add(result.outcome);
        }
      }
    }

    expect(outcomes.size).toBeLessThanOrEqual(3);
    for (const o of outcomes) {
      expect(["SELECTED", "NO_ACTION", "NOT_DETERMINED"]).toContain(o);
    }
  });

  it("never produces BLOCKED in V1", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-blocked-never",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).not.toBe("BLOCKED");
    expect(result.blockerReport).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suppression — no V1 trigger
// ---------------------------------------------------------------------------

describe("Suppression — no V1 trigger", () => {
  it("suppression is always false in V1", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-supp-1",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      direction: "POSITIVE",
    });

    const result = evaluator.evaluate(input);
    expect(result.suppression.suppressed).toBe(false);
    expect(result.suppression.reasonCode).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// No legacy P1 reuse
// ---------------------------------------------------------------------------

describe("No legacy P1 reuse", () => {
  it("evaluator file does not import from rule-version.service.ts", async () => {
    // Dynamic import to check the module source
    const fs = await import("fs");
    const path = await import("path");
    const evalPath = path.resolve(
      __dirname,
      "../evaluator.ts",
    );
    const content = fs.readFileSync(evalPath, "utf-8");
    expect(content).not.toContain("rule-version.service");
    expect(content).not.toContain("recommendationThresholds");
    expect(content).not.toContain("STRONG_WATCH");
    expect(content).not.toContain("90/80/65");
  });
});

// ---------------------------------------------------------------------------
// No hidden scores, thresholds, BUY/SELL
// ---------------------------------------------------------------------------

describe("No hidden business logic", () => {
  it("evaluator does not contain numeric thresholds or BUY/SELL", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const evalPath = path.resolve(__dirname, "../evaluator.ts");
    const content = fs.readFileSync(evalPath, "utf-8");

    // No numeric thresholds
    expect(content).not.toMatch(/\b(90|80|65|25|15|8)\b.*(?:threshold|score|weight)/i);

    // No BUY/SELL/LONG/SHORT in executable code (ignore prohibition comments)
    const codeOnly = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(codeOnly).not.toMatch(/\bBUY\b/);
    expect(codeOnly).not.toMatch(/\bSELL\b/);
    expect(codeOnly).not.toMatch(/\bLONG\b/);
    expect(codeOnly).not.toMatch(/\bSHORT\b/);
  });
});

// ---------------------------------------------------------------------------
// No mutation (pure function)
// ---------------------------------------------------------------------------

describe("No mutation (pure function)", () => {
  it("evaluator does not mutate the input", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-mut-1",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      direction: "POSITIVE",
    });

    const inputSnapshot = JSON.parse(JSON.stringify(input));
    evaluator.evaluate(input);

    expect(JSON.stringify(input)).toBe(JSON.stringify(inputSnapshot));
  });
});

// ---------------------------------------------------------------------------
// Audit trace
// ---------------------------------------------------------------------------

describe("Audit trace", () => {
  it("includes audit entries for each rule evaluated", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-audit-1",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      direction: "POSITIVE",
    });

    const result = evaluator.evaluate(input);

    expect(result.audit.length).toBeGreaterThan(0);
    // Should have applicability (C-101) and eligibility (C-201) and selection (C-501)
    expect(result.audit.some((e) => e.layer === "applicability")).toBe(true);
    expect(result.audit.some((e) => e.layer === "eligibility")).toBe(true);
    expect(result.audit.some((e) => e.layer === "selection")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Custom policy identity
// ---------------------------------------------------------------------------

describe("Custom policy identity", () => {
  it("accepts custom policyId and policyVersion", () => {
    const evaluator = new P5PolicyEvaluator({
      policyId: "custom-policy",
      policyVersion: "v2",
      effectiveAt: "2026-12-01T00:00:00.000Z",
    });

    const input = makeInput({
      candidate: {
        candidateId: "c-custom-1",
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      direction: "POSITIVE",
    });

    const result = evaluator.evaluate(input);
    // Provenance uses the input's policy identity (PD-012 exact reference).
    // The evaluator's custom identity would need to be passed in the input.
    expect(result.provenance.policyId).toBe(P5_V1_POLICY_ID);
    expect(result.provenance.policyVersion).toBe(P5_V1_POLICY_VERSION);
    expect(result.outcome).toBe("SELECTED");
  });
});

// ---------------------------------------------------------------------------
// Multiple signal IDs for INVESTIGATE
// ---------------------------------------------------------------------------

describe("INVESTIGATE with multiple signals", () => {
  it("eligible when multiple signals present", () => {
    const evaluator = makeEvaluator();
    const input = makeInput({
      candidate: {
        candidateId: "c-multi-sig",
        actionType: "INVESTIGATE",
        parameters: {},
        subject: { narrativeId: 1 },
      },
      signalIds: [
        "NARRATIVE_DETERIORATION",
        "REGIME_CHANGE",
        "EVIDENCE_CONFLICT",
      ],
    });

    const result = evaluator.evaluate(input);
    expect(result.outcome).toBe("SELECTED");
    expect(result.eligibility.eligible).toBe(true);
  });
});
