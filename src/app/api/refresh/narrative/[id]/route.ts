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

// POST - Refresh all coins for a specific narrative
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const narrativeId = parseInt(id);
  const startTime = Date.now();
  const now = new Date();
  const today = getBusinessDate();
  const yesterday = getYesterdayBusinessDate();

  // Check for refresh lock
  const jobName = `narrative_refresh:${narrativeId}`;
  const lockCheck = await checkRefreshLock(jobName);
  
  if (lockCheck.isLocked) {
    return NextResponse.json(
      {
        success: false,
        error: "Refresh already in progress for this narrative",
        details: lockCheck.lockInfo,
      },
      { status: 409 }
    );
  }

  let logEntry: any = null;

  try {
    // Get all coins for this narrative
    const narrativeCoins = await db
      .select({
        id: coins.id,
        symbol: coins.symbol,
        name: coins.name,
        binanceSpotSymbol: coins.binanceSpotSymbol,
        binanceFuturesSymbol: coins.binanceFuturesSymbol,
        coingeckoId: coins.coingeckoId,
        isActive: coins.isActive,
      })
      .from(coinNarratives)
      .innerJoin(coins, eq(coins.id, coinNarratives.coinId))
      .where(and(eq(coinNarratives.narrativeId, narrativeId), eq(coins.isActive, true)));

    if (narrativeCoins.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          message: "No active coins found for this narrative",
          coinsProcessed: 0,
        },
      });
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

    let coinsProcessed = 0;
    let errors: string[] = [];

    // Collect CoinGecko data for FDV only
    const coingeckoIds = narrativeCoins
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

    // Process each coin
    for (const coin of narrativeCoins) {
      try {
        let binanceSpotOk = false;
        let binanceFuturesOk = false;
        let coinCoingeckoOk = false;

        // Collect price data - prioritize Futures if available, otherwise use Spot
        let priceSource = "binance_spot";
        let klines: Awaited<ReturnType<typeof fetchBinanceSpotKlines>> = [];
        let volume24h: number | null = null;

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

                // Calculate approximate market cap from price * quote volume
                const currentPrice = parseFloat(futuresTicker.lastPrice);
                const approxMarketCap = volume24h * currentPrice;

                // Save market cap from Binance (approximate)
                await db
                  .insert(coinMetrics)
                  .values({
                    coinId: coin.id,
                    date: today,
                    marketCap: approxMarketCap?.toString() || null,
                    source: "binance_futures",
                  })
                  .onConflictDoUpdate({
                    target: [coinMetrics.coinId, coinMetrics.date, coinMetrics.source],
                    set: {
                      marketCap: approxMarketCap?.toString() || null,
                    },
                  });
              }
            } else {
              console.warn(`No futures klines returned for ${coin.symbol} (${coin.binanceFuturesSymbol})`);
            }
          } catch (error) {
            console.error(`Binance futures klines collection failed for ${coin.symbol}:`, error);
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
            }
          } catch (error) {
            console.error(`Binance spot klines collection failed for ${coin.symbol}:`, error);
          }
        }

        // Check CoinGecko
        if (coin.coingeckoId && coingeckoData.has(coin.coingeckoId)) {
          const cgData = coingeckoData.get(coin.coingeckoId);
          if (cgData) {
            coinCoingeckoOk = true;

            // Save FDV from CoinGecko
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
        }

        // Update source status for this coin
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
          recordsCollected: binanceFuturesOk ? 200 : 0,
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

        // Save price data
        if (klines.length > 0) {
          for (const kline of klines) {
            // Convert UTC timestamp to business timezone date
            const klineDate = getBusinessDate(new Date(kline.openTime));

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
                },
              });
          }

          // Collect futures metrics if available
          let oiCurrent: number | null = null;
          let oiPrev: number | null = null;
          let fundingRate: number | null = null;

          if (binanceFuturesOk && coin.binanceFuturesSymbol) {
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
              }
            } catch (metricsError) {
              console.error(`Failed to collect futures metrics for ${coin.symbol}:`, metricsError);
            }
          }

          // Calculate features
          const priceData = await db
            .select({
              date: marketPriceDaily.date,
              open: marketPriceDaily.open,
              high: marketPriceDaily.high,
              low: marketPriceDaily.low,
              close: marketPriceDaily.close,
              volume: marketPriceDaily.volume,
            })
            .from(marketPriceDaily)
            .where(eq(marketPriceDaily.coinId, coin.id))
            .orderBy(marketPriceDaily.date);

          if (priceData.length >= 20) {
            const priceDataFormatted = priceData.map((p) => ({
              date: p.date,
              open: parseFloat(p.open),
              high: parseFloat(p.high),
              low: parseFloat(p.low),
              close: parseFloat(p.close),
              volume: parseFloat(p.volume),
            }));

            const featureResult = runFeatureEngine(
              priceDataFormatted,
              {
                openInterest: oiCurrent,
                openInterestPrev: oiPrev,
                fundingRate,
                marketCap: null,
              },
              healthWeights,
              confidenceWeights,
              {
                binance_spot: binanceSpotOk,
                binance_futures: binanceFuturesOk,
                coingecko: coinCoingeckoOk,
              }
            );

            // Save features
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

            // Calculate health score
            const healthScoreValue = calculateHealthScore(
              featureResult.trend_score,
              featureResult.derivative_score,
              featureResult.volume_score,
              featureResult.momentum_score,
              healthWeights
            );

            // Get previous health score
            const [prevHealth] = await db
              .select()
              .from(healthScores)
              .where(and(eq(healthScores.coinId, coin.id), eq(healthScores.date, yesterday)))
              .limit(1);

            const scoreChange = prevHealth ? healthScoreValue - prevHealth.healthScore : null;

            const healthStatus = getHealthStatus(healthScoreValue);

            // Save health score
            await db
              .insert(healthScores)
              .values({
                coinId: coin.id,
                date: today,
                healthScore: healthScoreValue,
                previousScore: prevHealth?.healthScore || null,
                scoreChange: scoreChange,
                status: healthStatus,
                confidenceScore: featureResult.confidence_score,
              })
              .onConflictDoUpdate({
                target: [healthScores.coinId, healthScores.date],
                set: {
                  healthScore: healthScoreValue,
                  previousScore: prevHealth?.healthScore || null,
                  scoreChange: scoreChange,
                  status: healthStatus,
                  confidenceScore: featureResult.confidence_score,
                },
              });

            // Get recommendation signal
            const signal = getRecommendationSignal(healthScoreValue, recThresholds);
            const reason = generateRecommendationReason(
              signal,
              featureResult.trend_score,
              featureResult.derivative_score,
              featureResult.volume_score,
              featureResult.momentum_score,
              featureResult.confidence_score
            );

            // Save recommendation
            await db
              .insert(recommendations)
              .values({
                coinId: coin.id,
                date: today,
                signal,
                reason,
              })
              .onConflictDoUpdate({
                target: [recommendations.coinId, recommendations.date],
                set: {
                  signal,
                  reason,
                },
              });

            coinsProcessed++;
          }
        }
      } catch (coinError) {
        console.error(`Error processing coin ${coin.symbol}:`, coinError);
        errors.push(`${coin.symbol}: ${coinError instanceof Error ? coinError.message : 'Unknown error'}`);
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    // Update scheduler log with details
    await db
      .update(schedulerLogs)
      .set({
        status: errors.length > 0 ? "COMPLETED" : "COMPLETED",
        completedAt: new Date(),
        duration,
        recordsProcessed: coinsProcessed,
        details: errors.length > 0 ? { errors, scope: "narrative" } : { scope: "narrative" },
      })
      .where(eq(schedulerLogs.id, logEntry.id));

    return NextResponse.json({
      success: true,
      data: {
        message: `Successfully refreshed ${coinsProcessed} coins for narrative`,
        coinsProcessed,
        totalCoins: narrativeCoins.length,
        duration,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    console.error("Error refreshing narrative coins:", error);
    
    // Update scheduler log with error
    if (logEntry) {
      await db
        .update(schedulerLogs)
        .set({
          status: "FAILED",
          completedAt: new Date(),
          duration: Math.round((Date.now() - startTime) / 1000),
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        })
        .where(eq(schedulerLogs.id, logEntry.id));
    }
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to refresh narrative coins",
      },
      { status: 500 }
    );
  }
}
