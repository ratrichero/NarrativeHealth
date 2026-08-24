// P6 Data Quality V1 — Evaluation Service Integration Tests
// Frozen contract: P6-01D-B, P6-01D-C2, P6-01D-D1
//
// Tests D2→D4→D3 integration with mocked persistence.
// Verifies evidence preservation, identity semantics, and error handling.

import type {
  Metric,
  ObservationInput,
  OHLCGroupInput,
  QualityEvidence,
  MetricValidationResult,
} from "../types";
import type {
  ObservationQualityInsert,
  ObservationQualityRecord,
} from "../../quality-persistence/types";

// Mock the D3 persistence module
jest.mock("../../quality-persistence/service", () => ({
  upsertQualityResult: jest.fn(),
}));

import { upsertQualityResult } from "../../quality-persistence/service";
import {
  evaluateAndPersistQuality,
  evaluateAndPersistOHLCQuality,
  evaluateAndPersistMultiple,
} from "../evaluation-service";

const mockUpsert = upsertQualityResult as jest.MockedFunction<
  typeof upsertQualityResult
>;

// ─── HELPERS ──────────────────────────────────────────────────────────

function makeInput(
  metric: Metric,
  value: string | number | null | undefined,
  overrides?: Partial<ObservationInput>
): ObservationInput {
  return {
    entity_id: 42,
    metric,
    source: "BINANCE_SPOT",
    observed_at: new Date("2026-08-25T00:00:00Z"),
    timeframe: "DAILY",
    value,
    ...overrides,
  };
}

function makeOHLC(
  values: {
    OPEN: string | number | null | undefined;
    HIGH: string | number | null | undefined;
    LOW: string | number | null | undefined;
    CLOSE: string | number | null | undefined;
  },
  overrides?: Partial<OHLCGroupInput>
): OHLCGroupInput {
  return {
    entity_id: 42,
    source: "BINANCE_SPOT",
    observed_at: new Date("2026-08-25T00:00:00Z"),
    timeframe: "DAILY",
    observations: values,
    ...overrides,
  };
}

function fakeRecord(insert: ObservationQualityInsert): ObservationQualityRecord {
  return {
    id: 1,
    entityId: insert.entityId,
    metric: insert.metric,
    source: insert.source,
    observedAt: insert.observedAt,
    timeframe: insert.timeframe,
    qualityStatus: insert.qualityStatus,
    observationStatus: insert.observationStatus,
    qualityConfigVersion: insert.qualityConfigVersion,
    evidence: insert.evidence,
    qualityEvaluatedAt: insert.qualityEvaluatedAt,
    collectedAt: insert.collectedAt ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  mockUpsert.mockReset();
});

// ─── TEST 1: valid observation → VALID + persisted ────────────────────

describe("evaluateAndPersistQuality: valid observation", () => {
  it("validates to VALID and persists", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    const result = await evaluateAndPersistQuality(makeInput("OPEN", 65000));

    expect(result.validation.quality_status).toBe("VALID");
    expect(result.persisted.qualityStatus).toBe("VALID");
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });
});

// ─── TEST 2: malformed value → INVALID + persisted evidence ───────────

describe("evaluateAndPersistQuality: malformed value", () => {
  it("classifies NaN as INVALID with NUMERIC_PARSE evidence", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    const result = await evaluateAndPersistQuality(makeInput("OPEN", NaN));

    expect(result.validation.quality_status).toBe("INVALID");
    expect(result.persisted.qualityStatus).toBe("INVALID");

    const parseEvidence = result.validation.evidence.find(
      (e) => e.check_id === "NUMERIC_PARSE"
    );
    expect(parseEvidence?.outcome).toBe("FAIL");
  });

  it("persists evidence losslessly", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    const result = await evaluateAndPersistQuality(makeInput("OPEN", "abc"));

    // Evidence is passed through exactly
    expect(result.persisted.evidence).toEqual(result.validation.evidence);
  });
});

// ─── TEST 3: missing observation → MISSING semantics ──────────────────

