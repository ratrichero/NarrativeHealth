// Square Opportunity Detection Engine
// Deterministic candidate extraction from existing NarrativeHealth data

import { db } from "@/db";
import { normalizeCoinSymbol, validateChartSymbol } from "./chart-utils";
import {
  coins,
  narratives,
  coinNarratives,
  healthScores,
  narrativeHealth,
  features,
  recommendations,
  indicators,
  marketPriceDaily,
  coinMetrics,
} from "@/db/schema";
import { eq, and, desc, sql, gte } from "drizzle-orm";

// ─── Types ─────────────────────────────────────────────

export type OpportunityType = "COIN_SETUP" | "NARRATIVE_SETUP" | "WATCH";
export type DataQuality = "HIGH" | "MEDIUM" | "LOW";
export type OpportunityStatus =
  | "CANDIDATE"
  | "QUALIFIED"
  | "SUPPRESSED"
  | "PUBLISHED"
  | "EXPIRED";

export interface PriceZone {
  low: number;
  high: number;
}

export interface PriceTarget {
  level: number;
  label?: string;
}

export interface SquareOpportunity {
  id: number;
  type: OpportunityType;
  subjectId: number;
  narrativeId?: number;
  coinSymbol?: string;
  score: number;
  dataAsOf: string;
  dataQuality: DataQuality;
  rationale: string[];
  entry?: PriceZone;
  takeProfits?: PriceTarget[];
  stopLoss?: PriceTarget;
  expiresAt?: string;
  status: OpportunityStatus;
  leadingCoinSymbols?: string[];
  leadingCoinRationales?: string[];
  narrativeInvalidation?: string | null;
  leaderCoinEntry?: PriceZone;
  leaderCoinTakeProfits?: PriceTarget[];
  leaderCoinStopLoss?: PriceTarget;
}

export interface OpportunityEvaluationResult {
  opportunities: SquareOpportunity[];
  suppressed: number;
  evaluated: number;
  errors: string[];
}

export interface OpportunityScoringConfig {
  // Quality gates
  minDataQualityScore: number; // 0-100, minimum to qualify
  minConfidenceScore: number; // 0-100, minimum confidence
  minHealthScoreChange: number; // minimum absolute score change
  maxDataAgeHours: number; // maximum hours since data refresh

  // Scoring weights
  weights: {
    dataQuality: number;
    healthMomentum: number;
    signalAlignment: number;
    volumeConfirmation: number;
    trendStrength: number;
    noveltyBonus: number;
  };

  // Cooldown
  coinCooldownHours: number;
  narrativeCooldownHours: number;

  // Quota
  dailySoftCap: number;
  dailyHardCap: number;

  // Narrative multi-coin selection
  maxLeadingCoins: number;
}

export const DEFAULT_SCORING_CONFIG: OpportunityScoringConfig = {
  minDataQualityScore: 60,
  minConfidenceScore: 50,
  minHealthScoreChange: 3,
  maxDataAgeHours: 6,
  weights: {
    dataQuality: 0.2,
    healthMomentum: 0.25,
    signalAlignment: 0.2,
    volumeConfirmation: 0.15,
    trendStrength: 0.15,
    noveltyBonus: 0.05,
  },
  coinCooldownHours: 24,
  narrativeCooldownHours: 48,
  dailySoftCap: 10,
  dailyHardCap: 100,
  maxLeadingCoins: 3,
};

// ─── Data Collection ───────────────────────────────────

interface CoinData {
  coinId: number;
  symbol: string;
  name: string;
  narrativeId: number;
  narrativeName: string;
  isPrimary: boolean;
  healthScore: number;
  previousScore: number | null;
  scoreChange: number | null;
  signal: string;
  confidenceScore: number;
  trendScore: number;
  derivativeScore: number;
  volumeScore: number;
  momentumScore: number;
  currentPrice: number;
  volume24h: number;
  marketCap: number | null;
  fundingRate: number | null;
  openInterest: number | null;
  rsi14: number | null;
  ema20: number | null;
  ema50: number | null;
  atr14: number | null;
  dataDate: string;
}

interface NarrativeData {
  narrativeId: number;
  name: string;
  healthScore: number;
  previousScore: number | null;
  scoreChange: number | null;
  coinCount: number;
  topCoinId: number | null;
  weakestCoinId: number | null;
  avgConfidence: number | null;
  weightingMethod: string;
  dataDate: string;
}

