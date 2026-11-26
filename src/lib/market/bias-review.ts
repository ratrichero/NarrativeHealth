// RADAR-BIAS-REVIEW: đọc `radar_bias_log` + `radar_bias_outcome` để trả lời hai
// câu hỏi mà bảng tín hiệu gần đây không trả lời được:
//
// 1. Nhãn nào đúng? — win-rate và return trung bình theo đúng chiều nhãn, cho
//    từng bias × horizon (outcome đã có sẵn, chỉ cần gộp).
// 2. Nhãn đổi đi đâu? — với mỗi lần chấm, bias của lần chấm kế tiếp cùng
//    symbol+side trong `TRANSITION_WINDOW_HOURS` giờ. Đây là chỗ thấy ngay kiểu
//    MMT: "kiệt sức" gọi tại đỉnh rồi 4h sau quay lại "tiếp diễn tăng".
//
// Gộp bằng SQL (không kéo từng dòng về Node): log có thể tới hàng chục nghìn
// dòng, only aggregate đi qua network.

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { HORIZONS, type HorizonId } from "@/lib/market/ledger";
import { BIAS_LABELS, type Bias } from "@/lib/market/scoring";
import { wilsonScoreInterval as wilsonInterval } from "@/lib/stats/wilson";
import { ACTION_MIN_ENTRY, ACTION_MIN_SCORE } from "./bias-state";
import { MIN_TTL_RUNS, deriveBiasTtl, type BiasTtlEstimate } from "./bias-ttl";
import { readBiasHoldRuns } from "./bias-ttl-read";

/** Cửa sổ mặc định/tối đa của bảng tổng hợp. */
export const DEFAULT_REVIEW_DAYS = 30;
export const MAX_REVIEW_DAYS = 90;
/** Nhãn được coi là "lật" nếu đổi sang nhãn khác trong bao nhiêu giờ. */
export const TRANSITION_WINDOW_HOURS = 4;
/** Bias có chiều giảm: return âm mới là đúng chiều. */
const BEARISH: Bias[] = ["exhaustion", "breakdown"];

/**
 * RADAR-BIAS-REVIEW-V2 — version + changelog công khai.
 *
 * Bảng này quyết định nhãn nào được tin; đổi cách gộp (mẫu số, chiều edge, cửa
 * sổ) mà không nói ra là để người đọc so hai con số khác nghĩa với nhau.
 */
export const BIAS_REVIEW_METRICS_VERSION = "bias-review-v3";

export const BIAS_REVIEW_CHANGELOG: readonly { version: string; note: string }[] = [
  {
    version: "bias-review-v3",
    note: "Bỏ hiệu chuẩn shadow (nửa cửa sổ) và bảng alert precision riêng: precision giờ là một ô trong từng cặp bias × horizon, dùng đúng ngưỡng actionable (score ≥ 55, entry ≥ 40). Bỏ hiệu chuẩn vì nó chỉ mô tả, mẫu mỗi nửa quá nhỏ và không tham gia quyết định nào; bỏ bảng rollup nhiều kỳ vì trùng thông tin của `rows`. Không đổi công thức hit-rate.",
  },
  {
    version: "bias-review-v2",
    note: "Thêm cờ phản dự báo (CI trên < 50% với ≥ 20 mẫu), hiệu chuẩn shadow (nửa đầu vs nửa sau cửa sổ), TTL suy từ độ dài run đo được, và precision của alert (score ≥ 55, entry ≥ 40) kèm Wilson CI. Không đổi cách tính hit-rate cũ.",
  },
  {
    version: "bias-review-v1",
    note: "Bản đầu: hit-rate + Wilson CI và edge trung bình theo bias × horizon, ma trận chuyển nhãn trong 4 giờ.",
  },
];

/**
 * Dưới ngưỡng mẫu này chưa gắn cờ phản dự báo — CI của 5 mẫu luôn rộng, gắn cờ
 * sẽ biến "chưa biết" thành "tệ".
 */
export const COUNTER_FORECAST_MIN_N = 20;

/** Thứ tự hiển thị cố định — engine có bias mới thì thêm vào cuối. */
export const BIAS_ORDER: Bias[] = [
  "continuation",
  "breakout",
  "accumulation",
  "exhaustion",
  "breakdown",
  "flush-bounce",
  "neutral",
];

