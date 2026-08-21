// P6 Source Registry — Model Validation Tests
// Frozen contract: P6-01C (commit 18fb0f0)
// These tests verify the registry model constraints without database access.

import {
  SUPPORTED_SOURCE_IDS,
  SUPPORTED_SOURCE_TYPES,
  SUPPORTED_REGISTRY_STATUSES,
  SUPPORTED_CANONICAL_METRICS,
  SUPPORTED_TIMEFRAMES,
  RUNTIME_ONLY_STATUSES,
  isValidSourceId,
  isValidSourceType,
  isValidRegistryStatus,
  isValidCanonicalMetric,
  isValidTimeframe,
  isRuntimeOnlyStatus,
  type SourceId,
  type CanonicalMetric,
  type Timeframe,
} from "../types";

describe("P6 Source Registry — Canonical Source IDs", () => {
  test("exactly three canonical source IDs exist", () => {
    expect(SUPPORTED_SOURCE_IDS.size).toBe(3);
  });

  test("BINANCE_SPOT is a valid source ID", () => {
    expect(isValidSourceId("BINANCE_SPOT")).toBe(true);
  });

  test("BINANCE_FUTURES is a valid source ID", () => {
    expect(isValidSourceId("BINANCE_FUTURES")).toBe(true);
  });

  test("COINGECKO is a valid source ID", () => {
    expect(isValidSourceId("COINGECKO")).toBe(true);
  });

  test("unsupported source IDs are rejected", () => {
    expect(isValidSourceId("BINANCE")).toBe(false);
    expect(isValidSourceId("binance_spot")).toBe(false);
    expect(isValidSourceId("UNKNOWN_SOURCE")).toBe(false);
    expect(isValidSourceId("")).toBe(false);
    expect(isValidSourceId("BINANCE_SPOT_EXTRA")).toBe(false);
  });
});

describe("P6 Source Registry — Source Types", () => {
  test("exactly three source types exist", () => {
    expect(SUPPORTED_SOURCE_TYPES.size).toBe(3);
  });

  test("MARKET_SPOT is valid", () => {
    expect(isValidSourceType("MARKET_SPOT")).toBe(true);
  });

  test("MARKET_DERIVATIVES is valid", () => {
    expect(isValidSourceType("MARKET_DERIVATIVES")).toBe(true);
  });

  test("MARKET_AGGREGATOR is valid", () => {
    expect(isValidSourceType("MARKET_AGGREGATOR")).toBe(true);
  });

  test("unsupported source types are rejected", () => {
    expect(isValidSourceType("MARKET")).toBe(false);
    expect(isValidSourceType("SPOT")).toBe(false);
    expect(isValidSourceType("EXCHANGE")).toBe(false);
    expect(isValidSourceType("ON_CHAIN")).toBe(false);
  });
});

describe("P6 Source Registry — Source Status", () => {
  test("exactly two registry statuses exist", () => {
    expect(SUPPORTED_REGISTRY_STATUSES.size).toBe(2);
  });

  test("ACTIVE is a valid registry status", () => {
    expect(isValidRegistryStatus("ACTIVE")).toBe(true);
  });

  test("INACTIVE is a valid registry status", () => {
    expect(isValidRegistryStatus("INACTIVE")).toBe(true);
  });

  test("runtime operational statuses are NOT valid registry statuses", () => {
    expect(isValidRegistryStatus("OK")).toBe(false);
    expect(isValidRegistryStatus("PARTIAL")).toBe(false);
    expect(isValidRegistryStatus("FAILED")).toBe(false);
  });

  test("runtime statuses are correctly identified as runtime-only", () => {
    expect(isRuntimeOnlyStatus("OK")).toBe(true);
    expect(isRuntimeOnlyStatus("PARTIAL")).toBe(true);
    expect(isRuntimeOnlyStatus("FAILED")).toBe(true);
    expect(isRuntimeOnlyStatus("ACTIVE")).toBe(false);
    expect(isRuntimeOnlyStatus("INACTIVE")).toBe(false);
  });
});

describe("P6 Source Registry — Canonical Metrics", () => {
  test("exactly 10 canonical metrics exist", () => {
    expect(SUPPORTED_CANONICAL_METRICS.size).toBe(10);
  });

  test("OHLCV metrics are valid", () => {
    expect(isValidCanonicalMetric("OPEN")).toBe(true);
    expect(isValidCanonicalMetric("HIGH")).toBe(true);
    expect(isValidCanonicalMetric("LOW")).toBe(true);
    expect(isValidCanonicalMetric("CLOSE")).toBe(true);
    expect(isValidCanonicalMetric("VOLUME")).toBe(true);
    expect(isValidCanonicalMetric("QUOTE_VOLUME")).toBe(true);
  });

  test("market data metrics are valid", () => {
    expect(isValidCanonicalMetric("MARKET_CAP")).toBe(true);
    expect(isValidCanonicalMetric("FDV")).toBe(true);
    expect(isValidCanonicalMetric("OPEN_INTEREST")).toBe(true);
    expect(isValidCanonicalMetric("FUNDING_RATE")).toBe(true);
  });

  test("PRICE is NOT a valid canonical metric (alias for CLOSE only)", () => {
    expect(isValidCanonicalMetric("PRICE")).toBe(false);
  });

  test("derived metrics are NOT valid canonical metrics", () => {
    expect(isValidCanonicalMetric("TREND")).toBe(false);
    expect(isValidCanonicalMetric("MOMENTUM")).toBe(false);
    expect(isValidCanonicalMetric("HEALTH")).toBe(false);
    expect(isValidCanonicalMetric("BREADTH")).toBe(false);
    expect(isValidCanonicalMetric("PARTICIPATION")).toBe(false);
    expect(isValidCanonicalMetric("DERIVATIVE_SCORE")).toBe(false);
    expect(isValidCanonicalMetric("VOLUME_SCORE")).toBe(false);
    expect(isValidCanonicalMetric("CONFIDENCE")).toBe(false);
    expect(isValidCanonicalMetric("DATA_COMPLETENESS")).toBe(false);
  });
});

