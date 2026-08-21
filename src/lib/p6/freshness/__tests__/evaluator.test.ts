// P6 Freshness Evaluator — Unit Tests
// Frozen contract: P6-01C-C (commit 6179135)
//
// TEST FIXTURES ONLY — no production threshold values are used.
// All test values are explicitly named and isolated.

import {
  evaluateFreshness,
  resolvePolicy,
  evaluateObservationFreshness,
  validatePolicy,
} from "../evaluator";
import type {
  FreshnessPolicy,
  PolicyIdentity,
  FreshnessEvaluationResult,
} from "../types";

// ============================================================
// Test Fixtures — explicitly named, not production values
// ============================================================

const TEST_STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour — TEST ONLY
const TEST_EXPECTED_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes — TEST ONLY

const TEST_POLICY: FreshnessPolicy = {
  sourceId: "BINANCE_SPOT",
  metric: "CLOSE",
  timeframe: "DAILY",
  expectedIntervalMs: TEST_EXPECTED_INTERVAL_MS,
  staleAfterMs: TEST_STALE_AFTER_MS,
  configVersion: 1,
  description: "TEST FIXTURE — not a production value",
};

const TEST_IDENTITY: PolicyIdentity = {
  sourceId: "BINANCE_SPOT",
  metric: "CLOSE",
  timeframe: "DAILY",
  configVersion: 1,
};

// ============================================================
// POLICY RESOLUTION TESTS
// ============================================================

describe("Policy Resolution", () => {
  test("valid policy resolves", () => {
    const result = resolvePolicy(TEST_IDENTITY, [TEST_POLICY]);
    expect(result.found).toBe(true);
    expect(result.policy).toEqual(TEST_POLICY);
  });

  test("policy identity is deterministic", () => {
    const r1 = resolvePolicy(TEST_IDENTITY, [TEST_POLICY]);
    const r2 = resolvePolicy(TEST_IDENTITY, [TEST_POLICY]);
    expect(r1.found).toBe(r2.found);
    expect(r1.policy).toEqual(r2.policy);
  });

  test("missing policy returns found: false", () => {
    const result = resolvePolicy(TEST_IDENTITY, []);
    expect(result.found).toBe(false);
    expect(result.error).toContain("No freshness policy found");
  });

  test("duplicate policy fails deterministically", () => {
    const duplicate: FreshnessPolicy = { ...TEST_POLICY };
    const result = resolvePolicy(TEST_IDENTITY, [TEST_POLICY, duplicate]);
    expect(result.found).toBe(false);
    expect(result.error).toContain("Duplicate");
  });

  test("config_version participates in lookup", () => {
    const wrongVersion: PolicyIdentity = {
      ...TEST_IDENTITY,
      configVersion: 999,
    };
    const result = resolvePolicy(wrongVersion, [TEST_POLICY]);
    expect(result.found).toBe(false);
  });

  test("source mismatch → not found", () => {
    const wrongSource: PolicyIdentity = {
      ...TEST_IDENTITY,
      sourceId: "COINGECKO",
    };
    const result = resolvePolicy(wrongSource, [TEST_POLICY]);
    expect(result.found).toBe(false);
  });

  test("metric mismatch → not found", () => {
    const wrongMetric: PolicyIdentity = {
      ...TEST_IDENTITY,
      metric: "VOLUME",
    };
    const result = resolvePolicy(wrongMetric, [TEST_POLICY]);
    expect(result.found).toBe(false);
  });

  test("timeframe mismatch → not found", () => {
    const wrongTimeframe: PolicyIdentity = {
      ...TEST_IDENTITY,
      timeframe: "4H",
    };
    const result = resolvePolicy(wrongTimeframe, [TEST_POLICY]);
    expect(result.found).toBe(false);
  });
});

// ============================================================
// OBSERVED_AT TESTS
// ============================================================

