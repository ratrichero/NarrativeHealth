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
import { maxDrawdownR, marRatio, profitFactor, sharpePerTrade, wilsonInterval, type WilsonCI } from "./metrics";
import {
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  bootstrapMeanCi,
  bootstrapProbabilityAbove,
  bootstrapProfitFactorCi,
  bootstrapTotalCi,
  summarizeEpisodes,
  type Interval,
} from "./bootstrap";

/** Bumped when the aggregation semantics change (shown on the public page). */
export const TRACK_RECORD_METRICS_VERSION = "track-record-v11";

/** 1R = 1% vốn (rủi ro cố định mỗi lệnh) — cùng đơn vị với % return của benchmark. */
export const RISK_PCT_PER_TRADE = 1;

/** Ngưỡng tối thiểu để câu kết luận "thắng/thua benchmark" được công bố. */
export const MIN_TRADES_FOR_VERDICT = 30;
export const MIN_EPISODES_FOR_VERDICT = 5;

/**
 * Người đọc cần biết con số đã đổi nghĩa gì giữa các lần — changelog công khai
 * thay vì im lặng đổi số. Mới nhất trước.
 */
export const TRACK_RECORD_CHANGELOG: readonly { version: string; note: string }[] = [
  {
    version: "track-record-v11",
    note: "WINDOW-02 (rút gọn) + SNAPSHOT-02: lịch sử và phần forward dùng CHUNG một cửa sổ 20 000 dòng mới nhất (bỏ query forward riêng và `window.forward`). Bản chụp hằng ngày giờ chỉ lưu `payload_hash` + `head_hash` để neo ra ngoài, không còn chuỗi hash nội bộ. Hit-rate/return không đổi; phạm vi đọc (trần rộng hơn) và hình dạng bản chụp thì có.",
  },
  {
    version: "track-record-v9",
    note: "ORIGIN-02: công bố tín hiệu `origin-never-live` trong payload và cảnh báo trên trang khi mọi pick đã chốt đều mang origin backfill dù picked_at chỉ trễ trong ngưỡng — dấu hiệu pipeline dữ liệu luôn chậm một ngày khiến forward record rỗng vĩnh viễn. Số liệu forward không đổi, chỉ lộ nguyên nhân.",
  },
  {
    version: "track-record-v8",
    note: "ORIGIN-01: ghi picked_origin (live/backfill) lúc insert — một lượt chạy bù cho ngày trước không còn được tính là bằng chứng forward chỉ vì picked_at trễ 1 ngày. Origin chỉ có thể hạ nhãn, không bao giờ nâng; hàng cũ (NULL) giữ heuristic cũ. LIVE_SINCE sai định dạng giờ được báo là invalid-env thay vì im lặng. Cần chạy migration 0039 trước khi deploy.",
  },
  {
    version: "track-record-v7",
    note: "Khối forward record neo vào mốc live tường minh (env LIVE_SINCE, so bằng picked_at): chỉ pick được ghi từ mốc live trở đi mới là bằng chứng forward; thiếu LIVE_SINCE thì mốc live suy từ pick forward sớm nhất.",
  },
  {
    version: "track-record-v6",
    note: "Tách track record thành hai phần: kết quả forward kể từ mốc live (pick được ghi đúng ngày dữ liệu, suy từ picked_at) và toàn bộ lịch sử — pick nạp lại (backfill) không còn trộn vào bằng chứng forward.",
  },
  {
    version: "track-record-v5",
    note: "Thêm cổng cỡ mẫu (chưa đủ 30 trade / 5 episode thì không kết luận), alpha so với basket kèm bootstrap CI + xác suất vượt, công bố khi chỉ tính N pick gần nhất, và độ dài drawdown theo thời gian.",
  },
  {
    version: "track-record-v4",
    note: "Thêm Sharpe trên mỗi lệnh và MAR (tổng net R / max drawdown) — profit factor một mình không cho biết đường equity gồ ghề cỡ nào.",
  },
  {
    version: "track-record-v3",
    note: "Thêm bootstrap 95% CI cho avg net R / profit factor và số episode độc lập (pick lặp cùng setup không tính là mẫu mới).",
  },
  {
    version: "track-record-v2",
    note: "Công bố entry fill rate và win rate tách riêng trên các pick thực sự khớp vùng entry.",
  },
  {
    version: "track-record-v1",
    note: "Bản đầu: win rate + Wilson CI, net R sau phí/slippage, drawdown, profit factor.",
  },
];

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
  /**
   * Did price trade back into the entry zone within 3 days? null on rows
   * settled before the column existed (or with no entry levels to test).
   */
  entryFilled: boolean | null;
  /** ISO timestamp of settlement — used for trade ordering (falls back to dataDate). */
  evaluatedAt: string | null;
  /**
   * ISO timestamp of the FIRST write of this pick (`picked_at`). Optional
   * because rows settled before the column existed cannot prove provenance.
   * Forward evidence = a pick written at its own data date; anything written
   * much later was backfilled into history.
   */
  pickedAt?: string | null;
  /**
   * ORIGIN-01 — ý định của lượt ghi (`live` / `backfill`), do đường insert
   * khai báo. Null = hàng cũ trước migration 0039 → dùng heuristic picked_at.
   * Tín hiệu này chỉ có thể HẠ một pick xuống backfill, không bao giờ nâng lên.
   */
  pickedOrigin?: "live" | "backfill" | null;
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
  /** % of direction picks with a recorded fill verdict (null = none recorded). */
  entryFillRate: number | null;
}

