// BT-09 — bootstrap CI + episode clustering: thuần, deterministic.

import {
  BOOTSTRAP_SEED,
  bootstrapMeanCi,
  bootstrapProfitFactorCi,
  summarizeEpisodes,
} from "../bootstrap";
import { buildTrackRecord, type TrackRecordPickRow } from "../track-record";

function row(over: Partial<TrackRecordPickRow>): TrackRecordPickRow {
  return {
    dataDate: "2026-09-01",
    symbol: "BTC",
    direction: "BULLISH",
    outcome: "TP1_WIN",
    status: "EVALUATED",
    exitRGross: 1.5,
    exitRNet: 1.4,
    entryFilled: true,
    evaluatedAt: "2026-09-15T00:00:00.000Z",
    ...over,
  };
}

describe("BT-09 bootstrapMeanCi", () => {
  test("deterministic: cùng dữ liệu + seed → cùng khoảng", () => {
    const values = [1.2, -1, 0.8, 2.1, -0.6, 1.5, -1.1, 0.4];
    const a = bootstrapMeanCi(values);
    const b = bootstrapMeanCi(values);
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
    expect(a!.lo).toBeLessThanOrEqual(a!.hi);
  });

  test("khoảng chứa trung bình mẫu", () => {
    const values = [1, 2, 3, 4, 5, -1, -2];
    const mean = values.reduce((x, y) => x + y, 0) / values.length;
    const ci = bootstrapMeanCi(values)!;
    expect(ci.lo).toBeLessThanOrEqual(+mean.toFixed(2));
    expect(ci.hi).toBeGreaterThanOrEqual(+mean.toFixed(2));
  });

  test("mẫu nhiễu hơn → khoảng rộng hơn", () => {
    const tight = bootstrapMeanCi([1, 1.1, 0.9, 1.05, 0.95])!;
    const wide = bootstrapMeanCi([3, -1, 2, -1, 0.5])!;
    expect(wide.hi - wide.lo).toBeGreaterThan(tight.hi - tight.lo);
  });

  test("< 2 quan sát → null, không bịa khoảng", () => {
    expect(bootstrapMeanCi([])).toBeNull();
    expect(bootstrapMeanCi([1])).toBeNull();
    expect(bootstrapMeanCi([1, Number.NaN])).toBeNull();
  });
});

describe("BT-09 bootstrapProfitFactorCi", () => {
  test("có cả thắng và thua → khoảng hợp lệ quanh PF", () => {
    const values = [3, -1, 2, -1, 1.5];
    const ci = bootstrapProfitFactorCi(values)!;
    expect(ci.lo).toBeLessThanOrEqual(ci.hi);
    // PF mẫu = 6.5 / 2 = 3.25; khoảng phải bao quanh vùng đó.
    expect(ci.hi).toBeGreaterThanOrEqual(3.25);
  });

  test("toàn thắng hoặc toàn thua → PF không xác định → null", () => {
    expect(bootstrapProfitFactorCi([1, 2, 3])).toBeNull();
    expect(bootstrapProfitFactorCi([-1, -2])).toBeNull();
  });
});

describe("BT-09 summarizeEpisodes", () => {
  const trade = (symbol: string, direction: string, dataDate: string) => ({
    symbol,
    direction,
    dataDate,
  });

  test("pick lặp cùng symbol+hướng trong 14 ngày là MỘT episode", () => {
    const s = summarizeEpisodes([
      trade("BTC", "BULLISH", "2026-09-01"),
      trade("BTC", "BULLISH", "2026-09-03"),
      trade("BTC", "BULLISH", "2026-09-08"),
    ]);
    expect(s).toEqual({ episodes: 1, trades: 3, largest: 3 });
  });

  test("cách quá 14 ngày hoặc khác hướng/symbol → episode mới", () => {
    const s = summarizeEpisodes([
      trade("BTC", "BULLISH", "2026-09-01"),
      trade("BTC", "BULLISH", "2026-09-20"), // 19 ngày
      trade("BTC", "BEARISH", "2026-09-21"), // khác hướng
      trade("ETH", "BULLISH", "2026-09-22"), // khác symbol
    ]);
    expect(s.episodes).toBe(4);
    expect(s.largest).toBe(1);
  });

  test("rỗng → 0", () => {
    expect(summarizeEpisodes([])).toEqual({ episodes: 0, trades: 0, largest: 0 });
  });
});

describe("BT-09 tích hợp buildTrackRecord", () => {
  test("uncertainty có CI và episode ít hơn số lệnh khi pick lặp", () => {
    const s = buildTrackRecord([
      row({ symbol: "BTC", dataDate: "2026-09-01", exitRNet: 1.4 }),
      row({ symbol: "BTC", dataDate: "2026-09-02", exitRNet: -1.1, outcome: "SL_LOSS" }),
      row({ symbol: "BTC", dataDate: "2026-09-03", exitRNet: 0.9 }),
      row({ symbol: "ETH", dataDate: "2026-09-10", exitRNet: 2.2 }),
    ]);
    expect(s.totals.trades).toBe(4);
    expect(s.uncertainty.episodes).toBe(2); // BTC (3 lệnh) + ETH
    expect(s.uncertainty.largestEpisode).toBe(3);
    expect(s.uncertainty.seed).toBe(BOOTSTRAP_SEED);
    expect(s.uncertainty.avgRNetCI).not.toBeNull();
    expect(s.uncertainty.profitFactorCI).not.toBeNull();
  });

  test("một lệnh → không đủ mẫu, CI null nhưng episode = 1", () => {
    const s = buildTrackRecord([row({})]);
    expect(s.uncertainty.avgRNetCI).toBeNull();
    expect(s.uncertainty.profitFactorCI).toBeNull();
    expect(s.uncertainty.episodes).toBe(1);
  });
});