export function clampReviewDays(raw: unknown, fallback = DEFAULT_REVIEW_DAYS): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(MAX_REVIEW_DAYS, Math.max(1, Math.floor(value)));
}

function biasRank(bias: string): number {
  const index = BIAS_ORDER.indexOf(bias as Bias);
  return index === -1 ? BIAS_ORDER.length : index;
}

function labelOf(bias: string): string {
  return BIAS_LABELS[bias as Bias] ?? bias;
}

function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

/**
 * ALERT-PRECISION — các row đủ ngưỡng actionable thắng bao nhiêu, ngay trong
 * ô bias × horizon. Gộp vào từng ô thay vì một bảng riêng, để thấy ngay "nhãn
 * này đúng chung" và "khi đủ ngưỡng alert thì đúng bao nhiêu" cạnh nhau.
 */
export interface BiasAlertPrecision {
  n: number;
  wins: number;
  hitRate: number;
  ciLow: number | null;
  ciHigh: number | null;
  /** Return trung bình theo đúng chiều nhãn của riêng nhóm alert. */
  avgEdgePct: number | null;
}

export interface BiasHorizonStat {
  horizon: HorizonId;
  /** Số outcome đã đo (win khác null). */
  n: number;
  wins: number;
  hitRate: number | null;
  /** Khoảng tin cậy 95% (Wilson) — rộng khi mẫu nhỏ, đừng đọc mỗi hit-rate. */
  ciLow: number | null;
  ciHigh: number | null;
  /** Return trung bình theo đúng chiều nhãn (bias giảm đã đổi dấu). */
  avgEdgePct: number | null;
  avgRelativePct: number | null;
  /** Đủ mẫu để đọc CI (≥ COUNTER_FORECAST_MIN_N). */
  reliable: boolean;
  /**
   * COUNTER-FORECAST: CI trên < 50% — nhãn này *có bằng chứng* tệ hơn tung
   * đồng xu ở horizon này. Chỉ một chiều: mẫu nhỏ/CI rộng không bao giờ bật cờ.
   */
  counterForecast: boolean;
  flagReason: "insufficient-sample" | "ci-below-coin-flip" | null;
  /** null = chưa có outcome nào đủ ngưỡng alert ở ô này. */
  alertPrecision: BiasAlertPrecision | null;
}

export interface BiasReviewRow {
  bias: Bias;
  label: string;
  /** Mẫu lớn nhất trong các horizon — horizon dài luôn ít mẫu hơn. */
  n: number;
  horizons: BiasHorizonStat[];
}

/** Một dòng aggregate thô từ SQL (một bias × một horizon). */
export interface BiasHorizonAggregate {
  bias: string;
  horizon: string;
  n: number;
  wins: number;
  avgEdgePct: number | null;
  avgRelativePct: number | null;
}

function buildAlertPrecision(cell: BiasHorizonAggregate | undefined): BiasAlertPrecision | null {
  if (!cell) return null;
  const n = Number(cell.n);
  if (!Number.isFinite(n) || n <= 0) return null;
  const wins = Math.min(n, Math.max(0, Number(cell.wins) || 0));
  const ci = wilsonInterval(wins, n);
  return {
    n,
    wins,
    hitRate: Number(((wins / n) * 100).toFixed(1)),
    ciLow: ci ? Number(ci.low.toFixed(1)) : null,
    ciHigh: ci ? Number(ci.high.toFixed(1)) : null,
    avgEdgePct: round(cell.avgEdgePct === null ? null : Number(cell.avgEdgePct)),
  };
}

/**
 * Gộp aggregate thô thành hàng theo bias, cột theo horizon đúng thứ tự.
 * `alertAggregates` (tuỳ chọn) là cùng dạng aggregate nhưng chỉ tính các row đủ
 * ngưỡng alert → gắn vào từng ô thành `alertPrecision`.
 */
