import React from "react";
import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { buildTrackRecord, type TrackRecordPickRow } from "@/lib/backtest/track-record";
import {
  TrackRecordView,
  fmtR,
  fmtPct,
  type TrackRecordData,
} from "../track-record-view";

// TRACK-01 UI — follows the repository convention of renderToStaticMarkup +
// string assertions (node test environment). The summary is produced by the
// REAL aggregation so the test covers lib → view integration, not just a stub.

function dataFrom(rows: TrackRecordPickRow[]): TrackRecordData {
  return {
    params: { feeBps: 5, slippageBps: 2, roundTripBps: 14 },
    // Ngưỡng 5 trade/1 episode để test dữ liệu mẫu nhỏ vẫn đi qua cổng verdict;
    // test riêng bên dưới kiểm trạng thái "chưa đủ mẫu" với ngưỡng mặc định.
    summary: buildTrackRecord(rows, {
      benchmarkReturnPct: -3.4,
      minTrades: 5,
      minEpisodes: 1,
    }),
    // Benchmark chính = basket equal-weight; BTC chỉ là cột tham chiếu.
    benchmark: {
      method: "equal_weight",
      from: "2026-09-01",
      to: "2026-09-21",
      returnPct: -3.4,
      constituents: 12,
      excluded: 2,
      maxWeightPct: 8.3,
      bestPerformer: { symbol: "SOL", returnPct: 12.5 },
    },
    btc: {
      method: "buy_hold",
      from: "2026-09-01",
      to: "2026-09-21",
      startClose: 60000,
      endClose: 56880,
      returnPct: -5.2,
    },
    recent: rows
      .filter((r) => r.outcome === "TP1_WIN" || r.outcome === "TP2_WIN" || r.outcome === "SL_LOSS")
      .map((r) => ({
        dataDate: r.dataDate,
        symbol: r.symbol,
        direction: r.direction,
        outcome: r.outcome,
        exitRNet: r.exitRNet,
        entryFilled: r.entryFilled,
      })),
  };
}