describe("Observed At Handling", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");

  test("valid observed_at works", () => {
    const observedAt = new Date("2026-08-21T11:30:00.000Z"); // 30 min ago
    const result = evaluateFreshness({
      observedAt,
      observedAtIsUnknown: false,
      evaluationTime: now,
      policy: TEST_POLICY,
    });
    expect(result.status).toBe("FRESH");
    expect(result.observedAt).toEqual(observedAt);
    expect(result.ageMs).toBe(30 * 60 * 1000);
  });

  test("UNKNOWN observed_at → UNKNOWN", () => {
    const result = evaluateFreshness({
      observedAt: null,
      observedAtIsUnknown: true,
      evaluationTime: now,
      policy: TEST_POLICY,
    });
    expect(result.status).toBe("UNKNOWN");
    expect(result.observedAt).toBeNull();
    expect(result.ageMs).toBeNull();
    expect(result.reason).toContain("UNKNOWN");
  });

  test("null observed_at (without explicit UNKNOWN flag) → UNKNOWN", () => {
    const result = evaluateFreshness({
      observedAt: null,
      observedAtIsUnknown: false,
      evaluationTime: now,
      policy: TEST_POLICY,
    });
    expect(result.status).toBe("UNKNOWN");
  });

  test("collected_at never substitutes observed_at", () => {
    // The evaluator only accepts observedAt — there is no collectedAt parameter.
    // This test verifies the API does not expose collected_at.
    const result = evaluateFreshness({
      observedAt: null,
      observedAtIsUnknown: true,
      evaluationTime: now,
      policy: TEST_POLICY,
    });
    // If collected_at were used, status would not be UNKNOWN.
    expect(result.status).toBe("UNKNOWN");
    expect(result.reason).toContain("observed_at");
  });
});

// ============================================================
// FRESHNESS EVALUATION TESTS
// ============================================================

describe("Freshness Evaluation", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");

  test("age = 0 → FRESH", () => {
    const result = evaluateFreshness({
      observedAt: now,
      observedAtIsUnknown: false,
      evaluationTime: now,
      policy: TEST_POLICY,
    });
    expect(result.status).toBe("FRESH");
    expect(result.ageMs).toBe(0);
  });

  test("age below expected_interval → FRESH", () => {
    const observedAt = new Date("2026-08-21T11:45:00.000Z"); // 15 min ago
    const result = evaluateFreshness({
      observedAt,
      observedAtIsUnknown: false,
      evaluationTime: now,
      policy: TEST_POLICY,
    });
    expect(result.status).toBe("FRESH");
    expect(result.ageMs).toBe(15 * 60 * 1000);
  });

  test("age at expected_interval → FRESH (expected_interval is informational)", () => {
    const observedAt = new Date("2026-08-21T11:30:00.000Z"); // 30 min ago = expected_interval
    const result = evaluateFreshness({
      observedAt,
      observedAtIsUnknown: false,
      evaluationTime: now,
      policy: TEST_POLICY,
    });
    expect(result.status).toBe("FRESH");
    expect(result.ageMs).toBe(TEST_EXPECTED_INTERVAL_MS);
  });

  test("age between expected_interval and stale_after → FRESH", () => {
    const observedAt = new Date("2026-08-21T11:15:00.000Z"); // 45 min ago
    const result = evaluateFreshness({
      observedAt,
      observedAtIsUnknown: false,
      evaluationTime: now,
      policy: TEST_POLICY,
    });
    expect(result.status).toBe("FRESH");
    expect(result.ageMs).toBe(45 * 60 * 1000);
  });

  test("age at stale_after → FRESH (boundary: age <= stale_after)", () => {
    const observedAt = new Date("2026-08-21T11:00:00.000Z"); // exactly 1h ago
    const result = evaluateFreshness({
      observedAt,
      observedAtIsUnknown: false,
      evaluationTime: now,
      policy: TEST_POLICY,
    });
    expect(result.status).toBe("FRESH");
    expect(result.ageMs).toBe(TEST_STALE_AFTER_MS);
  });

  test("age above stale_after → STALE", () => {
    const observedAt = new Date("2026-08-21T10:59:00.000Z"); // 61 min ago
    const result = evaluateFreshness({
      observedAt,
      observedAtIsUnknown: false,
      evaluationTime: now,
      policy: TEST_POLICY,
    });
    expect(result.status).toBe("STALE");
    expect(result.ageMs).toBe(61 * 60 * 1000);
  });

  test("age significantly above stale_after → STALE", () => {
    const observedAt = new Date("2026-08-20T12:00:00.000Z"); // 24h ago
    const result = evaluateFreshness({
      observedAt,
      observedAtIsUnknown: false,
      evaluationTime: now,
      policy: TEST_POLICY,
    });
    expect(result.status).toBe("STALE");
    expect(result.ageMs).toBe(24 * 60 * 60 * 1000);
  });
});

