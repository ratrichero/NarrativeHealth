// RADAR-BACKTEST — so toàn pipeline radar với hai mốc nền.
//
// Track record radar hiện chỉ khoe hit-rate. Hit-rate 58% không nói được gì nếu
// cả thị trường tăng và chọn ngẫu nhiên 3 coin/ngày cũng thắng 57%. Module này
// trả lời ba câu cùng lúc trên đúng một horizon:
//   • Chiến lược (các row actionable) lãi bao nhiêu?
//   • Basket equal-weight *mọi row được chấm* lãi bao nhiêu? (mốc "cứ mua đều")
//   • Chọn ngẫu nhiên cùng số row mỗi ngày, lặp N lần, phân phối ra sao?
// Từ đó có alpha so với basket và xác suất vượt random — hai thứ không thể suy
// từ win-rate.
//
// Thuần + deterministic (seed cố định): cùng dữ liệu → cùng kết quả, để trang
// công khai không "nhảy số" giữa hai lần tải.

import { ratioWithWilson } from "@/lib/stats/wilson";

export const RADAR_BACKTEST_VERSION = "radar-backtest-v1";
export const RADAR_BACKTEST_TRIALS = 1000;
export const RADAR_BACKTEST_SEED = 20260214;
/** Dưới ngưỡng này chưa kết luận gì (chỉ báo "chưa đủ mẫu"). */
export const RADAR_BACKTEST_MIN_PICKS = 10;

export interface RadarBacktestObservation {
  /** Ngày của tín hiệu (YYYY-MM-DD) — random baseline chọn theo ngày. */
  day: string;
  symbol: string;
  bias: string;
  actionable: boolean;
  /** Return đã đổi dấu theo chiều nhãn (%), đo ở horizon đang xét. */
  edgePct: number;
}

export interface BaselineDistribution {
  meanPct: number;
  p5Pct: number;
  p95Pct: number;
}

export interface RadarBacktestResult {
  version: string;
  actionablePicks: number;
  days: number;
  strategy: {
    totalPct: number;
    avgPct: number | null;
    hitRate: number | null;
    ciLow: number | null;
    ciHigh: number | null;
  };
  /** Equal-weight mọi row được chấm (không lọc actionable). */
  basket: {
    picks: number;
    avgPct: number | null;
    totalPct: number;
  };
  /**
   * Chọn ngẫu nhiên đúng số row actionable mỗi ngày từ pool của ngày đó.
   * null khi không đủ dữ liệu để mô phỏng.
   */
  random: (BaselineDistribution & { trials: number; seed: number; probBeats: number | null }) | null;
  alphaVsBasketPct: number | null;
  alphaVsRandomPct: number | null;
  verdict: "insufficient" | "beats-both" | "beats-basket-only" | "lags";
}

/** mulberry32 — RNG nhỏ, deterministic, đủ cho mô phỏng chọn ngẫu nhiên. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[index];
}

const round2 = (value: number): number => +value.toFixed(2);

/**
 * `observations` phải là MỘT horizon. Row thiếu `edgePct` hữu hạn bị bỏ — không
 * coi là 0 (0 là một kết quả, thiếu dữ liệu thì không).
 */
