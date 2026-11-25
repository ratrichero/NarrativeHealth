import { NextResponse } from "next/server";
import { db } from "@/db";
import { schedulerLogs } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

// GET - Get current refresh status.
//
// Endpoint public (uptime/verification) nên chỉ trả trạng thái tối thiểu:
// isRefreshing/status/thời gian/duration/jobName. `errorMessage`, `details` và
// `recordsProcessed` không được lộ ra ngoài — chúng có thể chứa lỗi nội bộ,
// payload DB hoặc log vận hành; admin xem qua trang Admin/scheduler logs.
export async function GET() {
  try {
    const now = new Date();
    const staleThreshold = 15 * 60 * 1000; // 15 minutes in milliseconds
    const staleTime = new Date(now.getTime() - staleThreshold);

    // Get the latest scheduler log entry
    const [latestLog] = await db
      .select()
      .from(schedulerLogs)
      .orderBy(desc(schedulerLogs.startedAt))
      .limit(1);

    if (!latestLog) {
      return NextResponse.json({
        success: true,
        data: {
          isRefreshing: false,
          status: "IDLE",
          latestJob: null,
          startedAt: null,
          completedAt: null,
          duration: null,
        },
      });
    }

    // Check if the job is stale (STARTED but too old).
    //
    // GET phải thuần đọc: endpoint này public (không token/guard) nên trước đây
    // bất kỳ ai gọi cũng sửa được scheduler_logs thành FAILED. Việc đối soát
    // stale thuộc về POST /api/refresh/cleanup (có SCHEDULER-AUTH) và
    // checkRefreshLock() ở lượt refresh kế tiếp — cả hai đều đã tự chữa.
    const isStale = latestLog.status === "STARTED" && latestLog.startedAt < staleTime;

    const status = isStale ? "FAILED" : latestLog.status;
    const completedAt = isStale ? now : latestLog.completedAt;
    const duration = isStale
      ? Math.round((now.getTime() - latestLog.startedAt.getTime()) / 1000)
      : latestLog.duration;

    const isRefreshing = status === "STARTED";

    return NextResponse.json({
      success: true,
      data: {
        isRefreshing,
        status,
        latestJob: {
          jobName: latestLog.jobName,
        },
        startedAt: latestLog.startedAt.toISOString(),
        completedAt: completedAt?.toISOString() || null,
        duration,
      },
    });
  } catch (error) {
    console.error("Error fetching refresh status:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch refresh status",
      },
      { status: 500 }
    );
  }
}
