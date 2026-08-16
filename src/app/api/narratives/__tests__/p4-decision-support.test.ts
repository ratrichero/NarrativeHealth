import { describe, expect, it, jest } from "@jest/globals";
import { NextRequest } from "next/server";

// P4 must never fail the narrative endpoint (P4-02 §10). Mock the DB with
// empty-but-successful chains so every non-P4 query succeeds, then drive the
// P4 service from mocks and assert degrade-to-null behavior + serialization.

jest.mock("@/db", () => ({ db: {} }));

jest.mock("@/lib/services/p3-intelligence.service", () => ({
  getLatestValidP3Intelligence: jest.fn(),
}));

jest.mock("@/lib/services/p3-intelligence-history.service", () => ({
  getP3IntelligenceHistory: jest.fn(),
}));

jest.mock("@/lib/p4/service", () => ({
  getP4DecisionSupport: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db } = require("@/db") as { db: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getLatestValidP3Intelligence } = require(
  "@/lib/services/p3-intelligence.service"
) as { getLatestValidP3Intelligence: jest.Mock<() => Promise<unknown>> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getP3IntelligenceHistory } = require(
  "@/lib/services/p3-intelligence-history.service"
) as { getP3IntelligenceHistory: jest.Mock<() => Promise<unknown>> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getP4DecisionSupport } = require("@/lib/p4/service") as {
  getP4DecisionSupport: jest.Mock<(narrativeId: number) => Promise<unknown>>;
};

import { GET } from "../[id]/route";

function chainReturning<T>(result: T) {
  const chain: Record<string, unknown> = {
    then(resolve: (value: T) => unknown) {
      return Promise.resolve(result).then(resolve);
    },
  };
  const step = jest.fn(() => chain);
  chain.from = step;
  chain.where = step;
  chain.orderBy = step;
  chain.innerJoin = step;
  chain.limit = jest.fn(() => chain);
  return chain;
}

function mockHealthyDb() {
  const select = jest
    .fn()
    .mockReturnValueOnce(
      chainReturning([{ id: 1, name: "AI", description: "d", isActive: true }])
    )
    .mockReturnValueOnce(chainReturning([])) // narrativeHealth today
    .mockReturnValueOnce(chainReturning([])) // healthHistory 30d
    .mockReturnValueOnce(chainReturning([])); // coinsInNarrative
  (db as { select: unknown }).select = select;
}

/** A representative full P4DecisionSupportViewModel for serialization tests. */
function makeViewModel() {
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
        evidenceRefs: [
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
        ],
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
  };
}

describe("GET /api/narratives/[id] — data.p4DecisionSupport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("A — returns the P4 ViewModel when the P4 service succeeds", async () => {
    mockHealthyDb();
    (getLatestValidP3Intelligence as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
    (getP3IntelligenceHistory as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
    (getP4DecisionSupport as jest.Mock<() => Promise<unknown>>).mockResolvedValue(makeViewModel());

    const request = new NextRequest("http://localhost/api/narratives/1");
    const response = await GET(request, { params: Promise.resolve({ id: "1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.p4DecisionSupport).toBeDefined();
    expect(body.data.p4DecisionSupport.status).toBe("OK");
    expect(body.data.p4DecisionSupport.direction).toBe("POSITIVE");
    expect(body.data.p4DecisionSupport.version.algorithmVersion).toBe("p4-decision-support");
    expect(body.data.p4DecisionSupport.narrativeIdentity.window).toBe("7D");
    expect(getP4DecisionSupport).toHaveBeenCalledWith(1);
  });

  it("B — P4 returns null ⇒ API still succeeds with p4DecisionSupport null", async () => {
    mockHealthyDb();
    (getLatestValidP3Intelligence as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
    (getP3IntelligenceHistory as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
    (getP4DecisionSupport as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);

    const request = new NextRequest("http://localhost/api/narratives/1");
    const response = await GET(request, { params: Promise.resolve({ id: "1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.p4DecisionSupport).toBeNull();
  });

  it("C — P4 service throws ⇒ API still succeeds with p4DecisionSupport null", async () => {
    mockHealthyDb();
    (getLatestValidP3Intelligence as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
    (getP3IntelligenceHistory as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
    (getP4DecisionSupport as jest.Mock<() => Promise<unknown>>).mockRejectedValue(
      new Error("p4 exploded")
    );

    const request = new NextRequest("http://localhost/api/narratives/1");
    const response = await GET(request, { params: Promise.resolve({ id: "1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.p4DecisionSupport).toBeNull();
  });

  it("D — existing response fields remain unchanged when P4 is present", async () => {
    mockHealthyDb();
    (getLatestValidP3Intelligence as jest.Mock<() => Promise<unknown>>).mockResolvedValue({
      artifactId: 1,
      narrativeId: 1,
      window: "7D",
      availabilityState: "VALID",
      regime: { availabilityState: "VALID", classification: "NEUTRAL", display: "NEUTRAL" },
    });
    (getP3IntelligenceHistory as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
    (getP4DecisionSupport as jest.Mock<() => Promise<unknown>>).mockResolvedValue(makeViewModel());

    const request = new NextRequest("http://localhost/api/narratives/1");
    const response = await GET(request, { params: Promise.resolve({ id: "1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.id).toBe(1);
    expect(body.data.name).toBe("AI");
    expect(body.data.description).toBe("d");
    expect(body.data.isActive).toBe(true);
    expect(body.data.healthScore).toBe(50);
    expect(body.data.coins).toEqual([]);
    expect(body.data.p3Intelligence.regime.classification).toBe("NEUTRAL");
    expect(body.data.p3IntelligenceHistory).toBeNull();
    expect(body.data.p4DecisionSupport.status).toBe("OK");
  });

  it("E — P4 failure does not affect P3 data (P3 independence)", async () => {
    mockHealthyDb();
    (getLatestValidP3Intelligence as jest.Mock<() => Promise<unknown>>).mockResolvedValue({
      artifactId: 1,
      narrativeId: 1,
      window: "7D",
      availabilityState: "VALID",
      regime: { availabilityState: "VALID", classification: "STRONG", display: "STRONG" },
    });
    (getP3IntelligenceHistory as jest.Mock<() => Promise<unknown>>).mockResolvedValue({
      identity: { narrativeId: 1, window: "7D", algorithmKey: "p3-orchestrator", algorithmVersion: "1", calculationMode: "observed" },
      series: [],
      current: null,
      previous: null,
      steps: [],
      trend: { overall: "IMPROVING" },
      dataSufficiency: { comparableArtifacts: 0, requiredMinimum: 2, sufficient: false },
    });
    (getP4DecisionSupport as jest.Mock<() => Promise<unknown>>).mockRejectedValue(
      new Error("p4 exploded")
    );

    const request = new NextRequest("http://localhost/api/narratives/1");
    const response = await GET(request, { params: Promise.resolve({ id: "1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.p3Intelligence.regime.classification).toBe("STRONG");
    expect(body.data.p3IntelligenceHistory.trend.overall).toBe("IMPROVING");
    expect(body.data.p4DecisionSupport).toBeNull();
  });

  it("F — full ViewModel survives API serialization (round-trip)", async () => {
    mockHealthyDb();
    (getLatestValidP3Intelligence as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
    (getP3IntelligenceHistory as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
    const fixture = makeViewModel();
    (getP4DecisionSupport as jest.Mock<() => Promise<unknown>>).mockResolvedValue(fixture);

    const request = new NextRequest("http://localhost/api/narratives/1");
    const response = await GET(request, { params: Promise.resolve({ id: "1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.p4DecisionSupport).toStrictEqual(fixture);
    // Representative field-level checks (direction, signals, O/R/C/A,
    // explanation, evidence, provenance, historicalContext, degradation).
    expect(body.data.p4DecisionSupport.direction).toBe("POSITIVE");
    expect(body.data.p4DecisionSupport.signals).toHaveLength(1);
    expect(body.data.p4DecisionSupport.signals[0].id).toBe("NARRATIVE_IMPROVEMENT");
    expect(body.data.p4DecisionSupport.signals[0].evidenceRefs[0].field).toBe("trend.overall");
    expect(body.data.p4DecisionSupport.opportunity).toBe("HIGH");
    expect(body.data.p4DecisionSupport.risk).toBe("LOW");
    expect(body.data.p4DecisionSupport.confidence).toBe("HIGH");
    expect(body.data.p4DecisionSupport.actionability).toBe("HIGH");
    expect(body.data.p4DecisionSupport.explanation.items[0].statement).toContain("Narrative is improving");
    expect(body.data.p4DecisionSupport.explanation.attribution.interpretationRuleVersion).toBe("p4-03/v1");
    expect(body.data.p4DecisionSupport.evidence).toHaveLength(2);
    expect(body.data.p4DecisionSupport.evidence[1].sourceLayer).toBe("P2");
    expect(body.data.p4DecisionSupport.evidence[1].artifactIdentity).toBeNull();
    expect(body.data.p4DecisionSupport.historicalContext.seriesLength).toBe(3);
    expect(body.data.p4DecisionSupport.historicalContext.overallTrend).toBe("IMPROVING");
    expect(body.data.p4DecisionSupport.provenance.derivedFrom).toEqual(["100", "101", "102"]);
    expect(body.data.p4DecisionSupport.provenance.p2EventRisk).toBe(true);
    expect(body.data.p4DecisionSupport.degradation).toEqual([]);
    expect(body.data.p4DecisionSupport.generatedAt).toBe("2026-08-16T00:00:00.000Z");
    expect(body.data.p4DecisionSupport.asOf).toBe("2026-08-11T00:00:00.000Z");
  });

  it("404 — unknown narrative does not invoke the P4 service", async () => {
    const select = jest.fn().mockReturnValueOnce(chainReturning([]));
    (db as { select: unknown }).select = select;

    const request = new NextRequest("http://localhost/api/narratives/999");
    const response = await GET(request, { params: Promise.resolve({ id: "999" }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(getP4DecisionSupport).not.toHaveBeenCalled();
  });
});
