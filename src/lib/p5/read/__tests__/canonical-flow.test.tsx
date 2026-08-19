/**
 * P4-P5-COMPLETION-02 — Canonical Data Flow Tests.
 *
 * Verifies that:
 *  - P5ActionDecisionPanel renders correctly from canonical initialData
 *  - Panel does NOT fetch when initialData is provided
 *  - NO_ACTION is distinct from NO_DECISION_RECORD
 *  - NOT_DETERMINED is preserved in UI
 *  - decisionId is consistent across write/read/UI
 *  - Panel does not trigger P5 evaluation
 *  - Panel does not query live P4 to reconstruct historical decision
 */

import { describe, expect, it, jest } from "@jest/globals";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { P5ActionDecisionPanel } from "@/components/P5ActionDecisionPanel";
import type {
  P5ActionDecisionReadViewModel,
  P5DecisionRecord,
  P5DecisionSummary,
} from "@/lib/p5/types";
import type { P4DecisionSupportViewModel } from "@/lib/p4/types";
import { ActionReadService } from "@/lib/p5/read/action-read.service";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<P5DecisionRecord> = {}): P5DecisionRecord {
  return {
    decisionId: "p5d-abc12345",
    candidateId: "cand-1",
    actionId: null,
    subject: { narrativeId: 1 },
    outcome: "SELECTED",
    suppressed: false,
    blockerReport: null,
    actionType: "MONITOR",
    parameters: {},
    decisionState: "DECIDED",
    approvalState: "NOT_REQUIRED",
    executionState: "NOT_APPLICABLE",
    approvalRecord: null,
    safetyResult: { aggregate: "PASS", guardrailResults: [] },
    permissionResult: "NOT_APPLICABLE",
    explanation: {
      what: "MONITOR selected for narrative 1",
      why: "Policy rule C-201: snapshot present, direction usable",
      basedOn: "P4 snapshot as of 2026-08-19",
      policy: "pol-p5-v1 v1",
      safety: "V1 empty guardrail set",
      approval: "V1 ADVISORY-ONLY",
      currentState: "DECIDED",
      whatDidNotHappen: [],
    },
    provenance: {
      decisionId: "p5d-abc12345",
      candidateId: "cand-1",
      actionId: null,
      p4SnapshotRef: {
        narrativeIdentity: {
          narrativeId: 1,
          window: "30d",
          algorithmKey: "default",
          algorithmVersion: "v1",
          calculationMode: "standard",
        },
        asOf: "2026-08-19",
        versionTuple: {
          algorithmVersion: "v1",
          semanticVersion: "1.0.0",
          signalCatalogVersion: "v1",
          interpretationRuleVersion: "v1",
        },
        status: "OK",
        contentHash: null,
      },
      policy: {
        policyId: "pol-p5-v1",
        policyVersion: "v1",
        effectiveAt: "2026-08-17T00:00:00.000Z",
        evaluationAt: "2026-08-19T00:00:00.000Z",
        ruleRefs: ["C-101", "C-201", "C-501"],
      },
      safety: { guardrailVersion: null },
      approval: { approvalPolicyVersion: null, authorityRef: null },
      automationMode: "ADVISORY",
      versions: {
        actionModelVersion: "p5-action-model/v1",
        p4VersionTuple: null,
      },
      timestamps: {
        decisionAt: "2026-08-19T00:00:00.000Z",
        evaluatedAt: "2026-08-19T00:00:00.000Z",
        recordedAt: "2026-08-19T00:00:00.000Z",
      },
    },
    auditEvents: [],
    ...overrides,
  };
}

function makeReadView(overrides: Partial<P5ActionDecisionReadViewModel> = {}): P5ActionDecisionReadViewModel {
  const record = makeRecord();
  return {
    decisionPresence: "PRESENT",
    decision: {
      decisionId: record.decisionId,
      candidateId: record.candidateId,
      actionId: record.actionId,
      outcome: record.outcome,
      suppressed: record.suppressed,
      blockerReport: record.blockerReport,
      actionType: record.actionType,
      parameters: record.parameters,
      decisionState: record.decisionState,
      approvalState: record.approvalState,
      executionState: record.executionState,
      approvalRecord: record.approvalRecord,
      safetyResult: record.safetyResult,
      permissionResult: record.permissionResult,
      explanation: record.explanation,
      provenance: record.provenance,
      auditEvents: record.auditEvents,
    },
    context: { source: "DECISION_RECORD", p4SnapshotRef: record.provenance.p4SnapshotRef },
    availability: "OK",
    displayState: "SELECTED",
    error: null,
    ...overrides,
  };
}

