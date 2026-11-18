import type { KlineData } from "@/lib/collectors/binance";
import {
  aggregateHorizon,
  evaluateSignal,
  planCohorts,
  selectCohort,
  summarizeByBias,
  summarizeByCluster,
  type RadarSignalRecord,
  type TrackedSignal,
} from "@/lib/market/ledger";
import type { RadarRow } from "@/lib/market/radar";

const T0 = Date.parse("2026-01-01T00:00:00Z");
const HOUR = 3_600_000;

function candle(openTime: number, o: number, h: number, l: number, c: number): KlineData {
  return {
    openTime,
    open: String(o),
    high: String(h),
    low: String(l),
    close: String(c),
    volume: "1",
    closeTime: openTime + HOUR - 1,
    quoteVolume: "1000",
  };
}

const baseSignal: RadarSignalRecord = {
  symbol: "ALT",
  side: "gainer",
  bias: "continuation",
  score: 82,
  entryQuality: 70,
  price: 100,
  at: new Date(T0).toISOString(),
  btcPrice: 100,
  setup: {
    direction: "BULLISH",
    entryLow: 99,
    entryHigh: 101,
    tp1: 105,
    tp2: 110,
    stopLoss: 95,
  },
  actionable: true,
};

const coinCandles = [
  candle(T0, 100, 106, 99, 102),
  candle(T0 + HOUR, 102, 103, 101, 104),
  candle(T0 + 2 * HOUR, 104, 105, 103, 103),
  candle(T0 + 3 * HOUR, 103, 104, 102, 102),
  candle(T0 + 4 * HOUR, 102, 103, 101, 102),
];

const btcCandles = [
  candle(T0, 100, 101, 99, 100),
  candle(T0 + HOUR, 100, 102, 100, 101),
  candle(T0 + 2 * HOUR, 101, 103, 101, 102),
  candle(T0 + 4 * HOUR, 102, 105, 102, 104),
];

describe("evaluateSignal", () => {
  it("đo return/MFE/MAE, TP, win và relative so với BTC", () => {
    const tracked = evaluateSignal(baseSignal, coinCandles, btcCandles, T0 + 5 * HOUR);
    const h1 = tracked.horizons["1h"];
    expect(h1?.pending).toBe(false);
    expect(h1?.returnPct).toBe(2); // close nến T0 (đóng tại T0+1h)
    expect(h1?.mfePct).toBeGreaterThanOrEqual(6);
    expect(h1?.maePct).toBeLessThanOrEqual(-1);
    expect(h1?.tp1Hit).toBe(true);
    expect(h1?.slHit).toBe(false);
    expect(h1?.win).toBe(true);
    expect(h1?.btcReturnPct).toBe(0);
    expect(h1?.relativePct).toBe(2);
  });

  it("horizon chưa đủ tuổi thì pending, không tính win", () => {
    const tracked = evaluateSignal(baseSignal, coinCandles, btcCandles, T0 + 5 * HOUR);
    expect(tracked.horizons["24h"]?.pending).toBe(true);
    expect(tracked.horizons["24h"]?.returnPct).toBeNull();
    expect(tracked.horizons["24h"]?.win).toBeNull();
    expect(tracked.horizons["7d"]?.pending).toBe(true);
  });

  it("TP và SL cùng một nến → ambiguous", () => {
    const signal = { ...baseSignal, at: new Date(T0).toISOString() };
    const tracked = evaluateSignal(
      signal,
      [candle(T0, 100, 106, 94, 100)],
      btcCandles,
      T0 + 2 * HOUR
    );
    const h = tracked.horizons["1h"];
    expect(h?.tp1Hit).toBe(true);
    expect(h?.slHit).toBe(true);
    expect(h?.firstEvent).toBe("ambiguous");
  });

  it("bias giảm thắng khi return âm và TP short chạm", () => {
    const signal: RadarSignalRecord = {
      ...baseSignal,
      bias: "exhaustion",
      setup: {
        direction: "BEARISH",
        entryLow: 99,
        entryHigh: 101,
        tp1: 95,
        tp2: 90,
        stopLoss: 105,
      },
    };
    const tracked = evaluateSignal(
      signal,
      [candle(T0, 100, 101, 94, 96)],
      btcCandles,
      T0 + 2 * HOUR
    );
    const h = tracked.horizons["1h"];
    expect(h?.returnPct).toBe(-4);
    expect(h?.win).toBe(true);
    expect(h?.tp1Hit).toBe(true);
    expect(h?.slHit).toBe(false);
  });

  it("neutral được lưu nhưng không có win", () => {
    const tracked = evaluateSignal(
      { ...baseSignal, bias: "neutral", setup: null, actionable: false },
      coinCandles,
      btcCandles,
      T0 + 2 * HOUR
    );
    expect(tracked.horizons["1h"]?.returnPct).not.toBeNull();
    expect(tracked.horizons["1h"]?.win).toBeNull();
  });
});

