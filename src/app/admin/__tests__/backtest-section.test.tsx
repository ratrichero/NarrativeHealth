import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

// The tab is a client component that reads everything through react-query. Mock
// the hooks so the test can render a populated dashboard deterministically
// (no network, no QueryClientProvider) and assert the BT-06/BT-07 UI actually
// appears — KPIs, risk strip, insights, charts, pick table, collapsibles.
jest.mock("@tanstack/react-query", () => {
  const status = {
    pending: 10,
    readyByHorizon: { "7": 0, "14": 2, "30": 0, "60": 0 },
    stillOpenByHorizon: { "7": 5, "14": 5, "30": 5, "60": 5 },
    noDataByHorizon: { "7": 0, "14": 1, "30": 0, "60": 0 },
    skippable: 0,
    lastEvaluatedAt: "2026-10-04T00:00:00.000Z",
  };

  const picks = [
    { pickId: 1, dataDate: "2026-09-01", symbol: "ARB", direction: "BULLISH", signal: "STRONG_WATCH", healthScore: 85, pickKind: "GENUINE", status: "EVALUATED", outcome: "TP1_WIN", exitR: 2, costR: 0.1, exitRNet: 1.9, hitDay: 3, mfePct: 4.2, maePct: -1.1, entryFilled: true, horizonDays: 14, evaluatedAt: "2026-09-16T00:00:00.000Z", repeatCount: 1 },
    { pickId: 2, dataDate: "2026-09-02", symbol: "OP", direction: "BEARISH", signal: "WATCH", healthScore: 70, pickKind: "GENUINE", status: "EVALUATED", outcome: "TP2_WIN", exitR: 3, costR: 0.2, exitRNet: 2.8, hitDay: 5, mfePct: 6.4, maePct: -1.8, entryFilled: true, horizonDays: 14, evaluatedAt: "2026-09-17T00:00:00.000Z", repeatCount: 1 },
    { pickId: 3, dataDate: "2026-09-03", symbol: "SUI", direction: "BULLISH", signal: "OBSERVE", healthScore: 55, pickKind: "GENUINE", status: "EVALUATED", outcome: "SL_LOSS", exitR: -1, costR: 0.1, exitRNet: -1.1, hitDay: 2, mfePct: 1.2, maePct: -2.5, entryFilled: true, horizonDays: 14, evaluatedAt: "2026-09-18T00:00:00.000Z", repeatCount: 1 },
    { pickId: 4, dataDate: "2026-09-04", symbol: "APT", direction: "BULLISH", signal: "OBSERVE", healthScore: 55, pickKind: "GENUINE", status: "EXPIRED", outcome: "NO_HIT", exitR: null, costR: 0.1, exitRNet: null, hitDay: null, mfePct: 1.0, maePct: -0.9, entryFilled: false, horizonDays: 14, evaluatedAt: "2026-09-19T00:00:00.000Z", repeatCount: 1 },
    { pickId: 5, dataDate: "2026-09-05", symbol: "TIA", direction: "BEARISH", signal: "CAUTION", healthScore: null, pickKind: "FILL_SHORT", status: "SKIPPED", outcome: "NO_SETUP", exitR: null, costR: null, exitRNet: null, hitDay: null, mfePct: null, maePct: null, entryFilled: null, horizonDays: 14, evaluatedAt: "2026-09-20T00:00:00.000Z", repeatCount: 1 },
  ];

  const perf = {
    params: { includeAll: false, cutoff: "2026-01-01", feeBps: 5, slippageBps: 2 },
    benchmark: { from: "2026-09-01", to: "2026-09-19", startClose: 60000, endClose: 63000, returnPct: 5 },
    totalPicks: 5,
    evaluatedCount: 4,
    pendingCount: 10,
    statusCounts: { PENDING: 10, EVALUATED: 3, EXPIRED: 1, SKIPPED: 1 },
    picks,
  };

  const power = {
    params: { daysBack: 90 },
    totalSamples: 0,
    byBand: [],
    correlations: [],
    note: "Chưa có mẫu.",
  };
  const signal = { params: { daysBack: 90 }, totalSamples: 0, bySignal: [], byScoreChange: [] };

  return {
    useQueryClient: () => ({ invalidateQueries: jest.fn() }),
    useMutation: () => ({ mutate: jest.fn(), isPending: false }),
    useQuery: (opts: { queryKey: unknown[] }) => {
      const key = opts.queryKey;
      const data = key.includes("status") ? status : key.includes("perf") ? perf : key.includes("power") ? power : key.includes("signal") ? signal : undefined;
      return { data, isLoading: false, error: null };
    },
  };
});

import BacktestSection from "../backtest-section";

describe("BacktestSection (BT-06/BT-07 UI)", () => {
  it("renders KPIs, risk strip, benchmark, insights, charts, table and collapsibles", () => {
    const html = renderToStaticMarkup(<BacktestSection />);

    // Header + run controls
    expect(html).toContain("Backtest");
    expect(html).toContain("Tự chốt: BẬT");
    expect(html).toContain("pick sẵn sàng chốt");
    expect(html).toContain("Chạy backtest");

    // KPI tiles — settled=4, wins=2, losses=1 → 66.7% ; NET avg R = (1.9+2.8-1.1)/3
    expect(html).toContain("Đã chốt view");
    expect(html).toContain("66.7%");
    expect(html).toContain("+1.20R");
    expect(html).toContain("NO_HIT");
    expect(html).toContain("25%");

    // Data-gap guard (BT-07a) surfaced on the ready-to-settle tile
    expect(html).toContain("⚠ 1 thiếu nến (chưa thể chốt)");

    // Risk strip + BTC benchmark (BT-07b/c)
    expect(html).toContain("Max drawdown (R)");
    expect(html).toContain("Profit factor");
    expect(html).toContain("Chuỗi thua dài nhất");
    expect(html).toContain("BTC buy-hold");
    expect(html).toContain("giả định rủi ro 1% vốn/lệnh");

    // Deterministic insights
    expect(html).toContain("Nhận định tự động");

    // Pick table + CSV + a fixture row
    expect(html).toContain("Bảng pick");
    expect(html).toContain("ARB");
    expect(html).toContain("CSV");

    // Collapsed Health Power / Signal Quality
    expect(html).toContain("Health Power");
    expect(html).toContain("Signal Quality");
  });
});
