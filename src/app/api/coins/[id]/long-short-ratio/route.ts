import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { coins } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  fetchBinanceGlobalLongShortRatio,
  fetchBinanceTopLongShortRatio,
} from "@/lib/collectors/binance";

export const dynamic = "force-dynamic";

// GET - Get long/short ratio for a coin
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const coinId = parseInt(id);

    if (isNaN(coinId)) {
      return NextResponse.json(
        { success: false, error: "Invalid coin ID" },
        { status: 400 }
      );
    }

    // Get coin
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

    if (!coin.binanceFuturesSymbol) {
      return NextResponse.json(
        { success: false, error: "No Binance Futures symbol configured for this coin" },
        { status: 400 }
      );
    }

    // Fetch both ratios in parallel
    const [globalRatio, topTraderRatio] = await Promise.all([
      fetchBinanceGlobalLongShortRatio(coin.binanceFuturesSymbol),
      fetchBinanceTopLongShortRatio(coin.binanceFuturesSymbol),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        global: globalRatio,
        topTrader: topTraderRatio,
        symbol: coin.binanceFuturesSymbol,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error fetching long/short ratio:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch long/short ratio" },
      { status: 500 }
    );
  }
}