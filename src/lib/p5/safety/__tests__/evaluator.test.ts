/**
 * P5-04-RT — Safety / Approval / Permission Evaluator Tests.
 *
 * Covers:
 *  - T01–T06: Advisory/consequential action matrix
 *  - T07–T08: Outcome preservation (NO_ACTION, NOT_DETERMINED)
 *  - T09: Guardrail results empty
 *  - T10: No permission ever granted
 *  - T11: Deterministic repeatability
 *  - T12: No DB access
 *  - T13: Input immutability
 *  - T14: Policy provenance preserved
 *  - T15: Safety blocker provenance (future)
 *  - T16: Action-state matrix
 *  - Additional: semantic boundary tests
 */

import { P5SafetyEvaluator } from "../evaluator";
import type { P5PolicyEvaluationResult } from "../../policy/types";
import type { P5ActionType } from "../../types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createPolicyResult(
  actionType: P5ActionType | null,
  outcome: "SELECTED" | "NO_ACTION" | "NOT_DETERMINED" = "SELECTED",
): P5PolicyEvaluationResult {
  const candidate = actionType
    ? {
        candidateId: `candidate-${actionType.toLowerCase()}`,
        actionType,
        parameters: {},
        subject: { narrativeId: 1 },
      }
    : null;

  return {
    outcome,
    eligibility: { eligible: outcome === "SELECTED", ruleIds: ["C-501"], reasonCode: null },
    selectedCandidate: candidate,
    suppression: { suppressed: false, reasonCode: null },
    blockerReport: null,
    provenance: {
      policyId: "pol-p5-v1",
      policyVersion: "v1",
      effectiveAt: "2026-08-17T00:00:00.000Z",
      evaluationAt: "evaluated",
      ruleRefs: ["C-101", "C-501"],
      p4SnapshotRef: {
        narrativeIdentity: {
          narrativeId: 1,
          window: "7d",
          algorithmKey: "narrative-health",
          algorithmVersion: "1.0.0",
          calculationMode: "standard",
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
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P5SafetyEvaluator", () => {
  let evaluator: P5SafetyEvaluator;

  beforeEach(() => {
    evaluator = new P5SafetyEvaluator();
  });

  // -----------------------------------------------------------------------
  // T01: SELECTED + MONITOR
  // -----------------------------------------------------------------------
  describe("T01: SELECTED + MONITOR", () => {
    it("produces safety PASS, approval NOT_REQUIRED, permission NOT_APPLICABLE", () => {
      const input = { policyResult: createPolicyResult("MONITOR", "SELECTED") };
      const result = evaluator.evaluate(input);

      expect(result.safetyOutcome).toBe("PASS");
      expect(result.approvalState).toBe("NOT_REQUIRED");
      expect(result.approvalRecord).toBeNull();
      expect(result.permissionState).toBe("NOT_APPLICABLE");
      expect(result.actionClass).toBe("ADVISORY");
      expect(result.policyOutcome).toBe("SELECTED");
    });
  });

  // -----------------------------------------------------------------------
  // T02: SELECTED + REVIEW
  // -----------------------------------------------------------------------
  describe("T02: SELECTED + REVIEW", () => {
    it("produces safety PASS, approval NOT_REQUIRED, permission NOT_APPLICABLE", () => {
      const input = { policyResult: createPolicyResult("REVIEW", "SELECTED") };
      const result = evaluator.evaluate(input);

      expect(result.safetyOutcome).toBe("PASS");
      expect(result.approvalState).toBe("NOT_REQUIRED");
      expect(result.approvalRecord).toBeNull();
      expect(result.permissionState).toBe("NOT_APPLICABLE");
      expect(result.actionClass).toBe("ADVISORY");
    });
  });

  // -----------------------------------------------------------------------
  // T03: SELECTED + INVESTIGATE
  // -----------------------------------------------------------------------
  describe("T03: SELECTED + INVESTIGATE", () => {
    it("produces safety PASS, approval NOT_REQUIRED, permission NOT_APPLICABLE", () => {
      const input = { policyResult: createPolicyResult("INVESTIGATE", "SELECTED") };
      const result = evaluator.evaluate(input);

      expect(result.safetyOutcome).toBe("PASS");
      expect(result.approvalState).toBe("NOT_REQUIRED");
      expect(result.approvalRecord).toBeNull();
      expect(result.permissionState).toBe("NOT_APPLICABLE");
      expect(result.actionClass).toBe("ADVISORY");
    });
  });

  // -----------------------------------------------------------------------
  // T04: SELECTED + REDUCE_EXPOSURE
  // -----------------------------------------------------------------------
  describe("T04: SELECTED + REDUCE_EXPOSURE", () => {
    it("produces safety PASS, approval NOT_REQUIRED, permission NOT_GRANTED", () => {
      const input = { policyResult: createPolicyResult("REDUCE_EXPOSURE", "SELECTED") };
      const result = evaluator.evaluate(input);

      expect(result.safetyOutcome).toBe("PASS");
      expect(result.approvalState).toBe("NOT_REQUIRED");
      expect(result.approvalRecord).toBeNull();
      expect(result.permissionState).toBe("NOT_GRANTED");
      expect(result.actionClass).toBe("CONSEQUENTIAL");
    });
  });

  // -----------------------------------------------------------------------
  // T05: SELECTED + INCREASE_EXPOSURE
  // -----------------------------------------------------------------------
  describe("T05: SELECTED + INCREASE_EXPOSURE", () => {
    it("produces safety PASS, approval NOT_REQUIRED, permission NOT_GRANTED", () => {
      const input = { policyResult: createPolicyResult("INCREASE_EXPOSURE", "SELECTED") };
      const result = evaluator.evaluate(input);

      expect(result.safetyOutcome).toBe("PASS");
      expect(result.approvalState).toBe("NOT_REQUIRED");
      expect(result.approvalRecord).toBeNull();
      expect(result.permissionState).toBe("NOT_GRANTED");
      expect(result.actionClass).toBe("CONSEQUENTIAL");
    });
  });

  // -----------------------------------------------------------------------
  // T06: SELECTED + REBALANCE
  // -----------------------------------------------------------------------
  describe("T06: SELECTED + REBALANCE", () => {
    it("produces safety PASS, approval NOT_REQUIRED, permission NOT_GRANTED", () => {
      const input = { policyResult: createPolicyResult("REBALANCE", "SELECTED") };
      const result = evaluator.evaluate(input);

      expect(result.safetyOutcome).toBe("PASS");
      expect(result.approvalState).toBe("NOT_REQUIRED");
      expect(result.approvalRecord).toBeNull();
      expect(result.permissionState).toBe("NOT_GRANTED");
      expect(result.actionClass).toBe("CONSEQUENTIAL");
    });
  });

  // -----------------------------------------------------------------------
  // T07: NO_ACTION — outcome preserved
  // -----------------------------------------------------------------------
  describe("T07: NO_ACTION", () => {
    it("preserves NO_ACTION outcome without fabricated safety blocker", () => {
      const input = { policyResult: createPolicyResult("MONITOR", "NO_ACTION") };
      const result = evaluator.evaluate(input);

      expect(result.policyOutcome).toBe("NO_ACTION");
      expect(result.safetyOutcome).toBe("PASS");
      expect(result.blockerReport).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // T08: NOT_DETERMINED — outcome preserved
  // -----------------------------------------------------------------------
  describe("T08: NOT_DETERMINED", () => {
    it("preserves NOT_DETERMINED without conversion to NO_ACTION", () => {
      const input = { policyResult: createPolicyResult("MONITOR", "NOT_DETERMINED") };
      const result = evaluator.evaluate(input);

      expect(result.policyOutcome).toBe("NOT_DETERMINED");
      expect(result.safetyOutcome).toBe("PASS");
      expect(result.blockerReport).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // T09: guardrailResults remains []
  // -----------------------------------------------------------------------
  describe("T09: empty guardrail results", () => {
    it("returns empty guardrailResults array", () => {
      const input = { policyResult: createPolicyResult("MONITOR", "SELECTED") };
      const result = evaluator.evaluate(input);

      expect(result.guardrailResults).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // T10: no permission ever granted
  // -----------------------------------------------------------------------
  describe("T10: no permission granted", () => {
    it.each([
      "MONITOR",
      "REVIEW",
      "INVESTIGATE",
      "REDUCE_EXPOSURE",
      "INCREASE_EXPOSURE",
      "REBALANCE",
    ] as const)("never grants permission for %s", (actionType) => {
      const input = { policyResult: createPolicyResult(actionType, "SELECTED") };
      const result = evaluator.evaluate(input);

      expect(result.permissionState).not.toBe("GRANTED");
    });
  });

  // -----------------------------------------------------------------------
  // T11: deterministic repeatability
  // -----------------------------------------------------------------------
  describe("T11: deterministic", () => {
    it("produces identical output for same input", () => {
      const input = { policyResult: createPolicyResult("REDUCE_EXPOSURE", "SELECTED") };
      const result1 = evaluator.evaluate(input);
      const result2 = evaluator.evaluate(input);

      expect(result1).toEqual(result2);
    });
  });

  // -----------------------------------------------------------------------
  // T12: no DB access
  // -----------------------------------------------------------------------
  describe("T12: no DB access", () => {
    it("does not import database modules", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const evalPath = path.resolve(__dirname, "../evaluator.ts");
      const content = fs.readFileSync(evalPath, "utf-8");

      // Check for forbidden imports
      const forbiddenImports = ["drizzle", "pg", "postgres", "HistoricalArtifactStore", "ArtifactRecorder"];
      for (const imp of forbiddenImports) {
        expect(content).not.toContain(imp);
      }
    });
  });

  // -----------------------------------------------------------------------
  // T13: input immutability
  // -----------------------------------------------------------------------
  describe("T13: input immutability", () => {
    it("does not mutate the input policy result", () => {
      const policyResult = createPolicyResult("REDUCE_EXPOSURE", "SELECTED");
      const originalOutcome = policyResult.outcome;
      const originalCandidate = { ...policyResult.selectedCandidate };

      const input = { policyResult };
      evaluator.evaluate(input);

      expect(policyResult.outcome).toBe(originalOutcome);
      expect(policyResult.selectedCandidate).toEqual(originalCandidate);
    });
  });

  // -----------------------------------------------------------------------
  // T14: policy provenance preserved
  // -----------------------------------------------------------------------
  describe("T14: policy provenance preserved", () => {
    it("preserves P5-03 policy provenance in safety provenance", () => {
      const input = { policyResult: createPolicyResult("MONITOR", "SELECTED") };
      const result = evaluator.evaluate(input);

      expect(result.provenance.policyProvenance).toEqual(input.policyResult.provenance);
      expect(result.provenance.policyProvenance.policyId).toBe("pol-p5-v1");
      expect(result.provenance.policyProvenance.policyVersion).toBe("v1");
    });
  });

  // -----------------------------------------------------------------------
  // T15: safety blocker provenance (future — no blocker in V1)
  // -----------------------------------------------------------------------
  describe("T15: no safety blocker in V1", () => {
    it("produces null blockerReport for all action types", () => {
      const actionTypes: P5ActionType[] = [
        "MONITOR",
        "REVIEW",
        "INVESTIGATE",
        "REDUCE_EXPOSURE",
        "INCREASE_EXPOSURE",
        "REBALANCE",
      ];

      for (const actionType of actionTypes) {
        const input = { policyResult: createPolicyResult(actionType, "SELECTED") };
        const result = evaluator.evaluate(input);
        expect(result.blockerReport).toBeNull();
      }
    });
  });

  // -----------------------------------------------------------------------
  // T16: action-state matrix
  // -----------------------------------------------------------------------
  describe("T16: action-state matrix", () => {
    it("advisory actions produce NOT_APPLICABLE permission", () => {
      const advisoryTypes: P5ActionType[] = ["MONITOR", "REVIEW", "INVESTIGATE"];
      for (const actionType of advisoryTypes) {
        const input = { policyResult: createPolicyResult(actionType, "SELECTED") };
        const result = evaluator.evaluate(input);
        expect(result.actionClass).toBe("ADVISORY");
        expect(result.permissionState).toBe("NOT_APPLICABLE");
      }
    });

    it("consequential actions produce NOT_GRANTED permission", () => {
      const consequentialTypes: P5ActionType[] = [
        "REDUCE_EXPOSURE",
        "INCREASE_EXPOSURE",
        "REBALANCE",
      ];
      for (const actionType of consequentialTypes) {
        const input = { policyResult: createPolicyResult(actionType, "SELECTED") };
        const result = evaluator.evaluate(input);
        expect(result.actionClass).toBe("CONSEQUENTIAL");
        expect(result.permissionState).toBe("NOT_GRANTED");
      }
    });
  });

  // -----------------------------------------------------------------------
  // Additional: semantic boundary tests
  // -----------------------------------------------------------------------
  describe("semantic boundaries", () => {
    it("safety outcome is orthogonal to policy outcome", () => {
      const noAction = evaluator.evaluate({
        policyResult: createPolicyResult("MONITOR", "NO_ACTION"),
      });
      const selected = evaluator.evaluate({
        policyResult: createPolicyResult("MONITOR", "SELECTED"),
      });

      // Both have PASS safety, but different policy outcomes
      expect(noAction.safetyOutcome).toBe("PASS");
      expect(selected.safetyOutcome).toBe("PASS");
      expect(noAction.policyOutcome).toBe("NO_ACTION");
      expect(selected.policyOutcome).toBe("SELECTED");
    });

    it("no hidden scoring or thresholds", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const evalPath = path.resolve(__dirname, "../evaluator.ts");
      const content = fs.readFileSync(evalPath, "utf-8");

      // Strip comments to avoid false positives from prohibition statements
      const codeOnly = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

      expect(codeOnly).not.toMatch(/\bscore\b/i);
      expect(codeOnly).not.toMatch(/\bthreshold\b/i);
      expect(codeOnly).not.toMatch(/\branking\b/i);
    });

    it("no BUY/SELL/LONG/SHORT/ORDER/TRADE semantics", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const evalPath = path.resolve(__dirname, "../evaluator.ts");
      const content = fs.readFileSync(evalPath, "utf-8");

      // Strip comments to avoid false positives from prohibition statements
      const codeOnly = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

      expect(codeOnly).not.toMatch(/\bBUY\b/);
      expect(codeOnly).not.toMatch(/\bSELL\b/);
      expect(codeOnly).not.toMatch(/\bLONG\b/);
      expect(codeOnly).not.toMatch(/\bSHORT\b/);
      expect(codeOnly).not.toMatch(/\bORDER\b/);
      expect(codeOnly).not.toMatch(/\bTRADE\b/);
    });

    it("no legacy P1 rule reuse", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const evalPath = path.resolve(__dirname, "../evaluator.ts");
      const content = fs.readFileSync(evalPath, "utf-8");

      expect(content).not.toContain("rule-version.service");
      expect(content).not.toContain("decision-engine.service");
      expect(content).not.toContain("STRONG_WATCH");
    });

    it("no Date.now / Math.random", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const evalPath = path.resolve(__dirname, "../evaluator.ts");
      const content = fs.readFileSync(evalPath, "utf-8");

      // Strip comments to avoid false positives from prohibition statements
      const codeOnly = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

      expect(codeOnly).not.toContain("Date.now()");
      expect(codeOnly).not.toContain("Math.random()");
    });

    it("approval state is NOT_REQUIRED for all actions", () => {
      const actionTypes: P5ActionType[] = [
        "MONITOR",
        "REVIEW",
        "INVESTIGATE",
        "REDUCE_EXPOSURE",
        "INCREASE_EXPOSURE",
        "REBALANCE",
      ];

      for (const actionType of actionTypes) {
        const input = { policyResult: createPolicyResult(actionType, "SELECTED") };
        const result = evaluator.evaluate(input);
        expect(result.approvalState).toBe("NOT_REQUIRED");
        expect(result.approvalRecord).toBeNull();
      }
    });

    it("V1 automation mode is ADVISORY", () => {
      const input = { policyResult: createPolicyResult("MONITOR", "SELECTED") };
      const result = evaluator.evaluate(input);

      expect(result.provenance.automationMode).toBe("ADVISORY");
    });

    it("preserves block source semantics (no safety blocker without BLOCK outcome)", () => {
      const input = { policyResult: createPolicyResult("REDUCE_EXPOSURE", "SELECTED") };
      const result = evaluator.evaluate(input);

      // No blocker when safety is PASS
      expect(result.blockerReport).toBeNull();
    });
  });
});