export function buildBiasReviewRows(
  input: BiasHorizonAggregate[],
  alertAggregates: BiasHorizonAggregate[] = []
): BiasReviewRow[] {
  const alertByCell = new Map<string, BiasHorizonAggregate>();
  for (const cell of alertAggregates) {
    if (!cell || typeof cell.bias !== "string" || typeof cell.horizon !== "string") continue;
    if (!Number.isFinite(Number(cell.n)) || Number(cell.n) <= 0) continue;
    alertByCell.set(`${cell.bias}|${cell.horizon}`, cell);
  }

  const byBias = new Map<string, Map<string, BiasHorizonStat>>();
  for (const cell of input) {
    if (!cell || typeof cell.bias !== "string" || typeof cell.horizon !== "string") continue;
    if (!HORIZONS.some((horizon) => horizon.id === cell.horizon)) continue;
    const n = Number(cell.n);
    if (!Number.isFinite(n) || n <= 0) continue;
    const wins = Math.min(n, Math.max(0, Number(cell.wins) || 0));
    const horizons = byBias.get(cell.bias) ?? new Map<string, BiasHorizonStat>();
    const ci = wilsonInterval(wins, n);
    horizons.set(cell.horizon, {
      horizon: cell.horizon as HorizonId,
      n,
      wins,
      hitRate: Number(((wins / n) * 100).toFixed(1)),
      ciLow: ci ? Number(ci.low.toFixed(1)) : null,
      ciHigh: ci ? Number(ci.high.toFixed(1)) : null,
      avgEdgePct: round(cell.avgEdgePct === null ? null : Number(cell.avgEdgePct)),
      avgRelativePct: round(cell.avgRelativePct === null ? null : Number(cell.avgRelativePct)),
      reliable: n >= COUNTER_FORECAST_MIN_N,
      counterForecast: n >= COUNTER_FORECAST_MIN_N && ci != null && ci.high < 50,
      flagReason:
        n < COUNTER_FORECAST_MIN_N
          ? "insufficient-sample"
          : ci != null && ci.high < 50
            ? "ci-below-coin-flip"
            : null,
      alertPrecision: buildAlertPrecision(alertByCell.get(`${cell.bias}|${cell.horizon}`)),
    });
    byBias.set(cell.bias, horizons);
  }

  return [...byBias.entries()]
    .sort((a, b) => biasRank(a[0]) - biasRank(b[0]) || a[0].localeCompare(b[0]))
    .map(([bias, horizons]) => ({
      bias: bias as Bias,
      label: labelOf(bias),
      n: Math.max(...[...horizons.values()].map((cell) => cell.n)),
      horizons: HORIZONS.filter((horizon) => horizons.has(horizon.id)).map(
        (horizon) => horizons.get(horizon.id) as BiasHorizonStat
      ),
    }));
}

export interface BiasTransitionCell {
  to: Bias;
  label: string;
  n: number;
}

export interface BiasTransitionRow {
  from: Bias;
  label: string;
  /** Số lần chấm có lần chấm kế tiếp trong cửa sổ (không tính lần cuối cùng). */
  total: number;
  /** Số lần nhãn đổi sang nhãn khác. */
  flips: number;
  flipRate: number | null;
  /** Các nhãn đích đã quan sát, giảm dần theo số lần. */
  byTo: BiasTransitionCell[];
}

export interface BiasTransitionSummary {
  rows: BiasTransitionRow[];
  /** Cột của ma trận (nhãn đích đã quan sát), theo thứ tự chuẩn. */
  columns: Array<{ bias: Bias; label: string }>;
  /**
   * Callout cho case MMT: sau "kiệt sức" thì bao nhiêu phần trăm quay lại
   * "tiếp diễn tăng" trong cửa sổ transition.
   */
  afterExhaustion: {
    total: number;
    toContinuation: number;
    toContinuationRate: number | null;
  };
}

export interface TransitionPair {
  fromBias: string;
  toBias: string;
  n: number;
}

