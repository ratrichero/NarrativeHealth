/**
 * P3-10E.33 — Rotation OI Source Filter Regression Tests
 *
 * Verifies that prepareRotationInputs() filters coin_metrics
 * by the canonical OI source (binance_futures) and ignores
 * coingecko records with null openInterest.
 */

jest.mock("@/db", () => {
  const mockChain = (rows: any[]) => ({
    from: () => mockChain(rows),
    where: () => mockChain(rows),
    orderBy: () => rows,
    limit: () => rows.slice(0, 1),
  });
  return {
    db: {
      select: jest.fn(() => mockChain([])),
    },
  };
});

import { db } from "@/db";
import { prepareRotationInputs } from "../preparation";
import type { P3Constituent } from "../context";

const CONSTITUENTS: P3Constituent[] = [
  { coinId: 4, membershipState: "ELIGIBLE", availabilityState: "VALID", inputManifest: { marketCap: 1, instrument: "FETUSDT" } },
  { coinId: 5, membershipState: "ELIGIBLE", availabilityState: "VALID", inputManifest: { marketCap: 1, instrument: "RENDERUSDT" } },
  { coinId: 11, membershipState: "ELIGIBLE", availabilityState: "VALID", inputManifest: { marketCap: 1, instrument: "AKTUSDT" } },
];

