// Technical Analysis Engine

import {
  KlineData,
  TechnicalAnalysisResult,
  Timeframe,
  SignalType,
  DetailedSignal,
  Direction,
  TIMEFRAME_WEIGHTS,
  TimeframeResult,
} from "./types";
import { detectMarketRegime }      from "./regime";
import { calculateTimeframeScore } from "./scoring";
import { calculateRiskLevels }     from "./risk";
import { convertBinanceKlines }    from "./indicators";

export { convertBinanceKlines };

// ═══════════════════════════════════════════════════════════
// HELPER: Normalize detailed signal → LONG / SHORT / NEUTRAL
// ═══════════════════════════════════════════════════════════

function normalizeDirection(signal: string): "LONG" | "SHORT" | "NEUTRAL" {
  if (
    signal === "STRONG_LONG" ||
    signal === "LONG"        ||
    signal === "WEAK_LONG"
  ) return "LONG";

  if (
    signal === "STRONG_SHORT" ||
    signal === "SHORT"         ||
    signal === "WEAK_SHORT"
  ) return "SHORT";

  return "NEUTRAL";
}

// ═══════════════════════════════════════════════════════════
// ADDITIVE ADJUSTMENT  (Python v2.0 exact match)
// directions nhận detailed signal, tự normalize bên trong
// ═══════════════════════════════════════════════════════════

function applyAdjustments(
  rawScore:   number,
  directions: Record<string, DetailedSignal>   // STRONG_LONG, WEAK_SHORT, etc.
): number {
  // Normalize về LONG / SHORT / NEUTRAL để tính bonus/penalty
  const dirs: Record<string, Direction> = Object.fromEntries(
    Object.entries(directions).map(([tf, sig]) => [tf, normalizeDirection(sig)])
  );

  let pts = 0;
  const sig = rawScore > 0 ? 1 : rawScore < 0 ? -1 : 0;

  // ── BONUS ──

  // Confluence: tất cả TF cùng hướng → +10 pts theo hướng signal
  const nonNeutral = Object.values(dirs).filter(d => d !== "NEUTRAL");
  const uniqueDirs = new Set(nonNeutral);
  if (uniqueDirs.size === 1 && nonNeutral.length > 0) {
    pts += sig * 10;
  }

  // HTF alignment: 4h & 1d agree → +7 pts
  const d4h = dirs["4h"];
  const d1d = dirs["1d"];
  if (
    d4h && d1d &&
    d4h !== "NEUTRAL" && d1d !== "NEUTRAL" &&
    d4h === d1d
  ) {
    pts += sig * 7;
  }

  // LTF alignment: 1h & 15m agree + match raw direction → +3 pts
  const d1h  = dirs["1h"];
  const d15m = dirs["15m"];
  if (
    d1h && d15m &&
    d1h !== "NEUTRAL" && d15m !== "NEUTRAL" &&
    d1h === d15m
  ) {
    const ltfMatchesRaw =
      (rawScore > 0 && d1h === "LONG") ||
      (rawScore < 0 && d1h === "SHORT");
    if (ltfMatchesRaw) pts += sig * 3;
  }

  // ── PENALTY ──

  // Conflict 1d vs 15m → -10 pts (giảm magnitude)
  if (
    d1d && d15m &&
    d1d !== "NEUTRAL" && d15m !== "NEUTRAL" &&
    d1d !== d15m
  ) {
    const penaltyDir = rawScore > 0 ? 1 : -1;
    pts -= Math.abs(sig) * 10 * penaltyDir;
  }

  // Conflict 4h vs 1h → -7 pts
  if (
    d4h && d1h &&
    d4h !== "NEUTRAL" && d1h !== "NEUTRAL" &&
    d4h !== d1h
  ) {
    const penaltyDir = rawScore > 0 ? 1 : -1;
    pts -= Math.abs(sig) * 7 * penaltyDir;
  }

  // Additive: raw + pts, clamp [-100, 100]
  return Math.max(-100, Math.min(100, rawScore + pts));
}

