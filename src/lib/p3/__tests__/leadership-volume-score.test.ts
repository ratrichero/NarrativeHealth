/**
 * P3-10E.36 — Leadership Volume Score Normalization Regression Tests
 */

jest.mock("@/db", () => {
  let selectCallCount = 0;

  const createBuilder = (data: unknown[]) => ({
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(data),
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(data).then(resolve),
  });

  return {
    db: {
      select: jest.fn(() => {
        selectCallCount++;
        const builders = [
          createBuilder([]), // health scores
          createBuilder([]), // features
          createBuilder([]), // features again (for volumeScore)
          createBuilder([]), // price data
          createBuilder([]), // price data again
        ];
        const builder = builders[Math.min(selectCallCount - 1, builders.length - 1)];
        return builder;
      }),
      from: jest.fn(),
      where: jest.fn(),
      and: jest.fn(),
      inArray: jest.fn(),
      eq: jest.fn(),
      gte: jest.fn(),
      lte: jest.fn(),
      orderBy: jest.fn(),
      limit: jest.fn(),
    },
  };
});

import { prepareLeadershipInputs } from "../preparation";
import type { P3Constituent } from "../context";

const mockDb = jest.mocked(require("@/db").db);

function createConstituents(coinIds: number[]): P3Constituent[] {
  return coinIds.map((coinId) => ({
    coinId,
    membershipState: "ELIGIBLE" as const,
    inclusionReason: null,
    availabilityState: "VALID" as const,
    inputManifest: { reason: null, marketCap: 1, instrument: `C${coinId}USDT` },
  }));
}

function setupMocks(options: {
  healthRows: ReturnType<typeof mockHealthRow>[];
  featureRows: ReturnType<typeof mockFeatureRow>[];
  priceRows: ReturnType<typeof mockPriceRow>[];
}) {
  jest.clearAllMocks();
  (mockDb.select as jest.Mock).mockClear();

  let callIndex = 0;
  const builders = [
    createTestBuilder(options.healthRows),
    createTestBuilder(options.featureRows),
    createTestBuilder(options.featureRows),
    createTestBuilder(options.priceRows),
    createTestBuilder(options.priceRows),
  ];

  (mockDb.select as jest.Mock).mockImplementation(() => {
    const builder = builders[callIndex % builders.length];
    callIndex++;
    return builder;
  });
}

function createTestBuilder(data: unknown[]) {
  return {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(data),
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(data).then(resolve),
  };
}

function mockHealthRow(coinId: number, healthScore: number | null, date: string) {
  return { coinId, date, healthScore };
}

function mockFeatureRow(coinId: number, volumeScore: number | null, date: string) {
  return { coinId, date, volumeScore };
}

function mockPriceRow(coinId: number, close: string, date: string) {
  return { coinId, close, date };
}

describe("P3-10E.36 Leadership Volume Score Normalization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("raw volume is NOT passed as Leadership volumeScore", async () => {
    const constituents = createConstituents([1]);
    const windowEnd = new Date("2026-08-11T00:00:00Z");

    setupMocks({
      healthRows: [mockHealthRow(1, 70, "2026-08-11")],
      featureRows: [mockFeatureRow(1, 55, "2026-08-11")],
      priceRows: [mockPriceRow(1, "100", "2026-08-04"), mockPriceRow(1, "110", "2026-08-11")],
    });

    const result = await prepareLeadershipInputs(1, windowEnd, constituents);
    const input = result.constituents.find((c) => c.coinId === 1);

    expect(input?.volumeScore).toBe(55);
    expect(input?.volumeScore).toBeLessThanOrEqual(100);
  });

  test("canonical normalized feature value is used", async () => {
    const constituents = createConstituents([2]);
    const windowEnd = new Date("2026-08-11T00:00:00Z");

    setupMocks({
      healthRows: [mockHealthRow(2, 80, "2026-08-11")],
      featureRows: [mockFeatureRow(2, 42, "2026-08-11")],
      priceRows: [mockPriceRow(2, "50", "2026-08-04"), mockPriceRow(2, "55", "2026-08-11")],
    });

    const result = await prepareLeadershipInputs(2, windowEnd, constituents);
    const input = result.constituents.find((c) => c.coinId === 2);

    expect(input?.volumeScore).toBe(42);
  });

  test("feature value within 0-100 is accepted", async () => {
    const constituents = createConstituents([3]);
    const windowEnd = new Date("2026-08-11T00:00:00Z");

    setupMocks({
      healthRows: [mockHealthRow(3, 70, "2026-08-11")],
      featureRows: [mockFeatureRow(3, 0, "2026-08-11")],
      priceRows: [mockPriceRow(3, "100", "2026-08-04"), mockPriceRow(3, "100", "2026-08-11")],
    });

    const result = await prepareLeadershipInputs(3, windowEnd, constituents);
    const input = result.constituents.find((c) => c.coinId === 3);

    expect(input?.volumeScore).toBe(0);
    expect(input?.volumeScore).toBeGreaterThanOrEqual(0);
    expect(input?.volumeScore).toBeLessThanOrEqual(100);
  });

  test("missing feature value produces the correct unavailable behavior", async () => {
    const constituents = createConstituents([4]);
    const windowEnd = new Date("2026-08-11T00:00:00Z");

    setupMocks({
      healthRows: [mockHealthRow(4, 70, "2026-08-11")],
      featureRows: [],
      priceRows: [mockPriceRow(4, "100", "2026-08-04"), mockPriceRow(4, "110", "2026-08-11")],
    });

    const result = await prepareLeadershipInputs(4, windowEnd, constituents);
    const input = result.constituents.find((c) => c.coinId === 4);

    expect(input?.volumeScore).toBeNull();
  });

  test("large raw volume values do not cause Leadership exclusion", async () => {
    const constituents = createConstituents([5]);
    const windowEnd = new Date("2026-08-11T00:00:00Z");

    setupMocks({
      healthRows: [mockHealthRow(5, 70, "2026-08-11")],
      featureRows: [mockFeatureRow(5, 75, "2026-08-11")],
      priceRows: [mockPriceRow(5, "100", "2026-08-04"), mockPriceRow(5, "110", "2026-08-11")],
    });

    const result = await prepareLeadershipInputs(5, windowEnd, constituents);
    const input = result.constituents.find((c) => c.coinId === 5);

    expect(input?.volumeScore).toBe(75);
    expect(input?.volumeScore).toBeLessThanOrEqual(100);
  });
});
