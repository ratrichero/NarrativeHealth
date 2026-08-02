import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { coins, coinMetrics, marketPriceDaily } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const symbol = searchParams.get("symbol");

    if (!symbol) {
      return NextResponse.json({ success: false, error: "Symbol is required" });
    }

    // Get coin config
    const [coin] = await db
      .select()
      .from(coins)
      .where(eq(coins.symbol, symbol.toUpperCase()))
      .limit(1);

    if (!coin) {
      return NextResponse.json({ success: false, error: "Coin not found" });
    }

    // Get latest metrics
    const metrics = await db
      .select()
      .from(coinMetrics)
      .where(eq(coinMetrics.coinId, coin.id))
      .orderBy(desc(coinMetrics.date))
      .limit(10);

    // Get latest price data
    const prices = await db
      .select()
      .from(marketPriceDaily)
      .where(eq(marketPriceDaily.coinId, coin.id))
      .orderBy(desc(marketPriceDaily.date))
      .limit(5);

    return NextResponse.json({
      success: true,
      data: {
        coin,
        metrics,
        prices,
      },
    });
  } catch (error) {
    console.error("Error debugging coin:", error);
    return NextResponse.json(
      { success: false, error: "Failed to debug coin" },
      { status: 500 }
    );
  }
}
