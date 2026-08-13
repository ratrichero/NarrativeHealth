import { normalizeResult } from "../context";
import { validateMandatoryStages, P3InsufficientDataError } from "../orchestrator";
import type { P3CalculationResult } from "../context";

/**
 * Helper: create a P3CalculationResult with a given availabilityState.
 * This mirrors the structure used in production.
 */
function makeResult(availabilityState: P3CalculationResult["availabilityState"]): P3CalculationResult {
  return {
    narrativeId: 1,
    windowStart: new Date("2026-08-03T00:00:00.000Z"),
    windowEnd: new Date("2026-08-11T00:00:00.000Z"),
    algorithmKey: "test",
    algorithmVersion: "1",
    calculationMode: "observed",
    availabilityState,
    confidence: null,
    metrics: {},
    provenance: {},
  };
}

function valid(): P3CalculationResult {
  return makeResult("VALID");
}

describe("P3-10E.16 Orchestrator persistence gate", () => {
  // Test 1: Breadth failure
  test("Test 1: P3-04 Breadth failure prevents persistence", () => {
    expect(() =>
      validateMandatoryStages(
        makeResult("INSUFFICIENT_HISTORY"),  // P3-04 Breadth
        valid(),                               // P3-05 Momentum
        valid(),                               // P3-06 Relative Strength
        valid(),                               // P3-07 Leadership
        valid(),                               // P3-08 Regime
        valid()                                // P3-09 Rotation
      )
    ).toThrow(P3InsufficientDataError);
    expect(() =>
      validateMandatoryStages(
        makeResult("INSUFFICIENT_HISTORY"),
        valid(), valid(), valid(), valid(), valid()
      )
    ).toThrow(/P3-04 Breadth=INSUFFICIENT_HISTORY/);
  });

  // Test 2: Momentum failure
  test("Test 2: P3-05 Momentum failure prevents persistence", () => {
    expect(() =>
      validateMandatoryStages(
        valid(),                               // P3-04 Breadth
        makeResult("MISSING"),                 // P3-05 Momentum
        valid(),                               // P3-06 Relative Strength
        valid(),                               // P3-07 Leadership
        valid(),                               // P3-08 Regime
        valid()                                // P3-09 Rotation
      )
    ).toThrow(P3InsufficientDataError);
    expect(() =>
      validateMandatoryStages(
        valid(), makeResult("MISSING"), valid(), valid(), valid(), valid()
      )
    ).toThrow(/P3-05 Momentum=MISSING/);
  });

  // Test 3: Relative Strength failure
  test("Test 3: P3-06 Relative Strength failure prevents persistence", () => {
    expect(() =>
      validateMandatoryStages(
        valid(),                               // P3-04 Breadth
        valid(),                               // P3-05 Momentum
        makeResult("INVALID"),                 // P3-06 Relative Strength
        valid(),                               // P3-07 Leadership
        valid(),                               // P3-08 Regime
        valid()                                // P3-09 Rotation
      )
    ).toThrow(P3InsufficientDataError);
    expect(() =>
      validateMandatoryStages(
        valid(), valid(), makeResult("INVALID"), valid(), valid(), valid()
      )
    ).toThrow(/P3-06 Relative Strength=INVALID/);
  });

  // Test 4: Leadership failure
  test("Test 4: P3-07 Leadership failure prevents persistence", () => {
    expect(() =>
      validateMandatoryStages(
        valid(),                               // P3-04 Breadth
        valid(),                               // P3-05 Momentum
        valid(),                               // P3-06 Relative Strength
        makeResult("INSUFFICIENT_HISTORY"),    // P3-07 Leadership
        valid(),                               // P3-08 Regime
        valid()                                // P3-09 Rotation
      )
    ).toThrow(P3InsufficientDataError);
    expect(() =>
      validateMandatoryStages(
        valid(), valid(), valid(), makeResult("INSUFFICIENT_HISTORY"), valid(), valid()
      )
    ).toThrow(/P3-07 Leadership=INSUFFICIENT_HISTORY/);
  });

  // Test 5: Regime failure
  test("Test 5: P3-08 Regime failure prevents persistence", () => {
    expect(() =>
      validateMandatoryStages(
        valid(),                               // P3-04 Breadth
        valid(),                               // P3-05 Momentum
        valid(),                               // P3-06 Relative Strength
        valid(),                               // P3-07 Leadership
        makeResult("MISSING"),                 // P3-08 Regime
        valid()                                // P3-09 Rotation
      )
    ).toThrow(P3InsufficientDataError);
    expect(() =>
      validateMandatoryStages(
        valid(), valid(), valid(), valid(), makeResult("MISSING"), valid()
      )
    ).toThrow(/P3-08 Regime=MISSING/);
  });

  // Test 6: Rotation failure
  test("Test 6: P3-09 Rotation failure prevents persistence", () => {
    expect(() =>
      validateMandatoryStages(
        valid(),                               // P3-04 Breadth
        valid(),                               // P3-05 Momentum
        valid(),                               // P3-06 Relative Strength
        valid(),                               // P3-07 Leadership
        valid(),                               // P3-08 Regime
        makeResult("INVALID")                  // P3-09 Rotation
      )
    ).toThrow(P3InsufficientDataError);
    expect(() =>
      validateMandatoryStages(
        valid(), valid(), valid(), valid(), valid(), makeResult("INVALID")
      )
    ).toThrow(/P3-09 Rotation=INVALID/);
  });

  // Test 8: Complete execution with all VALID stages
  test("Test 8: all VALID stages pass validation", () => {
    expect(() =>
      validateMandatoryStages(
        valid(),   // P3-04 Breadth
        valid(),   // P3-05 Momentum
        valid(),   // P3-06 Relative Strength
        valid(),   // P3-07 Leadership
        valid(),   // P3-08 Regime
        valid()    // P3-09 Rotation
      )
    ).not.toThrow();
  });

  // Multiple stages failing
  test("reports all failed stages in the error message", () => {
    let caught: P3InsufficientDataError | undefined;
    try {
      validateMandatoryStages(
        makeResult("MISSING"),         // P3-04 Breadth
        valid(),                        // P3-05 Momentum
        makeResult("INVALID"),         // P3-06 Relative Strength
        valid(),                        // P3-07 Leadership
        makeResult("STALE"),           // P3-08 Regime
        valid()                         // P3-09 Rotation
      );
    } catch (e) {
      caught = e as P3InsufficientDataError;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain("P3-04 Breadth=MISSING");
    expect(caught!.message).toContain("P3-06 Relative Strength=INVALID");
    expect(caught!.message).toContain("P3-08 Regime=STALE");
  });

  // Edge cases for non-VALID states
  test("rejects STALE state", () => {
    expect(() =>
      validateMandatoryStages(
        valid(), valid(), valid(), valid(),
        makeResult("STALE"),  // P3-08 Regime
        valid()
      )
    ).toThrow(P3InsufficientDataError);
  });

  test("rejects NOT_APPLICABLE state", () => {
    expect(() =>
      validateMandatoryStages(
        valid(), valid(), valid(), valid(),
        valid(),
        makeResult("NOT_APPLICABLE")  // P3-09 Rotation
      )
    ).toThrow(P3InsufficientDataError);
  });

  test("rejects AMBIGUOUS state", () => {
    expect(() =>
      validateMandatoryStages(
        makeResult("AMBIGUOUS"),  // P3-04 Breadth
        valid(), valid(), valid(), valid(), valid()
      )
    ).toThrow(P3InsufficientDataError);
  });
});
