// Technical Analysis Engine

import { KlineData, TechnicalAnalysisResult, Timeframe, SignalType, TIMEFRAME_WEIGHTS, TimeframeResult } from "./types";
import { detectMarketRegime } from "./regime";
import { calculateTimeframeScore } from "./scoring";
import { calculateRiskLevels } from "./risk";

/**
 * Convert Binance kline data to standard format
 */
export function convertBinanceKlines(binanceKlines: any[]): KlineData[] {
  return binanceKlines.map((k) => ({
    openTime: Number(Array.isArray(k) ? k[0] : k.openTime),
    open: Number.parseFloat(Array.isArray(k) ? String(k[1]) : String(k.open)),
    high: Number.parseFloat(Array.isArray(k) ? String(k[2]) : String(k.high)),
    low: Number.parseFloat(Array.isArray(k) ? String(k[3]) : String(k.low)),
    close: Number.parseFloat(Array.isArray(k) ? String(k[4]) : String(k.close)),
    volume: Number.parseFloat(Array.isArray(k) ? String(k[5]) : String(k.volume)),
    closeTime: Number(Array.isArray(k) ? k[6] : k.closeTime),
    quoteVolume: Number.parseFloat(Array.isArray(k) ? String(k[7]) : String(k.quoteVolume)),
  })).filter((kline) =>
    Number.isFinite(kline.openTime) &&
    Number.isFinite(kline.open) &&
    Number.isFinite(kline.high) &&
    Number.isFinite(kline.low) &&
    Number.isFinite(kline.close) &&
    Number.isFinite(kline.volume) &&
    Number.isFinite(kline.closeTime) &&
    Number.isFinite(kline.quoteVolume)
  );
}

/**
 * Analyze a single timeframe
 */
export function analyzeTimeframe(
  data: KlineData[],
  timeframe: Timeframe
): TimeframeResult {
  if (data.length < 50) {
    return {
      timeframe,
      indicators: [],
      groupScores: {},
      compositeScore: 0,
      signal: "NEUTRAL",
      dataQuality: {
        qualityScore: 0,
        issues: ["Insufficient data"],
        isValid: false,
        candleCount: data.length,
      },
      klineData: data,
    };
  }
  
  const regime = detectMarketRegime(data);
  const scoreResult = calculateTimeframeScore(data, regime);
  
  // Calculate quality score
  const qualityScore = Math.min(100, (data.length / 200) * 100);
  
  return {
    timeframe,
    indicators: scoreResult.indicators,
    groupScores: scoreResult.groupScores,
    compositeScore: scoreResult.compositeScore,
    signal: scoreResult.signal,
    regime,
    dataQuality: {
      qualityScore,
      issues: [],
      isValid: true,
      candleCount: data.length,
    },
    qualityScore,
    klineData: data,
  };
}

/**
 * Main technical analysis engine
 */
export async function runTechnicalAnalysis(
  symbol: string,
  marketSymbol: string,
  marketType: "futures" | "spot",
  timeframeData: Record<Timeframe, KlineData[]>
): Promise<TechnicalAnalysisResult> {
  const timeframes: Timeframe[] = ["15m", "1h", "4h", "1d"];
  const timeframeResults: Record<string, TimeframeResult> = {};
  const timeframeScores: Record<string, number> = {};
  
  // Analyze each timeframe
  for (const tf of timeframes) {
    const data = timeframeData[tf];
    if (data && data.length > 0) {
      const result = analyzeTimeframe(data, tf);
      timeframeResults[tf] = result;
      timeframeScores[tf] = result.compositeScore;
    } else {
      timeframeResults[tf] = {
        timeframe: tf,
        indicators: [],
        groupScores: {},
        compositeScore: 0,
        signal: "NEUTRAL",
        dataQuality: {
          qualityScore: 0,
          issues: ["No data available"],
          isValid: false,
          candleCount: 0,
        },
        klineData: [],
      };
      timeframeScores[tf] = 0;
    }
  }
  
  // Calculate weighted composite score
  let weightedScore = 0;
  let totalWeight = 0;
  
  for (const tf of timeframes) {
    const weight = TIMEFRAME_WEIGHTS[tf];
    const score = timeframeScores[tf];
    weightedScore += score * weight;
    totalWeight += weight;
  }
  
  const compositeScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
  
  // Determine direction and signal type
  let direction: "LONG" | "SHORT" | "NEUTRAL";
  let signalType: SignalType;
  
  if (compositeScore > 0.6) {
    direction = "LONG";
    signalType = SignalType.STRONG_LONG;
  } else if (compositeScore > 0.3) {
    direction = "LONG";
    signalType = SignalType.LONG;
  } else if (compositeScore > 0.1) {
    direction = "LONG";
    signalType = SignalType.WEAK_LONG;
  } else if (compositeScore < -0.6) {
    direction = "SHORT";
    signalType = SignalType.STRONG_SHORT;
  } else if (compositeScore < -0.3) {
    direction = "SHORT";
    signalType = SignalType.SHORT;
  } else if (compositeScore < -0.1) {
    direction = "SHORT";
    signalType = SignalType.WEAK_SHORT;
  } else {
    direction = "NEUTRAL";
    signalType = SignalType.NEUTRAL;
  }
  
  // Calculate strength and confidence
  const strength = Math.abs(compositeScore) * 100;
  
  // Confidence based on data quality and timeframe alignment
  const validTimeframes = timeframes.filter(tf => timeframeResults[tf].dataQuality?.isValid);
  const confidence = (validTimeframes.length / timeframes.length) * 100;
  
  // Get dominant regime (from 4h timeframe if available, otherwise 1h)
  const dominantRegime = timeframeResults["4h"]?.regime || timeframeResults["1h"]?.regime;
  
  // Calculate risk levels if not neutral
  const mainTimeframeData = timeframeData["4h"] || timeframeData["1h"] || timeframeData["15m"];
  const riskLevels = mainTimeframeData && direction !== "NEUTRAL" 
    ? calculateRiskLevels(mainTimeframeData, direction, compositeScore)
    : undefined;
  
  return {
    symbol,
    marketSymbol,
    marketType,
    direction,
    signalType,
    strength,
    confidence,
    compositeScore,
    timestamp: new Date().toISOString(),
    dominantRegime,
    riskLevels,
    timeframes: timeframeResults,
  };
}