describe("P3-10E.33 OI Source Filter", () => {
  const windowEnd = new Date("2026-08-11T00:00:00Z");

  function setupMock(options: {
    healthRows: any[];
    oiRows: any[];
    priceRows: any[];
    historicalBreadthRows?: any[];
    historicalRSRows?: any[];
    volumeRows?: any[];
  }) {
    const mockDb = db as jest.Mocked<any>;
    let callIndex = 0;
    mockDb.select.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return { from: () => ({ where: () => ({ orderBy: () => options.healthRows }) }) };
      if (callIndex === 2) return { from: () => ({ where: () => ({ orderBy: () => options.historicalBreadthRows ?? [] }) }) };
      if (callIndex === 3 && options.historicalBreadthRows && options.historicalBreadthRows.length > 0) return { from: () => ({ where: () => ({ limit: () => options.historicalRSRows ?? [] }) }) };
      if (callIndex === 3 || (callIndex === 4 && options.historicalBreadthRows && options.historicalBreadthRows.length > 0)) return { from: () => ({ where: () => ({ orderBy: () => options.volumeRows ?? [] }) }) };
      if (callIndex === 4 || (callIndex === 5 && options.historicalBreadthRows && options.historicalBreadthRows.length > 0)) return { from: () => ({ where: () => ({ orderBy: () => options.oiRows }) }) };
      if (callIndex === 5 || (callIndex === 6 && options.historicalBreadthRows && options.historicalBreadthRows.length > 0)) return { from: () => ({ where: () => ({ orderBy: () => options.priceRows }) }) };
      return { from: () => ({ where: () => ({ orderBy: () => [] }) }) };
    });
  }

  test("uses only binance_futures OI records and ignores coingecko nulls", async () => {
    setupMock({
      healthRows: [
        { coinId: 4, date: "2026-08-04", health: 70 }, { coinId: 4, date: "2026-08-11", health: 72 },
        { coinId: 5, date: "2026-08-04", health: 65 }, { coinId: 5, date: "2026-08-11", health: 67 },
        { coinId: 11, date: "2026-08-04", health: 60 }, { coinId: 11, date: "2026-08-11", health: 62 },
      ],
      oiRows: [
        { coinId: 4, openInterest: "1000000", date: "2026-08-04", source: "binance_futures" },
        { coinId: 4, openInterest: null, date: "2026-08-04", source: "coingecko" },
        { coinId: 4, openInterest: "1100000", date: "2026-08-11", source: "binance_futures" },
        { coinId: 5, openInterest: "2000000", date: "2026-08-04", source: "binance_futures" },
        { coinId: 5, openInterest: "2100000", date: "2026-08-11", source: "binance_futures" },
        { coinId: 11, openInterest: "3000000", date: "2026-08-04", source: "binance_futures" },
        { coinId: 11, openInterest: "3100000", date: "2026-08-11", source: "binance_futures" },
      ],
      priceRows: [
        { coinId: 4, close: "100", date: "2026-08-04" }, { coinId: 4, close: "105", date: "2026-08-11" },
        { coinId: 5, close: "200", date: "2026-08-04" }, { coinId: 5, close: "210", date: "2026-08-11" },
        { coinId: 11, close: "300", date: "2026-08-04" }, { coinId: 11, close: "310", date: "2026-08-11" },
      ],
      volumeRows: [
        { coinId: 4, volume: "1000", date: "2026-08-04" }, { coinId: 4, volume: "1100", date: "2026-08-11" },
        { coinId: 5, volume: "2000", date: "2026-08-04" }, { coinId: 5, volume: "2100", date: "2026-08-11" },
        { coinId: 11, volume: "3000", date: "2026-08-04" }, { coinId: 11, volume: "3100", date: "2026-08-11" },
      ],
    });

    const result = await prepareRotationInputs(1, windowEnd, CONSTITUENTS, null);
    expect(result.oiConfirmation).not.toBeNull();
    expect(result.oiConfirmation).toBeGreaterThanOrEqual(0);
    expect(result.oiConfirmation).toBeLessThanOrEqual(100);
  });

  test("returns null oiConfirmation when only coingecko records exist", async () => {
    setupMock({
      healthRows: [
        { coinId: 4, date: "2026-08-04", health: 70 }, { coinId: 4, date: "2026-08-11", health: 72 },
      ],
      oiRows: [
        { coinId: 4, openInterest: null, date: "2026-08-04", source: "coingecko" },
        { coinId: 4, openInterest: null, date: "2026-08-11", source: "coingecko" },
      ],
      priceRows: [
        { coinId: 4, close: "100", date: "2026-08-04" }, { coinId: 4, close: "105", date: "2026-08-11" },
      ],
      volumeRows: [
        { coinId: 4, volume: "1000", date: "2026-08-04" }, { coinId: 4, volume: "1100", date: "2026-08-11" },
      ],
    });

    const result = await prepareRotationInputs(1, windowEnd, CONSTITUENTS, null);
    expect(result.oiConfirmation).toBeNull();
  });
  test("handles multiple binance_futures records deterministically", async () => {
    setupMock({
      healthRows: [
        { coinId: 4, date: "2026-08-04", health: 70 }, { coinId: 4, date: "2026-08-11", health: 72 },
        { coinId: 5, date: "2026-08-04", health: 65 }, { coinId: 5, date: "2026-08-11", health: 67 },
        { coinId: 11, date: "2026-08-04", health: 60 }, { coinId: 11, date: "2026-08-11", health: 62 },
      ],
      oiRows: [
        { coinId: 4, openInterest: "1000000", date: "2026-08-04", source: "binance_futures" },
        { coinId: 4, openInterest: "1050000", date: "2026-08-05", source: "binance_futures" },
        { coinId: 4, openInterest: "1100000", date: "2026-08-11", source: "binance_futures" },
        { coinId: 5, openInterest: "2000000", date: "2026-08-04", source: "binance_futures" },
        { coinId: 5, openInterest: "2100000", date: "2026-08-11", source: "binance_futures" },
        { coinId: 11, openInterest: "3000000", date: "2026-08-04", source: "binance_futures" },
        { coinId: 11, openInterest: "3100000", date: "2026-08-11", source: "binance_futures" },
      ],
      priceRows: [
        { coinId: 4, close: "100", date: "2026-08-04" }, { coinId: 4, close: "105", date: "2026-08-11" },
        { coinId: 5, close: "200", date: "2026-08-04" }, { coinId: 5, close: "210", date: "2026-08-11" },
        { coinId: 11, close: "300", date: "2026-08-04" }, { coinId: 11, close: "310", date: "2026-08-11" },
      ],
      volumeRows: [
        { coinId: 4, volume: "1000", date: "2026-08-04" }, { coinId: 4, volume: "1100", date: "2026-08-11" },
        { coinId: 5, volume: "2000", date: "2026-08-04" }, { coinId: 5, volume: "2100", date: "2026-08-11" },
        { coinId: 11, volume: "3000", date: "2026-08-04" }, { coinId: 11, volume: "3100", date: "2026-08-11" },
      ],
    });

    const result = await prepareRotationInputs(1, windowEnd, CONSTITUENTS, null);
    expect(result.oiConfirmation).not.toBeNull();
  });
  test("skips coin with mixed sources where earliest is coingecko null", async () => {
    setupMock({
      healthRows: [
        { coinId: 4, date: "2026-08-04", health: 70 }, { coinId: 4, date: "2026-08-11", health: 72 },
      ],
      oiRows: [
        { coinId: 4, openInterest: null, date: "2026-08-04", source: "coingecko" },
        { coinId: 4, openInterest: "1100000", date: "2026-08-11", source: "binance_futures" },
      ],
      priceRows: [
        { coinId: 4, close: "100", date: "2026-08-04" }, { coinId: 4, close: "105", date: "2026-08-11" },
      ],
      volumeRows: [
        { coinId: 4, volume: "1000", date: "2026-08-04" }, { coinId: 4, volume: "1100", date: "2026-08-11" },
      ],
    });

    const result = await prepareRotationInputs(1, windowEnd, CONSTITUENTS, null);
    // With source filter, only binance_futures records are selected.
    // If only 1 binance_futures record exists, coinOI.length < 2, so this coin is skipped.
    // oiConfirmations.length < 3 => oiConfirmation = null
    expect(result.oiConfirmation).toBeNull();
  });
});
