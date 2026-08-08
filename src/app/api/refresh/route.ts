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
import { ruleVersionService } from "@/lib/services/rule-version.service";
import { indicatorService } from "@/lib/services/indicator.service";
import { ruleEngineService } from "@/lib/services/rule-engine.service";
import { snapshotService } from "@/lib/services/snapshot.service";
import { calculateWeightedNarrativeHealth, type CoinHealthData } from "@/lib/scoring/narrative-health";
import { KlineData } from "@/lib/technical-analysis/types";

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

  // Check for refresh lock
  const jobName = "manual_refresh";
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

    // Process each coin
    for (const coin of activeCoins) {
      try {
        let binanceSpotOk = false;
        let binanceFuturesOk = false;
        let coinCoingeckoOk = false;

        // Collect price data - prioritize Futures if available, otherwise use Spot
        let priceSource = "binance_spot";
        let klines: Awaited<ReturnType<typeof fetchBinanceSpotKlines>> = [];
        let klines4h: Awaited<ReturnType<typeof fetchBinanceSpotKlines>> = [];
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

              try {
                klines4h = await fetchBinanceFuturesKlines(coin.binanceFuturesSymbol, 100, "4h");
              } catch (e) {
                console.warn(`Failed to fetch 4h futures klines for ${coin.symbol}`);
              }

              // Get 24h volume from futures ticker
              const futuresTicker = await fetchBinanceFuturesTicker(coin.binanceFuturesSymbol);
              if (futuresTicker) {
                volume24h = parseFloat(futuresTicker.quoteVolume);

                // Use CoinGecko market cap if available, otherwise calculate approximate from Binance
                const marketCapToSave = marketCapFromCoingecko || (volume24h * parseFloat(futuresTicker.lastPrice));

                // Save market cap - prioritize CoinGecko (accurate) over Binance (approximate)
                if (marketCapToSave !== null && marketCapToSave > 0) {
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
                // Fallback: use CoinGecko market cap if available, otherwise calculate from Binance
                const marketCapToSave = marketCapFromCoingecko || (klines.length > 0 ? parseFloat(klines[klines.length - 1].close) * parseFloat(klines[klines.length - 1].quoteVolume) : null);
                
                if (marketCapToSave !== null && marketCapToSave > 0) {
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

                  try {
                    klines4h = await fetchBinanceSpotKlines(coin.binanceSpotSymbol, 100, "4h");
                  } catch (e) {
                    console.warn(`Failed to fetch 4h spot klines for ${coin.symbol}`);
                  }

                  // Get 24h volume from spot ticker
                  const spotTicker = await fetchBinanceSpotTicker(coin.binanceSpotSymbol);
                  if (spotTicker) {
                    volume24h = parseFloat(spotTicker.quoteVolume);

                    // Use CoinGecko market cap if available, otherwise calculate approximate from Binance
                    const marketCapToSave = marketCapFromCoingecko || (volume24h * parseFloat(spotTicker.lastPrice));

                    // Save market cap - prioritize CoinGecko (accurate) over Binance (approximate)
                    if (marketCapToSave !== null && marketCapToSave > 0) {
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

              try {
                klines4h = await fetchBinanceSpotKlines(coin.binanceSpotSymbol, 100, "4h");
              } catch (e) {
                console.warn(`Failed to fetch 4h spot klines for ${coin.symbol}`);
              }

              // Get 24h volume from spot ticker
              const spotTicker = await fetchBinanceSpotTicker(coin.binanceSpotSymbol);
              if (spotTicker) {
                volume24h = parseFloat(spotTicker.quoteVolume);
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

            if (oiCurrent === null && fundingRate === null) {
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

        // Update source status for this coin - delete then insert approach
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

        // Calculate indicators (P1A)
        if (klines.length > 0) {
          try {
            const { convertBinanceKlines } = await import("@/lib/technical-analysis/indicators");
            await indicatorService.calculateAndSave(convertBinanceKlines(klines), coin.id, today, '1d', priceSource);
          } catch (e) {
            console.error(`Failed to calculate 1d indicators for ${coin.symbol}:`, e);
          }
        }
        if (klines4h.length > 0) {
          try {
            const { convertBinanceKlines } = await import("@/lib/technical-analysis/indicators");
            await indicatorService.calculateAndSave(convertBinanceKlines(klines4h), coin.id, today, '4h', priceSource);
          } catch (e) {
            console.error(`Failed to calculate 4h indicators for ${coin.symbol}:`, e);
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
              marketCap: marketCapFromCoingecko, // Use CoinGecko market cap if available
            },
            healthWeights,
            confidenceWeights,
            {
              binance_spot: binanceSpotOk,
              binance_futures: binanceFuturesOk,
              coingecko: coinCoingeckoOk,
            }
          );

          const provenance = {
            trend: {
              sources: [binanceSpotOk ? 'binance_spot' : null, binanceFuturesOk ? 'binance_futures' : null].filter(Boolean) as string[],
              indicators: ['EMA_9', 'EMA_21', 'EMA_50', 'EMA_200', 'ADX_14'],
              calculated_at: new Date().toISOString(),
              confidence: featureResult.confidence_score,
            },
            derivative: {
              sources: [binanceFuturesOk ? 'binance_futures' : null].filter(Boolean) as string[],
              indicators: ['OI_CHANGE', 'FUNDING_RATE'],
              calculated_at: new Date().toISOString(),
              confidence: featureResult.confidence_score,
              missing: [!binanceFuturesOk ? 'LIQUIDATION' : null].filter(Boolean) as string[],
            },
            volume: {
              sources: [binanceSpotOk ? 'binance_spot' : null, binanceFuturesOk ? 'binance_futures' : null].filter(Boolean) as string[],
              indicators: ['VOLUME_RATIO', 'OBV'],
              calculated_at: new Date().toISOString(),
              confidence: featureResult.confidence_score,
            },
            momentum: {
              sources: [binanceSpotOk ? 'binance_spot' : null, binanceFuturesOk ? 'binance_futures' : null].filter(Boolean) as string[],
              indicators: ['RSI_14', 'MACD'],
              calculated_at: new Date().toISOString(),
              confidence: featureResult.confidence_score,
            },
          };

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
              sourceProvenance: provenance as any,
              calculatedAt: new Date(),
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
                sourceProvenance: provenance as any,
                calculatedAt: new Date(),
              },
            });

          // Calculate health score
          const healthScore = calculateHealthScore(
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

          const scoreChange = prevHealth ? healthScore - prevHealth.healthScore : null;

          // Save health score
          await db
            .insert(healthScores)
            .values({
              coinId: coin.id,
              date: today,
              healthScore,
              previousScore: prevHealth?.healthScore || null,
              scoreChange,
              status: getHealthStatus(healthScore),
              confidenceScore: featureResult.confidence_score,
              weightBreakdown: {
                trend: featureResult.trend_score * healthWeights.trend,
                derivative: featureResult.derivative_score * healthWeights.derivative,
                volume: featureResult.volume_score * healthWeights.volume,
                momentum: featureResult.momentum_score * healthWeights.momentum,
              },
              ruleVersionId: activeVersion.id,
            })
            .onConflictDoUpdate({
              target: [healthScores.coinId, healthScores.date],
              set: {
                healthScore,
                previousScore: prevHealth?.healthScore || null,
                scoreChange,
                status: getHealthStatus(healthScore),
                confidenceScore: featureResult.confidence_score,
                weightBreakdown: {
                  trend: featureResult.trend_score * healthWeights.trend,
                  derivative: featureResult.derivative_score * healthWeights.derivative,
                  volume: featureResult.volume_score * healthWeights.volume,
                  momentum: featureResult.momentum_score * healthWeights.momentum,
                },
                ruleVersionId: activeVersion.id,
              },
            });

          // Generate recommendation using Rule Engine (P1B)
          const recommendation = await ruleEngineService.evaluate({
            health:     healthScore,
            trend:      featureResult.trend_score,
            derivative: featureResult.derivative_score,
            volume:     featureResult.volume_score,
            momentum:   featureResult.momentum_score,
            confidence: featureResult.confidence_score,
          }, activeVersion.id);

          await db
            .insert(recommendations)
            .values({
              coinId: coin.id,
              date: today,
              signal: recommendation.signal,
              reason: recommendation.reason,
              reasonBreakdown: {
                trend: featureResult.trend_score,
                derivative: featureResult.derivative_score,
                volume: featureResult.volume_score,
                momentum: featureResult.momentum_score,
                ruleId: recommendation.ruleId,
                matched: recommendation.matched,
              },
              ruleVersionId: activeVersion.id,
            })
            .onConflictDoUpdate({
              target: [recommendations.coinId, recommendations.date],
              set: {
                signal: recommendation.signal,
                reason: recommendation.reason,
                reasonBreakdown: {
                  trend: featureResult.trend_score,
                  derivative: featureResult.derivative_score,
                  volume: featureResult.volume_score,
                  momentum: featureResult.momentum_score,
                  ruleId: recommendation.ruleId,
                  matched: recommendation.matched,
                },
                ruleVersionId: activeVersion.id,
              },
            });
        }

        coinsProcessed++;
      } catch (error) {
        console.error(`Error processing coin ${coin.symbol}:`, error);
        errors.push(`${coin.symbol}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

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

    // Update scheduler log
    await db
      .update(schedulerLogs)
      .set({
        status: errors.length > 0 ? "COMPLETED" : "COMPLETED",
        completedAt: new Date(),
        duration,
        recordsProcessed: coinsProcessed,
        details: errors.length > 0 ? { errors, scope: "global" } : { scope: "global" },
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