/**
 * FILL-01 — entry fill breakdown.
 *
 * Outcomes are measured from `entryMid`, so a pick whose TP is tagged before
 * price ever returns to the entry zone still books a win. That is optimistic:
 * a real trader was never in the trade. Splitting the record by fill state
 * makes the gap visible instead of letting it inflate the headline win rate.
 */
export interface TrackRecordFillStats {
  /** Picks with a recorded fill verdict (denominator of the fill rate). */
  known: number;
  filled: number;
  unfilled: number;
  /** filled / known (%), null when no pick recorded a verdict. */
  rate: number | null;
  /** Resolved trades whose entry actually filled. */
  filledTrades: number;
  filledWins: number;
  filledLosses: number;
  /** Win rate over filled trades only — the tradeable number. */
  filledWinRate: number | null;
  filledWinRateCI: WilsonCI | null;
  /** Resolved trades that never touched the entry zone. */
  unfilledTrades: number;
  unfilledWins: number;
  unfilledLosses: number;
  /** Win rate of trades a real trader could not have taken. */
  unfilledWinRate: number | null;
}

export interface TrackRecordMonth {
  month: string; // YYYY-MM
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgRNet: number | null;
}

export type TrackRecordSampleReason = "no-trades" | "thin-sample";

/**
 * SAMPLE-01 — cỡ mẫu có đủ để công bố kết luận không.
 *
 * Trang công khai trước đây in verdict "đang thắng benchmark" ngay cả khi mới
 * có 5 lệnh. Gate không che số liệu (vẫn hiện đủ), chỉ chặn câu kết luận —
 * "chưa đủ bằng chứng" là thông tin, còn kết luận từ 5 lệnh là thông tin sai.
 */
export interface TrackRecordSample {
  trades: number;
  /** Cỡ mẫu thật: pick lặp cùng symbol+hướng gộp thành một episode. */
  episodes: number;
  minTrades: number;
  minEpisodes: number;
  sufficient: boolean;
  reason: TrackRecordSampleReason | null;
}

/**
 * FORWARD-01 — pick được tạo live hay nạp lại từ lịch sử.
 *
 * `data_date` là ngày của tín hiệu; `picked_at` là lúc hàng được GHI lần đầu.
 * Một hệ thống chạy live ghi pick ngay trong ngày dữ liệu (lệch 0–1 ngày vì
 * job chạy sát nửa đêm UTC). Một lần backfill lịch sử ghi hàng loạt pick cũ
 * trong một ngày hôm nay → lệch rất nhiều. Chỉ pick live mới là bằng chứng
 * forward; pick backfill vẫn hiện trong "toàn bộ lịch sử" nhưng không được
 * trộn vào phần forward.
 */
export const FORWARD_PICK_LAG_DAYS = 1;

export type TrackRecordProvenance = "forward" | "backfill" | "unknown";

/** `YYYY-MM-DD` hợp lệ → giữ nguyên; thiếu/sai định dạng → null (không đoán). */
export function parseLiveSince(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? value : null;
}

