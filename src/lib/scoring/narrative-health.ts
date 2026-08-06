import type { HealthStatus } from "@/lib/types/health-timeline";
import type {
  CoinWeightDetail,
  NarrativeHealthEnhanced,
} from "@/lib/types/narrative-health";

/**
 * Input data for a single coin's health within a narrative.
 */
export interface CoinHealthData {
  coinId: number;
  symbol: string;
  healthScore: number;
  confidenceScore: number;
  marketCap: number | null;
}

/**
 * Convert a numeric health score (0-100) to a HealthStatus enum.
 *
 * >= 90 → 'STRONG'
 * >= 80 → 'HEALTHY'
 * >= 65 → 'NEUTRAL'
 * >= 50 → 'CAUTION'
 * else  → 'WEAK'
 */
export function scoreToStatus(score: number): HealthStatus {
  if (score >= 90) return "STRONG";
  if (score >= 80) return "HEALTHY";
  if (score >= 65) return "NEUTRAL";
  if (score >= 50) return "CAUTION";
  return "WEAK";
}

/**
 * Calculate weighted narrative health score using market-cap weighting.
 *
 * Algorithm:
 * 1. If ANY coin is missing market cap (or total mcap = 0), fall back to equal weighting.
 * 2. Otherwise, weight each coin by its market cap share.
 * 3. Compute weighted health score, build weight details, find top/weakest coins.
 * 4. Calculate score change vs previous if provided.
 *
 * @param narrativeId - The narrative ID
 * @param date - The business date (YYYY-MM-DD)
 * @param coinScores - Array of coin health data for coins in this narrative
 * @param ruleVersionId - The active rule version ID
 * @param previousScore - Optional previous narrative health score for change calculation
 * @returns NarrativeHealthEnhanced object
 */
export function calculateWeightedNarrativeHealth(
  narrativeId: number,
  date: string,
  coinScores: CoinHealthData[],
  ruleVersionId: number,
  previousScore?: number
): NarrativeHealthEnhanced {
  // Edge case: no coins
  if (coinScores.length === 0) {
    return {
      narrativeId,
      date,
      healthScore: 0,
      status: "WEAK",
      scoreChange: previousScore !== undefined
        ? Math.round((0 - previousScore) * 100) / 100
        : null,
      avgConfidence: 0,
      topCoinId: null,
      weakestCoinId: null,
      ruleVersionId,
      weightingMethod: "equal",
      weightDetails: {},
    };
  }

  // Step 1 - Check for missing market cap
  const missingMcap = coinScores.filter(
    (c) => !c.marketCap || c.marketCap <= 0
  );

  let weightingMethod: "market_cap" | "equal";
  const weights = new Map<number, number>();

  if (missingMcap.length > 0) {
    // Fall back to equal weighting
    weightingMethod = "equal";
    const equalWeight = 1 / coinScores.length;
    for (const coin of coinScores) {
      weights.set(coin.coinId, equalWeight);
    }
  } else {
    // Market cap weighting
    weightingMethod = "market_cap";
    const totalMcap = coinScores.reduce(
      (sum, c) => sum + (c.marketCap as number),
      0
    );

    if (totalMcap === 0) {
      // Safety fallback to equal weights if total is 0
      weightingMethod = "equal";
      const equalWeight = 1 / coinScores.length;
      for (const coin of coinScores) {
        weights.set(coin.coinId, equalWeight);
      }
    } else {
      for (const coin of coinScores) {
        weights.set(coin.coinId, (coin.marketCap as number) / totalMcap);
      }
    }
  }

  // Step 2 - Calculate weighted health score
  let weightedHealth = 0;
  for (const coin of coinScores) {
    const w = weights.get(coin.coinId) ?? 0;
    weightedHealth += coin.healthScore * w;
  }

  // Round to 2 decimal places for the final score
  const finalScore = Math.round(weightedHealth * 100) / 100;

  // Step 3 - Build weightDetails JSON
  const weightDetails: Record<string, CoinWeightDetail> = {};
  for (const coin of coinScores) {
    const w = weights.get(coin.coinId) ?? 0;
    weightDetails[coin.symbol] = {
      coinId: coin.coinId,
      symbol: coin.symbol,
      weight: Math.round(w * 10000) / 10000, // 4 decimal places
      marketCap: coin.marketCap,
      healthScore: coin.healthScore,
    };
  }

  // Step 4 - Find top/weakest coins (sort by healthScore DESC)
  const sortedCoins = [...coinScores].sort(
    (a, b) => b.healthScore - a.healthScore
  );
  const topCoinId = sortedCoins[0]?.coinId ?? null;
  const weakestCoinId = sortedCoins[sortedCoins.length - 1]?.coinId ?? null;

  // Step 5 - Average confidence
  const avgConfidence =
    coinScores.reduce((sum, c) => sum + c.confidenceScore, 0) /
    coinScores.length;

  // Step 6 - Score change
  let scoreChange: number | null;
  if (previousScore !== undefined) {
    scoreChange = Math.round((finalScore - previousScore) * 100) / 100;
  } else {
    scoreChange = null;
  }

  // Step 7 - Return NarrativeHealthEnhanced
  return {
    narrativeId,
    date,
    healthScore: finalScore,
    status: scoreToStatus(finalScore),
    scoreChange,
    avgConfidence: Math.round(avgConfidence * 100) / 100,
    topCoinId,
    weakestCoinId,
    ruleVersionId,
    weightingMethod,
    weightDetails,
  };
}