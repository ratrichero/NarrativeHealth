jest.mock("@/db", () => ({ db: {} }));

import { calculateRegimeResult, classifyRegime, type RegimeInputs, type RegimeThresholds } from "../regime";
import { createCalculationContext } from "../context";
import { resolveP3Window } from "../windows";

const thresholds: RegimeThresholds = { healthHigh: 70, healthLow: 30, breadthHigh: 0.6, breadthLow: 0.3, momentumPositive: 0, momentumNegative: 0, accelerationDeclining: 0, healthImproving: 5, breadthIncreasing: 0.05, relativeStrengthImproving: 0.05, healthDeclining: -5, breadthDeclining: -0.05, momentumWeakening: 0, relativeStrengthPositive: 0, relativeStrengthNegative: 0 };
const base: RegimeInputs = { health: 60, healthChange: 0, breadth: 0.5, breadthChange: 0, momentum: 0, acceleration: 0, relativeStrength: 0, relativeStrengthChange: 0 };

describe("P3 Regime", () => {
  test("classifies all five regimes with deterministic configured rules", () => {
    expect(classifyRegime({ ...base, healthChange: 6, breadthChange: 0.06, momentum: 0.01, relativeStrength: 0.06, relativeStrengthChange: 0.06 }, thresholds).regime).toBe("EMERGING");
    expect(classifyRegime({ ...base, health: 80, breadth: 0.8, momentum: 0.01, relativeStrength: 0.01 }, thresholds).regime).toBe("STRONG");
    expect(classifyRegime({ ...base, health: 80, breadth: 0.8, momentum: 0, acceleration: -0.01 }, thresholds).regime).toBe("MATURE");
    expect(classifyRegime({ ...base, healthChange: -6, momentum: -0.01 }, thresholds).regime).toBe("WEAKENING");
    expect(classifyRegime({ ...base, health: 20, breadth: 0.2, momentum: -0.01, relativeStrength: -0.01 }, thresholds).regime).toBe("DEAD");
  });

  test("returns reasons and rejects unavailable inputs", () => {
    const result = classifyRegime({ ...base, health: null }, thresholds);
    expect(result.regime).toBeNull();
    expect(result.availabilityState).toBe("MISSING");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  test("does not silently choose when rules overlap", () => {
    const result = classifyRegime({ ...base, health: 80, breadth: 0.8, healthChange: 6, breadthChange: 0.06, momentum: 0.01, relativeStrength: 0.06, relativeStrengthChange: 0.06 }, thresholds);
    expect(result.regime).toBeNull();
    expect(result.availabilityState).toBe("AMBIGUOUS");
  });
  test("returns NOT_APPLICABLE and deterministic reasons when no rule matches", () => {
    const first = classifyRegime(base, thresholds);
    const second = classifyRegime({ ...base }, { ...thresholds });
    expect(first).toEqual(second);
    expect(first.availabilityState).toBe("NOT_APPLICABLE");
  });
  test("rejects invalid thresholds and algorithm identity", () => {
    expect(() => classifyRegime(base, { ...thresholds, healthHigh: 20 })).toThrow();
    const window = resolveP3Window("7D", new Date("2026-08-09T00:00:00Z"));
    const context = createCalculationContext({ narrativeId: 1, calculationMode: "observed", window: "7D", windowStart: window.windowStart, windowEnd: window.windowEnd, calculatedAt: new Date("2026-08-09T01:00:00Z"), algorithmKey: "wrong", algorithmVersion: "1", constituents: [], sourceAvailability: {} });
    expect(() => calculateRegimeResult(context, base, thresholds)).toThrow("regime/1");
  });
});
