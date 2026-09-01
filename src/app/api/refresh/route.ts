import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  coins,
  marketPriceDaily,
  coinMetrics,
  sourceStatus,
  features,
  healthScores,
  recommendations,
  narrativeHealth,
  featureVersions,
  coinNarratives,
  narratives,
  schedulerLogs,
  scoreConfigs,
  morningSnapshots,
  indicators,
  recommendationRules,
  morningSnapshotHeaders,
  morningSnapshotCoins,
  morningSnapshotNarratives,
} from "@/db/schema";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import {
  fetchBinanceSpotKlines,
  fetchBinanceFuturesKlines,
  fetchBinanceFuturesMetrics,
  fetchBinanceOIHistory,
  fetchBinanceSpotTicker,
  fetchBinanceFuturesTicker,
  checkBinanceSpotSymbol,
  checkBinanceFuturesSymbol,
} from "@/lib/collectors/binance";
import { fetchCoinGeckoMarkets } from "@/lib/collectors/coingecko";

import { runFeatureEngine, calculateHealthScore, getRecommendationSignal, generateRecommendationReason } from "@/lib/features/engine";
import { getHealthStatus, getBusinessDate, getYesterdayBusinessDate } from "@/lib/utils";
import { resolveActiveP6Version } from "@/lib/p6/version-resolver";
import { ruleVersionService } from "@/lib/services/rule-version.service";
import { indicatorService } from "@/lib/services/indicator.service";
import { ruleEngineService } from "@/lib/services/rule-engine.service";
import { snapshotService } from "@/lib/services/snapshot.service";
import { evaluateKlineObservationQualityBatch } from "@/lib/p6/ingestion/kline-quality-batch-hook";
import { processSingleCoin } from "@/lib/p6/refresh/coin-processor";
import { pMap } from "@/lib/utils/p-map";
import { calculateWeightedNarrativeHealth, type CoinHealthData } from "@/lib/scoring/narrative-health";
import { KlineData } from "@/lib/technical-analysis/types";
import { runSnapshotGeneration, type NarrativeMembershipData } from "@/lib/p6/snapshot/service";
import { SNAPSHOT_V1_VERSION } from "@/lib/p6/snapshot/types";
import type { CoinSnapshotInput } from "@/lib/p6/snapshot/types";

// Business timezone constant (must match utils.ts)
const BUSINESS_TIMEZONE = "Asia/Ho_Chi_Minh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Refresh lock configuration
const REFRESH_LOCK_TIMEOUT = 15 * 60 * 1000; // 15 minutes in milliseconds

// Check if a refresh is already running
async function checkRefreshLock(jobName: string): Promise<{ isLocked: boolean; lockInfo?: any }> {
  const now = new Date();
  const staleTime = new Date(now.getTime() - REFRESH_LOCK_TIMEOUT);

  const [activeJob] = await db
    .select()
    .from(schedulerLogs)
    .where(and(
      eq(schedulerLogs.jobName, jobName),
      eq(schedulerLogs.status, "STARTED")
    ))
    .orderBy(desc(schedulerLogs.startedAt))
    .limit(1);

  if (!activeJob) {
    return { isLocked: false };
  }

  // Check if the job is stale
  if (activeJob.startedAt < staleTime) {
    // Mark stale job as FAILED
    await db
      .update(schedulerLogs)
      .set({
        status: "FAILED",
        completedAt: new Date(),
        duration: Math.round((now.getTime() - activeJob.startedAt.getTime()) / 1000),
        errorMessage: "Job timeout - marked as stale",
      })
      .where(eq(schedulerLogs.id, activeJob.id));

    return { isLocked: false };
  }

  return {
    isLocked: true,
    lockInfo: {
      jobName: activeJob.jobName,
      startedAt: activeJob.startedAt.toISOString(),
      jobId: activeJob.id,
    },
  };
}

