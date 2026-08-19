/**
 * P5-05-RT — Explanation / Audit Runtime tests.
 *
 * Tests E01–E25+ covering:
 *  - Explanation construction from upstream facts
 *  - Provenance preservation
 *  - Audit event generation (frozen vocabulary)
 *  - Outcome preservation
 *  - Blocker provenance
 *  - Input immutability
 *  - Deterministic repeatability
 *  - No DB / persistence / live-data / LLM dependency
 *  - No forbidden business semantics
 */

import { P5ExplanationEvaluator } from "../evaluator";
import type { P5ExplanationInput } from "../types";
import type { P5PolicyEvaluationResult } from "../../policy/types";
import type { P5SafetyEvaluationResult } from "../../safety/types";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makePolicyResult(
  overrides: Partial<P5PolicyEvaluationResult> = {},
): P5PolicyEvaluationResult {
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

function makeSafetyResult(
  overrides: Partial<P5SafetyEvaluationResult> = {},
): P5SafetyEvaluationResult {
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

function makeInput(
  overrides: Partial<P5ExplanationInput> = {},
): P5ExplanationInput {
  return {
    decisionId: "decision-001",
    candidateId: "cand-001",
    actionId: "action-001",
    subject: { narrativeId: 1 },
    policyResult: makePolicyResult(),
    safetyResult: makeSafetyResult(),
    decisionState: "DECIDED",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P5ExplanationEvaluator", () => {
  const evaluator = new P5ExplanationEvaluator();

  // ---- E01: SELECTED explanation is deterministic ----
  it("E01: SELECTED explanation is deterministic", () => {
    const input = makeInput();
    const result1 = evaluator.evaluate(input);
    const result2 = evaluator.evaluate(input);

    expect(result1.explanation).toEqual(result2.explanation);
    expect(result1.provenance).toEqual(result2.provenance);
    expect(result1.auditEvents).toEqual(result2.auditEvents);
  });

  // ---- E02: NO_ACTION explanation preserves outcome ----
  it("E02: NO_ACTION explanation preserves outcome", () => {
    const input = makeInput({
      policyResult: makePolicyResult({
        outcome: "NO_ACTION",
        selectedCandidate: null,
        reasonCodes: ["NO_ELIGIBLE_ACTION"],
      }),
      actionId: null,
    });
    const result = evaluator.evaluate(input);

    expect(result.explanation.what).toContain("NO_ACTION");
    expect(result.explanation.what).toContain("nothing selected");
    expect(result.auditEvents[0].newState).toBe("NO_ACTION");
  });

  // ---- E03: NOT_DETERMINED explanation preserves outcome ----
  it("E03: NOT_DETERMINED explanation preserves outcome", () => {
    const input = makeInput({
      policyResult: makePolicyResult({
        outcome: "NOT_DETERMINED",
        selectedCandidate: null,
        reasonCodes: ["POLICY_INPUT_UNAVAILABLE"],
      }),
      actionId: null,
    });
    const result = evaluator.evaluate(input);

    expect(result.explanation.what).toContain("NOT_DETERMINED");
    expect(result.explanation.what).toContain("could not reliably determine");
    expect(result.auditEvents[0].newState).toBe("NOT_DETERMINED");
  });

  // ---- E04: BLOCKED explanation preserves outcome ----
  it("E04: BLOCKED explanation preserves outcome", () => {
    const input = makeInput({
      policyResult: makePolicyResult({
        outcome: "BLOCKED",
        selectedCandidate: null,
        blockerReport: {
          source: "POLICY",
          ruleId: "R-008",
          reasonCode: "POLICY_BLOCKED",
        },
        reasonCodes: ["POLICY_BLOCKED"],
      }),
      actionId: null,
    });
    const result = evaluator.evaluate(input);

    expect(result.explanation.what).toContain("BLOCKED");
    expect(result.explanation.why).toContain("POLICY");
    expect(result.explanation.why).toContain("R-008");
  });

  // ---- E05: POLICY-BLOCKED retains POLICY provenance ----
  it("E05: POLICY-BLOCKED retains POLICY provenance", () => {
    const input = makeInput({
      policyResult: makePolicyResult({
        outcome: "BLOCKED",
        selectedCandidate: null,
        blockerReport: {
          source: "POLICY",
          ruleId: "R-008",
          reasonCode: "POLICY_BLOCKED",
        },
        reasonCodes: ["POLICY_BLOCKED"],
      }),
      actionId: null,
    });
    const result = evaluator.evaluate(input);

    expect(result.explanation.why).toContain("POLICY");
  });

  // ---- E06: P4 provenance is preserved ----
  it("E06: P4 provenance is preserved", () => {
    const input = makeInput();
    const result = evaluator.evaluate(input);

    expect(result.provenance.p4SnapshotRef).toBeDefined();
    expect(result.provenance.p4SnapshotRef!.narrativeIdentity.narrativeId).toBe(1);
    expect(result.provenance.p4SnapshotRef!.status).toBe("OK");
    expect(result.explanation.basedOn).toContain("narrative 1");
    expect(result.explanation.basedOn).toContain("OK");
  });

  // ---- E07: P5-03 policy provenance is preserved ----
  it("E07: P5-03 policy provenance is preserved", () => {
    const input = makeInput();
    const result = evaluator.evaluate(input);

    expect(result.provenance.policy.policyId).toBe("pol-p5-v1");
    expect(result.provenance.policy.policyVersion).toBe("v1");
    expect(result.provenance.policy.ruleRefs).toEqual(["C-101", "C-201", "C-501"]);
    expect(result.explanation.policy).toContain("pol-p5-v1");
    expect(result.explanation.policy).toContain("v1");
  });

  // ---- E08: P5-04 safety result is preserved ----
  it("E08: P5-04 safety result is preserved", () => {
    const input = makeInput();
    const result = evaluator.evaluate(input);

    expect(result.provenance.safety.guardrailVersion).toBe("v1");
    expect(result.explanation.safety).toContain("PASS");
  });

  // ---- E09: permission state is not changed ----
  it("E09: permission state is not changed", () => {
    const input = makeInput({
      safetyResult: makeSafetyResult({ permissionState: "NOT_GRANTED" }),
    });
    const result = evaluator.evaluate(input);

    expect(result.explanation.currentState).toContain("NOT_GRANTED");
  });

  // ---- E10: approval state is not changed ----
  it("E10: approval state is not changed", () => {
    const input = makeInput();
    const result = evaluator.evaluate(input);

    expect(result.explanation.approval).toContain("NOT_REQUIRED");
    expect(result.explanation.currentState).toContain("NOT_REQUIRED");
  });

  // ---- E11: explanation cannot change decision outcome ----
  it("E11: explanation cannot change decision outcome", () => {
    const outcomes = ["SELECTED", "NO_ACTION", "NOT_DETERMINED", "BLOCKED"] as const;

    for (const outcome of outcomes) {
      const input = makeInput({
        policyResult: makePolicyResult({
          outcome,
          selectedCandidate: outcome === "SELECTED"
            ? { candidateId: "c-1", actionType: "MONITOR", parameters: {}, subject: { narrativeId: 1 } }
            : null,
        }),
        actionId: outcome === "SELECTED" ? "action-1" : null,
      });
      const result = evaluator.evaluate(input);
      expect(result.auditEvents[0].newState).toBe(outcome);
    }
  });

  // ---- E12: audit vocabulary contains only frozen event types ----
  it("E12: audit vocabulary contains only frozen event types", () => {
    const frozenTypes = new Set([
      "DecisionProduced",
      "DecisionSuppressed",
      "DecisionSuperseded",
      "DecisionExpired",
      "DecisionCancelled",
      "ApprovalRequired",
      "ApprovalGranted",
      "ApprovalDenied",
      "ApprovalExpired",
      "ApprovalRevoked",
      "PermissionGranted",
      "PermissionRevoked",
      "PermissionExpired",
    ]);

    const input = makeInput();
    const result = evaluator.evaluate(input);

    for (const event of result.auditEvents) {
      expect(frozenTypes.has(event.eventType)).toBe(true);
    }
  });

  // ---- E13: audit chronology is deterministic ----
  it("E13: audit chronology is deterministic", () => {
    const input = makeInput();
    const result1 = evaluator.evaluate(input);
    const result2 = evaluator.evaluate(input);

    expect(result1.auditEvents.map((e) => e.eventId)).toEqual(
      result2.auditEvents.map((e) => e.eventId),
    );
  });

  // ---- E14: missing evidence is represented honestly ----
  it("E14: missing evidence (NOT_DETERMINED) is represented honestly", () => {
    const input = makeInput({
      policyResult: makePolicyResult({
        outcome: "NOT_DETERMINED",
        selectedCandidate: null,
        reasonCodes: ["POLICY_INPUT_UNAVAILABLE"],
      }),
      actionId: null,
    });
    const result = evaluator.evaluate(input);

    expect(result.explanation.what).toContain("NOT_DETERMINED");
    expect(result.explanation.why).toContain("POLICY_INPUT_UNAVAILABLE");
    // Must NOT say "nothing selected" or "no action taken"
    expect(result.explanation.what).not.toContain("nothing selected");
  });

  // ---- E15: missing provenance is not fabricated ----
  it("E15: missing provenance is not fabricated", () => {
    const input = makeInput({
      candidateId: null,
      actionId: null,
      policyResult: makePolicyResult({
        outcome: "NOT_DETERMINED",
        selectedCandidate: null,
        reasonCodes: ["POLICY_INPUT_UNAVAILABLE"],
      }),
    });
    const result = evaluator.evaluate(input);

    expect(result.provenance.candidateId).toBeNull();
    expect(result.provenance.actionId).toBeNull();
  });

  // ---- E16: input objects are not mutated ----
  it("E16: input objects are not mutated", () => {
    const input = makeInput();
    const frozenPolicy = JSON.stringify(input.policyResult);
    const frozenSafety = JSON.stringify(input.safetyResult);

    evaluator.evaluate(input);

    expect(JSON.stringify(input.policyResult)).toBe(frozenPolicy);
    expect(JSON.stringify(input.safetyResult)).toBe(frozenSafety);
  });

  // ---- E17: same input → identical output (deep equal) ----
  it("E17: same input → identical output", () => {
    const input = makeInput();
    const result1 = evaluator.evaluate(input);
    const result2 = evaluator.evaluate(input);

    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
  });

  // ---- E18: no DB dependency ----
  it("E18: no DB dependency", () => {
    const evaluatorSource = jest.requireActual("fs").readFileSync(
      require("path").resolve(__dirname, "../evaluator.ts"),
      "utf-8",
    );
    expect(evaluatorSource).not.toMatch(/import.*(?:Drizzle|pg|postgres|prisma|mongoose)/i);
    expect(evaluatorSource).not.toMatch(/\.query\(|\.execute\(|\.findMany\(|\.findFirst\(/);
  });

  // ---- E19: no persistence dependency ----
  it("E19: no persistence dependency", () => {
    const evaluatorSource = jest.requireActual("fs").readFileSync(
      require("path").resolve(__dirname, "../evaluator.ts"),
      "utf-8",
    );
    expect(evaluatorSource).not.toMatch(/import.*(?:HistoricalArtifact|ArtifactStore|ArtifactWriter|ArtifactRecorder)/i);
    expect(evaluatorSource).not.toMatch(/\.insert|\.upsert|\.update\(/);
  });

  // ---- E20: no live-data dependency ----
  it("E20: no live-data dependency", () => {
    const evaluatorSource = jest.requireActual("fs").readFileSync(
      require("path").resolve(__dirname, "../evaluator.ts"),
      "utf-8",
    );
    // Should not query P4 or narrative state
    expect(evaluatorSource).not.toMatch(/import.*(?:P4ViewModel|P4Service|narrativeService)/i);
  });

  // ---- E21: no LLM dependency ----
  it("E21: no LLM dependency", () => {
    const evaluatorSource = jest.requireActual("fs").readFileSync(
      require("path").resolve(__dirname, "../evaluator.ts"),
      "utf-8",
    );
    expect(evaluatorSource).not.toMatch(/import.*(?:openai|anthropic|llm|gpt|claude)/i);
  });

  // ---- E22: provenance record has all required fields ----
  it("E22: provenance record has all required fields", () => {
    const input = makeInput();
    const result = evaluator.evaluate(input);

    const p = result.provenance;
    expect(p.decisionId).toBeDefined();
    expect(p.p4SnapshotRef).toBeDefined();
    expect(p.p4SnapshotRef!.narrativeIdentity).toBeDefined();
    expect(p.p4SnapshotRef!.versionTuple).toBeDefined();
    expect(p.policy.policyId).toBeDefined();
    expect(p.policy.policyVersion).toBeDefined();
    expect(p.policy.ruleRefs).toBeDefined();
    expect(p.safety.guardrailVersion).toBeDefined();
    expect(p.approval.approvalPolicyVersion).toBeDefined();
    expect(p.automationMode).toBeDefined();
    expect(p.versions.actionModelVersion).toBeDefined();
    expect(p.timestamps).toBeDefined();
  });

  // ---- E23: audit event has all required §17 fields ----
  it("E23: audit event has all required fields", () => {
    const input = makeInput();
    const result = evaluator.evaluate(input);

    for (const event of result.auditEvents) {
      expect(event.eventId).toBeDefined();
      expect(event.eventType).toBeDefined();
      expect(event.timestamp).toBeDefined();
      expect(event.decisionIdRef).toBeDefined();
      expect(event.provenance).toBeDefined();
    }
  });

  // ---- E24: DecisionProduced event carries correct outcome ----
  it("E24: DecisionProduced event carries correct outcome", () => {
    const input = makeInput({
      policyResult: makePolicyResult({ outcome: "NO_ACTION", selectedCandidate: null }),
      actionId: null,
    });
    const result = evaluator.evaluate(input);

    const dp = result.auditEvents.find((e) => e.eventType === "DecisionProduced");
    expect(dp).toBeDefined();
    expect(dp!.newState).toBe("NO_ACTION");
    expect(dp!.actor).toBe("SYSTEM");
  });

  // ---- E25: BLOCKED explanation distinguishes from NO_ACTION ----
  it("E25: BLOCKED explanation distinguishes from NO_ACTION", () => {
    const blockedInput = makeInput({
      policyResult: makePolicyResult({
        outcome: "BLOCKED",
        selectedCandidate: null,
        blockerReport: { source: "POLICY", ruleId: "R-008", reasonCode: "POLICY_BLOCKED" },
        reasonCodes: ["POLICY_BLOCKED"],
      }),
      actionId: null,
    });
    const noActionInput = makeInput({
      policyResult: makePolicyResult({
        outcome: "NO_ACTION",
        selectedCandidate: null,
        reasonCodes: ["NO_ELIGIBLE_ACTION"],
      }),
      actionId: null,
    });

    const blockedResult = evaluator.evaluate(blockedInput);
    const noActionResult = evaluator.evaluate(noActionInput);

    // BLOCKED must NOT be explained as NO_ACTION
    expect(blockedResult.explanation.what).not.toContain("nothing selected");
    expect(blockedResult.explanation.what).toContain("BLOCKED");
    // NO_ACTION must NOT be explained as BLOCKED
    expect(noActionResult.explanation.what).not.toContain("BLOCKED");
    expect(noActionResult.explanation.what).toContain("nothing selected");
  });

  // ---- E26: NOT_DETERMINED never becomes NO_ACTION ----
  it("E26: NOT_DETERMINED never becomes NO_ACTION", () => {
    const input = makeInput({
      policyResult: makePolicyResult({
        outcome: "NOT_DETERMINED",
        selectedCandidate: null,
        reasonCodes: ["POLICY_INPUT_UNAVAILABLE"],
      }),
      actionId: null,
    });
    const result = evaluator.evaluate(input);

    expect(result.explanation.what).toContain("NOT_DETERMINED");
    expect(result.explanation.what).not.toContain("nothing selected");
    expect(result.auditEvents[0].newState).toBe("NOT_DETERMINED");
  });

  // ---- E27: suppression produces DecisionSuppressed event ----
  it("E27: suppression produces DecisionSuppressed event", () => {
    const input = makeInput({
      policyResult: makePolicyResult({
        outcome: "NO_ACTION",
        selectedCandidate: null,
        suppression: { suppressed: true, reasonCode: "SUPPRESSED" },
        reasonCodes: ["SUPPRESSED"],
      }),
      actionId: null,
    });
    const result = evaluator.evaluate(input);

    const ds = result.auditEvents.find((e) => e.eventType === "DecisionSuppressed");
    expect(ds).toBeDefined();
    expect(ds!.reason).toBe("SUPPRESSED");
  });

  // ---- E28: advisory action permission = NOT_APPLICABLE ----
  it("E28: advisory action permission = NOT_APPLICABLE", () => {
    const input = makeInput({
      safetyResult: makeSafetyResult({ permissionState: "NOT_APPLICABLE" }),
    });
    const result = evaluator.evaluate(input);

    expect(result.explanation.currentState).toContain("NOT_APPLICABLE");
  });

  // ---- E29: consequential action permission = NOT_GRANTED ----
  it("E29: consequential action permission = NOT_GRANTED", () => {
    const input = makeInput({
      safetyResult: makeSafetyResult({
        permissionState: "NOT_GRANTED",
        actionClass: "CONSEQUENTIAL",
      }),
    });
    const result = evaluator.evaluate(input);

    expect(result.explanation.currentState).toContain("NOT_GRANTED");
  });

  // ---- E30: no execution permission is ever granted ----
  it("E30: no execution permission is ever granted in V1", () => {
    const evaluatorSource = jest.requireActual("fs").readFileSync(
      require("path").resolve(__dirname, "../evaluator.ts"),
      "utf-8",
    );
    // The evaluator should never produce "GRANTED" as a permission result
    // (it preserves upstream — V1 safety always produces NOT_APPLICABLE or NOT_GRANTED)
    expect(evaluatorSource).not.toMatch(/permissionState.*=.*"GRANTED"/);
  });

  // ---- E31: guardrail results are preserved from upstream ----
  it("E31: guardrail results are preserved from upstream", () => {
    const input = makeInput({
      safetyResult: makeSafetyResult({
        guardrailResults: [
          {
            guardrailId: "g-001",
            version: "v1",
            outcome: "PASS",
            applicable: true,
            evaluatedAt: "evaluated",
            reason: null,
          },
        ],
      }),
    });
    const result = evaluator.evaluate(input);

    expect(result.explanation.safety).toContain("1 guardrails evaluated");
  });

  // ---- E32: evaluator is a pure function (no side effects) ----
  it("E32: evaluator is a pure function (no side effects)", () => {
    const input = makeInput();
    const before = JSON.stringify(input);

    evaluator.evaluate(input);

    expect(JSON.stringify(input)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Forbidden-term scans
// ---------------------------------------------------------------------------

describe("P5-05-RT source scans", () => {
  it("evaluator contains no forbidden business semantics", () => {
    const fs = require("fs");
    const path = require("path");
    const evalPath = path.resolve(__dirname, "../evaluator.ts");
    const content = fs.readFileSync(evalPath, "utf-8");

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

    // No legacy rule engine reuse
    expect(codeOnly).not.toMatch(/rule-version\.service/);

    // No Date.now() in rule logic (allowed in prohibition comments only)
    expect(codeOnly).not.toMatch(/Date\.now\(\)/);

    // No Math.random()
    expect(codeOnly).not.toMatch(/Math\.random\(\)/);
  });

  it("types contain no forbidden business semantics", () => {
    const fs = require("fs");
    const path = require("path");
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
