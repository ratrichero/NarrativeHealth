import React from "react";
import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { P4DecisionSupportPanel } from "@/components/P4DecisionSupportPanel";
import type { P4DecisionSupportViewModel } from "@/lib/p4/types";

// ---------------------------------------------------------------------------
// P4-05C UI tests — UI-01..UI-14. Follows the repository convention of
// renderToStaticMarkup + string assertions (node test environment).
// ---------------------------------------------------------------------------

/** Full POSITIVE ViewModel fixture (frozen P4-02 §8 shape). */
function makeViewModel(
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
    generatedAt: "2026-08-16T00:00:00.000Z",
    asOf: "2026-08-11T00:00:00.000Z",
    direction: "POSITIVE",
    signals: [
      {
        id: "NARRATIVE_IMPROVEMENT",
        label: "Narrative improvement",
        directionRelation: "POSITIVE",
        evidenceRefs: [],
      },
    ],
    opportunity: "HIGH",
    risk: "LOW",
    confidence: "HIGH",
    actionability: "HIGH",
    explanation: {
      items: [
        {
          id: "exp:summary:1",
          statement: "Narrative is improving: overall trend is improving with improving regime.",
          role: "primary",
          supportingEvidence: [],
          conflictingEvidence: [],
          contextualEvidence: [],
          sourceReferences: ["102"],
          semanticVersion: "1",
          algorithmVersion: "p4-decision-support",
          explanationVersion: "1",
          generatedAt: "2026-08-16T00:00:00.000Z",
        },
      ],
      attribution: {
        algorithmVersion: "p4-decision-support",
        semanticVersion: "1",
        interpretationRuleVersion: "p4-03/v1",
        explanationVersion: "1",
      },
      generatedAt: "2026-08-16T00:00:00.000Z",
    },
    evidence: [
      {
        sourceLayer: "P3",
        sourceType: "p3_history",
        sourceId: "102",
        artifactIdentity: "1|p3-orchestrator|1|observed|7D",
        narrativeIdentity: "1",
        windowOrDate: "2026-08-11T00:00:00.000Z",
        field: "trend.overall",
        status: "VALID",
        interpretationRole: "primary",
      },
      {
        sourceLayer: "P3",
        sourceType: "p3_history_step",
        sourceId: "2026-08-11T00:00:00.000Z",
        artifactIdentity: "1|p3-orchestrator|1|observed|7D",
        narrativeIdentity: "1",
        windowOrDate: "2026-08-11T00:00:00.000Z",
        field: "breadthMove",
        status: "VALID",
        interpretationRole: "conflicting",
      },
      {
        sourceLayer: "P2",
        sourceType: "P2_EVENT_RISK",
        sourceId: "7",
        artifactIdentity: null,
        narrativeIdentity: "1",
        windowOrDate: "2026-08-10",
        field: "p2.event",
        status: "VALID",
        interpretationRole: "contextual",
      },
    ],
    historicalContext: {
      seriesLength: 3,
      steps: 2,
      overallTrend: "IMPROVING",
      dataSufficiency: { comparableArtifacts: 3, requiredMinimum: 2, sufficient: true },
      current: { artifactId: 102, windowEnd: "2026-08-11T00:00:00.000Z", availabilityState: "VALID" },
      previous: { artifactId: 101, windowEnd: "2026-08-10T00:00:00.000Z", availabilityState: "VALID" },
    },
    provenance: {
      sourceLayer: "P4",
      derivedFrom: ["100", "101", "102"],
      p2EventRisk: true,
      semanticVersion: "1",
    },
    degradation: [],
    ...overrides,
  };
}

/** Words that must never appear in the UI (UI-13 — no recommendation language). */
const FORBIDDEN_WORDS = [
  "buy",
  "sell",
  "strong buy",
  "allocation",
  "allocate",
  "recommend",
  "score",
  "percent",
  "%",
];

function render(viewModel: P4DecisionSupportViewModel | null, defaultExpanded = false): string {
  return renderToStaticMarkup(
    <P4DecisionSupportPanel viewModel={viewModel} defaultExpanded={defaultExpanded} />
  );
}

