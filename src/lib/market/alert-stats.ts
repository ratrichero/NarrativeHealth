// RADAR-ALERT-METRICS — thống kê hiệu quả alert trên outbox + bias log sẵn có.
//
// Không tạo bảng đo mới: sent/failed/suppressed đọc thẳng
// `radar_alert_outbox`; detection→delivery lấy `sent_at - radar_bias_log.logged_at`
// (fallback `created_at`); ATR/invalidation nằm trong `radar_bias_outcome` do
// job outcome hiện có tính. Nhờ vậy số liệu alert và số liệu tín hiệu không
// bao giờ lệch nhau.

import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface RadarAlertStatRow {
  tier: string | null;
  status: string;
  sentAt: string | null;
  /** Lúc radar phát hiện (bias_log.logged_at), fallback lúc enqueue. */
  detectedAt: string | null;
}

export interface RadarAlertTierStats {
  tier: string;
  sent: number;
  failed: number;
  suppressed: number;
  pending: number;
}

export interface RadarAlertStats {
  windowDays: number;
  byTier: RadarAlertTierStats[];
  deliverySamples: number;
  /** p95 detection→delivery (giây), null khi chưa có mẫu. */
  deliveryP95Seconds: number | null;
}

/** Percentile nội suy tuyến tính; mảng rỗng → null. */
export function alertPercentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const TIER_ORDER: Record<string, number> = {
  URGENT: 0,
  ACTIONABLE: 1,
  WATCH: 2,
  UNKNOWN: 3,
};

/** Gộp raw row thành thống kê theo tier + p95; hàm thuần để test được. */
export function summarizeRadarAlertStats(
  rows: RadarAlertStatRow[],
  windowDays = 7
): RadarAlertStats {
  const byTier = new Map<string, RadarAlertTierStats>();
  const deliverySeconds: number[] = [];

  for (const row of rows) {
    const tier = row.tier && row.tier.trim() ? row.tier.trim() : "UNKNOWN";
    const stats =
      byTier.get(tier) ?? { tier, sent: 0, failed: 0, suppressed: 0, pending: 0 };

    if (row.status === "SENT") stats.sent += 1;
    else if (row.status === "FAILED") stats.failed += 1;
    else if (row.status === "SUPPRESSED") stats.suppressed += 1;
    else if (row.status === "PENDING") stats.pending += 1;
    byTier.set(tier, stats);

    if (row.status === "SENT" && row.sentAt && row.detectedAt) {
      const seconds = (Date.parse(row.sentAt) - Date.parse(row.detectedAt)) / 1_000;
      if (Number.isFinite(seconds) && seconds >= 0) deliverySeconds.push(seconds);
    }
  }

  const sorted = [...byTier.values()].sort(
    (a, b) =>
      (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) || a.tier.localeCompare(b.tier)
  );
  const p95 = alertPercentile(deliverySeconds, 0.95);

  return {
    windowDays,
    byTier: sorted,
    deliverySamples: deliverySeconds.length,
    deliveryP95Seconds: p95 === null ? null : round2(p95),
  };
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Đọc cửa sổ `windowDays` ngày gần nhất từ outbox (join bias log). */
export async function readRadarAlertStats(windowDays = 7): Promise<RadarAlertStats> {
  const days = Math.min(90, Math.max(1, Math.floor(windowDays)));
  const result = await db.execute(sql`
    SELECT o.tier, o.status, o.sent_at,
           COALESCE(l.logged_at, o.created_at) AS detected_at
    FROM radar_alert_outbox o
    LEFT JOIN radar_bias_log l ON l.id = o.bias_log_id
    WHERE o.created_at >= now() - ${days} * interval '1 day'
  `);

  const rows = rowsOf(result).map<RadarAlertStatRow>((row) => ({
    tier: typeof row.tier === "string" ? row.tier : null,
    status: String(row.status ?? ""),
    sentAt: isoOrNull(row.sent_at),
    detectedAt: isoOrNull(row.detected_at),
  }));
  return summarizeRadarAlertStats(rows, days);
}