// ═══════════════════════════════════════════════════════════
// CONFIDENCE  (Python v2.0 formula)
// confidence = 50% × agreement + 35% × strength + 15% × HTF
// ═══════════════════════════════════════════════════════════

function calcConfidence(
  tfScores:  Record<string, number>,
  tfWeights: Record<string, number>,
  direction: "LONG" | "SHORT" | "NEUTRAL"
): number {
  const tfs = Object.keys(tfScores);
  if (tfs.length === 0) return 0;

  // ── Agreement score (weighted) ──
  // Dùng score number để xác định TF direction (nhất quán hơn string)
  let weightedAgree = 0;
  let totalW        = 0;

  for (const tf of tfs) {
    const w     = tfWeights[tf] ?? 0.1;
    const score = tfScores[tf];
    // Threshold ±15 nhất quán với classifySignal
    const tfDir =
      score > 15  ? "LONG"    :
      score < -15 ? "SHORT"   :
                    "NEUTRAL";

    const agree =
      tfDir === direction   ? 1.0 :
      tfDir === "NEUTRAL"   ? 0.5 :
                              0.0;

    weightedAgree += agree * w;
    totalW        += w;
  }

  const agreementScore = totalW > 0
    ? (weightedAgree / totalW) * 100
    : 0;

  // ── Strength score (weighted avg abs score) ──
  const totalTFWeight = tfs.reduce(
    (s, tf) => s + (tfWeights[tf] ?? 0.1), 0
  );
  const strengthScore = totalTFWeight > 0
    ? tfs.reduce(
        (s, tf) => s + Math.abs(tfScores[tf]) * (tfWeights[tf] ?? 0.1),
        0
      ) / totalTFWeight
    : 0;

  // ── HTF bonus: 1D agree → +15, 4H agree → +5 ──
  let htfBonus = 0;

  if (tfScores["1d"] !== undefined) {
    const d1d =
      tfScores["1d"] > 15  ? "LONG"  :
      tfScores["1d"] < -15 ? "SHORT" :
                              "NEUTRAL";
    if (d1d === direction) htfBonus += 15;
  }

  if (tfScores["4h"] !== undefined) {
    const d4h =
      tfScores["4h"] > 15  ? "LONG"  :
      tfScores["4h"] < -15 ? "SHORT" :
                              "NEUTRAL";
    if (d4h === direction) htfBonus += 5;
  }

  // ── Combine ──
  const confidence =
    agreementScore * 0.50 +
    strengthScore  * 0.35 +
    htfBonus;

  return Math.min(Math.round(confidence * 10) / 10, 95);
}

// ═══════════════════════════════════════════════════════════
// SIGNAL CLASSIFICATION  (scale -100 → +100)
// ═══════════════════════════════════════════════════════════

function classifySignal(score: number): {
  direction: "LONG" | "SHORT" | "NEUTRAL";
  signalType: SignalType;
} {
  if      (score >  60) return { direction: "LONG",    signalType: SignalType.STRONG_LONG  };
  else if (score >  35) return { direction: "LONG",    signalType: SignalType.LONG         };
  else if (score >  15) return { direction: "LONG",    signalType: SignalType.WEAK_LONG    };
  else if (score > -15) return { direction: "NEUTRAL", signalType: SignalType.NEUTRAL      };
  else if (score > -35) return { direction: "SHORT",   signalType: SignalType.WEAK_SHORT   };
  else if (score > -60) return { direction: "SHORT",   signalType: SignalType.SHORT        };
  else                  return { direction: "SHORT",   signalType: SignalType.STRONG_SHORT };
}

// ═══════════════════════════════════════════════════════════
// SINGLE TIMEFRAME ANALYSIS
// ═══════════════════════════════════════════════════════════