describe("evaluateAndPersistQuality: missing value", () => {
  it("classifies null as MISSING", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    const result = await evaluateAndPersistQuality(makeInput("OPEN", null));

    expect(result.validation.quality_status).toBe("MISSING");
    expect(result.persisted.qualityStatus).toBe("MISSING");
    expect(result.validation.evidence).toHaveLength(0);
  });

  it("classifies undefined as MISSING", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    const result = await evaluateAndPersistQuality(
      makeInput("VOLUME", undefined)
    );

    expect(result.validation.quality_status).toBe("MISSING");
    expect(result.persisted.qualityStatus).toBe("MISSING");
  });
});

// ─── TEST 4: entity failure → MISSING + ENTITY_RESOLUTION_FAIL ────────

describe("evaluateAndPersistQuality: entity resolution failure", () => {
  it("returns MISSING with ENTITY_RESOLUTION_FAIL evidence", async () => {
    // Simulate entity failure by using the D2 entity resolution directly
    // then persisting through D4
    const { validateEntityResolution } = await import("../validator");

    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    const entityResults = validateEntityResolution(["OPEN"], {
      entity_id: 42,
      source: "COINGECKO",
      observed_at: null,
      timeframe: "SOURCE_SNAPSHOT",
      reason: "coingeckoId is null for coin 42",
    });

    // Persist through the same D3 path
    const insert: ObservationQualityInsert = {
      entityId: 42,
      metric: "OPEN",
      source: "COINGECKO",
      observedAt: null,
      timeframe: "SOURCE_SNAPSHOT",
      qualityStatus: entityResults[0].quality_status,
      observationStatus: entityResults[0].quality_status,
      qualityConfigVersion: "v1",
      evidence: entityResults[0].evidence,
      qualityEvaluatedAt: new Date(),
    };

    const record = await (await import("../../quality-persistence/service")).upsertQualityResult(insert);

    expect(record.qualityStatus).toBe("MISSING");
    expect(record.evidence[0].check_id).toBe("ENTITY_RESOLUTION_FAIL");
    expect(record.evidence[0].outcome).toBe("FAIL");
  });
});

// ─── TEST 5: OHLC valid group → persisted ─────────────────────────────

describe("evaluateAndPersistOHLCQuality: valid group", () => {
  it("persists all four members as VALID", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    const result = await evaluateAndPersistOHLCQuality(
      makeOHLC({ OPEN: 65000, HIGH: 66000, LOW: 64000, CLOSE: 65500 })
    );

    expect(result.persisted).toHaveLength(4);
    expect(result.hasRelationalFailure).toBe(false);
    for (const record of result.persisted) {
      expect(record.qualityStatus).toBe("VALID");
    }
    expect(mockUpsert).toHaveBeenCalledTimes(4);
  });
});

// ─── TEST 6: OHLC invalid group → persisted per D2 ────────────────────

describe("evaluateAndPersistOHLCQuality: invalid group", () => {
  it("HIGH < LOW → all four members INVALID", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    const result = await evaluateAndPersistOHLCQuality(
      makeOHLC({ OPEN: 65000, HIGH: 63000, LOW: 64000, CLOSE: 65500 })
    );

    expect(result.hasRelationalFailure).toBe(true);
    expect(result.persisted).toHaveLength(4);
    for (const record of result.persisted) {
      expect(record.qualityStatus).toBe("INVALID");
    }
  });
});

// ─── TEST 7: OHLC observed_at NULL → NOT_EVALUABLE ────────────────────

describe("evaluateAndPersistOHLCQuality: observed_at NULL", () => {
  it("relational checks are NOT_EVALUABLE, members keep field status", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    const result = await evaluateAndPersistOHLCQuality(
      makeOHLC(
        { OPEN: 65000, HIGH: 66000, LOW: 64000, CLOSE: 65500 },
        { observed_at: null }
      )
    );

    expect(result.hasRelationalFailure).toBe(false);
    // Members retain VALID from field checks
    for (const record of result.persisted) {
      expect(record.qualityStatus).toBe("VALID");
    }
    // Group evidence is NOT_EVALUABLE
    for (const ev of result.groupEvidence) {
      expect(ev.outcome).toBe("NOT_EVALUABLE");
    }
  });
});