function trade(over: Partial<TrackRecordPickRow>): TrackRecordPickRow {
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

const POPULATED: TrackRecordPickRow[] = [
  trade({ dataDate: "2026-09-01", evaluatedAt: "2026-09-15T00:00:00.000Z", outcome: "TP1_WIN", exitRNet: 1.4, exitRGross: 1.5, symbol: "BTC" }),
  trade({ dataDate: "2026-09-02", evaluatedAt: "2026-09-16T00:00:00.000Z", outcome: "TP1_WIN", exitRNet: 1.5, exitRGross: 1.6, symbol: "ETH" }),
  trade({ dataDate: "2026-09-03", evaluatedAt: "2026-09-17T00:00:00.000Z", outcome: "TP2_WIN", exitRNet: 2.0, exitRGross: 2.15, symbol: "SOL" }),
  trade({ dataDate: "2026-09-04", evaluatedAt: "2026-09-18T00:00:00.000Z", outcome: "SL_LOSS", exitRNet: -1.14, exitRGross: -1, symbol: "DOGE", direction: "BEARISH" }),
  trade({ dataDate: "2026-09-05", evaluatedAt: "2026-09-19T00:00:00.000Z", outcome: "SL_LOSS", exitRNet: -1.0, exitRGross: -1, symbol: "ADA", direction: "BEARISH" }),
];

describe("TRACK-01 TrackRecordView", () => {
  it("renders KPIs, benchmark verdict and tables for settled trades", () => {
    const data = dataFrom(POPULATED);
    // Sanity-check the aggregation the view is fed (keeps expectations honest).
    expect(data.summary.winRate).toBe(60);
    expect(data.summary.totalRNet).toBe(2.76);
    expect(data.summary.profitFactor).toBe(2.29);
    expect(data.summary.maxDrawdownR).toBe(-2.14);
    expect(data.summary.longestLosingStreak).toBe(2);
    // Sharpe mỗi lệnh trên R = [1.4, 1.5, 2.0, −1.14, −1.0]; MAR = 2.76 / 2.14.
    expect(data.summary.sharpePerTrade).toBe(0.37);
    expect(data.summary.marRatio).toBe(1.29);

    const html = renderToStaticMarkup(<TrackRecordView data={data} />);

    // No fabricated "accumulating" state when there are trades.
    expect(html).not.toContain("đang tích lũy");

    // KPI values.
    expect(html).toContain(fmtPct(data.summary.winRate));
    expect(html).toContain(fmtR(data.summary.totalRNet));
    expect(html).toContain("95% CI");
    expect(html).toContain("2.29"); // profit factor
    expect(html).toContain("-2.14R"); // max drawdown
    expect(html).toContain("Sharpe / trade");
    expect(html).toContain("0.37"); // sharpe per trade
    expect(html).toContain("MAR (net R / drawdown)");
    expect(html).toContain("1.29"); // MAR = 2.76 / 2.14

    // Benchmark: strategy +2.76% vs basket −3.4% → strategy thắng basket;
    // BTC −5.2% vẫn hiện như cột tham chiếu riêng.
    expect(html).toContain("Basket equal-weight");
    expect(html).toContain("12 coin · tối đa 8.3%/coin · loại 2 coin thiếu nến");
    expect(html).toContain("Strategy đang thắng basket");
    expect(html).toContain("BTC buy &amp; hold (tham chiếu)");
    expect(html).toContain("-5.2%");
    expect(html).toContain("Coin tăng mạnh nhất trong basket: SOL");

    // ALPHA-01 + DD-01: alpha kèm CI/xác suất, drawdown kèm thời gian.
    expect(html).toContain("Alpha so basket");
    expect(html).toContain("bootstrap 95%");
    expect(html).toContain("xác suất vượt basket");
    expect(html).toContain("underwater dài nhất 2 ngày");
    expect(html).toContain("hiện -2.14R dưới đỉnh");

    // Direction + recent tables.
    expect(html).toContain("LONG");
    expect(html).toContain("SHORT");
    expect(html).toContain("BTC");
    expect(html).toContain("TP2");

    // Methodology discipline: fees and costs are disclosed, plus the disclaimer.
    expect(html).toContain("round-trip 14bps");
    expect(html).toContain("không phải lời khuyên đầu tư");
  });

  // FILL-01: a pick that never returned to its entry zone still books a win
  // from entryMid, so the page must show the split instead of the headline only.
  it("shows fill rate and the entry-filled win rate separately", () => {
    const data = dataFrom([
      trade({ symbol: "BTC", outcome: "TP1_WIN", exitRNet: 1.4, entryFilled: true }),
      trade({ symbol: "ETH", outcome: "SL_LOSS", exitRNet: -1, entryFilled: true }),
      trade({ symbol: "SOL", outcome: "TP2_WIN", exitRNet: 2.9, entryFilled: false }),
    ]);
    // Headline counts the unfillable pick: 2/3 = 66.7%; filled-only is 50%.
    expect(data.summary.winRate).toBe(66.7);
    expect(data.summary.fill.filledWinRate).toBe(50);

    const html = renderToStaticMarkup(<TrackRecordView data={data} />);
    expect(html).toContain("Win rate (đã khớp entry)");
    expect(html).toContain("Entry fill rate");
    expect(html).toContain("2/3 pick chạm vùng entry");
    expect(html).toContain("1W / 1L trên 2 lệnh đã khớp vùng entry");
    expect(html).toContain("đã khớp");
    expect(html).toContain("chưa khớp");
    expect(html).toContain("Khớp entry:"); // methodology disclosure
    expect(html).toContain("Cỡ mẫu &amp; alpha:");
  });

  // SAMPLE-01: với ngưỡng mặc định (30 trade / 5 episode), 5 lệnh không đủ để
  // kết luận — banner và câu verdict phải nói rõ thay vì tuyên bố thắng/thua.
  it("gắn nhãn chưa đủ mẫu thay vì kết luận khi dưới ngưỡng", () => {
    const data = dataFrom(POPULATED);
    const gated = { ...data, summary: buildTrackRecord(POPULATED) };
    expect(gated.summary.sample.sufficient).toBe(false);

    const html = renderToStaticMarkup(<TrackRecordView data={gated} />);
    expect(html).toContain("Chưa đủ mẫu để kết luận");
    expect(html).toContain("ngưỡng công bố kết luận là");
    expect(html).toContain("30 lệnh");
    expect(html).not.toContain("Strategy đang thắng basket");
    // Số liệu vẫn công bố đầy đủ (gate không che dữ liệu).
    expect(html).toContain(fmtPct(gated.summary.winRate));
  });

  // FORWARD-01: bằng chứng forward phải đứng riêng, nói rõ mốc live và số
  // pick backfill bị loại — không được trộn vào headline.
  it("hiển thị riêng phần forward kể từ mốc live và số backfill bị loại", () => {
    const data = dataFrom(POPULATED);
    const forwardRows = [
      trade({
        symbol: "BTC",
        dataDate: "2026-09-10",
        pickedAt: "2026-09-10T09:00:00.000Z",
        outcome: "TP1_WIN",
        exitRNet: 1.4,
      }),
      trade({
        symbol: "ETH",
        dataDate: "2026-09-12",
        pickedAt: "2026-09-12T09:00:00.000Z",
        outcome: "SL_LOSS",
        exitRNet: -1.1,
      }),
    ];
    const html = renderToStaticMarkup(
      <TrackRecordView
        data={{
          ...data,
          meta: {
            dataAsOf: "2026-09-20",
            generatedAt: "2026-11-22T00:00:00.000Z",
            metricsVersion: data.summary.metricsVersion,
            commit: null,
            changelog: [],
            window: { capped: true, rowsRead: 4000, limit: 4000, oldestIncluded: "2026-01-01" },
          },
          split: {
            liveSince: "2026-09-10",
            liveSinceSource: "env",
            forwardPicks: 2,
            backfilledPicks: 3,
            unknownPicks: 1,
            lagGraceDays: 1,
            summary: buildTrackRecord(forwardRows, { benchmarkReturnPct: 4.2 }),
            benchmark: {
              method: "equal_weight",
              from: "2026-09-10",
              to: "2026-09-20",
              returnPct: 4.2,
              constituents: 9,
              excluded: 1,
              maxWeightPct: 11.1,
              bestPerformer: null,
            },
            btc: null,
          },
        }}
      />
    );

    expect(html).toContain("Forward record");
    expect(html).toContain("Mốc live");
    expect(html).toContain("2026-09-10");
    expect(html).toContain("(cấu hình LIVE_SINCE)");
    // Khối forward hiện riêng số lệnh / win rate / net R kể từ live.
    expect(html).toContain("Lệnh kể từ live");
    expect(html).toContain("Win rate kể từ live");
    expect(html).toContain("Net R kể từ live");
    expect(html).toContain("3 pick backfill");
    expect(html).toContain("1 pick thiếu picked_at");
    expect(html).toContain("bị loại khỏi phần này");
    // Forward chỉ có 2 lệnh → vẫn đang tích lũy, chưa đủ mẫu để kết luận.
    expect(html).toContain("Đang tích lũy, chưa đủ mẫu");
    expect(html).toContain("Alpha kể từ live so basket");
    expect(html).toContain("Basket forward 2026-09-10 → 2026-09-20");
    // Hai phần được đặt tên rõ ràng: forward ở trên, lịch sử ở dưới.
    expect(html).toContain("Toàn bộ lịch sử (gồm pick backfill)");
    // WINDOW-01: khi bị cắt cửa sổ, số backfill bị loại cũng phải nói rõ phạm vi.
    expect(html).toContain("đếm trong 4000 pick gần nhất do giới hạn cửa sổ");
  });

  it("báo LIVE_SINCE sai định dạng và không bịa pick live", () => {
    const html = renderToStaticMarkup(
      <TrackRecordView
        data={{
          ...dataFrom(POPULATED),
          split: {
            liveSince: null,
            liveSinceSource: "invalid-env",
            forwardPicks: 0,
            backfilledPicks: 0,
            unknownPicks: 4,
            lagGraceDays: 1,
            summary: null,
            benchmark: null,
            btc: null,
          },
        }}
      />
    );
    expect(html).toContain("4 pick thiếu picked_at");
    expect(html).toContain("LIVE_SINCE không đúng định dạng YYYY-MM-DD");
    // Không có pick live thật → không hiện khối số liệu forward.
    expect(html).not.toContain("Win rate kể từ live");
  });

  it("nói rõ khi toàn bộ dữ liệu là backfill, chưa có bằng chứng forward", () => {
    const html = renderToStaticMarkup(
      <TrackRecordView
        data={{
          ...dataFrom(POPULATED),
          split: {
            liveSince: null,
            forwardPicks: 0,
            backfilledPicks: 5,
            unknownPicks: 0,
            lagGraceDays: 1,
            summary: null,
            benchmark: null,
            btc: null,
          },
        }}
      />
    );
    expect(html).toContain("Chưa có pick nào được tạo live");
    expect(html).toContain("5 pick backfill bị loại khỏi phần forward");
    expect(html).toContain("chưa phải bằng chứng forward");
  });

  // ORIGIN-02: pipeline chậm một ngày → origin không bao giờ live; trang phải
  // nói rõ nguyên nhân thay vì chỉ báo "chưa có pick live" rồi để đó.
  it("cảnh báo khi origin chưa từng ghi live dù pick chỉ trễ trong ngưỡng", () => {
    const data = dataFrom(POPULATED);
    const split = {
      liveSince: null,
      forwardPicks: 0,
      backfilledPicks: 5,
      unknownPicks: 0,
      lagGraceDays: 1,
      summary: null,
      benchmark: null,
      btc: null,
    };

    const warned = renderToStaticMarkup(
      <TrackRecordView
        data={{
          ...data,
          split: {
            ...split,
            originSignal: {
              code: "origin-never-live",
              backfilledPicks: 5,
              withinGracePicks: 5,
              minLagDays: 1,
            },
          },
        }}
      />
    );
    expect(warned).toContain("Origin chưa từng ghi nhận pick live");
    expect(warned).toContain("5 pick backfill đều được ghi trong");
    expect(warned).toContain("trễ ít nhất");
    expect(warned).toContain("forward record sẽ rỗng mãi");
    // Không có originSignal (hoặc null) → không cảnh báo bừa.
    const quiet = renderToStaticMarkup(<TrackRecordView data={{ ...data, split }} />);
    expect(quiet).not.toContain("Origin chưa từng ghi nhận pick live");
  });

  // WINDOW-01: khi bị cắt ở MAX_ROWS phải nói rõ, không để tưởng là toàn bộ.
  it("công bố giới hạn cửa sổ khi chạm MAX_ROWS", () => {
    const data = dataFrom(POPULATED);
    const html = renderToStaticMarkup(
      <TrackRecordView
        data={{
          ...data,
          meta: {
            dataAsOf: "2026-09-05",
            generatedAt: "2026-11-21T00:00:00.000Z",
            metricsVersion: data.summary.metricsVersion,
            commit: null,
            changelog: [],
            window: {
              capped: true,
              rowsRead: 4000,
              limit: 4000,
              oldestIncluded: "2026-01-01",
            },
          },
        }}
      />
    );
    expect(html).toContain("chỉ tính 4000 pick gần nhất");
    expect(html).toContain("2026-01-01");
  });

  it("renders the honest accumulating state when nothing has settled", () => {
    const html = renderToStaticMarkup(<TrackRecordView data={dataFrom([])} />);
    expect(html).toContain("đang tích lũy");
    expect(html).toContain("không có số liệu nào được suy diễn trước");
    // No KPI/equity sections when there are no trades.
    expect(html).not.toContain("Profit factor");
    expect(html).not.toContain("Equity curve");
  });
});
