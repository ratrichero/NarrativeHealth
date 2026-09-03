/**
 * P6-DATA-06D — Post-Refresh Verification Endpoint
 *
 * Comprehensive verification of derivative pipeline state after
 * a Production-initiated refresh. Captures all evidence needed
 * for the D06D audit document.
 *
 * CRITICAL: This endpoint performs READ-ONLY queries.
 * It should be called AFTER a Production refresh, not before.
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
  schedulerLogs,
} from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { resolveActiveP6Version } from "@/lib/p6/version-resolver";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // ── 1. Runtime identity ──
    const runtimeIdentity = {
      note: "This endpoint can be called from ANY runtime (Agent sandbox or Production). Interpret results based on WHO called it.",
      callerMustIdentify: "If called from Production (168.138.179.192), results are E2 evidence. If called from Agent sandbox, results are E1.",
    };

    // ── 2. Active coins ──
    const activeCoins = await db
      .select()
      .from(coins)
      .where(eq(coins.isActive, true));

    // ── 3. Active P6 version ──
    const p6Version = await resolveActiveP6Version();

    // ── 4. Active feature version ──
    const [featureVersion] = await db
      .select()
      .from(featureVersions)
      .where(eq(featureVersions.isActive, true))
      .limit(1);

    // ── 5. Health weights config ──
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

    // ── 6. Latest features ──
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
      .limit(activeCoins.length * 3);

    const latestByCoin = new Map<number, (typeof latestFeatures)[0]>();
    for (const f of latestFeatures) {
      if (!latestByCoin.has(f.coinId)) {
        latestByCoin.set(f.coinId, f);
      }
    }

    const latestDate =
      latestFeatures.length > 0 ? latestFeatures[0].date : "unknown";

    // ── 7. Derivative distribution ──
    const derivativeScores: number[] = [];
    let derivativeCount = 0;
    let derivative50Count = 0;
    let noFuturesCount = 0;
    let availableCount = 0;
    const derivativeDetails: any[] = [];

    for (const coin of activeCoins) {
      const f = latestByCoin.get(coin.id);
      if (f && f.derivativeScore !== null) {
        derivativeScores.push(f.derivativeScore);
        derivativeCount++;
        if (f.derivativeScore === 50) derivative50Count++;

        const detail = f.derivativeDetail as any;
        if (detail) {
          if (detail.no_futures === true || detail.noFutures === true) {
            noFuturesCount++;
          } else {
            availableCount++;
          }
        }
      }
    }

    const derivSorted = [...derivativeScores].sort((a, b) => a - b);
    const derivativeStats = {
      count: derivativeCount,
      min: derivSorted[0] ?? null,
      max: derivSorted[derivSorted.length - 1] ?? null,
      mean:
        derivativeScores.length > 0
          ? derivativeScores.reduce((a, b) => a + b, 0) /
            derivativeScores.length
          : null,
      median:
        derivSorted.length > 0
          ? derivSorted.length % 2 === 0
            ? (derivSorted[derivSorted.length / 2 - 1] +
                derivSorted[derivSorted.length / 2]) /
              2
            : derivSorted[Math.floor(derivSorted.length / 2)]
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
      noFuturesCount,
      availableCount,
      degeneracyCheck: {
        isDegenerate: derivative50Count === derivativeCount && derivativeCount > 0,
        reason:
          derivative50Count === derivativeCount && derivativeCount > 0
            ? "ALL coins have derivative_score=50 (possible contamination or source unavailability)"
            : "Not degenerate — some coins have non-50 derivative scores",
      },
    };

    // ── 8. Futures metrics state ──
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

    // ── 9. Health distribution ──
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

    const healthScoresArr: number[] = [];
    const healthStatusCounts: Record<string, number> = {};
    for (const h of healthByCoin.values()) {
      if (h.healthScore !== null) {
        healthScoresArr.push(h.healthScore);
        const s = h.status || "UNKNOWN";
        healthStatusCounts[s] = (healthStatusCounts[s] || 0) + 1;
      }
    }
    const healthSorted = [...healthScoresArr].sort((a, b) => a - b);

    const healthStats = {
      count: healthScoresArr.length,
      min: healthSorted[0] ?? null,
      max: healthSorted[healthSorted.length - 1] ?? null,
      mean:
        healthScoresArr.length > 0
          ? healthScoresArr.reduce((a, b) => a + b, 0) /
            healthScoresArr.length
          : null,
      median:
        healthSorted.length > 0
          ? healthSorted.length % 2 === 0
            ? (healthSorted[healthSorted.length / 2 - 1] +
                healthSorted[healthSorted.length / 2]) /
              2
            : healthSorted[Math.floor(healthSorted.length / 2)]
          : null,
      stddev: (() => {
        if (healthScoresArr.length < 2) return null;
        const mean =
          healthScoresArr.reduce((a, b) => a + b, 0) /
          healthScoresArr.length;
        const variance =
          healthScoresArr.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
          (healthScoresArr.length - 1);
        return Math.sqrt(variance);
      })(),
      statusCounts: healthStatusCounts,
    };

    // ── 10. Recommendation distribution ──
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

    // ── 11. Representative coins ──
    const targetSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ONDOUSDT", "CARVUSDT"];
    const representativeData = activeCoins
      .filter((c) => targetSymbols.includes(c.binanceFuturesSymbol || ""))
      .map((c) => {
        const f = latestByCoin.get(c.id);
        const h = healthByCoin.get(c.id);
        const detail = f?.derivativeDetail as any;
        return {
          symbol: c.symbol,
          binanceFuturesSymbol: c.binanceFuturesSymbol,
          derivativeScore: f?.derivativeScore ?? null,
          derivativeDetail: detail
            ? {
                no_futures: detail.no_futures,
                oi_change: detail.oi_change,
                funding_signal: detail.funding_signal,
                score: detail.score,
              }
            : null,
          healthScore: h?.healthScore ?? null,
        };
      });

    // ── 12. Latest refresh log ──
    const [latestRefresh] = await db
      .select()
      .from(schedulerLogs)
      .orderBy(desc(schedulerLogs.startedAt))
      .limit(3);

    // ── 13. Feature timestamps ──
    const featureTimestamps = await db
      .select({
        date: features.date,
        calculatedAt: features.calculatedAt,
        p6VersionId: features.p6VersionId,
      })
      .from(features)
      .orderBy(desc(features.date))
      .limit(activeCoins.length);

    const uniqueDates = [...new Set(featureTimestamps.map((f) => f.date))].slice(
      0,
      5,
    );
    const latestCalculatedAt =
      featureTimestamps.length > 0
        ? featureTimestamps[0].calculatedAt?.toISOString()
        : null;

    // ── 14. Historical integrity check ──
    const historicalDates = await db
      .select({
        date: features.date,
        count: sql<number>`count(*)::int`,
      })
      .from(features)
      .groupBy(features.date)
      .orderBy(desc(features.date))
      .limit(10);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      runtimeIdentity,
      evidenceLevel: "MUST_BE_SET_BY_CALLER",
      latestFeatureDate: latestDate,
      p6Version,
      featureVersion: featureVersion
        ? { id: featureVersion.id, version: featureVersion.version }
        : null,
      healthWeights,
      coinUniverse: {
        total: activeCoins.length,
        withFuturesSymbol: activeCoins.filter((c) => c.binanceFuturesSymbol)
          .length,
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
      representativeData,
      latestRefreshLog: latestRefresh
        ? {
            jobName: latestRefresh.jobName,
            status: latestRefresh.status,
            startedAt: latestRefresh.startedAt?.toISOString(),
            completedAt: latestRefresh.completedAt?.toISOString(),
            duration: latestRefresh.duration,
            recordsProcessed: latestRefresh.recordsProcessed,
          }
        : null,
      featureTimestamps: {
        uniqueDates,
        latestCalculatedAt,
      },
      historicalDates: historicalDates.map((h) => ({
        date: h.date,
        featureCount: h.count,
      })),
      contaminationCheck: {
        description:
          "If derivative_score=50 for ALL 49 coins, the DB may still be contaminated by Agent-sandbox refresh. A Production refresh is required.",
        isContaminated:
          derivative50Count === derivativeCount && derivativeCount > 0,
        recommendation:
          derivative50Count === derivativeCount && derivativeCount > 0
            ? "RUN PRODUCTION REFRESH: POST http://168.138.179.192:3000/api/refresh"
            : "Derivative distribution is not globally degenerate — contamination may have been resolved",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
