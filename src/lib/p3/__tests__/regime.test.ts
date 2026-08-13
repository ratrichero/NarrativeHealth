jest.mock("@/db", () => ({ db: {} }));

import { calculateRegimeResult, classifyRegime, type RegimeInputs, type RegimeThresholds } from "../regime";
import { createCalculationContext } from "../context";
import { resolveP3Window } from "../windows";

const thresholds: RegimeThresholds = { healthHigh: 70, healthLow: 30, breadthHigh: 0.6, breadthLow: 0.3, momentumPositive: 0.05, momentumNegative: 0, accelerationDeclining: 0, healthImproving: 5, breadthIncreasing: 0.05, relativeStrengthImproving: 0.05, healthDeclining: -5, breadthDeclining: -0.05, momentumWeakening: 0, relativeStrengthPositive: 0.05, relativeStrengthNegative: 0 };
const base: RegimeInputs = { health: 60, healthChange: 0, breadth: 0.5, breadthChange: 0, momentum: 0, acceleration: 0, relativeStrength: 0, relativeStrengthChange: 0 };

describe("P3 Regime", () => {
  test("classifies all five regimes with deterministic configured rules", () => {
    expect(classifyRegime({ ...base, healthChange: 6, breadthChange: 0.06, momentum: 0.06, relativeStrength: 0.06, relativeStrengthChange: 0.06 }, thresholds).regime).toBe("EMERGING");
    expect(classifyRegime({ ...base, health: 80, breadth: 0.8, momentum: 0.06, relativeStrength: 0.06 }, thresholds).regime).toBe("STRONG");
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
    const result = classifyRegime({ ...base, health: 80, breadth: 0.8, healthChange: 6, breadthChange: 0.06, momentum: 0.06, relativeStrength: 0.06, relativeStrengthChange: 0.06 }, thresholds);
    expect(result.regime).toBeNull();
    expect(result.availabilityState).toBe("AMBIGUOUS");
  });
  test("returns NEUTRAL and deterministic reasons when no rule matches", () => {
    const first = classifyRegime(base, thresholds);
    const second = classifyRegime({ ...base }, { ...thresholds });
    expect(first).toEqual(second);
    expect(first.availabilityState).toBe("VALID");
    expect(first.regime).toBe("NEUTRAL");
  });
  test("rejects invalid thresholds and algorithm identity", () => {
    expect(() => classifyRegime(base, { ...thresholds, healthHigh: 20 })).toThrow();
    const window = resolveP3Window("7D", new Date("2026-08-09T00:00:00Z"));
    const context = createCalculationContext({ narrativeId: 1, calculationMode: "observed", window: "7D", windowStart: window.windowStart, windowEnd: window.windowEnd, calculatedAt: new Date("2026-08-09T01:00:00Z"), algorithmKey: "wrong", algorithmVersion: "1", constituents: [], sourceAvailability: {} });
    expect(() => calculateRegimeResult(context, base, thresholds)).toThrow("regime/1");
  });
});

