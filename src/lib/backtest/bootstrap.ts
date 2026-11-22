// BT-09 — Độ bất định của kỳ vọng (bootstrap) + đếm episode độc lập.
//
// Win rate đã có Wilson CI, nhưng hai con số quyết định "hệ thống có sống được"
// là avg net R và profit factor lại chỉ là điểm ước lượng: 90 lệnh với PF 1.3
// có thể là 0.8 hoặc 2.0 ở mẫu khác. Bootstrap percentile trả lời đúng câu đó
// mà không giả định phân phối chuẩn (R có đuôi dày, âm sàn −1 khi SL).
//
// Đồng thời: pick lặp cùng setup trong vài ngày KHÔNG phải 90 quan sát độc lập
// — cùng một cú trade được đếm nhiều lần sẽ làm CI hẹp giả tạo. `summarizeEpisodes`
// gom các pick cùng symbol + hướng, cách nhau <= EPISODE_GAP_DAYS thành một
// episode; số episode là cỡ mẫu thật.
//
// Toàn bộ thuần + deterministic (LCG seed cố định) → test được, không I/O.

import { profitFactor } from "./metrics";

export interface Interval {
  lo: number;
  hi: number;
}

/** Số lần lấy lại mẫu — 2000 đủ mượt cho percentile 2.5/97.5, vẫn chạy < 5ms. */
export const BOOTSTRAP_RESAMPLES = 2000;

/** Seed cố định: cùng dữ liệu → cùng CI, để trang công khai không "nhảy số". */
export const BOOTSTRAP_SEED = 20260101;

/** Pick cùng symbol+hướng cách nhau quá ngần này là episode mới. */
export const EPISODE_GAP_DAYS = 14;

/** PRNG nhỏ, deterministic (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentile nội suy tuyến tính trên mảng ĐÃ sort tăng dần. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface BootstrapOptions {
  resamples?: number;
  seed?: number;
}

/** Bootstrap 95% percentile CI cho trung bình. null khi < 2 quan sát. */
export function bootstrapMeanCi(
  values: readonly number[],
  options: BootstrapOptions = {}
): Interval | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;
  const resamples = Math.max(200, Math.min(20000, options.resamples ?? BOOTSTRAP_RESAMPLES));
  const rand = mulberry32(options.seed ?? BOOTSTRAP_SEED);
  const n = clean.length;
  const means: number[] = new Array(resamples);
  for (let i = 0; i < resamples; i += 1) {
    let sum = 0;
    for (let j = 0; j < n; j += 1) sum += clean[Math.floor(rand() * n)];
    means[i] = sum / n;
  }
  means.sort((a, b) => a - b);
  return {
    lo: +percentile(means, 0.025).toFixed(2),
    hi: +percentile(means, 0.975).toFixed(2),
  };
}

/**
 * Mẫu lấy lại của TỔNG (không chia n) — alpha so với benchmark tính trên tổng
 * net R, không phải trung bình, nên không thể suy từ CI của mean.
 * Trả mảng đã sort tăng dần, null khi < 2 quan sát.
 */
function bootstrapTotals(
  values: readonly number[],
  options: BootstrapOptions
): number[] | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;
  const resamples = Math.max(200, Math.min(20000, options.resamples ?? BOOTSTRAP_RESAMPLES));
  const rand = mulberry32(options.seed ?? BOOTSTRAP_SEED);
  const n = clean.length;
  const totals: number[] = new Array(resamples);
  for (let i = 0; i < resamples; i += 1) {
    let sum = 0;
    for (let j = 0; j < n; j += 1) sum += clean[Math.floor(rand() * n)];
    totals[i] = sum;
  }
  totals.sort((a, b) => a - b);
  return totals;
}

/** Bootstrap 95% percentile CI cho TỔNG net R. null khi < 2 quan sát. */
export function bootstrapTotalCi(
  values: readonly number[],
  options: BootstrapOptions = {}
): Interval | null {
  const totals = bootstrapTotals(values, options);
  if (!totals) return null;
  return {
    lo: +percentile(totals, 0.025).toFixed(2),
    hi: +percentile(totals, 0.975).toFixed(2),
  };
}

