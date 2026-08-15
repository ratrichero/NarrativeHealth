import { describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import { toP3IntelligenceViewModel, type P3IntelligenceReadSource } from "@/lib/services/p3-intelligence.service";
import {
  P3_TREND_EPSILONS,
  P3_TREND_MINIMUM_ARTIFACTS,
  aggregateTrendStates,
  buildP3IntelligenceHistory,
  classificationTransition,
  getP3IntelligenceHistory,
  overallTrend,
  trendFromDelta,
} from "@/lib/services/p3-intelligence-history.service";
import type { P3IntelligenceViewModel } from "@/lib/types/p3-intelligence";

// ---------------------------------------------------------------------------
// Fixtures — mirror the 3 VALID production artifacts (AI / 7D / observed)
// ---------------------------------------------------------------------------

function artifactSource(
  overrides: Partial<P3IntelligenceReadSource["artifact"]> = {},
  leaderSymbol = "BLUAI"
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
      breadth: "0.142857",
      momentum1d: null,
      momentum3d: null,
      momentum7d: "14.03",
      momentum14d: null,
      relativeStrength1d: null,
      relativeStrength3d: null,
      relativeStrength7d: "-0.011188",
      relativeStrength14d: null,
      leaderCoinId: 10,
      leaderScore: "89.29",
      regime: "NEUTRAL",
      rotation: "ACCELERATING",
      rotationScore: "75.192711",
      provenance: { kernel: "p3-core", context: { window: "7D" } },
      ...overrides,
    },
    leaderSymbol,
    memberCount: 7,
  };
}

/** Production artifact #1: Aug 11, NEUTRAL / ACCELERATING 75.19. */
function artifact1(): P3IntelligenceViewModel {
  return toP3IntelligenceViewModel(artifactSource());
}

/** Production artifact #2: Aug 13, WEAKENING / INFLOW 61.19. */
function artifact2(): P3IntelligenceViewModel {
  return toP3IntelligenceViewModel(
    artifactSource({
      id: 9,
      windowEnd: new Date("2026-08-13T00:00:00.000Z"),
      periodStart: new Date("2026-08-05T00:00:00.000Z"),
      periodEnd: new Date("2026-08-13T00:00:00.000Z"),
      breadth: "0.142857",
      momentum7d: "-0.984287",
      relativeStrength7d: "0.047994",
      leaderCoinId: 22,
      leaderScore: "61.349426",
      regime: "WEAKENING",
      rotation: "INFLOW",
      rotationScore: "61.190795",
    }, "AR")
  );
}

/** Production artifact #3: Aug 15, WEAKENING / STABLE 49.89. */
function artifact3(): P3IntelligenceViewModel {
  return toP3IntelligenceViewModel(
    artifactSource({
      id: 10,
      windowEnd: new Date("2026-08-15T00:00:00.000Z"),
      periodStart: new Date("2026-08-07T00:00:00.000Z"),
      periodEnd: new Date("2026-08-15T00:00:00.000Z"),
      breadth: "0.000000",
      momentum7d: "-2.402857",
      relativeStrength7d: "0.040372",
      leaderCoinId: 12,
      leaderScore: "55.984621",
      regime: "WEAKENING",
      rotation: "STABLE",
      rotationScore: "49.892445",
    }, "OM")
  );
}

const MEMBERS_A = [1, 2, 3, 4, 5, 6, 7];
const MEMBERS_B = [1, 2, 3, 4, 5, 6, 7]; // unchanged vs A
const MEMBERS_C = [1, 2, 3, 8, 9]; // changed vs B

function constituents(entries: Array<[number, number[]]>): Record<number, number[]> {
  return Object.fromEntries(entries);
}

// ---------------------------------------------------------------------------
// Pure trend functions
// ---------------------------------------------------------------------------

describe("trendFromDelta (P3-14 D.1/D.2)", () => {
  it("improves above +ε and deteriorates below -ε, stable within ±ε", () => {
    expect(trendFromDelta(15.0, P3_TREND_EPSILONS.momentum)).toBe("IMPROVING");
    expect(trendFromDelta(-15.0, P3_TREND_EPSILONS.momentum)).toBe("DETERIORATING");
    expect(trendFromDelta(0.3, P3_TREND_EPSILONS.momentum)).toBe("STABLE");
    expect(trendFromDelta(-0.3, P3_TREND_EPSILONS.momentum)).toBe("STABLE");
    expect(trendFromDelta(0, P3_TREND_EPSILONS.momentum)).toBe("STABLE");
  });

  it("returns UNKNOWN for unavailable deltas — never fabricates", () => {
    expect(trendFromDelta(null, 1.0)).toBe("UNKNOWN");
    expect(trendFromDelta(Number.NaN, 1.0)).toBe("UNKNOWN");
  });
});

