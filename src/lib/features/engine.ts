// Feature Engine - Orchestrates all feature calculations

import { PriceData, preparePriceSeries } from "./calculator";
import { calculateTrendScore, TrendResult } from "./trend";
import { calculateDerivativeScore, DerivativeResult } from "./derivative";
import { calculateVolumeScore, VolumeResult } from "./volume";
import { calculateMomentumScore, MomentumResult } from "./momentum";
import { calculateConfidence, ConfidenceResult, ConfidenceWeights } from "./confidence";

export interface FeatureEngineResult {
  trend_score: number;
  derivative_score: number;
  volume_score: number;
  momentum_score: number;
  trend_detail: TrendResult["detail"];
  derivative_detail: DerivativeResult["detail"];
  volume_detail: VolumeResult["detail"];
  momentum_detail: MomentumResult["detail"];
  confidence_score: number;
  data_completeness: number;
  missing_sources: string[];
  error?: string;
}

export interface SourceOk {
  binance_spot: boolean;
  binance_futures: boolean;
  coingecko: boolean;
}

/**
 * Run full feature pipeline for a single coin
 */
export function runFeatureEngine(
  priceData: PriceData[],
  metrics: {
    openInterest: number | null;
    openInterestPrev?: number | null;
    fundingRate: number | null;
    marketCap: number | null;
  },
  healthWeights: any,
  confidenceWeights: ConfidenceWeights,
  sourceOk?: SourceOk
): FeatureEngineResult {
  // Validate minimum data
  if (priceData.length < 20) {
    return {
      trend_score: 50,
      derivative_score: 50,
      volume_score: 50,
      momentum_score: 50,
      trend_detail: {
        price: 0,
        ema20: 0,
        ema50: 0,
        ema200: 0,
        price_vs_ema20: false,
        price_vs_ema50: false,
        price_vs_ema200: false,
        ema20_vs_ema50: false,
        ema50_vs_ema200: false,
        score_breakdown: { base: 50 },
      },
      derivative_detail: {
        oi_current: null,
        oi_prev: null,
        oi_change_pct: 0,
        funding_rate: null,
        oi_component: 50,
        funding_component: 50,
        accumulation_bonus: 0,
        no_futures: true,
      },
      volume_detail: {
        volume_current: 0,
        volume_ma20: 0,
        volume_ratio: 1,
        days_used: 0,
      },
      momentum_detail: {
        roc_14: 0,
        atr_14: 0,
        atr_pct: 0,
        roc_component: 50,
        atr_component: 50,
      },
      confidence_score: 0,
      data_completeness: 0,
      missing_sources: ["binance_spot", "binance_futures", "coingecko"],
      error: "Insufficient price data (need >= 20 rows)",
    };
  }

  const { closes, highs, lows, volumes } = preparePriceSeries(priceData);

  const trendResult = calculateTrendScore(closes);
  const volumeResult = calculateVolumeScore(volumes);
  const momentumResult = calculateMomentumScore(closes, highs, lows);
  const hasFutures = metrics.openInterest !== null || metrics.fundingRate !== null;
  const derivativeResult = calculateDerivativeScore(
    metrics.openInterest,
    metrics.openInterestPrev ?? null,
    metrics.fundingRate,
    hasFutures
  );

  const confidenceResult = calculateConfidence(
    sourceOk?.binance_spot || false,
    sourceOk?.binance_futures || false,
    sourceOk?.coingecko || false,
    hasFutures,
    confidenceWeights
  );

  return {
    trend_score: trendResult.score,
    derivative_score: derivativeResult.score,
    volume_score: volumeResult.score,
    momentum_score: momentumResult.score,
    trend_detail: trendResult.detail,
    derivative_detail: derivativeResult.detail,
    volume_detail: volumeResult.detail,
    momentum_detail: momentumResult.detail,
    confidence_score: confidenceResult.confidence_score,
    data_completeness: confidenceResult.data_completeness,
    missing_sources: confidenceResult.missing_sources,
  };
}

/**
 * Calculate health score from feature scores
 */
export function calculateHealthScore(
  trendScore: number,
  derivativeScore: number,
  volumeScore: number,
  momentumScore: number,
  weights: { trend: number; derivative: number; volume: number; momentum: number } = {
    trend: 0.35,
    derivative: 0.35,
    volume: 0.2,
    momentum: 0.1,
  }
): number {
  const score =
    trendScore * weights.trend +
    derivativeScore * weights.derivative +
    volumeScore * weights.volume +
    momentumScore * weights.momentum;

  return Number(Math.max(0, Math.min(100, score)).toFixed(1));
}

/**
 * Get recommendation signal from health score
 */
export function getRecommendationSignal(
  healthScore: number,
  thresholds: { strong_watch: number; watch: number; observe: number } = {
    strong_watch: 90,
    watch: 80,
    observe: 65,
  }
): "STRONG_WATCH" | "WATCH" | "OBSERVE" | "WEAK" {
  if (healthScore >= thresholds.strong_watch) return "STRONG_WATCH";
  if (healthScore >= thresholds.watch) return "WATCH";
  if (healthScore >= thresholds.observe) return "OBSERVE";
  return "WEAK";
}

/**
 * Generate recommendation reason text
 */
export function generateRecommendationReason(
  signal: string,
  trendScore: number,
  derivativeScore: number,
  volumeScore: number,
  momentumScore: number,
  confidenceScore: number
): string {
  const parts: string[] = [];

  // Signal-based opening
  switch (signal) {
    case "STRONG_WATCH":
      parts.push("Strong bullish signals across all metrics.");
      break;
    case "WATCH":
      parts.push("Positive indicators with room for monitoring.");
      break;
    case "OBSERVE":
      parts.push("Mixed signals, continue observing.");
      break;
    case "WEAK":
      parts.push("Weak signals, exercise caution.");
      break;
  }

  // Add specific insights
  if (trendScore >= 75) {
    parts.push("Price above key EMAs.");
  } else if (trendScore < 40) {
    parts.push("Price below key EMAs.");
  }

  if (derivativeScore >= 75) {
    parts.push("Derivatives show accumulation.");
  } else if (derivativeScore < 40) {
    parts.push("Derivatives show distribution.");
  }

  if (volumeScore >= 75) {
    parts.push("Volume significantly above average.");
  } else if (volumeScore < 40) {
    parts.push("Volume below average.");
  }

  if (momentumScore >= 75) {
    parts.push("Strong momentum.");
  } else if (momentumScore < 40) {
    parts.push("Weak momentum.");
  }

  // Confidence warning
  if (confidenceScore < 70) {
    parts.push(`⚠ Data confidence: ${confidenceScore.toFixed(0)}%`);
  }

  return parts.join(" ");
}
