/**
 * P6-PERF-03 — Per-coin refresh processor, extracted for bounded concurrency.
 *
 * Each coin's processing is fully independent: no coin depends on another
 * coin's result. All DB writes use upsert (ON CONFLICT DO UPDATE) with
 * coin-specific keys, so parallel execution is safe.
 */

import { db } from "@/db";
import {
  coins,
  marketPriceDaily,
  coinMetrics,
  sourceStatus,
  features,
  healthScores,
  recommendations,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  fetchBinanceSpotKlines,
  fetchBinanceFuturesKlines,
  fetchBinanceFuturesMetrics,
  fetchBinanceOIHistory,
  fetchBinanceSpotTicker,
  fetchBinanceFuturesTicker,
} from "@/lib/collectors/binance";
import {
  runFeatureEngine,
  calculateHealthScore,
} from "@/lib/features/engine";
import { getHealthStatus, getBusinessDate } from "@/lib/utils";
import { ruleVersionService } from "@/lib/services/rule-version.service";
import { indicatorService } from "@/lib/services/indicator.service";
import { ruleEngineService } from "@/lib/services/rule-engine.service";
import { evaluateKlineObservationQualityBatch } from "@/lib/p6/ingestion/kline-quality-batch-hook";

// ─── Types ───────────────────────────────────────────────────────────────

export interface CoinProcessorContext {
  /** Business date string (YYYY-MM-DD) */
  today: string;
  /** Yesterday's business date string */
  yesterday: string;
  /** Health score weights from config */
  healthWeights: { trend: number; derivative: number; volume: number; momentum: number };
  /** Confidence weights from config */
  confidenceWeights: { binance_spot: number; binance_futures: number; coingecko: number };
  /** Active rule version for recommendations */
  activeVersion: { id: number };
  /** Feature version for feature persistence */
  featureVersion: { id: number };
  /** P6 feature algorithm version for version tagging */
  p6FeatureVersion: { id: number };
  /** Pre-fetched CoinGecko market data (read-only, safe for parallel access) */
  coingeckoData: Map<string, { marketCap: number | null; fullyDilutedValuation: number | null }>;
}

export interface CoinProcessorResult {
  /** Whether the coin was processed without fatal error */
  success: boolean;
  /** Coin database ID */
  coinId: number;
  /** Coin symbol (for logging) */
  symbol: string;
  /** Whether klines were fetched */
  hasKlines: boolean;
  /** Number of klines processed */
  klineCount: number;
  /** Error message if failed */
  error?: string;
}

// ─── Processor ───────────────────────────────────────────────────────────

/**
 * Process a single coin: fetch data, calculate features, persist results.
 *
 * This function is fully self-contained — it does not read or write any
 * shared mutable state. All DB writes use coin-specific unique keys via upsert.
 *
 * This function is safe to call concurrently for different coins.
 */
