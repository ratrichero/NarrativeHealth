import { describe, expect, it, jest } from "@jest/globals";
import {
  formatP3Momentum,
  formatP3Ratio,
  formatP3Score,
  formatP3SignedRatio,
  getLatestValidP3Intelligence,
  inferP3Window,
  normalizeAvailabilityState,
  p3WindowEndLabel,
  p3WindowLabel,
  toP3IntelligenceViewModel,
  type P3IntelligenceReadSource,
} from "@/lib/services/p3-intelligence.service";

// ---------------------------------------------------------------------------
// Fixtures — mirror the first VALID P3 artifact (P3-12 context):
// narrativeId 1 (AI), window 7D, windowEnd 2026-08-11, observed,
// VALID, NEUTRAL, ACCELERATING, 7 constituents, leader BLUAI.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

describe("P3 formatting helpers", () => {
  it("formats breadth as a 3-decimal ratio", () => {
    expect(formatP3Ratio(0.14)).toBe("0.140");
  });

  it("formats momentum as a signed 2-decimal value", () => {
    expect(formatP3Momentum(14.03)).toBe("+14.03");
    expect(formatP3Momentum(-5)).toBe("-5.00");
  });

  it("formats relative strength as a signed ratio", () => {
    expect(formatP3SignedRatio(-0.011)).toBe("-0.011");
    expect(formatP3SignedRatio(0.5)).toBe("+0.500");
  });

  it("formats scores with 2 decimals", () => {
    expect(formatP3Score(89.29)).toBe("89.29");
    expect(formatP3Score(68.5)).toBe("68.50");
  });

  it("derives fallback window labels from persisted period bounds", () => {
    expect(p3WindowLabel(new Date("2026-08-04T00:00:00.000Z"), new Date("2026-08-11T00:00:00.000Z"))).toBe("7D");
    expect(p3WindowLabel(new Date("2026-08-08T00:00:00.000Z"), new Date("2026-08-11T00:00:00.000Z"))).toBe("3D");
    expect(p3WindowLabel(new Date("2026-08-10T00:00:00.000Z"), new Date("2026-08-11T00:00:00.000Z"))).toBe("1D");
  });

  it("reads the authoritative window from persisted provenance context", () => {
    const source = validArtifactSource({
      periodStart: new Date("2026-08-03T00:00:00.000Z"), // 8-day span
      momentum1d: "-1.31",
      momentum3d: "3.67",
      momentum7d: "14.03",
    });
    expect(inferP3Window(source.artifact)).toBe("7D");
  });

  it("falls back to the longest persisted momentum window when provenance is missing", () => {
    const source = validArtifactSource({
      provenance: null,
      momentum1d: "-1.31",
      momentum3d: "3.67",
      momentum7d: "14.03",
    });
    expect(inferP3Window(source.artifact)).toBe("7D");
  });

  it("formats the window end label in UTC", () => {
    expect(p3WindowEndLabel(new Date("2026-08-11T00:00:00.000Z"))).toBe("11 Aug 2026");
  });

  it("normalizes persisted availability strings", () => {
    expect(normalizeAvailabilityState("VALID")).toBe("VALID");
    expect(normalizeAvailabilityState("NOT_APPLICABLE")).toBe("NOT_APPLICABLE");
    expect(normalizeAvailabilityState("INSUFFICIENT_HISTORY")).toBe("INSUFFICIENT_HISTORY");
    expect(normalizeAvailabilityState("BOGUS")).toBe("MISSING");
    expect(normalizeAvailabilityState(null)).toBe("MISSING");
  });
});

// ---------------------------------------------------------------------------
// View-model transform
// ---------------------------------------------------------------------------

