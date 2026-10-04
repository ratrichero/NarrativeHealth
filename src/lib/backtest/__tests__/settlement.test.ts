// BT-06 — settlement lib: tách evaluator khỏi run route, dùng chung cho
//   POST /api/admin/backtest/run, GET status và auto-settle hook của /api/refresh.
// Mock @/db (không đụng Postgres): queue kết quả select + ghi lại payload update
// để assert semantics PENDING-once:
//   * dryRun không ghi gì,
//   * no-setup → SKIPPED (NO_SETUP),
//   * window đóng + hit TP1 → EVALUATED (TP1_WIN),
//   * status trả ready/stillOpen/skippable/lastEvaluatedAt đúng.
// BT-07 — data-gap guard: pick ĐÓNG window nhưng thiếu nến (coverage < 100%)
//   KHÔNG được chốt → noData / willNoData, giữ nguyên PENDING chờ backfill.

const mockSelectResults: unknown[][] = [];
const mockUpdatePayloads: Array<Record<string, unknown>> = [];

jest.mock("@/db", () => ({
  db: {
    select: jest.fn(() => {
      const rows = mockSelectResults.shift() ?? [];
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.from = self;
      chain.where = self;
      chain.orderBy = self;
      chain.limit = jest.fn(() => Promise.resolve(rows));
      return chain;
    }),
    update: jest.fn(() => ({
      set: jest.fn((payload: Record<string, unknown>) => {
        mockUpdatePayloads.push(payload);
        return { where: jest.fn(() => Promise.resolve(undefined)) };
      }),
    })),
  },
}));

import {
  runBacktestSettlement,
  getBacktestStatus,
  BACKTEST_HORIZONS,
  DEFAULT_HORIZON,
} from "../settlement";
import { getBusinessDate } from "@/lib/utils";

const today = getBusinessDate();

const pendingRow = (over: Partial<Record<string, unknown>> = {}) => ({
  pickId: 1,
  dataDate: "2026-01-05",
  coinId: 1,
  symbol: "BTC",
  direction: "BULLISH",
  signal: "MOMENTUM_BREAK",
  healthScore: 82,
  pickKind: "GENUINE",
  hasSetup: 1,
  entryLow: 99,
  entryHigh: 101,
  entryMid: 100,
  tp1: 106,
  tp2: 112,
  stopLoss: 94,
  ...over,
});

beforeEach(() => {
  mockSelectResults.length = 0;
  mockUpdatePayloads.length = 0;
});

/** n ngày liên tiếp SAU dataDate (UTC calendar). */
const nextDays = (dataDate: string, n: number): string[] => {
  const start = new Date(dataDate + "T00:00:00Z");
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(start.getTime());
    d.setUTCDate(d.getUTCDate() + i + 1);
    return d.toISOString().slice(0, 10);
  });
};

/** Full-window candles (coverage 100%) — điều kiện để pick được chốt (BT-07). */
const candles = (
  coinId: number,
  dataDate: string,
  n: number,
  high: number,
  low: number
) => nextDays(dataDate, n).map((date) => ({ coinId, date, high, low }));

