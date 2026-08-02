// Technical Analysis Engine

import { KlineData, TechnicalAnalysisResult, Timeframe, SignalType, TIMEFRAME_WEIGHTS, TimeframeResult } from "./types";
import { detectMarketRegime } from "./regime";
import { calculateTimeframeScore } from "./scoring";
import { calculateRiskLevels } from "./risk";

/**
 * Apply additive adjustments based on timeframe confluence and conflicts
 */
function applyAdjustments(
  rawScore: number,
  directions: Record<string, string>
): number {
  let pts = 0;
  const sig = rawScore > 0 ? 1 : rawScore < 0 ? -1 : 0;
  
  // --- BONUS ---
  
  // Confluence: tất cả TF cùng hướng → +10 pts theo hướng signal
  const nonNeutral = Object.values(directions).filter(d => d !== 'NEUTRAL');
  const uniqueDirs = new Set(nonNeutral);
  if (uniqueDirs.size === 1) {
    pts += sig * 10;
  }
  
  // HTF alignment: 4H & 1D agree → +7 pts
  const d4h = directions['4h'];
  const d1d = directions['1d'];
  if (d4h && d1d && d4h !== 'NEUTRAL' && d1d !== 'NEUTRAL' && d4h === d1d) {
    pts += sig * 7;
  }
  
  // LTF alignment: 1H & 15m agree + match raw direction → +3 pts
  const d1h  = directions['1h'];
  const d15m = directions['15m'];
  if (d1h && d15m && d1h !== 'NEUTRAL' && d15m !== 'NEUTRAL' && d1h === d15m) {
    const ltfMatchesRaw = 
      (rawScore > 0 && d1h === 'LONG') || 
      (rawScore < 0 && d1h === 'SHORT');
    if (ltfMatchesRaw) {
      pts += sig * 3;
    }
  }
  
  // --- PENALTY ---
  
  // Conflict 1D vs 15m → -10 pts (giảm magnitude)
  if (d1d && d15m && 
      d1d !== 'NEUTRAL' && d15m !== 'NEUTRAL' && 
      d1d !== d15m) {
    const penaltyDir = rawScore > 0 ? 1 : -1;
    pts -= Math.abs(sig) * 10 * penaltyDir;
  }
  
  // Conflict 4H vs 1H → -7 pts
  if (d4h && d1h && 
      d4h !== 'NEUTRAL' && d1h !== 'NEUTRAL' && 
      d4h !== d1h) {
    const penaltyDir = rawScore > 0 ? 1 : -1;
    pts -= Math.abs(sig) * 7 * penaltyDir;
  }
  
  // Additive: raw + pts, clamp [-100, 100]
  return Math.max(-100, Math.min(100, rawScore + pts));
}

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
  
  // Collect timeframe directions for adjustment
  const timeframeDirections: Record<string, string> = {};
  for (const tf of timeframes) {
    timeframeDirections[tf] = timeframeResults[tf].signal;
  }
  
  // Apply additive adjustments
  const adjustedScore = applyAdjustments(compositeScore, timeframeDirections);
  
  // Determine direction and signal type
  let direction: "LONG" | "SHORT" | "NEUTRAL";
  let signalType: SignalType;
  
  if (adjustedScore > 0.6) {
    direction = "LONG";
    signalType = SignalType.STRONG_LONG;
  } else if (adjustedScore > 0.3) {
    direction = "LONG";
    signalType = SignalType.LONG;
  } else if (adjustedScore > 0.1) {
    direction = "LONG";
    signalType = SignalType.WEAK_LONG;
  } else if (adjustedScore < -0.6) {
    direction = "SHORT";
    signalType = SignalType.STRONG_SHORT;
  } else if (adjustedScore < -0.3) {
    direction = "SHORT";
    signalType = SignalType.SHORT;
  } else if (adjustedScore < -0.1) {
    direction = "SHORT";
    signalType = SignalType.WEAK_SHORT;
  } else {
    direction = "NEUTRAL";
    signalType = SignalType.NEUTRAL;
  }
  
  // Calculate strength and confidence
  const strength = Math.abs(adjustedScore) * 100;
  
  // Confidence based on data quality and timeframe alignment
  const validTimeframes = timeframes.filter(tf => timeframeResults[tf].dataQuality?.isValid);
  const confidence = (validTimeframes.length / timeframes.length) * 100;
  
  // Get dominant regime (from 4h timeframe if available, otherwise 1h)
  const dominantRegime = timeframeResults["4h"]?.regime || timeframeResults["1h"]?.regime;
  
  // Calculate risk levels if not neutral
  const mainTimeframeData = timeframeData["4h"] || timeframeData["1h"] || timeframeData["15m"];
  const mainTimeframeResult = timeframeResults["4h"] || timeframeResults["1h"] || timeframeResults["15m"];
  const riskLevels = mainTimeframeData && direction !== "NEUTRAL" 
    ? calculateRiskLevels(mainTimeframeData, direction, adjustedScore, mainTimeframeResult?.regime)
    : undefined;
  
  return {
    symbol,
    marketSymbol,
    marketType,
    direction,
    signalType,
    strength,
    confidence,
    compositeScore: adjustedScore,
    timestamp: new Date().toISOString(),
    dominantRegime,
    riskLevels,
    timeframes: timeframeResults,
  };
}