/**
 * % lần lấy lại mẫu có tổng > threshold — "xác suất vượt benchmark" theo
 * bootstrap. Không phải p-value; chỉ là tỷ lệ phân phối nằm trên ngưỡng.
 */
export function bootstrapProbabilityAbove(
  values: readonly number[],
  threshold: number,
  options: BootstrapOptions = {}
): number | null {
  if (!Number.isFinite(threshold)) return null;
  const totals = bootstrapTotals(values, options);
  if (!totals) return null;
  let above = 0;
  for (const total of totals) if (total > threshold) above += 1;
  return +((above / totals.length) * 100).toFixed(1);
}

/**
 * Bootstrap 95% CI cho profit factor (tổng R thắng / |tổng R thua|).
 * Mẫu lấy lại không có cả hai phía (toàn thắng hoặc toàn thua) không xác định
 * được PF → bỏ; cần ít nhất một nửa số lần lấy lại hợp lệ mới trả CI, còn không
 * thì null (báo "không đủ để ước lượng", không bịa khoảng).
 */
export function bootstrapProfitFactorCi(
  values: readonly number[],
  options: BootstrapOptions = {}
): Interval | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;
  if (profitFactor(clean) == null) return null;

  const resamples = Math.max(200, Math.min(20000, options.resamples ?? BOOTSTRAP_RESAMPLES));
  const rand = mulberry32(options.seed ?? BOOTSTRAP_SEED);
  const n = clean.length;
  const pfs: number[] = [];
  for (let i = 0; i < resamples; i += 1) {
    let pos = 0;
    let neg = 0;
    for (let j = 0; j < n; j += 1) {
      const r = clean[Math.floor(rand() * n)];
      if (r > 0) pos += r;
      else if (r < 0) neg += -r;
    }
    if (pos > 0 && neg > 0) pfs.push(pos / neg);
  }
  if (pfs.length < resamples / 2) return null;
  pfs.sort((a, b) => a - b);
  return {
    lo: +percentile(pfs, 0.025).toFixed(2),
    hi: +percentile(pfs, 0.975).toFixed(2),
  };
}

export interface ClusterableTrade {
  symbol: string;
  direction: string;
  dataDate: string;
}

export interface EpisodeSummary {
  /** Số episode độc lập (cỡ mẫu thật). */
  episodes: number;
  /** Số trade đầu vào. */
  trades: number;
  /** Episode lớn nhất chứa bao nhiêu trade (càng lớn càng ít độc lập). */
  largest: number;
}

/**
 * Gom trade thành episode: cùng symbol + hướng, pick sau cách pick trước
 * <= gapDays ngày thì vẫn là cùng một cược (pick lặp của cùng setup).
 */
export function summarizeEpisodes(
  trades: readonly ClusterableTrade[],
  gapDays = EPISODE_GAP_DAYS
): EpisodeSummary {
  if (trades.length === 0) return { episodes: 0, trades: 0, largest: 0 };

  const ordered = [...trades].sort((a, b) =>
    a.dataDate < b.dataDate ? -1 : a.dataDate > b.dataDate ? 1 : 0
  );
  const lastByKey = new Map<string, string>();
  const sizes = new Map<string, number>();
  let episodes = 0;

  for (const trade of ordered) {
    const key = `${trade.symbol}|${trade.direction}`;
    const last = lastByKey.get(key);
    const gap = last == null ? Infinity : daysBetweenIso(last, trade.dataDate);
    if (gap > gapDays) {
      episodes += 1;
      sizes.set(key, 1);
    } else {
      sizes.set(key, (sizes.get(key) ?? 1) + 1);
    }
    lastByKey.set(key, trade.dataDate);
  }

  return {
    episodes,
    trades: trades.length,
    largest: Math.max(0, ...sizes.values()),
  };
}

function daysBetweenIso(a: string, b: string): number {
  const ta = new Date(`${a}T00:00:00Z`).getTime();
  const tb = new Date(`${b}T00:00:00Z`).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.round((tb - ta) / 86_400_000);
}
