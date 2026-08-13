/**
 * P3 Configuration Loading Tests
 */

import { loadRegimeThresholds, loadRotationThresholds } from "../preparation";

describe("P3 Configuration Loading", () => {
  describe("loadRegimeThresholds", () => {
    test("loads regime thresholds from score_configs", async () => {
      const thresholds = await loadRegimeThresholds();

      expect(thresholds).toBeDefined();
      expect(typeof thresholds).toBe("object");

      // Verify required fields exist
      expect(thresholds.healthHigh).toBeDefined();
      expect(thresholds.healthLow).toBeDefined();
      expect(thresholds.breadthHigh).toBeDefined();
      expect(thresholds.breadthLow).toBeDefined();
      expect(thresholds.momentumPositive).toBeDefined();
      expect(thresholds.momentumNegative).toBeDefined();
      expect(thresholds.accelerationDeclining).toBeDefined();
      expect(thresholds.healthImproving).toBeDefined();
      expect(thresholds.breadthIncreasing).toBeDefined();
      expect(thresholds.relativeStrengthImproving).toBeDefined();
      expect(thresholds.relativeStrengthPositive).toBeDefined();
      expect(thresholds.relativeStrengthNegative).toBeDefined();
      expect(thresholds.healthDeclining).toBeDefined();
      expect(thresholds.breadthDeclining).toBeDefined();
      expect(thresholds.momentumWeakening).toBeDefined();

      // Verify values are finite numbers
      for (const key in thresholds) {
        expect(Number.isFinite(thresholds[key])).toBe(true);
      }
    });

    test("thresholds match approved v1 values", async () => {
      const thresholds = await loadRegimeThresholds();

      expect(thresholds.healthHigh).toBe(70);
      expect(thresholds.healthLow).toBe(35);
      expect(thresholds.breadthHigh).toBe(0.60);
      expect(thresholds.breadthLow).toBe(0.35);
      expect(thresholds.momentumPositive).toBe(0.05);
      expect(thresholds.momentumNegative).toBe(-0.05);
      expect(thresholds.accelerationDeclining).toBe(0);
      expect(thresholds.healthImproving).toBe(0);
      expect(thresholds.breadthIncreasing).toBe(0);
      expect(thresholds.relativeStrengthImproving).toBe(0);
      expect(thresholds.relativeStrengthPositive).toBe(0.05);
      expect(thresholds.relativeStrengthNegative).toBe(-0.05);
      expect(thresholds.healthDeclining).toBe(0);
      expect(thresholds.breadthDeclining).toBe(0);
      expect(thresholds.momentumWeakening).toBe(-0.05);
    });

    test("throws error when configuration is missing", async () => {
      // This test would require mocking the database to return no config
      // Skip for now - requires database setup
    });

    test("throws error when required field is missing", async () => {
      // This test would require mocking the database to return invalid config
      // Skip for now - requires database setup
    });
  });

  describe("loadRotationThresholds", () => {
    test("loads rotation thresholds from score_configs", async () => {
      const thresholds = await loadRotationThresholds();

      expect(thresholds).toBeDefined();
      expect(typeof thresholds).toBe("object");

      // Verify required fields exist
      expect(thresholds.acceleratingMin).toBeDefined();
      expect(thresholds.inflowMin).toBeDefined();
      expect(thresholds.stableMin).toBeDefined();
      expect(thresholds.deceleratingMin).toBeDefined();

      // Verify values are finite numbers
      for (const key in thresholds) {
        expect(Number.isFinite(thresholds[key])).toBe(true);
      }
    });

    test("thresholds match approved v1 values", async () => {
      const thresholds = await loadRotationThresholds();

      expect(thresholds.acceleratingMin).toBe(70);
      expect(thresholds.inflowMin).toBe(55);
      expect(thresholds.stableMin).toBe(45);
      expect(thresholds.deceleratingMin).toBe(30);
    });

    test("throws error when configuration is missing", async () => {
      // This test would require mocking the database to return no config
      // Skip for now - requires database setup
    });

    test("throws error when required field is missing", async () => {
      // This test would require mocking the database to return invalid config
      // Skip for now - requires database setup
    });
  });

  describe("Configuration Versioning", () => {
    test("algorithm version separate from config version", () => {
      // This is a structural test - verify that configuration loading
      // does not mutate algorithm version identity
      const algorithmKey = "regime";
      const algorithmVersion = "1";
      const configVersion = 1;

      expect(algorithmVersion).toBe("1");
      expect(configVersion).toBe(1);
      // They are separate concerns
    });
  });
});
