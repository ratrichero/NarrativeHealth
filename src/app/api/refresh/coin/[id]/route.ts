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
  featureVersions,
  scoreConfigs,
  schedulerLogs,
} from "@/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import {
  fetchBinanceSpotKlines,
  fetchBinanceFuturesKlines,
  fetchBinanceFuturesMetrics,
  fetchBinanceOIHistory,
  fetchBinanceSpotTicker,
  fetchBinanceFuturesTicker,
} from "@/lib/collectors/binance";
import { fetchCoinGeckoMarkets } from "@/lib/collectors/coingecko";
import { runFeatureEngine, calculateHealthScore, getRecommendationSignal, generateRecommendationReason } from "@/lib/features/engine";
import { getHealthStatus, getBusinessDate, getYesterdayBusinessDate } from "@/lib/utils";
import { evaluateKlineObservationQuality } from "@/lib/p6/ingestion/kline-quality-hook";

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

// POST - Refresh single coin
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const coinId = parseInt(id);
  const startTime = Date.now();
  const now = new Date();
  const today = getBusinessDate();
  const yesterday = getYesterdayBusinessDate();

  // Check for refresh lock
  const jobName = `coin_refresh:${coinId}`;
  const lockCheck = await checkRefreshLock(jobName);
  
  if (lockCheck.isLocked) {
    return NextResponse.json(
      {
        success: false,
        error: "Refresh already in progress for this coin",
        details: lockCheck.lockInfo,
      },
      { status: 409 }
    );
  }

  let logEntry: any = null;

  try {
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

    // Create scheduler log entry
    [logEntry] = await db
      .insert(schedulerLogs)
      .values({
        jobName,
        status: "STARTED",
        startedAt: new Date(),
      })
      .returning();

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

    // Collect CoinGecko data for FDV only
    let coingeckoData = new Map<string, any>();
    if (coin.coingeckoId) {
      try {
        const data = await fetchCoinGeckoMarkets([coin.coingeckoId]);
        coingeckoData = data;
      } catch (error) {
        console.error("CoinGecko collection failed:", error);
      }
    }

    const recThresholds = {
      strong_watch: 90,
      watch: 80,
      observe: 65,
    };

    for (const config of configsData) {
      if (config.configKey === "health_weights" && typeof config.configValue === "object") {
        Object.assign(healthWeights, config.configValue);
      }
      if (config.configKey === "confidence_weights" && typeof config.configValue === "object") {
        Object.assign(confidenceWeights, config.configValue);
      }
      if (config.configKey === "recommendation_thresholds" && typeof config.configValue === "object") {
        Object.assign(recThresholds, config.configValue);
      }
    }

    let binanceSpotOk = false;
    let binanceFuturesOk = false;
    let coinCoingeckoOk = false;

    // Collect price data - prioritize Futures if available, otherwise use Spot
    let priceSource = "binance_spot";
    let klines: Awaited<ReturnType<typeof fetchBinanceSpotKlines>> = [];
    let volume24h: number | null = null;
    let marketCapFromCoingecko: number | null = null;

    // Get CoinGecko market cap first (most accurate)
    if (coin.coingeckoId && coingeckoData.has(coin.coingeckoId)) {
      const cgData = coingeckoData.get(coin.coingeckoId);
      if (cgData && cgData.marketCap) {
        marketCapFromCoingecko = cgData.marketCap;
        coinCoingeckoOk = true;
        console.log(`Got market cap from CoinGecko for ${coin.symbol}: $${marketCapFromCoingecko?.toLocaleString() || 'N/A'}`);
      }
    }

    if (coin.binanceFuturesSymbol) {
      try {
        klines = await fetchBinanceFuturesKlines(coin.binanceFuturesSymbol, 200);
        priceSource = "binance_futures";
        if (klines.length > 0) {
          binanceFuturesOk = true;
          console.log(`Successfully fetched ${klines.length} futures klines for ${coin.symbol}`);

          // Get 24h volume from futures ticker
          const futuresTicker = await fetchBinanceFuturesTicker(coin.binanceFuturesSymbol);
          if (futuresTicker) {
            volume24h = parseFloat(futuresTicker.quoteVolume);

            // Use CoinGecko market cap if available, otherwise calculate approximate from Binance
            const marketCapToSave = marketCapFromCoingecko || (volume24h * parseFloat(futuresTicker.lastPrice));

            // Save market cap - prioritize CoinGecko (accurate) over Binance (approximate)
            await db
              .insert(coinMetrics)
              .values({
                coinId: coin.id,
                date: today,
                marketCap: marketCapToSave?.toString() || null,
                source: "binance_futures",
              })
              .onConflictDoUpdate({
                target: [coinMetrics.coinId, coinMetrics.date, coinMetrics.source],
                set: {
                  marketCap: marketCapToSave?.toString() || null,
                },
              });
          }
        } else {
          console.warn(`No futures klines returned for ${coin.symbol} (${coin.binanceFuturesSymbol})`);
        }
      } catch (error) {
        console.error(`Binance futures klines collection failed for ${coin.symbol} (${coin.binanceFuturesSymbol}):`, error);
        // Fallback to spot if futures fails
        if (coin.binanceSpotSymbol) {
          try {
            klines = await fetchBinanceSpotKlines(coin.binanceSpotSymbol, 200);
            priceSource = "binance_spot";
            if (klines.length > 0) {
              binanceSpotOk = true;
              console.log(`Fallback: Successfully fetched ${klines.length} spot klines for ${coin.symbol}`);

              // Get 24h volume from spot ticker
              const spotTicker = await fetchBinanceSpotTicker(coin.binanceSpotSymbol);
              if (spotTicker) {
                volume24h = parseFloat(spotTicker.quoteVolume);

                // Use CoinGecko market cap if available, otherwise calculate approximate from Binance
                const marketCapToSave = marketCapFromCoingecko || (volume24h * parseFloat(spotTicker.lastPrice));

                // Save market cap - prioritize CoinGecko (accurate) over Binance (approximate)
                await db
                  .insert(coinMetrics)
                  .values({
                    coinId: coin.id,
                    date: today,
                    marketCap: marketCapToSave?.toString() || null,
                    source: "binance_spot",
                  })
                  .onConflictDoUpdate({
                    target: [coinMetrics.coinId, coinMetrics.date, coinMetrics.source],
                    set: {
                      marketCap: marketCapToSave?.toString() || null,
                    },
                  });
              }
            }
          } catch (spotError) {
            console.error(`Binance spot fallback failed for ${coin.symbol}:`, spotError);
          }
        }
      }
    } else if (coin.binanceSpotSymbol) {
      try {
        klines = await fetchBinanceSpotKlines(coin.binanceSpotSymbol, 200);
        priceSource = "binance_spot";
        if (klines.length > 0) {
          binanceSpotOk = true;
          console.log(`Successfully fetched ${klines.length} spot klines for ${coin.symbol}`);

          // Get 24h volume from spot ticker
          const spotTicker = await fetchBinanceSpotTicker(coin.binanceSpotSymbol);
          if (spotTicker) {
            volume24h = parseFloat(spotTicker.quoteVolume);

            // Calculate approximate market cap from price * quote volume
            const currentPrice = parseFloat(spotTicker.lastPrice);
            const approxMarketCap = volume24h * currentPrice;

            // Save market cap from Binance Spot (approximate)
            await db
              .insert(coinMetrics)
              .values({
                coinId: coin.id,
                date: today,
                marketCap: approxMarketCap?.toString() || null,
                source: "binance_spot",
              })
              .onConflictDoUpdate({
                target: [coinMetrics.coinId, coinMetrics.date, coinMetrics.source],
                set: {
                  marketCap: approxMarketCap?.toString() || null,
                },
              });
          }
        } else {
          console.warn(`No spot klines returned for ${coin.symbol} (${coin.binanceSpotSymbol})`);
        }
      } catch (error) {
        console.error(`Binance spot collection failed for ${coin.symbol} (${coin.binanceSpotSymbol}):`, error);
      }
    } else {
      console.warn(`No Binance symbol configured for ${coin.symbol}`);
    }

    // Save price data
    if (klines.length > 0) {
      for (const kline of klines) {
        // Convert UTC timestamp to business timezone date
        const klineDate = getBusinessDate(new Date(kline.openTime));

        // P6-01E-C: canonical observation → quality evaluation + persistence
        // BEFORE the existing observation DB write (PD-E1).
        // Classification never blocks ingestion (PD-E2); a persistence
        // failure here is an infrastructure error and propagates to the
        // existing per-coin error handler like any other DB failure.
        await evaluateKlineObservationQuality(kline, {
          entityId: coin.id,
          priceSource,
          timeframe: "DAILY",
        });

        await db
          .insert(marketPriceDaily)
          .values({
            coinId: coin.id,
            date: klineDate,
            open: kline.open,
            high: kline.high,
            low: kline.low,
            close: kline.close,
            volume: kline.volume,
            quoteVolume: kline.quoteVolume,
            source: priceSource,
            volume24h: klineDate === today ? volume24h?.toString() : null,
          })
          .onConflictDoUpdate({
            target: [marketPriceDaily.coinId, marketPriceDaily.date],
            set: {
              open: kline.open,
              high: kline.high,
              low: kline.low,
              close: kline.close,
              volume: kline.volume,
              quoteVolume: kline.quoteVolume,
              source: priceSource,
              volume24h: klineDate === today ? volume24h?.toString() : null,
            },
          });
      }
    }

    // Collect Binance Futures data (OI and Funding Rate)
    let oiCurrent: number | null = null;
    let oiPrev: number | null = null;
    let fundingRate: number | null = null;

    if (coin.binanceFuturesSymbol) {
      try {
        const futuresMetrics = await fetchBinanceFuturesMetrics(coin.binanceFuturesSymbol);
        oiCurrent = futuresMetrics.openInterest;
        fundingRate = futuresMetrics.fundingRate;

        // Get historical OI for comparison
        const oiHistory = await fetchBinanceOIHistory(coin.binanceFuturesSymbol, "1d", 2);
        if (oiHistory.length > 0) {
          oiPrev = oiHistory[oiHistory.length - 1].openInterest;
        }

        // Only save futures metrics if we have at least one value
        if (oiCurrent !== null || fundingRate !== null) {
          binanceFuturesOk = true;

          await db
            .insert(coinMetrics)
            .values({
              coinId: coin.id,
              date: today,
              openInterest: oiCurrent?.toString() || null,
              fundingRate: fundingRate?.toString() || null,
              source: "binance_futures",
            })
            .onConflictDoUpdate({
              target: [coinMetrics.coinId, coinMetrics.date, coinMetrics.source],
              set: {
                openInterest: oiCurrent?.toString() || null,
                fundingRate: fundingRate?.toString() || null,
              },
            });
        } else {
          console.warn(`No OI or funding data returned for ${coin.symbol} (${coin.binanceFuturesSymbol})`);
        }
      } catch (error) {
        console.error(`Binance futures collection failed for ${coin.symbol} (${coin.binanceFuturesSymbol}):`, error);
      }
    } else {
      console.log(`No Binance Futures symbol configured for ${coin.symbol}`);
    }

    // Get FDV from CoinGecko (only FDV, not Market Cap)
    if (coin.coingeckoId && coingeckoData.has(coin.coingeckoId)) {
      const cgData = coingeckoData.get(coin.coingeckoId)!;
      coinCoingeckoOk = true;

      await db
        .insert(coinMetrics)
        .values({
          coinId: coin.id,
          date: today,
          fullyDilutedValuation: cgData.fullyDilutedValuation?.toString() || null,
          source: "coingecko",
        })
        .onConflictDoUpdate({
          target: [coinMetrics.coinId, coinMetrics.date, coinMetrics.source],
          set: {
            fullyDilutedValuation: cgData.fullyDilutedValuation?.toString() || null,
          },
        });
    }

    // Get price data for feature calculation
    const priceResult = await db
      .select()
      .from(marketPriceDaily)
      .where(eq(marketPriceDaily.coinId, coin.id))
      .orderBy(marketPriceDaily.date);

    const prices = priceResult;

    if (prices.length >= 20) {
      const priceData = prices.map((p) => ({
        date: p.date,
        open: parseFloat(p.open),
        high: parseFloat(p.high),
        low: parseFloat(p.low),
        close: parseFloat(p.close),
        volume: parseFloat(p.volume),
      }));

      // Get today's metrics
      const metricsResult = await db
        .select()
        .from(coinMetrics)
        .where(
          and(
            eq(coinMetrics.coinId, coin.id),
            eq(coinMetrics.date, today)
          )
        );

      const metricsMap = new Map<string, any>();
      for (const m of metricsResult) {
        metricsMap.set(m.source, m);
      }

      const futuresMetrics = metricsMap.get("binance_futures");
      const spotMetrics = metricsMap.get("binance_spot");

      const openInterest = futuresMetrics?.openInterest ? parseFloat(futuresMetrics.openInterest) : null;
      const fundingRate = futuresMetrics?.fundingRate ? parseFloat(futuresMetrics.fundingRate) : null;
      // Use CoinGecko market cap if available, otherwise fallback to database values
      const marketCap = marketCapFromCoingecko || 
                        (futuresMetrics?.marketCap ? parseFloat(futuresMetrics.marketCap) :
                        spotMetrics?.marketCap ? parseFloat(spotMetrics.marketCap) : null);

      const featureResult = runFeatureEngine(priceData, {
        openInterest,
        openInterestPrev: oiPrev,
        fundingRate,
        marketCap,
      }, healthWeights, confidenceWeights, {
        binance_spot: binanceSpotOk,
        binance_futures: binanceFuturesOk,
        coingecko: coinCoingeckoOk,
      });

      await db
        .insert(features)
        .values({
          coinId: coin.id,
          date: today,
          versionId: featureVersion.id,
          trendScore: featureResult.trend_score,
          derivativeScore: featureResult.derivative_score,
          volumeScore: featureResult.volume_score,
          momentumScore: featureResult.momentum_score,
          trendDetail: featureResult.trend_detail,
          derivativeDetail: featureResult.derivative_detail,
          volumeDetail: featureResult.volume_detail,
          momentumDetail: featureResult.momentum_detail,
          confidenceScore: featureResult.confidence_score,
          dataCompleteness: featureResult.data_completeness,
          missingSources: featureResult.missing_sources,
        })
        .onConflictDoUpdate({
          target: [features.coinId, features.date, features.versionId],
          set: {
            trendScore: featureResult.trend_score,
            derivativeScore: featureResult.derivative_score,
            volumeScore: featureResult.volume_score,
            momentumScore: featureResult.momentum_score,
            trendDetail: featureResult.trend_detail,
            derivativeDetail: featureResult.derivative_detail,
            volumeDetail: featureResult.volume_detail,
            momentumDetail: featureResult.momentum_detail,
            confidenceScore: featureResult.confidence_score,
            dataCompleteness: featureResult.data_completeness,
            missingSources: featureResult.missing_sources,
          },
        });

      const healthScore = calculateHealthScore(
        featureResult.trend_score,
        featureResult.derivative_score,
        featureResult.volume_score,
        featureResult.momentum_score,
        healthWeights
      );
      const healthStatus = getHealthStatus(healthScore);

      const prevHealthResult = await db
        .select()
        .from(healthScores)
        .where(and(eq(healthScores.coinId, coin.id), sql`${healthScores.date} < ${today}`))
        .orderBy(sql`${healthScores.date} DESC`)
        .limit(1);

      const prevHealthScore = prevHealthResult[0]?.healthScore || null;
      const scoreChange = prevHealthScore !== null ? healthScore - prevHealthScore : null;
      const weightBreakdown = {
        trend: featureResult.trend_score * healthWeights.trend,
        derivative: featureResult.derivative_score * healthWeights.derivative,
        volume: featureResult.volume_score * healthWeights.volume,
        momentum: featureResult.momentum_score * healthWeights.momentum,
      };

      await db
        .insert(healthScores)
        .values({
          coinId: coin.id,
          date: today,
          healthScore,
          previousScore: prevHealthScore,
          scoreChange,
          status: healthStatus,
          confidenceScore: featureResult.confidence_score,
          weightBreakdown,
        })
        .onConflictDoUpdate({
          target: [healthScores.coinId, healthScores.date],
          set: {
            healthScore,
            previousScore: prevHealthScore,
            scoreChange,
            status: healthStatus,
            confidenceScore: featureResult.confidence_score,
            weightBreakdown,
          },
        });

      const signal = getRecommendationSignal(healthScore, recThresholds);
      const reason = generateRecommendationReason(
        signal,
        featureResult.trend_score,
        featureResult.derivative_score,
        featureResult.volume_score,
        featureResult.momentum_score,
        featureResult.confidence_score
      );

      await db
        .insert(recommendations)
        .values({
          coinId: coin.id,
          date: today,
          signal,
          reason,
          reasonBreakdown: {
            trend: featureResult.trend_score,
            derivative: featureResult.derivative_score,
            volume: featureResult.volume_score,
            momentum: featureResult.momentum_score,
          },
        })
        .onConflictDoUpdate({
          target: [recommendations.coinId, recommendations.date],
          set: {
            signal,
            reason,
            reasonBreakdown: {
              trend: featureResult.trend_score,
              derivative: featureResult.derivative_score,
              volume: featureResult.volume_score,
              momentum: featureResult.momentum_score,
            },
          },
        });
    }

    // Update per-coin source status only (do not overwrite global status)
    await db.delete(sourceStatus).where(
      and(eq(sourceStatus.source, "binance_spot"), eq(sourceStatus.coinId, coin.id))
    );
    await db.insert(sourceStatus).values({
      source: "binance_spot",
      coinId: coin.id,
      status: binanceSpotOk ? "OK" : "FAILED",
      lastAttempt: new Date(),
      lastSuccess: binanceSpotOk ? new Date() : null,
      recordsCollected: binanceSpotOk ? 200 : 0,
    });

    await db.delete(sourceStatus).where(
      and(eq(sourceStatus.source, "binance_futures"), eq(sourceStatus.coinId, coin.id))
    );
    await db.insert(sourceStatus).values({
      source: "binance_futures",
      coinId: coin.id,
      status: binanceFuturesOk ? "OK" : "FAILED",
      lastAttempt: new Date(),
      lastSuccess: binanceFuturesOk ? new Date() : null,
      recordsCollected: binanceFuturesOk ? 1 : 0,
    });

    await db.delete(sourceStatus).where(
      and(eq(sourceStatus.source, "coingecko"), eq(sourceStatus.coinId, coin.id))
    );
    await db.insert(sourceStatus).values({
      source: "coingecko",
      coinId: coin.id,
      status: coinCoingeckoOk ? "OK" : "FAILED",
      lastAttempt: new Date(),
      lastSuccess: coinCoingeckoOk ? new Date() : null,
      recordsCollected: coinCoingeckoOk ? 1 : 0,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // P6 Intelligence Snapshot for this coin (PD-03B-09: synchronous)
    try {
      const [coinFeature] = await db
        .select({
          id: features.id,
          trendScore: features.trendScore,
          volumeScore: features.volumeScore,
          momentumScore: features.momentumScore,
          derivativeScore: features.derivativeScore,
          confidenceScore: features.confidenceScore,
          dataCompleteness: features.dataCompleteness,
          versionId: features.versionId,
        })
        .from(features)
        .where(and(eq(features.coinId, coin.id), eq(features.date, today)))
        .limit(1);

      if (coinFeature) {
        const { runSnapshotGeneration } = await import("@/lib/p6/snapshot/service");
        const { SNAPSHOT_V1_VERSION } = await import("@/lib/p6/snapshot/types");

        const scores = [coinFeature.trendScore, coinFeature.volumeScore, coinFeature.momentumScore, coinFeature.derivativeScore].filter(
          (s): s is number => s !== null
        );
        const healthScore = scores.length > 0
          ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
          : 50;

        await runSnapshotGeneration(
          new Date(),
          SNAPSHOT_V1_VERSION,
          [{
            entity_id: coin.id,
            health_score: healthScore,
            trend_score: coinFeature.trendScore,
            volume_score: coinFeature.volumeScore,
            momentum_score: coinFeature.momentumScore,
            derivative_score: coinFeature.derivativeScore,
            confidence_score: coinFeature.confidenceScore,
            data_completeness: coinFeature.dataCompleteness,
            feature_record_id: coinFeature.id,
            feature_version_id: coinFeature.versionId,
            feature_algorithm_version: SNAPSHOT_V1_VERSION.algorithm_version,
            feature_parameter_version: SNAPSHOT_V1_VERSION.parameter_version,
            feature_schema_version: SNAPSHOT_V1_VERSION.schema_version,
            feature_config_hash: SNAPSHOT_V1_VERSION.config_hash,
            quality_metadata: null,
            freshness_metadata: null,
            feature_provenance: null,
          }],
          [] // No narratives in single-coin refresh
        );
      }
    } catch (snapshotError) {
      // IS-24: persistence failure is infrastructure failure
      console.error(`P6 snapshot error for ${coin.symbol}:`, snapshotError);
    }

    // Update scheduler log
    await db
      .update(schedulerLogs)
      .set({
        status: "COMPLETED",
        completedAt: new Date(),
        duration: parseFloat(duration),
        recordsProcessed: 1,
      })
      .where(eq(schedulerLogs.id, logEntry.id));

    return NextResponse.json({
      success: true,
      data: {
        message: `Successfully refreshed ${coin.symbol}`,
        coinId: coin.id,
        symbol: coin.symbol,
        duration: `${duration}s`,
        sources: {
          binanceSpot: binanceSpotOk,
          binanceFutures: binanceFuturesOk,
        },
      },
    });
  } catch (error) {
    console.error(`Error refreshing coin ${coinId}:`, error);
    
    // Update scheduler log with error
    if (logEntry) {
      await db
        .update(schedulerLogs)
        .set({
          status: "FAILED",
          completedAt: new Date(),
          duration: parseFloat(((Date.now() - startTime) / 1000).toFixed(2)),
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        })
        .where(eq(schedulerLogs.id, logEntry.id));
    }
    
    return NextResponse.json(
      { success: false, error: "Failed to refresh coin" },
      { status: 500 }
    );
  }
}
