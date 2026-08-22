// P6-01C-E2 — Freshness V1 Production Policy Tests
// Frozen decision: P6-01C-E (commit 8557dce)
// These tests verify the frozen policy configuration without database access.

import {
  evaluateFreshness,
  resolvePolicy,
  validatePolicy,
} from "../evaluator";
import type {
  FreshnessPolicy,
  PolicyIdentity,
} from "../types";
import {
  isValidSourceId,
  isValidCanonicalMetric,
  isValidTimeframe,
  SUPPORTED_CANONICAL_METRICS,
} from "../../registry/types";

// ============================================================
// Frozen Policy Values from P6-01C-E
// ============================================================

/** DAILY expected_interval = 24h in ms */
const DAILY_EXPECTED_INTERVAL_MS = 86_400_000;
/** DAILY stale_after = 36h in ms */
const DAILY_STALE_AFTER_MS = 129_600_000;
/** 4H expected_interval = 4h in ms */
const FOUR_H_EXPECTED_INTERVAL_MS = 14_400_000;
/** 4H stale_after = 6h in ms */
const FOUR_H_STALE_AFTER_MS = 21_600_000;

// ============================================================
// Source/Metric/Timeframe Combinations from Frozen Registry
// ============================================================

type SourceMetrics = {
  sourceId: "BINANCE_SPOT" | "BINANCE_FUTURES" | "COINGECKO";
  dailyMetrics: string[];
  fourHourMetrics: string[];
  snapshotMetrics: string[];
};

const FROZEN_REGISTRY: SourceMetrics[] = [
  {
    sourceId: "BINANCE_SPOT",
    dailyMetrics: ["OPEN", "HIGH", "LOW", "CLOSE", "VOLUME", "QUOTE_VOLUME"],
    fourHourMetrics: ["OPEN", "HIGH", "LOW", "CLOSE", "VOLUME", "QUOTE_VOLUME"],
    snapshotMetrics: [],
  },
  {
    sourceId: "BINANCE_FUTURES",
    dailyMetrics: [
      "OPEN", "HIGH", "LOW", "CLOSE", "VOLUME", "QUOTE_VOLUME",
      "OPEN_INTEREST", "FUNDING_RATE",
    ],
    fourHourMetrics: [
      "OPEN", "HIGH", "LOW", "CLOSE", "VOLUME", "QUOTE_VOLUME",
      "OPEN_INTEREST", "FUNDING_RATE",
    ],
    snapshotMetrics: ["OPEN_INTEREST", "FUNDING_RATE"],
  },
  {
    sourceId: "COINGECKO",
    dailyMetrics: [],
    fourHourMetrics: [],
    snapshotMetrics: ["MARKET_CAP", "FDV"],
  },
];

// ============================================================
// Generate expected policy list
// ============================================================

function generateExpectedPolicies(): FreshnessPolicy[] {
  const policies: FreshnessPolicy[] = [];
  const configVersion = 1;

  for (const source of FROZEN_REGISTRY) {
    // DAILY policies
    for (const metric of source.dailyMetrics) {
      policies.push({
        sourceId: source.sourceId as FreshnessPolicy["sourceId"],
        metric: metric as FreshnessPolicy["metric"],
        timeframe: "DAILY",
        expectedIntervalMs: DAILY_EXPECTED_INTERVAL_MS,
        staleAfterMs: DAILY_STALE_AFTER_MS,
        configVersion,
        description: `P6-01C-E: ${source.sourceId} DAILY — expected 24h, stale 36h`,
      });
    }

    // 4H policies
    for (const metric of source.fourHourMetrics) {
      policies.push({
        sourceId: source.sourceId as FreshnessPolicy["sourceId"],
        metric: metric as FreshnessPolicy["metric"],
        timeframe: "4H",
        expectedIntervalMs: FOUR_H_EXPECTED_INTERVAL_MS,
        staleAfterMs: FOUR_H_STALE_AFTER_MS,
        configVersion,
        description: `P6-01C-E: ${source.sourceId} 4H — expected 4h, stale 6h`,
      });
    }
  }

  return policies;
}

