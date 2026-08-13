/**
 * P3-10E.31 — Metric Extraction Regression Tests
 *
 * Verifies that the orchestrator's extractMetricValue helper
 * consumes canonical metric keys and does not silently accept
 * legacy/incorrect underscore-prefixed names.
 */

import { extractMetricValue } from "../orchestrator";
import type { P3CalculationResult, P3MetricResult } from "../context";

function makeResult(metrics: Record<string, P3MetricResult<number | string>>): P3CalculationResult {
  return {
    narrativeId: 1,
    windowStart: new Date("2026-08-03T00:00:00.000Z"),
    windowEnd: new Date("2026-08-11T00:00:00.000Z"),
    algorithmKey: "test",
    algorithmVersion: "1",
    calculationMode: "observed",
    availabilityState: "VALID",
    confidence: null,
    metrics,
    provenance: {},
  };
}

describe("P3-10E.31 extractMetricValue regression", () => {
  test("extracts canonical momentum7d", () => {
    const result = makeResult({
      momentum7d: { metric: "momentum7d", value: 14.03, state: "VALID" },
    });
    expect(extractMetricValue(result, "momentum7d")).toBe(14.03);
  });

  test("extracts canonical relativeStrength7d", () => {
    const result = makeResult({
      relativeStrength7d: { metric: "relativeStrength7d", value: -0.0112, state: "VALID" },
    });
    expect(extractMetricValue(result, "relativeStrength7d")).toBe(-0.0112);
  });

  test("rejects legacy underscore-prefixed momentum_7d", () => {
    const result = makeResult({
      momentum7d: { metric: "momentum7d", value: 14.03, state: "VALID" },
    });
    expect(extractMetricValue(result, "momentum_7d")).toBeNull();
  });

  test("rejects legacy underscore-prefixed relativeStrength_7d", () => {
    const result = makeResult({
      relativeStrength7d: { metric: "relativeStrength7d", value: -0.0112, state: "VALID" },
    });
    expect(extractMetricValue(result, "relativeStrength_7d")).toBeNull();
  });

  test("returns null when canonical metric is genuinely absent", () => {
    const result = makeResult({
      momentum1d: { metric: "momentum1d", value: -1.31, state: "VALID" },
    });
    expect(extractMetricValue(result, "momentum7d")).toBeNull();
  });

  test("returns null when metric state is not VALID", () => {
    const result = makeResult({
      momentum7d: { metric: "momentum7d", value: null, state: "MISSING" },
    });
    expect(extractMetricValue(result, "momentum7d")).toBeNull();
  });

  test("returns null when metric value is null", () => {
    const result = makeResult({
      momentum7d: { metric: "momentum7d", value: null, state: "VALID" },
    });
    expect(extractMetricValue(result, "momentum7d")).toBeNull();
  });

  test("parses string metric values to numbers", () => {
    const result = makeResult({
      momentum7d: { metric: "momentum7d", value: "14.03", state: "VALID" },
    });
    expect(extractMetricValue(result, "momentum7d")).toBe(14.03);
  });

  test("returns null for non-numeric string values", () => {
    const result = makeResult({
      momentum7d: { metric: "momentum7d", value: "not-a-number", state: "VALID" },
    });
    expect(extractMetricValue(result, "momentum7d")).toBeNull();
  });
});