async function getLatestCoinData(): Promise<CoinData[]> {
  const today = new Date().toISOString().split("T")[0];

  const rows = await db
    .select({
      coinId: coins.id,
      symbol: coins.symbol,
      name: coins.name,
      narrativeId: coinNarratives.narrativeId,
      narrativeName: narratives.name,
      isPrimary: coinNarratives.isPrimary,
      healthScore: healthScores.healthScore,
      previousScore: healthScores.previousScore,
      scoreChange: healthScores.scoreChange,
      signal: recommendations.signal,
      confidenceScore: healthScores.confidenceScore,
      trendScore: features.trendScore,
      derivativeScore: features.derivativeScore,
      volumeScore: features.volumeScore,
      momentumScore: features.momentumScore,
      closePrice: marketPriceDaily.close,
      volume24h: marketPriceDaily.volume24h,
      marketCap: coinMetrics.marketCap,
      fundingRate: coinMetrics.fundingRate,
      openInterest: coinMetrics.openInterest,
      dataDate: marketPriceDaily.date,
    })
    .from(coins)
    .innerJoin(coinNarratives, eq(coins.id, coinNarratives.coinId))
    .innerJoin(narratives, eq(coinNarratives.narrativeId, narratives.id))
    .leftJoin(
      healthScores,
      and(eq(healthScores.coinId, coins.id), eq(healthScores.date, today))
    )
    .leftJoin(
      recommendations,
      and(eq(recommendations.coinId, coins.id), eq(recommendations.date, today))
    )
    .leftJoin(
      features,
      and(eq(features.coinId, coins.id), eq(features.date, today))
    )
    .leftJoin(
      marketPriceDaily,
      and(
        eq(marketPriceDaily.coinId, coins.id),
        eq(marketPriceDaily.date, today)
      )
    )
    .leftJoin(
      coinMetrics,
      and(
        eq(coinMetrics.coinId, coins.id),
        eq(coinMetrics.date, today),
        eq(coinMetrics.source, "binance_futures")
      )
    )
    .where(eq(coins.isActive, true));

  // Get latest indicators for each coin
  const coinIds = rows.map((r) => r.coinId);
  if (coinIds.length === 0) return [];

  const indicatorRows = await db
    .select({
      coinId: indicators.coinId,
      indicatorType: indicators.indicatorType,
      indicatorValue: indicators.indicatorValue,
    })
    .from(indicators)
    .where(
      and(
        sql`${indicators.coinId} IN (${sql.join(
          coinIds.map((id) => sql`${id}`),
          sql`, `
        )})`,
        eq(indicators.date, today),
        eq(indicators.timeframe, "1d"),
        sql`${indicators.indicatorType} IN ('RSI_14', 'EMA_20', 'EMA_50', 'ATR_14')`
      )
    );

  const indicatorMap = new Map<
    number,
    Map<string, number>
  >();
  for (const row of indicatorRows) {
    if (!indicatorMap.has(row.coinId)) {
      indicatorMap.set(row.coinId, new Map());
    }
    if (row.indicatorValue !== null) {
      indicatorMap.get(row.coinId)!.set(row.indicatorType, parseFloat(row.indicatorValue));
    }
  }

  return rows.map((r) => {
    const indicators = indicatorMap.get(r.coinId) || new Map();
    return {
      coinId: r.coinId,
      symbol: r.symbol,
      name: r.name,
      narrativeId: r.narrativeId,
      narrativeName: r.narrativeName,
      isPrimary: r.isPrimary,
      healthScore: r.healthScore ?? 0,
      previousScore: r.previousScore,
      scoreChange: r.scoreChange,
      signal: r.signal ?? "OBSERVE",
      confidenceScore: r.confidenceScore ?? 0,
      trendScore: r.trendScore ?? 50,
      derivativeScore: r.derivativeScore ?? 50,
      volumeScore: r.volumeScore ?? 50,
      momentumScore: r.momentumScore ?? 50,
      currentPrice: r.closePrice ? parseFloat(r.closePrice) : 0,
      volume24h: r.volume24h ? parseFloat(r.volume24h) : 0,
      marketCap: r.marketCap ? parseFloat(r.marketCap) : null,
      fundingRate: r.fundingRate ? parseFloat(r.fundingRate) : null,
      openInterest: r.openInterest ? parseFloat(r.openInterest) : null,
      rsi14: indicators.get("RSI_14") ?? null,
      ema20: indicators.get("EMA_20") ?? null,
      ema50: indicators.get("EMA_50") ?? null,
      atr14: indicators.get("ATR_14") ?? null,
      dataDate: r.dataDate ?? today,
    };
  });
}

