// RADAR-BACKTEST — đọc log + outcome ở MỘT horizon rồi so với basket/random.
//
// Nguồn: `radar_bias_log` (bias, score, entry_quality, side) join
// `radar_bias_outcome` (win, close_pct). Edge đổi dấu theo chiều nhãn để mọi
// bias cùng một nghĩa ("dương = nhãn đúng chiều"). Actionable dùng đúng ngưỡng
// với `meetsActionable`/alert, không phải một định nghĩa thứ hai.

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { HORIZONS, type HorizonId } from "./ledger";
import { ACTION_MIN_ENTRY, ACTION_MIN_SCORE } from "./bias-state";
import {
  buildRadarBacktest,
  type RadarBacktestObservation,
  type RadarBacktestResult,
} from "./radar-backtest";

export const RADAR_BACKTEST_DEFAULT_DAYS = 30;
export const RADAR_BACKTEST_MAX_DAYS = 90;
/** Trần dòng đọc — 90 ngày × 3 snapshot/giờ có thể rất lớn; đủ cho một horizon. */
const MAX_ROWS = 60000;

export function clampBacktestDays(raw: unknown, fallback = RADAR_BACKTEST_DEFAULT_DAYS): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(RADAR_BACKTEST_MAX_DAYS, Math.max(1, Math.floor(value)));
}

export function parseHorizon(raw: unknown, fallback: HorizonId = "24h"): HorizonId {
  const value = String(raw ?? "");
  return HORIZONS.some((horizon) => horizon.id === value) ? (value as HorizonId) : fallback;
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

export interface RadarBacktestPayload extends RadarBacktestResult {
  days: number;
  horizon: HorizonId;
  /** Điều kiện actionable đã áp — công bố để không ai đoán. */
  definition: {
    minScore: number;
    minEntry: number;
    excludeNeutral: true;
  };
  generatedAt: string;
}

/**
 * Đọc rồi so. Horizon không có outcome nào → kết quả `insufficient` với 0 pick,
 * không throw (admin cần thấy "chưa có dữ liệu" chứ không phải lỗi 500).
 */
export async function readRadarBacktest(
  options: { days?: unknown; horizon?: unknown; now?: number } = {}
): Promise<RadarBacktestPayload> {
  const days = clampBacktestDays(options.days);
  const horizon = parseHorizon(options.horizon);
  const now = options.now ?? Date.now();
  const since = new Date(now - days * 86_400_000);

  const result = await db.execute(sql`
    SELECT l.symbol,
           l.side,
           l.bias,
           l.score,
           l.entry_quality,
           l.logged_at,
           o.close_pct,
           o.win
    FROM radar_bias_log l
    JOIN radar_bias_outcome o ON o.log_id = l.id
    WHERE l.logged_at >= ${since}
      AND l.logged_at <= ${new Date(now)}
      AND o.horizon = ${horizon}
      AND o.win IS NOT NULL
      AND o.close_pct IS NOT NULL
    ORDER BY l.logged_at
    LIMIT ${MAX_ROWS}
  `);

  const observations: RadarBacktestObservation[] = rowsOf(result).map((row) => {
    const bias = String(row.bias ?? "");
    const closePct = Number(row.close_pct);
    const bearish = bias === "exhaustion" || bias === "breakdown";
    const loggedAt = row.logged_at instanceof Date ? row.logged_at : new Date(String(row.logged_at));
    const score = Number(row.score);
    const entryQuality = Number(row.entry_quality);
    return {
      day: Number.isFinite(loggedAt.getTime())
        ? loggedAt.toISOString().slice(0, 10)
        : String(row.logged_at).slice(0, 10),
      symbol: String(row.symbol ?? ""),
      bias,
      actionable:
        bias !== "neutral" &&
        Number.isFinite(score) &&
        Number.isFinite(entryQuality) &&
        score >= ACTION_MIN_SCORE &&
        entryQuality >= ACTION_MIN_ENTRY,
      edgePct: bearish ? -closePct : closePct,
    };
  });

  return {
    ...buildRadarBacktest(observations),
    days,
    horizon,
    definition: {
      minScore: ACTION_MIN_SCORE,
      minEntry: ACTION_MIN_ENTRY,
      excludeNeutral: true,
    },
    generatedAt: new Date(now).toISOString(),
  };
}
