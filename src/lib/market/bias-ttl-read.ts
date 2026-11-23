// RADAR-TTL-02 — TTL đo được, dùng chung cho bảng admin VÀ badge trên radar.
//
// `deriveBiasTtl`/`effectiveTtlHours` chỉ là phép tính thuần; chỗ đọc dữ liệu
// thì trước đây nằm lẫn trong `readBiasReview`, nên badge radar không có số đo
// và phải dùng bảng tĩnh. Tách query ra đây để cả hai nơi dùng ĐÚNG một định
// nghĩa (cùng cửa sổ, cùng ngưỡng mẫu, cùng trần dòng) — nếu không, bảng admin
// báo "kiệt sức sống 6h" còn badge vẫn báo 8h.
//
// Thiếu mẫu hoặc lỗi đọc thì trả bảng tĩnh: badge không được phép im lặng coi
// một nhãn đã chết là còn hiệu lực, nhưng cũng không được bịa số từ 3 lần quan
// sát.

import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { Bias } from "./scoring";
import {
  MIN_TTL_RUNS,
  buildHoldRuns,
  deriveBiasTtl,
  effectiveTtlHours,
  type BiasHoldRun,
  type BiasTtlEstimate,
} from "./bias-ttl";

/** Cửa sổ đo mặc định — cùng cửa sổ với bảng bias review. */
export const TTL_WINDOW_DAYS = 30;
/** Cửa sổ tối đa: log dày hơn 90 ngày không làm TTL chính xác hơn. */
export const TTL_MAX_DAYS = 90;
/** Trần dòng đọc, cùng trần với bias review để hai nơi không lệch mẫu. */
export const TTL_MAX_ROWS = 50_000;
/** TTL đổi chậm; cache ngắn để mỗi lần mở radar không quét lại cả bảng log. */
const CACHE_MS = 5 * 60_000;

export interface MeasuredBiasTtl {
  days: number;
  since: string;
  /** Map bias → TTL hiệu lực, truyền thẳng vào `invalidationState`. */
  hours: Record<Bias, number>;
  estimates: Record<Bias, BiasTtlEstimate>;
  /** true khi ít nhất một nhãn đủ mẫu để dùng số đo thay bảng tĩnh. */
  anyMeasured: boolean;
}

function rowsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

export function clampTtlDays(raw: unknown, fallback = TTL_WINDOW_DAYS): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(TTL_MAX_DAYS, Math.max(1, Math.floor(value)));
}

/** Độ dài các run giữ nhãn trong `since` — nguồn duy nhất cho TTL đo được. */
export async function readBiasHoldRuns(since: Date): Promise<BiasHoldRun[]> {
  const result = await db.execute(sql`
    SELECT symbol, side, bias, logged_at
    FROM radar_bias_log
    WHERE logged_at >= ${since}
    ORDER BY symbol, side, logged_at
    LIMIT ${TTL_MAX_ROWS}
  `);

  return buildHoldRuns(
    (rowsOf(result) as Array<{
      symbol: string;
      side: string;
      bias: string;
      logged_at: string | Date;
    }>).map((row) => ({
      symbol: String(row.symbol),
      side: String(row.side),
      bias: String(row.bias),
      atMs:
        row.logged_at instanceof Date
          ? row.logged_at.getTime()
          : Date.parse(String(row.logged_at)),
    }))
  );
}

/**
 * Dạng gọn để nhét vào payload công khai: đủ số để badge hiển thị, đủ nguồn để
 * người đọc không nhầm con số viết tay với số đo từ log.
 */
export interface BiasTtlPayloadEntry {
  hours: number;
  source: "measured" | "static";
  samples: number;
}

export function toTtlPayload(
  measured: MeasuredBiasTtl
): Record<Bias, BiasTtlPayloadEntry> {
  const out = {} as Record<Bias, BiasTtlPayloadEntry>;
  for (const [bias, estimate] of Object.entries(measured.estimates) as Array<
    [Bias, BiasTtlEstimate]
  >) {
    out[bias] = {
      hours: measured.hours[bias],
      source: estimate.source,
      samples: estimate.samples,
    };
  }
  return out;
}

let cache: { expires: number; value: MeasuredBiasTtl } | null = null;

/**
 * TTL hiệu lực theo bias. `now` tường minh (test/backfill) bỏ qua cache; request
 * bình thường dùng cache 5 phút để radar không phải quét log mỗi lần tải.
 */
export async function readMeasuredBiasTtl(
  options: { days?: unknown; now?: number } = {}
): Promise<MeasuredBiasTtl> {
  const days = clampTtlDays(options.days);
  const now = options.now ?? Date.now();
  const useCache = options.now === undefined && days === TTL_WINDOW_DAYS;
  if (useCache && cache && cache.expires > now) return cache.value;

  const since = new Date(now - days * 86_400_000);
  const runs = await readBiasHoldRuns(since);
  const estimates = deriveBiasTtl(runs, { minRuns: MIN_TTL_RUNS });
  const value: MeasuredBiasTtl = {
    days,
    since: since.toISOString(),
    hours: effectiveTtlHours(estimates),
    estimates,
    anyMeasured: Object.values(estimates).some((estimate) => estimate.source === "measured"),
  };

  if (useCache) cache = { expires: now + CACHE_MS, value };
  return value;
}

/** Chỉ dùng trong test/health: xoá cache để đọc lại từ DB. */
export function resetMeasuredBiasTtlCache(): void {
  cache = null;
}
