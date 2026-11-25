// RADAR-TG P3 — fast lane 3 phút cho alert Radar.
//
// Cohort đầy đủ (30 phút) quét universe rộng, ghi ledger/bias log và gửi mọi
// tier. Fast lane là làn phụ 3 phút: chỉ quét ~30 symbol thanh khoản nhất, chỉ
// gửi tier URGENT, và dùng khoá riêng nên không chặn/không bị chặn bởi lượt
// cohort đầy đủ. Mọi dedupe/cooldown vẫn nằm trong alerts.ts/outbox.

import type { RadarAlertTier } from "@/lib/market/alerts";

export type CohortMode = "full" | "fast";

export const FAST_LANE_INTERVAL_MINUTES = 3;
export const FAST_LANE_MIN_INTERVAL_MINUTES = 1;
export const FAST_LANE_MAX_INTERVAL_MINUTES = 5;
/** Universe fast lane: top thanh khoản, đủ rộng cho top gainer/loser/unusual. */
export const FAST_LANE_UNIVERSE_SIZE = 30;
/** Số row enrich mỗi side ở fast lane (tổng ≤ universe). */
export const FAST_LANE_PER_SIDE = 10;

/** Chỉ chuỗi "fast" bật fast lane; mọi giá trị khác giữ cohort đầy đủ. */
export function normalizeCohortMode(raw: unknown): CohortMode {
  return raw === "fast" ? "fast" : "full";
}

/**
 * Nhịp fast lane (phút): 0 = tắt; thiếu/hỏng = 3; kẹp 1–5 để không biến job
 * 3 phút thành job mỗi giây hoặc thành cohort đầy đủ.
 */
export function fastCohortIntervalMinutes(
  raw: unknown,
  fallback = FAST_LANE_INTERVAL_MINUTES
): number {
  if (raw === null || raw === undefined || raw === "") return fallback;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  if (value === 0) return 0;
  return Math.min(
    FAST_LANE_MAX_INTERVAL_MINUTES,
    Math.max(FAST_LANE_MIN_INTERVAL_MINUTES, Math.floor(value))
  );
}

/**
 * Universe fast lane: top `limit` symbol theo quoteVolume, không sửa mảng vào.
 * Giữ nguyên thứ tự volume giảm dần để cùng input → cùng universe.
 */
export function selectFastUniverse<T extends { symbol: string; quoteVolume: string | number }>(
  eligible: T[],
  limit = FAST_LANE_UNIVERSE_SIZE
): T[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  return [...eligible]
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, Math.floor(limit));
}

export interface AlertChannelPolicy {
  webhook: boolean;
  telegram: boolean;
}

const NO_CHANNELS: AlertChannelPolicy = { webhook: false, telegram: false };

/**
 * Tier quyết định kênh + nhịp:
 *  - URGENT: cả fast lane lẫn cohort đầy đủ, webhook + Telegram.
 *  - ACTIONABLE: chỉ cohort đầy đủ (30 phút), webhook + Telegram.
 *  - WATCH: chỉ cohort đầy đủ, cả webhook lẫn Telegram (không vào fast lane).
 *  - Không rõ tier: giữ hành vi cũ ở cohort đầy đủ, không vào fast lane.
 */
export function alertDeliveryPolicy(
  tier: RadarAlertTier | null,
  lane: CohortMode = "full"
): AlertChannelPolicy {
  if (!tier) return lane === "fast" ? NO_CHANNELS : { webhook: true, telegram: true };
  if (lane === "fast") {
    return tier === "URGENT" ? { webhook: true, telegram: true } : NO_CHANNELS;
  }
  return { webhook: true, telegram: true };

}
