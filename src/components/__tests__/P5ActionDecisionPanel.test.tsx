import React from "react";
import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { P5ActionDecisionPanel } from "@/components/P5ActionDecisionPanel";
import type {
  P5ActionDecisionReadViewModel,
  P5DecisionSummary,
} from "@/lib/p5/types";

// ---------------------------------------------------------------------------
// P5-06C UI tests — the panel renders the frozen read model values through
// the presentation model, keeps the 8 situations distinct, never implies
// execution from permission, and contains no buy/sell/execute surface.
// Technical details (decisionId, provenance JSON, audit events) are hidden
// under a collapsible "Technical details" section.
// ---------------------------------------------------------------------------

function makeSummary(overrides: Partial<P5DecisionSummary> = {}): P5DecisionSummary {
  return {
    decisionId: "dec-1",
    candidateId: "cand-1",
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
    permissionResult: "NOT_GRANTED",
    explanation: {
      what: "MONITOR selected",
      why: "policy rule R1 under policy v1",
      basedOn: "snapshot",
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
      p4SnapshotRef: null,
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
        p4VersionTuple: null,
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

function makeView(overrides: Partial<P5ActionDecisionReadViewModel> = {}): P5ActionDecisionReadViewModel {
  return {
    decisionPresence: "PRESENT",
    decision: makeSummary(),
    context: { source: "DECISION_RECORD", p4SnapshotRef: null },
    availability: "OK",
    displayState: "SELECTED",
    error: null,
    ...overrides,
  };
}

function renderPanel(view: P5ActionDecisionReadViewModel): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(["p5-action-decision", "1"], view);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <P5ActionDecisionPanel narrativeId="1" />
    </QueryClientProvider>
  );
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

describe("P5ActionDecisionPanel", () => {
  it("renders ABSENT / NO_DECISION_RECORD without 'No action' and without an action surface", () => {
    const html = renderPanel(
      makeView({
        decisionPresence: "ABSENT",
        decision: null,
        context: { source: "LIVE_P4_CONTEXT", p4SnapshotRef: null },
        availability: "NO_DECISION_RECORD",
        displayState: "ABSENT",
      })
    );
    expect(html).toContain("NO DECISION");
    // Advisory-only footer present
    expect(html).toContain("advisory-only");
    // The only button is the Technical details toggle — no buy/sell/action surface
    const buttons = html.match(/<button[^>]*>/gi) ?? [];
    expect(buttons.length).toBeLessThanOrEqual(1);
  });

  it("renders SAFETY_BLOCKED distinctly without implying execution from permission", () => {
    const html = renderPanel(
      makeView({
        displayState: "SAFETY_BLOCKED",
        decision: makeSummary({
          outcome: "SELECTED",
          safetyResult: {
            aggregate: "BLOCK",
            guardrailResults: [
              {
                guardrailId: "GR-1",
                version: "v1",
                outcome: "BLOCK",
                applicable: true,
                evaluatedAt: "2026-08-16T00:00:00.000Z",
                reason: "stale P4 context",
              },
            ],
          },
          permissionResult: "GRANTED",
          executionState: "NOT_APPLICABLE",
        }),
      })
    );
    expect(html).toContain("SAFETY BLOCKED");
    // Executive summary present
    expect(html).toContain("What should I do?");
    // Advisory footer
    expect(html).toContain("advisory-only");
    const buttons = html.match(/<button[^>]*>/gi) ?? [];
    expect(buttons.length).toBeLessThanOrEqual(1);
  });

  it("renders APPROVAL_DENIED distinctly and keeps ack ≠ approval", () => {
    const html = renderPanel(
      makeView({
        displayState: "APPROVAL_DENIED",
        decision: makeSummary({
          approvalState: "DENIED",
          approvalRecord: {
            approvalId: "ap-1",
            decisionIdRef: "dec-1",
            state: "DENIED",
            authorityRef: "AUTH-1",
            actor: "owner",
            timestamp: "2026-08-16T00:00:00.000Z",
            scope: "v1",
            approvalPolicyVersion: "ap/v1",
            invalidation: null,
          },
        }),
      })
    );
    expect(html).toContain("APPROVAL DENIED");
    const buttons = html.match(/<button[^>]*>/gi) ?? [];
    expect(buttons.length).toBeLessThanOrEqual(1);
  });

  it("renders a recorded NO_ACTION only when NO_ACTION is the recorded outcome", () => {
    const html = renderPanel(
      makeView({
        displayState: "NO_ACTION",
        decision: makeSummary({
          outcome: "NO_ACTION",
          actionType: null,
          candidateId: null,
        }),
      })
    );
    expect(html).toContain("NO ACTION");
    // Presentation model renders user-facing guidance
    expect(html).toContain("No action is needed");
  });

  it("preserves UNAVAILABLE / P4_CONTEXT_UNAVAILABLE without a confident narrative", () => {
    const html = renderPanel(
      makeView({
        decisionPresence: "ABSENT",
        decision: null,
        context: null,
        availability: "P4_CONTEXT_UNAVAILABLE",
        displayState: "UNAVAILABLE",
      })
    );
    expect(html).toContain("UNAVAILABLE");
    expect(html).toContain("No decision has been made");
  });

  it("executive summary visible for SELECTED state", () => {
    const html = renderWithInitialData(makeView());
    // Executive summary section
    expect(html).toContain("What should I do?");
    // MONITOR posture displayed
    expect(html).toContain("MONITOR");
    // Advisory badge
    expect(html).toContain("Advisory");
    // Read-only badge
    expect(html).toContain("Read-only");
  });

  it("technical details are hidden by default", () => {
    const html = renderWithInitialData(makeView());
    // Decision ID is in collapsed section (not visible as primary content)
    expect(html).toContain("Technical details");
    // "Hide technical details" not present (collapsed)
    expect(html).not.toContain("Hide technical details");
  });

  it("NOT_DETERMINED shows system uncertainty guidance", () => {
    const html = renderWithInitialData(
      makeView({
        decisionPresence: "PRESENT",
        decision: {
          ...makeView().decision!,
          outcome: "NOT_DETERMINED",
          candidateId: null,
          actionType: null,
        },
        displayState: "NOT_DETERMINED",
      })
    );
    expect(html).toContain("UNDETERMINED");
    // Presentation model renders uncertainty guidance
    expect(html).not.toContain("No decision has been made");
    // Check for executive summary
    expect(html).toContain("What should I do?");
  });
});
