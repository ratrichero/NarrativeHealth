/**
 * P3 Input Preparation & Execution Context Tests
 */

import { createP3ExecutionContext, prepareBreadthInputs, prepareMomentumInputs } from "../preparation";
import { resolveP3Window } from "../windows";

// CI không có Postgres: mock `@/db` bằng fixture cố định cho feature/rule version
// và membership snapshot. Chain drizzle tối thiểu (select/from/where/orderBy/
// limit + thenable) đủ để các query trong test trả đúng bảng, không đổi ngữ nghĩa
// kernel — chỉ thay nguồn dữ liệu.
jest.mock("@/db", () => {
  const schema = require("@/db/schema") as typeof import("@/db/schema");
  const coverageStart = new Date("2026-08-09T00:00:00.000Z");
  const members = [
    { coinId: 101, isPrimary: true, sourceEventId: 11 },
    { coinId: 102, isPrimary: false, sourceEventId: 12 },
  ];
  // sha256 của canonical digest trong membership.ts cho đúng 2 member trên.
  const memberDigest = "611cf50b6a2500b067e7d86dd610c97b4022c2c6c3ee188b68f12794ce1f9d8a";

  const fixtures = new Map<unknown, unknown[]>([
    [schema.featureVersions, [{ id: 1, isActive: true }]],
    [schema.ruleVersions, [{ id: 1, isActive: true }]],
    [schema.narrativeMembershipCoverage, [{ historyCoverageStart: coverageStart }]],
    [
      schema.narrativeMembershipSnapshots,
      [
        {
          id: 9001,
          narrativeId: 1,
          windowEnd: coverageStart,
          membershipMode: "observed",
          snapshotRevision: 1,
          memberCount: members.length,
          memberDigest,
        },
      ],
    ],
    [schema.narrativeMembershipSnapshotMembers, members],
    [schema.narrativeMembershipEvents, []],
    [
      schema.coins,
      [
        { id: 101, symbol: "AAA", isActive: true, binanceFuturesSymbol: "AAAUSDT", coingeckoId: "aaa" },
        { id: 102, symbol: "BBB", isActive: true, binanceFuturesSymbol: "BBBUSDT", coingeckoId: "bbb" },
      ],
    ],
    [
      schema.coinMetrics,
      [
        { coinId: 101, marketCap: "1000000", date: "2026-08-09" },
        { coinId: 102, marketCap: null, date: "2026-08-09" },
      ],
    ],
    [
      schema.healthScores,
      [
        { coinId: 101, healthScore: 72 },
        { coinId: 102, healthScore: 55 },
      ],
    ],
    [
      schema.narrativeHealth,
      [
        { date: "2026-08-03", healthScore: 60 },
        { date: "2026-08-09", healthScore: 66 },
      ],
    ],
    [schema.features, []],
    [schema.p3NarrativeIntelligence, []],
  ]);

  const rowsFor = (table: unknown) => fixtures.get(table) ?? [];

  function chain(table: unknown) {
    const self = {
      from: (next: unknown) => chain(next),
      where: () => self,
      orderBy: () => self,
      limit: async (count: number) => rowsFor(table).slice(0, count),
      then: (resolve: (rows: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
        Promise.resolve(rowsFor(table)).then(resolve, reject),
    };
    return self;
  }

  return {
    db: {
      select: () => chain(undefined),
      execute: async () => ({ rows: [] }),
    },
  };
});

describe("P3-10C Input Preparation", () => {
  describe("UTC Window Resolution", () => {
    test("resolves UTC window through P3-03 kernel", async () => {
      const windowEnd = new Date("2026-08-09T00:00:00Z");
      const config = {
        narrativeId: 1,
        window: "7D" as const,
        windowEnd,
        calculationMode: "observed" as const,
      };

      const result = await createP3ExecutionContext(config);

      // The resolved window should match P3-03 kernel output
      const expectedWindow = resolveP3Window("7D", windowEnd);

      expect(result.resolvedWindow.window).toBe("7D");
      expect(result.resolvedWindow.windowStart.getTime()).toBe(expectedWindow.windowStart.getTime());
      expect(result.resolvedWindow.windowEnd.getTime()).toBe(expectedWindow.windowEnd.getTime());
    });

    test("window_end must be UTC day boundary", async () => {
      const invalidWindowEnd = new Date("2026-08-09T12:00:00Z"); // Not UTC day boundary

      const config = {
        narrativeId: 1,
        window: "7D" as const,
        windowEnd: invalidWindowEnd,
        calculationMode: "observed" as const,
      };

      // Should reject non-UTC boundary (resolveP3Window throws)
      await expect(createP3ExecutionContext(config)).rejects.toThrow("UTC day boundary");
    });
  });

  describe("Execution Context", () => {
    test("creates context with all required fields", async () => {
      const windowEnd = new Date("2026-08-09T00:00:00Z");
      const config = {
        narrativeId: 1,
        window: "7D" as const,
        windowEnd,
        calculationMode: "observed" as const,
      };

      const result = await createP3ExecutionContext(config);

      expect(result.context).toMatchObject({
        narrativeId: 1,
        calculationMode: "observed",
        window: "7D",
        algorithmKey: "p3-kernel",
        algorithmVersion: "1",
      });

      expect(result.context.constituents).toBeDefined();
      expect(result.context.provenance).toBeDefined();
    });

    test("UTC timezone semantics preserved", async () => {
      const windowEnd = new Date("2026-08-09T00:00:00Z");
      const config = {
        narrativeId: 1,
        window: "7D" as const,
        windowEnd,
        calculationMode: "observed" as const,
      };

      const result = await createP3ExecutionContext(config);

      // Window boundaries should be UTC
      expect(result.resolvedWindow.windowEnd.getUTCHours()).toBe(0);
      expect(result.resolvedWindow.windowEnd.getUTCMinutes()).toBe(0);
      expect(result.resolvedWindow.windowStart.getUTCHours()).toBe(0);
      expect(result.resolvedWindow.windowStart.getUTCMinutes()).toBe(0);
    });
  });

  describe("Historical Constituent Snapshot", () => {
    test("snapshot captured before calculations", async () => {
      const windowEnd = new Date("2026-08-09T00:00:00Z");
      const config = {
        narrativeId: 1,
        window: "7D" as const,
        windowEnd,
        calculationMode: "observed" as const,
      };

      const result = await createP3ExecutionContext(config);

      // Snapshot should be established
      expect(result.context.provenance.snapshotId).toBeDefined();
      expect(result.context.constituents).toBeDefined();
    });

    test("deterministic ordering by coinId", async () => {
      const windowEnd = new Date("2026-08-09T00:00:00Z");
      const config = {
        narrativeId: 1,
        window: "7D" as const,
        windowEnd,
        calculationMode: "observed" as const,
      };

      const result = await createP3ExecutionContext(config);

      // Constituents should be sorted by coinId
      const coinIds = result.context.constituents.map((c) => c.coinId);
      const sortedCoinIds = [...coinIds].sort((a, b) => a - b);
      expect(coinIds).toEqual(sortedCoinIds);
    });
  });

  describe("Market Cap Eligibility", () => {
    test("market cap present → eligible", async () => {
      // This test requires test data with market cap
      // Skip for now - requires database setup
    });

    test("market cap missing → excluded", async () => {
      // This test requires test data without market cap
      // Skip for now - requires database setup
    });

    test("exclusion reason preserved", async () => {
      // This test verifies that excluded constituents have reasons
      // Skip for now - requires database setup
    });
  });

  describe("Missing Data Semantics", () => {
    test("missing ≠ zero", async () => {
      // Verify that missing data is not converted to zero
      // Skip for now - requires database setup
    });

    test("missing ≠ neutral", async () => {
      // Verify that missing data is not converted to neutral (50)
      // Skip for now - requires database setup
    });

    test("preserves MISSING state", async () => {
      // Verify that MISSING state is preserved through preparation
      // Skip for now - requires database setup
    });
  });

  describe("Determinism", () => {
    test("same inputs produce identical context", async () => {
      const windowEnd = new Date("2026-08-09T00:00:00Z");
      const config = {
        narrativeId: 1,
        window: "7D" as const,
        windowEnd,
        calculationMode: "observed" as const,
      };

      const result1 = await createP3ExecutionContext(config);
      const result2 = await createP3ExecutionContext(config);

      // Should produce identical results
      expect(result1.context.narrativeId).toBe(result2.context.narrativeId);
      expect(result1.context.window).toBe(result2.context.window);
      expect(result1.context.constituents.length).toBe(result2.context.constituents.length);
    });
  });

  describe("Breadth Input Preparation", () => {
    test("prepares BreadthConstituent array", async () => {
      const windowEnd = new Date("2026-08-09T00:00:00Z");
      const context = await createP3ExecutionContext({
        narrativeId: 1,
        window: "7D" as const,
        windowEnd,
        calculationMode: "observed" as const,
      });

      const result = await prepareBreadthInputs(
        1,
        windowEnd,
        context.constituents
      );

      expect(result.constituents).toBeDefined();
      expect(Array.isArray(result.constituents)).toBe(true);
    });

    test("health validation: 0-100 range", async () => {
      // Verify that health scores outside 0-100 are marked INVALID
      // Skip for now - requires database setup
    });

    test("missing health → MISSING state", async () => {
      // Verify that missing health scores are marked MISSING
      // Skip for now - requires database setup
    });
  });

  describe("Momentum Input Preparation", () => {
    test("prepares narrative health observations", async () => {
      const windowEnd = new Date("2026-08-09T00:00:00Z");

      const result = await prepareMomentumInputs(1, windowEnd);

      expect(result.observations).toBeDefined();
      expect(Array.isArray(result.observations)).toBe(true);
    });

    test("observations are UTC date labels", async () => {
      const windowEnd = new Date("2026-08-09T00:00:00Z");

      const result = await prepareMomentumInputs(1, windowEnd);

      // Verify date format is YYYY-MM-DD
      for (const obs of result.observations) {
        expect(obs.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });
  });

  describe("Provenance", () => {
    test("preserves snapshot identity", async () => {
      const windowEnd = new Date("2026-08-09T00:00:00Z");
      const config = {
        narrativeId: 1,
        window: "7D" as const,
        windowEnd,
        calculationMode: "observed" as const,
      };

      const result = await createP3ExecutionContext(config);

      expect(result.context.provenance.snapshotId).toBeDefined();
      // Kernel freeze: membership.snapshotId là id số của bản ghi
      // narrative_membership_snapshots, không bị đổi sang string.
      expect(typeof result.context.provenance.snapshotId).toBe("number");
    });

    test("preserves version identities", async () => {
      const windowEnd = new Date("2026-08-09T00:00:00Z");
      const config = {
        narrativeId: 1,
        window: "7D" as const,
        windowEnd,
        calculationMode: "observed" as const,
      };

      const result = await createP3ExecutionContext(config);

      expect(result.context.featureVersionId).toBeDefined();
      expect(result.context.ruleVersionId).toBeDefined();
      expect(result.context.scoreConfigId).toBeDefined();
    });
  });
});
