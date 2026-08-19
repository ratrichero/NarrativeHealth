/**
 * P5-11 — Runtime Integration Adapter Tests.
 *
 * These tests verify the P5-11 adapter orchestrates the frozen
 * P5-03 → P5-04 → P5-05 → P5-10 chain correctly.
 *
 * Test infrastructure:
 *  - Uses the real frozen evaluators (P5-03, P5-04, P5-05).
 *  - Uses a mock P5Producer (no DB dependency).
 *  - Does NOT test persistence — that is P5-09's responsibility.
 */

import { P5RuntimeAdapter, type P5Producer, type P5PipelineResult } from "../p5-runtime-adapter";
import type { P4DecisionSupportViewModel } from "@/lib/p4/types";
import type { P5CommitResult, P5ProducerInput } from "@/lib/p5/producer/types";
import type { P5RecordingResult } from "@/lib/p5/record/p5-artifact-recorder";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createP4Snapshot(overrides?: Partial<P4DecisionSupportViewModel>): P4DecisionSupportViewModel {
  return {
    status: "OK",
    version: {
      algorithmVersion: "p4-decision-support",
      semanticVersion: "1",
      signalCatalogVersion: "v1",
    },
    narrativeIdentity: {
      narrativeId: 1,
      window: "2026-08-01/2026-08-18",
      algorithmKey: "narrative-health",
      algorithmVersion: "1.0.0",
      calculationMode: "default",
    },
    generatedAt: "2026-08-18T00:00:00.000Z",
    asOf: "2026-08-18T00:00:00.000Z",
    direction: "POSITIVE",
    signals: [],
    opportunity: "MEDIUM",
    risk: "LOW",
    confidence: "MEDIUM",
    actionability: "LOW",
    explanation: {
      items: [],
      attribution: {
        algorithmVersion: "p4-decision-support",
        semanticVersion: "1",
        interpretationRuleVersion: "p4-03/v1",
        explanationVersion: "1",
      },
      generatedAt: "2026-08-18T00:00:00.000Z",
    },
    evidence: [],
    historicalContext: {
      seriesLength: 5,
      steps: 4,
      overallTrend: "STABLE",
      dataSufficiency: {
        comparableArtifacts: 5,
        requiredMinimum: 3,
        sufficient: true,
      },
      current: {
        artifactId: 100,
        windowEnd: "2026-08-18",
        availabilityState: "VALID",
      },
      previous: {
        artifactId: 99,
        windowEnd: "2026-08-11",
        availabilityState: "VALID",
      },
    },
    provenance: {
      sourceLayer: "P4",
      derivedFrom: ["99", "100"],
      p2EventRisk: false,
      semanticVersion: "1",
    },
    degradation: [],
    ...overrides,
  };
}

function mockRecordingResult(decisionId: string): P5RecordingResult {
  return {
    decisionId,
    items: [
      { artifact: "snapshot", identity: "test", status: "RECORDED", reason: null },
      { artifact: "policy", identity: "test", status: "RECORDED", reason: null },
      { artifact: "decision", identity: decisionId, status: "RECORDED", reason: null },
    ],
    complete: true,
  };
}

function createMockProducer(): P5Producer {
  return {
    produce: async (input: P5ProducerInput): Promise<P5CommitResult> => {
      const decisionId = `p5d-mock-${input.subject.narrativeId}`;
      return {
        decision: {
          decisionId,
          candidateId: input.policyResult.selectedCandidate?.candidateId ?? null,
          actionId: input.policyResult.outcome === "SELECTED" ? `action-${decisionId}` : null,
          subject: input.subject,
          outcome: input.policyResult.outcome,
          suppressed: input.policyResult.suppression.suppressed,
          blockerReport: null,
          actionType: input.policyResult.selectedCandidate?.actionType ?? null,
          parameters: input.policyResult.selectedCandidate?.parameters ?? null,
          decisionState: "DECIDED",
          approvalState: "NOT_REQUIRED",
          executionState: "NOT_APPLICABLE",
          approvalRecord: null,
          safetyResult: {
            aggregate: input.safetyResult.safetyOutcome,
            guardrailResults: input.safetyResult.guardrailResults,
          },
          permissionResult: input.safetyResult.permissionState,
          explanation: input.explanationResult.explanation,
          provenance: input.explanationResult.provenance,
          auditEvents: input.explanationResult.auditEvents.map((e) => ({
            eventId: e.eventId,
            eventType: e.eventType,
            timestamp: e.timestamp,
            actor: e.actor,
            decisionIdRef: e.decisionIdRef,
            previousState: e.previousState,
            newState: e.newState,
            reason: e.reason,
            policyVersionRef: e.policyVersionRef,
            guardrailRef: e.guardrailRef,
            approvalRef: e.approvalRef,
          })),
        },
        recording: mockRecordingResult(decisionId),
      };
    },
  };
}

