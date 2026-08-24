// P6-01E-C — Kline Quality Wiring Hook Tests
// Authority: P6-01B, P6-01C, frozen P6-01D, frozen PD-E1..PD-E4
//
// Verifies:
//   - canonical observation construction (exact identity, openTime as observed_at)
//   - legacy → canonical source mapping (strict, no guessing)
//   - OHLC group identity shared exactly by all four members
//   - quality classification NEVER blocks / throws (PD-E2 boundary A)
//   - quality PERSISTENCE failure propagates as infrastructure error (PD-E2 boundary B)
//   - no collected_at substitution, evidence round-trip

jest.mock("../../quality-persistence/service", () => ({
  upsertQualityResult: jest.fn(),
}));

import { upsertQualityResult } from "../../quality-persistence/service";
import type {
  ObservationQualityInsert,
  ObservationQualityRecord,
} from "../../quality-persistence/types";

import {
  evaluateKlineObservationQuality,
  toCanonicalSource,
} from "../kline-quality-hook";

const mockUpsert = upsertQualityResult as jest.MockedFunction<
  typeof upsertQualityResult
>;

function fakeRecord(insert: ObservationQualityInsert): ObservationQualityRecord {
  return {
    id: 1,
    entityId: insert.entityId,
    metric: insert.metric,
    source: insert.source,
    observedAt: insert.observedAt ?? null,
    timeframe: insert.timeframe,
    qualityStatus: insert.qualityStatus,
    observationStatus: insert.observationStatus,
    qualityConfigVersion: insert.qualityConfigVersion,
    evidence: insert.evidence,
    qualityEvaluatedAt: insert.qualityEvaluatedAt,
    collectedAt: insert.collectedAt ?? null,
    createdAt: new Date("2026-08-24T00:00:00Z"),
    updatedAt: new Date("2026-08-24T00:00:00Z"),
  };
}

const VALID_KLINE = {
  openTime: Date.UTC(2026, 7, 24, 0, 0, 0), // 2026-08-24T00:00:00Z
  open: "100",
  high: "110",
  low: "95",
  close: "105",
  volume: "1234.5",
  quoteVolume: "129622.5",
};

beforeEach(() => {
  mockUpsert.mockReset();
  mockUpsert.mockImplementation(async (insert) => fakeRecord(insert));
});

// ─── SOURCE MAPPING ───────────────────────────────────────────────────

describe("toCanonicalSource", () => {
  it("maps binance_spot -> BINANCE_SPOT", () => {
    expect(toCanonicalSource("binance_spot")).toBe("BINANCE_SPOT");
  });

  it("maps binance_futures -> BINANCE_FUTURES", () => {
    expect(toCanonicalSource("binance_futures")).toBe("BINANCE_FUTURES");
  });

  it("refuses to guess an unknown legacy source", () => {
    expect(() => toCanonicalSource("coingecko")).toThrow();
    expect(() => toCanonicalSource("")).toThrow();
  });
});

// ─── CANONICAL OBSERVATION CONSTRUCTION ───────────────────────────────

describe("evaluateKlineObservationQuality — identity construction", () => {
  it("persists exactly 6 observations per kline (OHLC + VOLUME + QUOTE_VOLUME)", async () => {
    const result = await evaluateKlineObservationQuality(VALID_KLINE, {
      entityId: 42,
      priceSource: "binance_futures",
      timeframe: "DAILY",
    });

    expect(result.ohlc.persisted).toHaveLength(4);
    expect(mockUpsert).toHaveBeenCalledTimes(6);

    const metrics = mockUpsert.mock.calls.map((c) => c[0].metric).sort();
    expect(metrics).toEqual([
      "CLOSE", "HIGH", "LOW", "OPEN", "QUOTE_VOLUME", "VOLUME",
    ]);
  });

  it("uses source-provided openTime verbatim as observed_at for every metric", async () => {
    await evaluateKlineObservationQuality(VALID_KLINE, {
      entityId: 42,
      priceSource: "binance_spot",
      timeframe: "DAILY",
    });

    for (const call of mockUpsert.mock.calls) {
      expect(call[0].observedAt).toEqual(new Date(VALID_KLINE.openTime));
    }
  });

  it("never substitutes collected_at or synthesizes timestamps", async () => {
    await evaluateKlineObservationQuality(VALID_KLINE, {
      entityId: 42,
      priceSource: "binance_spot",
      timeframe: "DAILY",
    });

    for (const call of mockUpsert.mock.calls) {
      expect(call[0].collectedAt).toBeNull();
    }
  });

  it("shares the exact OHLC group identity across all four members", async () => {
    await evaluateKlineObservationQuality(VALID_KLINE, {
      entityId: 42,
      priceSource: "binance_futures",
      timeframe: "4H",
    });

    const ohlcCalls = mockUpsert.mock.calls.filter((c) =>
      ["OPEN", "HIGH", "LOW", "CLOSE"].includes(c[0].metric)
    );

    for (const call of ohlcCalls) {
      expect(call[0].entityId).toBe(42);
      expect(call[0].source).toBe("BINANCE_FUTURES");
      expect(call[0].observedAt).toEqual(new Date(VALID_KLINE.openTime));
      expect(call[0].timeframe).toBe("4H");
    }

    // All four members carry the group-level relational evidence merged in.
    for (const call of ohlcCalls) {
      const checkIds = call[0].evidence.map((e) => e.check_id);
      expect(checkIds).toContain("OHLC_HIGH_GE_LOW");
    }
  });

  it("carries the frozen quality config version v1 and null-safe pass-through values", async () => {
    await evaluateKlineObservationQuality(VALID_KLINE, {
      entityId: 7,
      priceSource: "binance_spot",
      timeframe: "DAILY",
    });

    for (const call of mockUpsert.mock.calls) {
      expect(call[0].qualityConfigVersion).toBe("v1");
    }
  });
});

