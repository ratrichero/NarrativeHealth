/**
 * OPS-HEARTBEAT (I/O) — đọc `scheduler_logs`, gửi cảnh báo có cooldown.
 *
 * Logic thuần nằm ở `./heartbeat`. Ở đây chỉ có query + dedupe qua
 * `app_settings` (cùng pattern `catalyst.stale.alerts`), để /api/health gọi
 * được mà không spam webhook mỗi lần uptime ping.
 */

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, schedulerLogs } from "@/db/schema";
import { dispatchCustomText } from "@/lib/services/alert-delivery.service";
import {
  buildSchedulerStallMessage,
  evaluateSchedulerHeartbeat,
  resolveStallAlertCooldownHours,
  resolveStallHours,
  type SchedulerHeartbeatStatus,
} from "./heartbeat";

const ALERTS_KEY = "ops.scheduler.stall.alert";

export async function readSchedulerHeartbeatStatus(
  now: number = Date.now()
): Promise<SchedulerHeartbeatStatus> {
  const rows = await db
    .select({
      jobName: schedulerLogs.jobName,
      status: schedulerLogs.status,
      startedAt: schedulerLogs.startedAt,
      completedAt: schedulerLogs.completedAt,
    })
    .from(schedulerLogs)
    .where(eq(schedulerLogs.status, "COMPLETED"))
    .orderBy(desc(schedulerLogs.startedAt))
    .limit(50);

  return evaluateSchedulerHeartbeat(rows, now, resolveStallHours());
}

async function readLastAlertAt(): Promise<number | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, ALERTS_KEY)).limit(1);
  const value = row?.value as { sentAt?: unknown } | undefined;
  if (!value || typeof value.sentAt !== "string") return null;
  const at = Date.parse(value.sentAt);
  return Number.isFinite(at) ? at : null;
}

async function writeLastAlertAt(at: Date): Promise<void> {
  const value = { sentAt: at.toISOString() };
  await db
    .insert(appSettings)
    .values({ key: ALERTS_KEY, value, updatedAt: at })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: at } });
}

/**
 * Gửi cảnh báo nếu đang stalled và đã qua cooldown.
 * Trả số kênh nhận được (0 = đang cooldown / chưa cấu hình kênh / test).
 */
export async function dispatchSchedulerStallAlert(
  status: SchedulerHeartbeatStatus,
  now: number = Date.now()
): Promise<number> {
  if (process.env.NODE_ENV === "test") return 0;
  if (!status.stalled) return 0;

  const cooldownMs = resolveStallAlertCooldownHours() * 3_600_000;
  try {
    const last = await readLastAlertAt();
    if (last !== null && now - last < cooldownMs) return 0;
  } catch {
    // Không đọc được dedupe → không spam.
    return 0;
  }

  const delivered = await dispatchCustomText(
    "Scheduler heartbeat stale",
    buildSchedulerStallMessage(status, new Date(now))
  );
  if (delivered === 0) return 0;

  try {
    await writeLastAlertAt(new Date(now));
  } catch (error) {
    console.warn(
      "[OPS-HEARTBEAT] không lưu được mốc cảnh báo:",
      error instanceof Error ? error.message : String(error)
    );
  }
  return delivered;
}
