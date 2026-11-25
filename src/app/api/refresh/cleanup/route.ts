import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { schedulerLogs } from "@/db/schema";
import { lt, eq } from "drizzle-orm";
import { runtimeGuardResponse } from "@/lib/env/route-guard";
import { authorizeSchedulerRequest, schedulerUnauthorized } from "@/lib/env/scheduler-token";

export const dynamic = "force-dynamic";

// Stale job timeout (15 minutes)
const STALE_TIMEOUT = 15 * 60 * 1000;

// POST - Clean up stale STARTED jobs
export async function POST(request: NextRequest) {
  // ENV-GUARD-01: sửa scheduler_logs production — local mặc định read-only.
  const blocked = runtimeGuardResponse(request, "write");
  if (blocked) return blocked;

  // SCHEDULER-AUTH: guard chỉ kiểm Host (header do client gửi). Cleanup sửa
  // scheduler_logs production nên phải có đúng một trong: token scheduler
  // (SCHEDULER_REFRESH_TOKEN), admin session, hoặc APP_ENV=development.
  const auth = await authorizeSchedulerRequest(request);
  if (!auth.ok) {
    console.warn("[REFRESH-CLEANUP] POST rejected: missing/invalid scheduler credentials");
    return schedulerUnauthorized(auth);
  }

  try {
    const now = new Date();
    const staleTime = new Date(now.getTime() - STALE_TIMEOUT);

    // Find all STARTED jobs that started before the stale threshold
    const staleJobs = await db
      .select()
      .from(schedulerLogs)
      .where(lt(schedulerLogs.startedAt, staleTime))
      .limit(100);

    const staleStartedJobs = staleJobs.filter((job) => job.status === "STARTED");

    let cleanedCount = 0;

    for (const job of staleStartedJobs) {
      await db
        .update(schedulerLogs)
        .set({
          status: "FAILED",
          completedAt: new Date(),
          duration: Math.round((now.getTime() - job.startedAt.getTime()) / 1000),
          errorMessage: "Job timeout - marked as stale by cleanup",
        })
        .where(eq(schedulerLogs.id, job.id));
      cleanedCount++;
    }

    return NextResponse.json({
      success: true,
      data: {
        message: `Cleaned up ${cleanedCount} stale job(s)`,
        cleanedCount,
        staleJobs: staleStartedJobs.map((job) => ({
          id: job.id,
          jobName: job.jobName,
          startedAt: job.startedAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    console.error("Error cleaning up stale jobs:", error);
    return NextResponse.json(
      { success: false, error: "Failed to clean up stale jobs" },
      { status: 500 }
    );
  }
}