async function getNarrativeData(): Promise<NarrativeData[]> {
  const today = new Date().toISOString().split("T")[0];

  return db
    .select({
      narrativeId: narratives.id,
      name: narratives.name,
      healthScore: narrativeHealth.healthScore,
      previousScore: narrativeHealth.previousScore,
      scoreChange: narrativeHealth.scoreChange,
      coinCount: narrativeHealth.coinCount,
      topCoinId: narrativeHealth.topCoinId,
      weakestCoinId: narrativeHealth.weakestCoinId,
      avgConfidence: narrativeHealth.avgConfidence,
      weightingMethod: narrativeHealth.weightingMethod,
      dataDate: narrativeHealth.date,
    })
    .from(narratives)
    .innerJoin(
      narrativeHealth,
      and(
        eq(narrativeHealth.narrativeId, narratives.id),
        eq(narrativeHealth.date, today)
      )
    )
    .where(eq(narratives.isActive, true));
}

// ─── Quality Gates ─────────────────────────────────────

function evaluateDataQuality(coin: CoinData): DataQuality {
  let score = 0;
  if (coin.confidenceScore >= 80) score += 30;
  else if (coin.confidenceScore >= 60) score += 20;
  else if (coin.confidenceScore >= 40) score += 10;

  if (coin.currentPrice > 0) score += 20;
  if (coin.volume24h > 0) score += 15;
  if (coin.marketCap !== null) score += 15;
  if (coin.atr14 !== null) score += 10;
  if (coin.rsi14 !== null) score += 10;

  if (score >= 80) return "HIGH";
  if (score >= 50) return "MEDIUM";
  return "LOW";
}

function passesQualityGates(
  coin: CoinData,
  config: OpportunityScoringConfig
): { passes: boolean; reason?: string } {
  // Data freshness
  const dataDate = new Date(coin.dataDate);
  const now = new Date();
  const hoursSinceData =
    (now.getTime() - dataDate.getTime()) / (1000 * 60 * 60);
  if (hoursSinceData > config.maxDataAgeHours) {
    return { passes: false, reason: `Data is ${Math.round(hoursSinceData)}h old (max ${config.maxDataAgeHours}h)` };
  }

  // Confidence threshold
  if (coin.confidenceScore < config.minConfidenceScore) {
    return {
      passes: false,
      reason: `Confidence ${coin.confidenceScore} < ${config.minConfidenceScore}`,
    };
  }

  // Data quality
  const quality = evaluateDataQuality(coin);
  if (quality === "LOW") {
    return { passes: false, reason: "Data quality LOW" };
  }

  // Minimum health score change for momentum signal
  if (
    coin.scoreChange !== null &&
    Math.abs(coin.scoreChange) < config.minHealthScoreChange
  ) {
    return {
      passes: false,
      reason: `Score change ${coin.scoreChange} below threshold ${config.minHealthScoreChange}`,
    };
  }

  return { passes: true };
}

// ─── Scoring ───────────────────────────────────────────

function calculateOpportunityScore(
  coin: CoinData,
  config: OpportunityScoringConfig
): number {
  const w = config.weights;

  // Data quality score (0-100)
  const qualityScore = evaluateDataQuality(coin) === "HIGH" ? 90 : evaluateDataQuality(coin) === "MEDIUM" ? 60 : 30;

  // Health momentum score (0-100)
  const changeMag = coin.scoreChange !== null ? Math.abs(coin.scoreChange) : 0;
  const momentumScore = Math.min(100, changeMag * 10 + 20);

  // Signal alignment score (0-100)
  let signalScore = 50;
  if (coin.signal === "STRONG_WATCH") signalScore = 90;
  else if (coin.signal === "WEAK") signalScore = 85;
  else if (coin.signal === "WATCH") signalScore = 70;
  else if (coin.signal === "OBSERVE") signalScore = 40;

  // Volume confirmation (0-100)
  const volumeScore = Math.min(
    100,
    (coin.volumeScore / 100) * 60 + (coin.volume24h > 0 ? 40 : 0)
  );

  // Trend strength (0-100)
  const trendScore = Math.min(
    100,
    (coin.trendScore / 100) * 50 + (coin.momentumScore / 100) * 50
  );

  // Novelty bonus (0-100)
  const noveltyScore = Math.min(100, changeMag * 15);

  const total =
    qualityScore * w.dataQuality +
    momentumScore * w.healthMomentum +
    signalScore * w.signalAlignment +
    volumeScore * w.volumeConfirmation +
    trendScore * w.trendStrength +
    noveltyScore * w.noveltyBonus;

  return Math.round(total * 100) / 100;
}

