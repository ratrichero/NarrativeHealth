import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  narratives,
  coins,
  coinNarratives,
  narrativeHealth,
  healthScores,
  recommendations,
  sourceStatus,
} from "@/db/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { getHealthStatus, getBusinessDate, getYesterdayBusinessDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

    // Fetch active narratives with their health scores
    const activeNarratives = await db
      .select({
        id: narratives.id,
        name: narratives.name,
        description: narratives.description,
      })
      .from(narratives)
      .where(eq(narratives.isActive, true));

    // Fetch narrative health data
    const narrativeHealthData = await db
      .select()
      .from(narrativeHealth)
      .where(
        and(
          gte(narrativeHealth.date, yesterday),
          sql`${narrativeHealth.narrativeId} IN (${sql.join(
            activeNarratives.map((n) => sql`${n.id}`),
            sql`, `
          )})`
        )
      )
      .orderBy(desc(narrativeHealth.date));

    // Get coin counts per narrative
    const coinCountsResult = await db
      .select({
        narrativeId: coinNarratives.narrativeId,
        count: sql<number>`count(*)::int`,
      })
      .from(coinNarratives)
      .innerJoin(coins, eq(coins.id, coinNarratives.coinId))
      .where(eq(coins.isActive, true))
      .groupBy(coinNarratives.narrativeId);

    const coinCountMap = new Map(coinCountsResult.map((c) => [c.narrativeId, c.count]));

    // Build narrative summaries
    const narrativeSummaries = await Promise.all(
      activeNarratives.map(async (narrative) => {
        const healthData = narrativeHealthData.find(
          (h) => h.narrativeId === narrative.id && h.date === today
        );
        const prevHealthData = narrativeHealthData.find(
          (h) => h.narrativeId === narrative.id && h.date === yesterday
        );

        // Get top coin for this narrative
        let topCoin = null;
        let weakestCoin = null;

        if (healthData?.topCoinId) {
          const topCoinData = await db
            .select({ id: coins.id, symbol: coins.symbol, name: coins.name })
            .from(coins)
            .where(eq(coins.id, healthData.topCoinId))
            .limit(1);

          if (topCoinData.length > 0) {
            const topCoinHealth = await db
              .select({ healthScore: healthScores.healthScore })
              .from(healthScores)
              .where(and(eq(healthScores.coinId, healthData.topCoinId), eq(healthScores.date, today)))
              .limit(1);

            topCoin = {
              id: topCoinData[0].id,
              symbol: topCoinData[0].symbol,
              name: topCoinData[0].name,
              healthScore: topCoinHealth[0]?.healthScore || 0,
            };
          }
        }

        if (healthData?.weakestCoinId) {
          const weakestCoinData = await db
            .select({ id: coins.id, symbol: coins.symbol, name: coins.name })
            .from(coins)
            .where(eq(coins.id, healthData.weakestCoinId))
            .limit(1);

          if (weakestCoinData.length > 0) {
            const weakestCoinHealth = await db
              .select({ healthScore: healthScores.healthScore })
              .from(healthScores)
              .where(
                and(eq(healthScores.coinId, healthData.weakestCoinId), eq(healthScores.date, today))
              )
              .limit(1);

            weakestCoin = {
              id: weakestCoinData[0].id,
              symbol: weakestCoinData[0].symbol,
              name: weakestCoinData[0].name,
              healthScore: weakestCoinHealth[0]?.healthScore || 0,
            };
          }
        }

        const score = healthData?.healthScore || 50;

        return {
          id: narrative.id,
          name: narrative.name,
          healthScore: score,
          previousScore: prevHealthData?.healthScore || null,
          scoreChange: healthData?.scoreChange || null,
          status: getHealthStatus(score),
          coinCount: coinCountMap.get(narrative.id) || 0,
          topCoin,
          weakestCoin,
          avgConfidence: healthData?.avgConfidence || null,
          signal: null,
        };
      })
    );

    // Sort by health score
    narrativeSummaries.sort((a, b) => b.healthScore - a.healthScore);

    // Get top movers (biggest positive changes)
    const topMoversData = await db
      .select({
        coinId: healthScores.coinId,
        healthScore: healthScores.healthScore,
        scoreChange: healthScores.scoreChange,
        symbol: coins.symbol,
        name: coins.name,
      })
      .from(healthScores)
      .innerJoin(coins, eq(coins.id, healthScores.coinId))
      .where(and(eq(healthScores.date, today), eq(coins.isActive, true)))
      .orderBy(desc(healthScores.scoreChange))
      .limit(5);

    // Get weakest coins (biggest negative changes or lowest scores)
    const weakestCoinsData = await db
      .select({
        coinId: healthScores.coinId,
        healthScore: healthScores.healthScore,
        scoreChange: healthScores.scoreChange,
        symbol: coins.symbol,
        name: coins.name,
      })
      .from(healthScores)
      .innerJoin(coins, eq(coins.id, healthScores.coinId))
      .where(and(eq(healthScores.date, today), eq(coins.isActive, true)))
      .orderBy(healthScores.healthScore)
      .limit(5);

    // Get source status
    const sourceStatusData = await db
      .select()
      .from(sourceStatus)
      .where(sql`${sourceStatus.coinId} IS NULL`)
      .orderBy(desc(sourceStatus.lastAttempt));

    const sourceStatusMap: Record<
      string,
      { status: string; lastSuccess: string | null; recordsCollected: number }
    > = {
      binance_spot: { status: "OK", lastSuccess: null, recordsCollected: 0 },
      binance_futures: { status: "OK", lastSuccess: null, recordsCollected: 0 },
      coingecko: { status: "OK", lastSuccess: null, recordsCollected: 0 },
    };

    for (const status of sourceStatusData) {
      if (status.source in sourceStatusMap) {
        sourceStatusMap[status.source] = {
          status: status.status,
          lastSuccess: status.lastSuccess?.toISOString() || null,
          recordsCollected: status.recordsCollected || 0,
        };
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        date: today,
        narratives: narrativeSummaries,
        sourceStatus: {
          binanceSpot: sourceStatusMap.binance_spot,
          binanceFutures: sourceStatusMap.binance_futures,
          coingecko: sourceStatusMap.coingecko,
          lastUpdate: new Date().toISOString(),
        },
        topMovers: topMoversData.map((c) => ({
          id: c.coinId,
          symbol: c.symbol,
          name: c.name,
          healthScore: c.healthScore,
          scoreChange: c.scoreChange || 0,
          narrativeId: null,
          narrativeName: null,
        })),
        weakestCoins: weakestCoinsData.map((c) => ({
          id: c.coinId,
          symbol: c.symbol,
          name: c.name,
          healthScore: c.healthScore,
          scoreChange: c.scoreChange || 0,
          narrativeId: null,
          narrativeName: null,
        })),
        alertCount: 0,
        lastUpdate: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch dashboard data" },
      { status: 500 }
    );
  }
}
