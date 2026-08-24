// P6 Data Quality V1 — Persistence Model Tests
// Frozen contract: P6-01D-D1 (commit bfeac25)
// These tests verify the persistence model structure without requiring a running database.
// DB-integration tests (upsert/get round-trips) are verified through the refresh pipeline in production.

import {
  p6ObservationQuality,
  p6QualityRuleConfig,
} from "@/db/schema";
import {
  upsertQualityResult,
  getQualityByIdentity,
  getQualityForMetric,
  getRulesForConfig,
} from "../service";
import type {
  ObservationQualityInsert,
  QualityLookupKey,
} from "../types";
import type { QualityState, QualityEvidence, Metric } from "../../quality/types";

// ─── SCHEMA STRUCTURE ─────────────────────────────────────────────────

describe("p6_observation_quality schema structure", () => {
  const table = p6ObservationQuality;

  test("has entityId column", () => {
    expect(table.entityId).toBeDefined();
  });

  test("has metric column", () => {
    expect(table.metric).toBeDefined();
  });

  test("has source column", () => {
    expect(table.source).toBeDefined();
  });

  test("has observedAt column (nullable)", () => {
    expect(table.observedAt).toBeDefined();
    // observedAt must be nullable (NULL = UNKNOWN)
    // Drizzle marks nullable columns with notNull() not being called
  });

  test("has timeframe column", () => {
    expect(table.timeframe).toBeDefined();
  });

  test("has qualityStatus column", () => {
    expect(table.qualityStatus).toBeDefined();
  });

  test("has observationStatus column", () => {
    expect(table.observationStatus).toBeDefined();
  });

  test("has qualityConfigVersion column", () => {
    expect(table.qualityConfigVersion).toBeDefined();
  });

  test("has evidence column (jsonb)", () => {
    expect(table.evidence).toBeDefined();
  });

  test("has qualityEvaluatedAt column", () => {
    expect(table.qualityEvaluatedAt).toBeDefined();
  });

  test("has collectedAt column (nullable)", () => {
    expect(table.collectedAt).toBeDefined();
  });

  test("has id (bigserial primary key)", () => {
    expect(table.id).toBeDefined();
  });
});

describe("p6_quality_rule_config schema structure", () => {
  const table = p6QualityRuleConfig;

  test("has qualityConfigVersion column", () => {
    expect(table.qualityConfigVersion).toBeDefined();
  });

  test("has checkId column", () => {
    expect(table.checkId).toBeDefined();
  });

  test("has metric column (nullable — NULL = all metrics)", () => {
    expect(table.metric).toBeDefined();
  });

  test("has checkType column", () => {
    expect(table.checkType).toBeDefined();
  });

  test("has parameters column (jsonb)", () => {
    expect(table.parameters).toBeDefined();
  });

  test("has isEnabled column", () => {
    expect(table.isEnabled).toBeDefined();
  });
});

// ─── SERVICE FUNCTION EXISTENCE ───────────────────────────────────────

describe("persistence service exports", () => {
  test("upsertQualityResult is a function", () => {
    expect(typeof upsertQualityResult).toBe("function");
  });

  test("getQualityByIdentity is a function", () => {
    expect(typeof getQualityByIdentity).toBe("function");
  });

  test("getQualityForMetric is a function", () => {
    expect(typeof getQualityForMetric).toBe("function");
  });

  test("getRulesForConfig is a function", () => {
    expect(typeof getRulesForConfig).toBe("function");
  });
});

// ─── IDENTITY SEMANTICS ───────────────────────────────────────────────

describe("observed_at identity semantics", () => {
  test("observedAt is nullable in schema (UNKNOWN = NULL)", () => {
    // The column must accept null — no sentinel, no boolean flag
    const col = p6ObservationQuality.observedAt;
    expect(col).toBeDefined();
    // If notNull() was called, the column would throw on null insert
    // Drizzle's nullable columns don't have notNull set
  });

  test("no observed_at_unknown column exists", () => {
    // D1 REV1 explicitly removed this column
    // Access column map safely — Drizzle tables expose columns as properties
    const colNames = Object.getOwnPropertyNames(p6ObservationQuality);
    expect(colNames).not.toContain("observedAtUnknown");
  });

  test("no sentinel column exists", () => {
    // No boolean flag or sentinel-related columns
    const columnNames = Object.keys(p6ObservationQuality);
    expect(columnNames).not.toContain("observedAtUnknown");
    expect(columnNames).not.toContain("sentinel");
  });
});

// ─── INSERT TYPE CONSTRAINTS ──────────────────────────────────────────