describe("summarizeByCluster", () => {
  it("nhóm hiệu quả theo cụm và vai trò leader/laggard", () => {
    const leader = evaluateSignal(
      {
        ...baseSignal,
        clusterId: "c1",
        clusterLabel: "AI",
        clusterSize: 2,
        clusterLeader: true,
        clusterLaggard: false,
      },
      coinCandles,
      btcCandles,
      T0 + 2 * HOUR
    );
    const laggard = evaluateSignal(
      {
        ...baseSignal,
        symbol: "LAG",
        clusterId: "c1",
        clusterLabel: "AI",
        clusterSize: 2,
        clusterLeader: false,
        clusterLaggard: true,
      },
      coinCandles,
      btcCandles,
      T0 + 2 * HOUR
    );

    const summaries = summarizeByCluster([leader, laggard]);
    expect(summaries).toHaveLength(2);
    expect(summaries.map((summary) => summary.role).sort()).toEqual(["laggard", "leader"]);
    expect(summaries.every((summary) => summary.label === "AI")).toBe(true);
    expect(summaries.every((summary) => summary.horizons[0].n === 1)).toBe(true);
  });

  it("bỏ qua tín hiệu không thuộc cụm", () => {
    const tracked = evaluateSignal(baseSignal, coinCandles, btcCandles, T0 + 2 * HOUR);
    expect(summarizeByCluster([tracked])).toEqual([]);
  });
});

describe("aggregateHorizon", () => {
  function tracked(returnPct: number, win: boolean | null, bias: RadarSignalRecord["bias"] = "continuation"): TrackedSignal {
    const signal = { ...baseSignal, bias };
    return {
      ...signal,
      ageHours: 30,
      horizons: {
        "1h": {
          returnPct,
          btcReturnPct: 0,
          relativePct: returnPct,
          mfePct: Math.max(returnPct, 0) + 1,
          maePct: Math.min(returnPct, 0) - 1,
          tp1Hit: returnPct > 2,
          slHit: returnPct < -2,
          firstEvent: returnPct > 2 ? "tp" : returnPct < -2 ? "sl" : null,
          win,
          pending: false,
        },
      },
    };
  }

  it("tính hit rate, return TB, MFE/MAE và TP/SL rate", () => {
    const summary = aggregateHorizon([tracked(5, true), tracked(-3, false)], "1h");
    expect(summary.n).toBe(2);
    expect(summary.hitRate).toBe(50);
    expect(summary.avgReturnPct).toBe(1);
    expect(summary.avgMfePct).toBe(3.5);
    expect(summary.avgMaePct).toBe(-2.5);
    expect(summary.tp1HitRate).toBe(50);
    expect(summary.slHitRate).toBe(50);
  });

  it("nhóm theo bias và bỏ qua neutral khỏi hit rate", () => {
    const summaries = summarizeByBias([
      tracked(5, true),
      tracked(1, true),
      tracked(2, null, "neutral"),
    ]);
    const continuation = summaries.find((s) => s.bias === "continuation");
    const neutral = summaries.find((s) => s.bias === "neutral");
    expect(continuation?.horizons[0].hitRate).toBe(100);
    expect(neutral?.horizons[0].hitRate).toBeNull();
    expect(neutral?.horizons[0].n).toBe(1);
  });

  it("horizon chưa có dữ liệu trả n=0 và không chia cho 0", () => {
    const summary = aggregateHorizon([], "7d");
    expect(summary.n).toBe(0);
    expect(summary.hitRate).toBeNull();
  });
});

