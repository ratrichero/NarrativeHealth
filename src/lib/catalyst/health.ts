// RADAR-06-STALE — phát hiện feed chết âm thầm.
//
// Một nguồn được coi là STALE khi:
//   • quá hạn theo nhịp của scope (announcement 5', RSS 15', unlock 60' — lấy
//     đúng env SCHEDULER_CATALYST_* nên đổi nhịp là đổi ngưỡng), hoặc
//   • 2 lượt liên tiếp lấy được 0 fact mà không lỗi (feed trả 200 nhưng rỗng).
//
// Unlock đọc thẳng `event_risks`: nếu bảng còn dữ liệu nhưng adapter trả 0 liên
// tiếp thì gần như chắc chắn là query/mapping hỏng, không phải "không có unlock".
//
// Chỉ đọc trạng thái sync đã lưu — không gọi mạng. Cảnh báo dùng lại kênh alert
// sẵn có (`dispatchCustomText` → ALERT_WEBHOOK_URL/Telegram/email), có cooldown
// để job 5 phút không spam.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { dispatchCustomText } from "@/lib/services/alert-delivery.service";
import type { CatalystSourceStatus, CatalystSyncScope } from "./sync";
import { peekRadarRuntimeConfig } from "@/lib/settings/radar-config";

/** Số lượt liên tiếp 0 fact (không lỗi) để coi là chết âm thầm. */
export const CATALYST_STALE_ZERO_RUNS = 2;

const ALERTS_KEY = "catalyst.stale.alerts";
const ALERT_MAX_RECORDS = 100;
const ALERT_KEEP_DAYS = 30;

const DEFAULT_INTERVAL_MINUTES: Record<Exclude<CatalystSyncScope, "all">, number> = {
  announcements: 5,
  news: 15,
  unlocks: 60,
};

const INTERVAL_ENV: Record<Exclude<CatalystSyncScope, "all">, string> = {
  announcements: "SCHEDULER_CATALYST_ANNOUNCEMENTS_MINUTES",
  news: "SCHEDULER_CATALYST_NEWS_MINUTES",
  unlocks: "SCHEDULER_CATALYST_UNLOCKS_MINUTES",
};

