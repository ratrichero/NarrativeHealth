// RADAR-BIAS-STATE: trạng thái sống của một nhãn radar.
//
// Nhãn chỉ có nghĩa khi còn hiệu lực. Trước đây UI chỉ in giá vô hiệu, nên một
// tín hiệu đã thủng mốc từ lâu hoặc đã cũ vài ngày vẫn trông y như tín hiệu mới.
// Module này (thuần, không DB/network) trả lời ba câu:
//   • nhãn còn hiệu lực / gần vô hiệu / đã vô hiệu?
//   • nhãn đã cũ quá TTL của chính nó chưa?
//   • nhãn này có đáng hành động / đáng tin theo lịch sử không?
// Dùng chung cho bảng radar, ledger gần đây và filter.

import type { Bias } from "@/lib/market/scoring";
import { wilsonScoreInterval } from "@/lib/stats/wilson";
import {
  BIAS_TTL_HOURS,
  MAX_MEASURED_TTL_HOURS,
  MIN_MEASURED_TTL_HOURS,
} from "./bias-ttl";

// Bảng TTL và biên kẹp số đo chuyển sang `bias-ttl` (module thuần, không DB).
// Re-export để call-site cũ và test vẫn import từ đây được.
export { BIAS_TTL_HOURS, MAX_MEASURED_TTL_HOURS, MIN_MEASURED_TTL_HOURS };

export type InvalidationState = "intact" | "near" | "hit" | "expired" | "none";

const BULLISH: Bias[] = ["continuation", "flush-bounce", "breakout", "accumulation"];
const BEARISH: Bias[] = ["exhaustion", "breakdown"];

/** 1 = nhãn cược giá tăng, -1 = cược giá giảm, 0 = trung tính. */
export function biasDirection(bias: Bias): 1 | -1 | 0 {
  if (BULLISH.includes(bias)) return 1;
  if (BEARISH.includes(bias)) return -1;
  return 0;
}

export interface InvalidationInput {
  bias: Bias;
  /** Giá hiện tại (không phải giá lúc ghi). */
  price: number | null | undefined;
  invalidationPrice: number | null | undefined;
  /** ISO thời điểm nhãn được chấm — dùng cho TTL. */
  at?: string | null;
  now?: number;
  /** ATR 4h tuyệt đối (giá), để coi "gần vô hiệu" trong 0.25 ATR. */
  atr?: number | null;
  /**
   * TTL đo được từ dữ liệu (`deriveBiasTtl`) thay cho bảng tĩnh. Chỉ nhận giá
   * trị hợp lệ trong [4, 72] giờ; thiếu/không hợp lệ → dùng `BIAS_TTL_HOURS`.
   */
  ttlHours?: number | null;
}

export interface InvalidationStateResult {
  state: InvalidationState;
  label: string;
  /** % còn cách mốc vô hiệu; dương = còn an toàn, âm = đã thủng. */
  bufferPct: number | null;
  ageHours: number | null;
  ttlHours: number;
}

const STATE_LABELS: Record<InvalidationState, string> = {
  intact: "còn hiệu lực",
  near: "gần vô hiệu",
  hit: "đã vô hiệu",
  expired: "hết hạn",
  none: "—",
};

const FALLBACK_NEAR_PCT = 0.5;

/**
 * Trạng thái sống của nhãn. Thứ tự ưu tiên: không có mốc → đã thủng → quá TTL
 * → gần mốc → còn hiệu lực. `hit` đứng trước `expired` vì thủng mốc là thông
 * tin mạnh hơn "nhãn cũ".
 */