// POST - Trigger data refresh
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const now = new Date();
  const today = getBusinessDate();
  const yesterday = getYesterdayBusinessDate();

  // Get job name from request body, default to manual_refresh
  const body = await request.json().catch(() => ({}));
  const jobName = body.jobName || "manual_refresh";
  
  // Check for refresh lock
  const lockCheck = await checkRefreshLock(jobName);
  
  if (lockCheck.isLocked) {
    return NextResponse.json(
      {
        success: false,
        error: "Refresh already in progress",
        details: lockCheck.lockInfo,
      },
      { status: 409 }
    );
  }

  // Create scheduler log entry
  const [logEntry] = await db
    .insert(schedulerLogs)
    .values({
      jobName,
      status: "STARTED",
      startedAt: new Date(),
    })
    .returning();

  try {
    // Get active rule version (P0B) - must be available before processing
    const activeVersion = await ruleVersionService.getActiveVersion();

    // Get all active coins
    const activeCoins = await db
      .select()
      .from(coins)
      .where(eq(coins.isActive, true));

    if (activeCoins.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          message: "No active coins to refresh",
          coinsProcessed: 0,
        },
      });
    }

    // Get or create feature version
    let [featureVersion] = await db
      .select()
      .from(featureVersions)
      .where(eq(featureVersions.isActive, true))
      .limit(1);

    if (!featureVersion) {
      [featureVersion] = await db
        .insert(featureVersions)
        .values({
          version: 1,
          description: "Initial version - pandas-equivalent calculations",
          isActive: true,
        })
        .returning();
    }

    // P6-VERSION-01: Resolve active P6 feature algorithm version
    const p6FeatureVersion = await resolveActiveP6Version();

    // Get score configs
    const configsData = await db
      .select()
      .from(scoreConfigs)
      .where(eq(scoreConfigs.isActive, true));

    const healthWeights = {
      trend: 0.35,
      derivative: 0.35,
      volume: 0.2,
      momentum: 0.1,
    };

    const confidenceWeights = {
      binance_spot: 0.4,
      binance_futures: 0.4,
      coingecko: 0.2,
    };

    for (const config of configsData) {
      if (config.configKey === "health_weights" && typeof config.configValue === "object") {
        Object.assign(healthWeights, config.configValue);
      }
      if (config.configKey === "confidence_weights" && typeof config.configValue === "object") {
        Object.assign(confidenceWeights, config.configValue);
      }
    }

    let coinsProcessed = 0;
    let errors: string[] = [];

    // Collect CoinGecko data for FDV only
    const coingeckoIds = activeCoins
      .filter((c) => c.coingeckoId)
      .map((c) => c.coingeckoId as string);

    let coingeckoData: Awaited<ReturnType<typeof fetchCoinGeckoMarkets>> = new Map();
    let coingeckoOk = false;

    if (coingeckoIds.length > 0) {
      try {
        coingeckoData = await fetchCoinGeckoMarkets(coingeckoIds);
        coingeckoOk = coingeckoData.size > 0;
      } catch (error) {
        console.error("CoinGecko collection failed:", error);
      }
    }

    // P6-PERF-03: Process all coins in parallel with bounded concurrency.
    // Each coin is fully independent — no cross-coin dependencies exist.
    // Concurrency limit of 6 keeps Binance API calls well within rate limits
    // (6 concurrent × 5 API calls = 30 requests, vs 1200/min limit).
    const coinStartTime = Date.now();
    const COIN_CONCURRENCY = 6;

    const coinResults = await pMap(
      activeCoins,
      async (coin) => {
        return processSingleCoin(coin, {
          today,
          yesterday,
          healthWeights,
          confidenceWeights,
          activeVersion,
          featureVersion,
          p6FeatureVersion,
          coingeckoData,
        });
      },
      { concurrency: COIN_CONCURRENCY },
    );

    // Aggregate coin processing results
    const coinProcessingDuration = Math.round((Date.now() - coinStartTime) / 1000);
    for (const result of coinResults) {
      if (result.success) {
        coinsProcessed++;
      } else {
        errors.push(`${result.symbol}: ${result.error || "Unknown error"}`);
      }
    }
    console.log(`[P6-PERF-03] Coin processing: ${coinsProcessed}/${activeCoins.length} succeeded in ${coinProcessingDuration}s (concurrency=${COIN_CONCURRENCY})`);

    // Calculate narrative health scores
    const activeNarratives = await db
      .select()
      .from(narratives)
      .where(eq(narratives.isActive, true));

    for (const narrative of activeNarratives) {
      try {
        const coinsInNarrative = await db
          .select({
            coinId: coinNarratives.coinId,
          })
          .from(coinNarratives)
          .innerJoin(coins, eq(coins.id, coinNarratives.coinId))
          .where(and(eq(coinNarratives.narrativeId, narrative.id), eq(coins.isActive, true)));

        if (coinsInNarrative.length === 0) continue;

        const coinIds = coinsInNarrative.map((c) => c.coinId);

        const coinHealthScores = await db
          .select({
            coinId: healthScores.coinId,
            healthScore: healthScores.healthScore,
            confidenceScore: healthScores.confidenceScore,
          })
          .from(healthScores)
          .where(
            and(
              eq(healthScores.date, today),
              sql`${healthScores.coinId} IN (${sql.join(
                coinIds.map((id) => sql`${id}`),
                sql`, `
              )})`
            )
          );

        if (coinHealthScores.length === 0) continue;

        // Fetch market cap for each coin from coin_metrics (latest available for today)
        const coinIdsForMcap = coinHealthScores.map((c) => c.coinId);
        const coinMetricsRows = await db
          .select({
            coinId: coinMetrics.coinId,
            marketCap: coinMetrics.marketCap,
          })
          .from(coinMetrics)
          .where(
            and(
              eq(coinMetrics.date, today),
              sql`${coinMetrics.coinId} IN (${sql.join(
                coinIdsForMcap.map((id) => sql`${id}`),
                sql`, `
              )})`
            )
          );

        // Build a map of coinId -> marketCap (take the first non-null market cap)
        const mcapMap = new Map<number, number | null>();
        for (const row of coinMetricsRows) {
          if (!mcapMap.has(row.coinId)) {
            mcapMap.set(row.coinId, row.marketCap ? parseFloat(row.marketCap) : null);
          }
        }

        // Build CoinHealthData[] for weighted calculation
        const coinScores: CoinHealthData[] = coinHealthScores.map((c) => ({
          coinId: c.coinId,
          symbol: activeCoins.find((ac) => ac.id === c.coinId)?.symbol ?? `coin_${c.coinId}`,
          healthScore: c.healthScore,
          confidenceScore: c.confidenceScore ?? 0,
          marketCap: mcapMap.get(c.coinId) ?? null,
        }));

        // Get previous narrative health
        const [prevNarrativeHealth] = await db
          .select()
          .from(narrativeHealth)
          .where(
            and(eq(narrativeHealth.narrativeId, narrative.id), eq(narrativeHealth.date, yesterday))
          )
          .limit(1);

        // Calculate weighted narrative health (P0A - replaces simple average)
        const narrativeHealthResult = calculateWeightedNarrativeHealth(
          narrative.id,
          today,
          coinScores,
          activeVersion.id,
          prevNarrativeHealth?.healthScore
        );

        await db
          .insert(narrativeHealth)
          .values({
            narrativeId: narrative.id,
            date: today,
            healthScore: narrativeHealthResult.healthScore,
            previousScore: prevNarrativeHealth?.healthScore || null,
            scoreChange: narrativeHealthResult.scoreChange,
            status: narrativeHealthResult.status,
            coinCount: coinHealthScores.length,
            topCoinId: narrativeHealthResult.topCoinId,
            weakestCoinId: narrativeHealthResult.weakestCoinId,
            avgConfidence: narrativeHealthResult.avgConfidence,
            coinBreakdown: coinHealthScores.map((c) => ({
              coinId: c.coinId,
              score: c.healthScore,
              weight: narrativeHealthResult.weightDetails[
                activeCoins.find((ac) => ac.id === c.coinId)?.symbol ?? `coin_${c.coinId}`
              ]?.weight ?? (1 / coinHealthScores.length),
            })),
            ruleVersionId: activeVersion.id,
            weightingMethod: narrativeHealthResult.weightingMethod,
            weightDetails: narrativeHealthResult.weightDetails,
          })
          .onConflictDoUpdate({
            target: [narrativeHealth.narrativeId, narrativeHealth.date],
            set: {
              healthScore: narrativeHealthResult.healthScore,
              previousScore: prevNarrativeHealth?.healthScore || null,
              scoreChange: narrativeHealthResult.scoreChange,
              status: narrativeHealthResult.status,
              coinCount: coinHealthScores.length,
              topCoinId: narrativeHealthResult.topCoinId,
              weakestCoinId: narrativeHealthResult.weakestCoinId,
              avgConfidence: narrativeHealthResult.avgConfidence,
              coinBreakdown: coinHealthScores.map((c) => ({
                coinId: c.coinId,
                score: c.healthScore,
                weight: narrativeHealthResult.weightDetails[
                  activeCoins.find((ac) => ac.id === c.coinId)?.symbol ?? `coin_${c.coinId}`
                ]?.weight ?? (1 / coinHealthScores.length),
              })),
              ruleVersionId: activeVersion.id,
              weightingMethod: narrativeHealthResult.weightingMethod,
              weightDetails: narrativeHealthResult.weightDetails,
            },
          });
      } catch (error) {
        console.error(`Error calculating narrative health for ${narrative.name}:`, error);
      }
    }

    // -----------------------------------------------------------------------
    // P5-11: Post-Refresh Decision Pipeline (additive — non-blocking)
    // -----------------------------------------------------------------------
    // After P3/P4 data is computed for all narratives, run the frozen P5
    // pipeline for each narrative. P5 consumes P4 → produces decision artifacts
    // persisted to p5_decision_records. Each narrative is independently error-
    // isolated; a failure in one narrative never prevents others from processing.
    try {
      const { P5RuntimeAdapter } = await import("@/lib/p5/integration");
      const { pgDecisionProducer } = await import("@/lib/p5/producer/production");
      const { getP4DecisionSupport } = await import("@/lib/p4/service");

      const p5Adapter = new P5RuntimeAdapter(pgDecisionProducer);
      let p5SuccessCount = 0;
      let p5FailCount = 0;
      let p5SkippedCount = 0;

      for (const narrative of activeNarratives) {
        try {
          // P4 is read-time derived from P3 — compute it now for P5
          const p4Snapshot = await getP4DecisionSupport(narrative.id);
          if (!p4Snapshot) {
            p5SkippedCount++;
            continue; // No P4 data available — P5 cannot evaluate
          }

          const result = await p5Adapter.evaluate(narrative.id, p4Snapshot);
          if (result.error) {
            p5FailCount++;
            console.error(`[P5] Decision pipeline failed for narrative ${narrative.id}: ${result.error.stage} — ${result.error.message}`);
          } else {
            p5SuccessCount++;
          }
        } catch (error) {
          p5FailCount++;
          console.error(`[P5] Unexpected error for narrative ${narrative.id}:`, error);
        }
      }

      console.log(`[P5] Post-refresh pipeline: success=${p5SuccessCount} failed=${p5FailCount} skipped=${p5SkippedCount}`);
    } catch (error) {
      // P5 pipeline failure must never break refresh
      console.error("[P5] Post-refresh pipeline initialization failed (non-blocking):", error);
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    // Update global source status (coinId IS NULL for dashboard display)
    // NOTE: Only global refresh updates global source status
    // Coin/narrative refresh do NOT overwrite global status to avoid confusion
    const globalBinanceSpotOk = activeCoins.some(c => c.binanceSpotSymbol);
    const globalBinanceFuturesOk = activeCoins.some(c => c.binanceFuturesSymbol);
    const globalCoingeckoOk = activeCoins.some(c => c.coingeckoId);

    await db.delete(sourceStatus).where(
      and(eq(sourceStatus.source, "binance_spot"), sql`${sourceStatus.coinId} IS NULL`)
    );
    await db.insert(sourceStatus).values({
      source: "binance_spot",
      coinId: null,
      status: globalBinanceSpotOk ? "OK" : "FAILED",
      lastAttempt: new Date(),
      lastSuccess: globalBinanceSpotOk ? new Date() : null,
      recordsCollected: coinsProcessed,
    });

    await db.delete(sourceStatus).where(
      and(eq(sourceStatus.source, "binance_futures"), sql`${sourceStatus.coinId} IS NULL`)
    );
    await db.insert(sourceStatus).values({
      source: "binance_futures",
      coinId: null,
      status: globalBinanceFuturesOk ? "OK" : "FAILED",
      lastAttempt: new Date(),
      lastSuccess: globalBinanceFuturesOk ? new Date() : null,
      recordsCollected: coinsProcessed,
    });

    await db.delete(sourceStatus).where(
      and(eq(sourceStatus.source, "coingecko"), sql`${sourceStatus.coinId} IS NULL`)
    );
    await db.insert(sourceStatus).values({
      source: "coingecko",
      coinId: null,
      status: globalCoingeckoOk ? "OK" : "FAILED",
      lastAttempt: new Date(),
      lastSuccess: globalCoingeckoOk ? new Date() : null,
      recordsCollected: coinsProcessed,
    });

    // Update scheduler log — include INDICATOR diagnostic summary for production visibility
    await db
      .update(schedulerLogs)
      .set({
        status: errors.length > 0 ? "COMPLETED" : "COMPLETED",
        completedAt: new Date(),
        duration,
        recordsProcessed: coinsProcessed,
        details: {
          errors,
          scope: "global",
          indicator: {
            businessDate: today,
            note: "Indicator tracking moved into per-coin processor (P6-PERF-03)",
          },
        },
      })
      .where(eq(schedulerLogs.id, logEntry.id));

    // Create normalized morning snapshot (P1C)
    try {
      const coinHealthRows = await db
        .select({
          coinId: healthScores.coinId,
          healthScore: healthScores.healthScore,
          scoreChange: healthScores.scoreChange,
          signal: recommendations.signal,
          confidence: healthScores.confidenceScore,
        })
        .from(healthScores)
        .leftJoin(recommendations, and(
          eq(recommendations.coinId, healthScores.coinId),
          eq(recommendations.date, healthScores.date)
        ))
        .where(eq(healthScores.date, today));

      const coinScores = coinHealthRows.map(r => ({
        coinId: r.coinId,
        healthScore: r.healthScore ?? null,
        scoreChange: r.scoreChange ?? null,
        signal: r.signal ?? null,
          confidence: r.confidence ?? null,
      }));

      const narrativeRows = await db
        .select({
          narrativeId: narrativeHealth.narrativeId,
          healthScore: narrativeHealth.healthScore,
          scoreChange: narrativeHealth.scoreChange,
          coinCount: narrativeHealth.coinCount,
          topCoinId: narrativeHealth.topCoinId,
          weakestCoinId: narrativeHealth.weakestCoinId,
          weightingMethod: narrativeHealth.weightingMethod,
        })
        .from(narrativeHealth)
        .where(eq(narrativeHealth.date, today));

      const narrativeScores = narrativeRows.map(r => ({
        narrativeId: r.narrativeId,
        healthScore: r.healthScore ?? null,
        scoreChange: r.scoreChange ?? null,
        coinCount: r.coinCount ?? null,
        topCoinId: r.topCoinId ?? null,
        weakestCoinId: r.weakestCoinId ?? null,
        weightingMethod: r.weightingMethod ?? null,
      }));

      await snapshotService.createDailySnapshot(today, coinScores, narrativeScores, activeVersion.id);

      console.log(`Morning snapshot created for ${today}`);
    } catch (snapshotError) {
      console.error("Error creating morning snapshot:", snapshotError);
      // Don't fail the refresh if snapshot creation fails
    }

    // P6 Intelligence Snapshot generation (PD-03B-09: synchronous)
    // IS-25: coin snapshots first, then narratives
    try {
      // Collect coin feature data from the features table
      const todayFeatures = await db
        .select({
          coinId: features.coinId,
          id: features.id,
          trendScore: features.trendScore,
          volumeScore: features.volumeScore,
          momentumScore: features.momentumScore,
          derivativeScore: features.derivativeScore,
          confidenceScore: features.confidenceScore,
          dataCompleteness: features.dataCompleteness,
          versionId: features.versionId,
          calculatedAt: features.calculatedAt,
        })
        .from(features)
        .where(eq(features.date, today));

      // Build CoinSnapshotInput[] from persisted feature records
      const coinSnapshotInputs: CoinSnapshotInput[] = todayFeatures.map((f) => ({
        entity_id: f.coinId,
        health_score: 0, // Will be computed from dimension scores below
        trend_score: f.trendScore,
        volume_score: f.volumeScore,
        momentum_score: f.momentumScore,
        derivative_score: f.derivativeScore,
        confidence_score: f.confidenceScore,
        data_completeness: f.dataCompleteness,
        feature_record_id: f.id,
        // feature_version_id references p6_feature_versions, not feature_versions
        // p6_feature_versions may be empty; pass null to avoid FK violation (23503)
        feature_version_id: null,
        feature_algorithm_version: SNAPSHOT_V1_VERSION.algorithm_version,
        feature_parameter_version: SNAPSHOT_V1_VERSION.parameter_version,
        feature_schema_version: SNAPSHOT_V1_VERSION.schema_version,
        feature_config_hash: SNAPSHOT_V1_VERSION.config_hash,
        quality_metadata: null,
        freshness_metadata: null,
        feature_provenance: null,
      }));

      // Compute health_score from dimension scores (PD-03B-10: pass-through)
      for (const input of coinSnapshotInputs) {
        const scores = [input.trend_score, input.volume_score, input.momentum_score, input.derivative_score].filter(
          (s): s is number => s !== null
        );
        input.health_score = scores.length > 0
          ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
          : 50; // SNAPSHOT_NEUTRAL_SCORE
      }

      // Build NarrativeMembershipData from live coin_narratives (PD-03B-14)
      const activeNarrativesForSnapshot = await db
        .select()
        .from(narratives)
        .where(eq(narratives.isActive, true));

      const narrativeMemberships: NarrativeMembershipData[] = [];
      for (const narrative of activeNarrativesForSnapshot) {
        const members = await db
          .select({ coinId: coinNarratives.coinId, symbol: coins.symbol })
          .from(coinNarratives)
          .innerJoin(coins, eq(coins.id, coinNarratives.coinId))
          .where(and(
            eq(coinNarratives.narrativeId, narrative.id),
            eq(coins.isActive, true)
          ));

        narrativeMemberships.push({
          entityId: narrative.id,
          narrativeName: narrative.name,
          members: members.map((m) => ({ coin_id: m.coinId, coin_symbol: m.symbol })),
        });
      }

      // IS-25: runSnapshotGeneration processes coins first, then narratives
      const snapshotResult = await runSnapshotGeneration(
        new Date(),
        SNAPSHOT_V1_VERSION,
        coinSnapshotInputs,
        narrativeMemberships
      );

      console.log(
        "P6 snapshot: coins=" + snapshotResult.coinSnapshotsPersisted + "/" + snapshotResult.coinSnapshotsGenerated +
        " narratives=" + snapshotResult.narrativeSnapshotsPersisted + "/" + snapshotResult.narrativeSnapshotsGenerated +
        (snapshotResult.coinSnapshotPersistenceFailed > 0 || snapshotResult.narrativeSnapshotPersistenceFailed > 0
          ? " (failures: coin=" + snapshotResult.coinSnapshotPersistenceFailed + " narrative=" + snapshotResult.narrativeSnapshotPersistenceFailed + ")"
          : "")
      );
    } catch (snapshotError) {
      // IS-24: persistence failure is infrastructure failure, never quality state
      // PD-E2: never block refresh on snapshot failure
      console.error("Error generating P6 snapshots:", snapshotError);
    }

    // P6-07: Wire P6-04 → P6-05 → P6-06 after P6-03 snapshot (PD-07A-01)
    // PD-E2: never block refresh on P6-04/05/06 failure
    try {
      const { runP6DownstreamPipeline } = await import("@/lib/p6/presentation/pipeline");
      const pipelineResult = await runP6DownstreamPipeline();
      console.log(`P6 downstream pipeline: regime=${pipelineResult.regimeCount} warnings=${pipelineResult.warningCount} summaries=${pipelineResult.summaryCount}`);
    } catch (pipelineError) {
      console.error("P6 downstream pipeline error (non-blocking):", pipelineError);
    }

    // Binance Square content pipeline (non-blocking side effect)
    // Fires after refresh completes; failures do NOT affect refresh status
    try {
      const { runSquarePipeline } = await import("@/lib/square/production");
      const squareResult = await runSquarePipeline();
      console.log(
        `Square pipeline: evaluated=${squareResult.evaluated} opportunities=${squareResult.opportunities} published=${squareResult.published} suppressed=${squareResult.suppressed}`
      );
      if (squareResult.errors.length > 0) {
        console.warn("Square pipeline errors:", squareResult.errors);
      }
    } catch (squareError) {
      // Square pipeline failure must not break the refresh
      console.error("Square pipeline error (non-blocking):", squareError);
    }

    return NextResponse.json({
      success: true,
      data: {
        message: `Refresh completed`,
        coinsProcessed,
        duration: `${duration}s`,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    console.error("Refresh error:", error);

    // Update scheduler log with error
    await db
      .update(schedulerLogs)
      .set({
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      })
      .where(eq(schedulerLogs.id, logEntry.id));

    return NextResponse.json(
      { success: false, error: "Failed to refresh data" },
      { status: 500 }
    );
  }
}
