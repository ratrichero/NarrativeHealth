import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { coins } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fetchBinanceFuturesKlines, fetchBinanceSpotKlines } from "@/lib/collectors/binance";
import { runTechnicalAnalysis, convertBinanceKlines } from "@/lib/technical-analysis/engine";
import { Timeframe } from "@/lib/technical-analysis/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET - Technical Analysis for a coin
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

    // Get coin information
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

    // Determine market type and symbol
    let marketType: "futures" | "spot" = "spot";
    let marketSymbol = coin.binanceSpotSymbol;
    let marketFallbackSymbol = coin.binanceFuturesSymbol;

    // Prioritize futures if available
    if (coin.binanceFuturesSymbol && coin.hasFutures) {
      marketType = "futures";
      marketSymbol = coin.binanceFuturesSymbol;
      marketFallbackSymbol = coin.binanceSpotSymbol;
    }

    if (!marketSymbol) {
      return NextResponse.json(
        { success: false, error: "No Binance symbol configured for this coin" },
        { status: 400 }
      );
    }

    // Fetch data for all timeframes
    const timeframes: Timeframe[] = ["15m", "1h", "4h", "1d"];
    const timeframeData: Record<Timeframe, any[]> = {
      "15m": [],
      "1h": [],
      "4h": [],
      "1d": [],
    };

    let resolvedMarketType = marketType;
    let resolvedMarketSymbol = marketSymbol;

    for (const tf of timeframes) {
      try {
        let klines;
        
        if (marketType === "futures") {
          klines = await fetchBinanceFuturesKlines(marketSymbol, 200, tf);
          
          // Fallback to spot if futures fails
          if ((!klines || klines.length === 0) && marketFallbackSymbol) {
            console.log(`Futures ${tf} failed for ${coin.symbol}, trying spot fallback`);
            klines = await fetchBinanceSpotKlines(marketFallbackSymbol, 200, tf);
            if (klines && klines.length > 0) {
              resolvedMarketType = "spot";
              resolvedMarketSymbol = marketFallbackSymbol;
            }
          }
        } else {
          klines = await fetchBinanceSpotKlines(marketSymbol, 200, tf);
          
          // Fallback to futures if spot fails
          if ((!klines || klines.length === 0) && marketFallbackSymbol) {
            console.log(`Spot ${tf} failed for ${coin.symbol}, trying futures fallback`);
            klines = await fetchBinanceFuturesKlines(marketFallbackSymbol, 200, tf);
            if (klines && klines.length > 0) {
              resolvedMarketType = "futures";
              resolvedMarketSymbol = marketFallbackSymbol;
            }
          }
        }

        if (klines && klines.length > 0) {
          timeframeData[tf] = convertBinanceKlines(klines);
        } else {
          console.warn(`No ${tf} data available for ${coin.symbol}`);
          timeframeData[tf] = [];
        }
      } catch (error) {
        console.error(`Error fetching ${tf} data for ${coin.symbol}:`, error);
        timeframeData[tf] = [];
      }
    }

    // Check if we have at least some data
    const hasData = Object.values(timeframeData).some(data => data.length > 0);
    if (!hasData) {
      return NextResponse.json(
        { success: false, error: "No market data available for this coin" },
        { status: 503 }
      );
    }

    // Run technical analysis
    const analysisResult = await runTechnicalAnalysis(
      coin.symbol,
      resolvedMarketSymbol,
      resolvedMarketType,
      timeframeData
    );

    return NextResponse.json({
      success: true,
      data: analysisResult,
    });
  } catch (error) {
    console.error("Error in technical analysis:", error);
    return NextResponse.json(
      { success: false, error: "Failed to perform technical analysis" },
      { status: 500 }
    );
  }
}