/** Dựng ma trận chuyển nhãn từ các cặp (from → to, số lần). */
export function buildTransitionMatrix(pairs: TransitionPair[]): BiasTransitionSummary {
  const rows = new Map<string, Map<string, number>>();
  const targets = new Set<string>();
  for (const pair of pairs) {
    if (!pair || typeof pair.fromBias !== "string" || typeof pair.toBias !== "string") continue;
    const n = Number(pair.n);
    if (!Number.isFinite(n) || n <= 0) continue;
    const byTo = rows.get(pair.fromBias) ?? new Map<string, number>();
    byTo.set(pair.toBias, (byTo.get(pair.toBias) ?? 0) + n);
    rows.set(pair.fromBias, byTo);
    targets.add(pair.toBias);
  }

  const built = [...rows.entries()]
    .sort((a, b) => biasRank(a[0]) - biasRank(b[0]) || a[0].localeCompare(b[0]))
    .map<BiasTransitionRow>(([from, byTo]) => {
      const cells = [...byTo.entries()]
        .sort((a, b) => b[1] - a[1] || biasRank(a[0]) - biasRank(b[0]))
        .map(([to, n]) => ({ to: to as Bias, label: labelOf(to), n }));
      const total = cells.reduce((sum, cell) => sum + cell.n, 0);
      const flips = cells
        .filter((cell) => cell.to !== from)
        .reduce((sum, cell) => sum + cell.n, 0);
      return {
        from: from as Bias,
        label: labelOf(from),
        total,
        flips,
        flipRate: total > 0 ? Number(((flips / total) * 100).toFixed(1)) : null,
        byTo: cells,
      };
    });

  const exhaustion = built.find((row) => row.from === "exhaustion");
  const total = exhaustion?.total ?? 0;
  const toContinuation =
    exhaustion?.byTo.find((cell) => cell.to === "continuation")?.n ?? 0;

  return {
    rows: built,
    columns: [...targets]
      .sort((a, b) => biasRank(a) - biasRank(b) || a.localeCompare(b))
      .map((bias) => ({ bias: bias as Bias, label: labelOf(bias) })),
    afterExhaustion: {
      total,
      toContinuation,
      toContinuationRate:
        total > 0 ? Number(((toContinuation / total) * 100).toFixed(1)) : null,
    },
  };
}

export interface BiasReviewPayload {
  days: number;
  /** ISO mốc bắt đầu cửa sổ. */
  since: string;
  transitionHours: number;
  /** Tổng row log trong cửa sổ (mọi row, không chỉ row đã có outcome). */
  logs: number;
  /** Số row có `bias_changed = true`. */
  flips: number;
  rows: BiasReviewRow[];
  transitions: BiasTransitionSummary;
  /** So sánh nhanh giữa các phiên bản engine đã ghi trong log. */
  engines: Array<{ version: string; logs: number; flips: number }>;
  /** Version + changelog để hai con số khác version không bị so với nhau. */
  metricsVersion: string;
  changelog: readonly { version: string; note: string }[];
  /** TTL đo được từ các run đã đóng (tới lúc lật nhãn); `source: static` khi thiếu mẫu. */
  ttl: Record<Bias, BiasTtlEstimate>;
  generatedAt: string;
}

function returnedRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface RawAggregate {
  bias: string;
  horizon: string;
  n: number | string;
  wins: number | string;
  avg_edge_pct: number | string | null;
  avg_relative_pct: number | string | null;
}

/**
 * Đọc bảng tổng hợp + ma trận chuyển nhãn trong `days` ngày gần nhất.
 * Throw khi DB lỗi — route admin báo lỗi cho người xem thay vì trả bảng rỗng
 * (bảng rỗng trông giống "chưa có dữ liệu").
 */