/**
 * Phân loại một pick theo mốc live (nếu có) và độ trễ picked_at ~ data_date.
 *
 * `liveSince` là ranh giới tường minh (env LIVE_SINCE): pick được ghi TRƯỚC
 * mốc đó là dữ liệu seed/lịch sử, dù lag tính theo ngày trông nhỏ. Mốc này so
 * trên `picked_at` — thời điểm pick thực sự sinh ra — nên backfill chạy sau
 * mốc live vẫn bị loại bởi quy tắc lag bên dưới.
 */
export function pickProvenance(
  row: { dataDate: string; pickedAt?: string | null; pickedOrigin?: "live" | "backfill" | null },
  options: { liveSince?: string | null } = {}
): TrackRecordProvenance {
  // ORIGIN-01: origin ghi lúc insert là tín hiệu mạnh nhất và đứng trước mọi
  // heuristic. Một lượt chạy bù cho ngày hôm trước có picked_at/data_date y
  // hệt pick live, nên chỉ origin phân biệt được. Origin chỉ hạ nhãn, không
  // nâng: `live` vẫn phải qua mốc LIVE_SINCE và quy tắc lag bên dưới.
  if (row.pickedOrigin === "backfill") return "backfill";
  const pickedDate = row.pickedAt?.slice(0, 10);
  if (!pickedDate || !/^\d{4}-\d{2}-\d{2}$/.test(pickedDate)) return "unknown";
  const liveSince = options.liveSince ?? null;
  if (liveSince && pickedDate < liveSince) return "backfill";
  const lagDays = daysBetween(row.dataDate, pickedDate);
  if (!Number.isFinite(lagDays)) return "unknown";
  // lag âm (picked_at trước data_date) = ghi đúng thời điểm, vẫn là live.
  return lagDays <= FORWARD_PICK_LAG_DAYS ? "forward" : "backfill";
}

/**
 * ORIGIN-02 — origin chưa bao giờ ghi `live` dù pick chỉ trễ trong ngưỡng.
 *
 * Route dashboard đánh dấu `live` chỉ khi `data_date` đúng ngày chạy. Nếu
 * pipeline dữ liệu (nến/health) luôn chậm một ngày thì điều kiện đó không bao
 * giờ đúng: mọi pick thật đều bị ghi `backfill` và forward record rỗng mãi mà
 * không có lỗi nào để lần ra. Hình dạng đó nhận diện được: không có pick
 * forward nào, nhưng MỌI pick backfill có picked_at đều trễ trong ngưỡng lag
 * — nạp lại lịch sử thật thì phải có ít nhất một pick trễ hơn ngưỡng. Tín
 * hiệu này chỉ mô tả, không đổi nhãn của pick nào.
 */
export interface TrackRecordOriginSignal {
  code: "origin-never-live";
  /** Số pick mang provenance backfill (kể cả pick thiếu picked_at). */
  backfilledPicks: number;
  /** Số pick backfill có picked_at trễ trong ngưỡng — cơ sở của tín hiệu. */
  withinGracePicks: number;
  /** Độ trễ nhỏ nhất (ngày) giữa data_date và picked_at trong nhóm đó. */
  minLagDays: number;
}

/** Dưới ngưỡng này thì một lượt chạy bù đơn lẻ chưa đủ kết luận "luôn chậm". */
export const ORIGIN_NEVER_LIVE_MIN_PICKS = 2;

export function originNeverLiveSignal(
  picks: readonly {
    dataDate: string;
    pickedAt?: string | null;
    provenance: TrackRecordProvenance;
  }[]
): TrackRecordOriginSignal | null {
  // Có bằng chứng forward thật → origin đang hoạt động bình thường.
  if (picks.some((pick) => pick.provenance === "forward")) return null;

  const backfilled = picks.filter((pick) => pick.provenance === "backfill");
  if (backfilled.length === 0) return null;

  let withinGracePicks = 0;
  let minLagDays = Infinity;
  for (const pick of backfilled) {
    const pickedDate = pick.pickedAt?.slice(0, 10);
    if (!pickedDate || !/^\d{4}-\d{2}-\d{2}$/.test(pickedDate)) continue;
    const lagDays = daysBetween(pick.dataDate, pickedDate);
    if (!Number.isFinite(lagDays)) continue;
    // Một pick trễ hơn ngưỡng nghĩa là có backfill thật → tín hiệu không kết luận được gì.
    if (lagDays > FORWARD_PICK_LAG_DAYS) return null;
    withinGracePicks += 1;
    if (lagDays < minLagDays) minLagDays = lagDays;
  }

  if (withinGracePicks < ORIGIN_NEVER_LIVE_MIN_PICKS) return null;

  return {
    code: "origin-never-live",
    backfilledPicks: backfilled.length,
    withinGracePicks,
    minLagDays,
  };
}

