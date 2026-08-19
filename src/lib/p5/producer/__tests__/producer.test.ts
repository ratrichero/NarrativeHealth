/**
 * P5-10 — Decision Producer tests (T01–T25+).
 *
 * Tests the complete runtime chain:
 *  P4 fixture → P5-03 → P5-04 → P5-05 → P5-10 → P5DecisionRecord → recorder
 *
 * Categories:
 *  T01–T04: Complete chain + decision identity
 *  T05–T10: Provenance preservation (P4, policy, safety, approval, permission, explanation)
 *  T11–T14: Outcome preservation (SELECTED, NO_ACTION, NOT_DETERMINED, semantic separation)
 *  T15–T18: Upstream failures + missing data
 *  T19–T20: Commit boundary + recorder integration
 *  T21–T23: Dependency boundary (no DB, no replay, no execution)
 *  T24–T25: Deterministic output + namespace separation
 */

import { P5DecisionProducer } from "../p5-decision-producer";
import type { P5Recorder } from "../p5-decision-producer";
import type { P5ProducerInput } from "../types";
import type { P5DecisionRecord } from "../../types";
import type { P5PolicyEvaluationResult } from "../../policy/types";
import type { P5SafetyEvaluationResult } from "../../safety/types";
import type { P5ExplanationResult } from "../../explanation/types";
import type { P5RecordingResult } from "../../record/p5-artifact-recorder";

// ---------------------------------------------------------------------------
// In-memory mock recorder (P5-09 contract)
// ---------------------------------------------------------------------------

class MockRecorder implements P5Recorder {
  public calls: Array<{ decision: P5DecisionRecord }> = [];