describe("BT-06 runBacktestSettlement", () => {
  test("normalizes unknown horizon to DEFAULT_HORIZON", async () => {
    mockSelectResults.push([]);
    const res = await runBacktestSettlement({ horizon: 99, dryRun: true });
    expect(res.horizon).toBe(DEFAULT_HORIZON);
    expect(DEFAULT_HORIZON).toBe(14);
    expect(BACKTEST_HORIZONS).toEqual([7, 14, 30, 60]);
  });

  test("dryRun counts skippable / willEvaluate / stillOpen without writing", async () => {
    mockSelectResults.push([
      pendingRow({ pickId: 1, hasSetup: 0, entryMid: null, tp1: null, stopLoss: null }),
      pendingRow({ pickId: 2, dataDate: "2026-01-05" }),
      pendingRow({ pickId: 3, dataDate: today }),
    ]);
    // BT-07: dry-run cũng load nến để đếm noData — pick 2 cần full window.
    mockSelectResults.push(candles(1, "2026-01-05", 14, 101, 99));

    const res = await runBacktestSettlement({ dryRun: true });
    expect(res.dryRun).toBe(true);
    if (!res.dryRun) throw new Error("expected dry-run");
    expect(res.pendingBefore).toBe(3);
    expect(res.willSkip).toBe(1);
    expect(res.willEvaluate).toBe(1);
    expect(res.willNoData).toBe(0);
    expect(res.stillOpen).toBe(1);
    expect(res.note).toContain("không ghi gì");
    expect(mockUpdatePayloads).toHaveLength(0);
  });

  test("real run: no-setup → SKIPPED, closed window TP1 hit → EVALUATED", async () => {
    mockSelectResults.push([
      pendingRow({ pickId: 1, hasSetup: 0, entryMid: null, tp1: null, stopLoss: null }),
      pendingRow({ pickId: 2, dataDate: "2026-01-05" }),
      pendingRow({ pickId: 3, dataDate: today }),
    ]);
    // Price rows for pick 2 (coin 1): full 14-day window (BT-07 coverage),
    // day 1 high 107 → TP1 (dist 6) hit before SL.
    mockSelectResults.push([
      { coinId: 1, date: "2026-01-06", high: 107, low: 99 },
      ...candles(1, "2026-01-05", 14, 101, 99).slice(1),
    ]);

    const res = await runBacktestSettlement();
    expect(res.dryRun).toBe(false);
    if (res.dryRun) throw new Error("expected real run");
    expect(res.pendingBefore).toBe(3);
    expect(res.skipped).toBe(1);
    expect(res.evaluated).toBe(1);
    expect(res.expired).toBe(0);
    expect(res.stillOpen).toBe(1);
    expect(res.noData).toBe(0);
    expect(res.errors).toBe(0);

    expect(res.outcomes).toHaveLength(1);
    expect(res.outcomes[0]).toMatchObject({
      pickId: 2,
      symbol: "BTC",
      outcome: "TP1_WIN",
      hitDay: 1,
    });

    // Updates: skippable first, then evaluated — each pick touched exactly once.
    expect(mockUpdatePayloads).toHaveLength(2);
    expect(mockUpdatePayloads[0]).toMatchObject({
      backtestStatus: "SKIPPED",
      backtestOutcome: "NO_SETUP",
      horizonDays: 14,
    });
    expect(mockUpdatePayloads[1]).toMatchObject({
      backtestStatus: "EVALUATED",
      backtestOutcome: "TP1_WIN",
      backtestExitR: 1,
      backtestHitDay: 1,
      horizonDays: 14,
    });
    expect(mockUpdatePayloads[1].evaluatedAt).toBeInstanceOf(Date);
    expect(typeof mockUpdatePayloads[1].runId).toBe("string");
  });

  test("closed window without TP/SL hit → EXPIRED (NO_HIT)", async () => {
    mockSelectResults.push([pendingRow({ pickId: 5, dataDate: "2026-01-05" })]);
    // Price stays inside the range the whole window → no TP1, no SL.
    // Full 14 ngày (BT-07: thiếu ngày → không được chốt, là test khác).
    mockSelectResults.push(candles(1, "2026-01-05", 14, 102, 98));

    const res = await runBacktestSettlement();
    if (res.dryRun) throw new Error("expected real run");
    expect(res.expired).toBe(1);
    expect(res.evaluated).toBe(0);
    expect(res.outcomes[0].outcome).toBe("NO_HIT");
    expect(mockUpdatePayloads[0]).toMatchObject({
      backtestStatus: "EXPIRED",
      backtestOutcome: "NO_HIT",
    });
  });

  test("BT-07 data-gap: closed window nhưng thiếu nến → noData, giữ PENDING", async () => {
    // Dry-run: đóng window (dataDate 2026-01-05) nhưng 0 nến trong window.
    mockSelectResults.push([pendingRow({ pickId: 7, dataDate: "2026-01-05" })]);
    mockSelectResults.push([]);

    const dry = await runBacktestSettlement({ dryRun: true });
    if (!dry.dryRun) throw new Error("expected dry-run");
    expect(dry.willEvaluate).toBe(0);
    expect(dry.willNoData).toBe(1);
    expect(dry.note).toContain("thiếu nến");
    expect(mockUpdatePayloads).toHaveLength(0);

    // Chạy thật: vẫn KHÔNG chốt, KHÔNG update gì — pick ở lại PENDING chờ backfill.
    mockSelectResults.push([pendingRow({ pickId: 7, dataDate: "2026-01-05" })]);
    mockSelectResults.push([]);
    const res = await runBacktestSettlement();
    if (res.dryRun) throw new Error("expected real run");
    expect(res.noData).toBe(1);
    expect(res.evaluated).toBe(0);
    expect(res.expired).toBe(0);
    expect(res.outcomes).toHaveLength(0);
    expect(mockUpdatePayloads).toHaveLength(0);
  });
});

describe("BT-06 getBacktestStatus", () => {
  test("splits pending into ready / stillOpen / skippable per horizon", async () => {
    mockSelectResults.push([
      pendingRow({ pickId: 1, dataDate: "2026-01-05" }),
      pendingRow({ pickId: 2, dataDate: today }),
      pendingRow({ pickId: 3, hasSetup: 0, entryMid: null, tp1: null, stopLoss: null }),
    ]);
    // BT-07: status cũng load nến để tách ready/noData — đủ coverage cho horizon 60.
    mockSelectResults.push(candles(1, "2026-01-05", 60, 101, 99));
    mockSelectResults.push([
      { at: new Date("2026-09-30T12:00:00.000Z") },
    ]);

    const status = await getBacktestStatus();
    expect(status.pending).toBe(3);
    expect(status.skippable).toBe(1);
    // Only pick 1 (old window) is ready — for every horizon (coverage đủ 60 ngày).
    for (const h of BACKTEST_HORIZONS) {
      expect(status.readyByHorizon[h]).toBe(1);
      expect(status.stillOpenByHorizon[h]).toBe(1);
      expect(status.noDataByHorizon[h]).toBe(0);
    }
    expect(status.lastEvaluatedAt).toBe("2026-09-30T12:00:00.000Z");
  });

  test("BT-07: closed nhưng thiếu nến → noDataByHorizon, không tính ready", async () => {
    mockSelectResults.push([pendingRow({ pickId: 1, dataDate: "2026-01-05" })]);
    mockSelectResults.push([]); // 0 nến → coverage 0
    mockSelectResults.push([{ at: null }]);

    const status = await getBacktestStatus();
    expect(status.pending).toBe(1);
    for (const h of BACKTEST_HORIZONS) {
      expect(status.readyByHorizon[h]).toBe(0);
      expect(status.noDataByHorizon[h]).toBe(1);
    }
    expect(status.lastEvaluatedAt).toBeNull();
  });

  test("lastEvaluatedAt is null when nothing was ever evaluated", async () => {
    mockSelectResults.push([]);
    mockSelectResults.push([{ at: null }]);

    const status = await getBacktestStatus();
    expect(status.pending).toBe(0);
    expect(status.skippable).toBe(0);
    expect(status.lastEvaluatedAt).toBeNull();
  });
});