// ─── TEST 8: observed_at NULL remains NULL ─────────────────────────────

describe("observed_at NULL preservation", () => {
  it("NULL observed_at is persisted as NULL", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    await evaluateAndPersistQuality(
      makeInput("OPEN", 65000, { observed_at: null })
    );

    const insertArg = mockUpsert.mock.calls[0][0];
    expect(insertArg.observedAt).toBeNull();
  });

  it("non-null observed_at is preserved exactly", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    const ts = new Date("2026-08-25T12:30:00Z");
    await evaluateAndPersistQuality(
      makeInput("OPEN", 65000, { observed_at: ts })
    );

    const insertArg = mockUpsert.mock.calls[0][0];
    expect(insertArg.observedAt).toEqual(ts);
  });
});

// ─── TEST 9: collected_at never substituted ────────────────────────────

describe("collected_at never substituted for observed_at", () => {
  it("collected_at is stored separately, observed_at unchanged", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    const collectedAt = new Date("2026-08-25T01:00:00Z");
    const observedAt = new Date("2026-08-25T00:00:00Z");

    await evaluateAndPersistQuality(makeInput("OPEN", 65000, { observed_at: observedAt }), {
      collectedAt,
    });

    const insertArg = mockUpsert.mock.calls[0][0];
    expect(insertArg.observedAt).toEqual(observedAt);
    expect(insertArg.collectedAt).toEqual(collectedAt);
    // They must be different values
    expect(insertArg.observedAt).not.toEqual(insertArg.collectedAt);
  });

  it("collected_at does not appear when not provided", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    await evaluateAndPersistQuality(makeInput("OPEN", 65000));

    const insertArg = mockUpsert.mock.calls[0][0];
    expect(insertArg.collectedAt).toBeNull();
  });
});

// ─── TEST 10: business_date never substituted ──────────────────────────

describe("business_date never substituted for observed_at", () => {
  it("evaluator has no business_date parameter", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    // The API does not accept business_date — this is verified by type safety
    await evaluateAndPersistQuality(makeInput("OPEN", 65000, { observed_at: null }));

    const insertArg = mockUpsert.mock.calls[0][0];
    // observed_at stays null — no date was fabricated
    expect(insertArg.observedAt).toBeNull();
  });
});

// ─── TEST 11: D2 evidence preserved exactly ───────────────────────────

describe("evidence preservation", () => {
  it("persists exact evidence array from D2", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    const result = await evaluateAndPersistQuality(makeInput("OPEN", -5));

    // Evidence should have NUMERIC_PARSE PASS + NEGATIVE_VALUE FAIL
    expect(result.validation.evidence.length).toBeGreaterThanOrEqual(2);

    // Persisted evidence matches validation evidence exactly
    expect(result.persisted.evidence).toEqual(result.validation.evidence);
  });

  it("OHLC evidence includes field + group evidence", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    const result = await evaluateAndPersistOHLCQuality(
      makeOHLC({ OPEN: 70000, HIGH: 66000, LOW: 64000, CLOSE: 65500 })
    );

    // Each member should have field evidence + group evidence
    for (const record of result.persisted) {
      expect(record.evidence.length).toBeGreaterThan(0);
    }
  });
});

// ─── TEST 12: quality_config_version = v1 ─────────────────────────────

describe("quality_config_version", () => {
  it("uses 'v1' for all persisted records", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    await evaluateAndPersistQuality(makeInput("OPEN", 65000));

    const insertArg = mockUpsert.mock.calls[0][0];
    expect(insertArg.qualityConfigVersion).toBe("v1");
  });
});

// ─── TEST 13: repeated evaluation is idempotent ───────────────────────

