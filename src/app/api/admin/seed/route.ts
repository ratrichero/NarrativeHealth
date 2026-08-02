import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  narratives,
  coins,
  coinNarratives,
  scoreConfigs,
  featureVersions,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

// POST - Seed initial data
export async function POST() {
  try {
    // Check if data already exists
    const existingNarratives = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(narratives);

    if (existingNarratives[0].count > 0) {
      return NextResponse.json({
        success: true,
        data: { message: "Data already seeded", skipped: true },
      });
    }

    // Seed narratives
    const [aiNarrative] = await db
      .insert(narratives)
      .values({
        name: "AI",
        description: "AI ecosystem, data layer, compute networks",
        isActive: true,
      })
      .returning();

    const [rwaNarrative] = await db
      .insert(narratives)
      .values({
        name: "RWA",
        description: "Real World Assets on-chain tokenization",
        isActive: true,
      })
      .returning();

    // Seed coins - AI Narrative
    const aiCoins = [
      {
        symbol: "CARV",
        name: "CARV",
        binanceSpotSymbol: "CARVUSDT",
        binanceFuturesSymbol: "CARVUSDT",
        coingeckoId: "carv",
        hasFutures: true,
      },
      {
        symbol: "VANA",
        name: "Vana",
        binanceSpotSymbol: "VANAUSDT",
        binanceFuturesSymbol: "VANAUSDT",
        coingeckoId: "vana",
        hasFutures: true,
      },
      {
        symbol: "GRASS",
        name: "Grass",
        binanceSpotSymbol: "GRASSUSDT",
        binanceFuturesSymbol: "GRASSUSDT",
        coingeckoId: "grass",
        hasFutures: true,
      },
      {
        symbol: "FET",
        name: "Fetch.ai",
        binanceSpotSymbol: "FETUSDT",
        binanceFuturesSymbol: "FETUSDT",
        coingeckoId: "fetch-ai",
        hasFutures: true,
      },
      {
        symbol: "RENDER",
        name: "Render",
        binanceSpotSymbol: "RENDERUSDT",
        binanceFuturesSymbol: "RENDERUSDT",
        coingeckoId: "render-token",
        hasFutures: true,
      },
    ];

    // Seed coins - RWA Narrative
    const rwaCoins = [
      {
        symbol: "ONDO",
        name: "Ondo Finance",
        binanceSpotSymbol: "ONDOUSDT",
        binanceFuturesSymbol: "ONDOUSDT",
        coingeckoId: "ondo-finance",
        hasFutures: true,
      },
      {
        symbol: "OM",
        name: "MANTRA",
        binanceSpotSymbol: "OMUSDT",
        binanceFuturesSymbol: "OMUSDT",
        coingeckoId: "mantra-dao",
        hasFutures: true,
      },
      {
        symbol: "POLYX",
        name: "Polymesh",
        binanceSpotSymbol: "POLYXUSDT",
        binanceFuturesSymbol: null,
        coingeckoId: "polymesh",
        hasFutures: false,
      },
    ];

    // Insert AI coins
    for (const coinData of aiCoins) {
      const [coin] = await db
        .insert(coins)
        .values(coinData)
        .returning();

      await db.insert(coinNarratives).values({
        coinId: coin.id,
        narrativeId: aiNarrative.id,
        isPrimary: true,
      });
    }

    // Insert RWA coins
    for (const coinData of rwaCoins) {
      const [coin] = await db
        .insert(coins)
        .values(coinData)
        .returning();

      await db.insert(coinNarratives).values({
        coinId: coin.id,
        narrativeId: rwaNarrative.id,
        isPrimary: true,
      });
    }

    // Seed feature version
    await db.insert(featureVersions).values({
      version: 1,
      description: "Initial version - pandas-equivalent EMA, ROC, ATR calculations",
      algorithm: {
        trend: "EMA20/50/200 crossover analysis",
        derivative: "OI change + Funding rate scoring",
        volume: "Volume vs MA20 ratio",
        momentum: "ROC14 + ATR14 combined",
      },
      isActive: true,
    });

    // Seed score configs
    const defaultConfigs = [
      {
        configType: "health_weights",
        configKey: "default",
        configValue: {
          trend: 0.35,
          derivative: 0.35,
          volume: 0.2,
          momentum: 0.1,
        },
        description: "Default health score weights",
      },
      {
        configType: "recommendation_thresholds",
        configKey: "default",
        configValue: {
          strong_watch: 90,
          watch: 80,
          observe: 65,
          weak: 0,
        },
        description: "Default recommendation thresholds",
      },
      {
        configType: "confidence_weights",
        configKey: "default",
        configValue: {
          binance_spot: 0.3,
          binance_futures: 0.4,
          coingecko: 0.3,
        },
        description: "Default confidence score weights per data source",
      },
      {
        configType: "narrative_health",
        configKey: "method",
        configValue: {
          method: "weighted_average",
          min_coins_required: 2,
        },
        description: "Narrative health calculation method",
      },
    ];

    for (const config of defaultConfigs) {
      await db.insert(scoreConfigs).values({
        ...config,
        version: 1,
        isActive: true,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        message: "Initial data seeded successfully",
        narratives: 2,
        coins: aiCoins.length + rwaCoins.length,
        configs: defaultConfigs.length,
      },
    });
  } catch (error) {
    console.error("Error seeding data:", error);
    return NextResponse.json(
      { success: false, error: "Failed to seed data" },
      { status: 500 }
    );
  }
}
