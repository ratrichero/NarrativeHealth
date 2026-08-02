import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { coins, coinNarratives, narratives } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

// GET - List all coins
export async function GET() {
  try {
    const allCoins = await db
      .select({
        id: coins.id,
        symbol: coins.symbol,
        name: coins.name,
        binanceSpotSymbol: coins.binanceSpotSymbol,
        binanceFuturesSymbol: coins.binanceFuturesSymbol,
        coingeckoId: coins.coingeckoId,
        hasFutures: coins.hasFutures,
        isActive: coins.isActive,
        createdAt: coins.createdAt,
      })
      .from(coins)
      .orderBy(coins.symbol);

    // Get narratives for each coin
    const coinNarrativesData = await db
      .select({
        coinId: coinNarratives.coinId,
        narrativeName: narratives.name,
      })
      .from(coinNarratives)
      .innerJoin(narratives, eq(narratives.id, coinNarratives.narrativeId));

    const narrativeMap = new Map<number, string[]>();
    for (const cn of coinNarrativesData) {
      if (!narrativeMap.has(cn.coinId)) {
        narrativeMap.set(cn.coinId, []);
      }
      narrativeMap.get(cn.coinId)!.push(cn.narrativeName);
    }

    const result = allCoins.map((c) => ({
      ...c,
      narratives: narrativeMap.get(c.id) || [],
      createdAt: c.createdAt.toISOString(),
    }));

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Error fetching coins:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch coins" },
      { status: 500 }
    );
  }
}

// POST - Create a new coin
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      symbol,
      name,
      binanceSpotSymbol,
      binanceFuturesSymbol,
      coingeckoId,
      narrativeIds,
    } = body;

    if (!symbol || typeof symbol !== "string" || symbol.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "Symbol is required" },
        { status: 400 }
      );
    }

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "Name is required" },
        { status: 400 }
      );
    }

    // Create coin
    const [newCoin] = await db
      .insert(coins)
      .values({
        symbol: symbol.trim().toUpperCase(),
        name: name.trim(),
        binanceSpotSymbol: binanceSpotSymbol || null,
        binanceFuturesSymbol: binanceFuturesSymbol || null,
        coingeckoId: coingeckoId || null,
        hasFutures: !!binanceFuturesSymbol,
        isActive: true,
      })
      .returning();

    // Add narrative associations
    if (Array.isArray(narrativeIds) && narrativeIds.length > 0) {
      await db.insert(coinNarratives).values(
        narrativeIds.map((narrativeId: number, index: number) => ({
          coinId: newCoin.id,
          narrativeId,
          isPrimary: index === 0,
        }))
      );
    }

    return NextResponse.json({ success: true, data: newCoin }, { status: 201 });
  } catch (error: unknown) {
    console.error("Error creating coin:", error);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "23505"
    ) {
      return NextResponse.json(
        { success: false, error: "Coin with this symbol already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { success: false, error: "Failed to create coin" },
      { status: 500 }
    );
  }
}
