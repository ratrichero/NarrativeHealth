jest.mock("@/db", () => ({ db: {} }));

import { calculateRotation, calculateRotationResult, type RotationInputs, type RotationThresholds, normalizeHealthMomentum, normalizeBreadthMomentum, normalizeRelativeStrength, normalizeVolumeExpansion, calculateOIConfirmation, getDirection } from "../rotation";
import { createCalculationContext } from "../context";
import { resolveP3Window } from "../windows";

const thresholds: RotationThresholds = { acceleratingMin: 80, inflowMin: 60, stableMin: 40, deceleratingMin: 20 };
const input = (value: number): RotationInputs => ({ healthMomentum: value, breadthMomentum: value, relativeStrength: value, volumeExpansion: value, oiConfirmation: value });

describe("P3 Rotation", () => {
  test.each([[90, "ACCELERATING"], [70, "INFLOW"], [50, "STABLE"], [30, "DECELERATING"], [10, "OUTFLOW"]] as const)("classifies score %i as %s", (value, expected) => expect(calculateRotation(input(value), thresholds).state).toBe(expected));
  test("uses approved 30/20/20/15/15 weights", () => {
    const result = calculateRotation({ healthMomentum: 100, breadthMomentum: 50, relativeStrength: 0, volumeExpansion: 0, oiConfirmation: 0 }, thresholds);
    expect(result.score).toBe(40);
  });
  test("missing OI is unavailable and never fabricated", () => {
    const result = calculateRotation({ ...input(50), oiConfirmation: null }, thresholds);
    expect(result.score).toBeNull();
    expect(result.availabilityState).toBe("MISSING");
  });
  test("rejects non-descending thresholds", () => {
    expect(() => calculateRotation(input(50), { acceleratingMin: 40, inflowMin: 60, stableMin: 30, deceleratingMin: 20 })).toThrow();
  });
  test.each([[80, "ACCELERATING"], [60, "INFLOW"], [40, "STABLE"], [20, "DECELERATING"], [19.99, "OUTFLOW"]] as const)("uses exact boundary %s", (value, expected) => expect(calculateRotation(input(value), thresholds).state).toBe(expected));
  test("rejects invalid normalized inputs and non-finite thresholds", () => {
    expect(calculateRotation(input(101), thresholds).availabilityState).toBe("INVALID");
    expect(calculateRotation(input(-1), thresholds).availabilityState).toBe("INVALID");
    expect(() => calculateRotation(input(50), { ...thresholds, acceleratingMin: Number.NaN })).toThrow();
  });
  test("is deterministic and enforces rotation/1 context", () => {
    expect(calculateRotation(input(50), thresholds)).toEqual(calculateRotation({ ...input(50) }, { ...thresholds }));
    const window = resolveP3Window("7D", new Date("2026-08-09T00:00:00Z"));
    const context = createCalculationContext({ narrativeId: 1, calculationMode: "observed", window: "7D", windowStart: window.windowStart, windowEnd: window.windowEnd, calculatedAt: new Date("2026-08-09T01:00:00Z"), algorithmKey: "wrong", algorithmVersion: "1", constituents: [], sourceAvailability: {} });
    expect(() => calculateRotationResult(context, input(50), thresholds)).toThrow("rotation/1");
  });
});

