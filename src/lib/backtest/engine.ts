// BT-02: Pure backtest engine — no DB, no I/O. Consumes persisted picks
// (top_recommendation_picks, BT-01) joined with daily OHLC rows and computes
// per-pick outcomes (TP1/TP2/SL hits, MFE/MAE, entry-zone fill) plus grouped
// aggregates. Conventions mirror the Square/top-rec setup math: for BEARISH
// picks favorable excursion = entryMid - low, adverse = high - entryMid.
//
// Conservative rule: if TP and SL are both reached on the same daily candle,
// the pick is counted as an SL loss (a daily candle cannot tell which came
// first — assume the worst).

export interface BacktestPickInput {
  pickId: number;
  dataDate: string; // YYYY-MM-DD
  coinId: number;
  symbol: string;
  direction: string; // BULLISH | BEARISH
  signal: string;
  healthScore: number | null;
  entryLow: number | null;
  entryHigh: number | null;
  entryMid: number | null;
  tp1: number | null;
  tp2: number | null;
  stopLoss: number | null;
  riskRewardRatio: number | null;
  pickKind: string; // GENUINE | FILL_LONG | FILL_SHORT
}

export interface BacktestPriceRow {
  date: string; // YYYY-MM-DD
  high: number;
  low: number;
}

export type BacktestOutcome = "TP1_WIN" | "TP2_WIN" | "SL_LOSS" | "NO_HIT" | "OPEN" | "INVALID";

export interface PickOutcome {
  pickId: number;
  dataDate: string;
  coinId: number;
  symbol: string;
  direction: string;
  signal: string;
  healthScore: number | null;
  pickKind: string;
  entryMid: number | null;
  outcome: BacktestOutcome; // NO_HIT = final when horizonClosed; OPEN = window still running
  exitR: number | null; // realized multiple of risk (1R = entryMid↔SL distance)
  hitDay: number | null; // 1-based day index when outcome resolved
  mfePct: number | null; // max favorable excursion, % of entryMid, over horizon
  maePct: number | null; // max adverse excursion, % of entryMid, over horizon
  entryFilled: boolean | null; // price touched the entry zone within 3 days
}

export interface GroupStats {
  group: string;
  picks: number;
  tp1Wins: number;
  tp2Wins: number;
  slLosses: number;
  noHit: number;
  open: number;
  winRate: number | null; // wins / (wins + losses), OPEN excluded
  avgR: number | null; // avg realized R over resolved picks (SL = -1)
  avgDaysToExit: number | null;
  entryFillRate: number | null;
  avgMfePct: number | null;
  avgMaePct: number | null;
}

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);

/** Compute the outcome of one pick against forward daily candles. */
export interface ComputeOutcomeOptions {
  /**
   * BT-03: true when the pick's horizon window has fully elapsed (today is
   * past dataDate + horizon calendar days). When true, a horizon without a
   * TP/SL hit becomes a final NO_HIT instead of a transient OPEN.
   */
  horizonClosed?: boolean;
}

