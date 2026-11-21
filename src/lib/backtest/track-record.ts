// TRACK-01 — Public track record aggregation (pure, no I/O).
//
// The admin Backtest tab measures whether the system's picks work, but those
// numbers live behind admin auth. This module turns the SAME settled picks into
// a public, verifiable summary: win rate with a Wilson confidence interval,
// NET R (fee + slippage aware) as well as gross, max drawdown, profit factor and
// the losing streak — the numbers that answer "is this system survivable?".
//
// Design rules (mirrors BT-07 honesty semantics):
//   * Numbers are DERIVED, never invented: NO_HIT / NO_SETUP / NO_DATA are not
//     trades and never enter the win rate (a missing trade is not a win).
//   * Net R is computed at read time from exitR − costR; the DB keeps gross R.
//   * A thin sample is reported with a wide confidence interval, not hidden.
//   * Pure + deterministic → unit-testable without a database.

import { aggregateOutcomes, daysBetween, type GroupStats, type PickOutcome } from "./engine";
import { maxDrawdownR, profitFactor, wilsonInterval, type WilsonCI } from "./metrics";

/** Bumped when the aggregation semantics change (shown on the public page). */
export const TRACK_RECORD_METRICS_VERSION = "track-record-v1";

/** One settled pick as read from `top_recommendation_picks`. */
export interface TrackRecordPickRow {
  dataDate: string;
  symbol: string;
  direction: string;
  /** TP1_WIN | TP2_WIN | SL_LOSS | NO_HIT | NO_SETUP | NO_DATA | null */
  outcome: string | null;
  /** EVALUATED | EXPIRED | SKIPPED */
  status: string;
  exitRGross: number | null;
  exitRNet: number | null;
  /** ISO timestamp of settlement — used for trade ordering (falls back to dataDate). */
  evaluatedAt: string | null;
}

export interface TrackRecordDirectionStats {
  direction: string;
  picks: number;
  trades: number;
  wins: number;
  losses: number;
  noHit: number;
  winRate: number | null;
  avgRNet: number | null;
}

export interface TrackRecordMonth {
  month: string; // YYYY-MM
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgRNet: number | null;
}

export interface TrackRecordSummary {
  totals: {
    picks: number;
    /** Resolved trades = TP1_WIN + TP2_WIN + SL_LOSS. */
    trades: number;
    wins: number;
    losses: number;
    noHit: number;
    skipped: number;
  };
  /** % over resolved trades; null when no trade resolved yet. */
  winRate: number | null;
  /** Wilson 95% interval on the win rate (%), null when no trade. */
  winRateCI: WilsonCI | null;
  avgRNet: number | null;
  avgRGross: number | null;
  /** Sum of net R across all resolved trades. */
  totalRNet: number;
  maxDrawdownR: number;
  profitFactor: number | null;
  longestLosingStreak: number;
  firstDate: string | null;
  lastDate: string | null;
  lastEvaluatedAt: string | null;
  equityCurve: { date: string; cumR: number }[];
  byDirection: TrackRecordDirectionStats[];
  monthly: TrackRecordMonth[];
  metricsVersion: string;
}

const WINS = new Set(["TP1_WIN", "TP2_WIN"]);
const LOSSES = "SL_LOSS";
const NO_HIT = "NO_HIT";
const SKIPPED = "SKIPPED";

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);

const isWin = (o: string | null): boolean => o != null && WINS.has(o);
const isLoss = (o: string | null): boolean => o === LOSSES;
const isTrade = (o: string | null): boolean => isWin(o) || isLoss(o);

/** Resolution day (ISO date) for ordering — settlement time, else the pick date. */
function resolutionDate(row: TrackRecordPickRow): string {
  return (row.evaluatedAt ?? row.dataDate).slice(0, 10);
}

/**
 * Build the public track-record summary from settled picks.
 *
 * Ordering for the equity curve, drawdown and losing streak is by resolution
 * time (settlement timestamp, falling back to the data date), which is how the
 * trades actually landed in sequence.
 */