function calculateNarrativeCoinSelectionScore(coin: CoinData): number {
  const changeMag = coin.scoreChange !== null ? Math.abs(coin.scoreChange) : 0;
  return (
    coin.healthScore * 0.4 +
    coin.confidenceScore * 0.3 +
    changeMag * 10 * 0.3
  );
}

// ─── Entry/TP/SL Calculation ───────────────────────────

function calculateSetupLevels(
  coin: CoinData
): { entry: PriceZone; takeProfits: PriceTarget[]; stopLoss: PriceTarget } | null {
  if (coin.currentPrice <= 0 || coin.atr14 === null) return null;

  const price = coin.currentPrice;
  const atr = coin.atr14;

  const entryLow = Math.round((price - atr * 0.5) * 10000) / 10000;
  const entryHigh = Math.round((price + atr * 0.5) * 10000) / 10000;
  const tp1 = Math.round((entryHigh + atr * 1.5) * 10000) / 10000;
  const tp2 = Math.round((entryHigh + atr * 3) * 10000) / 10000;
  const sl = Math.round((entryLow - atr * 1) * 10000) / 10000;

  const emaTargets: PriceTarget[] = [];
  if (coin.ema20 !== null && coin.ema20 > price) {
    emaTargets.push({ level: coin.ema20, label: "EMA20" });
  }
  if (coin.ema50 !== null && coin.ema50 > price) {
    emaTargets.push({ level: coin.ema50, label: "EMA50" });
  }

  return {
    entry: { low: entryLow, high: entryHigh },
    takeProfits: [
      { level: tp1, label: "TP1 (1.5 ATR)" },
      { level: tp2, label: "TP2 (3 ATR)" },
      ...emaTargets,
    ].sort((a, b) => a.level - b.level),
    stopLoss: { level: sl, label: "SL (1 ATR)" },
  };
}

// ─── Rationale Generation ──────────────────────────────

function generateRationale(coin: CoinData): string[] {
  const reasons: string[] = [];

  if (coin.scoreChange !== null) {
    if (coin.scoreChange > 5)
      reasons.push(`Health improving significantly (+${coin.scoreChange.toFixed(1)})`);
    else if (coin.scoreChange > 0)
      reasons.push(`Health improving (+${coin.scoreChange.toFixed(1)})`);
    else if (coin.scoreChange < -5)
      reasons.push(`Health declining significantly (${coin.scoreChange.toFixed(1)})`);
    else if (coin.scoreChange < 0)
      reasons.push(`Health declining (${coin.scoreChange.toFixed(1)})`);
    else reasons.push("Health stable");
  }

  reasons.push(`Signal: ${coin.signal}`);

  if (coin.trendScore >= 75) reasons.push("Strong bullish trend");
  else if (coin.trendScore <= 25) reasons.push("Strong bearish trend");

  if (coin.volumeScore >= 75) reasons.push("Volume above average");
  else if (coin.volumeScore <= 25) reasons.push("Volume below average");

  if (coin.fundingRate !== null) {
    if (coin.fundingRate > 0.01) reasons.push("Positive funding (longs paying)");
    else if (coin.fundingRate < -0.01)
      reasons.push("Negative funding (shorts paying)");
  }

  if (coin.rsi14 !== null) {
    if (coin.rsi14 > 70) reasons.push(`RSI overbought (${coin.rsi14.toFixed(1)})`);
    else if (coin.rsi14 < 30)
      reasons.push(`RSI oversold (${coin.rsi14.toFixed(1)})`);
  }

  reasons.push(`Confidence: ${coin.confidenceScore.toFixed(0)}%`);

  return reasons;
}

function generateNarrativeRationale(narrative: NarrativeData): string[] {
  const reasons: string[] = [];

  if (narrative.scoreChange !== null) {
    if (narrative.scoreChange > 3)
      reasons.push(`Narrative health improving (+${narrative.scoreChange.toFixed(1)})`);
    else if (narrative.scoreChange < -3)
      reasons.push(`Narrative health declining (${narrative.scoreChange.toFixed(1)})`);
    else reasons.push("Narrative health stable");
  }

  reasons.push(`${narrative.coinCount} coins in narrative`);
  if (narrative.avgConfidence !== null) {
    reasons.push(`Avg confidence: ${narrative.avgConfidence.toFixed(0)}%`);
  }

  return reasons;
}

// ─── Why Now Generation ────────────────────────────────