export function computePickOutcome(
  pick: BacktestPickInput,
  priceRows: BacktestPriceRow[], // ascending by date, may include the pick day
  horizonDays: number,
  options: ComputeOutcomeOptions = {}
): PickOutcome {
  const base: PickOutcome = {
    pickId: pick.pickId,
    dataDate: pick.dataDate,
    coinId: pick.coinId,
    symbol: pick.symbol,
    direction: pick.direction,
    signal: pick.signal,
    healthScore: pick.healthScore,
    pickKind: pick.pickKind,
    entryMid: pick.entryMid,
    outcome: "INVALID",
    exitR: null,
    hitDay: null,
    mfePct: null,
    maePct: null,
    entryFilled: null,
  };

  if (
    pick.entryMid == null || pick.entryMid <= 0 ||
    pick.tp1 == null || pick.stopLoss == null
  ) {
    return base;
  }

  const bullish = pick.direction === "BULLISH";
  const sign = bullish ? 1 : -1;
  const entryMid = pick.entryMid;
  const tp1Dist = Math.abs(pick.tp1 - entryMid);
  const tp2Dist = pick.tp2 != null ? Math.abs(pick.tp2 - entryMid) : null;
  const slDist = Math.abs(entryMid - pick.stopLoss);
  if (slDist <= 0) return base;

  // Forward candles strictly after the pick's data date, up to horizon.
  const forward = priceRows
    .filter((r) => r.date > pick.dataDate)
    .slice(0, horizonDays);
  if (forward.length === 0) {
    return { ...base, outcome: "OPEN" };
  }

  let mfe = 0;
  let mae = 0;
  let entryFilled = false;
  const entryExtreme = bullish ? pick.entryHigh : pick.entryLow;

  for (let i = 0; i < forward.length; i++) {
    const row = forward[i];
    const favMove = bullish ? row.high - entryMid : entryMid - row.low;
    const advMove = bullish ? entryMid - row.low : row.high - entryMid;
    if (favMove > mfe) mfe = favMove;
    if (advMove > mae) mae = advMove;

    // Entry-zone fill: price traded back into [entryLow, entryHigh].
    if (!entryFilled && entryExtreme != null && i < 3) {
      entryFilled = bullish ? row.low <= entryExtreme : row.high >= entryExtreme;
    }

    const hitTp1 = favMove >= tp1Dist;
    const hitTp2 = tp2Dist != null && favMove >= tp2Dist;
    const hitSl = advMove >= slDist;

    if (hitSl) {
      // Same-candle TP+SL → assume SL (conservative).
      return {
        ...base,
        outcome: "SL_LOSS",
        exitR: -1,
        hitDay: i + 1,
        mfePct: +((mfe / entryMid) * 100).toFixed(2),
        maePct: +((mae / entryMid) * 100).toFixed(2),
        entryFilled,
      };
    }
    if (hitTp2) {
      return {
        ...base,
        outcome: "TP2_WIN",
        exitR: +(tp2Dist / slDist).toFixed(2),
        hitDay: i + 1,
        mfePct: +((mfe / entryMid) * 100).toFixed(2),
        maePct: +((mae / entryMid) * 100).toFixed(2),
        entryFilled,
      };
    }
    if (hitTp1) {
      return {
        ...base,
        outcome: "TP1_WIN",
        exitR: +(tp1Dist / slDist).toFixed(2),
        hitDay: i + 1,
        mfePct: +((mfe / entryMid) * 100).toFixed(2),
        maePct: +((mae / entryMid) * 100).toFixed(2),
        entryFilled,
      };
    }
  }

  const horizonClosed = options.horizonClosed ?? false;
  const mfePct = +((mfe / entryMid) * 100).toFixed(2);
  const maePct = +((mae / entryMid) * 100).toFixed(2);
  const entryFilledOut = entryFilled;

  // BT-03: if the full horizon has elapsed without TP/SL, the result is final
  // (NO_HIT) — a later run with the same horizon must reach the same verdict.
  // Otherwise the pick is still OPEN (window not closed; stay PENDING).
  return horizonClosed
    ? { ...base, outcome: "NO_HIT", mfePct, maePct, entryFilled: entryFilledOut }
    : { ...base, outcome: "OPEN", mfePct, maePct, entryFilled: entryFilledOut };
}

/** Aggregate a list of outcomes into one stats row. */
export function aggregateOutcomes(group: string, outcomes: PickOutcome[]): GroupStats {
  const resolved = outcomes.filter((o) => o.outcome !== "OPEN" && o.outcome !== "INVALID" && o.outcome !== "NO_HIT");
  const wins = resolved.filter((o) => o.outcome !== "SL_LOSS");
  const losses = resolved.filter((o) => o.outcome === "SL_LOSS");
  const fills = outcomes.map((o) => o.entryFilled).filter((f): f is boolean => f != null);
  const mfes = outcomes.map((o) => o.mfePct).filter((v): v is number => v != null);
  const maes = outcomes.map((o) => o.maePct).filter((v): v is number => v != null);
  const days = resolved.map((o) => o.hitDay).filter((v): v is number => v != null);
  const rs = resolved.map((o) => o.exitR).filter((v): v is number => v != null);

  return {
    group,
    picks: outcomes.length,
    tp1Wins: wins.filter((o) => o.outcome === "TP1_WIN").length,
    tp2Wins: wins.filter((o) => o.outcome === "TP2_WIN").length,
    slLosses: losses.length,
    noHit: outcomes.filter((o) => o.outcome === "NO_HIT").length,
    open: outcomes.filter((o) => o.outcome === "OPEN").length,
    winRate: wins.length + losses.length > 0
      ? +((wins.length / (wins.length + losses.length)) * 100).toFixed(1)
      : null,
    avgR: mean(rs),
    avgDaysToExit: mean(days),
    entryFillRate: fills.length > 0
      ? +((fills.filter(Boolean).length / fills.length) * 100).toFixed(1)
      : null,
    avgMfePct: mean(mfes),
    avgMaePct: mean(maes),
  };
}