describe("P3-10A Component Normalization", () => {
  describe("Health Momentum normalization", () => {
    test("maps -20 health points to 0", () => {
      expect(normalizeHealthMomentum(-20)).toBe(0);
    });
    test("maps 0 health points to 50", () => {
      expect(normalizeHealthMomentum(0)).toBe(50);
    });
    test("maps +20 health points to 100", () => {
      expect(normalizeHealthMomentum(20)).toBe(100);
    });
    test("clips below -20 to 0", () => {
      expect(normalizeHealthMomentum(-25)).toBe(0);
    });
    test("clips above +20 to 100", () => {
      expect(normalizeHealthMomentum(25)).toBe(100);
    });
    test("handles positive change", () => {
      expect(normalizeHealthMomentum(10)).toBe(75);
    });
    test("handles negative change", () => {
      expect(normalizeHealthMomentum(-10)).toBe(25);
    });
  });

  describe("Breadth Momentum normalization", () => {
    test("maps -1.0 breadth change to 0", () => {
      expect(normalizeBreadthMomentum(-1.0)).toBe(0);
    });
    test("maps 0 breadth change to 50", () => {
      expect(normalizeBreadthMomentum(0)).toBe(50);
    });
    test("maps +1.0 breadth change to 100", () => {
      expect(normalizeBreadthMomentum(1.0)).toBe(100);
    });
    test("clips below -1.0 to 0", () => {
      expect(normalizeBreadthMomentum(-1.5)).toBe(0);
    });
    test("clips above +1.0 to 100", () => {
      expect(normalizeBreadthMomentum(1.5)).toBe(100);
    });
    test("handles partial breadth gain", () => {
      expect(normalizeBreadthMomentum(0.5)).toBe(75);
    });
    test("handles partial breadth loss", () => {
      expect(normalizeBreadthMomentum(-0.5)).toBe(25);
    });
  });

  describe("Relative Strength normalization", () => {
    test("maps -10% RS to 0", () => {
      expect(normalizeRelativeStrength(-0.10)).toBe(0);
    });
    test("maps -5% RS to 25", () => {
      expect(normalizeRelativeStrength(-0.05)).toBe(25);
    });
    test("maps 0% RS to 50", () => {
      expect(normalizeRelativeStrength(0)).toBe(50);
    });
    test("maps +5% RS to 75", () => {
      expect(normalizeRelativeStrength(0.05)).toBe(75);
    });
    test("maps +10% RS to 100", () => {
      expect(normalizeRelativeStrength(0.10)).toBe(100);
    });
    test("clips below -10% to 0", () => {
      expect(normalizeRelativeStrength(-0.15)).toBe(0);
    });
    test("clips above +10% to 100", () => {
      expect(normalizeRelativeStrength(0.15)).toBe(100);
    });
  });

  describe("Volume Expansion normalization", () => {
    test("maps 0.0x volume ratio to 0", () => {
      expect(normalizeVolumeExpansion(0.0)).toBe(0);
    });
    test("maps 0.5x volume ratio to 25", () => {
      expect(normalizeVolumeExpansion(0.5)).toBe(25);
    });
    test("maps 1.0x volume ratio to 50", () => {
      expect(normalizeVolumeExpansion(1.0)).toBe(50);
    });
    test("maps 1.5x volume ratio to 75", () => {
      expect(normalizeVolumeExpansion(1.5)).toBe(75);
    });
    test("maps 2.0x volume ratio to 100", () => {
      expect(normalizeVolumeExpansion(2.0)).toBe(100);
    });
    test("clips above 2.0x to 100", () => {
      expect(normalizeVolumeExpansion(3.0)).toBe(100);
    });
  });

  describe("OI Confirmation matrix", () => {
    test("Price + OI + = 100 (strong positive confirmation)", () => {
      expect(calculateOIConfirmation(1, 1)).toBe(100);
    });
    test("Price + OI 0 = 75", () => {
      expect(calculateOIConfirmation(1, 0)).toBe(75);
    });
    test("Price + OI - = 50 (not positive OI confirmation)", () => {
      expect(calculateOIConfirmation(1, -1)).toBe(50);
    });
    test("Price 0 OI + = 50", () => {
      expect(calculateOIConfirmation(0, 1)).toBe(50);
    });
    test("Price 0 OI 0 = 50", () => {
      expect(calculateOIConfirmation(0, 0)).toBe(50);
    });
    test("Price 0 OI - = 50", () => {
      expect(calculateOIConfirmation(0, -1)).toBe(50);
    });
    test("Price - OI + = 0 (strong negative confirmation)", () => {
      expect(calculateOIConfirmation(-1, 1)).toBe(0);
    });
    test("Price - OI 0 = 25", () => {
      expect(calculateOIConfirmation(-1, 0)).toBe(25);
    });
    test("Price - OI - = 50 (no directional OI confirmation)", () => {
      expect(calculateOIConfirmation(-1, -1)).toBe(50);
    });
  });

  describe("Direction helper", () => {
    test("positive value returns positive direction", () => {
      expect(getDirection(1)).toBe("positive");
      expect(getDirection(0.001)).toBe("positive");
    });
    test("negative value returns negative direction", () => {
      expect(getDirection(-1)).toBe("negative");
      expect(getDirection(-0.001)).toBe("negative");
    });
    test("zero returns zero direction", () => {
      expect(getDirection(0)).toBe("zero");
    });
  });
});

describe("P3-10A Missing Data Semantics", () => {
  test("missing any component makes Rotation UNAVAILABLE", () => {
    const result = calculateRotation({ healthMomentum: 50, breadthMomentum: 50, relativeStrength: 50, volumeExpansion: 50, oiConfirmation: null }, thresholds);
    expect(result.score).toBeNull();
    expect(result.state).toBeNull();
    expect(result.availabilityState).toBe("MISSING");
  });

  test("no weight redistribution when component missing", () => {
    const result = calculateRotation({ healthMomentum: 50, breadthMomentum: 50, relativeStrength: 50, volumeExpansion: null, oiConfirmation: 50 }, thresholds);
    expect(result.score).toBeNull();
    // Should NOT be (50*0.3 + 50*0.2 + 50*0.2 + 50*0.15) / 0.85
    expect(result.availabilityState).toBe("MISSING");
  });

  test("multiple missing components remain UNAVAILABLE", () => {
    const result = calculateRotation({ healthMomentum: 50, breadthMomentum: null, relativeStrength: null, volumeExpansion: 50, oiConfirmation: 50 }, thresholds);
    expect(result.score).toBeNull();
    expect(result.availabilityState).toBe("MISSING");
  });

  test("all components present produces valid score", () => {
    const result = calculateRotation({ healthMomentum: 80, breadthMomentum: 60, relativeStrength: 40, volumeExpansion: 70, oiConfirmation: 50 }, thresholds);
    expect(result.score).toBeCloseTo(80 * 0.3 + 60 * 0.2 + 40 * 0.2 + 70 * 0.15 + 50 * 0.15);
    expect(result.availabilityState).toBe("VALID");
  });
});