// ============================================================
// TEMPORAL BOUNDARY TESTS
// ============================================================

describe("Temporal Boundaries", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");

  test("future observed_at → FRESH per comparison semantics", () => {
    // Future observed_at means age is negative.
    // Negative age is always <= stale_after (since stale_after > 0).
    // Per the frozen contract comparison: age <= stale_after → FRESH.
    // If this behavior needs to change → PLANNER DECISION REQUIRED.
    const futureObservedAt = new Date("2026-08-21T13:00:00.000Z"); // 1h in future
    const result = evaluateFreshness({
      observedAt: futureObservedAt,
      observedAtIsUnknown: false,
      evaluationTime: now,
      policy: TEST_POLICY,
    });
    expect(result.status).toBe("FRESH");
    expect(result.ageMs).toBe(-60 * 60 * 1000);
  });

  test("no AGING state exists", () => {
    const result = evaluateFreshness({
      observedAt: new Date("2026-08-21T11:30:00.000Z"),
      observedAtIsUnknown: false,
      evaluationTime: now,
      policy: TEST_POLICY,
    });
    expect(result.status).not.toBe("AGING");
    expect(["FRESH", "STALE", "UNKNOWN"]).toContain(result.status);
  });

  test("no invented state — only FRESH/STALE/UNKNOWN", () => {
    const statuses: string[] = [];
    // Evaluate at various ages
    for (let minutesAgo = 0; minutesAgo <= 120; minutesAgo += 5) {
      const observedAt = new Date(now.getTime() - minutesAgo * 60 * 1000);
      const result = evaluateFreshness({
        observedAt,
        observedAtIsUnknown: false,
        evaluationTime: now,
        policy: TEST_POLICY,
      });
      statuses.push(result.status);
    }
    const uniqueStatuses = new Set(statuses);
    expect(uniqueStatuses.size).toBeLessThanOrEqual(2); // Only FRESH and/or STALE
    for (const s of uniqueStatuses) {
      expect(["FRESH", "STALE"]).toContain(s);
    }
  });
});

// ============================================================
// MISSING POLICY TESTS
// ============================================================

describe("Missing Policy", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");

  test("missing policy → UNKNOWN (not FRESH, not STALE)", () => {
    const result = evaluateFreshness({
      observedAt: new Date("2026-08-21T11:30:00.000Z"),
      observedAtIsUnknown: false,
      evaluationTime: now,
      policy: null,
    });
    expect(result.status).toBe("UNKNOWN");
    expect(result.policy).toBeNull();
    expect(result.reason).toContain("No freshness policy");
  });

  test("missing policy does not default to FRESH", () => {
    const result = evaluateFreshness({
      observedAt: new Date("2026-08-21T11:59:00.000Z"), // 1 min ago — very fresh
      observedAtIsUnknown: false,
      evaluationTime: now,
      policy: null,
    });
    expect(result.status).not.toBe("FRESH");
  });

  test("missing policy does not default to STALE", () => {
    const result = evaluateFreshness({
      observedAt: new Date("2026-08-20T12:00:00.000Z"), // 24h ago — very stale
      observedAtIsUnknown: false,
      evaluationTime: now,
      policy: null,
    });
    expect(result.status).not.toBe("STALE");
  });
});

// ============================================================
// SOURCE PRIORITY / FALLBACK TESTS
// ============================================================