function generateWhyNowForCoin(coin: {
  scoreChange: number | null;
  signal: string;
  trendScore: number;
  volumeScore: number;
}): string[] {
  const facts: string[] = [];

  if (coin.scoreChange !== null && Math.abs(coin.scoreChange) >= 3) {
    if (coin.scoreChange > 0) {
      facts.push(`Health improved by ${coin.scoreChange.toFixed(1)} points in the latest refresh.`);
    } else {
      facts.push(`Health declined by ${Math.abs(coin.scoreChange).toFixed(1)} points in the latest refresh.`);
    }
  }

  if (coin.signal === "STRONG_WATCH") {
    facts.push("Signal upgraded to STRONG_WATCH.");
  } else if (coin.signal === "WATCH") {
    facts.push("Signal indicates positive monitoring posture.");
  }

  if (coin.trendScore >= 75 && coin.volumeScore >= 75) {
    facts.push("Trend and volume are confirming each other.");
  }

  return facts;
}

function generateWhyNowForNarrative(
  narrative: NarrativeData,
  leadingCoins: CoinData[]
): string[] {
  const facts: string[] = [];

  if (narrative.scoreChange !== null && Math.abs(narrative.scoreChange) >= 3) {
    if (narrative.scoreChange > 0) {
      facts.push(`Narrative health improved by ${narrative.scoreChange.toFixed(1)} points in the latest refresh.`);
    } else {
      facts.push(`Narrative health declined by ${Math.abs(narrative.scoreChange).toFixed(1)} points in the latest refresh.`);
    }
  }

  const strongCoins = leadingCoins.filter(
    (c) => c.signal === "STRONG_WATCH" || c.signal === "WATCH"
  );
  if (strongCoins.length >= 2) {
    facts.push(
      `${strongCoins.length} leading coins are showing positive momentum together.`
    );
  }

  return facts;
}

// ─── Invalidation Generation ───────────────────────────

function generateCoinInvalidation(params: {
  currentPrice: number;
  atr14: number | null;
}): string | null {
  if (params.atr14 === null || params.currentPrice <= 0) return null;
  const sl = Math.round((params.currentPrice - params.atr14 * 0.5 - params.atr14 * 1) * 10000) / 10000;
  return `Setup invalidates if price breaks below ${sl.toFixed(4)} with sustained weakness.`;
}

function generateNarrativeCoinRationale(coin: CoinData): string {
  const parts: string[] = [];

  if (coin.signal === "STRONG_WATCH") {
    parts.push("strongest momentum contribution");
  } else if (coin.signal === "WATCH") {
    parts.push("positive monitoring posture");
  } else if (coin.signal === "WEAK") {
    parts.push("weakening relative strength");
  } else {
    parts.push("stable baseline");
  }

  if (coin.scoreChange !== null && Math.abs(coin.scoreChange) >= 3) {
    if (coin.scoreChange > 0) {
      parts.push(`improving relative strength (+${coin.scoreChange.toFixed(1)})`);
    } else {
      parts.push(`declining relative strength (${coin.scoreChange.toFixed(1)})`);
    }
  }

  if (coin.trendScore >= 75 && coin.volumeScore >= 75) {
    parts.push("confirmed by trend and volume");
  }

  return parts.join(", ");
}

function generateNarrativeInvalidationFromData(
  narrative: NarrativeData,
  leadingCoins: CoinData[]
): string | null {
  if (leadingCoins.length === 0) return null;

  const weakCoins = leadingCoins.filter(
    (c) => c.signal === "OBSERVE" || c.signal === "WEAK"
  );

  if (weakCoins.length > 0) {
    return `Narrative thesis weakens if ${weakCoins[0].symbol} loses its current signal posture.`;
  }

  if (narrative.avgConfidence !== null && narrative.avgConfidence < 50) {
    return `Narrative thesis weakens if average confidence drops further below current levels.`;
  }

  const decliningCoins = leadingCoins.filter(
    (c) => c.scoreChange !== null && c.scoreChange < -3
  );

  if (decliningCoins.length > 0) {
    return `Narrative thesis weakens if ${decliningCoins[0].symbol} continues declining.`;
  }

  return `The narrative thesis becomes weaker if the current leading-coin strength fails to persist.`;
}

// ─── Opportunity Extraction ────────────────────────────

