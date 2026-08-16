import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { P3IntelligenceHistoryViewModel } from "@/lib/types/p3-intelligence-history";
import type { P3IntelligenceViewModel } from "@/lib/types/p3-intelligence";
import type { EventRisk } from "@/lib/types/event-risk";

// --- Module mocks: the P4 read service never touches the database directly ---
jest.mock("@/lib/services/p3-intelligence.service", () => ({
  getLatestValidP3Intelligence: jest.fn(),
}));
jest.mock("@/lib/services/p3-intelligence-history.service", () => ({
  getP3IntelligenceHistory: jest.fn(),
}));
jest.mock("@/lib/services/event-risk.service", () => ({
  eventRiskService: { getActiveEvents: jest.fn() },
}));
jest.mock("@/db", () => {
  const whereMock = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
  return {
    db: {
      select: () => ({
        from: () => ({
          innerJoin: () => ({ where: whereMock }),
          where: whereMock,
        }),
        where: whereMock,
      }),
    },
  };
});

import { getLatestValidP3Intelligence } from "@/lib/services/p3-intelligence.service";
import { getP3IntelligenceHistory } from "@/lib/services/p3-intelligence-history.service";
import { eventRiskService } from "@/lib/services/event-risk.service";
import { evidenceIdentityKey } from "../explanation/evidence";
import { assembleP4Evidence, classifyP2, validateIdentity } from "../assembler";
import { getP4DecisionSupport, toViewModel } from "../service";
import { interpretP4 } from "../interpretation";
import { buildExplanation } from "../explanation/engine";
import {
  makeAssembly,
  makeDefaultCurrent,
  makeHistory,
  makeP2,
  makeStep,
  makeVm,
} from "./fixtures";

const mockedCurrent = jest.mocked(getLatestValidP3Intelligence);
const mockedHistory = jest.mocked(getP3IntelligenceHistory);
const mockedEvents = jest.mocked(eventRiskService.getActiveEvents);

const PREV = makeVm({ artifactId: 101, windowEnd: "2026-08-10T00:00:00.000Z" });
const CURR = makeVm({ artifactId: 102, windowEnd: "2026-08-11T00:00:00.000Z" });

function healthyHistory(): P3IntelligenceHistoryViewModel {
  return makeHistory({
    seriesLength: 3,
    trendOverall: "IMPROVING",
    step: makeStep({
      previous: PREV,
      current: CURR,
      regime: "IMPROVING",
      rotationScore: "IMPROVING",
      momentum: "IMPROVING",
      breadth: "IMPROVING",
      relativeStrength: "STABLE",
    }),
  });
}