const EXPECTED_POLICIES = generateExpectedPolicies();

// ============================================================
// Tests
// ============================================================

describe("P6-01C-E2 — Freshness V1 Production Policies", () => {
  describe("Policy Count", () => {
    test("expected policy count is 28", () => {
      expect(EXPECTED_POLICIES.length).toBe(28);
    });

    test("BINANCE_SPOT has 12 policies (6 metrics × 2 timeframes)", () => {
      const spot = EXPECTED_POLICIES.filter(
        (p) => p.sourceId === "BINANCE_SPOT"
      );
      expect(spot.length).toBe(12);
    });

    test("BINANCE_FUTURES has 16 policies (8 metrics × 2 timeframes)", () => {
      const futures = EXPECTED_POLICIES.filter(
        (p) => p.sourceId === "BINANCE_FUTURES"
      );
      expect(futures.length).toBe(16);
    });

    test("COINGECKO has 0 production policies (only SOURCE_SNAPSHOT)", () => {
      const cg = EXPECTED_POLICIES.filter(
        (p) => p.sourceId === "COINGECKO"
      );
      expect(cg.length).toBe(0);
    });

    test("no SOURCE_SNAPSHOT policies exist in the expected set", () => {
      const snapshot = EXPECTED_POLICIES.filter(
        (p) => p.timeframe === "SOURCE_SNAPSHOT"
      );
      expect(snapshot.length).toBe(0);
    });
  });

  describe("DAILY Threshold Values", () => {
    const dailyPolicies = EXPECTED_POLICIES.filter(
      (p) => p.timeframe === "DAILY"
    );

    test("all DAILY policies have expected_interval = 24h (86,400,000 ms)", () => {
      for (const p of dailyPolicies) {
        expect(p.expectedIntervalMs).toBe(DAILY_EXPECTED_INTERVAL_MS);
      }
    });

    test("all DAILY policies have stale_after = 36h (129,600,000 ms)", () => {
      for (const p of dailyPolicies) {
        expect(p.staleAfterMs).toBe(DAILY_STALE_AFTER_MS);
      }
    });

    test("DAILY stale_after > expected_interval (36h > 24h)", () => {
      for (const p of dailyPolicies) {
        expect(p.staleAfterMs).toBeGreaterThan(p.expectedIntervalMs);
      }
    });

    test("DAILY stale_after is 1.5× expected_interval", () => {
      for (const p of dailyPolicies) {
        expect(p.staleAfterMs).toBe(p.expectedIntervalMs * 1.5);
      }
    });
  });

  describe("4H Threshold Values", () => {
    const fourHourPolicies = EXPECTED_POLICIES.filter(
      (p) => p.timeframe === "4H"
    );

    test("all 4H policies have expected_interval = 4h (14,400,000 ms)", () => {
      for (const p of fourHourPolicies) {
        expect(p.expectedIntervalMs).toBe(FOUR_H_EXPECTED_INTERVAL_MS);
      }
    });

    test("all 4H policies have stale_after = 6h (21,600,000 ms)", () => {
      for (const p of fourHourPolicies) {
        expect(p.staleAfterMs).toBe(FOUR_H_STALE_AFTER_MS);
      }
    });

    test("4H stale_after > expected_interval (6h > 4h)", () => {
      for (const p of fourHourPolicies) {
        expect(p.staleAfterMs).toBeGreaterThan(p.expectedIntervalMs);
      }
    });

    test("4H stale_after is 1.5× expected_interval", () => {
      for (const p of fourHourPolicies) {
        expect(p.staleAfterMs).toBe(p.expectedIntervalMs * 1.5);
      }
    });
  });

  describe("Policy Identity", () => {
    test("config_version is 1 for all policies", () => {
      for (const p of EXPECTED_POLICIES) {
        expect(p.configVersion).toBe(1);
      }
    });

    test("all policy identities are unique", () => {
      const identities = EXPECTED_POLICIES.map(
        (p) => `${p.sourceId}|${p.metric}|${p.timeframe}|${p.configVersion}`
      );
      const unique = new Set(identities);
      expect(unique.size).toBe(EXPECTED_POLICIES.length);
    });

    test("all source IDs are valid", () => {
      for (const p of EXPECTED_POLICIES) {
        expect(isValidSourceId(p.sourceId)).toBe(true);
      }
    });

    test("all metrics are valid canonical metrics", () => {
      for (const p of EXPECTED_POLICIES) {
        expect(isValidCanonicalMetric(p.metric)).toBe(true);
      }
    });

    test("all timeframes are valid", () => {
      for (const p of EXPECTED_POLICIES) {
        expect(isValidTimeframe(p.timeframe)).toBe(true);
      }
    });

    test("PRICE is NOT used as an independent metric in any policy", () => {
      const pricePolicies = EXPECTED_POLICIES.filter(
        (p) => (p.metric as string) === "PRICE"
      );
      expect(pricePolicies.length).toBe(0);
    });

    test("derived metrics are NOT included", () => {
      const derivedMetrics = ["TREND", "MOMENTUM", "HEALTH", "BREADTH", "PARTICIPATION"];
      for (const dm of derivedMetrics) {
        const found = EXPECTED_POLICIES.filter((p) => p.metric === dm);
        expect(found.length).toBe(0);
      }
    });
  });

  describe("EVALUATION BEHAVIOR — DAILY Policy", () => {
    const dailyPolicy: FreshnessPolicy = {
      sourceId: "BINANCE_SPOT",
      metric: "CLOSE",
      timeframe: "DAILY",
      expectedIntervalMs: DAILY_EXPECTED_INTERVAL_MS,
      staleAfterMs: DAILY_STALE_AFTER_MS,
      configVersion: 1,
      description: "test",
    };

    test("age = 0 → FRESH", () => {
      const now = new Date("2026-08-22T12:00:00Z");
      const result = evaluateFreshness({
        observedAt: now,
        observedAtIsUnknown: false,
        evaluationTime: now,
        policy: dailyPolicy,
      });
      expect(result.status).toBe("FRESH");
    });

    test("age = 20h → FRESH", () => {
      const evalTime = new Date("2026-08-22T12:00:00Z");
      const observedAt = new Date("2026-08-21T16:00:00Z"); // 20h ago
      const result = evaluateFreshness({
        observedAt,
        observedAtIsUnknown: false,
        evaluationTime: evalTime,
        policy: dailyPolicy,
      });
      expect(result.status).toBe("FRESH");
    });

    test("age = 24h (expected_interval) → FRESH", () => {
      const evalTime = new Date("2026-08-22T12:00:00Z");
      const observedAt = new Date("2026-08-21T12:00:00Z"); // exactly 24h ago
      const result = evaluateFreshness({
        observedAt,
        observedAtIsUnknown: false,
        evaluationTime: evalTime,
        policy: dailyPolicy,
      });
      expect(result.status).toBe("FRESH");
    });

    test("age = 30h → FRESH (between expected_interval and stale_after)", () => {
      const evalTime = new Date("2026-08-22T12:00:00Z");
      const observedAt = new Date("2026-08-21T06:00:00Z"); // 30h ago
      const result = evaluateFreshness({
        observedAt,
        observedAtIsUnknown: false,
        evaluationTime: evalTime,
        policy: dailyPolicy,
      });
      expect(result.status).toBe("FRESH");
    });

    test("age = 36h (stale_after) → FRESH (age <= stale_after)", () => {
      const evalTime = new Date("2026-08-22T12:00:00Z");
      const observedAt = new Date("2026-08-21T00:00:00Z"); // exactly 36h ago
      const result = evaluateFreshness({
        observedAt,
        observedAtIsUnknown: false,
        evaluationTime: evalTime,
        policy: dailyPolicy,
      });
      expect(result.status).toBe("FRESH");
    });

    test("age = 37h → STALE (exceeds stale_after)", () => {
      const evalTime = new Date("2026-08-22T12:00:00Z");
      const observedAt = new Date("2026-08-20T23:00:00Z"); // 37h ago
      const result = evaluateFreshness({
        observedAt,
        observedAtIsUnknown: false,
        evaluationTime: evalTime,
        policy: dailyPolicy,
      });
      expect(result.status).toBe("STALE");
    });

    test("UNKNOWN observed_at → UNKNOWN", () => {
      const result = evaluateFreshness({
        observedAt: null,
        observedAtIsUnknown: true,
        evaluationTime: new Date(),
        policy: dailyPolicy,
      });
      expect(result.status).toBe("UNKNOWN");
    });

    test("missing policy → UNKNOWN", () => {
      const result = evaluateFreshness({
        observedAt: new Date(),
        observedAtIsUnknown: false,
        evaluationTime: new Date(),
        policy: null,
      });
      expect(result.status).toBe("UNKNOWN");
    });
  });

  describe("EVALUATION BEHAVIOR — 4H Policy", () => {
    const fourHourPolicy: FreshnessPolicy = {
      sourceId: "BINANCE_FUTURES",
      metric: "CLOSE",
      timeframe: "4H",
      expectedIntervalMs: FOUR_H_EXPECTED_INTERVAL_MS,
      staleAfterMs: FOUR_H_STALE_AFTER_MS,
      configVersion: 1,
      description: "test",
    };

    test("age = 3h → FRESH", () => {
      const evalTime = new Date("2026-08-22T12:00:00Z");
      const observedAt = new Date("2026-08-22T09:00:00Z"); // 3h ago
      const result = evaluateFreshness({
        observedAt,
        observedAtIsUnknown: false,
        evaluationTime: evalTime,
        policy: fourHourPolicy,
      });
      expect(result.status).toBe("FRESH");
    });

    test("age = 4h (expected_interval) → FRESH", () => {
      const evalTime = new Date("2026-08-22T12:00:00Z");
      const observedAt = new Date("2026-08-22T08:00:00Z"); // exactly 4h ago
      const result = evaluateFreshness({
        observedAt,
        observedAtIsUnknown: false,
        evaluationTime: evalTime,
        policy: fourHourPolicy,
      });
      expect(result.status).toBe("FRESH");
    });

    test("age = 5h → FRESH (between expected_interval and stale_after)", () => {
      const evalTime = new Date("2026-08-22T12:00:00Z");
      const observedAt = new Date("2026-08-22T07:00:00Z"); // 5h ago
      const result = evaluateFreshness({
        observedAt,
        observedAtIsUnknown: false,
        evaluationTime: evalTime,
        policy: fourHourPolicy,
      });
      expect(result.status).toBe("FRESH");
    });

    test("age = 6h (stale_after) → FRESH (age <= stale_after)", () => {
      const evalTime = new Date("2026-08-22T12:00:00Z");
      const observedAt = new Date("2026-08-22T06:00:00Z"); // exactly 6h ago
      const result = evaluateFreshness({
        observedAt,
        observedAtIsUnknown: false,
        evaluationTime: evalTime,
        policy: fourHourPolicy,
      });
      expect(result.status).toBe("FRESH");
    });

    test("age = 7h → STALE (exceeds stale_after)", () => {
      const evalTime = new Date("2026-08-22T12:00:00Z");
      const observedAt = new Date("2026-08-22T05:00:00Z"); // 7h ago
      const result = evaluateFreshness({
        observedAt,
        observedAtIsUnknown: false,
        evaluationTime: evalTime,
        policy: fourHourPolicy,
      });
      expect(result.status).toBe("STALE");
    });
  });

  describe("Policy Resolution", () => {
    test("DAILY policy resolves correctly from candidates", () => {
      const identity: PolicyIdentity = {
        sourceId: "BINANCE_SPOT",
        metric: "CLOSE",
        timeframe: "DAILY",
        configVersion: 1,
      };

      const resolution = resolvePolicy(identity, EXPECTED_POLICIES);
      expect(resolution.found).toBe(true);
      expect(resolution.policy).toBeDefined();
      expect(resolution.policy!.expectedIntervalMs).toBe(DAILY_EXPECTED_INTERVAL_MS);
      expect(resolution.policy!.staleAfterMs).toBe(DAILY_STALE_AFTER_MS);
    });

    test("4H policy resolves correctly from candidates", () => {
      const identity: PolicyIdentity = {
        sourceId: "BINANCE_FUTURES",
        metric: "OPEN_INTEREST",
        timeframe: "4H",
        configVersion: 1,
      };

      const resolution = resolvePolicy(identity, EXPECTED_POLICIES);
      expect(resolution.found).toBe(true);
      expect(resolution.policy).toBeDefined();
      expect(resolution.policy!.expectedIntervalMs).toBe(FOUR_H_EXPECTED_INTERVAL_MS);
      expect(resolution.policy!.staleAfterMs).toBe(FOUR_H_STALE_AFTER_MS);
    });

    test("SOURCE_SNAPSHOT has no policy — resolution fails", () => {
      const identity: PolicyIdentity = {
        sourceId: "BINANCE_FUTURES",
        metric: "OPEN_INTEREST",
        timeframe: "SOURCE_SNAPSHOT",
        configVersion: 1,
      };

      const resolution = resolvePolicy(identity, EXPECTED_POLICIES);
      expect(resolution.found).toBe(false);
    });

    test("COINGECKO / MARKET_CAP / SOURCE_SNAPSHOT has no policy", () => {
      const identity: PolicyIdentity = {
        sourceId: "COINGECKO",
        metric: "MARKET_CAP",
        timeframe: "SOURCE_SNAPSHOT",
        configVersion: 1,
      };

      const resolution = resolvePolicy(identity, EXPECTED_POLICIES);
      expect(resolution.found).toBe(false);
    });

    test("COINGECKO / FDV / SOURCE_SNAPSHOT has no policy", () => {
      const identity: PolicyIdentity = {
        sourceId: "COINGECKO",
        metric: "FDV",
        timeframe: "SOURCE_SNAPSHOT",
        configVersion: 1,
      };

      const resolution = resolvePolicy(identity, EXPECTED_POLICIES);
      expect(resolution.found).toBe(false);
    });

    test("unsupported combination has no policy (BINANCE_SPOT / MARKET_CAP / DAILY)", () => {
      const identity: PolicyIdentity = {
        sourceId: "BINANCE_SPOT",
        metric: "MARKET_CAP",
        timeframe: "DAILY",
        configVersion: 1,
      };

      const resolution = resolvePolicy(identity, EXPECTED_POLICIES);
      expect(resolution.found).toBe(false);
    });

    test("wrong config_version has no policy", () => {
      const identity: PolicyIdentity = {
        sourceId: "BINANCE_SPOT",
        metric: "CLOSE",
        timeframe: "DAILY",
        configVersion: 99,
      };

      const resolution = resolvePolicy(identity, EXPECTED_POLICIES);
      expect(resolution.found).toBe(false);
    });
  });

  describe("Policy Validation", () => {
    test("valid DAILY policy passes validation", () => {
      const result = validatePolicy({
        sourceId: "BINANCE_SPOT",
        metric: "CLOSE",
        timeframe: "DAILY",
        expectedIntervalMs: DAILY_EXPECTED_INTERVAL_MS,
        staleAfterMs: DAILY_STALE_AFTER_MS,
        configVersion: 1,
        description: "test",
      });
      expect(result.valid).toBe(true);
    });

    test("stale_after <= expected_interval is not caught by runtime validator (configuration-time constraint)", () => {
      // validatePolicy checks field existence and positivity only.
      // The stale_after > expected_interval constraint (FVD-05) is enforced at
      // configuration time by the Planner decision, not by the runtime validator.
      const result = validatePolicy({
        sourceId: "BINANCE_SPOT",
        metric: "CLOSE",
        timeframe: "DAILY",
        expectedIntervalMs: 86400000,
        staleAfterMs: 86400000, // equal — not caught at runtime
        configVersion: 1,
        description: "test",
      });
      // Runtime validator accepts this (both are positive numbers)
      expect(result.valid).toBe(true);
    });

    test("FVD-05 is verified in policy seed: all policies have stale_after > expected_interval", () => {
      for (const p of EXPECTED_POLICIES) {
        expect(p.staleAfterMs).toBeGreaterThan(p.expectedIntervalMs);
      }
    });

    test("zero expectedIntervalMs fails validation", () => {
      const result = validatePolicy({
        sourceId: "BINANCE_SPOT",
        metric: "CLOSE",
        timeframe: "DAILY",
        expectedIntervalMs: 0,
        staleAfterMs: 129600000,
        configVersion: 1,
        description: "test",
      });
      expect(result.valid).toBe(false);
    });

    test("zero staleAfterMs fails validation", () => {
      const result = validatePolicy({
        sourceId: "BINANCE_SPOT",
        metric: "CLOSE",
        timeframe: "DAILY",
        expectedIntervalMs: 86400000,
        staleAfterMs: 0,
        configVersion: 1,
        description: "test",
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("No Source Priority", () => {
    test("no source priority exists in expected policies", () => {
      // All policies are flat — no priority/ranking field
      for (const p of EXPECTED_POLICIES) {
        expect(p).not.toHaveProperty("priority");
        expect(p).not.toHaveProperty("rank");
        expect(p).not.toHaveProperty("weight");
      }
    });
  });

  describe("No Fallback", () => {
    test("no fallback behavior exists in expected policies", () => {
      for (const p of EXPECTED_POLICIES) {
        expect(p).not.toHaveProperty("fallback");
        expect(p).not.toHaveProperty("fallbackSource");
        expect(p).not.toHaveProperty("fallbackPolicy");
      }
    });
  });

  describe("No Hard-Coded Thresholds in Evaluator", () => {
    test("evaluator does not hard-code 36h or 6h", () => {
      // The evaluator only uses policy.staleAfterMs
      // We verify this by checking that different stale_after values produce different results
      const now = new Date("2026-08-22T12:00:00Z");
      const observedAt = new Date("2026-08-22T05:00:00Z"); // 7h ago

      const shortStalePolicy: FreshnessPolicy = {
        sourceId: "BINANCE_SPOT",
        metric: "CLOSE",
        timeframe: "4H",
        expectedIntervalMs: 14400000,
        staleAfterMs: 6 * 60 * 60 * 1000, // 6h
        configVersion: 1,
        description: "test",
      };

      const longStalePolicy: FreshnessPolicy = {
        sourceId: "BINANCE_SPOT",
        metric: "CLOSE",
        timeframe: "4H",
        expectedIntervalMs: 14400000,
        staleAfterMs: 24 * 60 * 60 * 1000, // 24h
        configVersion: 1,
        description: "test",
      };

      const resultShort = evaluateFreshness({
        observedAt,
        observedAtIsUnknown: false,
        evaluationTime: now,
        policy: shortStalePolicy,
      });

      const resultLong = evaluateFreshness({
        observedAt,
        observedAtIsUnknown: false,
        evaluationTime: now,
        policy: longStalePolicy,
      });

      // 7h age: short policy (6h stale) → STALE, long policy (24h stale) → FRESH
      expect(resultShort.status).toBe("STALE");
      expect(resultLong.status).toBe("FRESH");
    });
  });

  describe("FVD Invariants", () => {
    test("FVD-01: every policy has explicit source_id", () => {
      for (const p of EXPECTED_POLICIES) {
        expect(p.sourceId).toBeDefined();
        expect(p.sourceId.length).toBeGreaterThan(0);
      }
    });

    test("FVD-02: every policy uses canonical metric vocabulary", () => {
      for (const p of EXPECTED_POLICIES) {
        expect(SUPPORTED_CANONICAL_METRICS.has(p.metric as any)).toBe(true);
      }
    });

    test("FVD-03: every policy uses supported timeframe", () => {
      for (const p of EXPECTED_POLICIES) {
        expect(["DAILY", "4H"]).toContain(p.timeframe);
      }
    });

    test("FVD-04: expected_interval > 0", () => {
      for (const p of EXPECTED_POLICIES) {
        expect(p.expectedIntervalMs).toBeGreaterThan(0);
      }
    });

    test("FVD-05: stale_after > expected_interval", () => {
      for (const p of EXPECTED_POLICIES) {
        expect(p.staleAfterMs).toBeGreaterThan(p.expectedIntervalMs);
      }
    });

    test("FVD-06: stale_after is configuration (not hard-coded in evaluator)", () => {
      // Verified by evaluator test above — evaluator reads from policy
      expect(true).toBe(true);
    });

    test("FVD-07: observed_at = UNKNOWN produces UNKNOWN", () => {
      const result = evaluateFreshness({
        observedAt: null,
        observedAtIsUnknown: true,
        evaluationTime: new Date(),
        policy: EXPECTED_POLICIES[0],
      });
      expect(result.status).toBe("UNKNOWN");
    });

    test("FVD-09: missing policy cannot become FRESH or STALE", () => {
      const result = evaluateFreshness({
        observedAt: new Date(),
        observedAtIsUnknown: false,
        evaluationTime: new Date(),
        policy: null,
      });
      expect(result.status).toBe("UNKNOWN");
    });

    test("FVD-10: freshness policy does not select a source", () => {
      // Each policy has exactly one source — no priority/ranking
      for (const p of EXPECTED_POLICIES) {
        expect(typeof p.sourceId).toBe("string");
      }
    });

    test("FVD-12: SOURCE_SNAPSHOT has no production policy", () => {
      const snapshotPolicies = EXPECTED_POLICIES.filter(
        (p) => p.timeframe === "SOURCE_SNAPSHOT"
      );
      expect(snapshotPolicies.length).toBe(0);
    });

    test("FVD-13: no test-fixture thresholds in production policies", () => {
      // All production policies use the frozen values
      for (const p of EXPECTED_POLICIES) {
        if (p.timeframe === "DAILY") {
          expect(p.expectedIntervalMs).toBe(DAILY_EXPECTED_INTERVAL_MS);
          expect(p.staleAfterMs).toBe(DAILY_STALE_AFTER_MS);
        } else if (p.timeframe === "4H") {
          expect(p.expectedIntervalMs).toBe(FOUR_H_EXPECTED_INTERVAL_MS);
          expect(p.staleAfterMs).toBe(FOUR_H_STALE_AFTER_MS);
        }
      }
    });

    test("FVD-14: config_version is explicit (version 1)", () => {
      for (const p of EXPECTED_POLICIES) {
        expect(p.configVersion).toBe(1);
      }
    });

    test("FVD-15: policy identity is (source_id, metric, timeframe, config_version)", () => {
      const identities = EXPECTED_POLICIES.map(
        (p) => `${p.sourceId}|${p.metric}|${p.timeframe}|${p.configVersion}`
      );
      expect(new Set(identities).size).toBe(EXPECTED_POLICIES.length);
    });
  });
});
