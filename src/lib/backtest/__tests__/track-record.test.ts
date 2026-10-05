// TRACK-01 — public track record aggregation. Pure — không I/O.

import {
  buildTrackRecord,
  TRACK_RECORD_METRICS_VERSION,
  type TrackRecordPickRow,
} from "../track-record";

function row(over: Partial<TrackRecordPickRow>): TrackRecordPickRow {
  return {
    dataDate: "2026-09-01",
    symbol: "BTC",
    direction: "BULLISH",
    outcome: "TP1_WIN",
    status: "EVALUATED",
    exitRGross: 1.5,
    exitRNet: 1.4,
    evaluatedAt: "2026-09-15T08:00:00.000Z",
    ...over,
  };
}

describe("TRACK-01 buildTrackRecord", () => {
  test("empty input → honest empty summary, never invented numbers", () => {
    const s = buildTrackRecord([]);
    expect(s.totals).toEqual({ picks: 0, trades: 0, wins: 0, losses: 0, noHit: 0, skipped: 0 });
    expect(s.winRate).toBeNull();
    expect(s.winRateCI).toBeNull();
    expect(s.avgRNet).toBeNull();
    expect(s.profitFactor).toBeNull();
    expect(s.totalRNet).toBe(0);
    expect(s.firstDate).toBeNull();
    expect(s.equityCurve).toEqual([]);
    expect(s.byDirection).toEqual([]);
    expect(s.monthly).toEqual([]);
    expect(s.metricsVersion).toBe(TRACK_RECORD_METRICS_VERSION);
  });

  test("NO_HIT / SKIPPED are not trades → excluded from win rate", () => {
    const s = buildTrackRecord([
      row({ symbol: "AAA", outcome: "TP1_WIN", exitRNet: 1.4 }),
      row({ symbol: "BBB", outcome: "SL_LOSS", exitRNet: -1.2 }),
      row({ symbol: "CCC", outcome: "NO_HIT", status: "EXPIRED", exitRNet: null }),
      row({ symbol: "DDD", outcome: "NO_SETUP", status: "SKIPPED", exitRNet: null }),
    ]);
    expect(s.totals.picks).toBe(4);
    expect(s.totals.trades).toBe(2);
    expect(s.totals.wins).toBe(1);
    expect(s.totals.losses).toBe(1);
    expect(s.totals.noHit).toBe(1);
    expect(s.totals.skipped).toBe(1);
    // 1 win / (1 win + 1 loss) = 50%, NOT 3/4 = 75%
    expect(s.winRate).toBe(50);
    expect(s.winRateCI).toEqual({ lo: 9.5, hi: 90.5 });
  });

  test("net R is the headline; gross R is reported alongside", () => {
    const s = buildTrackRecord([
      row({ outcome: "TP2_WIN", exitRGross: 2.5, exitRNet: 2.3 }),
      row({ outcome: "SL_LOSS", exitRGross: -1, exitRNet: -1.14 }),
    ]);
    expect(s.avgRNet).toBe(0.58);
    expect(s.avgRGross).toBe(0.75);
    expect(s.totalRNet).toBe(1.16);
  });

  test("equity curve + drawdown follow resolution order, not row order", () => {
    const s = buildTrackRecord([
      row({ outcome: "SL_LOSS", exitRNet: -1, evaluatedAt: "2026-09-03T00:00:00.000Z" }),
      row({ outcome: "TP1_WIN", exitRNet: 2, evaluatedAt: "2026-09-01T00:00:00.000Z" }),
      row({ outcome: "SL_LOSS", exitRNet: -1, evaluatedAt: "2026-09-05T00:00:00.000Z" }),
    ]);
    expect(s.equityCurve.map((p) => p.cumR)).toEqual([2, 1, 0]);
    expect(s.equityCurve.map((p) => p.date)).toEqual(["2026-09-01", "2026-09-03", "2026-09-05"]);
    // Peak 2 → trough 0 = −2R drawdown; two SL_LOSS in a row after the win.
    expect(s.maxDrawdownR).toBe(-2);
    expect(s.longestLosingStreak).toBe(2);
  });

  test("losing streak counts consecutive SL only", () => {
    const s = buildTrackRecord([
      row({ outcome: "SL_LOSS", evaluatedAt: "2026-09-01T00:00:00.000Z" }),
      row({ outcome: "SL_LOSS", evaluatedAt: "2026-09-02T00:00:00.000Z" }),
      row({ outcome: "SL_LOSS", evaluatedAt: "2026-09-03T00:00:00.000Z" }),
      row({ outcome: "TP1_WIN", evaluatedAt: "2026-09-04T00:00:00.000Z" }),
      row({ outcome: "SL_LOSS", evaluatedAt: "2026-09-05T00:00:00.000Z" }),
    ]);
    expect(s.longestLosingStreak).toBe(3);
  });

  test("profit factor needs both sides, else null", () => {
    expect(buildTrackRecord([row({ outcome: "TP1_WIN", exitRNet: 1 })]).profitFactor).toBeNull();
    expect(buildTrackRecord([row({ outcome: "SL_LOSS", exitRNet: -1 })]).profitFactor).toBeNull();
    const both = buildTrackRecord([
      row({ outcome: "TP1_WIN", exitRNet: 3 }),
      row({ outcome: "SL_LOSS", exitRNet: -1 }),
    ]);
    expect(both.profitFactor).toBe(3);
  });

  test("direction + monthly breakdowns", () => {
    const s = buildTrackRecord([
      row({ direction: "BULLISH", outcome: "TP1_WIN", exitRNet: 1, dataDate: "2026-09-01" }),
      row({ direction: "BULLISH", outcome: "SL_LOSS", exitRNet: -1, dataDate: "2026-09-20" }),
      row({ direction: "BEARISH", outcome: "TP2_WIN", exitRNet: 2, dataDate: "2026-10-02" }),
    ]);
    expect(s.byDirection.map((d) => d.direction)).toEqual(["BULLISH", "BEARISH"]);
    const bull = s.byDirection.find((d) => d.direction === "BULLISH")!;
    expect(bull).toMatchObject({ picks: 2, trades: 2, wins: 1, losses: 1, winRate: 50, avgRNet: 0 });
    expect(s.monthly.map((m) => m.month)).toEqual(["2026-09", "2026-10"]);
    expect(s.monthly[0]).toMatchObject({ trades: 2, wins: 1, losses: 1, winRate: 50 });
    expect(s.monthly[1]).toMatchObject({ trades: 1, wins: 1, losses: 0, winRate: 100 });
  });

  test("first/last date + last evaluated timestamp", () => {
    const s = buildTrackRecord([
      row({ dataDate: "2026-09-10", evaluatedAt: "2026-09-20T00:00:00.000Z" }),
      row({ dataDate: "2026-09-01", evaluatedAt: "2026-09-30T00:00:00.000Z" }),
    ]);
    expect(s.firstDate).toBe("2026-09-01");
    expect(s.lastDate).toBe("2026-09-10");
    expect(s.lastEvaluatedAt).toBe("2026-09-30T00:00:00.000Z");
  });
});
