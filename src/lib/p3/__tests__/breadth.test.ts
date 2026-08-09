import { calculateBreadth, calculateBreadthResult } from "../breadth";
import { createCalculationContext } from "../context";
import { resolveP3Window } from "../windows";

function context() {
  const resolved = resolveP3Window("1D", new Date("2026-08-09T00:00:00.000Z"));
  return createCalculationContext({
    narrativeId: 1,
    calculationMode: "observed",
    window: "1D",
    windowStart: resolved.windowStart,
    windowEnd: resolved.windowEnd,
    calculatedAt: new Date("2026-08-09T01:00:00.000Z"),
    algorithmKey: "breadth",
    algorithmVersion: "1",
    constituents: [],
    sourceAvailability: {},
  });
}

describe("P3 breadth", () => {
  test("calculates all-positive breadth and strong breadth", () => {
    const result = calculateBreadth([
      { coinId: 1, health: 95, availabilityState: "VALID" },
      { coinId: 2, health: 80, availabilityState: "VALID" },
      { coinId: 3, health: 65, availabilityState: "VALID" },
    ]);
    expect(result).toMatchObject({ totalCoins: 3, bullishCoins: 3, neutralCoins: 0, weakCoins: 0, bullishRatio: 1, strongBreadth: 2 / 3, availabilityState: "VALID" });
  });

  test("calculates mixed threshold buckets exactly", () => {
    const result = calculateBreadth([
      { coinId: 1, health: 64.99, availabilityState: "VALID" },
      { coinId: 2, health: 50, availabilityState: "VALID" },
      { coinId: 3, health: 49.99, availabilityState: "VALID" },
      { coinId: 4, health: 79.99, availabilityState: "VALID" },
      { coinId: 5, health: 80, availabilityState: "VALID" },
    ]);
    expect(result).toMatchObject({ totalCoins: 5, bullishCoins: 2, neutralCoins: 2, weakCoins: 1, bullishRatio: 0.4, strongBreadth: 0.2 });
  });

  test("preserves valid zero as weak rather than missing", () => {
    const result = calculateBreadth([{ coinId: 1, health: 0, availabilityState: "VALID" }]);
    expect(result).toMatchObject({ totalCoins: 1, bullishCoins: 0, neutralCoins: 0, weakCoins: 1, bullishRatio: 0, strongBreadth: 0, availabilityState: "VALID" });
  });

  test("keeps unavailable health in the active-coin denominator and degrades availability", () => {
    const result = calculateBreadth([
      { coinId: 1, health: 70, availabilityState: "VALID" },
      { coinId: 2, health: null, availabilityState: "MISSING", availabilityReason: "No health row" },
      { coinId: 3, health: 40, availabilityState: "VALID" },
    ]);
    expect(result).toMatchObject({ totalCoins: 3, bullishCoins: 1, neutralCoins: 0, weakCoins: 1, bullishRatio: 1 / 3, strongBreadth: 0, availabilityState: "MISSING" });
    expect(result).not.toMatchObject({ bullishRatio: 0 });
  });

  test("invalid and insufficient inputs do not become negative or zero signals", () => {
    expect(calculateBreadth([])).toMatchObject({ availabilityState: "INSUFFICIENT_HISTORY", bullishRatio: null, strongBreadth: null });
    expect(calculateBreadth([{ coinId: 1, health: 101, availabilityState: "VALID" }])).toMatchObject({ availabilityState: "MISSING", bullishRatio: null, strongBreadth: null, bullishCoins: 0 });
  });

  test("normalizes breadth through the shared result contract with UTC context", () => {
    const result = calculateBreadthResult(context(), [{ coinId: 1, health: 65, availabilityState: "VALID" }]);
    expect(result).toMatchObject({ narrativeId: 1, windowEnd: new Date("2026-08-09T00:00:00.000Z"), availabilityState: "VALID" });
    expect(result.metrics.breadth).toMatchObject({ value: 1, state: "VALID" });
    expect(result.provenance).toMatchObject({ module: "breadth", bullishThreshold: 65, strongThreshold: 80 });
  });
});