describe("assembleP4Evidence — pure assembly", () => {
  it("successful assembly: identity validated, moves + refs + values present", () => {
    const result = makeAssembly({ history: healthyHistory() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { assembly } = result;
    expect(assembly.identityKey).toContain("7D");
    expect(assembly.moves.regime).toBe("POSITIVE");
    expect(assembly.moves.momentum).toBe("POSITIVE");
    expect(assembly.moves.relativeStrength).toBe("NEUTRAL");
    expect(assembly.p2.scope).toBe("none");

    const fields = new Set(assembly.refs.map((ref) => ref.field));
    expect(fields).toContain("trend.overall");
    expect(fields).toContain("regimeMove");
    expect(fields).toContain("momentumMove");
    expect(fields).toContain("breadth");
    expect(Object.keys(assembly.values).length).toBe(assembly.refs.length);
  });

  it("missing P3 (no current artifact) ⇒ NO_EVIDENCE", () => {
    const result = makeAssembly({ current: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("NO_EVIDENCE");
  });

  it("missing history ⇒ NO_EVIDENCE", () => {
    const result = makeAssembly({ history: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("NO_EVIDENCE");
  });

  it("incompatible identity ⇒ IDENTITY_MISMATCH", () => {
    const mismatchHistory = makeHistory({
      seriesLength: 3,
      window: "14D",
      trendOverall: "IMPROVING",
    });
    const result = makeAssembly({ history: mismatchHistory });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("IDENTITY_MISMATCH");
    expect(result.detail).toContain("window");
  });

  it("validateIdentity returns null for a compatible pair", () => {
    const history = healthyHistory();
    const current = history.current as P3IntelligenceViewModel;
    expect(validateIdentity(current, history)).toBeNull();
  });

  it("missing P2 ⇒ scope none, no P2 references", () => {
    const result = makeAssembly({ history: healthyHistory(), p2: makeP2() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assembly.p2.scope).toBe("none");
    expect(result.assembly.refs.some((ref) => ref.sourceLayer === "P2")).toBe(false);
  });

  it("partial P2 (single coin-local) ⇒ scope coin-local, secondary evidence only", () => {
    const p2 = makeP2({
      coinLocal: [{ title: "Unlock", coinId: 1, riskLevel: "HIGH", symbol: "BTC" }],
    });
    expect(p2.scope).toBe("coin-local");
    expect(p2.maxRiskLevel).toBe("HIGH");
    expect(p2.symbols).toEqual(["BTC"]);

    const result = makeAssembly({ history: healthyHistory(), p2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p2Refs = result.assembly.refs.filter((ref) => ref.sourceLayer === "P2");
    expect(p2Refs.length).toBe(1);
    expect(p2Refs[0].sourceType).toBe("P2_EVENT_RISK");
    expect(p2Refs[0].narrativeIdentity).toBe("1");
    const value = result.assembly.values[evidenceIdentityKey(p2Refs[0])];
    expect(value?.scope?.kind).toBe("coin-local");
    expect(value?.scope?.symbols).toEqual(["BTC"]);
  });

  it("stale current assembles; interpretation caps confidence", () => {
    const staleCurrent: P3IntelligenceViewModel = { ...CURR, availabilityState: "STALE" };
    const result = makeAssembly({ history: healthyHistory(), current: staleCurrent });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const interpreted = interpretP4(result.assembly);
    expect(interpreted.status).toBe("DEGRADED");
    expect(interpreted.confidence).toBe("MEDIUM");
  });
});

describe("getP4DecisionSupport — service boundary", () => {
  beforeEach(() => {
    mockedCurrent.mockReset();
    mockedHistory.mockReset();
    mockedEvents.mockReset();
    mockedEvents.mockResolvedValue([]);
  });

  it("returns a full ViewModel for healthy evidence", async () => {
    mockedCurrent.mockResolvedValue(healthyHistory().current as P3IntelligenceViewModel);
    mockedHistory.mockResolvedValue(healthyHistory());
    mockedEvents.mockResolvedValue([]);

    const viewModel = await getP4DecisionSupport(1);
    expect(viewModel).not.toBeNull();
    if (!viewModel) return;

    expect(viewModel.status).toBe("OK");
    expect(viewModel.direction).toBe("POSITIVE");
    expect(viewModel.opportunity).toBe("HIGH");
    expect(viewModel.version.algorithmVersion).toBe("p4-decision-support");
    expect(viewModel.version.semanticVersion).toBe("1");
    expect(viewModel.narrativeIdentity.window).toBe("7D");
    expect(viewModel.asOf).toBe("2026-08-11T00:00:00.000Z");
    expect(viewModel.signals.map((signal) => signal.id)).toEqual(
      expect.arrayContaining(["NARRATIVE_IMPROVEMENT", "BROADENING"])
    );
    expect(viewModel.historicalContext?.seriesLength).toBe(3);
    expect(viewModel.provenance.derivedFrom).toEqual(["100", "101", "102"]);
    expect(viewModel.provenance.p2EventRisk).toBe(false);
  });

  it("no evidence ⇒ null (never throws)", async () => {
    mockedCurrent.mockResolvedValue(null);
    mockedHistory.mockResolvedValue(null);
    mockedEvents.mockResolvedValue([]);

    await expect(getP4DecisionSupport(1)).resolves.toBeNull();
  });

  it("incompatible identity ⇒ null", async () => {
    mockedCurrent.mockResolvedValue(makeVm({ artifactId: 102, windowEnd: "2026-08-11T00:00:00.000Z", window: "7D" }));
    mockedHistory.mockResolvedValue(
      makeHistory({ seriesLength: 3, window: "14D", trendOverall: "IMPROVING" })
    );
    mockedEvents.mockResolvedValue([]);

    await expect(getP4DecisionSupport(1)).resolves.toBeNull();
  });

  it("insufficient history ⇒ DEGRADED ViewModel (not null)", async () => {
    const single = makeHistory({ seriesLength: 1, trendOverall: "UNKNOWN" });
    mockedCurrent.mockResolvedValue(single.current as P3IntelligenceViewModel);
    mockedHistory.mockResolvedValue(single);
    mockedEvents.mockResolvedValue([]);

    const viewModel = await getP4DecisionSupport(1);
    expect(viewModel).not.toBeNull();
    if (!viewModel) return;
    expect(viewModel.status).toBe("DEGRADED");
    expect(viewModel.direction).toBe("UNKNOWN");
    expect(viewModel.confidence).toBe("LOW");
    expect(viewModel.degradation).toEqual([{ code: "INSUFFICIENT_HISTORY" }]);
  });

  it("P2 evidence is attached with provenance (narrative-wide ⇒ risk tier raised)", async () => {
    const current = healthyHistory().current as P3IntelligenceViewModel;
    mockedCurrent.mockResolvedValue(current);
    mockedHistory.mockResolvedValue(healthyHistory());
    mockedEvents.mockResolvedValue([
      {
        id: 7,
        coinId: null,
        narrativeId: 1,
        eventType: "REGULATORY",
        eventDate: "2026-08-10",
        riskLevel: "HIGH",
        riskScore: null,
        title: "Regulatory filing",
        description: null,
        sourceUrl: null,
        isActive: true,
        createdAt: new Date(),
        expiresAt: null,
      } as EventRisk,
    ]);

    const viewModel = await getP4DecisionSupport(1);
    expect(viewModel).not.toBeNull();
    if (!viewModel) return;

    expect(viewModel.risk).toBe("MEDIUM");
    expect(viewModel.opportunity).toBe("MEDIUM");
    expect(viewModel.provenance.p2EventRisk).toBe(true);
    const p2Refs = viewModel.evidence.filter((ref) => ref.sourceLayer === "P2");
    expect(p2Refs.length).toBe(1);
    expect(p2Refs[0].sourceType).toBe("P2_EVENT_RISK");
  });

  it("P3 read failure ⇒ null (failure isolation, P4-02 §9)", async () => {
    mockedCurrent.mockResolvedValue(healthyHistory().current as P3IntelligenceViewModel);
    mockedHistory.mockRejectedValue(new Error("db down"));
    mockedEvents.mockResolvedValue([]);

    await expect(getP4DecisionSupport(1)).resolves.toBeNull();
  });

  it("explanation is attached with frozen attribution", async () => {
    const history = healthyHistory();
    const result = makeAssembly({ history });
    if (!result.ok) throw new Error(result.detail);
    const interpretation = interpretP4(result.assembly);
    const explanation = buildExplanation(interpretation);
    const viewModel = toViewModel(result.assembly, interpretation, explanation);

    expect(viewModel.explanation.items.length).toBeGreaterThan(0);
    expect(viewModel.explanation.attribution.algorithmVersion).toBe("p4-decision-support");
    expect(viewModel.explanation.attribution.semanticVersion).toBe("1");
    expect(viewModel.explanation.attribution.interpretationRuleVersion).toBe("p4-03/v1");
    expect(viewModel.explanation.attribution.explanationVersion).toBe("1");
    // Every explanation item references at least one piece of evidence.
    for (const item of viewModel.explanation.items) {
      expect(item.supportingEvidence.length + item.conflictingEvidence.length + item.contextualEvidence.length).toBeGreaterThan(0);
    }
  });

  it("deterministic repeated execution — identical modulo generatedAt metadata", async () => {
    mockedCurrent.mockResolvedValue(healthyHistory().current as P3IntelligenceViewModel);
    mockedHistory.mockResolvedValue(healthyHistory());
    mockedEvents.mockResolvedValue([]);

    const first = await getP4DecisionSupport(1);
    const second = await getP4DecisionSupport(1);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;

    const stripGenerated = (value: NonNullable<typeof first>) => ({
      ...value,
      generatedAt: "",
      explanation: {
        ...value.explanation,
        generatedAt: "",
        items: value.explanation.items.map((item) => ({ ...item, generatedAt: "" })),
      },
    });
    expect(stripGenerated(first)).toStrictEqual(stripGenerated(second));
  });
});

describe("classifyP2 — §10 scope classification", () => {
  it("narrative-wide beats coin-local", () => {
    const p2 = makeP2({
      narrativeWide: [{ title: "Filing", riskLevel: "HIGH" }],
      coinLocal: [{ title: "Unlock", coinId: 1, riskLevel: "MEDIUM", symbol: "BTC" }],
    });
    expect(p2.scope).toBe("narrative-wide");
    expect(p2.maxRiskLevel).toBe("HIGH");
  });

  it("multi-coin requires ≥2 distinct constituents", () => {
    const single = makeP2({
      coinLocal: [{ title: "A", coinId: 1, riskLevel: "HIGH", symbol: "BTC" }],
    });
    expect(single.scope).toBe("coin-local");

    const multi = makeP2({
      coinLocal: [
        { title: "A", coinId: 1, riskLevel: "HIGH", symbol: "BTC" },
        { title: "B", coinId: 2, riskLevel: "HIGH", symbol: "ETH" },
      ],
    });
    expect(multi.scope).toBe("multi-coin");
    expect(multi.symbols.sort()).toEqual(["BTC", "ETH"]);
  });

  it("max risk level tracks the worst event across scopes", () => {
    const p2 = makeP2({
      narrativeWide: [{ title: "A", riskLevel: "CRITICAL" }],
    });
    expect(p2.maxRiskLevel).toBe("CRITICAL");
  });

  it("assembleP4Evidence never mutates P3 inputs (read-only)", () => {
    const history = healthyHistory();
    const current = history.current as P3IntelligenceViewModel;
    const snapshotHistory = JSON.stringify(history);
    const snapshotCurrent = JSON.stringify(current);
    assembleP4Evidence({ current, history, p2: makeP2() });
    expect(JSON.stringify(history)).toBe(snapshotHistory);
    expect(JSON.stringify(current)).toBe(snapshotCurrent);
  });

  it("makeDefaultCurrent and healthyHistory are identity-compatible", () => {
    const history = healthyHistory();
    expect(validateIdentity(makeDefaultCurrent(), history)).toBeNull();
  });
});