describe("toP3IntelligenceViewModel", () => {
  it("transforms the first VALID artifact into the frontend-safe read model", () => {
    const vm = toP3IntelligenceViewModel(validArtifactSource());

    expect(vm.artifactId).toBe(1);
    expect(vm.narrativeId).toBe(1);
    expect(vm.window).toBe("7D");
    expect(vm.windowEnd).toBe("2026-08-11T00:00:00.000Z");
    expect(vm.windowEndLabel).toBe("11 Aug 2026");
    expect(vm.calculationMode).toBe("observed");
    expect(vm.availabilityState).toBe("VALID");

    expect(vm.regime.classification).toBe("NEUTRAL");
    expect(vm.regime.display).toBe("NEUTRAL");
    expect(vm.regime.availabilityState).toBe("VALID");

    expect(vm.rotation.classification).toBe("ACCELERATING");
    expect(vm.rotation.score).toBe(68.5);
    expect(vm.rotation.scoreDisplay).toBe("68.50");
    expect(vm.rotation.availabilityState).toBe("VALID");

    expect(vm.breadth.display).toBe("0.140");
    expect(vm.momentum.display).toBe("+14.03");
    expect(vm.relativeStrength.display).toBe("-0.011");

    expect(vm.leadership.coinId).toBe(22);
    expect(vm.leadership.symbol).toBe("BLUAI");
    expect(vm.leadership.scoreDisplay).toBe("89.29");

    expect(vm.constituents.count).toBe(7);
    expect(vm.constituents.availabilityState).toBe("VALID");
  });

  it("regression: regime NEUTRAL is a valid classification, never N/A", () => {
    const vm = toP3IntelligenceViewModel(validArtifactSource());

    // NEUTRAL must be carried as the classification value, not collapsed into
    // an unavailable display.
    expect(vm.regime.availabilityState).toBe("VALID");
    expect(vm.regime.classification).toBe("NEUTRAL");
    expect(vm.regime.display).toBe("NEUTRAL");
    expect(vm.regime.display).not.toBe("—");
    expect(vm.regime.display).not.toBe("N/A");
  });

  it("regression: NOT_APPLICABLE is distinct from NEUTRAL", () => {
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

    expect(vm.availabilityState).toBe("NOT_APPLICABLE");
    expect(vm.regime.classification).toBeNull();
    expect(vm.regime.display).toBe("—");
    expect(vm.regime.availabilityState).toBe("NOT_APPLICABLE");
    expect(vm.regime.classification).not.toBe("NEUTRAL");
  });

  it("regression: rotation ACCELERATING is preserved, never treated as missing", () => {
    const vm = toP3IntelligenceViewModel(validArtifactSource());

    expect(vm.rotation.availabilityState).toBe("VALID");
    expect(vm.rotation.classification).toBe("ACCELERATING");
    expect(vm.rotation.classification).not.toBeNull();
  });

  it("marks missing numeric stages as MISSING without fabricating values", () => {
    const vm = toP3IntelligenceViewModel(
      validArtifactSource({
        momentum7d: null,
        relativeStrength7d: null,
        leaderCoinId: null,
        leaderScore: null,
      })
    );

    expect(vm.momentum.availabilityState).toBe("MISSING");
    expect(vm.momentum.value).toBeNull();
    expect(vm.momentum.display).toBe("—");

    expect(vm.relativeStrength.availabilityState).toBe("MISSING");
    expect(vm.relativeStrength.display).toBe("—");

    expect(vm.leadership.availabilityState).toBe("MISSING");
    expect(vm.leadership.symbol).toBe("BLUAI"); // symbol survives, score is the gate
    expect(vm.leadership.scoreDisplay).toBe("—");
  });

  it("selects the window-matched momentum/relative-strength metric", () => {
    const threeDay = toP3IntelligenceViewModel(
      validArtifactSource({
        provenance: { kernel: "p3-core", context: { window: "3D" } },
        periodStart: new Date("2026-08-08T00:00:00.000Z"),
        periodEnd: new Date("2026-08-11T00:00:00.000Z"),
        momentum3d: "2.10",
        momentum7d: "999",
        relativeStrength3d: "0.004",
        relativeStrength7d: "-9.9",
      })
    );

    expect(threeDay.window).toBe("3D");
    expect(threeDay.momentum.display).toBe("+2.10");
    expect(threeDay.relativeStrength.display).toBe("+0.004");
  });
});

// ---------------------------------------------------------------------------
// Read service (db mocked — read-only contract)
// ---------------------------------------------------------------------------

jest.mock("@/db", () => ({ db: {} }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db } = require("@/db") as { db: Record<string, unknown> };

function chainReturning<T>(result: T) {
  const chain: Record<string, unknown> = {};
  const step = jest.fn(() => chain);
  chain.from = step;
  chain.where = step;
  chain.orderBy = step;
  chain.limit = jest.fn(async () => result);
  return chain;
}

describe("getLatestValidP3Intelligence", () => {
  it("returns the latest VALID artifact joined with leadership and constituent summary", async () => {
    const artifact = validArtifactSource().artifact;
    const select = jest
      .fn()
      .mockReturnValueOnce(chainReturning([artifact]))
      .mockReturnValueOnce(chainReturning([{ symbol: "BLUAI" }]))
      .mockReturnValueOnce(chainReturning([{ memberCount: 7 }]));
    (db as { select: unknown }).select = select;

    const vm = await getLatestValidP3Intelligence(1);

    expect(select).toHaveBeenCalledTimes(3);
    expect(vm).not.toBeNull();
    expect(vm!.availabilityState).toBe("VALID");
    expect(vm!.regime.classification).toBe("NEUTRAL");
    expect(vm!.rotation.classification).toBe("ACCELERATING");
    expect(vm!.leadership.symbol).toBe("BLUAI");
    expect(vm!.constituents.count).toBe(7);
  });

  it("returns null when no VALID artifact exists (read degrades, never recalculates)", async () => {
    const select = jest.fn().mockReturnValueOnce(chainReturning([]));
    (db as { select: unknown }).select = select;

    const vm = await getLatestValidP3Intelligence(99);

    expect(select).toHaveBeenCalledTimes(1);
    expect(vm).toBeNull();
  });
});