describe("classificationTransition (P3-14 D.1/D.3)", () => {
  it("NEUTRAL → NEUTRAL is STABLE, never no-data", () => {
    expect(classificationTransition("NEUTRAL", "NEUTRAL", { NEUTRAL: 2 })).toBe("STABLE");
  });

  it("regime transition NEUTRAL → WEAKENING is DETERIORATING (regime weakens)", () => {
    const state = classificationTransition("NEUTRAL", "WEAKENING", {
      DEAD: 0, WEAKENING: 1, NEUTRAL: 2, MATURE: 3, EMERGING: 4, STRONG: 5,
    });
    expect(state).toBe("DETERIORATING");
  });

  it("regime improvement NEUTRAL → EMERGING is IMPROVING (P3-14 D.1 example)", () => {
    const state = classificationTransition("NEUTRAL", "EMERGING", {
      DEAD: 0, WEAKENING: 1, NEUTRAL: 2, MATURE: 3, EMERGING: 4, STRONG: 5,
    });
    expect(state).toBe("IMPROVING");
  });

  it("same regime WEAKENING → WEAKENING is STABLE", () => {
    const state = classificationTransition("WEAKENING", "WEAKENING", {
      DEAD: 0, WEAKENING: 1, NEUTRAL: 2, MATURE: 3, EMERGING: 4, STRONG: 5,
    });
    expect(state).toBe("STABLE");
  });

  it("rotation strengthening STABLE → ACCELERATING is IMPROVING (P3-14 D.1 example)", () => {
    const state = classificationTransition("STABLE", "ACCELERATING", {
      OUTFLOW: 0, DECELERATING: 1, STABLE: 2, INFLOW: 3, ACCELERATING: 4,
    });
    expect(state).toBe("IMPROVING");
  });

  it("rotation weakening ACCELERATING → INFLOW is DETERIORATING", () => {
    const state = classificationTransition("ACCELERATING", "INFLOW", {
      OUTFLOW: 0, DECELERATING: 1, STABLE: 2, INFLOW: 3, ACCELERATING: 4,
    });
    expect(state).toBe("DETERIORATING");
  });

  it("unavailable or unranked classifications yield UNKNOWN", () => {
    expect(classificationTransition(null, "NEUTRAL", { NEUTRAL: 2 })).toBe("UNKNOWN");
    expect(classificationTransition("NEUTRAL", null, { NEUTRAL: 2 })).toBe("UNKNOWN");
    expect(classificationTransition("FUTURE_STATE", "NEUTRAL", { NEUTRAL: 2 })).toBe("UNKNOWN");
  });
});

describe("aggregateTrendStates / overallTrend", () => {
  it("mixed directions over steps → TRANSITION", () => {
    expect(aggregateTrendStates(["IMPROVING", "DETERIORATING"])).toBe("TRANSITION");
  });

  it("single direction wins", () => {
    expect(aggregateTrendStates(["DETERIORATING", "STABLE"])).toBe("DETERIORATING");
    expect(aggregateTrendStates(["IMPROVING", "STABLE"])).toBe("IMPROVING");
  });

  it("any UNKNOWN → UNKNOWN (never fabricated)", () => {
    expect(aggregateTrendStates(["IMPROVING", "UNKNOWN"])).toBe("UNKNOWN");
    expect(overallTrend("IMPROVING", "STABLE", "UNKNOWN")).toBe("UNKNOWN");
  });

  it("empty steps → UNKNOWN; all stable → STABLE; all transition → TRANSITION", () => {
    expect(aggregateTrendStates([])).toBe("UNKNOWN");
    expect(aggregateTrendStates(["STABLE", "STABLE"])).toBe("STABLE");
    expect(aggregateTrendStates(["TRANSITION", "TRANSITION"])).toBe("TRANSITION");
  });

  it("overall combines regime + rotation + momentum (P3-14 D.1)", () => {
    expect(overallTrend("DETERIORATING", "DETERIORATING", "DETERIORATING")).toBe("DETERIORATING");
    expect(overallTrend("STABLE", "DETERIORATING", "DETERIORATING")).toBe("DETERIORATING");
    expect(overallTrend("IMPROVING", "DETERIORATING", "STABLE")).toBe("TRANSITION");
    expect(overallTrend("STABLE", "STABLE", "STABLE")).toBe("STABLE");
  });
});