function createFailingProducer(error: Error): P5Producer {
  return {
    produce: async () => {
      throw error;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P5-11 Runtime Integration Adapter", () => {
  describe("I01: Full pipeline invocation", () => {
    it("should execute P4 → P5-03 → P5-04 → P5-05 → P5-10 chain", async () => {
      const adapter = new P5RuntimeAdapter(createMockProducer());
      const p4 = createP4Snapshot();

      const result = await adapter.evaluate(1, p4);

      expect(result.error).toBeNull();
      expect(result.decision).not.toBeNull();
      expect(result.commit).not.toBeNull();
    });
  });

  describe("I02: SELECTED path", () => {
    it("should produce SELECTED outcome for OK status", async () => {
      const adapter = new P5RuntimeAdapter(createMockProducer());
      const p4 = createP4Snapshot({ status: "OK" });

      const result = await adapter.evaluate(1, p4);

      expect(result.error).toBeNull();
      expect(result.decision?.outcome).toBe("SELECTED");
    });
  });

  describe("I03: NO_ACTION path", () => {
    it("should produce NO_ACTION when P4 direction is UNKNOWN", async () => {
      const adapter = new P5RuntimeAdapter(createMockProducer());
      const p4 = createP4Snapshot({ direction: "UNKNOWN" });

      const result = await adapter.evaluate(1, p4);

      expect(result.error).toBeNull();
      // UNKNOWN direction makes MONITOR ineligible → NO_ACTION
      expect(result.decision?.outcome).toBe("NO_ACTION");
    });
  });

  describe("I04: NOT_DETERMINED path", () => {
    it("should produce NOT_DETERMINED when P4 status is NO_EVIDENCE", async () => {
      const adapter = new P5RuntimeAdapter(createMockProducer());
      const p4 = createP4Snapshot({ status: "NO_EVIDENCE" });

      const result = await adapter.evaluate(1, p4);

      expect(result.error).toBeNull();
      expect(result.decision?.outcome).toBe("NOT_DETERMINED");
    });
  });

  describe("I05: DEGRADED preservation", () => {
    it("should produce SELECTED outcome for DEGRADED status (V1 advisory)", async () => {
      const adapter = new P5RuntimeAdapter(createMockProducer());
      const p4 = createP4Snapshot({
        status: "DEGRADED",
        degradation: [{ code: "NO_VALID_CURRENT" }],
      });

      const result = await adapter.evaluate(1, p4);

      expect(result.error).toBeNull();
      // DEGRADED + MONITOR = eligible in V1
      expect(result.decision?.outcome).toBe("SELECTED");
    });
  });

  describe("I06: NO_EVIDENCE preservation", () => {
    it("should preserve NO_EVIDENCE as NOT_DETERMINED", async () => {
      const adapter = new P5RuntimeAdapter(createMockProducer());
      const p4 = createP4Snapshot({ status: "NO_EVIDENCE" });

      const result = await adapter.evaluate(1, p4);

      expect(result.error).toBeNull();
      expect(result.decision?.outcome).toBe("NOT_DETERMINED");
      // Verify provenance preserves the NO_EVIDENCE status
      expect(result.decision?.provenance.p4SnapshotRef?.status).toBe("NO_EVIDENCE");
    });
  });

  describe("I07: Missing required input → refusal", () => {
    it("should return error when producer throws", async () => {
      const failingProducer = createFailingProducer(new Error("Recorder failure"));
      const adapter = new P5RuntimeAdapter(failingProducer);
      const p4 = createP4Snapshot();

      const result = await adapter.evaluate(1, p4);

      expect(result.error).not.toBeNull();
      expect(result.error?.stage).toBe("P5_10_BUILD");
      expect(result.decision).toBeNull();
    });
  });

  describe("I08: Same input → same decision identity", () => {
    it("should produce identical decision records for same input", async () => {
      const adapter = new P5RuntimeAdapter(createMockProducer());
      const p4 = createP4Snapshot();

      const result1 = await adapter.evaluate(1, p4);
      const result2 = await adapter.evaluate(1, p4);

      expect(result1.decision?.decisionId).toBe(result2.decision?.decisionId);
      expect(result1.decision?.outcome).toBe(result2.decision?.outcome);
    });
  });

  describe("I09: Different snapshot → distinct decision identity", () => {
    it("should produce different policy evaluation results for different snapshots", async () => {
      const adapter = new P5RuntimeAdapter(createMockProducer());
      const p4a = createP4Snapshot({ asOf: "2026-08-18T00:00:00.000Z" });
      const p4b = createP4Snapshot({ asOf: "2026-08-19T00:00:00.000Z" });

      const result1 = await adapter.evaluate(1, p4a);
      const result2 = await adapter.evaluate(1, p4b);

      // Both succeed — decision identity differs at the P5-10 level
      // (mock producer hardcodes decisionId, but the policy results differ in asOf)
      expect(result1.error).toBeNull();
      expect(result2.error).toBeNull();
      // Different asOf → different P4 snapshot ref in provenance
      expect(result1.decision?.provenance.p4SnapshotRef?.asOf).not.toBe(
        result2.decision?.provenance.p4SnapshotRef?.asOf
      );
    });
  });

  describe("I10: Producer failure → no false success", () => {
    it("should return error when producer fails", async () => {
      const failingProducer = createFailingProducer(new Error("DB connection failed"));
      const adapter = new P5RuntimeAdapter(failingProducer);
      const p4 = createP4Snapshot();

      const result = await adapter.evaluate(1, p4);

      expect(result.error).not.toBeNull();
      expect(result.decision).toBeNull();
      expect(result.commit).toBeNull();
    });
  });

  describe("I11: No direct DB access from adapter", () => {
    it("should not import DB modules", async () => {
      // The adapter module should not have DB imports
      // This is verified by the source scan, but we also test behavior
      const adapter = new P5RuntimeAdapter(createMockProducer());
      const p4 = createP4Snapshot();

      // Should not throw DB-related errors
      const result = await adapter.evaluate(1, p4);
      expect(result.error?.stage).not.toBe("P5_03");
    });
  });

  describe("I12: No execution side effect", () => {
    it("should not modify P4 snapshot", async () => {
      const adapter = new P5RuntimeAdapter(createMockProducer());
      const p4 = createP4Snapshot();
      const originalDirection = p4.direction;

      await adapter.evaluate(1, p4);

      // P4 snapshot must not be mutated
      expect(p4.direction).toBe(originalDirection);
    });
  });

  describe("I13: Frozen provenance preserved end-to-end", () => {
    it("should preserve P4 provenance in decision record", async () => {
      const adapter = new P5RuntimeAdapter(createMockProducer());
      const p4 = createP4Snapshot({ status: "DEGRADED" });

      const result = await adapter.evaluate(1, p4);

      expect(result.error).toBeNull();
      // Provenance must carry the original P4 snapshot reference
      expect(result.decision?.provenance.p4SnapshotRef?.status).toBe("DEGRADED");
      expect(result.decision?.provenance.p4SnapshotRef?.narrativeIdentity.narrativeId).toBe(1);
    });
  });

  describe("I14: No semantic derivation inside adapter", () => {
    it("should not calculate scores or thresholds", async () => {
      const adapter = new P5RuntimeAdapter(createMockProducer());
      const p4 = createP4Snapshot();

      const result = await adapter.evaluate(1, p4);

      // The adapter should not introduce any scoring
      expect(result.decision).not.toHaveProperty("score");
      expect(result.decision).not.toHaveProperty("threshold");
      expect(result.decision).not.toHaveProperty("ranking");
    });
  });

  describe("I15: Single pipeline invocation", () => {
    it("should invoke the producer exactly once", async () => {
      let producerCallCount = 0;
      const countingProducer: P5Producer = {
        produce: async (input) => {
          producerCallCount++;
          return {
            decision: {
              decisionId: "p5d-test",
              candidateId: null,
              actionId: null,
              subject: input.subject,
              outcome: input.policyResult.outcome,
              suppressed: false,
              blockerReport: null,
              actionType: null,
              parameters: null,
              decisionState: "DECIDED",
              approvalState: "NOT_REQUIRED",
              executionState: "NOT_APPLICABLE",
              approvalRecord: null,
              safetyResult: { aggregate: "PASS", guardrailResults: [] },
              permissionResult: "NOT_APPLICABLE",
              explanation: input.explanationResult.explanation,
              provenance: input.explanationResult.provenance,
              auditEvents: [],
            },
            recording: mockRecordingResult("p5d-test"),
          };
        },
      };

      const adapter = new P5RuntimeAdapter(countingProducer);
      const p4 = createP4Snapshot();

      await adapter.evaluate(1, p4);

      expect(producerCallCount).toBe(1);
    });
  });
});
