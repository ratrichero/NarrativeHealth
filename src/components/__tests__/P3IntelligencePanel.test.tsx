import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { toP3IntelligenceViewModel, type P3IntelligenceReadSource } from "@/lib/services/p3-intelligence.service";
import { buildP3IntelligenceHistory } from "@/lib/services/p3-intelligence-history.service";
import { P3IntelligencePanel } from "@/components/P3IntelligencePanel";
import { P3HistoricalTrend } from "@/components/P3HistoricalTrend";

// next/link renders outside the Next runtime in tests — swap for a plain anchor.
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function validArtifactSource(
  overrides: Partial<P3IntelligenceReadSource["artifact"]> = {}
): P3IntelligenceReadSource {
  return {
    artifact: {
      id: 1,
      narrativeId: 1,
      windowEnd: new Date("2026-08-11T00:00:00.000Z"),
      periodStart: new Date("2026-08-04T00:00:00.000Z"),
      periodEnd: new Date("2026-08-11T00:00:00.000Z"),
      algorithmKey: "p3-orchestrator",
      algorithmVersion: "1",
      calculationMode: "observed",
      availabilityState: "VALID",
      breadth: "0.14",
      momentum1d: null,
      momentum3d: null,
      momentum7d: "14.03",
      momentum14d: null,
      relativeStrength1d: null,
      relativeStrength3d: null,
      relativeStrength7d: "-0.011",
      relativeStrength14d: null,
      leaderCoinId: 22,
      leaderScore: "89.29",
      regime: "NEUTRAL",
      rotation: "ACCELERATING",
      rotationScore: "68.5",
      provenance: { kernel: "p3-core", context: { window: "7D" } },
      ...overrides,
    },
    leaderSymbol: "BLUAI",
    memberCount: 7,
  };
}

