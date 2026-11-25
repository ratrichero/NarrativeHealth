import { db } from "@/db";
import { sql } from "drizzle-orm";
import {
  dispatchSchedulerStallAlert,
  readSchedulerHeartbeatStatus,
} from "@/lib/ops/scheduler-heartbeat";
import type { SchedulerHeartbeatStatus } from "@/lib/ops/heartbeat";
import {
  readRadarAlertOutboxStatus,
  type RadarOutboxStatus,
} from "@/lib/market/alert-outbox";
import {
  readRadarAlertStats,
  type RadarAlertStats,
} from "@/lib/market/alert-stats";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — probe cho uptime monitor.
 *
 * `ok` chỉ phản ánh DB (như cũ). Thêm `scheduler`: lượt refresh/scheduler
 * COMPLETED gần nhất và có đang quá hạn không. Khi stalled, cảnh báo được đẩy
 * qua alert-delivery (cooldown `SCHEDULER_STALL_ALERT_COOLDOWN_HOURS`), nên
 * monitor chỉ cần ping endpoint này định kỳ.
 */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }

  let scheduler: (SchedulerHeartbeatStatus & { checked: true }) | { checked: false } = {
    checked: false,
  };
  try {
    const status = await readSchedulerHeartbeatStatus();
    scheduler = { ...status, checked: true };
    if (status.stalled) {
      // Không chặn health check: webhook có thể chậm tới 8s.
      void dispatchSchedulerStallAlert(status).catch((error) => {
        console.warn(
          "[OPS-HEARTBEAT] dispatch failed:",
          error instanceof Error ? error.message : String(error)
        );
      });
    }
  } catch (error) {
    console.warn(
      "[OPS-HEARTBEAT] không đọc được trạng thái scheduler:",
      error instanceof Error ? error.message : String(error)
    );
  }

  // RADAR-TG P2: outbox alert radar — pending/failed/cap hôm nay để vận hành
  // thấy alert có bị kẹt hay không. Bảng chưa migrate → checked:false.
  let radar:
    | (RadarOutboxStatus & { stats: RadarAlertStats | null })
    | { checked: false } = { checked: false };
  try {
    const outbox = await readRadarAlertOutboxStatus();
    let stats: RadarAlertStats | null = null;
    try {
      stats = await readRadarAlertStats(7);
    } catch (error) {
      console.warn(
        "[RADAR-ALERT-METRICS] không đọc được thống kê alert:",
        error instanceof Error ? error.message : String(error)
      );
    }
    radar = { ...outbox, stats };
  } catch (error) {
    console.warn(
      "[RADAR-OUTBOX] không đọc được trạng thái outbox:",
      error instanceof Error ? error.message : String(error)
    );
  }

  return Response.json(
    { ok: true, scheduler, radar },
    { headers: { "cache-control": "no-store" } }
  );
}