function extractCoinOpportunities(
  coinData: CoinData[],
  config: OpportunityScoringConfig
): SquareOpportunity[] {
  return coinData
    .filter((coin) => {
      const gate = passesQualityGates(coin, config);
      return gate.passes;
    })
    .map((coin) => {
      const score = calculateOpportunityScore(coin, config);
      const quality = evaluateDataQuality(coin);
      const setup = calculateSetupLevels(coin);
      const rationale = generateRationale(coin);

      return {
        id: 0,
        type: "COIN_SETUP" as OpportunityType,
        subjectId: coin.coinId,
        narrativeId: coin.narrativeId,
        coinSymbol: coin.symbol,
        score,
        dataAsOf: coin.dataDate,
        dataQuality: quality,
        rationale,
        entry: setup?.entry,
        takeProfits: setup?.takeProfits,
        stopLoss: setup?.stopLoss,
        status: "CANDIDATE" as OpportunityStatus,
      };
    })
    .filter((opp) => opp.score >= config.minDataQualityScore)
    .sort((a, b) => b.score - a.score);
}

function selectNarrativeLeadingCoins(
  coinsInNarrative: CoinData[],
  config: OpportunityScoringConfig
): string[] {
  const qualified = coinsInNarrative.filter((c) => {
    const gate = passesQualityGates(c, config);
    return gate.passes;
  });

  if (qualified.length === 0) return [];

  const sorted = qualified
    .map((c) => ({ symbol: c.symbol, score: calculateNarrativeCoinSelectionScore(c) }))
    .sort((a, b) => b.score - a.score);

  const max = Math.max(1, config.maxLeadingCoins);
  return sorted.slice(0, max).map((s) => s.symbol);
}

function extractNarrativeOpportunities(
  narrativeData: NarrativeData[],
  coinData: CoinData[],
  config: OpportunityScoringConfig
): SquareOpportunity[] {
  return narrativeData
    .filter((n) => {
      const change = n.scoreChange;
      return change !== null && Math.abs(change) >= config.minHealthScoreChange;
    })
    .map((narrative) => {
      const coinsInNarrative = coinData.filter(
        (c) => c.narrativeId === narrative.narrativeId
      );
      const avgConfidence = narrative.avgConfidence ?? 0;
      const scoreChange = narrative.scoreChange ?? 0;

      const score =
        Math.min(100, Math.abs(scoreChange) * 10 + avgConfidence * 0.5);

      const rationale = generateNarrativeRationale(narrative);

      const leadingCoinSymbols = selectNarrativeLeadingCoins(
        coinsInNarrative,
        config
      );

      const topCoin = coinsInNarrative.find(
        (c) => c.coinId === narrative.topCoinId
      );
      if (topCoin && !leadingCoinSymbols.includes(topCoin.symbol)) {
        rationale.unshift(`Leader: $${topCoin.symbol}`);
      }

      const leadingCoinsData = leadingCoinSymbols
        .map((symbol) => coinsInNarrative.find((c) => c.symbol === symbol))
        .filter((c): c is CoinData => c !== undefined);

      const leadingCoinRationales = leadingCoinsData.map((c) =>
        generateNarrativeCoinRationale(c)
      );

      const narrativeInvalidation = generateNarrativeInvalidationFromData(
        narrative,
        leadingCoinsData
      );

      const leaderCoin = leadingCoinsData[0];
      const leaderSetup = leaderCoin ? calculateSetupLevels(leaderCoin) : null;

      const dataQuality: DataQuality =
          avgConfidence >= 70 ? "HIGH" : avgConfidence >= 40 ? "MEDIUM" : "LOW";

      return {
        id: 0,
        type: "NARRATIVE_SETUP" as OpportunityType,
        subjectId: narrative.narrativeId,
        narrativeId: narrative.narrativeId,
        coinSymbol: leadingCoinSymbols[0] ?? topCoin?.symbol,
        score,
        dataAsOf: narrative.dataDate,
        dataQuality,
        rationale,
        leadingCoinSymbols,
        leadingCoinRationales,
        narrativeInvalidation,
        leaderCoinEntry: leaderSetup?.entry,
        leaderCoinTakeProfits: leaderSetup?.takeProfits,
        leaderCoinStopLoss: leaderSetup?.stopLoss,
        status: "CANDIDATE" as OpportunityStatus,
      };
    })
    .filter((opp) => opp.score >= config.minDataQualityScore)
    .sort((a, b) => b.score - a.score);
}

// ─── Main Evaluator ────────────────────────────────────