/**
 * DD-01 — drawdown theo thời gian, bổ sung cho độ sâu (maxR).
 * 20R drawdown trong 3 tuần khác hẳn 20R trong 8 tháng về khả năng chịu đựng.
 */
export interface TrackRecordDrawdown {
  /** Độ sâu lớn nhất (≤ 0) — trùng `maxDrawdownR`. */
  maxR: number;
  /** Chuỗi underwater dài nhất, tính bằng ngày lịch; null khi chưa từng drawdown. */
  maxDays: number | null;
  /** Drawdown hiện tại so với đỉnh gần nhất (≤ 0). */
  currentR: number;
  /** Ngày của đỉnh đang đo drawdown hiện tại; null khi đang ở đỉnh. */
  currentFromDate: string | null;
}

/**
 * ALPHA-01 — chênh lệch so với benchmark kèm bất định.
 *
 * `deltaPct` một mình không nói được là kỹ năng hay nhiễu: bootstrap phân phối
 * tổng net R cho CI của strategy và của delta, cùng xác suất vượt benchmark.
 * 1R = RISK_PCT_PER_TRADE% vốn nên đơn vị khớp với % return của benchmark.
 */
export interface TrackRecordAlpha {
  strategyPct: number;
  benchmarkPct: number;
  deltaPct: number;
  /** Bootstrap 95% CI của strategy %; null khi < 2 lệnh. */
  strategyCI: Interval | null;
  /** CI của delta = strategyCI − benchmarkPct; null khi không ước lượng được. */
  deltaCI: Interval | null;
  /** % lần lấy lại mẫu strategy vượt benchmark (không phải p-value). */
  probOutperform: number | null;
  resamples: number;
  seed: number;
}

export interface BuildTrackRecordOptions {
  /** % return của benchmark (basket) trong cùng cửa sổ; thiếu → không có alpha. */
  benchmarkReturnPct?: number | null;
  minTrades?: number;
  minEpisodes?: number;
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
  /**
   * Sharpe trên mỗi lệnh = avg net R / độ lệch chuẩn net R (chưa annualize).
   * null khi < 2 lệnh hoặc mọi lệnh cùng R (sd = 0).
   */
  sharpePerTrade: number | null;
  /** Tổng net R / |max drawdown R|; null khi chưa có drawdown (chia cho 0). */
  marRatio: number | null;
  longestLosingStreak: number;
  firstDate: string | null;
  lastDate: string | null;
  lastEvaluatedAt: string | null;
  equityCurve: { date: string; cumR: number }[];
  byDirection: TrackRecordDirectionStats[];
  monthly: TrackRecordMonth[];
  /** FILL-01: entry fill rate + win rate split by fill state. */
  fill: TrackRecordFillStats;
  /** SAMPLE-01: đủ mẫu để kết luận chưa. */
  sample: TrackRecordSample;
  /** DD-01: drawdown theo độ sâu lẫn thời gian. */
  drawdown: TrackRecordDrawdown;
  /** ALPHA-01: chênh lệch so với benchmark kèm CI; null khi thiếu benchmark/lệnh. */
  alpha: TrackRecordAlpha | null;
  /** BT-09: độ bất định của kỳ vọng + cỡ mẫu thật (episode). */
  uncertainty: {
    /** Bootstrap 95% CI cho avg net R (R đơn vị), null khi < 2 lệnh. */
    avgRNetCI: Interval | null;
    /** Bootstrap 95% CI cho profit factor, null khi không ước lượng được. */
    profitFactorCI: Interval | null;
    resamples: number;
    seed: number;
    /** Số episode độc lập trong `trades`. */
    episodes: number;
    /** Episode lớn nhất chứa bao nhiêu trade. */
    largestEpisode: number;
  };
  metricsVersion: string;
}