function radarRow(pair: string, bias: RadarRow["bias"], composite: number): RadarRow {
  return { pair, symbol: pair.replace(/USDT$/, ""), bias, composite, score: composite } as unknown as RadarRow;
}

describe("selectCohort", () => {
  it("luôn dành slot neutral dù neutral xếp sau top 12", () => {
    const rows = [
      ...Array.from({ length: 15 }, (_, i) => radarRow(`N${i}USDT`, "continuation", 90 - i)),
      ...Array.from({ length: 5 }, (_, i) => radarRow(`Z${i}USDT`, "neutral", 20 - i)),
    ];
    const selected = selectCohort(rows);
    expect(selected).toHaveLength(12);
    expect(selected.filter((r) => r.bias === "neutral")).toHaveLength(3);
    expect(new Set(selected.map((r) => r.pair)).size).toBe(12);
  });

  it("chỉ có 2 neutral thì lấy cả 2, phần còn lại là non-neutral", () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => radarRow(`N${i}USDT`, "breakout", 80 - i)),
      ...Array.from({ length: 2 }, (_, i) => radarRow(`Z${i}USDT`, "neutral", 10 - i)),
    ];
    const selected = selectCohort(rows);
    expect(selected).toHaveLength(12);
    expect(selected.filter((r) => r.bias === "neutral")).toHaveLength(2);
  });

  it("không phụ thuộc thứ tự rows đầu vào", () => {
    const rows = [
      ...Array.from({ length: 14 }, (_, i) => radarRow(`N${i}USDT`, "continuation", 90 - i)),
      ...Array.from({ length: 4 }, (_, i) => radarRow(`Z${i}USDT`, "neutral", 30 - i)),
    ];
    const a = selectCohort(rows).map((r) => r.pair).sort();
    const b = selectCohort([...rows].reverse()).map((r) => r.pair).sort();
    expect(b).toEqual(a);
  });

  it("ít hơn max thì trả toàn bộ, không nhân bản", () => {
    const rows = [radarRow("AUSDT", "neutral", 5), radarRow("BUSDT", "breakdown", 9)];
    const selected = selectCohort(rows);
    expect(selected).toHaveLength(2);
    expect(new Set(selected.map((r) => r.pair)).size).toBe(2);
  });
});

describe("planCohorts", () => {
  it("ghi đủ 3 side dù người xem đang ở tab nào", () => {
    const plan = planCohorts({
      gainer: [radarRow("GUSDT", "continuation", 80)],
      loser: [radarRow("LUSDT", "breakdown", 70)],
      unusual: [radarRow("UUSDT", "accumulation", 60)],
    });
    expect(plan.filter((p) => p.side === "gainer")).toHaveLength(1);
    expect(plan.filter((p) => p.side === "loser")).toHaveLength(1);
    expect(plan.filter((p) => p.side === "unusual")).toHaveLength(1);
  });

  it("luôn có cohort neutral riêng, dedupe symbol giữa các side", () => {
    const shared = radarRow("ZUSDT", "neutral", 40);
    const plan = planCohorts({
      gainer: [radarRow("GUSDT", "continuation", 80), shared],
      loser: [radarRow("LUSDT", "breakdown", 70), { ...shared }],
      unusual: [radarRow("UUSDT", "accumulation", 60), radarRow("Z2USDT", "neutral", 30)],
    });
    const neutral = plan.filter((p) => p.side === "neutral");
    expect(neutral.map((p) => p.row.pair).sort()).toEqual(["Z2USDT", "ZUSDT"]);
    expect(plan.filter((p) => p.side !== "neutral").every((p) => p.row.bias !== "neutral")).toBe(true);
  });

  it("neutral vẫn có mặt khi chỉ xuất hiện ở side loser", () => {
    const plan = planCohorts({
      gainer: [radarRow("GUSDT", "continuation", 80)],
      loser: [radarRow("LUSDT", "neutral", 20)],
      unusual: [radarRow("UUSDT", "breakout", 60)],
    });
    expect(plan.filter((p) => p.side === "neutral").map((p) => p.row.pair)).toEqual(["LUSDT"]);
  });
});
