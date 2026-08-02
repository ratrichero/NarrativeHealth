import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { narratives, coinNarratives, coins } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

// GET - List all narratives
export async function GET() {
  try {
    const allNarratives = await db
      .select({
        id: narratives.id,
        name: narratives.name,
        description: narratives.description,
        isActive: narratives.isActive,
        createdAt: narratives.createdAt,
      })
      .from(narratives)
      .orderBy(narratives.name);

    // Get coin counts
    const coinCounts = await db
      .select({
        narrativeId: coinNarratives.narrativeId,
        count: sql<number>`count(*)::int`,
      })
      .from(coinNarratives)
      .innerJoin(coins, eq(coins.id, coinNarratives.coinId))
      .where(eq(coins.isActive, true))
      .groupBy(coinNarratives.narrativeId);

    const countMap = new Map(coinCounts.map((c) => [c.narrativeId, c.count]));

    const result = allNarratives.map((n) => ({
      ...n,
      coinCount: countMap.get(n.id) || 0,
      createdAt: n.createdAt.toISOString(),
    }));

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Error fetching narratives:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch narratives" },
      { status: 500 }
    );
  }
}

// POST - Create a new narrative
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "Name is required" },
        { status: 400 }
      );
    }

    const [newNarrative] = await db
      .insert(narratives)
      .values({
        name: name.trim(),
        description: description || null,
        isActive: true,
      })
      .returning();

    return NextResponse.json({ success: true, data: newNarrative }, { status: 201 });
  } catch (error: unknown) {
    console.error("Error creating narrative:", error);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "23505"
    ) {
      return NextResponse.json(
        { success: false, error: "Narrative with this name already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { success: false, error: "Failed to create narrative" },
      { status: 500 }
    );
  }
}