/** BT-10 — một dòng kết quả horizon append-only (gross R, chưa trừ phí). */
export interface TrackRecordHorizonRow {
  horizonDays: number;
  outcome: string | null;
  exitRGross: number | null;
}

export interface TrackRecordHorizonStat {
  days: number;
  picks: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  /** Avg gross R — bảng horizon so hình dạng theo thời gian, không phải P&L. */
  avgRGross: number | null;
}

/**
 * Gom kết quả nhiều horizon thành bảng so sánh. Thuần; horizon không có dòng
 * nào thì không xuất hiện (không bịa số 0).
 */
export function summarizeHorizons(
  rows: readonly TrackRecordHorizonRow[]
): TrackRecordHorizonStat[] {
  const byHorizon = new Map<number, TrackRecordHorizonRow[]>();
  for (const row of rows) {
    const list = byHorizon.get(row.horizonDays);
    if (list) list.push(row);
    else byHorizon.set(row.horizonDays, [row]);
  }

  return [...byHorizon.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([days, group]) => {
      const trades = group.filter((row) => isTrade(row.outcome));
      const wins = trades.filter((row) => isWin(row.outcome)).length;
      const losses = trades.filter((row) => isLoss(row.outcome)).length;
      const rs = trades
        .map((row) => row.exitRGross)
        .filter((v): v is number => v != null);
      return {
        days,
        picks: group.length,
        trades: trades.length,
        wins,
        losses,
        winRate: trades.length > 0 ? +((wins / trades.length) * 100).toFixed(1) : null,
        avgRGross: mean(rs),
      };
    });
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
export function buildTrackRecord(
  rows: readonly TrackRecordPickRow[],
  options: BuildTrackRecordOptions = {}
): TrackRecordSummary {
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
      entryFilled: row.entryFilled,
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
        entryFillRate: g.entryFillRate,
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

  // FILL-01: fill rate over picks that recorded a verdict, then the trade
  // split — filled trades are what a real trader could have taken.
  const fillKnown = rows.filter((r) => r.entryFilled != null);
  const fillFilled = fillKnown.filter((r) => r.entryFilled === true);
  const filledTrades = trades.filter((r) => r.entryFilled === true);
  const unfilledTrades = trades.filter((r) => r.entryFilled === false);
  const filledWins = filledTrades.filter((r) => isWin(r.outcome)).length;
  const filledLosses = filledTrades.filter((r) => isLoss(r.outcome)).length;
  const unfilledWins = unfilledTrades.filter((r) => isWin(r.outcome)).length;
  const unfilledLosses = unfilledTrades.filter((r) => isLoss(r.outcome)).length;

  const episodeSummary = summarizeEpisodes(trades);

  const dates = rows.map((r) => r.dataDate).filter(Boolean).sort();
  const evalTimes = rows
    .map((r) => r.evaluatedAt)
    .filter((v): v is string => v != null)
    .sort();

  const totalRNet = +netRs.reduce((a, b) => a + b, 0).toFixed(2);
  const maxDrawdown = maxDrawdownR(netRs);

  const minTrades = options.minTrades ?? MIN_TRADES_FOR_VERDICT;
  const minEpisodes = options.minEpisodes ?? MIN_EPISODES_FOR_VERDICT;
  const sampleSufficient =
    trades.length >= minTrades && episodeSummary.episodes >= minEpisodes;
  const sample: TrackRecordSample = {
    trades: trades.length,
    episodes: episodeSummary.episodes,
    minTrades,
    minEpisodes,
    sufficient: sampleSufficient,
    reason: sampleSufficient ? null : trades.length === 0 ? "no-trades" : "thin-sample",
  };

  const drawdown = summarizeDrawdown(equityCurve);

  // ALPHA-01: chỉ tính khi có benchmark và ít nhất một lệnh; 1R = RISK % vốn
  // nên tổng net R chính là strategy % ở cùng đơn vị với benchmark.returnPct.
  const benchmarkPct = options.benchmarkReturnPct;
  let alpha: TrackRecordAlpha | null = null;
  if (benchmarkPct != null && Number.isFinite(benchmarkPct) && netRs.length > 0) {
    const strategyPct = +(totalRNet * RISK_PCT_PER_TRADE).toFixed(2);
    const strategyCI = bootstrapTotalCi(netRs);
    alpha = {
      strategyPct,
      benchmarkPct: +benchmarkPct.toFixed(2),
      deltaPct: +(strategyPct - benchmarkPct).toFixed(2),
      strategyCI,
      deltaCI: strategyCI
        ? {
            lo: +(strategyCI.lo - benchmarkPct).toFixed(2),
            hi: +(strategyCI.hi - benchmarkPct).toFixed(2),
          }
        : null,
      probOutperform: bootstrapProbabilityAbove(netRs, benchmarkPct),
      resamples: BOOTSTRAP_RESAMPLES,
      seed: BOOTSTRAP_SEED,
    };
  }

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
    totalRNet,
    maxDrawdownR: maxDrawdown,
    profitFactor: profitFactor(netRs),
    sharpePerTrade: sharpePerTrade(netRs),
    marRatio: marRatio(totalRNet, maxDrawdown),
    longestLosingStreak: longestStreak(ordered),
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    lastEvaluatedAt: evalTimes[evalTimes.length - 1] ?? null,
    equityCurve,
    byDirection,
    monthly,
    fill: {
      known: fillKnown.length,
      filled: fillFilled.length,
      unfilled: fillKnown.length - fillFilled.length,
      rate:
        fillKnown.length > 0
          ? +((fillFilled.length / fillKnown.length) * 100).toFixed(1)
          : null,
      filledTrades: filledTrades.length,
      filledWins,
      filledLosses,
      filledWinRate:
        filledTrades.length > 0
          ? +((filledWins / filledTrades.length) * 100).toFixed(1)
          : null,
      filledWinRateCI: wilsonInterval(filledWins, filledLosses),
      unfilledTrades: unfilledTrades.length,
      unfilledWins,
      unfilledLosses,
      unfilledWinRate:
        unfilledTrades.length > 0
          ? +((unfilledWins / unfilledTrades.length) * 100).toFixed(1)
          : null,
    },
    sample,
    drawdown,
    alpha,
    uncertainty: {
      avgRNetCI: bootstrapMeanCi(netRs),
      profitFactorCI: bootstrapProfitFactorCi(netRs),
      resamples: BOOTSTRAP_RESAMPLES,
      seed: BOOTSTRAP_SEED,
      episodes: episodeSummary.episodes,
      largestEpisode: episodeSummary.largest,
    },
    metricsVersion: TRACK_RECORD_METRICS_VERSION,
  };
}

