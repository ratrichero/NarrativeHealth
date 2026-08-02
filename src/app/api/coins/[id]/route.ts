import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  coins,
  coinNarratives,
  narratives,
  healthScores,
  recommendations,
  features,
  marketPriceDaily,
  coinMetrics,
  sourceStatus,
  narrativeHealth,
} from "@/db/schema";
import { eq, and, desc, gte, or } from "drizzle-orm";
import { getHealthStatus, getBusinessDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

// GET - Get coin details
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

    const today = getBusinessDate();
    const thirtyDaysAgoDate = new Date();
    thirtyDaysAgoDate.setDate(thirtyDaysAgoDate.getDate() - 30);
    const thirtyDaysAgo = getBusinessDate(thirtyDaysAgoDate);

    // Get narratives for this coin
    const coinNarrativeData = await db
      .select({
        narrativeId: coinNarratives.narrativeId,
        isPrimary: coinNarratives.isPrimary,
        name: narratives.name,
      })
      .from(coinNarratives)
      .innerJoin(narratives, eq(narratives.id, coinNarratives.narrativeId))
      .where(eq(coinNarratives.coinId, coinId));

    // Get current health
    const [currentHealth] = await db
      .select()
      .from(healthScores)
      .where(and(eq(healthScores.coinId, coinId), eq(healthScores.date, today)))
      .limit(1);

    // Get current features
    const [currentFeature] = await db
      .select()
      .from(features)
      .where(and(eq(features.coinId, coinId), eq(features.date, today)))
      .orderBy(desc(features.createdAt))
      .limit(1);

    // Get recommendation
    const [currentRec] = await db
      .select()
      .from(recommendations)
      .where(and(eq(recommendations.coinId, coinId), eq(recommendations.date, today)))
      .limit(1);

    // Get health history
    const healthHistory = await db
      .select({
        date: healthScores.date,
        score: healthScores.healthScore,
      })
      .from(healthScores)
      .where(and(eq(healthScores.coinId, coinId), gte(healthScores.date, thirtyDaysAgo)))
      .orderBy(healthScores.date);

    // Get price history
    const priceHistory = await db
      .select({
        date: marketPriceDaily.date,
        open: marketPriceDaily.open,
        high: marketPriceDaily.high,
        low: marketPriceDaily.low,
        close: marketPriceDaily.close,
        volume: marketPriceDaily.volume,
      })
      .from(marketPriceDaily)
      .where(and(eq(marketPriceDaily.coinId, coinId), gte(marketPriceDaily.date, thirtyDaysAgo)))
      .orderBy(marketPriceDaily.date);

    // Get latest metrics per source, then merge them because coin_metrics is source-scoped.
    const [latestMetricDate] = await db
      .select({ date: coinMetrics.date })
      .from(coinMetrics)
      .where(eq(coinMetrics.coinId, coinId))
      .orderBy(desc(coinMetrics.date))
      .limit(1);

    const latestMetricsRows = latestMetricDate
      ? await db
          .select()
          .from(coinMetrics)
          .where(
            and(
              eq(coinMetrics.coinId, coinId),
              eq(coinMetrics.date, latestMetricDate.date)
            )
          )
      : [];

    const latestMetrics = latestMetricsRows.reduce(
      (merged, row) => ({
        openInterest: merged.openInterest ?? row.openInterest,
        fundingRate: merged.fundingRate ?? row.fundingRate,
        marketCap: merged.marketCap ?? row.marketCap,
        fullyDilutedValuation:
          merged.fullyDilutedValuation ?? row.fullyDilutedValuation,
        circulatingSupply: merged.circulatingSupply ?? row.circulatingSupply,
        totalSupply: merged.totalSupply ?? row.totalSupply,
      }),
      {
        openInterest: null as string | null,
        fundingRate: null as string | null,
        marketCap: null as string | null,
        fullyDilutedValuation: null as string | null,
        circulatingSupply: null as string | null,
        totalSupply: null as string | null,
      }
    );

    const hasLatestMetrics = latestMetricsRows.length > 0;

    return NextResponse.json({
      success: true,
      data: {
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        binanceSpotSymbol: coin.binanceSpotSymbol,
        binanceFuturesSymbol: coin.binanceFuturesSymbol,
        coingeckoId: coin.coingeckoId,
        hasFutures: coin.hasFutures,
        isActive: coin.isActive,
        narratives: coinNarrativeData.map((n) => ({
          id: n.narrativeId,
          name: n.name,
          isPrimary: n.isPrimary,
        })),
        currentHealth: currentHealth
          ? {
              healthScore: currentHealth.healthScore,
              previousScore: currentHealth.previousScore,
              scoreChange: currentHealth.scoreChange,
              status: currentHealth.status,
              confidenceScore: currentHealth.confidenceScore,
            }
          : null,
        features: currentFeature
          ? {
              trendScore: currentFeature.trendScore,
              derivativeScore: currentFeature.derivativeScore,
              volumeScore: currentFeature.volumeScore,
              momentumScore: currentFeature.momentumScore,
              trendDetail: currentFeature.trendDetail,
              derivativeDetail: currentFeature.derivativeDetail,
              volumeDetail: currentFeature.volumeDetail,
              momentumDetail: currentFeature.momentumDetail,
            }
          : null,
        recommendation: currentRec
          ? {
              signal: currentRec.signal,
              reason: currentRec.reason,
              reasonBreakdown: currentRec.reasonBreakdown,
            }
          : null,
        healthHistory: healthHistory.map((h) => ({
          date: h.date,
          score: h.score,
        })),
        priceHistory: priceHistory.map((p) => ({
          date: p.date,
          open: parseFloat(p.open),
          high: parseFloat(p.high),
          low: parseFloat(p.low),
          close: parseFloat(p.close),
          volume: parseFloat(p.volume),
        })),
        metrics: hasLatestMetrics
          ? {
              openInterest: latestMetrics.openInterest
                ? parseFloat(latestMetrics.openInterest)
                : null,
              fundingRate: latestMetrics.fundingRate
                ? parseFloat(latestMetrics.fundingRate)
                : null,
              marketCap: latestMetrics.marketCap
                ? parseFloat(latestMetrics.marketCap)
                : null,
              fullyDilutedValuation: latestMetrics.fullyDilutedValuation
                ? parseFloat(latestMetrics.fullyDilutedValuation)
                : null,
              circulatingSupply: latestMetrics.circulatingSupply
                ? parseFloat(latestMetrics.circulatingSupply)
                : null,
              totalSupply: latestMetrics.totalSupply
                ? parseFloat(latestMetrics.totalSupply)
                : null,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Error fetching coin:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch coin" },
      { status: 500 }
    );
  }
}

// PUT - Update coin
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const coinId = parseInt(id);
    const body = await request.json();

    if (isNaN(coinId)) {
      return NextResponse.json(
        { success: false, error: "Invalid coin ID" },
        { status: 400 }
      );
    }

    const {
      symbol,
      name,
      binanceSpotSymbol,
      binanceFuturesSymbol,
      coingeckoId,
      isActive,
      narrativeIds,
    } = body;

    const updateData: Partial<{
      symbol: string;
      name: string;
      binanceSpotSymbol: string | null;
      binanceFuturesSymbol: string | null;
      coingeckoId: string | null;
      hasFutures: boolean;
      isActive: boolean;
      updatedAt: Date;
    }> = { updatedAt: new Date() };

    if (symbol !== undefined) updateData.symbol = symbol.trim().toUpperCase();
    if (name !== undefined) updateData.name = name.trim();
    if (binanceSpotSymbol !== undefined)
      updateData.binanceSpotSymbol = binanceSpotSymbol || null;
    if (binanceFuturesSymbol !== undefined) {
      updateData.binanceFuturesSymbol = binanceFuturesSymbol || null;
      updateData.hasFutures = !!binanceFuturesSymbol;
    }
    if (coingeckoId !== undefined) updateData.coingeckoId = coingeckoId || null;
    if (isActive !== undefined) updateData.isActive = isActive;

    const [updated] = await db
      .update(coins)
      .set(updateData)
      .where(eq(coins.id, coinId))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Coin not found" },
        { status: 404 }
      );
    }

    // Update narrative associations if provided
    if (Array.isArray(narrativeIds)) {
      // Remove existing associations
      await db.delete(coinNarratives).where(eq(coinNarratives.coinId, coinId));

      // Add new associations
      if (narrativeIds.length > 0) {
        await db.insert(coinNarratives).values(
          narrativeIds.map((narrativeId: number, index: number) => ({
            coinId,
            narrativeId,
            isPrimary: index === 0,
          }))
        );
      }
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updating coin:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update coin" },
      { status: 500 }
    );
  }
}