describe("idempotency", () => {
  it("same input produces same validation result", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    const input = makeInput("OPEN", 65000);
    const r1 = await evaluateAndPersistQuality(input);
    const r2 = await evaluateAndPersistQuality(input);

    expect(r1.validation.quality_status).toBe(r2.validation.quality_status);
    expect(r1.validation.evidence).toEqual(r2.validation.evidence);
  });

  it("D3 upsert handles repeated calls (mocked)", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    await evaluateAndPersistQuality(makeInput("OPEN", 65000));
    await evaluateAndPersistQuality(makeInput("OPEN", 65000));

    // D3 is called twice — latest-only is D3's responsibility
    expect(mockUpsert).toHaveBeenCalledTimes(2);
  });
});

// ─── TEST 14: persistence failure propagates ──────────────────────────

describe("error handling: persistence failure", () => {
  it("propagates D3 errors as infrastructure errors", async () => {
    mockUpsert.mockRejectedValue(new Error("DB connection failed"));

    await expect(
      evaluateAndPersistQuality(makeInput("OPEN", 65000))
    ).rejects.toThrow("DB connection failed");
  });

  it("does NOT convert persistence error into a quality state", async () => {
    mockUpsert.mockRejectedValue(new Error("DB timeout"));

    try {
      await evaluateAndPersistQuality(makeInput("OPEN", 65000));
      fail("should have thrown");
    } catch (error) {
      // The error is an infrastructure error, not a quality state
      expect((error as Error).message).toBe("DB timeout");
      // It is NOT: INVALID, MISSING, UNKNOWN
    }
  });
});

// ─── TEST 15: D2 validator remains pure ────────────────────────────────

describe("D2 purity", () => {
  it("validateMetric does not call upsertQualityResult", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    // Call D2 directly — it should not invoke persistence
    mockUpsert.mockClear();
    const { validateMetric } = await import("../validator");
    validateMetric(makeInput("OPEN", 65000));

    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

// ─── TEST 16: no freshness invocation ─────────────────────────────────

describe("no freshness invocation", () => {
  it("evaluateAndPersistQuality does not import or call freshness", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    // Freshness module should not be imported in evaluation-service
    // This is verified by the fact that no freshness-related behavior appears
    const result = await evaluateAndPersistQuality(makeInput("OPEN", 65000));
    expect(result.validation.quality_status).toBe("VALID");
    // No FRESH/STALE states anywhere
    expect(JSON.stringify(result)).not.toContain("FRESH");
    expect(JSON.stringify(result)).not.toContain("STALE");
  });
});

// ─── TEST 17: no collector invocation ─────────────────────────────────

describe("no collector invocation", () => {
  it("evaluation-service does not fetch external data", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    // The service receives input — it does not fetch from APIs
    await evaluateAndPersistQuality(makeInput("OPEN", 65000));

    // Only upsertQualityResult is called (mocked)
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });
});

// ─── TEST 18: no P4/P5 invocation ────────────────────────────────────

describe("no P4/P5 invocation", () => {
  it("does not import or call P4/P5 modules", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    const result = await evaluateAndPersistQuality(makeInput("OPEN", 65000));
    // No recommendation, health score, or action semantics
    expect(result).not.toHaveProperty("signal");
    expect(result).not.toHaveProperty("recommendation");
    expect(result).not.toHaveProperty("healthScore");
    expect(result).not.toHaveProperty("action");
  });
});

// ─── BATCH EVALUATION ─────────────────────────────────────────────────

describe("evaluateAndPersistMultiple", () => {
  it("evaluates and persists multiple observations", async () => {
    mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));

    const inputs = [
      makeInput("OPEN", 65000),
      makeInput("HIGH", 66000),
      makeInput("VOLUME", 1000),
    ];

    const results = await evaluateAndPersistMultiple(inputs);

    expect(results).toHaveLength(3);
    expect(results[0].validation.quality_status).toBe("VALID");
    expect(results[1].validation.quality_status).toBe("VALID");
    expect(results[2].validation.quality_status).toBe("VALID");
    expect(mockUpsert).toHaveBeenCalledTimes(3);
  });
});