export function buildTrackRecord(rows: readonly TrackRecordPickRow[]): TrackRecordSummary {
  const wins = rows.filter((r) => isWin(r.outcome));
  const losses = rows.filter((r) => isLoss(r.outcome));
  const noHit = rows.filter((r) => r.outcome === NO_HIT);
  const skipped = rows.filter((r) => r.status === SKIPPED);
  const trades = rows.filter((r) => isTrade(r.outcome));

  const ordered = [...trades].sort((a, b) => {
    const da = resolutionDate(a);
    const db = resolutionDate(b);
    if (da !== db) return da < db ? -1 : 1;
    return a.dataDate < b.dataDate ? -1 : a.dataDate > b.dataDate ? 1 : 0;
  });

  const netRs: number[] = [];
  const grossRs: number[] = [];
  for (const t of ordered) {
    if (t.exitRNet != null) netRs.push(t.exitRNet);
    if (t.exitRGross != null) grossRs.push(t.exitRGross);
  }

  // Equity curve: cumulative NET R after each trade, in resolution order.
  let cum = 0;
  const equityCurve = ordered.map((t) => {
    cum += t.exitRNet ?? 0;
    return { date: resolutionDate(t), cumR: +cum.toFixed(2) };
  });

  // Direction breakdown — reuse the BT-02 aggregation on net-R-mapped outcomes
  // so the table matches the admin after-costs view.
  const byDirectionMap = new Map<string, PickOutcome[]>();
  for (const row of rows) {
    const mapped: PickOutcome = {
      pickId: 0,
      dataDate: row.dataDate,
      coinId: 0,
      symbol: row.symbol,
      direction: row.direction,
      signal: "",
      healthScore: null,
      pickKind: "GENUINE",
      entryMid: null,
      outcome: (row.outcome as PickOutcome["outcome"]) ?? "INVALID",
      exitR: row.exitRNet,
      hitDay: null,
      mfePct: null,
      maePct: null,
      entryFilled: null,
    };
    const arr = byDirectionMap.get(row.direction);
    if (arr) arr.push(mapped);
    else byDirectionMap.set(row.direction, [mapped]);
  }
  const byDirection: TrackRecordDirectionStats[] = [...byDirectionMap.entries()]
    .map(([direction, outcomes]) => {
      const g: GroupStats = aggregateOutcomes(direction, outcomes);
      return {
        direction,
        picks: g.picks,
        trades: g.tp1Wins + g.tp2Wins + g.slLosses,
        wins: g.tp1Wins + g.tp2Wins,
        losses: g.slLosses,
        noHit: g.noHit,
        winRate: g.winRate,
        avgRNet: g.avgR,
      };
    })
    .sort((a, b) => b.trades - a.trades || a.direction.localeCompare(b.direction));

  // Monthly buckets keyed by the pick date (when the signal fired).
  const monthMap = new Map<string, { netRs: number[]; wins: number; losses: number }>();
  for (const row of rows) {
    if (!isTrade(row.outcome)) continue;
    const month = row.dataDate.slice(0, 7);
    const bucket = monthMap.get(month) ?? { netRs: [], wins: 0, losses: 0 };
    if (isWin(row.outcome)) bucket.wins++;
    else bucket.losses++;
    if (row.exitRNet != null) bucket.netRs.push(row.exitRNet);
    monthMap.set(month, bucket);
  }
  const monthly: TrackRecordMonth[] = [...monthMap.entries()]
    .map(([month, b]) => ({
      month,
      trades: b.wins + b.losses,
      wins: b.wins,
      losses: b.losses,
      winRate: b.wins + b.losses > 0 ? +((b.wins / (b.wins + b.losses)) * 100).toFixed(1) : null,
      avgRNet: mean(b.netRs),
    }))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

  const dates = rows.map((r) => r.dataDate).filter(Boolean).sort();
  const evalTimes = rows
    .map((r) => r.evaluatedAt)
    .filter((v): v is string => v != null)
    .sort();

  return {
    totals: {
      picks: rows.length,
      trades: trades.length,
      wins: wins.length,
      losses: losses.length,
      noHit: noHit.length,
      skipped: skipped.length,
    },
    winRate:
      trades.length > 0 ? +((wins.length / trades.length) * 100).toFixed(1) : null,
    winRateCI: wilsonInterval(wins.length, losses.length),
    avgRNet: mean(netRs),
    avgRGross: mean(grossRs),
    totalRNet: +netRs.reduce((a, b) => a + b, 0).toFixed(2),
    maxDrawdownR: maxDrawdownR(netRs),
    profitFactor: profitFactor(netRs),
    longestLosingStreak: longestStreak(ordered),
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    lastEvaluatedAt: evalTimes[evalTimes.length - 1] ?? null,
    equityCurve,
    byDirection,
    monthly,
    metricsVersion: TRACK_RECORD_METRICS_VERSION,
  };
}

