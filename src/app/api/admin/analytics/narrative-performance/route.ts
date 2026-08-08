import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { narrativeHealth, narratives, morningSnapshotNarratives } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const days = parseInt(request.nextUrl.searchParams.get("days") || "30");

    const result = await db
      .select({
        narrativeId: narratives.id,
        narrativeName: narratives.name,
        date: narrativeHealth.date,
        healthScore: narrativeHealth.healthScore,
        scoreChange: narrativeHealth.scoreChange,
      })
      .from(narrativeHealth)
      .innerJoin(narratives, eq(narratives.id, narrativeHealth.narrativeId))
      .orderBy(desc(narrativeHealth.date))
      .limit(days * 10);

    const grouped = result.reduce((acc, row) => {
      const key = row.narrativeId;
      if (!acc[key]) {
        acc[key] = {
          narrativeId: row.narrativeId,
          narrativeName: row.narrativeName,
          history: [],
        };
      }
      acc[key].history.push({
        date: typeof row.date === 'string' ? row.date : String(row.date),
        healthScore: typeof row.healthScore === 'number' ? row.healthScore : (row.healthScore ? parseFloat(row.healthScore as any) : null),
        scoreChange: typeof row.scoreChange === 'number' ? row.scoreChange : (row.scoreChange ? parseFloat(row.scoreChange as any) : null),
      });
      return acc;
    }, {} as Record<number, any>);

    return NextResponse.json({ success: true, data: Object.values(grouped) });
  } catch (error) {
    console.error("[GET /api/admin/analytics/narrative-performance]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch narrative performance" },
      { status: 500 }
    );
  }
}