describe("P3-10E.22.1 Regime First-Run Null-Semantics Verification", () => {
  test("Test 1: first-run STRONG with null historical changes", () => {
    const result = classifyRegime({ ...base, firstRun: true, breadthChange: null, relativeStrengthChange: null, health: 80, breadth: 0.8, momentum: 0.06, relativeStrength: 0.06 }, thresholds);
    expect(result.regime).toBe("STRONG");
    expect(result.availabilityState).toBe("VALID");
    expect(result.provenance.firstRun).toBe(true);
    expect(result.provenance.historicalP3BaselineAvailable).toBe(false);
  });

  test("Test 2: first-run MATURE with null historical changes", () => {
    const result = classifyRegime({ ...base, firstRun: true, breadthChange: null, relativeStrengthChange: null, health: 80, breadth: 0.8, momentum: 0, acceleration: -0.01 }, thresholds);
    expect(result.regime).toBe("MATURE");
    expect(result.availabilityState).toBe("VALID");
    expect(result.provenance.firstRun).toBe(true);
    expect(result.provenance.historicalP3BaselineAvailable).toBe(false);
  });

  test("Test 3: first-run DEAD with null historical changes", () => {
    const result = classifyRegime({ ...base, firstRun: true, breadthChange: null, relativeStrengthChange: null, health: 20, breadth: 0.2, momentum: -0.01, relativeStrength: -0.01 }, thresholds);
    expect(result.regime).toBe("DEAD");
    expect(result.availabilityState).toBe("VALID");
    expect(result.provenance.firstRun).toBe(true);
    expect(result.provenance.historicalP3BaselineAvailable).toBe(false);
  });

  test("Test 4: null must not coerce to zero for regime classification", () => {
    const withNull = classifyRegime({ ...base, firstRun: true, breadthChange: null, relativeStrengthChange: null, health: 80, breadth: 0.8, momentum: 0.06, relativeStrength: 0.06 }, thresholds);
    const withZero = classifyRegime({ ...base, firstRun: true, breadthChange: 0, relativeStrengthChange: 0, health: 80, breadth: 0.8, momentum: 0.06, relativeStrength: 0.06 }, thresholds);
    expect(withNull.regime).toBe(withZero.regime);
    expect(withNull.availabilityState).toBe(withZero.availabilityState);
    expect(withNull.provenance.breadthChange).toBeNull();
    expect(withZero.provenance.breadthChange).toBe(0);
    expect(withNull.provenance.relativeStrengthChange).toBeNull();
    expect(withZero.provenance.relativeStrengthChange).toBe(0);
  });

  test("Test 5: first-run EMERGING matches when change fields are null but current conditions are positive", () => {
    const result = classifyRegime({ ...base, firstRun: true, breadthChange: null, relativeStrengthChange: null, healthChange: 6, momentum: 0.06, relativeStrength: 0.06 }, thresholds);
    expect(result.regime).toBe("EMERGING");
    expect(result.availabilityState).toBe("VALID");
    expect(result.provenance.firstRun).toBe(true);
    expect(result.provenance.historicalP3BaselineAvailable).toBe(false);
    expect(result.provenance.breadthChange).toBeNull();
    expect(result.provenance.relativeStrengthChange).toBeNull();
  });

  test("Test 6: subsequent run with valid historical changes produces EMERGING", () => {
    const result = classifyRegime({ ...base, firstRun: false, breadthChange: 0.06, relativeStrengthChange: 0.06, healthChange: 6, momentum: 0.06, relativeStrength: 0.06 }, thresholds);
    expect(result.regime).toBe("EMERGING");
    expect(result.availabilityState).toBe("VALID");
    expect(result.provenance.firstRun).toBe(false);
    expect(result.provenance.historicalP3BaselineAvailable).toBe(true);
  });

  test("Test 7: determinism - identical first-run inputs produce identical output", () => {
    const first = classifyRegime({ ...base, firstRun: true, breadthChange: null, relativeStrengthChange: null, health: 80, breadth: 0.8, momentum: 0.06, relativeStrength: 0.06 }, thresholds);
    const second = classifyRegime({ ...base, firstRun: true, breadthChange: null, relativeStrengthChange: null, health: 80, breadth: 0.8, momentum: 0.06, relativeStrength: 0.06 }, thresholds);
    expect(first).toEqual(second);
    expect(first.availabilityState).toBe("VALID");
    expect(first.regime).toBe("STRONG");
  });

  test("Test 8: WEAKENING can match on first-run via healthChange alone", () => {
    const result = classifyRegime({ ...base, firstRun: true, breadthChange: null, relativeStrengthChange: null, healthChange: -6, momentum: -0.01 }, thresholds);
    expect(result.regime).toBe("WEAKENING");
    expect(result.availabilityState).toBe("VALID");
    expect(result.provenance.breadthChange).toBeNull();
    expect(result.provenance.relativeStrengthChange).toBeNull();
  });

  test("Test 9: WEAKENING does not match on first-run when healthChange is valid but not declining", () => {
    const result = classifyRegime({ ...base, firstRun: true, breadthChange: null, relativeStrengthChange: null, healthChange: 0, momentum: -0.01 }, thresholds);
    expect(result.regime).toBe("NEUTRAL");
    expect(result.availabilityState).toBe("VALID");
  });

  test("Test 10: provenance preserves null historical values as null, not zero", () => {
    const result = classifyRegime({ ...base, firstRun: true, breadthChange: null, relativeStrengthChange: null, health: 80, breadth: 0.8, momentum: 0.01, relativeStrength: 0.01 }, thresholds);
    expect(result.provenance.breadthChange).toBeNull();
    expect(result.provenance.relativeStrengthChange).toBeNull();
    expect(result.provenance.breadthChange).not.toBe(0);
    expect(result.provenance.relativeStrengthChange).not.toBe(0);
  });

  test("Test 11: P3-10E.37 first-run EMERGING with positive RS but null changes", () => {
    // This test verifies the fix for P3-10E.37: on first-run, EMERGING can match
    // when current conditions are positive even if historical changes are null
    const result = classifyRegime({
      ...base,
      firstRun: true,
      breadthChange: null,
      relativeStrengthChange: null,
      healthChange: 14.03,
      momentum: 0.06, // Must be strictly greater than threshold (0.05)
      relativeStrength: 0.06
    }, thresholds);
    expect(result.regime).toBe("EMERGING");
    expect(result.availabilityState).toBe("VALID");
    expect(result.provenance.firstRun).toBe(true);
  });

  test("Test 12: P3-10E.37 first-run with boundary momentum values", () => {
    // Test with momentum exactly at threshold - should not match EMERGING
    const result = classifyRegime({
      ...base,
      firstRun: true,
      breadthChange: null,
      relativeStrengthChange: null,
      healthChange: 14.03,
      momentum: 0.05, // equals threshold, not strictly greater
      relativeStrength: 0.06
    }, thresholds);
    expect(result.regime).toBe("NEUTRAL");
    expect(result.availabilityState).toBe("VALID");
  });

  test("Test 13: P3-10E.42 NEUTRAL - production state health=46.73, breadth=0.14, momentum=14.03, RS=-0.011", () => {
    // Test the exact production state that led to NEUTRAL addition
    const result = classifyRegime({
      health: 46.73,
      healthChange: 14.03,
      breadth: 0.14,
      breadthChange: null,
      momentum: 14.03,
      acceleration: 4.98,
      relativeStrength: -0.011,
      relativeStrengthChange: null,
      firstRun: true
    }, {
      healthHigh: 70,
      healthLow: 35,
      breadthHigh: 0.6,
      breadthLow: 0.35,
      momentumPositive: 0.05,
      momentumNegative: -0.05,
      accelerationDeclining: 0,
      healthImproving: 0,
      breadthIncreasing: 0,
      relativeStrengthImproving: 0,
      healthDeclining: 0,
      breadthDeclining: 0,
      momentumWeakening: -0.05,
      relativeStrengthPositive: 0.05,
      relativeStrengthNegative: -0.05
    });
    expect(result.regime).toBe("NEUTRAL");
    expect(result.availabilityState).toBe("VALID");
    expect(result.reasons).toEqual(["no_directional_regime_matched"]);
    expect(result.provenance.firstRun).toBe(true);
  });

  test("Test 14: P3-10E.42 NEUTRAL - first-run with valid inputs but no directional match", () => {
    // Test that NEUTRAL applies on first-run when all inputs are valid but no rule matches
    const result = classifyRegime({
      ...base,
      firstRun: true,
      breadthChange: null,
      relativeStrengthChange: null,
      healthChange: 2, // Positive but below healthImproving threshold
      momentum: 0.02, // Positive but below momentumPositive threshold
      relativeStrength: 0.02 // Positive but below relativeStrengthPositive threshold
    }, thresholds);
    expect(result.regime).toBe("NEUTRAL");
    expect(result.availabilityState).toBe("VALID");
  });

  test("Test 15: P3-10E.42 existing EMERGING still returns EMERGING", () => {
    // Verify existing regimes are not affected by NEUTRAL addition
    const result = classifyRegime({
      ...base,
      healthChange: 6,
      breadthChange: 0.06,
      momentum: 0.06,
      relativeStrength: 0.06,
      relativeStrengthChange: 0.06
    }, thresholds);
    expect(result.regime).toBe("EMERGING");
    expect(result.availabilityState).toBe("VALID");
  });

  test("Test 16: P3-10E.42 existing STRONG still returns STRONG", () => {
    const result = classifyRegime({
      ...base,
      health: 80,
      breadth: 0.8,
      momentum: 0.06,
      relativeStrength: 0.06
    }, thresholds);
    expect(result.regime).toBe("STRONG");
    expect(result.availabilityState).toBe("VALID");
  });

  test("Test 17: P3-10E.42 existing MATURE still returns MATURE", () => {
    const result = classifyRegime({
      ...base,
      health: 80,
      breadth: 0.8,
      momentum: 0,
      acceleration: -0.01
    }, thresholds);
    expect(result.regime).toBe("MATURE");
    expect(result.availabilityState).toBe("VALID");
  });

  test("Test 18: P3-10E.42 existing WEAKENING still returns WEAKENING", () => {
    const result = classifyRegime({
      ...base,
      healthChange: -6,
      momentum: -0.01
    }, thresholds);
    expect(result.regime).toBe("WEAKENING");
    expect(result.availabilityState).toBe("VALID");
  });

  test("Test 19: P3-10E.42 existing DEAD still returns DEAD", () => {
    const result = classifyRegime({
      ...base,
      health: 20,
      breadth: 0.2,
      momentum: -0.01,
      relativeStrength: -0.01
    }, thresholds);
    expect(result.regime).toBe("DEAD");
    expect(result.availabilityState).toBe("VALID");
  });

  test("Test 20: P3-10E.42 missing mandatory input returns NOT_APPLICABLE", () => {
    // Verify that NEUTRAL only applies when all mandatory inputs are valid
    const result = classifyRegime({
      ...base,
      health: null // Missing mandatory input
    }, thresholds);
    expect(result.regime).toBeNull();
    expect(result.availabilityState).toBe("MISSING");
  });

  test("Test 21: P3-10E.42 NEUTRAL determinism", () => {
    // Verify that identical inputs produce identical NEUTRAL output
    const first = classifyRegime({
      health: 46.73,
      healthChange: 14.03,
      breadth: 0.14,
      breadthChange: null,
      momentum: 14.03,
      acceleration: 4.98,
      relativeStrength: -0.011,
      relativeStrengthChange: null,
      firstRun: true
    }, {
      healthHigh: 70,
      healthLow: 35,
      breadthHigh: 0.6,
      breadthLow: 0.35,
      momentumPositive: 0.05,
      momentumNegative: -0.05,
      accelerationDeclining: 0,
      healthImproving: 0,
      breadthIncreasing: 0,
      relativeStrengthImproving: 0,
      healthDeclining: 0,
      breadthDeclining: 0,
      momentumWeakening: -0.05,
      relativeStrengthPositive: 0.05,
      relativeStrengthNegative: -0.05
    });
    const second = classifyRegime({
      health: 46.73,
      healthChange: 14.03,
      breadth: 0.14,
      breadthChange: null,
      momentum: 14.03,
      acceleration: 4.98,
      relativeStrength: -0.011,
      relativeStrengthChange: null,
      firstRun: true
    }, {
      healthHigh: 70,
      healthLow: 35,
      breadthHigh: 0.6,
      breadthLow: 0.35,
      momentumPositive: 0.05,
      momentumNegative: -0.05,
      accelerationDeclining: 0,
      healthImproving: 0,
      breadthIncreasing: 0,
      relativeStrengthImproving: 0,
      healthDeclining: 0,
      breadthDeclining: 0,
      momentumWeakening: -0.05,
      relativeStrengthPositive: 0.05,
      relativeStrengthNegative: -0.05
    });
    expect(first).toEqual(second);
    expect(first.regime).toBe("NEUTRAL");
    expect(first.availabilityState).toBe("VALID");
  });

  test("Test 22: P3-10E.42 NEUTRAL provenance records", () => {
    // Verify that NEUTRAL preserves firstRun and null historical values
    const result = classifyRegime({
      health: 46.73,
      healthChange: 14.03,
      breadth: 0.14,
      breadthChange: null,
      momentum: 14.03,
      acceleration: 4.98,
      relativeStrength: -0.011,
      relativeStrengthChange: null,
      firstRun: true
    }, {
      healthHigh: 70,
      healthLow: 35,
      breadthHigh: 0.6,
      breadthLow: 0.35,
      momentumPositive: 0.05,
      momentumNegative: -0.05,
      accelerationDeclining: 0,
      healthImproving: 0,
      breadthIncreasing: 0,
      relativeStrengthImproving: 0,
      healthDeclining: 0,
      breadthDeclining: 0,
      momentumWeakening: -0.05,
      relativeStrengthPositive: 0.05,
      relativeStrengthNegative: -0.05
    });
    expect(result.provenance.matched).toEqual(["NEUTRAL"]);
    expect(result.provenance.firstRun).toBe(true);
    expect(result.provenance.breadthChange).toBeNull();
    expect(result.provenance.relativeStrengthChange).toBeNull();
  });
});