export async function processSingleCoin(
  coin: {
    id: number;
    symbol: string;
    binanceSpotSymbol: string | null;
    binanceFuturesSymbol: string | null;
    coingeckoId: string | null;
  },
  ctx: CoinProcessorContext,
): Promise<CoinProcessorResult> {
  try {
    let binanceSpotOk = false;
    let binanceFuturesOk = false;
    let coinCoingeckoOk = false;

    let priceSource = "binance_spot";
    let klines: Awaited<ReturnType<typeof fetchBinanceSpotKlines>> = [];
    let klines4h: Awaited<ReturnType<typeof fetchBinanceSpotKlines>> = [];
    let volume24h: number | null = null;
    let marketCapFromCoingecko: number | null = null;

    // ── CoinGecko market cap ──
    if (coin.coingeckoId && ctx.coingeckoData.has(coin.coingeckoId)) {
      const cgData = ctx.coingeckoData.get(coin.coingeckoId);
      if (cgData && cgData.marketCap) {
        marketCapFromCoingecko = cgData.marketCap;
        coinCoingeckoOk = true;
        console.log(`Got market cap from CoinGecko for ${coin.symbol}: $${marketCapFromCoingecko?.toLocaleString() || 'N/A'}`);
      }
    }

    // ── Binance Futures klines ──
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

          const futuresTicker = await fetchBinanceFuturesTicker(coin.binanceFuturesSymbol);
          if (futuresTicker) {
            volume24h = parseFloat(futuresTicker.quoteVolume);
            const marketCapToSave = marketCapFromCoingecko || (volume24h * parseFloat(futuresTicker.lastPrice));
            if (marketCapToSave !== null && marketCapToSave > 0) {
              await db
                .insert(coinMetrics)
                .values({
                  coinId: coin.id, date: ctx.today,
                  marketCap: marketCapToSave?.toString() || null, source: "binance_futures",
                })
                .onConflictDoUpdate({
                  target: [coinMetrics.coinId, coinMetrics.date, coinMetrics.source],
                  set: { marketCap: marketCapToSave?.toString() || null },
                });
            }
          } else {
            const marketCapToSave = marketCapFromCoingecko || (klines.length > 0 ? parseFloat(klines[klines.length - 1].close) * parseFloat(klines[klines.length - 1].quoteVolume) : null);
            if (marketCapToSave !== null && marketCapToSave > 0) {
              await db
                .insert(coinMetrics)
                .values({
                  coinId: coin.id, date: ctx.today,
                  marketCap: marketCapToSave?.toString() || null, source: "binance_futures",
                })
                .onConflictDoUpdate({
                  target: [coinMetrics.coinId, coinMetrics.date, coinMetrics.source],
                  set: { marketCap: marketCapToSave?.toString() || null },
                });
            }
          }
        } else {
          console.warn(`No futures klines returned for ${coin.symbol} (${coin.binanceFuturesSymbol})`);
        }
      } catch (error) {
        console.error(`Binance futures klines collection failed for ${coin.symbol} (${coin.binanceFuturesSymbol}):`, error);
        // Fallback to spot
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

              const spotTicker = await fetchBinanceSpotTicker(coin.binanceSpotSymbol);
              if (spotTicker) {
                volume24h = parseFloat(spotTicker.quoteVolume);
                const marketCapToSave = marketCapFromCoingecko || (volume24h * parseFloat(spotTicker.lastPrice));
                if (marketCapToSave !== null && marketCapToSave > 0) {
                  await db
                    .insert(coinMetrics)
                    .values({
                      coinId: coin.id, date: ctx.today,
                      marketCap: marketCapToSave?.toString() || null, source: "binance_spot",
                    })
                    .onConflictDoUpdate({
                      target: [coinMetrics.coinId, coinMetrics.date, coinMetrics.source],
                      set: { marketCap: marketCapToSave?.toString() || null },
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
      // ── Binance Spot klines (no futures) ──
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

    // ── Save price data + quality evaluation ──
    if (klines.length > 0) {
      try {
        await evaluateKlineObservationQualityBatch(klines, {
          entityId: coin.id,
          priceSource,
          timeframe: "DAILY",
        });
      } catch (qualityError) {
        console.warn(`[P6-PERF-01] Batch quality evaluation failed for ${coin.symbol}:`, qualityError instanceof Error ? qualityError.message : qualityError);
      }

      for (const kline of klines) {
        const klineDate = getBusinessDate(new Date(kline.openTime));
        await db
          .insert(marketPriceDaily)
          .values({
            coinId: coin.id, date: klineDate,
            open: kline.open, high: kline.high, low: kline.low, close: kline.close,
            volume: kline.volume, quoteVolume: kline.quoteVolume, source: priceSource,
            volume24h: klineDate === ctx.today ? volume24h?.toString() : null,
          })
          .onConflictDoUpdate({
            target: [marketPriceDaily.coinId, marketPriceDaily.date],
            set: {
              open: kline.open, high: kline.high, low: kline.low, close: kline.close,
              volume: kline.volume, quoteVolume: kline.quoteVolume, source: priceSource,
              volume24h: klineDate === ctx.today ? volume24h?.toString() : null,
            },
          });
      }
    }

    // ── Futures metrics (OI + Funding Rate) ──
    let oiCurrent: number | null = null;
    let oiPrev: number | null = null;
    let fundingRate: number | null = null;

    if (coin.binanceFuturesSymbol) {
      try {
        const futuresMetrics = await fetchBinanceFuturesMetrics(coin.binanceFuturesSymbol);
        oiCurrent = futuresMetrics.openInterest;
        fundingRate = futuresMetrics.fundingRate;

        const oiHistory = await fetchBinanceOIHistory(coin.binanceFuturesSymbol, "1d", 2);
        if (oiHistory.length > 0) {
          oiPrev = oiHistory[oiHistory.length - 1].openInterest;
        }

        if (oiCurrent !== null || fundingRate !== null) {
          binanceFuturesOk = true;
          await db
            .insert(coinMetrics)
            .values({
              coinId: coin.id, date: ctx.today,
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

    // ── CoinGecko FDV ──
    if (coin.coingeckoId && ctx.coingeckoData.has(coin.coingeckoId)) {
      const cgData = ctx.coingeckoData.get(coin.coingeckoId)!;
      coinCoingeckoOk = true;
      await db
        .insert(coinMetrics)
        .values({
          coinId: coin.id, date: ctx.today,
          fullyDilutedValuation: cgData.fullyDilutedValuation?.toString() || null,
          source: "coingecko",
        })
        .onConflictDoUpdate({
          target: [coinMetrics.coinId, coinMetrics.date, coinMetrics.source],
          set: { fullyDilutedValuation: cgData.fullyDilutedValuation?.toString() || null },
        });
    }

    // ── Source status ──
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

    // ── Indicators (1D) ──
    if (klines.length > 0) {
      try {
        const { convertBinanceKlines } = await import("@/lib/technical-analysis/indicators");
        const klineData1d = convertBinanceKlines(klines);
        console.log(`[INDICATOR-1D] ${coin.symbol} (id=${coin.id}): klines=${klines.length} → klineData=${klineData1d.length}, date=${ctx.today}, source=${priceSource}`);
        await indicatorService.calculateAndSave(klineData1d, coin.id, ctx.today, '1d', priceSource);
        console.log(`[INDICATOR-1D-OK] ${coin.symbol} (id=${coin.id}): saved for ${ctx.today}`);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        const errStack = e instanceof Error ? e.stack : undefined;
        console.error(`[INDICATOR-1D-FAIL] ${coin.symbol} (id=${coin.id}, date=${ctx.today}, source=${priceSource}): ${errMsg}`);
        if (errStack) console.error(`[INDICATOR-1D-STACK] ${coin.symbol}:`, errStack);
        throw new Error(`[INDICATOR-1D] ${coin.symbol}: ${errMsg}`);
      }
    }

    // ── Indicators (4H) ──
    if (klines4h.length > 0) {
      try {
        const { convertBinanceKlines } = await import("@/lib/technical-analysis/indicators");
        const klineData4h = convertBinanceKlines(klines4h);
        console.log(`[INDICATOR-4H] ${coin.symbol} (id=${coin.id}): klines4h=${klines4h.length} → klineData=${klineData4h.length}, date=${ctx.today}, source=${priceSource}`);
        await indicatorService.calculateAndSave(klineData4h, coin.id, ctx.today, '4h', priceSource);
        console.log(`[INDICATOR-4H-OK] ${coin.symbol} (id=${coin.id}): saved for ${ctx.today}`);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        const errStack = e instanceof Error ? e.stack : undefined;
        console.error(`[INDICATOR-4H-FAIL] ${coin.symbol} (id=${coin.id}, date=${ctx.today}, source=${priceSource}): ${errMsg}`);
        if (errStack) console.error(`[INDICATOR-4H-STACK] ${coin.symbol}:`, errStack);
        // Non-fatal: 4H indicator failure should not abort coin processing
        console.warn(`[INDICATOR-4H] ${coin.symbol}: non-fatal, continuing`);
      }
    }

    // ── Feature calculation + persistence ──
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
        { openInterest: oiCurrent, openInterestPrev: oiPrev, fundingRate, marketCap: marketCapFromCoingecko },
        ctx.healthWeights,
        ctx.confidenceWeights,
        { binance_spot: binanceSpotOk, binance_futures: binanceFuturesOk, coingecko: coinCoingeckoOk },
        ctx.today,
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

      await db
        .insert(features)
        .values({
          coinId: coin.id, date: ctx.today,
          versionId: ctx.featureVersion.id,
          p6VersionId: ctx.p6FeatureVersion.id,
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
            p6VersionId: ctx.p6FeatureVersion.id,
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

      // ── Health score ──
      const healthScore = calculateHealthScore(
        featureResult.trend_score,
        featureResult.derivative_score,
        featureResult.volume_score,
        featureResult.momentum_score,
        ctx.healthWeights,
      );

      const [prevHealth] = await db
        .select()
        .from(healthScores)
        .where(and(eq(healthScores.coinId, coin.id), eq(healthScores.date, ctx.yesterday)))
        .limit(1);

      const scoreChange = prevHealth ? healthScore - prevHealth.healthScore : null;

      await db
        .insert(healthScores)
        .values({
          coinId: coin.id, date: ctx.today, healthScore,
          previousScore: prevHealth?.healthScore || null,
          scoreChange, status: getHealthStatus(healthScore),
          confidenceScore: featureResult.confidence_score,
          weightBreakdown: {
            trend: featureResult.trend_score * ctx.healthWeights.trend,
            derivative: featureResult.derivative_score * ctx.healthWeights.derivative,
            volume: featureResult.volume_score * ctx.healthWeights.volume,
            momentum: featureResult.momentum_score * ctx.healthWeights.momentum,
          },
          ruleVersionId: ctx.activeVersion.id,
        })
        .onConflictDoUpdate({
          target: [healthScores.coinId, healthScores.date],
          set: {
            healthScore,
            previousScore: prevHealth?.healthScore || null,
            scoreChange, status: getHealthStatus(healthScore),
            confidenceScore: featureResult.confidence_score,
            weightBreakdown: {
              trend: featureResult.trend_score * ctx.healthWeights.trend,
              derivative: featureResult.derivative_score * ctx.healthWeights.derivative,
              volume: featureResult.volume_score * ctx.healthWeights.volume,
              momentum: featureResult.momentum_score * ctx.healthWeights.momentum,
            },
            ruleVersionId: ctx.activeVersion.id,
          },
        });

      // ── Recommendation ──
      const recommendation = await ruleEngineService.evaluate({
        health: healthScore,
        trend: featureResult.trend_score,
        derivative: featureResult.derivative_score,
        volume: featureResult.volume_score,
        momentum: featureResult.momentum_score,
        confidence: featureResult.confidence_score,
      }, ctx.activeVersion.id);

      await db
        .insert(recommendations)
        .values({
          coinId: coin.id, date: ctx.today,
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
          ruleVersionId: ctx.activeVersion.id,
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
            ruleVersionId: ctx.activeVersion.id,
          },
        });
    }

    return {
      success: true,
      coinId: coin.id,
      symbol: coin.symbol,
      hasKlines: klines.length > 0,
      klineCount: klines.length,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error processing coin ${coin.symbol}:`, error);
    return {
      success: false,
      coinId: coin.id,
      symbol: coin.symbol,
      hasKlines: false,
      klineCount: 0,
      error: msg,
    };
  }
}