describe("P3IntelligencePanel rendering", () => {
  it("renders a VALID artifact: NEUTRAL regime, ACCELERATING rotation, window, metrics and leadership", () => {
    const vm = toP3IntelligenceViewModel(validArtifactSource());
    const html = renderToStaticMarkup(
      <P3IntelligencePanel narrativeName="AI" viewModel={vm} />
    );

    expect(html).toContain("P3 Intelligence");
    expect(html).toContain("AI · 7D · 11 Aug 2026");
    expect(html).toContain("NEUTRAL");
    expect(html).toContain("ACCELERATING");
    expect(html).toContain("Valid");
    expect(html).toContain("0.140");
    expect(html).toContain("+14.03");
    expect(html).toContain("-0.011");
    expect(html).toContain("BLUAI");
    expect(html).toContain("89.29");
    // No unavailable-state label may appear for a fully VALID artifact.
    expect(html).not.toContain("N/A");
    expect(html).not.toContain("Missing");
  });

  it("regression: NEUTRAL must never render as N/A or Missing", () => {
    const vm = toP3IntelligenceViewModel(validArtifactSource());
    const html = renderToStaticMarkup(
      <P3IntelligencePanel narrativeName="AI" viewModel={vm} />
    );

    expect(html).toContain("NEUTRAL");
    expect(html).not.toContain("N/A");
    expect(html).not.toContain(">—<");
  });

  it("regression: NOT_APPLICABLE renders as N/A and never as NEUTRAL", () => {
    const vm = toP3IntelligenceViewModel(
      validArtifactSource({
        availabilityState: "NOT_APPLICABLE",
        regime: null,
        rotation: null,
        rotationScore: null,
        breadth: null,
        momentum7d: null,
        relativeStrength7d: null,
        leaderCoinId: null,
        leaderScore: null,
      })
    );
    const html = renderToStaticMarkup(
      <P3IntelligencePanel narrativeName="AI" viewModel={vm} />
    );

    expect(html).toContain("N/A");
    expect(html).not.toContain("NEUTRAL");
  });

  it("regression: ACCELERATING renders as a real rotation, distinct from a missing rotation", () => {
    const validHtml = renderToStaticMarkup(
      <P3IntelligencePanel narrativeName="AI" viewModel={toP3IntelligenceViewModel(validArtifactSource())} />
    );
    expect(validHtml).toContain("ACCELERATING");
    expect(validHtml).not.toContain(">—<");

    const missingVm = toP3IntelligenceViewModel(
      validArtifactSource({ rotation: null, rotationScore: null, availabilityState: "VALID" })
    );
    const missingHtml = renderToStaticMarkup(
      <P3IntelligencePanel narrativeName="AI" viewModel={missingVm} />
    );
    expect(missingHtml).not.toContain("ACCELERATING");
    expect(missingHtml).toContain("Missing");
    expect(missingHtml).toContain("—");
  });

  it("handles incomplete stages gracefully (momentum/leadership missing)", () => {
    const vm = toP3IntelligenceViewModel(
      validArtifactSource({ momentum7d: null, leaderCoinId: null, leaderScore: null })
    );
    const html = renderToStaticMarkup(
      <P3IntelligencePanel narrativeName="AI" viewModel={vm} />
    );

    expect(html).toContain("Missing");
    expect(html).toContain("—");
    // The remaining VALID stages still render.
    expect(html).toContain("NEUTRAL");
    expect(html).toContain("0.140");
  });

  it("shows a visible placeholder when no P3 artifact exists", () => {
    const html = renderToStaticMarkup(
      <P3IntelligencePanel narrativeName="AI" viewModel={null} />
    );

    expect(html).toContain("P3 Intelligence");
    expect(html).toContain("No P3 intelligence available for this narrative yet.");
  });

  // -----------------------------------------------------------------------
  // Historical Trend (P3-18)
  // -----------------------------------------------------------------------

  function artifactVm(id: number, windowEnd: string, overrides: Partial<P3IntelligenceReadSource["artifact"]> = {}) {
    return toP3IntelligenceViewModel(
      validArtifactSource({
        id,
        windowEnd: new Date(windowEnd),
        periodStart: new Date(windowEnd),
        periodEnd: new Date(windowEnd),
        ...overrides,
      })
    );
  }

  function threeArtifactHistory() {
    const a1 = artifactVm(1, "2026-08-11T00:00:00.000Z", { regime: "NEUTRAL", rotation: "ACCELERATING", rotationScore: "75.19", breadth: "0.142857", momentum7d: "14.03", relativeStrength7d: "-0.011188", leaderCoinId: 22, leaderScore: "89.29" });
    const a2 = artifactVm(9, "2026-08-13T00:00:00.000Z", { regime: "WEAKENING", rotation: "INFLOW", rotationScore: "61.19", breadth: "0.142857", momentum7d: "-0.984287", relativeStrength7d: "0.047994", leaderCoinId: 1, leaderScore: "61.35" });
    const a3 = artifactVm(10, "2026-08-15T00:00:00.000Z", { regime: "WEAKENING", rotation: "STABLE", rotationScore: "49.89", breadth: "0.000000", momentum7d: "-2.402857", relativeStrength7d: "0.040372", leaderCoinId: 12, leaderScore: "55.98" });
    return buildP3IntelligenceHistory([a1, a2, a3], { 1: [1, 2, 3], 9: [1, 2, 3], 10: [1, 4] })!;
  }

  it("renders the collapsed Historical Trend disclosure with the overall badge", () => {
    const vm = toP3IntelligenceViewModel(validArtifactSource());
    const html = renderToStaticMarkup(
      <P3IntelligencePanel narrativeName="AI" viewModel={vm} history={threeArtifactHistory()} />
    );
    expect(html).toContain("Historical Trend");
    expect(html).toContain("Deteriorating");
  });

  it("renders the full historical trend chain and deltas when disclosed", () => {
    const history = threeArtifactHistory();
    const html = renderToStaticMarkup(
      <P3HistoricalTrend narrativeName="AI" history={history} defaultOpen />
    );

    // Identity banner
    expect(html).toContain("AI · 7D · algorithm p3-orchestrator/1 · observed");
    // Chain: three windows with regime/rotation chips and scores
    expect(html).toContain("11 Aug 2026");
    expect(html).toContain("13 Aug 2026");
    expect(html).toContain("15 Aug 2026");
    expect(html).toContain("75.19");
    expect(html).toContain("61.19");
    expect(html).toContain("49.89");
    // Latest step rows: rotation score delta and momentum delta
    expect(html).toContain("Rotation score");
    expect(html).toContain("-11.30");
    expect(html).toContain("Momentum");
    expect(html).toContain("-1.42");
    // Trend summary
    expect(html).toContain("Trend · 3 windows");
    expect(html).toContain("Deteriorating");
    expect(html).toContain("Improving"); // relative strength improved between windows 1→2
  });

  it("shows the insufficient-history message with a single artifact", () => {
    const history = buildP3IntelligenceHistory([artifactVm(1, "2026-08-11T00:00:00.000Z")], {})!;
    const html = renderToStaticMarkup(
      <P3HistoricalTrend narrativeName="AI" history={history} defaultOpen />
    );

    expect(html).toContain("Not enough history yet");
    expect(html).toContain("1 same-identity artifact available");
    expect(html).not.toContain("Deteriorating");
  });

  it("renders nothing extra when history is null (no P3 artifacts at all)", () => {
    const html = renderToStaticMarkup(
      <P3HistoricalTrend narrativeName="AI" history={null} defaultOpen />
    );
    expect(html).toBe("");
  });

  it.each([
    ["VALID", "Valid"],
    ["MISSING", "Missing"],
    ["INVALID", "Invalid"],
    ["STALE", "Stale"],
    ["INSUFFICIENT_HISTORY", "Insufficient data"],
    ["NOT_APPLICABLE", "N/A"],
    ["AMBIGUOUS", "Ambiguous"],
  ] as const)(
    "renders availability state %s with its label (%s) without crashing",
    (state, label) => {
      // An artifact with no stage values: every stage inherits the artifact state.
      const vm = toP3IntelligenceViewModel(
        validArtifactSource({
          availabilityState: state,
          regime: null,
          rotation: null,
          rotationScore: null,
          breadth: null,
          momentum7d: null,
          relativeStrength7d: null,
          leaderCoinId: null,
          leaderScore: null,
        })
      );
      const html = renderToStaticMarkup(
        <P3IntelligencePanel narrativeName="AI" viewModel={vm} />
      );

      expect(html).toContain("P3 Intelligence");
      expect(html).toContain(label);
      // The badge must appear in the header as the artifact-level state.
      expect(html).toContain(`>${label}<`);
    }
  );

  it("renders each availability state as a stage badge inside the Why? disclosure", () => {
    const vm = toP3IntelligenceViewModel(validArtifactSource());
    const html = renderToStaticMarkup(
      <P3IntelligencePanel narrativeName="AI" viewModel={vm} />
    );

    // Disclosure trigger exists for provenance/explainability.
    // (& is HTML-escaped to &amp; in SSR markup)
    expect(html).toContain("Why? — window, mode &amp; stage validity");
    // Every VALID stage badge appears for a fully VALID artifact: header +
    // breadth + momentum + relative strength + leadership. (Regime and
    // rotation render their classification chips instead of state badges.)
    expect(html.match(/>Valid</g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
});