/** Nhịp kỳ vọng của scope (phút), đọc env scheduler; `all` = chạy tay. */
export function catalystScopeIntervalMinutes(scope: CatalystSyncScope): number | null {
  if (scope === "all") return null;
  const parsed = Number(process.env[INTERVAL_ENV[scope]]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MINUTES[scope];
}

/**
 * Quá hạn bao lâu thì báo: 2.5 nhịp (bỏ 2 lượt liền), tối thiểu nhịp + 5 phút
 * để một lượt chậm do tải không bị báo nhầm.
 */
export function catalystScopeStaleAfterMinutes(scope: CatalystSyncScope): number | null {
  const interval = catalystScopeIntervalMinutes(scope);
  if (interval === null) return null;
  return Math.max(interval * 2.5, interval + 5);
}

/** Tên nguồn → scope thật (không phụ thuộc scope của lượt chạy gần nhất). */
export function catalystSourceScope(name: string): CatalystSyncScope {
  if (name.startsWith("binance.")) return "announcements";
  if (name.startsWith("rss.")) return "news";
  if (name === "unlocks.event_risks") return "unlocks";
  return "all";
}

export type CatalystStaleReason = "overdue" | "zero_facts";

export interface CatalystSourceStaleness {
  name: string;
  scope: CatalystSyncScope;
  stale: boolean;
  reasons: CatalystStaleReason[];
  emptyStreak: number;
  minutesSince: number | null;
  /** Số phút vượt ngưỡng; null khi không áp ngưỡng (scope `all`). */
  minutesLate: number | null;
  expectedEveryMinutes: number | null;
}

/**
 * Chuỗi 0 fact của lượt hiện tại: lỗi mạng/HTTP reset chuỗi (đó là lỗi ồn ào,
 * đã có cột LỖI), còn fetch thành công mà 0 fact thì cộng dồn.
 */
export function computeEmptyStreak(
  result: { fetched: number; error?: string },
  previousStreak: number | undefined
): number {
  if (result.error) return 0;
  if (result.fetched > 0) return 0;
  return Math.max(0, previousStreak ?? 0) + 1;
}

/** Tính STALE cho từng nguồn. Pure (trừ việc đọc env nhịp), test không cần DB. */
export function catalystStaleness(
  sources: CatalystSourceStatus[],
  now = Date.now(),
  staleAfterMinutes?: Partial<Record<CatalystSyncScope, number>>
): CatalystSourceStaleness[] {
  return sources.map((source) => {
    const scope = catalystSourceScope(source.name);
    const expectedEveryMinutes = catalystScopeIntervalMinutes(scope);
    const staleAfter = staleAfterMinutes?.[scope] ?? catalystScopeStaleAfterMinutes(scope);
    const last = source.lastRunAt ? Date.parse(source.lastRunAt) : NaN;
    const minutesSince = Number.isFinite(last) ? Math.max(0, Math.round((now - last) / 60_000)) : null;
    const minutesLate =
      staleAfter !== null && minutesSince !== null ? Math.max(0, Math.round(minutesSince - staleAfter)) : null;

    const reasons: CatalystStaleReason[] = [];
    if (staleAfter !== null && (minutesSince === null || minutesSince > staleAfter)) reasons.push("overdue");
    if (!source.failing && (source.emptyStreak ?? 0) >= CATALYST_STALE_ZERO_RUNS) reasons.push("zero_facts");

    return {
      name: source.name,
      scope,
      stale: reasons.length > 0,
      reasons,
      emptyStreak: source.emptyStreak ?? 0,
      minutesSince,
      minutesLate,
      expectedEveryMinutes,
    };
  });
}

/** Nội dung cảnh báo (một message gộp để không dội nhiều lần). */
export function buildCatalystStaleMessage(stale: CatalystSourceStaleness[]): string {
  const lines = stale.map((row) => {
    const parts: string[] = [];
    if (row.reasons.includes("zero_facts")) parts.push(`0 fact ${row.emptyStreak} lượt liền`);
    if (row.reasons.includes("overdue")) {
      parts.push(
        row.minutesSince === null
          ? "chưa có lần chạy nào"
          : `quá hạn ${row.minutesLate ?? 0} phút (nhịp ${row.expectedEveryMinutes ?? "?"} phút, lần cuối ${row.minutesSince} phút trước)`
      );
    }
    return `- ${row.name} [${row.scope}]: ${parts.join(" · ")}`;
  });

  return [
    `⚠️ [NarrativeHealth] ${stale.length} nguồn catalyst STALE`,
    "",
    ...lines,
    "",
    "Kiểm tra: Admin → Analytics → Catalyst sync (cột Trạng thái + Lấy/Lưu).",
    "Unlock đọc từ event_risks: 0 fact liên tiếp thường là query/mapping hỏng.",
  ].join("\n");
}

function alertCooldownHours(): number {
  const hours = peekRadarRuntimeConfig().catalystStaleCooldownHours;
  return hours >= 1 ? hours : 6;
}

async function readAlerted(): Promise<Record<string, string> | null> {
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, ALERTS_KEY)).limit(1);
    if (!row?.value || typeof row.value !== "object" || Array.isArray(row.value)) return {};
    const record: Record<string, string> = {};
    for (const [name, at] of Object.entries(row.value as Record<string, unknown>)) {
      if (typeof at === "string" && Number.isFinite(Date.parse(at))) record[name] = at;
    }
    return record;
  } catch {
    return null;
  }
}

async function writeAlerted(record: Record<string, string>): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: ALERTS_KEY, value: record, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: record, updatedAt: new Date() } });
}

/**
 * Gửi cảnh báo cho các nguồn STALE chưa được báo trong `cooldown` giờ.
 * Trả số kênh nhận được (0 = chưa cấu hình kênh / test / đang cooldown).
 * Không đánh dấu "đã gửi" khi không có kênh nào nhận để lượt sau còn thử.
 */
export async function dispatchCatalystStaleAlerts(
  stale: CatalystSourceStaleness[],
  now = Date.now()
): Promise<number> {
  if (process.env.NODE_ENV === "test") return 0;
  const current = stale.filter((row) => row.stale);
  if (current.length === 0) return 0;

  const alerted = await readAlerted();
  if (alerted === null) return 0; // không đọc được dedupe → không spam

  const cutoff = now - alertCooldownHours() * 3_600_000;
  const due = current.filter((row) => {
    const at = Date.parse(alerted[row.name] ?? "");
    return !Number.isFinite(at) || at < cutoff;
  });
  if (due.length === 0) return 0;

  const delivered = await dispatchCustomText("Catalyst feed stale", buildCatalystStaleMessage(due));
  if (delivered === 0) return 0;

  const next: Record<string, string> = { ...alerted };
  for (const row of due) next[row.name] = new Date(now).toISOString();

  const keepAfter = now - ALERT_KEEP_DAYS * 86_400_000;
  const pruned = Object.entries(next)
    .filter(([, at]) => Date.parse(at) >= keepAfter)
    .sort(([, a], [, b]) => Date.parse(b) - Date.parse(a))
    .slice(0, ALERT_MAX_RECORDS);
  try {
    await writeAlerted(Object.fromEntries(pruned));
  } catch (error) {
    console.warn(
      "[CATALYST] không lưu được dedupe cảnh báo STALE:",
      error instanceof Error ? error.message : String(error)
    );
  }

  return delivered;
}