// DELETE - Delete coin
export async function DELETE(
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

    // Delete dependent data first (foreign key constraints)
    // Delete coin narratives associations
    await db
      .delete(coinNarratives)
      .where(eq(coinNarratives.coinId, coinId));

    // Delete narrative health (top_coin_id and weakest_coin_id reference coins)
    await db
      .delete(narrativeHealth)
      .where(
        or(
          eq(narrativeHealth.topCoinId, coinId),
          eq(narrativeHealth.weakestCoinId, coinId)
        )
      );

    // Delete coin metrics
    await db
      .delete(coinMetrics)
      .where(eq(coinMetrics.coinId, coinId));

    // Delete coin metrics
    await db
      .delete(coinMetrics)
      .where(eq(coinMetrics.coinId, coinId));

    // Delete health scores
    await db
      .delete(healthScores)
      .where(eq(healthScores.coinId, coinId));

    // Delete recommendations
    await db
      .delete(recommendations)
      .where(eq(recommendations.coinId, coinId));

    // Delete features
    await db
      .delete(features)
      .where(eq(features.coinId, coinId));

    // Delete market price daily
    await db
      .delete(marketPriceDaily)
      .where(eq(marketPriceDaily.coinId, coinId));

    // Delete source status
    await db
      .delete(sourceStatus)
      .where(eq(sourceStatus.coinId, coinId));

    // Delete coin
    const [deleted] = await db
      .delete(coins)
      .where(eq(coins.id, coinId))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Coin not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error) {
    console.error("Error deleting coin:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete coin" },
      { status: 500 }
    );
  }
}