describe("No Source Priority / No Fallback", () => {
  test("source is not automatically replaced", () => {
    const binancePolicy: FreshnessPolicy = {
      ...TEST_POLICY,
      sourceId: "BINANCE_SPOT",
    };
    const coingeckoPolicy: FreshnessPolicy = {
      ...TEST_POLICY,
      sourceId: "COINGECKO",
    };

    // Looking for BINANCE_SPOT should not find COINGECKO's policy
    const result = resolvePolicy(
      { ...TEST_IDENTITY, sourceId: "BINANCE_SPOT" },
      [coingeckoPolicy] // Only COINGECKO policy available
    );
    expect(result.found).toBe(false);
  });

  test("no priority between multiple source policies", () => {
    const spotPolicy: FreshnessPolicy = {
      ...TEST_POLICY,
      sourceId: "BINANCE_SPOT",
    };
    const futuresPolicy: FreshnessPolicy = {
      ...TEST_POLICY,
      sourceId: "BINANCE_FUTURES",
    };

    // Each source has its own independent policy
    const spotResult = resolvePolicy(
      { ...TEST_IDENTITY, sourceId: "BINANCE_SPOT" },
      [spotPolicy, futuresPolicy]
    );
    const futuresResult = resolvePolicy(
      { ...TEST_IDENTITY, sourceId: "BINANCE_FUTURES" },
      [spotPolicy, futuresPolicy]
    );

    expect(spotResult.found).toBe(true);
    expect(spotResult.policy!.sourceId).toBe("BINANCE_SPOT");
    expect(futuresResult.found).toBe(true);
    expect(futuresResult.policy!.sourceId).toBe("BINANCE_FUTURES");
  });
});

// ============================================================
// POLICY VALIDATION TESTS
// ============================================================

describe("Policy Validation", () => {
  test("valid policy passes validation", () => {
    const result = validatePolicy(TEST_POLICY);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("policy with zero stale_after fails validation", () => {
    const result = validatePolicy({ ...TEST_POLICY, staleAfterMs: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("staleAfterMs")
    );
  });

  test("policy with negative expected_interval fails validation", () => {
    const result = validatePolicy({ ...TEST_POLICY, expectedIntervalMs: -1 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("expectedIntervalMs")
    );
  });

  test("policy with zero config_version fails validation", () => {
    const result = validatePolicy({ ...TEST_POLICY, configVersion: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("configVersion")
    );
  });
});

// ============================================================
// INTEGRATION: evaluateObservationFreshness
// ============================================================

describe("evaluateObservationFreshness (combined)", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");

  test("resolves policy and evaluates freshness", () => {
    const result = evaluateObservationFreshness({
      sourceId: "BINANCE_SPOT",
      metric: "CLOSE",
      timeframe: "DAILY",
      configVersion: 1,
      observedAt: new Date("2026-08-21T11:30:00.000Z"),
      observedAtIsUnknown: false,
      evaluationTime: now,
      availablePolicies: [TEST_POLICY],
    });
    expect(result.status).toBe("FRESH");
    expect(result.policy).toEqual(TEST_POLICY);
  });

  test("UNKNOWN observed_at with available policy → UNKNOWN", () => {
    const result = evaluateObservationFreshness({
      sourceId: "BINANCE_SPOT",
      metric: "CLOSE",
      timeframe: "DAILY",
      configVersion: 1,
      observedAt: null,
      observedAtIsUnknown: true,
      evaluationTime: now,
      availablePolicies: [TEST_POLICY],
    });
    expect(result.status).toBe("UNKNOWN");
  });

  test("no matching policy → UNKNOWN", () => {
    const result = evaluateObservationFreshness({
      sourceId: "BINANCE_SPOT",
      metric: "CLOSE",
      timeframe: "DAILY",
      configVersion: 999, // Wrong version
      observedAt: new Date("2026-08-21T11:30:00.000Z"),
      observedAtIsUnknown: false,
      evaluationTime: now,
      availablePolicies: [TEST_POLICY],
    });
    expect(result.status).toBe("UNKNOWN");
    expect(result.policy).toBeNull();
  });
});
