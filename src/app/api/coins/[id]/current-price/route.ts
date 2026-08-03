import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { coins } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  fetchBinanceFuturesCurrentPrice,
  fetchBinanceCurrentPrice,
} from "@/lib/collectors/binance";

export const dynamic = "force-dynamic";

// GET - Get current live price for a coin
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

    // Fetch current price - prioritize Futures if available, otherwise Spot
    let price: number | null = null;
    let source: string = "binance_spot";
    let symbol: string | null = coin.binanceSpotSymbol;

    if (coin.binanceFuturesSymbol) {
      const futuresPrice = await fetchBinanceFuturesCurrentPrice(
        coin.binanceFuturesSymbol
      );
      if (futuresPrice !== null) {
        price = futuresPrice;
        source = "binance_futures";
        symbol = coin.binanceFuturesSymbol;
      }
    }

    // Fallback to Spot if Futures failed or not configured
    if (price === null && coin.binanceSpotSymbol) {
      const spotPrice = await fetchBinanceCurrentPrice(
        coin.binanceSpotSymbol
      );
      if (spotPrice !== null) {
        price = spotPrice;
        source = "binance_spot";
        symbol = coin.binanceSpotSymbol;
      }
    }

    if (price === null) {
      return NextResponse.json(
        { success: false, error: "Unable to fetch current price from Binance" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        price,
        source,
        symbol,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error fetching current price:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch current price" },
      { status: 500 }
    );
  }
}