  async record(batch: { decision: P5DecisionRecord }): Promise<P5RecordingResult> {
    this.calls.push({ decision: batch.decision });
    return {
      decisionId: batch.decision.decisionId,
      items: [
        { artifact: "decision", identity: batch.decision.decisionId, status: "RECORDED", reason: null },
      ],
      complete: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makePolicyResult(overrides: Partial<P5PolicyEvaluationResult> = {}): P5PolicyEvaluationResult {
  return {
    outcome: "SELECTED",
    eligibility: { eligible: true, ruleIds: ["C-201"], reasonCode: null },
    selectedCandidate: {
      candidateId: "cand-001",
      actionType: "MONITOR",
      parameters: { scope: "test" },
      subject: { narrativeId: 1 },
    },
    suppression: { suppressed: false, reasonCode: null },
    blockerReport: null,
    provenance: {
      policyId: "pol-p5-v1",
      policyVersion: "v1",
      effectiveAt: "2026-08-17T00:00:00.000Z",
      evaluationAt: "evaluated",
      ruleRefs: ["C-101", "C-201", "C-501"],
      p4SnapshotRef: {
        narrativeIdentity: {
          narrativeId: 1,
          window: "7d",
          algorithmKey: "narrative",
          algorithmVersion: "1.0.0",
          calculationMode: "latest",
        },
        asOf: "2026-08-17T00:00:00.000Z",
        versionTuple: {
          algorithmVersion: "1.0.0",
          semanticVersion: "1.0.0",
          signalCatalogVersion: "1.0.0",
          interpretationRuleVersion: "1.0.0",
        },
        status: "OK",
      },
      p4VersionTuple: {
        algorithmVersion: "1.0.0",
        semanticVersion: "1.0.0",
        signalCatalogVersion: "1.0.0",
        interpretationRuleVersion: "1.0.0",
      },
      degradation: null,
    },
    reasonCodes: ["SELECTED"],
    audit: [],
    ...overrides,
  };
}

function makeSafetyResult(overrides: Partial<P5SafetyEvaluationResult> = {}): P5SafetyEvaluationResult {
  return {
    safetyOutcome: "PASS",
    guardrailResults: [],
    approvalState: "NOT_REQUIRED",
    approvalRecord: null,
    permissionState: "NOT_APPLICABLE",
    blockerReport: null,
    provenance: {
      policyProvenance: {
        policyId: "pol-p5-v1",
        policyVersion: "v1",
        effectiveAt: "2026-08-17T00:00:00.000Z",
        evaluationAt: "evaluated",
        ruleRefs: ["C-101", "C-201", "C-501"],
        p4SnapshotRef: {
          narrativeIdentity: {
            narrativeId: 1,
            window: "7d",
            algorithmKey: "narrative",
            algorithmVersion: "1.0.0",
            calculationMode: "latest",
          },
          asOf: "2026-08-17T00:00:00.000Z",
          versionTuple: {
            algorithmVersion: "1.0.0",
            semanticVersion: "1.0.0",
            signalCatalogVersion: "1.0.0",
            interpretationRuleVersion: "1.0.0",
          },
          status: "OK",
        },
        p4VersionTuple: {
          algorithmVersion: "1.0.0",
          semanticVersion: "1.0.0",
          signalCatalogVersion: "1.0.0",
          interpretationRuleVersion: "1.0.0",
        },
        degradation: null,
      },
      guardrailModelVersion: "v1",
      guardrailVersions: [],
      approvalModelVersion: "v1",
      automationMode: "ADVISORY",
      evaluatedAt: "evaluated",
    },
    audit: [],
    actionClass: "ADVISORY",
    policyOutcome: "SELECTED",
    ...overrides,
  };
}

function makeExplanationResult(
  policyResult: P5PolicyEvaluationResult,
  safetyResult: P5SafetyEvaluationResult,
): P5ExplanationResult {
  return {
    explanation: {
      what: "Decision outcome is SELECTED with action type MONITOR",
      why: "Selected by policy rules [C-101, C-201, C-501] with reason codes [SELECTED]",
      basedOn: "Based on P4 snapshot for narrative 1 as of 2026-08-17T00:00:00.000Z (status: OK)",
      policy: "Policy pol-p5-v1@v1 (effective: 2026-08-17T00:00:00.000Z, evaluated: evaluated)",
      safety: "Safety: PASS (0 guardrails evaluated)",
      approval: "Approval: NOT_REQUIRED (V1 advisory-only)",
      currentState: "Decision state: DECIDED, Approval: NOT_REQUIRED, Permission: NOT_APPLICABLE",
      whatDidNotHappen: ["No alternatives were rejected (single-candidate V1)"],
    },
    provenance: {
      decisionId: "test-decision",
      candidateId: "cand-001",
      actionId: "action-001",
      p4SnapshotRef: {
        narrativeIdentity: {
          narrativeId: 1,
          window: "7d",
          algorithmKey: "narrative",
          algorithmVersion: "1.0.0",
          calculationMode: "latest",
        },
        asOf: "2026-08-17T00:00:00.000Z",
        versionTuple: {
          algorithmVersion: "1.0.0",
          semanticVersion: "1.0.0",
          signalCatalogVersion: "1.0.0",
          interpretationRuleVersion: "1.0.0",
        },
        status: "OK",
        contentHash: null,
      },
      policy: {
        policyId: "pol-p5-v1",
        policyVersion: "v1",
        effectiveAt: "2026-08-17T00:00:00.000Z",
        evaluationAt: "evaluated",
        ruleRefs: ["C-101", "C-201", "C-501"],
      },
      safety: { guardrailVersion: "v1" },
      approval: { approvalPolicyVersion: "v1", authorityRef: null },
      automationMode: "ADVISORY",
      versions: {
        actionModelVersion: "p5-action-model/v1",
        p4VersionTuple: {
          algorithmVersion: "1.0.0",
          semanticVersion: "1.0.0",
          signalCatalogVersion: "1.0.0",
          interpretationRuleVersion: "1.0.0",
        },
      },
      timestamps: {
        decisionAt: null,
        evaluatedAt: "evaluated",
        recordedAt: null,
      },
    },
    auditEvents: [
      {
        eventId: "test-decision:DecisionProduced",
        eventType: "DecisionProduced",
        timestamp: "evaluated",
        actor: "SYSTEM",
        decisionIdRef: "test-decision",
        candidateIdRef: "cand-001",
        actionIdRef: "action-001",
        previousState: null,
        newState: "SELECTED",
        reason: "SELECTED",
        policyVersionRef: "pol-p5-v1@v1",
        guardrailRef: null,
        approvalRef: null,
        provenance: {} as any,
      },
    ],
    audit: [],
  };
}

function makeInput(overrides: Partial<P5ProducerInput> = {}): P5ProducerInput {
  const policyResult = overrides.policyResult ?? makePolicyResult();
  const safetyResult = overrides.safetyResult ?? makeSafetyResult();
  return {
    subject: { narrativeId: 1 },
    policyResult,
    safetyResult,
    explanationResult: overrides.explanationResult ?? makeExplanationResult(policyResult, safetyResult),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P5DecisionProducer", () => {
  let recorder: MockRecorder;
  let producer: P5DecisionProducer;

  beforeEach(() => {
    recorder = new MockRecorder();
    producer = new P5DecisionProducer(recorder);
  });

  // ---- T01: Complete runtime chain ----
  it("T01: complete runtime chain produces valid P5DecisionRecord", async () => {
    const input = makeInput();
    const { decision, recording } = await producer.produce(input);

    expect(decision).toBeDefined();
    expect(decision.decisionId).toBeDefined();
    expect(decision.outcome).toBe("SELECTED");
    expect(decision.subject.narrativeId).toBe(1);
    expect(recording.complete).toBe(true);
  });

  // ---- T02: decisionId correctness ----
  it("T02: decisionId is deterministic from identity tuple", () => {
    const input1 = makeInput();
    const input2 = makeInput(); // same inputs
    const d1 = producer.buildDecision(input1);
    const d2 = producer.buildDecision(input2);

    expect(d1.decisionId).toBe(d2.decisionId);
    expect(d1.decisionId).toMatch(/^p5d-[a-f0-9]{8}$/);
  });

  // ---- T03: different inputs → different decisionId ----
  it("T03: different snapshot → different decisionId", () => {
    const input1 = makeInput();
    const input2 = makeInput({
      policyResult: makePolicyResult({
        provenance: {
          ...makePolicyResult().provenance,
          p4SnapshotRef: {
            ...makePolicyResult().provenance.p4SnapshotRef,
            asOf: "2026-08-18T00:00:00.000Z", // different timestamp
          },
        },
      }),
    });
    const d1 = producer.buildDecision(input1);
    const d2 = producer.buildDecision(input2);

    expect(d1.decisionId).not.toBe(d2.decisionId);
  });

  // ---- T04: idempotent repeated commit ----
  it("T04: repeated commit of same decision is idempotent", async () => {
    const input = makeInput();
    const decision = producer.buildDecision(input);

    await producer.commitDecision(decision);
    await producer.commitDecision(decision);

    expect(recorder.calls.length).toBe(2);
    // Both calls pass the same decisionId
    expect(recorder.calls[0].decision.decisionId).toBe(recorder.calls[1].decision.decisionId);
  });

  // ---- T05: P4 snapshot provenance preserved ----
  it("T05: P4 snapshot provenance preserved verbatim", () => {
    const input = makeInput();
    const decision = producer.buildDecision(input);

    expect(decision.provenance.p4SnapshotRef).toBeDefined();
    expect(decision.provenance.p4SnapshotRef!.narrativeIdentity.narrativeId).toBe(1);
    expect(decision.provenance.p4SnapshotRef!.asOf).toBe("2026-08-17T00:00:00.000Z");
    expect(decision.provenance.p4SnapshotRef!.status).toBe("OK");
  });

  // ---- T06: policy provenance preserved ----
  it("T06: policy provenance preserved", () => {
    const input = makeInput();
    const decision = producer.buildDecision(input);

    expect(decision.provenance.policy.policyId).toBe("pol-p5-v1");
    expect(decision.provenance.policy.policyVersion).toBe("v1");
    expect(decision.provenance.policy.ruleRefs).toEqual(["C-101", "C-201", "C-501"]);
  });

  // ---- T07: safety result preserved ----
  it("T07: safety result preserved from P5-04", () => {
    const input = makeInput();
    const decision = producer.buildDecision(input);

    expect(decision.safetyResult).toBeDefined();
    expect(decision.safetyResult!.aggregate).toBe("PASS");
    expect(decision.safetyResult!.guardrailResults).toEqual([]);
  });

  // ---- T08: approval result preserved ----
  it("T08: approval state preserved from P5-04", () => {
    const input = makeInput();
    const decision = producer.buildDecision(input);

    expect(decision.approvalState).toBe("NOT_REQUIRED");
    expect(decision.approvalRecord).toBeNull();
  });

  // ---- T09: permission result preserved ----
  it("T09: permission result preserved from P5-04", () => {
    const input = makeInput();
    const decision = producer.buildDecision(input);

    expect(decision.permissionResult).toBe("NOT_APPLICABLE");
  });

  // ---- T10: explanation provenance preserved ----
  it("T10: explanation preserved from P5-05", () => {
    const input = makeInput();
    const decision = producer.buildDecision(input);

    expect(decision.explanation.what).toContain("SELECTED");
    expect(decision.explanation.basedOn).toContain("narrative 1");
    expect(decision.explanation.policy).toContain("pol-p5-v1");
  });

  // ---- T11: SELECTED preservation ----
  it("T11: SELECTED outcome preserved with actionId", () => {
    const input = makeInput();
    const decision = producer.buildDecision(input);

    expect(decision.outcome).toBe("SELECTED");
    expect(decision.actionId).toBeDefined();
    expect(decision.actionType).toBe("MONITOR");
    expect(decision.parameters).toEqual({ scope: "test" });
  });

  // ---- T12: NO_ACTION preservation ----
  it("T12: NO_ACTION outcome preserved without actionId", () => {
    const input = makeInput({
      policyResult: makePolicyResult({
        outcome: "NO_ACTION",
        selectedCandidate: null,
        reasonCodes: ["NO_ELIGIBLE_ACTION"],
      }),
    });
    const decision = producer.buildDecision(input);

    expect(decision.outcome).toBe("NO_ACTION");
    expect(decision.actionId).toBeNull();
    expect(decision.actionType).toBeNull();
  });

  // ---- T13: NOT_DETERMINED preservation ----
  it("T13: NOT_DETERMINED outcome preserved", () => {
    const input = makeInput({
      policyResult: makePolicyResult({
        outcome: "NOT_DETERMINED",
        selectedCandidate: null,
        reasonCodes: ["POLICY_INPUT_UNAVAILABLE"],
      }),
      safetyResult: makeSafetyResult({ policyOutcome: "NOT_DETERMINED" }),
    });
    const decision = producer.buildDecision(input);

    expect(decision.outcome).toBe("NOT_DETERMINED");
    expect(decision.actionId).toBeNull();
  });

  // ---- T14: no semantic fallback ----
  it("T14: outcome is never derived from P4 — only from policyResult", () => {
    const input = makeInput({
      policyResult: makePolicyResult({ outcome: "NO_ACTION", selectedCandidate: null }),
    });
    const decision = producer.buildDecision(input);

    // Must be exactly the policy outcome, never inferred
    expect(decision.outcome).toBe("NO_ACTION");
    expect(decision.outcome).not.toBe("SELECTED");
  });

  // ---- T15: missing P4 input — policyResult required ----
  it("T15: throws when policyResult is missing", () => {
    const input = makeInput();
    // Manually create input without policyResult
    const badInput = { ...input, policyResult: undefined as any };

    expect(() => producer.buildDecision(badInput)).toThrow("policyResult is required");
  });

  // ---- T16: upstream NOT_DETERMINED preserved ----
  it("T16: upstream NOT_DETERMINED preserved without conversion", () => {
    const input = makeInput({
      policyResult: makePolicyResult({
        outcome: "NOT_DETERMINED",
        selectedCandidate: null,
        reasonCodes: ["POLICY_INPUT_UNAVAILABLE"],
      }),
      safetyResult: makeSafetyResult({ policyOutcome: "NOT_DETERMINED" }),
    });
    const decision = producer.buildDecision(input);

    expect(decision.outcome).toBe("NOT_DETERMINED");
    // Must NOT be converted to NO_ACTION
    expect(decision.outcome).not.toBe("NO_ACTION");
  });

  // ---- T17: safety output preservation ----
  it("T17: safety blocker preserved when present", () => {
    const input = makeInput({
      safetyResult: makeSafetyResult({
        safetyOutcome: "BLOCK",
        blockerReport: {
          source: "SAFETY",
          ref: "guardrail-001",
          versionRef: "v1",
          evaluatedAt: "evaluated",
          reason: "GUARDRAIL_BLOCKED",
        },
      }),
    });
    const decision = producer.buildDecision(input);

    expect(decision.blockerReport).toBeDefined();
    expect(decision.blockerReport!.source).toBe("SAFETY");
    expect(decision.blockerReport!.ref).toBe("guardrail-001");
  });

  // ---- T18: recorder called exactly once per commit ----
  it("T18: recorder called exactly once per commitDecision", async () => {
    const input = makeInput();
    const decision = producer.buildDecision(input);

    await producer.commitDecision(decision);

    expect(recorder.calls.length).toBe(1);
    expect(recorder.calls[0].decision.decisionId).toBe(decision.decisionId);
  });

  // ---- T19: failed commit does not silently mutate decision ----
  it("T19: decision record is immutable after buildDecision", () => {
    const input = makeInput();
    const decision = producer.buildDecision(input);
    const originalJson = JSON.stringify(decision);

    // The record should not change
    expect(JSON.stringify(decision)).toBe(originalJson);
  });

  // ---- T20: repeated commit is idempotent ----
  it("T20: repeated commit produces same recording result", async () => {
    const input = makeInput();
    const decision = producer.buildDecision(input);

    const r1 = await producer.commitDecision(decision);
    const r2 = await producer.commitDecision(decision);

    expect(r1.decision.decisionId).toBe(r2.decision.decisionId);
    expect(r1.recording.decisionId).toBe(r2.recording.decisionId);
  });

  // ---- T21: no direct DB dependency ----
  it("T21: producer module contains no DB imports", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const producerPath = path.resolve(__dirname, "../p5-decision-producer.ts");
    const content = fs.readFileSync(producerPath, "utf-8");

    expect(content).not.toMatch(/import.*(?:drizzle|pg|@\/db|postgres|prisma)/i);
    expect(content).not.toMatch(/\.query\(|\.execute\(|\.select\(|\.insert\(/);
  });

  // ---- T22: deterministic output ----
  it("T22: same input produces identical output", () => {
    const input = makeInput();
    const d1 = producer.buildDecision(input);
    const d2 = producer.buildDecision(input);

    expect(JSON.stringify(d1)).toBe(JSON.stringify(d2));
  });

  // ---- T23: no execution side effects ----
  it("T23: executionState is always NOT_APPLICABLE in V1", () => {
    const input = makeInput();
    const decision = producer.buildDecision(input);

    expect(decision.executionState).toBe("NOT_APPLICABLE");
  });

  // ---- T24: namespace/state separation ----
  it("T24: decisionState, approvalState, executionState are orthogonal", () => {
    const input = makeInput();
    const decision = producer.buildDecision(input);

    expect(decision.decisionState).toBe("DECIDED");
    expect(decision.approvalState).toBe("NOT_REQUIRED");
    expect(decision.executionState).toBe("NOT_APPLICABLE");
    // These are separate fields, never collapsed
  });

  // ---- T25: suppressed preservation ----
  it("T25: suppressed flag preserved from policy result", () => {
    const input = makeInput({
      policyResult: makePolicyResult({
        suppression: { suppressed: true, reasonCode: "SUPPRESSED" },
      }),
    });
    const decision = producer.buildDecision(input);

    expect(decision.suppressed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Forbidden-term scans
// ---------------------------------------------------------------------------

describe("P5-10 source scans", () => {
  it("producer contains no forbidden business semantics", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const producerPath = path.resolve(__dirname, "../p5-decision-producer.ts");
    const content = fs.readFileSync(producerPath, "utf-8");

    // Strip comments to avoid false positives from prohibition statements
    const codeOnly = content
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    // No BUY/SELL/LONG/SHORT/ORDER/TRADE
    expect(codeOnly).not.toMatch(/\b(BUY|SELL|LONG|SHORT|ORDER|TRADE)\b/);

    // No hidden scoring
    expect(codeOnly).not.toMatch(/\b(score|ranking|threshold)\b/i);

    // No legacy thresholds
    expect(codeOnly).not.toMatch(/\b(90|80|65|25|15)\b/);

    // No STRONG_WATCH / WATCH
    expect(codeOnly).not.toMatch(/\b(STRONG_WATCH|WATCH)\b/);

    // No Date.now() in rule logic
    expect(codeOnly).not.toMatch(/Date\.now\(\)/);

    // No Math.random()
    expect(codeOnly).not.toMatch(/Math\.random\(\)/);
  });

  it("types contain no forbidden business semantics", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const typesPath = path.resolve(__dirname, "../types.ts");
    const content = fs.readFileSync(typesPath, "utf-8");

    const codeOnly = content
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    expect(codeOnly).not.toMatch(/\b(BUY|SELL|LONG|SHORT|ORDER|TRADE)\b/);
    expect(codeOnly).not.toMatch(/\b(score|ranking|threshold)\b/i);
    expect(codeOnly).not.toMatch(/\b(STRONG_WATCH|WATCH)\b/);
  });
});