// ---------------------------------------------------------------------------
// buildP3IntelligenceHistory — data sufficiency
// ---------------------------------------------------------------------------

describe("buildP3IntelligenceHistory — data sufficiency (P3-14 G.2)", () => {
  it("returns null for an empty series (0 artifacts)", () => {
    expect(buildP3IntelligenceHistory([], {})).toBeNull();
  });

  it("1 artifact → insufficient history, empty steps, UNKNOWN trend", () => {
    const history = buildP3IntelligenceHistory([artifact1()], {});
    expect(history).not.toBeNull();
    expect(history!.series).toHaveLength(1);
    expect(history!.current!.artifactId).toBe(1);
    expect(history!.previous).toBeNull();
    expect(history!.steps).toHaveLength(0);
    expect(history!.trend.overall).toBe("UNKNOWN");
    expect(history!.trend.regime).toBe("UNKNOWN");
    expect(history!.dataSufficiency.sufficient).toBe(false);
    expect(history!.dataSufficiency.comparableArtifacts).toBe(1);
    expect(history!.dataSufficiency.requiredMinimum).toBe(P3_TREND_MINIMUM_ARTIFACTS);
  });

  it("2 artifacts → deltas available (1 step), trend classifiable", () => {
    const history = buildP3IntelligenceHistory([artifact1(), artifact2()], constituents([
      [1, MEMBERS_A],
      [9, MEMBERS_B],
    ]));
    expect(history!.steps).toHaveLength(1);
    const step = history!.steps[0];
    expect(step.regime.state).toBe("DETERIORATING"); // NEUTRAL → WEAKENING
    expect(step.rotation.state).toBe("DETERIORATING"); // ACCELERATING → INFLOW
    expect(step.rotationScore.delta).toBeCloseTo(61.190795 - 75.192711, 4);
    expect(step.rotationScore.state).toBe("DETERIORATING");
    expect(step.momentum.delta).toBeCloseTo(-0.984287 - 14.03, 4);
    expect(step.momentum.state).toBe("DETERIORATING");
    expect(step.relativeStrength.state).toBe("IMPROVING"); // -0.011 → +0.048
    expect(step.breadth.state).toBe("STABLE");
    expect(step.leadership.changed).toBe(true);
    expect(step.leadership.state).toBe("TRANSITION");
    expect(step.constituents.changed).toBe(false);
    expect(step.constituents.state).toBe("STABLE");
    expect(history!.trend.overall).toBe("DETERIORATING");
    expect(history!.dataSufficiency.sufficient).toBe(true);
  });

  it("3 artifacts → 2 steps, aggregated trend, chronological ordering", () => {
    const history = buildP3IntelligenceHistory([artifact1(), artifact2(), artifact3()], constituents([
      [1, MEMBERS_A],
      [9, MEMBERS_B],
      [10, MEMBERS_C],
    ]));

    expect(history!.series.map((a) => a.windowEndLabel)).toEqual([
      "11 Aug 2026",
      "13 Aug 2026",
      "15 Aug 2026",
    ]);
    expect(history!.current!.windowEndLabel).toBe("15 Aug 2026");
    expect(history!.previous!.windowEndLabel).toBe("13 Aug 2026");
    expect(history!.steps).toHaveLength(2);

    // Step 2: WEAKENING → WEAKENING (same regime) = STABLE; INFLOW → STABLE = DETERIORATING.
    const step2 = history!.steps[1];
    expect(step2.regime.state).toBe("STABLE");
    expect(step2.rotation.state).toBe("DETERIORATING");
    expect(step2.breadth.state).toBe("DETERIORATING");
    expect(step2.momentum.state).toBe("DETERIORATING");
    expect(step2.relativeStrength.state).toBe("STABLE");
    expect(step2.leadership.changed).toBe(true);
    expect(step2.constituents.changed).toBe(true);
    expect(step2.constituents.added).toEqual([8, 9]);
    expect(step2.constituents.removed).toEqual([4, 5, 6, 7]);

    // Aggregates over both steps.
    expect(history!.trend.regime).toBe("DETERIORATING"); // [DET, STABLE]
    expect(history!.trend.rotation).toBe("DETERIORATING");
    expect(history!.trend.momentum).toBe("DETERIORATING");
    expect(history!.trend.breadth).toBe("DETERIORATING"); // [STABLE, DET]
    expect(history!.trend.relativeStrength).toBe("IMPROVING"); // [IMP, STABLE]
    expect(history!.trend.leadership).toBe("TRANSITION"); // [TRANS, TRANS]
    expect(history!.trend.overall).toBe("DETERIORATING");
  });
});

