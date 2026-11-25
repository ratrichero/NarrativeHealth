/**
 * ENV-GUARD-01 — báo động khi guard chặn một đường ghi.
 *
 * Trước đây `guardBlockedResponse` chỉ `console.warn`: một VPS thiếu
 * `PRODUCTION_ALLOWED_HOSTS` sẽ trả 403 cho mọi lượt refresh/scheduler mà
 * không ai biết (pipeline "vẫn chạy" nhưng không ghi, không đăng bài). Module
 * này đẩy cảnh báo qua kênh alert-delivery sẵn có (Telegram/webhook/email),
 * có cooldown theo (mã lỗi, hostname) để một request lặp lại không spam.
 *
 * Chỉ dùng trong Node runtime (alert-delivery gọi fetch). Guard vẫn là quyết
 * định thuần; ở đây chỉ là side-effect, best-effort, không được làm hỏng
 * response 403.
 */

import { dispatchCustomText } from "@/lib/services/alert-delivery.service";
import type { GuardDecision } from "./runtime-guard";

export const GUARD_ALERT_COOLDOWN_VAR = "ENV_GUARD_ALERT_COOLDOWN_MINUTES";
export const GUARD_ALERT_COOLDOWN_DEFAULT_MINUTES = 60;

/** Trần số key theo dõi cooldown trong bộ nhớ (mỗi process). */
const MAX_TRACKED_KEYS = 50;

const alertStore = new Map<string, number>();

/** Cooldown đọc từ env: 1–1440 phút, mặc định 60. */
export type EnvLike = Record<string, string | undefined>;

export function guardAlertCooldownMs(env: EnvLike = process.env): number {
  const raw = env[GUARD_ALERT_COOLDOWN_VAR];
  const parsed = raw == null || raw.trim() === "" ? NaN : Number(raw);
  const minutes = Number.isFinite(parsed)
    ? Math.min(1440, Math.max(1, Math.trunc(parsed)))
    : GUARD_ALERT_COOLDOWN_DEFAULT_MINUTES;
  return minutes * 60_000;
}

/** Cooldown theo mã lỗi + hostname: cùng lỗi ở host khác vẫn được báo. */
export function guardAlertKey(decision: GuardDecision): string {
  return `${decision.code ?? "READ_ONLY"}|${decision.hostname ?? "-"}`;
}

/**
 * true nếu key chưa báo hoặc đã quá cooldown (đồng thời ghi mốc mới).
 * `store` cho phép test truyền Map riêng.
 */
export function claimGuardAlert(
  key: string,
  now: number,
  cooldownMs: number,
  store: Map<string, number> = alertStore
): boolean {
  const last = store.get(key);
  if (last !== undefined && now - last < cooldownMs) return false;
  store.set(key, now);
  if (store.size > MAX_TRACKED_KEYS) {
    const evict = Array.from(store.entries())
      .sort((a, b) => a[1] - b[1])
      .slice(0, store.size - MAX_TRACKED_KEYS);
    for (const [staleKey] of evict) store.delete(staleKey);
  }
  return true;
}

export function buildGuardBlockedMessage(
  decision: GuardDecision,
  at: Date = new Date()
): string {
  return [
    `🚫 [NarrativeHealth] ENV-GUARD chặn một lượt ghi (${decision.code ?? "READ_ONLY"})`,
    "",
    `Host: ${decision.hostname ?? "(không có Host header)"}`,
    `Chi tiết: ${decision.message}`,
    `Thời điểm: ${at.toISOString()}`,
    "",
    "Nếu đây là VPS production: kiểm tra `APP_ENV=production` và",
    "`PRODUCTION_ALLOWED_HOSTS` (hostname, không kèm scheme/port), rồi restart.",
    "Checklist: docs/VPS_ENV_CHECKLIST.md",
  ].join("\n");
}

/** Chỉ dùng cho test — xoá mốc cooldown trong bộ nhớ. */
export function resetGuardAlertState(): void {
  alertStore.clear();
}

/**
 * Gửi cảnh báo (nếu qua cooldown). Trả số kênh nhận được.
 * Không đánh dấu "đã gửi" khi không có kênh nào nhận để lượt sau còn thử.
 */
export async function notifyGuardDenied(
  decision: GuardDecision,
  now: number = Date.now()
): Promise<number> {
  if (process.env.NODE_ENV === "test") return 0;

  const key = guardAlertKey(decision);
  if (!claimGuardAlert(key, now, guardAlertCooldownMs())) return 0;

  const delivered = await dispatchCustomText(
    "ENV-GUARD blocked a write",
    buildGuardBlockedMessage(decision, new Date(now))
  );
  if (delivered === 0) alertStore.delete(key);
  return delivered;
}