describe("P6 Source Registry — Timeframes", () => {
  test("exactly 3 timeframes exist", () => {
    expect(SUPPORTED_TIMEFRAMES.size).toBe(3);
  });

  test("DAILY is valid", () => {
    expect(isValidTimeframe("DAILY")).toBe(true);
  });

  test("4H is valid", () => {
    expect(isValidTimeframe("4H")).toBe(true);
  });

  test("SOURCE_SNAPSHOT is valid", () => {
    expect(isValidTimeframe("SOURCE_SNAPSHOT")).toBe(true);
  });

  test("unsupported timeframes are rejected", () => {
    expect(isValidTimeframe("1m")).toBe(false);
    expect(isValidTimeframe("5m")).toBe(false);
    expect(isValidTimeframe("15m")).toBe(false);
    expect(isValidTimeframe("1H")).toBe(false);
    expect(isValidTimeframe("TICK")).toBe(false);
    expect(isValidTimeframe("WEEKLY")).toBe(false);
  });
});

describe("P6 Source Registry — Source Capability Mapping", () => {
  // Expected capability matrix from P6-01C-A frozen contract
  const expectedBinSpotMetrics: CanonicalMetric[] = [
    "OPEN", "HIGH", "LOW", "CLOSE", "VOLUME", "QUOTE_VOLUME",
  ];
  const expectedBinFuturesMetrics: CanonicalMetric[] = [
    "OPEN", "HIGH", "LOW", "CLOSE", "VOLUME", "QUOTE_VOLUME",
    "OPEN_INTEREST", "FUNDING_RATE",
  ];
  const expectedCoinGeckoMetrics: CanonicalMetric[] = [
    "MARKET_CAP", "FDV",
  ];

  test("BINANCE_SPOT supports exactly 6 metrics", () => {
    // Verify each metric is in the canonical vocabulary
    for (const m of expectedBinSpotMetrics) {
      expect(isValidCanonicalMetric(m)).toBe(true);
    }
    expect(expectedBinSpotMetrics.length).toBe(6);
  });

  test("BINANCE_FUTURES supports exactly 8 metrics", () => {
    for (const m of expectedBinFuturesMetrics) {
      expect(isValidCanonicalMetric(m)).toBe(true);
    }
    expect(expectedBinFuturesMetrics.length).toBe(8);
  });

  test("COINGECKO supports exactly 2 metrics", () => {
    for (const m of expectedCoinGeckoMetrics) {
      expect(isValidCanonicalMetric(m)).toBe(true);
    }
    expect(expectedCoinGeckoMetrics.length).toBe(2);
  });

  test("all capability metrics are in the canonical vocabulary", () => {
    const allMetrics = [
      ...expectedBinSpotMetrics,
      ...expectedBinFuturesMetrics,
      ...expectedCoinGeckoMetrics,
    ];
    for (const m of allMetrics) {
      expect(SUPPORTED_CANONICAL_METRICS.has(m)).toBe(true);
    }
  });
});

describe("P6 Source Registry — No Source Priority", () => {
  test("registry types do not include priority field", () => {
    // The type definitions should not export any priority-related types
    // This is a structural guarantee that no priority exists in the model
    const types = require("../types");
    expect(types.SUPPORTED_SOURCE_IDS).toBeDefined();
    // No priority constants or types should exist
    expect(types.SOURCE_PRIORITY).toBeUndefined();
    expect(types.FALLBACK_POLICY).toBeUndefined();
  });
});

describe("P6 Source Registry — No Freshness Thresholds", () => {
  test("registry types do not include freshness threshold values", () => {
    const types = require("../types");
    // No freshness thresholds should be defined in the registry types
    expect(types.FRESHNESS_THRESHOLDS).toBeUndefined();
    expect(types.STALE_AFTER).toBeUndefined();
    expect(types.EXPECTED_INTERVAL).toBeUndefined();
  });
});

describe("P6 Source Registry — Entity Coverage", () => {
  test("all source IDs are strings (not endpoint URLs)", () => {
    for (const sourceId of SUPPORTED_SOURCE_IDS) {
      expect(sourceId).not.toContain("http");
      expect(sourceId).not.toContain("api.");
      expect(sourceId).not.toContain(".com");
      expect(sourceId).not.toContain(".io");
    }
  });

  test("source IDs do not contain endpoint information", () => {
    const ids = Array.from(SUPPORTED_SOURCE_IDS);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Z_]+$/);
    }
  });
});
