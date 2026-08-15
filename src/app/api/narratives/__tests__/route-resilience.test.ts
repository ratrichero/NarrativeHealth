import { describe, expect, it, jest } from "@jest/globals";
import { NextRequest } from "next/server";

// The P3 read must never take down the narrative endpoint. Mock the DB with
// empty-but-successful chains so every non-P3 query succeeds, then make the
// P3 service throw and assert the route still returns 200 + p3Intelligence:null.

jest.mock("@/db", () => ({ db: {} }));

jest.mock("@/lib/services/p3-intelligence.service", () => ({
  getLatestValidP3Intelligence: jest.fn(),
}));

jest.mock("@/lib/services/p3-intelligence-history.service", () => ({
  getP3IntelligenceHistory: jest.fn(),
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

import { GET } from "../[id]/route";

function chainReturning<T>(result: T) {
  // The chain is a thenable: awaiting it at any point (after limit as well
  // as after orderBy/innerJoin) resolves to `result`.
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
  // GET query order:
  // 1. narratives (limit 1) -> one narrative
  // 2. narrativeHealth today (limit 1) -> []
  // 3. healthHistory 30d (orderBy) -> []
  // 4. coinsInNarrative (innerJoin) -> []
  const select = jest
    .fn()
    .mockReturnValueOnce(
      chainReturning([
        { id: 1, name: "AI", description: "d", isActive: true },
      ])
    )
    .mockReturnValueOnce(chainReturning([]))
    .mockReturnValueOnce(chainReturning([]))
    .mockReturnValueOnce(chainReturning([]));
  (db as { select: unknown }).select = select;
}

describe("GET /api/narratives/[id] — P3 resilience", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 200 with p3Intelligence null when the P3 read service throws", async () => {
    mockHealthyDb();
    (getLatestValidP3Intelligence as jest.Mock<() => Promise<unknown>>).mockRejectedValue(
      new Error("p3 db exploded")
    );

    const request = new NextRequest("http://localhost/api/narratives/1");
    const response = await GET(request, { params: Promise.resolve({ id: "1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(1);
    expect(body.data.name).toBe("AI");
    // The P3 field must degrade to null instead of failing the whole request.
    expect(body.data.p3Intelligence).toBeNull();
  });

  it("returns 200 with the view model when the P3 read succeeds", async () => {
    mockHealthyDb();
    (getLatestValidP3Intelligence as jest.Mock<() => Promise<unknown>>).mockResolvedValue({
      artifactId: 1,
      narrativeId: 1,
      window: "7D",
      availabilityState: "VALID",
      regime: { availabilityState: "VALID", classification: "NEUTRAL", display: "NEUTRAL" },
      rotation: { availabilityState: "VALID", classification: "ACCELERATING", display: "ACCELERATING" },
    });

    const request = new NextRequest("http://localhost/api/narratives/1");
    const response = await GET(request, { params: Promise.resolve({ id: "1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.p3Intelligence.availabilityState).toBe("VALID");
    expect(body.data.p3Intelligence.regime.classification).toBe("NEUTRAL");
    expect(body.data.p3Intelligence.rotation.classification).toBe("ACCELERATING");
  });

  it("returns 200 with p3IntelligenceHistory null when the history service throws", async () => {
    mockHealthyDb();
    (getLatestValidP3Intelligence as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
    (getP3IntelligenceHistory as jest.Mock<() => Promise<unknown>>).mockRejectedValue(
      new Error("history db exploded")
    );

    const request = new NextRequest("http://localhost/api/narratives/1");
    const response = await GET(request, { params: Promise.resolve({ id: "1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.p3IntelligenceHistory).toBeNull();
  });

  it("returns 200 with the history view model when the history read succeeds", async () => {
    mockHealthyDb();
    (getLatestValidP3Intelligence as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
    (getP3IntelligenceHistory as jest.Mock<() => Promise<unknown>>).mockResolvedValue({
      identity: { narrativeId: 1, window: "7D", algorithmKey: "p3-orchestrator", algorithmVersion: "1", calculationMode: "observed" },
      series: [],
      current: null,
      previous: null,
      steps: [],
      trend: { overall: "UNKNOWN" },
      dataSufficiency: { comparableArtifacts: 0, requiredMinimum: 2, sufficient: false },
    });

    const request = new NextRequest("http://localhost/api/narratives/1");
    const response = await GET(request, { params: Promise.resolve({ id: "1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.p3IntelligenceHistory.trend.overall).toBe("UNKNOWN");
  });

  it("returns 404 for an unknown narrative without invoking P3", async () => {
    const select = jest.fn().mockReturnValueOnce(chainReturning([]));
    (db as { select: unknown }).select = select;

    const request = new NextRequest("http://localhost/api/narratives/999");
    const response = await GET(request, { params: Promise.resolve({ id: "999" }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(getLatestValidP3Intelligence).not.toHaveBeenCalled();
    expect(getP3IntelligenceHistory).not.toHaveBeenCalled();
  });
});