export function analyzeTimeframe(
  data:      KlineData[],
  timeframe: Timeframe
): TimeframeResult {
  if (data.length < 50) {
    return {
      timeframe,
      indicators:     [],
      groupScores:    {},
      compositeScore: 0,
      signal:         "NEUTRAL",
      dataQuality: {
        qualityScore: 0,
        issues:       ["Insufficient data (need ≥ 50 candles)"],
        isValid:      false,
        candleCount:  data.length,
      },
      klineData: data,
    };
  }

  const regime      = detectMarketRegime(data);
  const scoreResult = calculateTimeframeScore(data, regime);
  const qualityScore= Math.min(100, (data.length / 200) * 100);

  return {
    timeframe,
    indicators:     scoreResult.indicators,
    groupScores:    scoreResult.groupScores,
    compositeScore: scoreResult.compositeScore,
    // signal là detailed: STRONG_LONG, WEAK_SHORT, etc.
    signal:         scoreResult.signal,
    regime,
    dataQuality: {
      qualityScore,
      issues:      [],
      isValid:     true,
      candleCount: data.length,
    },
    qualityScore,
    klineData: data,
  };
}

// ═══════════════════════════════════════════════════════════
// MAIN ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════

export async function runTechnicalAnalysis(
  symbol:        string,
  marketSymbol:  string,
  marketType:    "futures" | "spot",
  timeframeData: Record<Timeframe, KlineData[]>
): Promise<TechnicalAnalysisResult> {
  const timeframes: Timeframe[] = ["15m", "1h", "4h", "1d"];
  const timeframeResults: Record<string, TimeframeResult> = {};
  const timeframeScores:  Record<string, number>          = {};

  // ── Analyze each timeframe ──
  for (const tf of timeframes) {
    const data = timeframeData[tf];

    if (data && data.length > 0) {
      const result         = analyzeTimeframe(data, tf);
      timeframeResults[tf] = result;
      timeframeScores[tf]  = result.compositeScore;
    } else {
      timeframeResults[tf] = {
        timeframe:      tf,
        indicators:     [],
        groupScores:    {},
        compositeScore: 0,
        signal:         "NEUTRAL",
        dataQuality: {
          qualityScore: 0,
          issues:       ["No data available"],
          isValid:      false,
          candleCount:  0,
        },
        klineData: [],
      };
      timeframeScores[tf] = 0;
    }
  }

  // ── Weighted raw score (scale -100 → +100) ──
  let weightedSum = 0;
  let totalWeight = 0;

  for (const tf of timeframes) {
    const w = TIMEFRAME_WEIGHTS[tf];
    weightedSum += timeframeScores[tf] * w;
    totalWeight += w;
  }

  const rawScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // ── Collect detailed signals từ mỗi TF ──
  // Giữ nguyên STRONG_LONG, WEAK_SHORT, etc. để display
  // applyAdjustments tự normalize bên trong
  const directions: Record<string, DetailedSignal> = {};
  for (const tf of timeframes) {
    directions[tf] = timeframeResults[tf].signal;
  }

  // ── Additive adjustments ──
  const adjustedScore = applyAdjustments(rawScore, directions);

  // ── Classify final signal ──
  const { direction, signalType } = classifySignal(adjustedScore);

  // ── Strength (0 → 100) ──
  const strength = Math.abs(adjustedScore);

  // ── Confidence ──
  const confidence = calcConfidence(
    timeframeScores,
    TIMEFRAME_WEIGHTS as Record<string, number>,
    direction
  );

  // ── Dominant regime: 1d → 4h → 1h → 15m ──
  const dominantRegime =
    timeframeResults["1d"]?.regime  ??
    timeframeResults["4h"]?.regime  ??
    timeframeResults["1h"]?.regime  ??
    timeframeResults["15m"]?.regime;

  // ── Risk levels ──
  const mainData =
    timeframeData["4h"]  ??
    timeframeData["1h"]  ??
    timeframeData["15m"];

  const mainRegime =
    timeframeResults["4h"]?.regime ??
    timeframeResults["1h"]?.regime;

  const riskLevels =
    mainData && direction !== "NEUTRAL"
      ? calculateRiskLevels(mainData, direction, adjustedScore, mainRegime)
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
    timestamp:      new Date().toISOString(),
    dominantRegime,
    riskLevels,
    timeframes:     timeframeResults,
  };
}