describe("P4DecisionSupportPanel — UI-01..UI-05 direction rendering", () => {
  it("UI-01 — complete POSITIVE ViewModel renders", () => {
    const html = render(makeViewModel());
    expect(html).toContain("P4 Decision Support");
    expect(html).toContain("Available");
    expect(html).toContain("POSITIVE");
    expect(html).toContain("Narrative improvement");
  });

  it("UI-02 — NEGATIVE ViewModel renders", () => {
    const html = render(
      makeViewModel({
        direction: "NEGATIVE",
        opportunity: "LOW",
        risk: "HIGH",
        confidence: "MEDIUM",
        actionability: "HIGH",
      })
    );
    expect(html).toContain("NEGATIVE");
    expect(html).toContain("LOW");
    expect(html).toContain("HIGH");
    expect(html).toContain("MEDIUM");
  });

  it("UI-03 — MIXED ViewModel renders", () => {
    const html = render(
      makeViewModel({
        direction: "MIXED",
        signals: [
          {
            id: "EVIDENCE_CONFLICT",
            label: "Evidence conflict",
            directionRelation: "MIXED",
            severity: "medium",
            evidenceRefs: [],
          },
        ],
      })
    );
    expect(html).toContain("MIXED");
    expect(html).toContain("Evidence conflict");
    expect(html).toContain("medium severity");
  });

  it("UI-04 — NEUTRAL ViewModel renders", () => {
    const html = render(
      makeViewModel({
        direction: "NEUTRAL",
        opportunity: "LOW",
        risk: "LOW",
        confidence: "HIGH",
        actionability: "LOW",
        signals: [],
      })
    );
    expect(html).toContain("NEUTRAL");
    expect(html).toContain("No signals fired for this window.");
  });

  it("UI-05 — UNKNOWN direction renders the reason and hides conclusions", () => {
    const html = render(
      makeViewModel({
        direction: "UNKNOWN",
        opportunity: "UNKNOWN",
        risk: "UNKNOWN",
        confidence: "LOW",
        actionability: "UNKNOWN",
        signals: [],
        degradation: [{ code: "INSUFFICIENT_HISTORY" }],
        status: "DEGRADED",
      })
    );
    expect(html).toContain("UNKNOWN");
    expect(html).toContain("Evidence insufficient");
    expect(html).toContain("Insufficient history for a comparison");
    // Direction UNKNOWN hides Opportunity/Risk conclusions (P4-02 §11).
    expect(html).not.toContain("Opportunity");
    expect(html).not.toContain("Risk");
    expect(html).not.toContain("Confidence");
  });
});

describe("P4DecisionSupportPanel — UI-06..UI-10 values, signals, explanation, evidence", () => {
  it("UI-06 — Opportunity/Risk/Confidence/Actionability qualitative values render", () => {
    const html = render(
      makeViewModel({
        opportunity: "MEDIUM",
        risk: "LOW",
        confidence: "MEDIUM",
        actionability: "MEDIUM",
      })
    );
    expect(html).toContain("Opportunity");
    expect(html).toContain("Risk");
    expect(html).toContain("Confidence");
    expect(html).toContain("Actionability");
    expect(html).toContain("MEDIUM");
    expect(html).toContain("LOW");
  });

  it("UI-07 — signals render from API data with direction/severity", () => {
    const html = render(
      makeViewModel({
        signals: [
          {
            id: "ROTATION_CHANGE",
            label: "Rotation change",
            directionRelation: "POSITIVE",
            evidenceRefs: [],
          },
        ],
      })
    );
    expect(html).toContain("Rotation change");
    expect(html).toContain("Direction POSITIVE");
  });

  it("UI-08 — explanation items render from the P4-04 output", () => {
    const html = render(makeViewModel(), true);
    expect(html).toContain(
      "Narrative is improving: overall trend is improving with improving regime."
    );
    expect(html).toContain("Primary");
  });

  it("UI-09 — evidence roles/provenance render (role + status + identity)", () => {
    const html = render(makeViewModel(), true);
    expect(html).toContain("p3_history");
    expect(html).toContain("p3_history_step");
    expect(html).toContain("trend.overall");
    expect(html).toContain("breadthMove");
    expect(html).toContain("VALID");
    expect(html).toContain("Conflicting");
    expect(html).toContain("artifact identity");
    expect(html).toContain("1|p3-orchestrator|1|observed|7D");
  });

  it("UI-10 — P2 event risk scope/provenance remains visible", () => {
    const html = render(makeViewModel(), true);
    expect(html).toContain("P2_EVENT_RISK");
    expect(html).toContain("P2 event risk");
    expect(html).toContain("Contextual");
  });
});

describe("P4DecisionSupportPanel — UI-11/13/14 resilience, language, a11y", () => {
  it("UI-11 — null ViewModel renders a safe unavailable state without fake values", () => {
    const html = render(null);
    expect(html).toContain("P4 Decision Support");
    expect(html).toContain("not available");
    expect(html).not.toContain("POSITIVE");
    expect(html).not.toContain("HIGH");
    expect(html).not.toContain("Signals");
  });

  it("UI-13 — no buy/sell/allocation language is generated", () => {
    const html = render(makeViewModel(), true).toLowerCase();
    for (const word of FORBIDDEN_WORDS) {
      expect(html).not.toContain(word);
    }
  });

  it("UI-14 — accessible structure: headings, aria-expanded toggles, non-color status", () => {
    const html = render(makeViewModel());
    expect(html).toContain("Decision Summary");
    expect(html).toContain("Signals");
    expect(html).toContain("Opportunity / Risk");
    expect(html).toContain('aria-expanded="false"');
    // Direction/status are conveyed by the value text itself, not color alone.
    expect(html).toContain(">POSITIVE<");
    expect(html).toContain(">HIGH<");
  });

  it("UI-14b — degraded banner renders for DEGRADED status with determinable direction", () => {
    const html = render(
      makeViewModel({
        status: "DEGRADED",
        confidence: "MEDIUM",
        degradation: [{ code: "STALE" }],
      })
    );
    expect(html).toContain("Partial evidence");
    expect(html).toContain("Evidence is stale");
    expect(html).toContain("POSITIVE");
  });
});
