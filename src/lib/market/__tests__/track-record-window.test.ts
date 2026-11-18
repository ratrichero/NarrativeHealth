// RADAR-04 regression: cửa sổ đánh giá signal ledger.
// Lỗi cũ: evaluateRadarSignals chỉ lấy 60 tín hiệu mới nhất, mà cohort ghi
// ~42 tín hiệu/ngày → tín hiệu đủ tuổi 3d/7d luôn nằm ngoài cửa sổ và horizon
// 3d/7d vĩnh viễn pending. Test này khoá lại hành vi đúng: tín hiệu cũ hơn
// 60 bản ghi vẫn được fetch klines và đo.

import { db } from "@/db";
import type { KlineData } from "@/lib/collectors/binance";
import { fetchBinanceFuturesKlines } from "@/lib/collectors/binance";
import { evaluateRadarSignals, resetTrackRecordCache } from "@/lib/market/track-record";
import type { RadarSignalRecord } from "@/lib/market/ledger";

jest.mock("@/db", () => ({
  db: { select: jest.fn(), insert: jest.fn() },
}));

jest.mock("@/lib/collectors/binance", () => ({
  fetchBinanceFuturesKlines: jest.fn(),
}));

const HOUR = 3_600_000;
const NOW = Date.now();

function candlesFrom(start: number, limit: number): KlineData[] {
  return Array.from({ length: limit }, (_, i) => {
    const price = 100 + i * 0.001;
    return {
      openTime: start + i * HOUR,
      open: price.toFixed(4),
      high: (price + 0.05).toFixed(4),
      low: (price - 0.05).toFixed(4),
      close: (price + 0.001).toFixed(4),
      volume: "1",
      closeTime: start + i * HOUR + HOUR - 1,
      quoteVolume: "1000",
    };
  });
}

function signal(overrides: Partial<RadarSignalRecord> & Pick<RadarSignalRecord, "symbol" | "at">): RadarSignalRecord {
  return {
    side: "gainer",
    bias: "continuation",
    score: 80,
    entryQuality: 70,
    price: 100,
    btcPrice: null,
    setup: null,
    actionable: true,
    ...overrides,
  };
}

// 60 tín hiệu mới nhất (nửa giờ tuổi): chưa horizon nào đủ tuổi.
const recent: RadarSignalRecord[] = Array.from({ length: 60 }, (_, i) =>
  signal({ symbol: `REC${i}`, at: new Date(NOW - 0.5 * HOUR).toISOString() })
);

// Hai tín hiệu nằm ngoài 60 bản ghi mới nhất: 4 ngày và ~7,1 ngày tuổi.
const aged3d = signal({
  symbol: "AGED3D",
  side: "loser",
  bias: "exhaustion",
  at: new Date(NOW - 96 * HOUR).toISOString(),
});
const aged7d = signal({
  symbol: "AGED7D",
  side: "loser",
  bias: "exhaustion",
  at: new Date(NOW - 170 * HOUR).toISOString(),
});

function mockDbSignals(signals: RadarSignalRecord[]): void {
  (db.select as unknown as jest.Mock).mockReturnValue({
    from: () => ({
      where: () => ({
        limit: async () => [{ value: signals }],
      }),
    }),
  });
}

describe("evaluateRadarSignals — cửa sổ đánh giá", () => {
  beforeEach(() => {
    resetTrackRecordCache();
    mockDbSignals([...recent, aged3d, aged7d]);
    (fetchBinanceFuturesKlines as jest.Mock).mockReset();
    (fetchBinanceFuturesKlines as jest.Mock).mockImplementation(
      async (_symbol: string, limit = 200, _interval = "1h", startTime?: number) =>
        candlesFrom(startTime ?? NOW - 8 * 24 * HOUR, limit)
    );
  });

  it("đo được tín hiệu cũ hơn 60 bản ghi ở horizon 3d và 7d", async () => {
    const result = await evaluateRadarSignals();

    // Không cắt còn 60: cả 62 tín hiệu đã lưu đều được đánh giá.
    expect(result.total).toBe(62);

    // Tín hiệu cũ vẫn được fetch klines (nếu bị loại khỏi cửa sổ sẽ không có call).
    const fetched = (fetchBinanceFuturesKlines as jest.Mock).mock.calls.map((call) => call[0]);
    expect(fetched).toEqual(expect.arrayContaining(["AGED3DUSDT", "AGED7DUSDT"]));

    const exhaustion = result.summaries.find((summary) => summary.bias === "exhaustion");
    expect(exhaustion).toBeDefined();

    const h3d = exhaustion?.horizons.find((horizon) => horizon.horizon === "3d");
    expect(h3d?.n).toBe(2);
    expect(h3d?.avgReturnPct).not.toBeNull();

    const h7d = exhaustion?.horizons.find((horizon) => horizon.horizon === "7d");
    expect(h7d?.n).toBe(1);
    expect(h7d?.avgReturnPct).not.toBeNull();

    // 60 tín hiệu mới nhất vẫn pending ở 24h — cửa sổ rộng không làm sai tuổi horizon.
    const continuation = result.summaries.find((summary) => summary.bias === "continuation");
    expect(continuation?.horizons.find((horizon) => horizon.horizon === "24h")?.n).toBe(0);
  });
});