export function invalidationState(input: InvalidationInput): InvalidationStateResult {
  const now = input.now ?? Date.now();
  const measuredTtl =
    input.ttlHours != null && Number.isFinite(input.ttlHours) && input.ttlHours >= MIN_MEASURED_TTL_HOURS
      ? Math.min(MAX_MEASURED_TTL_HOURS, input.ttlHours)
      : null;
  const ttlHours = measuredTtl ?? BIAS_TTL_HOURS[input.bias] ?? 12;
  const atMs = input.at ? Date.parse(input.at) : NaN;
  const ageHours = Number.isFinite(atMs) ? Math.max(0, (now - atMs) / 3_600_000) : null;
  const direction = biasDirection(input.bias);
  const price = input.price ?? null;
  const level = input.invalidationPrice ?? null;

  const base = { bufferPct: null, ageHours, ttlHours };

  if (direction === 0 || price === null || !Number.isFinite(price) || level === null || !Number.isFinite(level)) {
    return { ...base, state: "none", label: STATE_LABELS.none };
  }

  const bufferPct = direction === 1 ? ((price - level) / price) * 100 : ((level - price) / price) * 100;

  if (bufferPct <= 0) {
    return { ...base, bufferPct, state: "hit", label: STATE_LABELS.hit };
  }
  if (ageHours !== null && ageHours > ttlHours) {
    return { ...base, bufferPct, state: "expired", label: STATE_LABELS.expired };
  }

  const nearPct =
    input.atr !== null && input.atr !== undefined && input.atr > 0
      ? (input.atr / price) * 100 * 0.25
      : FALLBACK_NEAR_PCT;
  if (bufferPct <= nearPct) {
    return { ...base, bufferPct, state: "near", label: STATE_LABELS.near };
  }

  return { ...base, bufferPct, state: "intact", label: STATE_LABELS.intact };
}

/** Class Tailwind cho badge trạng thái. */
export function invalidationStateClasses(state: InvalidationState): string {
  switch (state) {
    case "hit":
      return "border-rose-500/40 bg-rose-500/10 text-rose-300";
    case "expired":
      return "border-slate-600 bg-slate-800 text-slate-400";
    case "near":
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "intact":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    default:
      return "border-slate-700 bg-slate-900 text-slate-500";
  }
}

/** Ngưỡng để coi một nhãn là "đáng tin" theo lịch sử. */
export const TRUST_MIN_SAMPLES = 10;
export const TRUST_MIN_HIT_RATE = 50;

export function isTrustedBias(
  hitRate: number | null | undefined,
  n: number | null | undefined
): boolean {
  return (
    typeof hitRate === "number" &&
    Number.isFinite(hitRate) &&
    (n ?? 0) >= TRUST_MIN_SAMPLES &&
    hitRate >= TRUST_MIN_HIT_RATE
  );
}

/** Ngưỡng hành động — cùng logic với `actionable` của ledger. */
export const ACTION_MIN_SCORE = 55;
export const ACTION_MIN_ENTRY = 40;

export interface ActionableInput {
  bias: Bias;
  score: number;
  entryQuality: number;
  chaseRisk?: boolean;
  /** Volume 24h quá mỏng so với ngưỡng lọc — setup khó khớp giá tốt. */
  liquidityRisk?: boolean;
}

/** Nhãn đủ mạnh, còn entry mới và thanh khoản đủ để coi là "để hành động". */
export function meetsActionable(row: ActionableInput): boolean {
  return (
    row.bias !== "neutral" &&
    row.score >= ACTION_MIN_SCORE &&
    row.entryQuality >= ACTION_MIN_ENTRY &&
    row.chaseRisk !== true &&
    row.liquidityRisk !== true
  );
}

export type EntryZoneTone = "in" | "wait" | "past" | "unknown";

/**
 * Giá đang ở đâu so với vùng entry hồi. Long chờ giá hạ về vùng, short chờ giá
 * bật lên; `past` = giá đã đi xuyên qua vùng nên không còn chỗ chờ nữa.
 * `unknown` = thiếu hoặc giá trị vùng/giá không hợp lệ, không kết luận được gì.
 * `distancePct` là khoảng cách tới mép gần nhất (chỉ có nghĩa khi `wait`).
 */
export function entryZoneTone(
  price: number,
  direction: "BULLISH" | "BEARISH",
  entry: { entryLow: number; entryHigh: number }
): { tone: EntryZoneTone; distancePct: number | null } {
  const { entryLow, entryHigh } = entry;
  if (![price, entryLow, entryHigh].every((value) => Number.isFinite(value) && value > 0)) {
    return { tone: "unknown", distancePct: null };
  }
  if (price >= entryLow && price <= entryHigh) return { tone: "in", distancePct: 0 };
  const long = direction === "BULLISH";
  const waiting = long ? price > entryHigh : price < entryLow;
  const distancePct = long
    ? ((price - entryHigh) / price) * 100
    : ((entryLow - price) / price) * 100;
  return { tone: waiting ? "wait" : "past", distancePct };
}

/** Wilson score interval 95% cho tỷ lệ hit-rate (STATS-01: bản gốc ở stats). */
export function wilsonInterval(
  wins: number,
  n: number
): { low: number; high: number } | null {
  return wilsonScoreInterval(wins, n);
}