/**
 * DD-01 — drawdown theo thời gian từ equity curve (cumR theo ngày chốt).
 *
 * `maxR` = đáy sâu nhất so với đỉnh (trùng maxDrawdownR). `maxDays` = chuỗi
 * ngày lịch dài nhất mà equity còn dưới đỉnh trước đó — thước đo "phải chịu
 * đựng bao lâu", thứ mà độ sâu R một mình không nói. `currentR`/`currentFromDate`
 * cho biết hiện đang underwater hay đã hồi. Thuần, không I/O.
 */
export function summarizeDrawdown(
  curve: readonly { date: string; cumR: number }[]
): TrackRecordDrawdown {
  if (curve.length === 0) {
    return { maxR: 0, maxDays: null, currentR: 0, currentFromDate: null };
  }

  let peak = 0;
  let peakDate = curve[0].date;
  let underwaterStart: string | null = null;
  let maxDays: number | null = null;
  let worst = 0;

  for (const point of curve) {
    if (point.cumR >= peak) {
      peak = point.cumR;
      peakDate = point.date;
      underwaterStart = null;
      continue;
    }
    if (underwaterStart == null) underwaterStart = peakDate;
    const days = daysBetween(underwaterStart, point.date);
    if (maxDays == null || days > maxDays) maxDays = days;
    const dd = point.cumR - peak;
    if (dd < worst) worst = dd;
  }

  const last = curve[curve.length - 1];
  const currentR = +(last.cumR - peak).toFixed(2);
  return {
    maxR: +worst.toFixed(2),
    maxDays,
    currentR,
    currentFromDate: currentR < 0 ? peakDate : null,
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