// ─── FRESH-01: staleness of the public record ────────────────────────────
//
// A track record is only evidence while it keeps moving. The page used to
// claim "cập nhật hằng ngày" forever, even when the settlement job stopped and
// the newest settled pick was weeks old. These thresholds turn that into an
// explicit warning instead of a silent lie.
//
// Two clocks, because they fail differently:
//   * `lastEvaluatedAt` — settlement stamps a pick the moment its window
//     closes, so in a healthy deployment some pick closes almost every day and
//     the stamp stays recent. Horizon-independent: a 60-day window delays
//     WHICH pick closes, not WHEN the write happens.
//   * `lastDate` — what the numbers COVER. Its age legitimately trails by the
//     configured horizon (a fresh 60-day record's newest pick is ~60 days old),
//     so it is only compared against horizon + grace, never a fixed limit.

/** Grace on top of the horizon before a missing new pick is a warning. */
export const STALE_SETTLEMENT_AFTER_DAYS = 5;

/** Horizon assumed when the caller does not pass the one the record uses. */
export const DEFAULT_FRESHNESS_HORIZON_DAYS = 14;

export type TrackRecordStaleness =
  | "no-settlement-stamp"
  | "settlement-old"
  | "pick-pipeline-old";

export interface TrackRecordFreshness {
  stale: boolean;
  reason: TrackRecordStaleness | null;
  /** Age of the newest settled pick date, in days. */
  pickAgeDays: number | null;
  /** Age of the most recent settlement stamp, in days (null = never stamped). */
  settlementAgeDays: number | null;
  /** Newest pick age a healthy record may have: horizon + grace. */
  pickLimitDays: number;
}

/**
 * Is the public record still being updated? `today` is the business date
 * (YYYY-MM-DD) and `horizonDays` the longest horizon the record covers (30/60
 * on long-window deployments). An empty record is "accumulating", not stale.
 */
export function trackRecordFreshness(
  summary: Pick<TrackRecordSummary, "totals" | "lastDate" | "lastEvaluatedAt">,
  today: string,
  horizonDays: number = DEFAULT_FRESHNESS_HORIZON_DAYS
): TrackRecordFreshness {
  const horizon =
    Number.isFinite(horizonDays) && horizonDays > 0
      ? horizonDays
      : DEFAULT_FRESHNESS_HORIZON_DAYS;
  const pickAgeDays = summary.lastDate ? daysBetween(summary.lastDate, today) : null;
  const settlementAgeDays = summary.lastEvaluatedAt
    ? daysBetween(summary.lastEvaluatedAt.slice(0, 10), today)
    : null;
  const pickLimitDays = horizon + STALE_SETTLEMENT_AFTER_DAYS;
  const base = { pickAgeDays, settlementAgeDays, pickLimitDays };

  if (summary.totals.picks === 0) return { ...base, stale: false, reason: null };

  // Results exist but nothing was ever stamped: the record cannot prove it is
  // still being updated — exactly the state that rendered as "daily update".
  if (settlementAgeDays === null) {
    return { ...base, stale: true, reason: "no-settlement-stamp" };
  }
  if (settlementAgeDays > STALE_SETTLEMENT_AFTER_DAYS) {
    return { ...base, stale: true, reason: "settlement-old" };
  }
  // Settlement keeps stamping (some other horizon still closes) while no new
  // pick arrives: the numbers are frozen even though the job looks alive.
  if (pickAgeDays != null && pickAgeDays > pickLimitDays) {
    return { ...base, stale: true, reason: "pick-pipeline-old" };
  }
  return { ...base, stale: false, reason: null };
}

/** Longest consecutive run of SL_LOSS in resolution order. */
function longestStreak(ordered: readonly TrackRecordPickRow[]): number {
  let best = 0;
  let cur = 0;
  for (const row of ordered) {
    if (row.outcome === LOSSES) {
      cur++;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}