// ---------------------------------------------------------------------------
// Semantic edge cases
// ---------------------------------------------------------------------------

describe("P3-18 trend semantics edge cases (P3-14 D.3)", () => {
  it("NOT_APPLICABLE artifact yields UNKNOWN, never STABLE", () => {
    const notApplicable = toP3IntelligenceViewModel(
      artifactSource({
        id: 20,
        windowEnd: new Date("2026-08-17T00:00:00.000Z"),
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
    const history = buildP3IntelligenceHistory([artifact1(), notApplicable], constituents([[1, MEMBERS_A]]));
    const step = history!.steps[0];
    expect(step.regime.state).toBe("UNKNOWN");
    expect(step.rotation.state).toBe("UNKNOWN");
    expect(step.momentum.state).toBe("UNKNOWN");
    expect(step.state).toBe("UNKNOWN");
    expect(history!.trend.overall).toBe("UNKNOWN");
    expect(history!.trend.overall).not.toBe("STABLE");
  });

  it("missing stage (null value in a VALID artifact) → UNKNOWN for that metric only", () => {
    const missingMomentum = toP3IntelligenceViewModel(
      artifactSource({
        id: 9,
        windowEnd: new Date("2026-08-13T00:00:00.000Z"),
        regime: "WEAKENING",
        rotation: "INFLOW",
        rotationScore: "61.19",
        momentum7d: null,
      })
    );
    const history = buildP3IntelligenceHistory([artifact1(), missingMomentum], constituents([[1, MEMBERS_A]]));
    const step = history!.steps[0];
    expect(step.momentum.state).toBe("UNKNOWN");
    expect(step.regime.state).toBe("DETERIORATING"); // other metrics still classify
    expect(history!.trend.momentum).toBe("UNKNOWN");
    expect(history!.trend.overall).toBe("UNKNOWN"); // momentum gate feeds overall
  });

  it("constituent snapshot unavailable → constituents UNKNOWN, never STABLE", () => {
    const history = buildP3IntelligenceHistory([artifact1(), artifact2()], {});
    const step = history!.steps[0];
    expect(step.constituents.state).toBe("UNKNOWN");
    expect(step.constituents.state).not.toBe("STABLE");
  });
});

// ---------------------------------------------------------------------------
// Read service (db mocked — read-only contract, identity filtering)
// ---------------------------------------------------------------------------

jest.mock("@/db", () => ({ db: {} }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db } = require("@/db") as { db: Record<string, unknown> };

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
  chain.limit = jest.fn(() => chain);
  return chain;
}

function rawArtifact(
  id: number,
  windowEnd: string,
  version: string,
  extra: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    id,
    narrativeId: 1,
    windowEnd: new Date(windowEnd),
    periodStart: new Date(windowEnd),
    periodEnd: new Date(windowEnd),
    algorithmKey: "p3-orchestrator",
    algorithmVersion: version,
    calculationMode: "observed",
    availabilityState: "VALID",
    breadth: "0.142857",
    momentum1d: null,
    momentum3d: null,
    momentum7d: "1.0",
    momentum14d: null,
    relativeStrength1d: null,
    relativeStrength3d: null,
    relativeStrength7d: "0.01",
    relativeStrength14d: null,
    leaderCoinId: 10,
    leaderScore: "80",
    regime: "NEUTRAL",
    rotation: "STABLE",
    rotationScore: "60",
    provenance: { kernel: "p3-core", context: { window: "7D" } },
    ...extra,
  };
}

describe("getP3IntelligenceHistory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when no VALID artifact exists", async () => {
    const select = jest.fn().mockReturnValueOnce(chainReturning([]));
    (db as { select: unknown }).select = select;

    const history = await getP3IntelligenceHistory(99);
    expect(select).toHaveBeenCalledTimes(1);
    expect(history).toBeNull();
  });

  it("returns the full 3-artifact identity-filtered series with trend", async () => {
    const artifacts = [
      rawArtifact(1, "2026-08-11T00:00:00.000Z", "1"),
      rawArtifact(9, "2026-08-13T00:00:00.000Z", "1"),
      rawArtifact(10, "2026-08-15T00:00:00.000Z", "1"),
    ];
    const select = jest
      .fn()
      .mockReturnValueOnce(chainReturning(artifacts)) // artifacts
      .mockReturnValueOnce(chainReturning([{ id: 10, symbol: "BLUAI" }])) // leader coins
      .mockReturnValueOnce(chainReturning([
        { id: 100, intelligenceId: 1, memberCount: 7 },
        { id: 101, intelligenceId: 9, memberCount: 7 },
        { id: 102, intelligenceId: 10, memberCount: 7 },
      ])) // snapshots
      .mockReturnValueOnce(chainReturning([
        { snapshotId: 100, coinId: 1 },
        { snapshotId: 101, coinId: 1 },
        { snapshotId: 102, coinId: 1 },
      ])); // members
    (db as { select: unknown }).select = select;

    const history = await getP3IntelligenceHistory(1);
    expect(history).not.toBeNull();
    expect(history!.series).toHaveLength(3);
    expect(history!.identity.window).toBe("7D");
    expect(history!.identity.algorithmKey).toBe("p3-orchestrator");
    expect(history!.identity.algorithmVersion).toBe("1");
    expect(history!.identity.calculationMode).toBe("observed");
    expect(history!.dataSufficiency.sufficient).toBe(true);
    expect(history!.trend.overall).not.toBe("UNKNOWN");
  });

  it("different identity (algorithm version) is excluded — only the latest identity is compared", async () => {
    // v2 artifact at Aug 14 sits between the v1 artifacts but must never be
    // compared with v1 (P3-14 Part C).
    const artifacts = [
      rawArtifact(1, "2026-08-11T00:00:00.000Z", "1"),
      rawArtifact(50, "2026-08-14T00:00:00.000Z", "2", { rotationScore: "70" }),
      rawArtifact(9, "2026-08-13T00:00:00.000Z", "1"),
      rawArtifact(10, "2026-08-15T00:00:00.000Z", "1"),
    ];
    const select = jest
      .fn()
      .mockReturnValueOnce(chainReturning(artifacts))
      .mockReturnValueOnce(chainReturning([{ id: 10, symbol: "BLUAI" }]))
      .mockReturnValueOnce(chainReturning([
        { id: 100, intelligenceId: 1, memberCount: 7 },
        { id: 101, intelligenceId: 9, memberCount: 7 },
        { id: 102, intelligenceId: 10, memberCount: 7 },
      ]))
      .mockReturnValueOnce(chainReturning([
        { snapshotId: 100, coinId: 1 },
        { snapshotId: 101, coinId: 1 },
        { snapshotId: 102, coinId: 1 },
      ]));
    (db as { select: unknown }).select = select;

    const history = await getP3IntelligenceHistory(1);
    expect(history).not.toBeNull();
    expect(history!.series.map((a) => a.artifactId)).toEqual([1, 9, 10]); // v2 id=50 excluded
    expect(history!.identity.algorithmVersion).toBe("1");
    expect(history!.series.some((a) => a.artifactId === 50)).toBe(false);
  });

  it("different calculation mode is excluded from the same-identity comparison", async () => {
    const artifacts = [
      rawArtifact(1, "2026-08-11T00:00:00.000Z", "1"),
      rawArtifact(60, "2026-08-13T00:00:00.000Z", "1", { calculationMode: "simulated" }),
      rawArtifact(9, "2026-08-13T00:00:00.000Z", "1"),
    ];
    const select = jest
      .fn()
      .mockReturnValueOnce(chainReturning(artifacts))
      .mockReturnValueOnce(chainReturning([{ id: 10, symbol: "BLUAI" }]))
      .mockReturnValueOnce(chainReturning([
        { id: 100, intelligenceId: 1, memberCount: 7 },
        { id: 101, intelligenceId: 9, memberCount: 7 },
      ]))
      .mockReturnValueOnce(chainReturning([
        { snapshotId: 100, coinId: 1 },
        { snapshotId: 101, coinId: 1 },
      ]));
    (db as { select: unknown }).select = select;

    const history = await getP3IntelligenceHistory(1);
    expect(history!.series.map((a) => a.artifactId)).toEqual([1, 9]);
    expect(history!.identity.calculationMode).toBe("observed");
  });
});

// ---------------------------------------------------------------------------
// Read path must never import the P3 kernel (P3-18 hard constraint)
// ---------------------------------------------------------------------------

describe("read path kernel isolation", () => {
  it("p3-intelligence-history.service.ts has no runtime import from @/lib/p3/*", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/lib/services/p3-intelligence-history.service.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/from\s+["']@\/lib\/p3\//);
    expect(source).not.toMatch(/from\s+["']@\/lib\/p3["']/);
  });

  it("the history service never calls calculation functions (no recalc imports)", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/lib/services/p3-intelligence-history.service.ts"),
      "utf8"
    );
    for (const forbidden of ["calculateRotation", "calculateRegime", "runP3AuthoritativeExecution"]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