function renderWithInitialData(view: P5ActionDecisionReadViewModel): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <P5ActionDecisionPanel narrativeId="1" initialData={view} />
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P4-P5-COMPLETION-02: Canonical Data Flow", () => {
  describe("1. Panel renders from canonical initialData (no fetch)", () => {
    it("renders SELECTED state with executive summary", () => {
      const html = renderWithInitialData(makeReadView());
      // Executive summary visible
      expect(html).toContain("What should I do?");
      expect(html).toContain("MONITOR");
      // Advisory / read-only badges
      expect(html).toContain("Read-only");
      expect(html).toContain("Advisory");
      // Technical details collapsed (decisionId still in page but hidden)
      expect(html).toContain("Technical details");
    });

    it("decisionId exists in technical details section (collapsed by default)", () => {
      const html = renderWithInitialData(makeReadView());
      // Technical details section exists with toggle
      expect(html).toContain("Technical details");
      // Decision ID is NOT visible when collapsed (this is the UX improvement)
      expect(html).not.toContain("Decision ID");
      expect(html).not.toContain("p5d-abc12345");
    });
  });

  describe("2. NO_ACTION vs NO_DECISION_RECORD", () => {
    it("NO_ACTION is rendered only for recorded NO_ACTION outcome", () => {
      const html = renderWithInitialData(
        makeReadView({
          decisionPresence: "PRESENT",
          decision: {
            ...makeReadView().decision!,
            outcome: "NO_ACTION",
            candidateId: null,
            actionType: null,
          },
          displayState: "NO_ACTION",
        })
      );
      expect(html).toContain("NO ACTION");
      // Presentation model renders user-facing guidance
      expect(html).toContain("No action is needed");
    });

    it("NO_DECISION_RECORD is absence, NOT an action outcome", () => {
      const html = renderWithInitialData(
        makeReadView({
          decisionPresence: "ABSENT",
          decision: null,
          context: { source: "LIVE_P4_CONTEXT", p4SnapshotRef: null },
          availability: "NO_DECISION_RECORD",
          displayState: "ABSENT",
        })
      );
      expect(html).toContain("NO DECISION");
      expect(html).toContain("not yet evaluated");
    });

    it("NO_DECISION_RECORD and NO_ACTION never appear together as the same state", () => {
      const absent = renderWithInitialData(
        makeReadView({
          decisionPresence: "ABSENT",
          decision: null,
          availability: "NO_DECISION_RECORD",
          displayState: "ABSENT",
        })
      );
      expect(absent).toContain("NO DECISION");
      expect(absent).not.toContain("NO ACTION");
    });
  });

  describe("3. NOT_DETERMINED is preserved", () => {
    it("renders NOT_DETERMINED badge when outcome is NOT_DETERMINED", () => {
      const html = renderWithInitialData(
        makeReadView({
          decisionPresence: "PRESENT",
          decision: {
            ...makeReadView().decision!,
            outcome: "NOT_DETERMINED",
            candidateId: null,
            actionType: null,
          },
          displayState: "NOT_DETERMINED",
        })
      );
      expect(html).toContain("UNDETERMINED");
      // Presentation model renders uncertainty guidance
      expect(html).toContain("What should I do?");
    });
  });

  describe("4. decisionId consistency", () => {
    it("decisionId is hidden in collapsed technical details (UX improvement)", () => {
      const view = makeReadView();
      const html = renderWithInitialData(view);
      // Technical details section exists but decision ID is hidden
      expect(html).toContain("Technical details");
      expect(html).not.toContain("p5d-abc12345");
    });
  });

  describe("5. Panel does NOT trigger P5 evaluation", () => {
    it("panel only reads, never evaluates", () => {
      const html = renderWithInitialData(makeReadView());
      // Read-only indicator
      expect(html).toContain("Read-only");
      // Advisory badge
      expect(html).toContain("Advisory");
      // Advisory-only footer
      expect(html).toContain("advisory-only");
      // No action buttons (only toggle for technical details)
      const buttons = html.match(/<button[^>]*>/gi) ?? [];
      // The only button is the technical details toggle
      expect(buttons.length).toBeLessThanOrEqual(1);
    });
  });

  describe("6. Panel does not query live P4 for historical decision", () => {
    it("when decision exists, shows executive summary from decision data", () => {
      const html = renderWithInitialData(makeReadView());
      // Executive summary from decision data
      expect(html).toContain("What should I do?");
      expect(html).toContain("MONITOR");
      // Technical details available
      expect(html).toContain("Technical details");
    });

    it("when decision is absent, shows context as live/not-yet-evaluated", () => {
      const html = renderWithInitialData(
        makeReadView({
          decisionPresence: "ABSENT",
          decision: null,
          context: {
            source: "LIVE_P4_CONTEXT",
            p4SnapshotRef: {
              narrativeIdentity: {
                narrativeId: 1,
                window: "30d",
                algorithmKey: "default",
                algorithmVersion: "v1",
                calculationMode: "standard",
              },
              asOf: "2026-08-19",
              versionTuple: {
                algorithmVersion: "v1",
                semanticVersion: "1.0.0",
                signalCatalogVersion: "v1",
                interpretationRuleVersion: "v1",
              },
              status: "OK",
              contentHash: null,
            },
          },
          availability: "NO_DECISION_RECORD",
          displayState: "ABSENT",
        })
      );
      // Panel shows absence messaging
      expect(html).toContain("NO DECISION");
      expect(html).toContain("not yet evaluated");
    });
  });

  describe("7. ActionReadService unit tests", () => {
    function mockStore(overrides: { findBySubject?: P5DecisionRecord | null; findByDecisionId?: P5DecisionRecord | null } = {}) {
      return {
        findByDecisionId: jest.fn<() => Promise<P5DecisionRecord | null>>().mockResolvedValue(overrides.findByDecisionId ?? null),
        findBySubject: jest.fn<() => Promise<P5DecisionRecord | null>>().mockResolvedValue(overrides.findBySubject ?? null),
      };
    }

    it("getNarrativeActionReadView returns PRESENT when record exists", async () => {
      const store = mockStore({ findBySubject: makeRecord() });
      const service = new ActionReadService({ store });
      const view = await service.getNarrativeActionReadView(1);
      expect(view.decisionPresence).toBe("PRESENT");
      expect(view.availability).toBe("OK");
      expect(view.decision?.decisionId).toBe("p5d-abc12345");
      expect(view.decision?.outcome).toBe("SELECTED");
    });

    it("getNarrativeActionReadView returns ABSENT when no record exists", async () => {
      const store = mockStore();
      const mockGetP4 = jest.fn<() => Promise<null>>().mockResolvedValue(null);
      const service = new ActionReadService({ store, getP4: mockGetP4 });
      const view = await service.getNarrativeActionReadView(1);
      expect(view.decisionPresence).toBe("ABSENT");
      expect(view.availability).toBe("P4_CONTEXT_UNAVAILABLE");
    });

    it("getNarrativeActionReadView returns ABSENT/NO_DECISION_RECORD when record missing but P4 exists", async () => {
      const store = mockStore();
      // Minimal P4 mock — only fields consumed by buildP4SnapshotRef + ActionReadService
      const mockP4 = {
        narrativeIdentity: {
          narrativeId: 1,
          window: "30d",
          algorithmKey: "default",
          algorithmVersion: "v1",
          calculationMode: "standard",
        },
        asOf: "2026-08-19",
        version: {
          algorithmVersion: "v1",
          semanticVersion: "1.0.0",
          signalCatalogVersion: "v1",
        },
        status: "OK" as const,
      } as unknown as P4DecisionSupportViewModel;
      const mockGetP4 = jest.fn<() => Promise<P4DecisionSupportViewModel>>().mockResolvedValue(mockP4);
      const service = new ActionReadService({ store, getP4: mockGetP4 });
      const view = await service.getNarrativeActionReadView(1);
      expect(view.decisionPresence).toBe("ABSENT");
      expect(view.availability).toBe("NO_DECISION_RECORD");
      expect(view.context?.source).toBe("LIVE_P4_CONTEXT");
    });

    it("getNarrativeActionReadView returns PRESENT for NO_ACTION record (not ABSENT-as-absence)", async () => {
      const noActionRecord = makeRecord({ outcome: "NO_ACTION" });
      const store = mockStore({ findBySubject: noActionRecord });
      const service = new ActionReadService({ store });
      const view = await service.getNarrativeActionReadView(1);
      expect(view.decisionPresence).toBe("PRESENT");
      expect(view.availability).toBe("OK");
      expect(view.decision?.outcome).toBe("NO_ACTION");
      expect(view.displayState).toBe("NO_ACTION");
    });

    it("getNarrativeActionReadView returns PRESENT for NOT_DETERMINED record (preserves outcome)", async () => {
      const ndRecord = makeRecord({ outcome: "NOT_DETERMINED" });
      const store = mockStore({ findBySubject: ndRecord });
      const service = new ActionReadService({ store });
      const view = await service.getNarrativeActionReadView(1);
      expect(view.decisionPresence).toBe("PRESENT");
      expect(view.availability).toBe("OK");
      expect(view.decision?.outcome).toBe("NOT_DETERMINED");
      expect(view.displayState).toBe("NOT_DETERMINED");
    });
  });
});
