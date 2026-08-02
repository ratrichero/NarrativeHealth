import { NextResponse } from "next/server";
import { db } from "@/db";
import { schedulerLogs } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

// GET - Get scheduler logs
export async function GET() {
  try {
    const logs = await db
      .select()
      .from(schedulerLogs)
      .orderBy(desc(schedulerLogs.startedAt))
      .limit(50);

    return NextResponse.json({
      success: true,
      data: logs.map((log) => ({
        ...log,
        startedAt: log.startedAt.toISOString(),
        completedAt: log.completedAt?.toISOString() || null,
      })),
    });
  } catch (error) {
    console.error("Error fetching logs:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch logs" },
      { status: 500 }
    );
  }
}
