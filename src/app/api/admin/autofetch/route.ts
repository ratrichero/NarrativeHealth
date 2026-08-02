import { NextRequest, NextResponse } from "next/server";
import {
  checkBinanceSpotSymbol,
  checkBinanceFuturesSymbol,
  fetchBinanceSpotTicker,
  fetchBinanceFuturesTicker,
} from "@/lib/collectors/binance";
import { searchCoinGecko } from "@/lib/collectors/coingecko";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const symbol = searchParams.get("symbol");

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: "Symbol is required" },
        { status: 400 }
      );
    }

    const baseSymbol = symbol.toUpperCase().trim();
    const spotSymbol = `${baseSymbol}USDT`;
    const futuresSymbol = `${baseSymbol}USDT`;

    // Check Binance Spot
    let spotExists = false;
    let spotData = null;
    try {
      spotExists = await checkBinanceSpotSymbol(spotSymbol);
      if (spotExists) {
        spotData = await fetchBinanceSpotTicker(spotSymbol);
      }
    } catch (error) {
      console.error(`Error checking Binance Spot for ${spotSymbol}:`, error);
    }

    // Check Binance Futures
    let futuresExists = false;
    let futuresData = null;
    try {
      futuresExists = await checkBinanceFuturesSymbol(futuresSymbol);
      if (futuresExists) {
        futuresData = await fetchBinanceFuturesTicker(futuresSymbol);
      }
    } catch (error) {
      console.error(`Error checking Binance Futures for ${futuresSymbol}:`, error);
    }

    // Search CoinGecko
    let coingeckoResults: { id: string; symbol: string; name: string }[] = [];
    try {
      coingeckoResults = await searchCoinGecko(baseSymbol);
    } catch (error) {
      console.error(`Error searching CoinGecko for ${baseSymbol}:`, error);
    }

    // Try to find exact match in CoinGecko results
    let coingeckoMatch = coingeckoResults.find(
      (coin) => coin.symbol.toLowerCase() === baseSymbol.toLowerCase()
    );

    // If no exact match, use first result
    if (!coingeckoMatch && coingeckoResults.length > 0) {
      coingeckoMatch = coingeckoResults[0];
    }

    return NextResponse.json({
      success: true,
      data: {
        symbol: baseSymbol,
        name: spotData?.name || futuresData?.name || coingeckoMatch?.name || baseSymbol,
        binanceSpotSymbol: spotExists ? spotSymbol : null,
        binanceFuturesSymbol: futuresExists ? futuresSymbol : null,
        hasFutures: futuresExists,
        coingeckoId: coingeckoMatch?.id || null,
        coingeckoName: coingeckoMatch?.name || null,
        sources: {
          binanceSpot: spotExists,
          binanceFutures: futuresExists,
          coingecko: !!coingeckoMatch,
        },
        marketData: {
          spotPrice: spotData ? parseFloat(spotData.lastPrice) : null,
          futuresPrice: futuresData ? parseFloat(futuresData.lastPrice) : null,
          spotVolume: spotData ? parseFloat(spotData.quoteVolume) : null,
          futuresVolume: futuresData ? parseFloat(futuresData.quoteVolume) : null,
        },
      },
    });
  } catch (error) {
    console.error("Error auto-fetching coin data:", error);
    return NextResponse.json(
      { success: false, error: "Failed to auto-fetch coin data" },
      { status: 500 }
    );
  }
}
