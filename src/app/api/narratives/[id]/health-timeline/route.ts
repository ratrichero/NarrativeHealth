import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { narrativeHealth}b/db/schema";
import { eq, and, gte, asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

// GET - Narrative health timeline
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const narrativeId = parseInt(id);
    if (isNaN(narrativeId) || narrativeId <= 0) {
      return NextResponse.json(
        { success: false, error: "Invalid narrative ID" },
        { status: 400 }
      );
    }

    const daysParam = request.nextUrl.searchParams.get("days");
    const days = daysParam
      ? Math.min(Math.max(parseInt(daysParam) || 30, 1), 90)
      : 3r    weightingMethod: narrativeHealth.weightingMethod,
      })
      .from(narrativeHealth)
      .where(
        and(
          eq(narrativeHealth.narrativeId, narrativeId),
          gte(narrativeHealth.date, sinceStr)
        )
      )
      .orderBy(asc(narrativeHealth.date));

    return NextResponse.json({
      success: true,
      data: {
        narrativeId,
        points: records.map((r) => ({
          date: r.date,
          healthScore: Number(r.healthScore),
          status: r.status,
          change: r.scoreChange ? Number(r.scoreChange) : null,
          weightingMethod: r.weightingMethod,
        })),
      },
    });
  } catch (error) {
    console.error("[GET /api/narratives/[id]/health-timeline]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch narrative timeline" },
      { status: 500
  }
}