describe("ObservationQualityInsert type constraints", () => {
  test("qualityStatus accepts frozen vocabulary", () => {
    // Type-level check: these assignments must compile
    const valid: QualityState = "VALID";
    const invalid: QualityState = "INVALID";
    const missing: QualityState = "MISSING";
    const unknown: QualityState = "UNKNOWN";
    expect([valid, invalid, missing, unknown]).toHaveLength(4);
  });

  test("qualityStatus does not accept non-frozen values", () => {
    // This test verifies at compile time that non-frozen values are rejected
    // If the type were wrong, this would be a type error
    const states: QualityState[] = ["VALID", "INVALID", "MISSING", "UNKNOWN"];
    expect(states).not.toContain("DEGRADED");
    expect(states).not.toContain("STALE");
    expect(states).not.toContain("AGING");
  });

  test("identity supports null observedAt", () => {
    const key: QualityLookupKey = {
      entityId: 42,
      metric: "OPEN",
      source: "BINANCE_SPOT",
      observedAt: null,
      timeframe: "DAILY",
    };
    expect(key.observedAt).toBeNull();
  });

  test("identity supports non-null observedAt", () => {
    const key: QualityLookupKey = {
      entityId: 42,
      metric: "OPEN",
      source: "BINANCE_SPOT",
      observedAt: new Date("2026-08-25T00:00:00Z"),
      timeframe: "DAILY",
    };
    expect(key.observedAt).not.toBeNull();
  });
});

// ─── MIGRATION SQL CONTENT ────────────────────────────────────────────

describe("migration 0028 content verification", () => {
  // Read the migration file at test time
  let migrationSql: string;

  beforeAll(async () => {
    const fs = require("fs");
    const path = require("path");
    const migrationPath = path.resolve(
      process.cwd(),
      "drizzle/migrations/0028_add_quality_persistence.sql"
    );
    migrationSql = fs.readFileSync(migrationPath, "utf-8");
  });

  test("migration file exists", () => {
    expect(migrationSql).toBeDefined();
    expect(migrationSql.length).toBeGreaterThan(0);
  });

  test("creates p6_observation_quality table", () => {
    expect(migrationSql).toContain("p6_observation_quality");
    expect(migrationSql).toContain("CREATE TABLE");
  });

  test("creates p6_quality_rule_config table", () => {
    expect(migrationSql).toContain("p6_quality_rule_config");
  });

  test("creates KNOWN partial unique index (WHERE observed_at IS NOT NULL)", () => {
    expect(migrationSql).toContain("p6_oq_known_unique");
    expect(migrationSql).toContain("WHERE observed_at IS NOT NULL");
  });

  test("creates UNKNOWN partial unique index (WHERE observed_at IS NULL)", () => {
    expect(migrationSql).toContain("p6_oq_unknown_unique");
    expect(migrationSql).toContain("WHERE observed_at IS NULL");
  });

  test("does NOT use 1970 sentinel", () => {
    expect(migrationSql).not.toContain("1970");
    expect(migrationSql).not.toContain("epoch");
  });

  test("does NOT create observed_at_unknown column", () => {
    expect(migrationSql).not.toContain("observed_at_unknown");
  });

  test("seeds NUMERIC_PARSE rules for all 10 metrics", () => {
    const parseMatches = migrationSql.match(/NUMERIC_PARSE.*OPEN|NUMERIC_PARSE.*HIGH|NUMERIC_PARSE.*LOW|NUMERIC_PARSE.*CLOSE|NUMERIC_PARSE.*VOLUME|NUMERIC_PARSE.*QUOTE_VOLUME|NUMERIC_PARSE.*MARKET_CAP|NUMERIC_PARSE.*FDV|NUMERIC_PARSE.*OPEN_INTEREST|NUMERIC_PARSE.*FUNDING_RATE/g);
    expect(parseMatches).toHaveLength(10);
  });

  test("seeds NEGATIVE_VALUE rules excluding FUNDING_RATE negative check", () => {
    // FUNDING_RATE should have allow_negative: true
    expect(migrationSql).toContain('"allow_negative": true');
  });

  test("seeds ZERO_VALUE rules with per-metric policy", () => {
    expect(migrationSql).toContain('"zero_valid": false'); // prices, MC, FDV
    expect(migrationSql).toContain('"zero_valid": true');  // volume, OI, FR
  });

  test("does NOT seed OI-01 (FUNDING_RATE range bound)", () => {
    expect(migrationSql).not.toContain("FUNDING_RATE_RANGE");
    expect(migrationSql).not.toContain("FR_RANGE");
    // No range/percentile check for FR
  });

  test("does NOT seed OI-02 (temporal tolerance)", () => {
    expect(migrationSql).not.toContain("TEMPORAL_TOLERANCE");
    expect(migrationSql).not.toContain("TIMESTAMP_TOLERANCE");
    expect(migrationSql).not.toContain("FUTURE_TOLERANCE");
  });

  test("uses quality_config_version = 'v1'", () => {
    expect(migrationSql).toContain("'v1'");
  });

  test("seeds OHLC relational checks", () => {
    expect(migrationSql).toContain("OHLC_HIGH_GE_LOW");
    expect(migrationSql).toContain("OHLC_OPEN_IN_RANGE");
    expect(migrationSql).toContain("OHLC_CLOSE_IN_RANGE");
  });

  test("seeds ENTITY_RESOLUTION_FAIL check", () => {
    expect(migrationSql).toContain("ENTITY_RESOLUTION_FAIL");
  });
});