/**
 * BT-04 — Same-episode test: a re-render is a REPEAT of an earlier pick when
 * coin, direction, setup-availability and all setup levels are (nearly)
 * unchanged. Levels use a relative tolerance — small drift between close
 * refreshes is market noise, not a new setup.
 *
 * Crypto dao động mạnh nên tolerance mặc định là 3% (không phải 1%): altcoin
 * chạy 3–5% trong vài giờ vẫn là “cùng setup” nếu cấu trúc entry/TP/SL không
 * đổi. Tinh chỉnh qua env BT_EPISODE_TOLERANCE_PCT (%, mặc định 3, kẹp 0.5–20)
 * mà không cần sửa code.
 */
function episodeTolerance(): number {
  // `?? 3` không bắt được env rỗng ("" là giá trị hợp lệ của process.env),
  // mà Number("") === 0 → clamp về 0.5% (chặt hơn bản cũ). Coi rỗng/whitespace
  // như chưa set để luôn về default 3%.
  const raw = process.env.BT_EPISODE_TOLERANCE_PCT;
  const pct = raw == null || raw.trim() === "" ? 3 : Number(raw);
  const clamped = Number.isFinite(pct) ? Math.min(20, Math.max(0.5, pct)) : 3;
  return clamped / 100;
}
export function isSameSetupEpisode(
  prev: {
    direction: string;
    hasSetup: boolean;
    entryLow: number | string | null;
    entryHigh: number | string | null;
    entryMid: number | string | null;
    tp1: number | string | null;
    tp2: number | string | null;
    stopLoss: number | string | null;
  },
  next: {
    direction: string;
    hasSetup: boolean;
    entryLow: number | string | null;
    entryHigh: number | string | null;
    entryMid: number | string | null;
    tp1: number | string | null;
    tp2: number | string | null;
    stopLoss: number | string | null;
  }
): boolean {
  if (prev.direction !== next.direction) return false;
  if (prev.hasSetup !== next.hasSetup) return false;
  if (!next.hasSetup) return true; // no-setup picks: same direction = same episode

  const close = (a: number | string | null, b: number | string | null): boolean => {
    if (a == null || b == null) return a == null && b == null;
    const av = Number(a);
    const bv = Number(b);
    if (!Number.isFinite(av) || !Number.isFinite(bv) || av <= 0) return false;
    return Math.abs(av - bv) / av <= episodeTolerance(); // default 3% (env BT_EPISODE_TOLERANCE_PCT)
  };

  return (
    close(prev.entryLow, next.entryLow) &&
    close(prev.entryHigh, next.entryHigh) &&
    close(prev.entryMid, next.entryMid) &&
    close(prev.tp1, next.tp1) &&
    close(prev.tp2, next.tp2) &&
    close(prev.stopLoss, next.stopLoss)
  );
}

/**
 * BT-03: a pick's horizon window is closed when today's date (business date,
 * Asia/Ho_Chi_Minh semantics via plain calendar math) is at least `horizon`
 * calendar days after the pick's data date.
 */
export function isHorizonClosed(dataDate: string, horizonDays: number, today: string): boolean {
  const t = new Date(today + "T00:00:00Z").getTime();
  const d = new Date(dataDate + "T00:00:00Z").getTime();
  if (!Number.isFinite(t) || !Number.isFinite(d)) return false;
  return t - d >= horizonDays * 86400_000;
}

/** Pearson correlation between two parallel sample arrays; null when degenerate. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 5 || n !== ys.length) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx <= 0 || vy <= 0) return null;
  return +(cov / Math.sqrt(vx * vy)).toFixed(3);
}
