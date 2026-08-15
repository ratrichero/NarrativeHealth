import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { schedulerLogs } from "@/db/schema";
import {
  P3_EXECUTION_JOB_NAME,
  runP3ExecutionLoop,
  type P3ExecutionLoopOptions,
} from "@/lib/p3/execution-loop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Lock timeout mirrors /api/refresh (15 minutes).
const P3_LOCK_TIMEOUT = 15 * 60 * 1000;

async function checkP3Lock(): Promise<{ isLocked: boolean; lockInfo?: unknown }> {
  const now = new Date();
  const staleTime = new Date(now.getTime() - P3_LOCK_TIMEOUT);

  const [activeJob] = await db
    .select()
    .from(schedulerLogs)
    .where(and(
      eq(schedulerLogs.jobName, P3_EXECUTION_JOB_NAME),
      eq(schedulerLogs.status, "STARTED"),
    ))
    .orderBy(desc(schedulerLogs.startedAt))
    .limit(1);

  if (!activeJob) return { isLocked: false };

  if (activeJob.startedAt < staleTime) {
    await db
      .update(schedulerLogs)
      .set({
        status: "FAILED",
        completedAt: new Date(),
        duration: Math.round((now.getTime() - activeJob.startedAt.getTime()) / 1000),
        errorMessage: "P3 execution loop timeout - marked as stale",
      })
      .where(eq(schedulerLogs.id, activeJob.id));
    return { isLocked: false };
  }

  return {
    isLocked: true,
    lockInfo: {
      jobName: activeJob.jobName,
      startedAt: activeJob.startedAt.toISOString(),
      jobId: activeJob.id,
    },
  };
}

/**
 * POST /api/admin/p3/execute
 *
 * Body:
 *   { dryRun?: boolean, narratives?: number[], windowEnd?: string }
 *
 * - dryRun=true  → read-only eligibility pass (no orchestrator, no scheduler log).
 * - dryRun=false → authoritative: acquires the P3 lock, logs STARTED/COMPLETED
 *                  (or FAILED), and runs the execution loop.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const body = await request.json().catch(() => ({}));
  const dryRun = body.dryRun === true;

  const options: P3ExecutionLoopOptions = { dryRun };
  if (Array.isArray(body.narratives)) {
    options.narratives = body.narratives.map((n: unknown) => Number(n)).filter(Number.isFinite);
  }
  if (typeof body.windowEnd === "string" && body.windowEnd.length > 0) {
    const parsed = new Date(body.windowEnd);
    if (!Number.isNaN(parsed.getTime())) options.windowEnd = parsed;
  }

  // Dry runs are strictly read-only: no lock, no scheduler log.
  if (!dryRun) {
    const lockCheck = await checkP3Lock();
    if (lockCheck.isLocked) {
      return NextResponse.json(
        { success: false, error: "P3 execution loop already in progress", details: lockCheck.lockInfo },
        { status: 409 }
      );
    }
  }

  let logEntryId: number | null = null;
  if (!dryRun) {
    const [entry] = await db
      .insert(schedulerLogs)
      .values({
        jobName: P3_EXECUTION_JOB_NAME,
        status: "STARTED",
        startedAt: new Date(),
      })
      .returning({ id: schedulerLogs.id });
    logEntryId = entry.id;
  }

  try {
    const result = await runP3ExecutionLoop(options);

    if (!dryRun && logEntryId != null) {
      await db
        .update(schedulerLogs)
        .set({
          status: "COMPLETED",
          completedAt: new Date(),
          duration: Math.round((Date.now() - startTime) / 1000),
          recordsProcessed: result.outcomes.length,
          details: {
            window: result.window,
            windowEnd: result.windowEnd,
            calculationMode: result.calculationMode,
            executed: result.executed,
            skipped: result.skipped,
            notEligible: result.notEligible,
            failed: result.failed,
            outcomes: result.outcomes,
          },
        })
        .where(eq(schedulerLogs.id, logEntryId));
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("[POST /api/admin/p3/execute]", error);
    if (!dryRun && logEntryId != null) {
      await db
        .update(schedulerLogs)
        .set({
          status: "FAILED",
          completedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        .where(eq(schedulerLogs.id, logEntryId));
    }
    return NextResponse.json(
      { success: false, error: "P3 execution loop failed" },
      { status: 500 }
    );
  }
}