export function buildRadarBacktest(
  observations: readonly RadarBacktestObservation[],
  options: { trials?: number; seed?: number } = {}
): RadarBacktestResult {
  const trials = Number.isFinite(options.trials)
    ? Math.max(1, Math.floor(options.trials as number))
    : RADAR_BACKTEST_TRIALS;
  const seed = Number.isFinite(options.seed) ? Math.floor(options.seed as number) : RADAR_BACKTEST_SEED;

  const valid = observations.filter(
    (obs) => obs && Number.isFinite(obs.edgePct) && typeof obs.day === "string"
  );
  const actionable = valid.filter((obs) => obs.actionable);
  const days = new Set(valid.map((obs) => obs.day)).size;

  const strategyTotal = actionable.reduce((sum, obs) => sum + obs.edgePct, 0);
  const strategyAvg = actionable.length > 0 ? strategyTotal / actionable.length : null;
  const strategyWinRate = ratioWithWilson(
    actionable.filter((obs) => obs.edgePct > 0).length,
    actionable.length
  );

  const basketTotal = valid.reduce((sum, obs) => sum + obs.edgePct, 0);
  const basketAvg = valid.length > 0 ? basketTotal / valid.length : null;

  if (actionable.length < RADAR_BACKTEST_MIN_PICKS || valid.length === 0) {
    return {
      version: RADAR_BACKTEST_VERSION,
      actionablePicks: actionable.length,
      days,
      strategy: {
        totalPct: round2(strategyTotal),
        avgPct: strategyAvg == null ? null : round2(strategyAvg),
        hitRate: strategyWinRate ? round2(strategyWinRate.rate) : null,
        ciLow: strategyWinRate ? round2(strategyWinRate.interval.low) : null,
        ciHigh: strategyWinRate ? round2(strategyWinRate.interval.high) : null,
      },
      basket: {
        picks: valid.length,
        avgPct: basketAvg == null ? null : round2(basketAvg),
        totalPct: round2(basketTotal),
      },
      random: null,
      alphaVsBasketPct: null,
      alphaVsRandomPct: null,
      verdict: "insufficient",
    };
  }

  // Pool theo ngày + số actionable mỗi ngày (cùng phân bố với chiến lược).
  const byDay = new Map<string, number[]>();
  const picksPerDay = new Map<string, number>();
  for (const obs of valid) {
    const pool = byDay.get(obs.day) ?? [];
    pool.push(obs.edgePct);
    byDay.set(obs.day, pool);
  }
  for (const obs of actionable) {
    picksPerDay.set(obs.day, (picksPerDay.get(obs.day) ?? 0) + 1);
  }

  const rng = mulberry32(seed);
  const totals: number[] = [];
  for (let trial = 0; trial < trials; trial += 1) {
    let total = 0;
    for (const [day, count] of picksPerDay) {
      const pool = byDay.get(day) ?? [];
      if (pool.length === 0 || count <= 0) continue;
      // Lấy mẫu không hoàn lại trong ngày, cho phép trùng giữa các ngày.
      const indices = new Set<number>();
      const wanted = Math.min(count, pool.length);
      let guard = 0;
      while (indices.size < wanted && guard < pool.length * 10) {
        indices.add(Math.floor(rng() * pool.length));
        guard += 1;
      }
      for (const index of indices) total += pool[index];
    }
    totals.push(total);
  }
  totals.sort((a, b) => a - b);
  const randomMean = totals.reduce((sum, value) => sum + value, 0) / totals.length;
  const probBeats =
    totals.length > 0
      ? +(totals.filter((total) => total < strategyTotal).length / totals.length).toFixed(3)
      : null;

  const alphaVsBasketPct =
    basketAvg == null || strategyAvg == null ? null : round2(strategyAvg - basketAvg);
  // Alpha so với random dùng cùng quy mô: chênh trung bình mỗi lần chọn.
  const randomAvgPerPick =
    totals.length > 0
      ? randomMean / Math.max(1, actionable.length)
      : null;
  const alphaVsRandomPct =
    strategyAvg == null || randomAvgPerPick == null
      ? null
      : round2(strategyAvg - randomAvgPerPick);

  const beatsBasket = alphaVsBasketPct != null && alphaVsBasketPct > 0;
  const beatsRandom = probBeats != null && probBeats >= 0.95;

  return {
    version: RADAR_BACKTEST_VERSION,
    actionablePicks: actionable.length,
    days,
    strategy: {
      totalPct: round2(strategyTotal),
      avgPct: strategyAvg == null ? null : round2(strategyAvg),
      hitRate: strategyWinRate ? round2(strategyWinRate.rate) : null,
      ciLow: strategyWinRate ? round2(strategyWinRate.interval.low) : null,
      ciHigh: strategyWinRate ? round2(strategyWinRate.interval.high) : null,
    },
    basket: {
      picks: valid.length,
      avgPct: basketAvg == null ? null : round2(basketAvg),
      totalPct: round2(basketTotal),
    },
    random: {
      trials,
      seed,
      meanPct: round2(randomMean),
      p5Pct: round2(percentile(totals, 5)),
      p95Pct: round2(percentile(totals, 95)),
      probBeats,
    },
    alphaVsBasketPct,
    alphaVsRandomPct,
    verdict: beatsBasket && beatsRandom ? "beats-both" : beatsBasket ? "beats-basket-only" : "lags",
  };
}
