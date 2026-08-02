import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { watchlists, coins, healthScores, recommendations } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getHealthStatus, getBusinessDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

// GET - Get watchlist
export async function GET() {
  try {
    const today = getBusinessDate();

    const watchlistItems = await db
      .select({
        id: watchlists.id,
        coinId: watchlists.coinId,
        note: watchlists.note,
        priority: watchlists.priority,
        symbol: coins.symbol,
        name: coins.name,
      })
      .from(watchlists)
      .innerJoin(coins, eq(coins.id, watchlists.coinId))
      .orderBy(desc(watchlists.priority), watchlists.createdAt);

    const enrichedItems = await Promise.all(
      watchlistItems.map(async (item) => {
        const [health] = await db
          .select()
          .from(healthScores)
          .where(and(eq(healthScores.coinId, item.coinId), eq(healthScores.date, today)))
          .limit(1);

        const [rec] = await db
          .select()
          .from(recommendations)
          .where(and(eq(recommendations.coinId, item.coinId), eq(recommendations.date, today)))
          .limit(1);

        return {
          id: item.id,
          coinId: item.coinId,
          symbol: item.symbol,
          name: item.name,
          note: item.note,
          priority: item.priority,
          healthScore: health?.healthScore || null,
          scoreChange: health?.scoreChange || null,
          status: health ? getHealthStatus(health.healthScore) : null,
          signal: rec?.signal || null,
          confidenceScore: health?.confidenceScore || null,
        };
      })
    );

    return NextResponse.json({ success: true, data: enrichedItems });
  } catch (error) {
    console.error("Error fetching watchlist:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch watchlist" },
      { status: 500 }
    );
  }
}

// POST - Add coin to watchlist
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { coinId, note, priority } = body;

    if (!coinId || typeof coinId !== "number") {
      return NextResponse.json(
        { success: false, error: "Coin ID is required" },
        { status: 400 }
      );
    }

    // Check if coin exists
    const [coin] = await db
      .select()
      .from(coins)
      .where(eq(coins.id, coinId))
      .limit(1);

    if (!coin) {
      return NextResponse.json(
        { success: false, error: "Coin not found" },
        { status: 404 }
      );
    }

    const [newItem] = await db
      .insert(watchlists)
      .values({
        coinId,
        note: note || null,
        priority: priority || 0,
      })
      .returning();

    return NextResponse.json({ success: true, data: newItem }, { status: 201 });
  } catch (error: unknown) {
    console.error("Error adding to watchlist:", error);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "23505"
    ) {
      return NextResponse.json(
        { success: false, error: "Coin is already in watchlist" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { success: false, error: "Failed to add to watchlist" },
      { status: 500 }
    );
  }
}
