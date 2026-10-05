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
    summary: buildTrackRecord(rows),
    benchmark: { from: "2026-09-01", to: "2026-09-21", startClose: 60000, endClose: 56880, returnPct: -5.2 },
    recent: rows
      .filter((r) => r.outcome === "TP1_WIN" || r.outcome === "TP2_WIN" || r.outcome === "SL_LOSS")
      .map((r) => ({
        dataDate: r.dataDate,
        symbol: r.symbol,
        direction: r.direction,
        outcome: r.outcome,
        exitRNet: r.exitRNet,
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

    const html = renderToStaticMarkup(<TrackRecordView data={data} />);

    // No fabricated "accumulating" state when there are trades.
    expect(html).not.toContain("đang tích lũy");

    // KPI values.
    expect(html).toContain(fmtPct(data.summary.winRate));
    expect(html).toContain(fmtR(data.summary.totalRNet));
    expect(html).toContain("95% CI");
    expect(html).toContain("2.29"); // profit factor
    expect(html).toContain("-2.14R"); // max drawdown

    // Benchmark: strategy +2.76% vs BTC −5.20% → strategy wins.
    expect(html).toContain("BTC buy &amp; hold");
    expect(html).toContain("Strategy đang thắng BTC");
    expect(html).toContain("-5.2%");

    // Direction + recent tables.
    expect(html).toContain("LONG");
    expect(html).toContain("SHORT");
    expect(html).toContain("BTC");
    expect(html).toContain("TP2");

    // Methodology discipline: fees and costs are disclosed, plus the disclaimer.
    expect(html).toContain("round-trip 14bps");
    expect(html).toContain("không phải lời khuyên đầu tư");
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