export async function evaluateOpportunities(
  config: OpportunityScoringConfig = DEFAULT_SCORING_CONFIG
): Promise<OpportunityEvaluationResult> {
  const errors: string[] = [];

  try {
    const [coinData, narrativeData] = await Promise.all([
      getLatestCoinData(),
      getNarrativeData(),
    ]);

    const coinOpps = extractCoinOpportunities(coinData, config);
    const narrativeOpps = extractNarrativeOpportunities(
      narrativeData,
      coinData,
      config
    );

    const allOpps = [...narrativeOpps, ...coinOpps];

    const narrativeCoinIds = new Set(
      narrativeOpps
        .filter((n) => n.narrativeId)
        .flatMap((n) =>
          coinData
            .filter((c) => c.narrativeId === n.narrativeId)
            .map((c) => c.coinId)
        )
    );

    const filteredOpps = allOpps.filter(
      (opp) =>
        opp.type !== "COIN_SETUP" || !narrativeCoinIds.has(opp.subjectId)
    );

    return {
      opportunities: filteredOpps,
      suppressed: allOpps.length - filteredOpps.length,
      evaluated: coinData.length + narrativeData.length,
      errors,
    };
  } catch (error) {
    errors.push(
      `Evaluation failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return {
      opportunities: [],
      suppressed: 0,
      evaluated: 0,
      errors,
    };
  }
}

// ─── Content Brief Builder ─────────────────────────────

export interface SquareContentBrief {
  opportunityId: number;
  contentType: "text" | "image";
  title?: string;
  text: string;
  cashtags: string[];
  chartCoin?: string;
  chartCoinExplicit?: boolean;
  dataAsOf: string;
  entry?: PriceZone;
  takeProfits?: PriceTarget[];
  stopLoss?: PriceTarget;
  leadingCoinSymbols?: string[];
  leadingCoinRationales?: string[];
  whyNowFacts?: string[];
  invalidation?: string | null;
  leaderCoinEntry?: PriceZone;
  leaderCoinTakeProfits?: PriceTarget[];
  leaderCoinStopLoss?: PriceTarget;
}

export function buildContentBrief(
  opportunity: SquareOpportunity
): SquareContentBrief {
  const normalizedSymbol = opportunity.coinSymbol
    ? normalizeCoinSymbol(opportunity.coinSymbol)
    : null;
  const validatedChartCoin = normalizedSymbol
    ? validateChartSymbol(normalizedSymbol)
    : null;

  const lines: string[] = [];

  // Headline
  if (opportunity.type === "COIN_SETUP") {
    const signalFromRationale = opportunity.rationale.find(r => r.startsWith("Signal: "))?.replace("Signal: ", "") ?? "Setup Detected";
    lines.push(
      `🔍 $${opportunity.coinSymbol} — ${signalFromRationale}`
    );
  } else if (opportunity.type === "NARRATIVE_SETUP") {
    lines.push(`📊 ${opportunity.coinSymbol ? `$${opportunity.coinSymbol}` : "Narrative"} — Health Signal`);
  }

  lines.push("");

  // WHY NOW (E2)
  const whyNowFacts: string[] = [];
  if (opportunity.type === "COIN_SETUP") {
    const scoreChangeMatch = opportunity.rationale.find(r => r.startsWith("Health improving") || r.startsWith("Health declining"));
    const scoreChange = scoreChangeMatch ? parseFloat(scoreChangeMatch.match(/([\d.+-]+)/)?.[1] || "0") : null;
    
    whyNowFacts.push(...generateWhyNowForCoin({
      scoreChange,
      signal: opportunity.rationale.find(r => r.startsWith("Signal: "))?.replace("Signal: ", "") || "OBSERVE",
      trendScore: opportunity.rationale.includes("Strong bullish trend") ? 85 : opportunity.rationale.includes("Strong bearish trend") ? 25 : 50,
      volumeScore: opportunity.rationale.includes("Volume above average") ? 75 : opportunity.rationale.includes("Volume below average") ? 25 : 50,
    }));
  } else if (opportunity.type === "NARRATIVE_SETUP") {
    const narrativeScoreChange = opportunity.rationale
      .find(r => r.startsWith("Narrative health improving") || r.startsWith("Narrative health declining"))
      ?.match(/([\d.]+)/)?.[1];
    
    if (narrativeScoreChange) {
      const change = parseFloat(narrativeScoreChange);
      if (change > 0) {
        whyNowFacts.push(`Narrative health improved by ${change.toFixed(1)} points in the latest refresh.`);
      } else {
        whyNowFacts.push(`Narrative health declined by ${Math.abs(change).toFixed(1)} points in the latest refresh.`);
      }
    }

    const leaderCount = opportunity.leadingCoinSymbols?.length || 0;
    if (leaderCount >= 2) {
      whyNowFacts.push(`${leaderCount} leading coins are participating in this move.`);
    }
  }

  if (whyNowFacts.length > 0) {
    lines.push("WHY NOW");
    for (const fact of whyNowFacts) {
      lines.push(`• ${fact}`);
    }
    lines.push("");
  }

  // Key facts
  lines.push("Key facts:");
  for (const reason of opportunity.rationale.slice(0, 5)) {
    lines.push(`• ${reason}`);
  }

  // Leading coins with per-coin rationale (E1)
  if (opportunity.type === "NARRATIVE_SETUP" && opportunity.leadingCoinSymbols && opportunity.leadingCoinSymbols.length > 0) {
    lines.push("");
    lines.push("Leading coins:");
    for (let i = 0; i < opportunity.leadingCoinSymbols.length; i++) {
      const symbol = opportunity.leadingCoinSymbols[i];
      const rationale = opportunity.leadingCoinRationales?.[i];
      if (rationale) {
        lines.push(`$${symbol} — ${rationale}`);
      } else {
        lines.push(`$${symbol}`);
      }
    }
  }

  // Setup levels
  if (opportunity.entry) {
    lines.push("");
    lines.push("📍 Setup:");
    lines.push(
      `Entry: ${opportunity.entry.low.toFixed(4)}–${opportunity.entry.high.toFixed(4)}`
    );
    if (opportunity.takeProfits) {
      for (const tp of opportunity.takeProfits.slice(0, 2)) {
        lines.push(`TP: ${tp.level.toFixed(4)}`);
      }
    }
    if (opportunity.stopLoss) {
      lines.push(`SL: ${opportunity.stopLoss.level.toFixed(4)}`);
    }
  } else if (opportunity.type === "NARRATIVE_SETUP" && opportunity.leaderCoinEntry) {
    lines.push("");
    lines.push("📍 Leader setup:");
    lines.push(
      `Entry: ${opportunity.leaderCoinEntry.low.toFixed(4)}–${opportunity.leaderCoinEntry.high.toFixed(4)}`
    );
    if (opportunity.leaderCoinTakeProfits) {
      for (const tp of opportunity.leaderCoinTakeProfits.slice(0, 2)) {
        lines.push(`TP: ${tp.level.toFixed(4)}`);
      }
    }
    if (opportunity.leaderCoinStopLoss) {
      lines.push(`SL: ${opportunity.leaderCoinStopLoss.level.toFixed(4)}`);
    }
  }

  // Invalidation (E2 - data-grounded, no placeholder)
  const invalidation = opportunity.narrativeInvalidation ??
    (opportunity.type === "COIN_SETUP"
      ? generateCoinInvalidation({
          currentPrice: opportunity.entry ? (opportunity.entry.low + opportunity.entry.high) / 2 : 0,
          atr14: opportunity.stopLoss ? Math.abs((opportunity.entry!.low + opportunity.entry!.high) / 2 - opportunity.stopLoss.level) / 1.5 : null,
        })
      : null);

  if (invalidation) {
    lines.push("");
    lines.push("INVALIDATION");
    lines.push(invalidation);
  }

  // Disclaimer
  lines.push("");
  lines.push(
    "⚠️ This is data-driven analysis, not financial advice. Always do your own research."
  );

  const cashtags = opportunity.type === "NARRATIVE_SETUP" && opportunity.leadingCoinSymbols
    ? opportunity.leadingCoinSymbols.map((s) => `$${s}`)
    : validatedChartCoin
      ? [`$${validatedChartCoin}`]
      : [];

  return {
    opportunityId: opportunity.id,
    contentType: opportunity.entry || opportunity.leaderCoinEntry ? "image" : "text",
    text: lines.join("\n"),
    cashtags,
    chartCoin: validatedChartCoin ?? undefined,
    chartCoinExplicit: !!validatedChartCoin,
    dataAsOf: opportunity.dataAsOf,
    entry: opportunity.entry,
    takeProfits: opportunity.takeProfits,
    stopLoss: opportunity.stopLoss,
    leadingCoinSymbols: opportunity.leadingCoinSymbols,
    leadingCoinRationales: opportunity.leadingCoinRationales,
    whyNowFacts,
    invalidation,
    leaderCoinEntry: opportunity.leaderCoinEntry,
    leaderCoinTakeProfits: opportunity.leaderCoinTakeProfits,
    leaderCoinStopLoss: opportunity.leaderCoinStopLoss,
  };
}
