// TRACK-01 — public track record aggregation. Pure — không I/O.

import {
  buildTrackRecord,
  parseLiveSince,
  pickProvenance,
  summarizeDrawdown,
  summarizeHorizons,
  trackRecordFreshness,
  FORWARD_PICK_LAG_DAYS,
  MIN_EPISODES_FOR_VERDICT,
  MIN_TRADES_FOR_VERDICT,
  STALE_SETTLEMENT_AFTER_DAYS,
  TRACK_RECORD_METRICS_VERSION,
  type TrackRecordPickRow,
  type TrackRecordSummary,
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
    entryFilled: true,
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
    expect(s.sharpePerTrade).toBeNull();
    expect(s.marRatio).toBeNull();
    expect(s.sample).toMatchObject({ trades: 0, sufficient: false, reason: "no-trades" });
    expect(s.drawdown).toEqual({ maxR: 0, maxDays: null, currentR: 0, currentFromDate: null });
    expect(s.alpha).toBeNull();
    expect(s.totalRNet).toBe(0);
    expect(s.firstDate).toBeNull();
    expect(s.equityCurve).toEqual([]);
    expect(s.byDirection).toEqual([]);
    expect(s.monthly).toEqual([]);
    expect(s.fill.rate).toBeNull();
    expect(s.fill.filledWinRate).toBeNull();
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

  // BT-07b — Sharpe mỗi lệnh + MAR: profit factor không nói gì về độ gồ ghề
  // của đường equity, nên "hệ thống có sống được không" cần hai thước đo này.
  test("Sharpe trên mỗi lệnh = avg net R / độ lệch chuẩn (mẫu)", () => {
    // R = [+2, −1, +3, −1] → mean 0.75, sd mẫu ≈ 2.0616 → Sharpe 0.36.
    const s = buildTrackRecord([
      row({ outcome: "TP1_WIN", exitRNet: 2, exitRGross: 2 }),
      row({ outcome: "SL_LOSS", exitRNet: -1, exitRGross: -1 }),
      row({ outcome: "TP1_WIN", exitRNet: 3, exitRGross: 3 }),
      row({ outcome: "SL_LOSS", exitRNet: -1, exitRGross: -1 }),
    ]);
    expect(s.sharpePerTrade).toBe(0.36);
  });

  test("Sharpe là null khi mẫu quá mỏng hoặc mọi lệnh cùng R, không bịa ∞", () => {
    expect(buildTrackRecord([row({ exitRNet: 1 })]).sharpePerTrade).toBeNull();
    expect(buildTrackRecord([]).sharpePerTrade).toBeNull();
    expect(
      buildTrackRecord([
        row({ outcome: "TP1_WIN", exitRNet: 1 }),
        row({ outcome: "TP1_WIN", exitRNet: 1 }),
      ]).sharpePerTrade
    ).toBeNull();
  });

  test("MAR = tổng net R / |max drawdown|", () => {
    // R = [+2, −1, +3, −1]: tổng 3R, đáy drawdown −1R → MAR 3.
    const s = buildTrackRecord([
      row({ outcome: "TP1_WIN", exitRNet: 2, exitRGross: 2, evaluatedAt: "2026-09-01T00:00:00.000Z" }),
      row({ outcome: "SL_LOSS", exitRNet: -1, exitRGross: -1, evaluatedAt: "2026-09-02T00:00:00.000Z" }),
      row({ outcome: "TP2_WIN", exitRNet: 3, exitRGross: 3, evaluatedAt: "2026-09-03T00:00:00.000Z" }),
      row({ outcome: "SL_LOSS", exitRNet: -1, exitRGross: -1, evaluatedAt: "2026-09-04T00:00:00.000Z" }),
    ]);
    expect(s.totalRNet).toBe(3);
    expect(s.maxDrawdownR).toBe(-1);
    expect(s.marRatio).toBe(3);
  });

  test("MAR < 1 khi drawdown sâu hơn lợi nhuận, null khi chưa từng drawdown", () => {
    const underwater = buildTrackRecord([
      row({ outcome: "SL_LOSS", exitRNet: -1, evaluatedAt: "2026-09-01T00:00:00.000Z" }),
      row({ outcome: "SL_LOSS", exitRNet: -1, evaluatedAt: "2026-09-02T00:00:00.000Z" }),
      row({ outcome: "TP1_WIN", exitRNet: 1, evaluatedAt: "2026-09-03T00:00:00.000Z" }),
    ]);
    // Tổng −1R, drawdown −2R → MAR −0.5: hệ thống chưa sống được.
    expect(underwater.marRatio).toBe(-0.5);

    const neverDown = buildTrackRecord([
      row({ outcome: "TP1_WIN", exitRNet: 1, evaluatedAt: "2026-09-01T00:00:00.000Z" }),
      row({ outcome: "TP2_WIN", exitRNet: 2, evaluatedAt: "2026-09-02T00:00:00.000Z" }),
    ]);
    expect(neverDown.maxDrawdownR).toBe(0);
    expect(neverDown.marRatio).toBeNull();
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

// SAMPLE-01 — cổng cỡ mẫu: số liệu vẫn công bố, nhưng kết luận cần mẫu tối thiểu.
describe("SAMPLE-01 sample gate", () => {
  const dayShift = (base: string, n: number): string => {
    const d = new Date(base + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  test("dưới ngưỡng → sufficient false, reason thin-sample, số liệu vẫn đầy đủ", () => {
    const s = buildTrackRecord([
      row({ symbol: "AAA", outcome: "TP1_WIN", exitRNet: 1 }),
      row({ symbol: "BBB", outcome: "SL_LOSS", exitRNet: -1 }),
    ]);
    expect(s.sample).toEqual({
      trades: 2,
      episodes: 2,
      minTrades: MIN_TRADES_FOR_VERDICT,
      minEpisodes: MIN_EPISODES_FOR_VERDICT,
      sufficient: false,
      reason: "thin-sample",
    });
    // Gate không che số liệu.
    expect(s.winRate).toBe(50);
  });

  test("đủ ngưỡng → sufficient true; ngưỡng override được", () => {
    const s = buildTrackRecord(
      [row({}), row({ outcome: "SL_LOSS", exitRNet: -1 })],
      { minTrades: 2, minEpisodes: 1 }
    );
    expect(s.sample).toMatchObject({ sufficient: true, reason: null, minTrades: 2, minEpisodes: 1 });
  });

  test("nhiều trade nhưng ít episode → vẫn chưa đủ (cỡ mẫu thật quá nhỏ)", () => {
    const rows: TrackRecordPickRow[] = Array.from({ length: 30 }, (_, i) =>
      row({
        symbol: "BTC",
        direction: "BULLISH",
        dataDate: dayShift("2026-09-01", i),
        evaluatedAt: `2026-10-${String((i % 9) + 1).padStart(2, "0")}T00:00:00.000Z`,
        exitRNet: i % 2 === 0 ? 1 : -1,
      })
    );
    const s = buildTrackRecord(rows);
    expect(s.sample.trades).toBe(30);
    expect(s.sample.episodes).toBe(1); // cùng symbol+hướng, cách nhau ≤ 14 ngày
    expect(s.sample.sufficient).toBe(false);
    expect(s.sample.reason).toBe("thin-sample");
  });
});

// DD-01 — drawdown theo thời gian: độ sâu thôi chưa đủ, phải biết chịu đựng bao lâu.
describe("DD-01 drawdown theo thời gian", () => {
  test("đo số ngày underwater từ đỉnh gần nhất", () => {
    const s = buildTrackRecord([
      row({ outcome: "TP1_WIN", exitRNet: 2, exitRGross: 2, evaluatedAt: "2026-09-01T00:00:00.000Z" }),
      row({ outcome: "SL_LOSS", exitRNet: -1, evaluatedAt: "2026-09-05T00:00:00.000Z" }),
      row({ outcome: "SL_LOSS", exitRNet: -1, evaluatedAt: "2026-09-20T00:00:00.000Z" }),
    ]);
    expect(s.equityCurve.map((p) => p.cumR)).toEqual([2, 1, 0]);
    expect(s.drawdown).toEqual({
      maxR: -2,
      maxDays: 19, // 01/09 (đỉnh) → 20/09
      currentR: -2,
      currentFromDate: "2026-09-01",
    });
  });

  test("hồi lại đỉnh → currentR 0, không còn underwater hiện tại", () => {
    const s = buildTrackRecord([
      row({ outcome: "TP1_WIN", exitRNet: 2, exitRGross: 2, evaluatedAt: "2026-09-01T00:00:00.000Z" }),
      row({ outcome: "SL_LOSS", exitRNet: -1, evaluatedAt: "2026-09-05T00:00:00.000Z" }),
      row({ outcome: "TP2_WIN", exitRNet: 2, exitRGross: 2, evaluatedAt: "2026-09-10T00:00:00.000Z" }),
    ]);
    expect(s.drawdown).toMatchObject({
      maxR: -1,
      maxDays: 4, // 01/09 (đỉnh) → 05/09, sau đó lập đỉnh mới
      currentR: 0,
      currentFromDate: null,
    });
  });

  test("chưa từng drawdown → maxDays null, không bịa 0 ngày", () => {
    const s = buildTrackRecord([
      row({ outcome: "TP1_WIN", exitRNet: 1, evaluatedAt: "2026-09-01T00:00:00.000Z" }),
      row({ outcome: "TP2_WIN", exitRNet: 2, evaluatedAt: "2026-09-02T00:00:00.000Z" }),
    ]);
    expect(s.drawdown).toMatchObject({ maxR: 0, maxDays: null, currentR: 0, currentFromDate: null });
    expect(summarizeDrawdown([]).maxDays).toBeNull();
  });
});

// ALPHA-01 — chênh lệch so với benchmark phải kèm bất định, không chỉ một điểm.
describe("ALPHA-01 alpha so benchmark", () => {
  const rows: TrackRecordPickRow[] = [
    row({ outcome: "TP1_WIN", exitRNet: 3, evaluatedAt: "2026-09-01T00:00:00.000Z" }),
    row({ outcome: "TP1_WIN", exitRNet: 2, evaluatedAt: "2026-09-02T00:00:00.000Z" }),
    row({ outcome: "TP1_WIN", exitRNet: 1, evaluatedAt: "2026-09-03T00:00:00.000Z" }),
    row({ outcome: "SL_LOSS", exitRNet: -1, evaluatedAt: "2026-09-04T00:00:00.000Z" }),
  ];

  test("tính strategy %, delta, CI và xác suất vượt benchmark", () => {
    const s = buildTrackRecord(rows, { benchmarkReturnPct: 2 });
    expect(s.totalRNet).toBe(5);
    expect(s.alpha).toMatchObject({
      strategyPct: 5,
      benchmarkPct: 2,
      deltaPct: 3,
      resamples: 2000,
    });
    const a = s.alpha!;
    expect(a.strategyCI).not.toBeNull();
    expect(a.deltaCI).not.toBeNull();
    // CI của delta = CI của strategy − benchmark.
    expect(a.deltaCI!.lo).toBeCloseTo(a.strategyCI!.lo - 2, 2);
    expect(a.deltaCI!.hi).toBeCloseTo(a.strategyCI!.hi - 2, 2);
    // Kỳ vọng dương rõ → phần lớn lần lấy lại mẫu vượt benchmark.
    expect(a.probOutperform).toBeGreaterThan(50);
  });

  test("không có benchmark hoặc không có lệnh → alpha null, không bịa số", () => {
    expect(buildTrackRecord(rows).alpha).toBeNull();
    expect(buildTrackRecord([], { benchmarkReturnPct: 2 }).alpha).toBeNull();
    expect(buildTrackRecord(rows, { benchmarkReturnPct: Number.NaN }).alpha).toBeNull();
  });

  test("benchmark mạnh hơn → delta âm và xác suất vượt thấp", () => {
    const s = buildTrackRecord(rows, { benchmarkReturnPct: 100 });
    expect(s.alpha!.deltaPct).toBe(-95);
    expect(s.alpha!.probOutperform).toBe(0);
  });
});

// FORWARD-01 — pick ghi sau ngày dữ liệu là backfill, không phải bằng chứng.
describe("FORWARD-01 forward vs backfill theo picked_at", () => {
  test("lag 0–1 ngày là live, lag lớn hơn là backfill, thiếu picked_at là unknown", () => {
    expect(FORWARD_PICK_LAG_DAYS).toBe(1);
    expect(
      pickProvenance({ dataDate: "2026-09-01", pickedAt: "2026-09-01T13:00:00.000Z" })
    ).toBe("forward");
    // Job chạy sát nửa đêm UTC: ghi sang ngày hôm sau vẫn là live.
    expect(
      pickProvenance({ dataDate: "2026-09-01", pickedAt: "2026-09-02T01:00:00.000Z" })
    ).toBe("forward");
    // Ghi trước ngày dữ liệu (lệch múi giờ) không phải backfill.
    expect(
      pickProvenance({ dataDate: "2026-09-02", pickedAt: "2026-09-01T23:00:00.000Z" })
    ).toBe("forward");
    expect(
      pickProvenance({ dataDate: "2026-09-01", pickedAt: "2026-09-03T00:00:00.000Z" })
    ).toBe("backfill");
    expect(pickProvenance({ dataDate: "2026-09-01", pickedAt: null })).toBe("unknown");
    expect(pickProvenance({ dataDate: "2026-09-01" })).toBe("unknown");
  });

  test("LIVE_SINCE tường minh: pick ghi trước mốc live là lịch sử dù lag bằng 0", () => {
    expect(parseLiveSince("2026-09-05")).toBe("2026-09-05");
    expect(parseLiveSince(" 2026-09-05 ")).toBe("2026-09-05");
    expect(parseLiveSince("05/09/2026")).toBeNull();
    expect(parseLiveSince("2026-13-40")).toBeNull();
    expect(parseLiveSince(undefined)).toBeNull();

    // Seed trước mốc live: ghi đúng ngày dữ liệu (lag 0) nhưng vẫn không phải
    // bằng chứng forward — nó tồn tại từ trước khi hệ thống chạy live.
    const seeded = row({
      symbol: "BTC",
      dataDate: "2026-09-01",
      pickedAt: "2026-09-01T08:00:00.000Z",
      outcome: "TP1_WIN",
      exitRNet: 4,
    });
    // Live: sinh ra sau mốc, ghi đúng ngày dữ liệu.
    const live = row({
      symbol: "ETH",
      dataDate: "2026-09-10",
      pickedAt: "2026-09-10T08:00:00.000Z",
      outcome: "SL_LOSS",
      exitRNet: -1,
    });
    // Backfill chạy SAU mốc live nhưng data_date cũ → vẫn bị loại bởi quy tắc lag.
    const lateBackfill = row({
      symbol: "SOL",
      dataDate: "2026-08-20",
      pickedAt: "2026-09-12T08:00:00.000Z",
      outcome: "TP2_WIN",
      exitRNet: 3,
    });

    const all = [seeded, live, lateBackfill];
    const options = { liveSince: "2026-09-05" };
    const forwardRows = all.filter((r) => pickProvenance(r, options) === "forward");
    expect(forwardRows.map((r) => r.symbol)).toEqual(["ETH"]);
    expect(all.filter((r) => pickProvenance(r, options) === "backfill")).toHaveLength(2);

    const forward = buildTrackRecord(forwardRows);
    expect(forward.totals.trades).toBe(1);
    expect(forward.totalRNet).toBe(-1);
  });

  test("pick chạy bù 1 ngày (origin=backfill) không bị tính là forward", () => {
    // Timestamp y hệt một pick live bình thường (chạy sáng hôm sau cho ngày
    // hôm trước) — đây đúng là lỗ hổng của heuristic lag ≤ 1 ngày.
    const catchUp = {
      dataDate: "2026-09-10",
      pickedAt: "2026-09-11T02:00:00.000Z",
    };
    // Heuristic cũ: không phân biệt được → forward (lý do phải ghi origin).
    expect(pickProvenance(catchUp)).toBe("forward");
    // Origin ghi lúc insert quyết định: lượt chạy bù là backfill.
    expect(pickProvenance({ ...catchUp, pickedOrigin: "backfill" })).toBe("backfill");
    expect(pickProvenance({ ...catchUp, pickedOrigin: "live" })).toBe("forward");
    // Origin "live" không nâng được một pick trễ nhiều ngày lên forward.
    expect(
      pickProvenance({
        dataDate: "2026-09-01",
        pickedAt: "2026-09-10T02:00:00.000Z",
        pickedOrigin: "live",
      })
    ).toBe("backfill");
    // Backfill thắng cả khi không có picked_at.
    expect(pickProvenance({ dataDate: "2026-09-10", pickedAt: null, pickedOrigin: "backfill" })).toBe(
      "backfill"
    );
  });

  test("partition loại pick chạy bù khỏi khối forward dù lag chỉ 1 ngày", () => {
    const live = row({
      symbol: "BTC",
      dataDate: "2026-09-10",
      pickedAt: "2026-09-10T08:00:00.000Z",
      pickedOrigin: "live",
      exitRNet: 1,
    });
    const catchUp = row({
      symbol: "ETH",
      dataDate: "2026-09-10",
      pickedAt: "2026-09-11T02:00:00.000Z",
      pickedOrigin: "backfill",
      exitRNet: 4,
    });

    const all = [live, catchUp];
    const forward = all.filter((r) => pickProvenance(r, { liveSince: "2026-09-01" }) === "forward");
    expect(forward.map((r) => r.symbol)).toEqual(["BTC"]);
    // Cú backfill +4R không được xuất hiện trong con số forward.
    expect(buildTrackRecord(forward).totalRNet).toBe(1);
  });

  test("mốc live = data_date sớm nhất của pick forward; backfill bị tách khỏi forward", () => {
    const liveWin = row({
      symbol: "BTC",
      dataDate: "2026-09-10",
      pickedAt: "2026-09-10T09:00:00.000Z",
      outcome: "TP1_WIN",
      exitRNet: 1.5,
    });
    const liveLoss = row({
      symbol: "ETH",
      dataDate: "2026-09-12",
      pickedAt: "2026-09-12T09:00:00.000Z",
      outcome: "SL_LOSS",
      exitRNet: -1,
    });
    // Backfill: tín hiệu 01/08 nhưng nạp lại ngày 20/09 → win rất đẹp, phải bị loại.
    const backfilledWin = row({
      symbol: "SOL",
      dataDate: "2026-08-01",
      pickedAt: "2026-09-20T09:00:00.000Z",
      outcome: "TP2_WIN",
      exitRNet: 3,
    });
    const noStamp = row({ symbol: "ADA", dataDate: "2026-09-11", pickedAt: null, exitRNet: -1 });

    const all = [liveWin, liveLoss, backfilledWin, noStamp];
    const forwardRows = all.filter((r) => pickProvenance(r) === "forward");
    expect(forwardRows).toHaveLength(2);
    expect(all.filter((r) => pickProvenance(r) === "backfill")).toHaveLength(1);
    expect(all.filter((r) => pickProvenance(r) === "unknown")).toHaveLength(1);

    const history = buildTrackRecord(all);
    const forward = buildTrackRecord(forwardRows);
    // Lịch sử: 4 lệnh, tổng +2.5R nhờ cú backfill +3R.
    expect(history.totals.trades).toBe(4);
    expect(history.totalRNet).toBe(2.5);
    // Forward: chỉ 2 lệnh live, +0.5R — backfill không được "cứu" con số này.
    expect(forward.totals.trades).toBe(2);
    expect(forward.totalRNet).toBe(0.5);
    expect(forward.winRate).toBe(50);
  });
});

/** BT-10 — bảng so sánh kết quả theo horizon (append-only). */
describe("BT-10 summarizeHorizons", () => {
  test("gộp theo horizon, chỉ tính trade thật, bỏ horizon không có dòng", () => {
    const stats = summarizeHorizons([
      { horizonDays: 14, outcome: "TP1_WIN", exitRGross: 1 },
      { horizonDays: 14, outcome: "SL_LOSS", exitRGross: -1 },
      { horizonDays: 14, outcome: "NO_HIT", exitRGross: null },
      { horizonDays: 7, outcome: "TP2_WIN", exitRGross: 2 },
    ]);
    expect(stats.map((s) => s.days)).toEqual([7, 14]);
    expect(stats[0]).toMatchObject({
      days: 7,
      picks: 1,
      trades: 1,
      wins: 1,
      losses: 0,
      winRate: 100,
      avgRGross: 2,
    });
    expect(stats[1]).toMatchObject({
      days: 14,
      picks: 3,
      trades: 2,
      wins: 1,
      losses: 1,
      winRate: 50,
      avgRGross: 0,
    });
  });

  test("rỗng → mảng rỗng, không bịa horizon 0%", () => {
    expect(summarizeHorizons([])).toEqual([]);
  });
});

// FILL-01 — entry fill rate + win rate tách theo trạng thái khớp entry.
// Outcome tính từ entryMid, nên pick chạm TP trước khi giá quay lại vùng entry
// vẫn được tính thắng trên giấy — win rate đó bị thổi nếu không tách ra.
describe("FILL-01 entry fill", () => {
  test("fill rate chỉ tính trên pick có verdict, bỏ qua null", () => {
    const s = buildTrackRecord([
      row({ symbol: "AAA", entryFilled: true }),
      row({ symbol: "BBB", entryFilled: false, outcome: "SL_LOSS", exitRNet: -1 }),
      row({ symbol: "CCC", entryFilled: null }),
    ]);
    expect(s.fill).toMatchObject({ known: 2, filled: 1, unfilled: 1, rate: 50 });
  });

  test("chưa khớp entry mà vẫn thắng trên giấy → không lọt vào win rate đã khớp", () => {
    const s = buildTrackRecord([
      row({ symbol: "AAA", outcome: "TP1_WIN", entryFilled: true }),
      row({ symbol: "BBB", outcome: "SL_LOSS", exitRNet: -1, entryFilled: true }),
      row({ symbol: "CCC", outcome: "TP2_WIN", exitRNet: 2.9, entryFilled: false }),
    ]);
    // Headline vẫn tính cả pick không thể vào lệnh: 2 win / 3 trade.
    expect(s.winRate).toBe(66.7);
    // Chỉ trên lệnh thật sự khớp entry: 1 win / 2 trade = 50%.
    expect(s.fill).toMatchObject({
      known: 3,
      filled: 2,
      unfilled: 1,
      rate: 66.7,
      filledTrades: 2,
      filledWins: 1,
      filledLosses: 1,
      filledWinRate: 50,
      unfilledTrades: 1,
      unfilledWins: 1,
      unfilledLosses: 0,
      unfilledWinRate: 100,
    });
    expect(s.fill.filledWinRateCI).toEqual({ lo: 9.5, hi: 90.5 });
  });

  test("chưa có verdict nào → fill/win rate đã khớp là null, không bịa", () => {
    const s = buildTrackRecord([
      row({ entryFilled: null }),
      row({ entryFilled: null, outcome: "SL_LOSS", exitRNet: -1 }),
    ]);
    expect(s.fill).toMatchObject({
      known: 0,
      filled: 0,
      unfilled: 0,
      rate: null,
      filledTrades: 0,
      filledWinRate: null,
      filledWinRateCI: null,
      unfilledTrades: 0,
      unfilledWinRate: null,
    });
    // Headline win rate vẫn dùng mọi trade đã chốt.
    expect(s.winRate).toBe(50);
  });

  test("NO_HIT chưa khớp entry không phải trade đã khớp → vẫn đếm vào fill rate", () => {
    const s = buildTrackRecord([
      row({ outcome: "TP1_WIN", entryFilled: true }),
      row({ outcome: "NO_HIT", status: "EXPIRED", exitRNet: null, entryFilled: false }),
    ]);
    expect(s.fill).toMatchObject({ known: 2, filled: 1, unfilled: 1, rate: 50 });
    expect(s.fill.filledTrades).toBe(1);
    expect(s.fill.unfilledTrades).toBe(0);
  });

  test("byDirection mang entryFillRate thật thay vì null", () => {
    const s = buildTrackRecord([
      row({ direction: "BULLISH", entryFilled: true }),
      row({ direction: "BULLISH", entryFilled: false, outcome: "SL_LOSS", exitRNet: -1 }),
    ]);
    expect(s.byDirection[0].entryFillRate).toBe(50);
  });
});

// FRESH-01 — cảnh báo dữ liệu cũ trên trang công khai.
describe("FRESH-01 trackRecordFreshness", () => {
  const summary = (over: Partial<TrackRecordSummary>): TrackRecordSummary =>
    ({
      ...buildTrackRecord([]),
      totals: { picks: 90, trades: 80, wins: 43, losses: 37, noHit: 10, skipped: 0 },
      firstDate: "2026-09-30",
      lastDate: "2026-11-06",
      lastEvaluatedAt: "2026-11-07T02:00:00.000Z",
      ...over,
    }) as TrackRecordSummary;

  test("record đang chạy bình thường thì không cảnh báo", () => {
    const f = trackRecordFreshness(summary({}), "2026-11-09");
    expect(f).toMatchObject({ stale: false, reason: null, settlementAgeDays: 2, pickAgeDays: 3 });
  });

  test("có pick nhưng chưa từng có dấu chốt → cảnh báo, không im lặng", () => {
    const f = trackRecordFreshness(summary({ lastEvaluatedAt: null }), "2026-11-21");
    expect(f).toMatchObject({ stale: true, reason: "no-settlement-stamp", settlementAgeDays: null });
    expect(f.pickAgeDays).toBe(15);
  });

  test("lần chốt gần nhất quá ngưỡng → cảnh báo (job settlement đứng)", () => {
    const f = trackRecordFreshness(summary({}), "2026-11-21");
    expect(f.stale).toBe(true);
    expect(f.reason).toBe("settlement-old");
    expect(f.settlementAgeDays).toBe(14);
    expect(f.settlementAgeDays!).toBeGreaterThan(STALE_SETTLEMENT_AFTER_DAYS);
  });

  test("đúng ngưỡng thì chưa cảnh báo", () => {
    const f = trackRecordFreshness(summary({}), "2026-11-12");
    expect(f.settlementAgeDays).toBe(STALE_SETTLEMENT_AFTER_DAYS);
    expect(f.stale).toBe(false);
  });

  test("track record rỗng là đang tích luỹ, không phải dữ liệu cũ", () => {
    const f = trackRecordFreshness(
      { totals: { picks: 0, trades: 0, wins: 0, losses: 0, noHit: 0, skipped: 0 }, lastDate: null, lastEvaluatedAt: null },
      "2026-11-21"
    );
    expect(f).toMatchObject({ stale: false, reason: null, pickAgeDays: null, settlementAgeDays: null });
  });

  // Horizon 30/60: the newest closed pick is legitimately as old as the
  // horizon, so pick age is only judged against horizon + grace.
  test("horizon 60: pick mới nhất 60 ngày tuổi vẫn bình thường", () => {
    const f = trackRecordFreshness(
      summary({ lastDate: "2026-09-22", lastEvaluatedAt: "2026-11-20T02:00:00.000Z" }),
      "2026-11-21",
      60
    );
    expect(f).toMatchObject({ stale: false, reason: null, pickAgeDays: 60, pickLimitDays: 65 });
  });

  test("horizon 30: pick mới nhất 34 ngày tuổi vẫn bình thường", () => {
    const f = trackRecordFreshness(
      summary({ lastDate: "2026-10-18", lastEvaluatedAt: "2026-11-20T02:00:00.000Z" }),
      "2026-11-21",
      30
    );
    expect(f).toMatchObject({ stale: false, reason: null, pickAgeDays: 34, pickLimitDays: 35 });
  });

  test("horizon 60: vượt 65 ngày dù settlement còn chốt → pipeline pick đã đứng", () => {
    const f = trackRecordFreshness(
      summary({ lastDate: "2026-09-16", lastEvaluatedAt: "2026-11-20T02:00:00.000Z" }),
      "2026-11-21",
      60
    );
    expect(f).toMatchObject({ stale: true, reason: "pick-pipeline-old", pickAgeDays: 66 });
  });

  test("horizon 30: vượt 35 ngày → pipeline pick đã đứng", () => {
    const f = trackRecordFreshness(
      summary({ lastDate: "2026-10-16", lastEvaluatedAt: "2026-11-20T02:00:00.000Z" }),
      "2026-11-21",
      30
    );
    expect(f).toMatchObject({ stale: true, reason: "pick-pipeline-old", pickAgeDays: 36 });
  });
});