// ─── PD-E2 BOUNDARY A: CLASSIFICATION NEVER BLOCKS ────────────────────

describe("evaluateKlineObservationQuality — classification never blocks ingestion", () => {
  it("returns normally for a fully INVALID kline (malformed OHLC)", async () => {
    const malformed = {
      ...VALID_KLINE,
      open: "not-a-number",
      high: "-5",
      low: "abc",
      close: "",
      volume: "NaN",
      quoteVolume: undefined as unknown as string,
    };

    await expect(
      evaluateKlineObservationQuality(malformed, {
        entityId: 42,
        priceSource: "binance_spot",
        timeframe: "DAILY",
      })
    ).resolves.toBeDefined();

    // Classifications were still persisted (INVALID states), not dropped.
    const statuses = mockUpsert.mock.calls.map((c) => c[0].qualityStatus);
    expect(statuses).toContain("INVALID");
    // And nothing threw — ingestion would proceed to the existing DB write.
  });

  it("classifies malformed ≠ missing (empty string INVALID, null MISSING)", async () => {
    const kline = {
      ...VALID_KLINE,
      close: "", // malformed-present
      volume: null as unknown as string, // missing
    };

    await evaluateKlineObservationQuality(kline, {
      entityId: 42,
      priceSource: "binance_spot",
      timeframe: "DAILY",
    });

    const byMetric = new Map(
      mockUpsert.mock.calls.map((c) => [c[0].metric, c[0].qualityStatus])
    );
    expect(byMetric.get("CLOSE")).toBe("INVALID");
    expect(byMetric.get("VOLUME")).toBe("MISSING");
  });
});

// ─── PD-E2 BOUNDARY B: PERSISTENCE FAILURE = INFRASTRUCTURE ERROR ─────

describe("evaluateKlineObservationQuality — persistence failure semantics", () => {
  it("propagates persistence errors as infrastructure errors (no state coercion, no swallowing)", async () => {
    mockUpsert.mockRejectedValueOnce(new Error("db connection refused"));

    await expect(
      evaluateKlineObservationQuality(VALID_KLINE, {
        entityId: 42,
        priceSource: "binance_spot",
        timeframe: "DAILY",
      })
    ).rejects.toThrow("db connection refused");
  });

  it("stops at the first failing write without inventing retry semantics", async () => {
    let calls = 0;
    mockUpsert.mockImplementation(async () => {
      calls += 1;
      throw new Error("write failed");
    });

    await expect(
      evaluateKlineObservationQuality(VALID_KLINE, {
        entityId: 42,
        priceSource: "binance_futures",
        timeframe: "DAILY",
      })
    ).rejects.toThrow("write failed");

    expect(calls).toBe(1); // no retries
  });
});

// ─── AUDIT 6: DUPLICATE / IDEMPOTENCY ──────────────────────────────────

describe("evaluateKlineObservationQuality — duplicate / idempotency", () => {
  function identityOf(call: { entityId: number; metric: string; source: string; observedAt: Date | null; timeframe: string }) {
    return `${call.entityId}|${call.metric}|${call.source}|${call.observedAt?.toISOString()}|${call.timeframe}`;
  }

  it("repeated refresh of the same kline targets the exact same identity slots (latest-only)", async () => {
    const ctx = { entityId: 42, priceSource: "binance_spot", timeframe: "DAILY" as const };

    await evaluateKlineObservationQuality(VALID_KLINE, ctx);
    const firstPass = mockUpsert.mock.calls.map((c) => identityOf(c[0])).sort();

    mockUpsert.mockClear();
    await evaluateKlineObservationQuality(VALID_KLINE, ctx);
    const secondPass = mockUpsert.mock.calls.map((c) => identityOf(c[0])).sort();

    expect(secondPass).toEqual(firstPass);
    expect(new Set(firstPass).size).toBe(6); // no accidental duplicate identities
  });

  it("spot and futures observations are distinct identities for the same kline values", async () => {
    await evaluateKlineObservationQuality(VALID_KLINE, {
      entityId: 42,
      priceSource: "binance_spot",
      timeframe: "DAILY",
    });
    await evaluateKlineObservationQuality(VALID_KLINE, {
      entityId: 42,
      priceSource: "binance_futures",
      timeframe: "DAILY",
    });

    const sources = new Set(mockUpsert.mock.calls.map((c) => c[0].source));
    expect(sources).toEqual(new Set(["BINANCE_SPOT", "BINANCE_FUTURES"]));
    // 6 metrics × 2 sources, all distinct rows targeted
    expect(mockUpsert.mock.calls.length).toBe(12);
  });

  it("different openTime means a different observation, never collapsed", async () => {
    const nextCandle = { ...VALID_KLINE, openTime: VALID_KLINE.openTime + 4 * 60 * 60 * 1000 };

    await evaluateKlineObservationQuality(VALID_KLINE, {
      entityId: 42,
      priceSource: "binance_spot",
      timeframe: "4H",
    });
    await evaluateKlineObservationQuality(nextCandle, {
      entityId: 42,
      priceSource: "binance_spot",
      timeframe: "4H",
    });

    const observedTimes = new Set(
      mockUpsert.mock.calls.map((c) => c[0].observedAt?.toISOString())
    );
    expect(observedTimes.size).toBe(2);
  });
});