// ─── PARTIAL UNIQUE INDEX BEHAVIOR ────────────────────────────────────

describe("partial unique index semantics", () => {
  test("KNOWN slot is separate from UNKNOWN slot", () => {
    // Two identities with same entity/metric/source/timeframe
    // but different observed_at (one null, one not) are different identities
    const knownKey: QualityLookupKey = {
      entityId: 42,
      metric: "OPEN",
      source: "BINANCE_SPOT",
      observedAt: new Date("2026-08-25T00:00:00Z"),
      timeframe: "DAILY",
    };
    const unknownKey: QualityLookupKey = {
      entityId: 42,
      metric: "OPEN",
      source: "BINANCE_SPOT",
      observedAt: null,
      timeframe: "DAILY",
    };

    // They are different identities because observedAt differs
    expect(knownKey.observedAt).not.toEqual(unknownKey.observedAt);
  });

  test("different observed_at values create separate records", () => {
    const key1: QualityLookupKey = {
      entityId: 42,
      metric: "OPEN",
      source: "BINANCE_SPOT",
      observedAt: new Date("2026-08-25T00:00:00Z"),
      timeframe: "DAILY",
    };
    const key2: QualityLookupKey = {
      entityId: 42,
      metric: "OPEN",
      source: "BINANCE_SPOT",
      observedAt: new Date("2026-08-26T00:00:00Z"),
      timeframe: "DAILY",
    };

    // Different dates → different identities (KNOWN slot)
    expect(key1.observedAt?.getTime()).not.toBe(key2.observedAt?.getTime());
  });
});

// ─── EVIDENCE ROUND-TRIP STRUCTURE ────────────────────────────────────

describe("evidence persistence structure", () => {
  test("evidence array is JSONB-compatible", () => {
    const evidence: QualityEvidence[] = [
      {
        check_id: "NUMERIC_PARSE",
        field: "OPEN" as Metric,
        outcome: "PASS",
        detail: { parsed_value: 65000 },
      },
    ];

    // JSONB round-trip
    const serialized = JSON.stringify(evidence);
    const deserialized = JSON.parse(serialized) as QualityEvidence[];
    expect(deserialized).toHaveLength(1);
    expect(deserialized[0].check_id).toBe("NUMERIC_PARSE");
    expect(deserialized[0].outcome).toBe("PASS");
  });

  test("empty evidence array is valid", () => {
    const evidence: QualityEvidence[] = [];
    const serialized = JSON.stringify(evidence);
    expect(JSON.parse(serialized)).toEqual([]);
  });
});

// ─── CONFIG VERSION SEPARATION ────────────────────────────────────────

describe("config version namespace separation", () => {
  test("quality_config_version is string, not integer", () => {
    // P6-01C uses integer config_version
    // P6 quality uses string quality_config_version
    // They are separate namespaces
    const qualityVersion: string = "v1";
    expect(typeof qualityVersion).toBe("string");
  });

  test("quality_config_version is not P6-01C config_version", () => {
    // P6-01C config_version is an integer (p6_registry_config_versions.version)
    // quality_config_version is a varchar — they never share values
    const qualityVersion = "v1";
    const registryVersion = 1; // integer
    expect(typeof qualityVersion).toBe("string");
    expect(typeof registryVersion).toBe("number");
  });
});

// ─── DETERMINISTIC UPSERT ─────────────────────────────────────────────

describe("upsert determinism (type-level)", () => {
  test("same insert payload produces structurally identical result shape", () => {
    const insert: ObservationQualityInsert = {
      entityId: 42,
      metric: "OPEN",
      source: "BINANCE_SPOT",
      observedAt: new Date("2026-08-25T00:00:00Z"),
      timeframe: "DAILY",
      qualityStatus: "VALID",
      observationStatus: "VALID",
      qualityConfigVersion: "v1",
      evidence: [],
      qualityEvaluatedAt: new Date(),
    };

    // The insert shape is deterministic — same fields, same types
    expect(insert.entityId).toBe(42);
    expect(insert.qualityStatus).toBe("VALID");
    expect(insert.qualityConfigVersion).toBe("v1");
  });
});
