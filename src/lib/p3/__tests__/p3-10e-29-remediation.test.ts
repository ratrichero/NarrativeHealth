/**
 * P3-10E.29 — First Valid Execution Blocker Remediation Tests
 */

import {
  calculateLeadership,
  type LeadershipConstituentInput,
} from "../leadership";
import { calculateRotation, type RotationInputs } from "../rotation";
import { calculateRegimeResult, classifyRegime } from "../regime";

const member = (coinId: number, overrides: Partial<LeadershipConstituentInput> = {}): LeadershipConstituentInput => ({
  coinId,
  marketCapAvailable: true,
  health: 70,
  volumeScore: 60,
  coinReturn7d: 0,
  relativeStrength7d: 0,
  instrument: `C${coinId}USDT`,
  ...overrides,
});

describe("P3-10E.29 Blocker Remediation", () => {
  describe("Blocker A: Leadership RS wiring", () => {
    test("P3-06 valid RS reaches P3-07 and prevents false missing_or_invalid_relative_strength", () => {
      const constituents = [
        member(1, { relativeStrength7d: 0.05 }),
        member(4, { relativeStrength7d: 0.03 }),
        member(5, { relativeStrength7d: 0.02 }),
      ];
      const result = calculateLeadership(constituents);
      expect(result.availabilityState).toBe("VALID");
      expect(result.ranked.length).toBe(3);
      expect(result.excluded).toHaveLength(0);
      expect(result.ranked.map((item) => item.coinId)).toEqual([1, 4, 5]);
    });

    test("all 7 AI constituents receive valid RS where available", () => {
      const aiMembers = [1, 4, 5, 10, 11, 12, 22].map((id) =>
        member(id, { relativeStrength7d: 0.01 * id })
      );
      const result = calculateLeadership(aiMembers);
      expect(result.availabilityState).toBe("VALID");
      expect(result.ranked.length).toBe(7);
      expect(result.excluded).toHaveLength(0);
    });

    test("missing RS still excludes constituent when RS data is absent", () => {
      const constituents = [
        member(1, { relativeStrength7d: 0.05 }),
        member(4, { relativeStrength7d: null }),
        member(5, { relativeStrength7d: 0.02 }),
      ];
      const result = calculateLeadership(constituents);
      expect(result.availabilityState).toBe("INSUFFICIENT_HISTORY");
      expect(result.ranked).toHaveLength(0);
      expect(result.excluded).toContainEqual({ coinId: 4, reason: "missing_or_invalid_relative_strength" });
      expect(result.excluded).toHaveLength(1);
    });
  });

  describe("Blocker B: Historical P3 validity filtering", () => {
    test("Regime first-run when no VALID historical P3 exists", () => {
      const regimeInputs = {
        health: 45,
        healthChange: 2,
        breadth: 0.7,
        breadthChange: null,
        momentum: 50,
        acceleration: 5,
        relativeStrength: 0.03,
        relativeStrengthChange: null,
        confidence: 0.8,
        firstRun: true,
      };
      const result = classifyRegime(regimeInputs, {
        healthHigh: 60,
        healthLow: 40,
        breadthHigh: 0.6,
        breadthLow: 0.4,
        momentumPositive: 0,
        momentumNegative: 0,
        accelerationDeclining: 0,
        healthImproving: 0,
        breadthIncreasing: 0,
        relativeStrengthImproving: -999999,
        healthDeclining: 3,
        breadthDeclining: 1,
        momentumWeakening: 60,
        relativeStrengthPositive: 0,
        relativeStrengthNegative: 0,
      });
      expect(result.availabilityState).toBe("VALID");
      expect(result.regime).not.toBeNull();
      expect(result.provenance).toMatchObject({ firstRun: true, historicalP3BaselineAvailable: false });
    });

    test("Regime does not fabricate null historical changes from invalid artifact", () => {
      const regimeInputs = {
        health: 45,
        healthChange: 2,
        breadth: 0.7,
        breadthChange: null,
        momentum: 50,
        acceleration: 5,
        relativeStrength: 0.03,
        relativeStrengthChange: null,
        confidence: 0.8,
        firstRun: true,
      };
      const result = classifyRegime(regimeInputs, {
        healthHigh: 60,
        healthLow: 40,
        breadthHigh: 0.6,
        breadthLow: 0.4,
        momentumPositive: 0,
        momentumNegative: 0,
        accelerationDeclining: 0,
        healthImproving: 0,
        breadthIncreasing: 0,
        relativeStrengthImproving: -999999,
        healthDeclining: 3,
        breadthDeclining: 1,
        momentumWeakening: 60,
        relativeStrengthPositive: 0,
        relativeStrengthNegative: 0,
      });
      expect(result.provenance.breadthChange).toBeNull();
      expect(result.provenance.relativeStrengthChange).toBeNull();
    });
  });

  describe("Blocker C: Rotation first-run bootstrap", () => {
    test("Rotation becomes VALID on first run when breadthMomentum is the only missing input", () => {
      const inputs: RotationInputs = {
        healthMomentum: 50,
        breadthMomentum: null,
        relativeStrength: 0.03,
        volumeExpansion: 0.2,
        oiConfirmation: 75,
        firstRun: true,
      };
      const result = calculateRotation(inputs, {
        acceleratingMin: 70,
        inflowMin: 55,
        stableMin: 40,
        deceleratingMin: 25,
      });
      expect(result.availabilityState).toBe("VALID");
      expect(result.score).not.toBeNull();
      expect(result.provenance).toMatchObject({ firstRun: true, missingInputs: ["breadthMomentum"] });
    });

    test("Rotation remains MISSING when non-breadthMomentum input is missing even on first run", () => {
      const inputs: RotationInputs = {
        healthMomentum: null,
        breadthMomentum: null,
        relativeStrength: 0.03,
        volumeExpansion: 0.2,
        oiConfirmation: 75,
        firstRun: true,
      };
      const result = calculateRotation(inputs, {
        acceleratingMin: 70,
        inflowMin: 55,
        stableMin: 40,
        deceleratingMin: 25,
      });
      expect(result.availabilityState).toBe("MISSING");
      expect(result.score).toBeNull();
    });

    test("Rotation renormalizes weights when breadthMomentum is missing on first run", () => {
      const inputs: RotationInputs = {
        healthMomentum: 30,
        breadthMomentum: null,
        relativeStrength: 0.03,
        volumeExpansion: 0.2,
        oiConfirmation: 75,
        firstRun: true,
      };
      const result = calculateRotation(inputs, {
        acceleratingMin: 70,
        inflowMin: 55,
        stableMin: 40,
        deceleratingMin: 25,
      });
      expect(result.availabilityState).toBe("VALID");
      const weights = (result.provenance.weights as Record<string, number>) ?? {};
      expect(weights.healthMomentum).toBeCloseTo(0.3 / 0.8);
      expect(weights.relativeStrength).toBeCloseTo(0.2 / 0.8);
      expect(weights.volumeExpansion).toBeCloseTo(0.15 / 0.8);
      expect(weights.oiConfirmation).toBeCloseTo(0.15 / 0.8);
      expect(weights.breadthMomentum).toBeUndefined();
    });

    test("Rotation normal path still works when all inputs present", () => {
      const inputs: RotationInputs = {
        healthMomentum: 50,
        breadthMomentum: 50,
        relativeStrength: 0.03,
        volumeExpansion: 0.2,
        oiConfirmation: 75,
      };
      const result = calculateRotation(inputs, {
        acceleratingMin: 70,
        inflowMin: 55,
        stableMin: 40,
        deceleratingMin: 25,
      });
      expect(result.availabilityState).toBe("VALID");
      expect(result.state).toBe("DECELERATING");
      expect((result.provenance.weights as Record<string, number>)?.healthMomentum).toBe(0.3);
    });
  });
});
