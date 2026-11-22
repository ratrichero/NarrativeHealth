// P5-06C-ENH — O4 (confidence pass-through), O5 (direction surfacing),
// O6 (MONITOR guidance differentiation).

import { buildPresentationModel } from "../presentation-model";
import type {
  P5ActionDecisionReadViewModel,
  P5DecisionSummary,
  P5P4SnapshotRef,
} from "../../types";

function snapshotRef(overrides: Partial<P5P4SnapshotRef> = {}): P5P4SnapshotRef {
  return {
    narrativeIdentity: {
      narrativeId: 1,
      window: "7D",
      algorithmKey: "k",
      algorithmVersion: "1.0.0",
      calculationMode: "LIVE",
    },
    asOf: "2026-11-21T00:00:00.000Z",
    versionTuple: {
      algorithmVersion: "1.0.0",
      semanticVersion: "1.0.0",
      signalCatalogVersion: "1.0.0",
      interpretationRuleVersion: "p4-03/v1",
    },
    status: "OK",
    contentHash: null,
    ...overrides,
  };
}

function decision(overrides: Partial<P5DecisionSummary> = {}): P5DecisionSummary {
  return {
    decisionId: "decision-1",
    candidateId: "candidate-1",
    actionId: null,
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
    permissionResult: "NOT_APPLICABLE",
    explanation: {
      what: "Monitor the narrative.",
      why: null,
      basedOn: null,
      policy: null,
      safety: null,
      approval: null,
      currentState: null,
      whatDidNotHappen: [],
    },
    provenance: {
      decisionId: "decision-1",
      candidateId: "candidate-1",
      actionId: null,
      p4SnapshotRef: snapshotRef(),
      policy: {
        policyId: null,
        policyVersion: null,
        effectiveAt: null,
        evaluationAt: null,
        ruleRefs: [],
      },
      safety: { guardrailVersion: null },
      approval: { approvalPolicyVersion: null, authorityRef: null },
      automationMode: "ADVISORY",
      versions: { actionModelVersion: "1.0.0", p4VersionTuple: null },
      timestamps: { decisionAt: null, evaluatedAt: null, recordedAt: null },
    },
    auditEvents: [],
    ...overrides,
  };
}

function view(
  overrides: Partial<P5ActionDecisionReadViewModel> = {}
): P5ActionDecisionReadViewModel {
  return {
    decisionPresence: "PRESENT",
    decision: decision(),
    context: { source: "LIVE_P4_CONTEXT", p4SnapshotRef: snapshotRef() },
    availability: "OK",
    displayState: "SELECTED",
    error: null,
    ...overrides,
  };
}

describe("P5 presentation model — O4 confidence pass-through", () => {
  test("dùng đúng confidence của P4 khi snapshot mang theo", () => {
    const model = buildPresentationModel(
      view({
        context: {
          source: "LIVE_P4_CONTEXT",
          p4SnapshotRef: snapshotRef({ confidence: "MEDIUM", direction: "POSITIVE" }),
        },
      })
    );

    expect(model.confidence.level).toBe("MEDIUM");
    expect(model.confidence.source).toBe("P4");
    expect(model.confidence.meaning).toContain("P4 rated the evidence as medium confidence");
  });

  test("fallback suy diễn khi record freeze không có confidence", () => {
    const model = buildPresentationModel(
      view({
        context: { source: "DECISION_RECORD", p4SnapshotRef: snapshotRef() },
      })
    );

    expect(model.confidence.source).toBe("DERIVED");
    expect(model.confidence.level).toBe("HIGH"); // SELECTED + status OK
  });

  test("không có decision thì không có confidence", () => {
    const model = buildPresentationModel(
      view({
        decisionPresence: "ABSENT",
        decision: null,
        context: null,
        availability: "NO_DECISION_RECORD",
        displayState: "ABSENT",
      })
    );

    expect(model.confidence.source).toBe("NONE");
    expect(model.confidence.level).toBeNull();
    expect(model.confidence.direction).toBeNull();
  });
});

describe("P5 presentation model — O5 direction surfacing", () => {
  test("direction của P4 có trong confidence và trong WHY", () => {
    const model = buildPresentationModel(
      view({
        context: {
          source: "LIVE_P4_CONTEXT",
          p4SnapshotRef: snapshotRef({ direction: "NEGATIVE", confidence: "HIGH" }),
        },
      })
    );

    expect(model.confidence.direction).toBe("NEGATIVE");
    expect(model.confidence.meaning).toContain("P4 direction: negative");
    expect(model.why?.facts).toEqual(
      expect.arrayContaining([{ label: "Direction", value: "negative" }])
    );
  });

  test("không có direction thì không bịa fact", () => {
    const model = buildPresentationModel(view());
    expect(model.confidence.direction).toBeNull();
    expect(model.why?.facts.some((fact) => fact.label === "Direction")).toBe(false);
  });
});

describe("P5 presentation model — O6 MONITOR guidance", () => {
  test("guidance MONITOR khác nhau theo direction", () => {
    const text = (direction: "POSITIVE" | "NEGATIVE" | "MIXED" | "NEUTRAL") =>
      buildPresentationModel(
        view({
          context: {
            source: "LIVE_P4_CONTEXT",
            p4SnapshotRef: snapshotRef({ direction }),
          },
        })
      ).executive.guidance;

    const positive = text("POSITIVE");
    const negative = text("NEGATIVE");
    const mixed = text("MIXED");
    const neutral = text("NEUTRAL");

    expect(new Set([positive, negative, mixed, neutral]).size).toBe(4);
    expect(positive).toContain("positive lean");
    expect(negative).toContain("negative lean");
    expect(mixed).toContain("evidence is split");
  });

  test("không có direction giữ guidance MONITOR chung", () => {
    const model = buildPresentationModel(view());
    expect(model.executive.guidance).toContain("Continue monitoring this narrative");
  });

  test("action type khác MONITOR không bị đổi guidance", () => {
    const model = buildPresentationModel(
      view({
        decision: decision({ actionType: "REVIEW" }),
        context: {
          source: "LIVE_P4_CONTEXT",
          p4SnapshotRef: snapshotRef({ direction: "POSITIVE" }),
        },
      })
    );
    expect(model.executive.guidance).toContain("Review the available evidence");
  });
});
