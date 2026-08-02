import { NextResponse } from "next/server";
import { db } from "@/db";
import { schedulerLogs } from "@/db/schema";
import { eq, desc, and, gt, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

// GET - Get current refresh status
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
          recordsProcessed: null,
          errorMessage: null,
          details: null,
        },
      });
    }

    // Check if the job is stale (STARTED but too old)
    const isStale = latestLog.status === "STARTED" && latestLog.startedAt < staleTime;

    let status = latestLog.status;
    let completedAt = latestLog.completedAt;
    let duration = latestLog.duration;

    // If stale, mark as FAILED
    if (isStale) {
      status = "FAILED";
      completedAt = new Date();
      duration = Math.round((now.getTime() - latestLog.startedAt.getTime()) / 1000);
      
      // Update the stale job
      await db
        .update(schedulerLogs)
        .set({
          status: "FAILED",
          completedAt: new Date(),
          duration,
          errorMessage: "Job timeout - marked as stale",
        })
        .where(eq(schedulerLogs.id, latestLog.id));
    }

    const isRefreshing = status === "STARTED";

    return NextResponse.json({
      success: true,
      data: {
        isRefreshing,
        status,
        latestJob: {
          id: latestLog.id,
          jobName: latestLog.jobName,
        },
        startedAt: latestLog.startedAt.toISOString(),
        completedAt: completedAt?.toISOString() || null,
        duration,
        recordsProcessed: latestLog.recordsProcessed || null,
        errorMessage: latestLog.errorMessage || null,
        details: latestLog.details || null,
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
