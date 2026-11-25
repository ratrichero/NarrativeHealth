// RADAR-TG: alert row chạy mỗi vòng cohort, không còn phụ thuộc bias vừa lật.
// Test khoá hành vi: ledger chỉ ghi khi bias đổi, nhưng dispatch alert luôn
// được gọi (dedupe/cooldown ở alerts.ts chống trùng).

import { describe, expect, it, jest } from "@jest/globals";
import { recordSignalBatch } from "@/lib/market/track-record";
import type { RadarSignalRecord } from "@/lib/market/ledger";
import type { RadarMarketContext, RadarRow } from "@/lib/market/radar";

jest.mock("@/db", () => ({
  db: { select: jest.fn(), insert: jest.fn(), execute: jest.fn() },
}));

const market = {
  regime: "risk-on",
  btcChangePct: 1.2,
  btcPrice: 100_000,
} as unknown as RadarMarketContext;

const row = {
  symbol: "AAA",
  pair: "AAAUSDT",
  price: 1,
  bias: "continuation",
  label: "Tiếp diễn tăng",
  score: 80,
  entryQuality: 70,
} as unknown as RadarRow;

function signal(overrides: Partial<RadarSignalRecord> = {}): RadarSignalRecord {
  return {
    symbol: "AAA",
    side: "gainer",
    bias: "continuation",
    prevBias: "continuation",
    biasChanged: false,
    score: 80,
    entryQuality: 70,
    price: 1,
    at: new Date().toISOString(),
    ...overrides,
  } as unknown as RadarSignalRecord;
}

describe("recordSignalBatch — bỏ gate fresh", () => {
  it("bias không lật: không ghi ledger nhưng vẫn dispatch alert", async () => {
    const write = jest.fn(async () => {});
    const dispatch = jest.fn(async (_rows: RadarRow[], _market: RadarMarketContext) => 3);

    const outcome = await recordSignalBatch({
      candidates: [signal()],
      existing: [],
      now: Date.now(),
      rows: [row],
      market,
      deps: { write, dispatch },
    });

    expect(write).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith([row], market);
    expect(outcome).toEqual({ signals: 0, rowAlerts: 3 });
  });

  it("có bias mới: ghi ledger trong cửa sổ 8 ngày và vẫn alert", async () => {
    const now = Date.parse("2026-11-23T00:00:00.000Z");
    const stale = signal({ symbol: "OLD", at: new Date(now - 9 * 86_400_000).toISOString() });
    const write = jest.fn(async (_kept: RadarSignalRecord[]) => {});
    const dispatch = jest.fn(async (_rows: RadarRow[], _market: RadarMarketContext) => 1);

    const outcome = await recordSignalBatch({
      candidates: [signal({ symbol: "NEW", prevBias: "neutral", biasChanged: true })],
      existing: [stale],
      now,
      rows: [row],
      market,
      deps: { write, dispatch },
    });

    expect(outcome.signals).toBe(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0].map((item) => item.symbol)).toEqual(["NEW"]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("dispatch lỗi không làm hỏng cohort (trả 0 alert)", async () => {
    const dispatch = jest.fn(async (_rows: RadarRow[], _market: RadarMarketContext) => {
      throw new Error("telegram down");
    });

    const outcome = await recordSignalBatch({
      candidates: [signal()],
      existing: [],
      now: Date.now(),
      rows: [row],
      market,
      deps: { write: jest.fn(async () => {}), dispatch },
    });

    expect(outcome).toEqual({ signals: 0, rowAlerts: 0 });
  });
});
