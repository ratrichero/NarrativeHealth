/**
 * P6-DATA-06D — Pre-Refresh Diagnostic Endpoint
 *
 * Captures the complete pre-refresh state from the shared database.
 * This endpoint is READ-ONLY and performs no mutations.
 *
 * CRITICAL: This runs inside the Agent sandbox runtime.
 * Any results here are E1 (Agent Runtime) evidence, NOT E2 (Production).
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  coins,
  features,
  coinMetrics,
  healthScores,
  recommendations,
  scoreConfigs,
  featureVersions,
} from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { resolveActiveP6Version } from "@/lib/p6/version-resolver";

export const dynamic = "force-dynamic";

export async function GET() {
  const evidenceLevel = "E1_AGENT_RUNTIME";
  const runtimeIdentity = {
    environment: "Agent Sandbox (Freebuff/Daytona)",
    ip: "NOT Production (168.138.179.192)",
    binanceAccess: "BLOCKED (HTTP 451 from Agent sandbox)",
    databaseAccess: "SHARED with Production",
  };

  try {
    // ── 1. Active coins ──
    const activeCoins = await db
      .select()
      .from(coins)
      .where(eq(coins.isActive, true));

    const coinsWithFutures = activeCoins.filter((c) => c.binanceFuturesSymbol);
    const coinsSpotOnly = activeCoins.filter(
      (c) => c.binanceSpotSymbol && !c.binanceFuturesSymbol,
    );

    // ── 2. Active P6 version ──
    const p6Version = await resolveActiveP6Version();

    // ── 3. Active feature version ──
    const [featureVersion] = await db
      .select()
      .from(featureVersions)
      .where(eq(featureVersions.isActive, true))
      .limit(1);

    // ── 4. Health weights config ──
    const configsData = await db
      .select()
      .from(scoreConfigs)
      .where(eq(scoreConfigs.isActive, true));

    let healthWeights = {
      trend: 0.35,
      derivative: 0.35,
      volume: 0.2,
      momentum: 0.1,
    };
    for (const config of configsData) {
      if (
        config.configKey === "health_weights" &&
        typeof config.configValue === "object"
      ) {
        Object.assign(healthWeights, config.configValue);
      }
    }

    // ── 5. Latest features for all coins ──
    const latestFeatures = await db
      .select({
        coinId: features.coinId,
        date: features.date,
        trendScore: features.trendScore,
        volumeScore: features.volumeScore,
        momentumScore: features.momentumScore,
        derivativeScore: features.derivativeScore,
        derivativeDetail: features.derivativeDetail,
        confidenceScore: features.confidenceScore,
        p6VersionId: features.p6VersionId,
        calculatedAt: features.calculatedAt,
      })
      .from(features)
      .orderBy(desc(features.date), desc(features.id))
      .limit(activeCoins.length * 3); // Get enough to find latest per coin

    // Group by coinId and take latest
    const latestByCoin = new Map<number, (typeof latestFeatures)[0]>();
    for (const f of latestFeatures) {
      if (!latestByCoin.has(f.coinId)) {
        latestByCoin.set(f.coinId, f);
      }
    }

    // ── 6. Derivative distribution ──
    const derivativeScores: number[] = [];
    const derivativeDetails: string[] = [];
    let derivativeCount = 0;
    let derivative50Count = 0;

    for (const coin of activeCoins) {
      const f = latestByCoin.get(coin.id);
      if (f && f.derivativeScore !== null) {
        derivativeScores.push(f.derivativeScore);
        derivativeCount++;
        if (f.derivativeScore === 50) derivative50Count++;
        // Check if detail contains no_futures
        const detail = f.derivativeDetail as any;
        if (detail && detail.no_futures) {
          derivativeDetails.push(`${coin.symbol}: no_futures=true`);
        }
      }
    }

    const derivSorted = [...derivativeScores].sort((a, b) => a - b);
    const derivativeStats = {
      count: derivativeCount,
      min: derivSorted.length > 0 ? derivSorted[0] : null,
      max: derivSorted.length > 0 ? derivSorted[derivSorted.length - 1] : null,
      mean:
        derivativeScores.length > 0
          ? derivativeScores.reduce((a, b) => a + b, 0) /
            derivativeScores.length
          : null,
      stddev: (() => {
        if (derivativeScores.length < 2) return null;
        const mean =
          derivativeScores.reduce((a, b) => a + b, 0) /
          derivativeScores.length;
        const variance =
          derivativeScores.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
          (derivativeScores.length - 1);
        return Math.sqrt(variance);
      })(),
      unique: new Set(derivativeScores).size,
      score50Count: derivative50Count,
      score50Percent:
        derivativeCount > 0
          ? ((derivative50Count / derivativeCount) * 100).toFixed(1) + "%"
          : "N/A",
      noFuturesDetails: derivativeDetails.slice(0, 10),
    };

    // ── 7. Futures metrics state ──
    const latestDate =
      latestFeatures.length > 0 ? latestFeatures[0].date : "unknown";

    const futuresMetricsState = await db
      .select({
        coinId: coinMetrics.coinId,
        openInterest: coinMetrics.openInterest,
        fundingRate: coinMetrics.fundingRate,
        source: coinMetrics.source,
        date: coinMetrics.date,
      })
      .from(coinMetrics)
      .where(
        and(
          eq(coinMetrics.source, "binance_futures"),
          eq(coinMetrics.date, latestDate),
        ),
      );

    let oiNonNull = 0;
    let oiNull = 0;
    let fundingNonNull = 0;
    let fundingNull = 0;

    for (const m of futuresMetricsState) {
      if (m.openInterest !== null) oiNonNull++;
      else oiNull++;
      if (m.fundingRate !== null) fundingNonNull++;
      else fundingNull++;
    }

    // ── 8. Health distribution ──
    const latestHealth = await db
      .select({
        coinId: healthScores.coinId,
        healthScore: healthScores.healthScore,
        status: healthScores.status,
        confidenceScore: healthScores.confidenceScore,
      })
      .from(healthScores)
      .orderBy(desc(healthScores.date))
      .limit(activeCoins.length);

    const healthByCoin = new Map<number, (typeof latestHealth)[0]>();
    for (const h of latestHealth) {
      if (!healthByCoin.has(h.coinId)) {
        healthByCoin.set(h.coinId, h);
      }
    }

    const healthScores2: number[] = [];
    const healthStatusCounts: Record<string, number> = {};
    for (const h of healthByCoin.values()) {
      if (h.healthScore !== null) {
        healthScores2.push(h.healthScore);
        const s = h.status || "UNKNOWN";
        healthStatusCounts[s] = (healthStatusCounts[s] || 0) + 1;
      }
    }
    const healthSorted = [...healthScores2].sort((a, b) => a - b);

    const healthStats = {
      count: healthScores2.length,
      min: healthSorted[0] ?? null,
      max: healthSorted[healthSorted.length - 1] ?? null,
      mean:
        healthScores2.length > 0
          ? healthScores2.reduce((a, b) => a + b, 0) / healthScores2.length
          : null,
      stddev: (() => {
        if (healthScores2.length < 2) return null;
        const mean =
          healthScores2.reduce((a, b) => a + b, 0) / healthScores2.length;
        const variance =
          healthScores2.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
          (healthScores2.length - 1);
        return Math.sqrt(variance);
      })(),
      statusCounts: healthStatusCounts,
    };

    // ── 9. Recommendation distribution ──
    const latestRecs = await db
      .select({
        coinId: recommendations.coinId,
        signal: recommendations.signal,
      })
      .from(recommendations)
      .orderBy(desc(recommendations.date))
      .limit(activeCoins.length);

    const recByCoin = new Map<number, (typeof latestRecs)[0]>();
    for (const r of latestRecs) {
      if (!recByCoin.has(r.coinId)) {
        recByCoin.set(r.coinId, r);
      }
    }

    const recCounts: Record<string, number> = {};
    for (const r of recByCoin.values()) {
      const sig = r.signal || "UNKNOWN";
      recCounts[sig] = (recCounts[sig] || 0) + 1;
    }

    // ── 10. Representative coins ──
    const representativeCoins = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ONDOUSDT", "CARVUSDT"];
    const representativeData = activeCoins
      .filter((c) => representativeCoins.includes(c.binanceFuturesSymbol || ""))
      .map((c) => {
        const f = latestByCoin.get(c.id);
        const h = healthByCoin.get(c.id);
        return {
          symbol: c.symbol,
          binanceFuturesSymbol: c.binanceFuturesSymbol,
          derivativeScore: f?.derivativeScore ?? null,
          derivativeDetail: f?.derivativeDetail ?? null,
          healthScore: h?.healthScore ?? null,
        };
      });

    return NextResponse.json({
      success: true,
      evidenceLevel,
      runtimeIdentity,
      timestamp: new Date().toISOString(),
      latestFeatureDate: latestDate,
      p6Version,
      featureVersion: featureVersion
        ? { id: featureVersion.id, version: featureVersion.version }
        : null,
      healthWeights,
      coinUniverse: {
        total: activeCoins.length,
        withFuturesSymbol: coinsWithFutures.length,
        spotOnly: coinsSpotOnly.length,
      },
      derivativeDistribution: derivativeStats,
      futuresMetricsState: {
        date: latestDate,
        totalCoinsWithMetrics: futuresMetricsState.length,
        oiNonNull,
        oiNull,
        fundingNonNull,
        fundingNull,
      },
      healthDistribution: healthStats,
      recommendationDistribution: recCounts,
      representativeCoins,
      representativeData,
      diagnosticNote:
        "This endpoint reads from the SHARED database. Data may reflect Agent-sandbox contamination. Do NOT interpret as fresh Production state.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        evidenceLevel,
        runtimeIdentity,
      },
      { status: 500 },
    );
  }
}