export async function readBiasReview(
  options: { days?: unknown; now?: number; until?: number } = {}
): Promise<BiasReviewPayload> {
  const days = clampReviewDays(options.days);
  const now = options.now ?? Date.now();
  // `until` tách cửa sổ khỏi "bây giờ" để rollup đọc các kỳ liên tiếp không
  // chồng lấn (kỳ cũ hơn kết thúc đúng lúc kỳ mới bắt đầu).
  const until = options.until ?? now;
  const since = new Date(until - days * 86_400_000);

  const aggregateResult = await db.execute(sql`
    SELECT l.bias,
           o.horizon,
           count(*)::int AS n,
           sum(CASE WHEN o.win THEN 1 ELSE 0 END)::int AS wins,
           avg(CASE WHEN l.bias IN ('exhaustion', 'breakdown') THEN -o.close_pct ELSE o.close_pct END)::float8
             AS avg_edge_pct,
           avg(o.relative_pct)::float8 AS avg_relative_pct
    FROM radar_bias_log l
    JOIN radar_bias_outcome o ON o.log_id = l.id
    WHERE l.logged_at >= ${since}
      AND o.win IS NOT NULL
    GROUP BY l.bias, o.horizon
  `);

  // Tổng log/flips suy ra từ chính nhóm engine_version — bỏ một lượt quét
  // toàn bộ `radar_bias_log` so với query count riêng trước đây.
  const engineResult = await db.execute(sql`
    SELECT engine_version AS version,
           count(*)::int AS logs,
           count(*) FILTER (WHERE bias_changed)::int AS flips
    FROM radar_bias_log
    WHERE logged_at >= ${since}
    GROUP BY engine_version
    ORDER BY engine_version DESC
  `);

  // ALERT-PRECISION: đúng ngưỡng alert lúc chấm, đo win-rate theo horizon.
  const alertResult = await db.execute(sql`
    SELECT l.bias,
           o.horizon,
           count(*)::int AS n,
           sum(CASE WHEN o.win THEN 1 ELSE 0 END)::int AS wins,
           avg(CASE WHEN l.bias IN ('exhaustion', 'breakdown') THEN -o.close_pct ELSE o.close_pct END)::float8
             AS avg_edge_pct
    FROM radar_bias_log l
    JOIN radar_bias_outcome o ON o.log_id = l.id
    WHERE l.logged_at >= ${since}
      AND o.win IS NOT NULL
      AND l.bias <> 'neutral'
      AND l.score >= ${ACTION_MIN_SCORE}
      AND l.entry_quality >= ${ACTION_MIN_ENTRY}
    GROUP BY l.bias, o.horizon
  `);

  // TTL: quãng từ lần chấm cuối của bias cũ tới lần chấm đầu của bias mới trên
  // cùng symbol+side; run cuối chưa đóng không tính. Dùng chung reader với badge
  // radar (`bias-ttl-read.ts`) để hai nơi không lệch định nghĩa.

  const transitionResult = await db.execute(sql`
    SELECT b.bias AS from_bias, n.bias AS to_bias, count(*)::int AS n
    FROM radar_bias_log b
    JOIN LATERAL (
      SELECT x.bias
      FROM radar_bias_log x
      WHERE x.symbol = b.symbol
        AND x.side = b.side
        AND x.logged_at > b.logged_at
        AND x.logged_at <= b.logged_at + make_interval(hours => ${TRANSITION_WINDOW_HOURS})
      ORDER BY x.logged_at ASC
      LIMIT 1
    ) n ON true
    WHERE b.logged_at >= ${since}
    GROUP BY b.bias, n.bias
  `);

  const aggregates = (returnedRows(aggregateResult) as RawAggregate[]).map<BiasHorizonAggregate>(
    (row) => ({
      bias: row.bias,
      horizon: row.horizon,
      n: Number(row.n),
      wins: Number(row.wins),
      avgEdgePct: numberOrNull(row.avg_edge_pct),
      avgRelativePct: numberOrNull(row.avg_relative_pct),
    })
  );

  const pairs = (returnedRows(transitionResult) as Array<{
    from_bias: string;
    to_bias: string;
    n: number | string;
  }>).map<TransitionPair>((row) => ({
    fromBias: row.from_bias,
    toBias: row.to_bias,
    n: Number(row.n),
  }));

  const engines = (returnedRows(engineResult) as Array<{
    version: string | null;
    logs: number | string;
    flips: number | string;
  }>).map((row) => ({
    version: row.version ?? "unknown",
    logs: Number(row.logs) || 0,
    flips: Number(row.flips) || 0,
  }));

  const alertAggregates = (returnedRows(alertResult) as Array<{
    bias: string;
    horizon: string;
    n: number | string;
    wins: number | string;
    avg_edge_pct: number | string | null;
  }>).map((row) => ({
    bias: row.bias,
    horizon: row.horizon,
    n: Number(row.n),
    wins: Number(row.wins),
    avgEdgePct: numberOrNull(row.avg_edge_pct),
    // Alert precision không cần relative return; giữ đủ hình dạng aggregate.
    avgRelativePct: null,
  }));

  const holdRuns = await readBiasHoldRuns(since);

  return {
    days,
    since: since.toISOString(),
    transitionHours: TRANSITION_WINDOW_HOURS,
    logs: engines.reduce((sum, engine) => sum + engine.logs, 0),
    flips: engines.reduce((sum, engine) => sum + engine.flips, 0),
    rows: buildBiasReviewRows(aggregates, alertAggregates),
    transitions: buildTransitionMatrix(pairs),
    engines,
    metricsVersion: BIAS_REVIEW_METRICS_VERSION,
    changelog: BIAS_REVIEW_CHANGELOG,
    ttl: deriveBiasTtl(holdRuns, { minRuns: MIN_TTL_RUNS }),
    generatedAt: new Date(now).toISOString(),
  };
}
