/**
 * P3 Input Preparation & Execution Context
 *
 * This layer prepares the exact inputs required by P3-03 through P3-09 calculation modules.
 * It establishes the deterministic execution context, resolves UTC windows, captures historical
 * constituent snapshots, determines eligibility, and loads required historical data.
 *
 * KEY PRINCIPLES:
 * - UTC-only calculation semantics (no Asia/Ho_Chi_Minh in calculations)
 * - Historical snapshot FIRST, calculation SECOND
 * - No current-membership substitution
 * - No fabricated values (missing ≠ zero/neutral)
 * - Futures-only market data sources
 * - Deterministic ordering
 * - Reuse existing P3CalculationContext
 */

import { and, eq, gte, lte, desc, inArray, count } from "drizzle-orm";
import { db } from "@/db";
import {
  coins,
  narratives,
  narrativeHealth,
  healthScores,
  marketPriceDaily,
  coinMetrics,
  features,
  featureVersions,
  ruleVersions,
  scoreConfigs,
  p3NarrativeIntelligence,
} from "@/db/schema";
import type { P3AvailabilityState, P3Window, P3Availability } from "./availability";
import type { P3CalculationContext, P3Constituent } from "./context";
import { createCalculationContext } from "./context";
import { resolveP3Window, utcDayStart } from "./windows";
import type { BreadthConstituent } from "./breadth";
import type { LeadershipConstituentInput } from "./leadership";
import { loadRelativeStrengthInputs, type RSConstituentInput, type RSBenchmarkInput, P3_FUTURES_PRICE_SOURCE, BTC_COINGECKO_ID, BTC_PERPETUAL_INSTRUMENT, calculateAssetReturn, type FuturesCloseObservation } from "./relative-strength";
import { resolveP3Membership, type P3MembershipResolution } from "./membership";
import { rotationBootstrapPhase, type P3RotationBootstrapPhase } from "./rotation";

// ---------------------------------------------------------------------------
// Execution Context Configuration
// ---------------------------------------------------------------------------

export interface P3ExecutionConfig {
  narrativeId: number;
  window: P3Window;
  windowEnd: Date;
  calculationMode: "observed" | "projected";
  featureVersionId?: number;
  ruleVersionId?: number;
}

export interface P3ExecutionContextResult {
  context: P3CalculationContext;
  constituents: readonly P3Constituent[];
  membership: P3MembershipResolution;
  resolvedWindow: {
    window: P3Window;
    windowStart: Date;
    windowEnd: Date;
    startTarget: Date;
    endTarget: Date;
  };
}

// ---------------------------------------------------------------------------
// Prepared Input Types
// ---------------------------------------------------------------------------

export interface PreparedBreadthInputs {
  constituents: readonly BreadthConstituent[];
}

export interface PreparedMomentumInputs {
  observations: readonly { date: string; healthScore: number | null; availabilityState: "VALID" | "MISSING" | "INVALID" }[];
}

export interface PreparedRelativeStrengthInputs {
  constituents: readonly RSConstituentInput[];
  btc: RSBenchmarkInput;
}

export interface PreparedLeadershipInputs {
  constituents: readonly LeadershipConstituentInput[];
  history: readonly { date: string; top3CoinIds: readonly number[] }[];
}

export interface PreparedRegimeInputs {
  health: number | null;
  healthChange: number | null;
  breadth: number | null;
  breadthChange: number | null;
  momentum: number | null;
  acceleration: number | null;
  relativeStrength: number | null;
  relativeStrengthChange: number | null;
  confidence: number | null;
  firstRun: boolean;
}

export interface PreparedRotationInputs {
  healthMomentum: number | null;
  breadthMomentum: number | null;
  relativeStrength: number | null;
  volumeExpansion: number | null;
  oiConfirmation: number | null;
  firstRun: boolean;
  /** P3-16 bootstrap phase derived from the narrative's persisted VALID artifact count. */
  bootstrapPhase: P3RotationBootstrapPhase;
}

// ---------------------------------------------------------------------------
// Context Creation
// ---------------------------------------------------------------------------

/**
 * Creates the P3 execution context with UTC window resolution and version loading.
 */
export async function createP3ExecutionContext(config: P3ExecutionConfig): Promise<P3ExecutionContextResult> {
  // Resolve UTC window through P3-03 kernel
  const resolvedWindow = resolveP3Window(config.window, config.windowEnd);

  // Load active versions if not provided
  const featureVersionId = config.featureVersionId ?? await loadActiveFeatureVersion();
  const ruleVersionId = config.ruleVersionId ?? await loadActiveRuleVersion();

  // Prepare constituents with historical snapshot
  const membership = await resolveP3Membership(
    config.narrativeId,
    resolvedWindow.windowEnd,
    { mode: config.calculationMode === "observed" ? "observed" : "simulation" },
  );
  const { constituents } = membership.availability === "AVAILABLE"
    ? await prepareHistoricalConstituents(config.narrativeId, resolvedWindow.windowEnd, membership)
    : { constituents: Object.freeze([] as P3Constituent[]) };

  // Create calculation context
  const context = createCalculationContext({
    narrativeId: config.narrativeId,
    calculationMode: config.calculationMode,
    window: config.window,
    windowStart: resolvedWindow.windowStart,
    windowEnd: resolvedWindow.windowEnd,
    calculatedAt: new Date(),
    algorithmKey: "p3-kernel",
    algorithmVersion: "1",
    ruleVersionId,
    featureVersionId,
    scoreConfigId: null,
    membershipSnapshotId: membership.snapshotId,
    constituents,
    sourceAvailability: {} as Record<string, P3Availability<unknown>>, // Will be populated by individual module preparations
    btcBenchmark: undefined, // Will be populated by RS preparation
    provenance: {
      snapshotId: membership.snapshotId,
      membership: {
        availability: membership.availability,
        source: membership.source,
        snapshotId: membership.snapshotId,
        snapshotRevision: membership.snapshotRevision,
        memberDigest: membership.memberDigest,
        reason: membership.reason,
      },
      executionMode: config.calculationMode,
      resolvedWindow: {
        window: resolvedWindow.window,
        windowStart: resolvedWindow.windowStart.toISOString(),
        windowEnd: resolvedWindow.windowEnd.toISOString(),
        startTarget: resolvedWindow.startTarget.toISOString(),
        endTarget: resolvedWindow.endTarget.toISOString(),
      },
    },
  });

  return {
    context,
    constituents,
    membership,
    resolvedWindow: resolvedWindow,
  };
}

// ---------------------------------------------------------------------------
// Historical Constituent Snapshot
// ---------------------------------------------------------------------------

interface HistoricalConstituentResult {
  constituents: readonly P3Constituent[];
}

/**
 * Prepares the historical constituent snapshot for the given narrative at window_end.
 * This captures membership before any P3 calculations begin.
 */
async function prepareHistoricalConstituents(
  narrativeId: number,
  windowEnd: Date,
  membership: P3MembershipResolution,
): Promise<HistoricalConstituentResult> {
  if (membership.availability !== "AVAILABLE") {
    return { constituents: [] };
  }

  const narrativeMembers = membership.constituents;
  if (narrativeMembers.length === 0) return { constituents: [] };

  // Load coin data for eligibility evaluation
  const coinIds = narrativeMembers.map((m) => m.coinId);
  const coinsData = await db
    .select({
      id: coins.id,
      symbol: coins.symbol,
      isActive: coins.isActive,
      binanceFuturesSymbol: coins.binanceFuturesSymbol,
    })
    .from(coins)
    .where(eq(coins.isActive, true));

  const coinsMap = new Map(coinsData.map((c) => [c.id, c]));

  // Load market cap for eligibility (get latest available before windowEnd)
  const metricsData = await db
    .select({
      coinId: coinMetrics.coinId,
      marketCap: coinMetrics.marketCap,
      date: coinMetrics.date,
    })
    .from(coinMetrics)
    .where(
      and(
        inArray(coinMetrics.coinId, coinIds),
        lte(coinMetrics.date, utcDateLabel(windowEnd))
      )
    )
    .orderBy(desc(coinMetrics.date))
    .limit(coinIds.length * 2); // Sufficient to get latest for each coin

  // Extract latest market cap for each coin
  const marketCapMap = new Map<number, number | null>();
  for (const coinId of coinIds) {
    const coinMetrics = metricsData
      .filter((m) => m.coinId === coinId)
      .sort((a, b) => b.date.localeCompare(a.date)); // Latest first
    const latest = coinMetrics[0];
    marketCapMap.set(coinId, latest?.marketCap ? parseFloat(latest.marketCap) : null);
  }

  // Build constituent list with eligibility evaluation
  const constituents: P3Constituent[] = [...narrativeMembers]
    .sort((a, b) => a.coinId - b.coinId)
    .map((member) => {
      const coin = coinsMap.get(member.coinId);
      const marketCap = marketCapMap.get(member.coinId);

      if (!coin) {
        return {
          coinId: member.coinId,
          membershipState: "EXCLUDED",
          inclusionReason: null,
          availabilityState: "MISSING",
          inputManifest: { reason: "coin_not_found_or_inactive" },
        };
      }

      // Market cap eligibility check
      if (marketCap == null) {
        return {
          coinId: member.coinId,
          membershipState: "EXCLUDED",
          inclusionReason: null,
          availabilityState: "MISSING",
          inputManifest: { reason: "missing_market_cap" },
        };
      }

      // Futures instrument eligibility check
      if (!coin.binanceFuturesSymbol) {
        return {
          coinId: member.coinId,
          membershipState: "EXCLUDED",
          inclusionReason: null,
          availabilityState: "MISSING",
          inputManifest: { reason: "missing_canonical_usdt_perpetual" },
        };
      }

      return {
        coinId: member.coinId,
        membershipState: "ELIGIBLE",
        inclusionReason: null,
        availabilityState: "VALID",
        inputManifest: {
          symbol: coin.symbol,
          instrument: coin.binanceFuturesSymbol,
          marketCap,
        },
      };
    });

  return {
    constituents: Object.freeze(constituents),
  };
}

// ---------------------------------------------------------------------------
// Breadth Input Preparation
// ---------------------------------------------------------------------------

/**
 * Prepares Breadth inputs from constituent health data.
 */
export async function prepareBreadthInputs(
  narrativeId: number,
  windowEnd: Date,
  constituents: readonly P3Constituent[]
): Promise<PreparedBreadthInputs> {
  const windowEndLabel = utcDateLabel(windowEnd);
  const eligibleCoinIds = constituents
    .filter((c) => c.membershipState === "ELIGIBLE")
    .map((c) => c.coinId);

  if (eligibleCoinIds.length === 0) {
    return { constituents: [] };
  }

  // Load health scores for eligible constituents
  const healthData = await db
    .select({
      coinId: healthScores.coinId,
      healthScore: healthScores.healthScore,
    })
    .from(healthScores)
    .where(
      and(
        eq(healthScores.date, windowEndLabel),
        inArray(healthScores.coinId, eligibleCoinIds)
      )
    );

  const healthMap = new Map(healthData.map((h) => [h.coinId, h.healthScore]));

  // Build BreadthConstituent array
  const breadthConstituents: BreadthConstituent[] = eligibleCoinIds
    .sort((a, b) => a - b)
    .map((coinId) => {
      const health = healthMap.get(coinId);
      const constituent = constituents.find((c) => c.coinId === coinId);

      if (health == null) {
        return {
          coinId,
          health: null,
          availabilityState: "MISSING",
          availabilityReason: "health_score_not_found",
        };
      }

      if (!Number.isFinite(health) || health < 0 || health > 100) {
        return {
          coinId,
          health: null,
          availabilityState: "INVALID",
          availabilityReason: "health_out_of_range",
        };
      }

      return {
        coinId,
        health,
        availabilityState: "VALID",
      };
    });

  return { constituents: Object.freeze(breadthConstituents) };
}

// ---------------------------------------------------------------------------
// Momentum Input Preparation
// ---------------------------------------------------------------------------

/**
 * Prepares Momentum inputs from narrative health observations.
 */
export async function prepareMomentumInputs(
  narrativeId: number,
  windowEnd: Date
): Promise<PreparedMomentumInputs> {
  const resolvedWindow = resolveP3Window("14D", windowEnd); // 14D covers all momentum windows

  // Load narrative health observations for the required window
  const observations = await db
    .select({
      date: narrativeHealth.date,
      healthScore: narrativeHealth.healthScore,
    })
    .from(narrativeHealth)
    .where(
      and(
        eq(narrativeHealth.narrativeId, narrativeId),
        gte(narrativeHealth.date, utcDateLabel(resolvedWindow.startTarget)),
        lte(narrativeHealth.date, utcDateLabel(resolvedWindow.endTarget))
      )
    )
    .orderBy(narrativeHealth.date);

  const preparedObservations = observations.map((obs) => ({
    date: obs.date,
    healthScore: obs.healthScore,
    availabilityState:
      obs.healthScore == null
        ? ("MISSING" as const)
        : !Number.isFinite(obs.healthScore) || obs.healthScore < 0 || obs.healthScore > 100
        ? ("INVALID" as const)
        : ("VALID" as const),
  }));

  return { observations: Object.freeze(preparedObservations) };
}

// ---------------------------------------------------------------------------
// Relative Strength Input Preparation
// ---------------------------------------------------------------------------

/**
 * Prepares Relative Strength inputs from perpetual futures prices.
 */
export async function prepareRelativeStrengthInputs(
  context: P3CalculationContext
): Promise<PreparedRelativeStrengthInputs> {
  return loadRelativeStrengthInputs(context);
}

// ---------------------------------------------------------------------------
// Leadership Input Preparation
// ---------------------------------------------------------------------------

/**
 * Prepares Leadership inputs from constituent data.
 */
export async function prepareLeadershipInputs(
  narrativeId: number,
  windowEnd: Date,
  constituents: readonly P3Constituent[],
  relativeStrengthData?: ReadonlyMap<number, number>,
  featureVersionId?: number
): Promise<PreparedLeadershipInputs> {
  const resolvedWindow = resolveP3Window("7D", windowEnd);
  const eligibleCoinIds = constituents
    .filter((c) => c.membershipState === "ELIGIBLE")
    .map((c) => c.coinId);

  if (eligibleCoinIds.length === 0) {
    return { constituents: [], history: [] };
  }

  // Load health scores
  const healthData = await db
    .select({
      coinId: healthScores.coinId,
      healthScore: healthScores.healthScore,
    })
    .from(healthScores)
    .where(
      and(
        eq(healthScores.date, utcDateLabel(windowEnd)),
        inArray(healthScores.coinId, eligibleCoinIds)
      )
    )
    .orderBy(healthScores.coinId);

  const healthMap = new Map(healthData.map((h) => [h.coinId, h.healthScore]));

  // Load volume scores from canonical features (normalized 0-100)
  const featureConditions = [inArray(features.coinId, eligibleCoinIds), lte(features.date, utcDateLabel(windowEnd))];
  if (featureVersionId != null) featureConditions.push(eq(features.versionId, featureVersionId));
  const featureRows = await db.select({ coinId: features.coinId, date: features.date, volumeScore: features.volumeScore }).from(features).where(and(...featureConditions));
  const featureByCoin = new Map<number, { volumeScore: number | null; date: string }>();
  for (const row of featureRows) {
    const existing = featureByCoin.get(row.coinId);
    const dateStr = String(row.date);
    if (!existing || dateStr > existing.date) {
      featureByCoin.set(row.coinId, { volumeScore: row.volumeScore ?? null, date: dateStr });
    }
  }

  // Load 7D returns from price data (futures-only source)
  // Include BTC benchmark in the query for relative strength calculation
  const btcRows = await db
    .select({ id: coins.id, instrument: coins.binanceFuturesSymbol })
    .from(coins)
    .where(eq(coins.coingeckoId, BTC_COINGECKO_ID))
    .limit(2);
  if (btcRows.length > 1) throw new Error("Ambiguous canonical BTC identity");
  const btc = btcRows[0];
  const priceCoinIds = [...eligibleCoinIds, ...(btc ? [btc.id] : [])];
  const priceData = await db
    .select({
      coinId: marketPriceDaily.coinId,
      close: marketPriceDaily.close,
      date: marketPriceDaily.date,
    })
    .from(marketPriceDaily)
    .where(
      and(
        gte(marketPriceDaily.date, utcDateLabel(resolvedWindow.startTarget)),
        lte(marketPriceDaily.date, utcDateLabel(resolvedWindow.endTarget)),
        inArray(marketPriceDaily.coinId, priceCoinIds),
        eq(marketPriceDaily.source, P3_FUTURES_PRICE_SOURCE)
      )
    )
    .orderBy(marketPriceDaily.date);

  const returnMap = new Map<number, number>();
  for (const coinId of eligibleCoinIds) {
    const coinPrices = priceData
      .filter((p) => p.coinId === coinId)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (coinPrices.length >= 2) {
      const startPrice = parseFloat(coinPrices[0].close as string);
      const endPrice = parseFloat(coinPrices[coinPrices.length - 1].close as string);
      const return7d = (endPrice / startPrice) - 1;
      returnMap.set(coinId, return7d);
    }
  }

  // Load BTC benchmark return for relative strength calculation
  const btcPrices = btc
    ? priceData
        .filter((p) => p.coinId === btc.id)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((p) => ({ date: String(p.date), close: Number(p.close) }))
    : [];
  const btcReturn = btc && btc.instrument === BTC_PERPETUAL_INSTRUMENT && btcPrices.length >= 2
    ? calculateAssetReturn("7D", windowEnd, btcPrices)
    : { value: null };

  // Load 7D relative strength from authoritative P3-06 result
  // Fallback to empty map if not provided (should not happen in production)
  const rsMap = relativeStrengthData ?? new Map<number, number>();

  // Build LeadershipConstituentInput array
  const leadershipConstituents: LeadershipConstituentInput[] = eligibleCoinIds
    .sort((a, b) => a - b)
    .map((coinId) => {
      const constituent = constituents.find((c) => c.coinId === coinId);
      const health = healthMap.get(coinId);
      const feature = featureByCoin.get(coinId);
      const coinReturn = returnMap.get(coinId);

      // Compute relative strength as coin return minus BTC return (canonical P3-06 semantics).
      // This matches the authoritative loadLeadershipInputs() in leadership.ts:160.
      // The constituentReturns7d map from P3-06 contains raw coin returns, NOT relative
      // strength, so it cannot be used directly as relativeStrength7d.
      const relativeStrength7d = coinReturn != null && btcReturn.value != null
        ? coinReturn - btcReturn.value
        : null;

      return {
        coinId,
        marketCapAvailable: constituent?.inputManifest?.marketCap != null,
        health: health ?? null,
        volumeScore: feature?.volumeScore ?? null,
        coinReturn7d: coinReturn ?? null,
        relativeStrength7d,
        availabilityState: health == null ? "MISSING" : "VALID",
        instrument: constituent?.inputManifest?.instrument as string,
      };
    });

  // Load leadership history for persistence calculation
  const history = await loadLeadershipHistory(narrativeId, windowEnd);

  return {
    constituents: Object.freeze(leadershipConstituents),
    history: Object.freeze(history),
  };
}

/**
 * Loads historical leadership top-3 observations.
 */
async function loadLeadershipHistory(
  narrativeId: number,
  windowEnd: Date
): Promise<{ date: string; top3CoinIds: readonly number[] }[]> {
  // Placeholder: Load from p3_narrative_intelligence or p3_leadership_members
  // This requires the leadership persistence to be implemented first
  return [];
}

// ---------------------------------------------------------------------------
// Regime Input Preparation
// ---------------------------------------------------------------------------

/**
 * Prepares Regime inputs from upstream P3 module outputs.
 * Loads narrative health and calculates breadth/RS changes from historical data.
 */
export async function prepareRegimeInputs(
  narrativeId: number,
  windowEnd: Date,
  upstreamResults?: {
    health?: number | null;
    healthChange?: number | null;
    breadth?: number | null;
    breadthChange?: number | null;
    momentum?: number | null;
    acceleration?: number | null;
    relativeStrength?: number | null;
    relativeStrengthChange?: number | null;
    confidence?: number | null;
  }
): Promise<PreparedRegimeInputs> {
  const resolvedWindow = resolveP3Window("7D", windowEnd);

  // Load narrative health
  const narrativeHealthData = await db
    .select({
      date: narrativeHealth.date,
      healthScore: narrativeHealth.healthScore,
    })
    .from(narrativeHealth)
    .where(
      and(
        eq(narrativeHealth.narrativeId, narrativeId),
        gte(narrativeHealth.date, utcDateLabel(resolvedWindow.startTarget)),
        lte(narrativeHealth.date, utcDateLabel(resolvedWindow.endTarget))
      )
    )
    .orderBy(narrativeHealth.date);

  let health: number | null = null;
  let healthChange: number | null = null;
  if (narrativeHealthData.length >= 2) {
    health = narrativeHealthData[narrativeHealthData.length - 1].healthScore;
    const health7dAgo = narrativeHealthData[0].healthScore;
    if (health != null && health7dAgo != null) {
      healthChange = health - health7dAgo;
    }
  }

  // Load historical P3 data for breadth and RS change calculations
  // Only use VALID historical artifacts as baseline (ignore invalid/insufficient records)
  const historicalP3Data = await db
    .select({
      windowEnd: p3NarrativeIntelligence.windowEnd,
      breadth: p3NarrativeIntelligence.breadth,
      relativeStrength7d: p3NarrativeIntelligence.relativeStrength7d,
      availabilityState: p3NarrativeIntelligence.availabilityState,
    })
    .from(p3NarrativeIntelligence)
    .where(
      and(
        eq(p3NarrativeIntelligence.narrativeId, narrativeId),
        eq(p3NarrativeIntelligence.availabilityState, "VALID"),
        gte(p3NarrativeIntelligence.windowEnd, resolvedWindow.startTarget),
        lte(p3NarrativeIntelligence.windowEnd, resolvedWindow.endTarget)
      )
    )
    .orderBy(p3NarrativeIntelligence.windowEnd);

  const firstRun = historicalP3Data.length === 0;

  // Use upstream results if provided, otherwise use historical data
  const breadth = upstreamResults?.breadth ?? null;
  const momentum = upstreamResults?.momentum ?? null;
  const acceleration = upstreamResults?.acceleration ?? null;
  const relativeStrength = upstreamResults?.relativeStrength ?? null;
  const confidence = upstreamResults?.confidence ?? null;

  // Calculate breadth change from historical data
  let breadthChange: number | null = null;
  if (breadth != null && historicalP3Data.length >= 1) {
    const breadth7dAgo = historicalP3Data[0].breadth;
    if (breadth7dAgo != null) {
      breadthChange = breadth - parseFloat(breadth7dAgo);
    }
  }

  // Calculate RS change from historical data
  let relativeStrengthChange: number | null = null;
  if (relativeStrength != null && historicalP3Data.length >= 1) {
    const rs7dAgo = historicalP3Data[0].relativeStrength7d;
    if (rs7dAgo != null) {
      relativeStrengthChange = relativeStrength - parseFloat(rs7dAgo);
    }
  }

  return {
    health,
    healthChange,
    breadth,
    breadthChange,
    momentum,
    acceleration,
    relativeStrength,
    relativeStrengthChange,
    confidence,
    firstRun,
  };
}

// ---------------------------------------------------------------------------
// Rotation Input Preparation
// ---------------------------------------------------------------------------

/**
 * Prepares Rotation inputs from upstream P3 module outputs.
 * Requires: narrative health, P3-04 breadth, P3-06 RS, volume, and OI data.
 */
export async function prepareRotationInputs(
  narrativeId: number,
  windowEnd: Date,
  constituents: readonly P3Constituent[],
  currentRS7d: number | null
): Promise<PreparedRotationInputs> {
  const resolvedWindow = resolveP3Window("7D", windowEnd);
  const eligibleCoinIds = constituents
    .filter((c) => c.membershipState === "ELIGIBLE")
    .map((c) => c.coinId);

  // Health Momentum: current health - health 7D ago, then normalized
  const narrativeHealthData = await db
    .select({
      date: narrativeHealth.date,
      healthScore: narrativeHealth.healthScore,
    })
    .from(narrativeHealth)
    .where(
      and(
        eq(narrativeHealth.narrativeId, narrativeId),
        gte(narrativeHealth.date, utcDateLabel(resolvedWindow.startTarget)),
        lte(narrativeHealth.date, utcDateLabel(resolvedWindow.endTarget))
      )
    )
    .orderBy(narrativeHealth.date);

  let healthMomentum: number | null = null;
  if (narrativeHealthData.length >= 2) {
    const healthNow = narrativeHealthData[narrativeHealthData.length - 1].healthScore;
    const health7dAgo = narrativeHealthData[0].healthScore;
    if (healthNow != null && health7dAgo != null) {
      const healthChange = healthNow - health7dAgo;
      // Normalize: clip(50 + healthChange × 2.5, 0, 100)
      healthMomentum = Math.max(0, Math.min(100, 50 + healthChange * 2.5));
    }
  }

  // Breadth Momentum: load historical breadth from p3_narrative_intelligence
  // Only use VALID historical artifacts as baseline
  let breadthMomentum: number | null = null;
  const historicalBreadthData = await db
    .select({
      windowEnd: p3NarrativeIntelligence.windowEnd,
      breadth: p3NarrativeIntelligence.breadth,
    })
    .from(p3NarrativeIntelligence)
    .where(
      and(
        eq(p3NarrativeIntelligence.narrativeId, narrativeId),
        eq(p3NarrativeIntelligence.availabilityState, "VALID"),
        gte(p3NarrativeIntelligence.windowEnd, resolvedWindow.startTarget),
        lte(p3NarrativeIntelligence.windowEnd, resolvedWindow.endTarget)
      )
    )
    .orderBy(p3NarrativeIntelligence.windowEnd);

  const rotationFirstRun = historicalBreadthData.length === 0;

  // P3-16: derive the rotation bootstrap phase from the narrative's total persisted
  // VALID artifact count. 0 → FIRST_RUN, 1 → SECOND_RUN (bounded second bootstrap),
  // ≥2 → NORMAL (breadthMomentum mandatory, no further bootstrap exceptions).
  const [validArtifactRow] = await db
    .select({ artifactCount: count() })
    .from(p3NarrativeIntelligence)
    .where(and(
      eq(p3NarrativeIntelligence.narrativeId, narrativeId),
      eq(p3NarrativeIntelligence.availabilityState, "VALID"),
    ));
  const bootstrapPhase: P3RotationBootstrapPhase = rotationBootstrapPhase(
    Number(validArtifactRow?.artifactCount ?? 0)
  );

  if (historicalBreadthData.length >= 2) {
    const breadthNow = historicalBreadthData[historicalBreadthData.length - 1].breadth;
    const breadth7dAgo = historicalBreadthData[0].breadth;
    if (breadthNow != null && breadth7dAgo != null) {
      const breadthChange = parseFloat(breadthNow) - parseFloat(breadth7dAgo);
      // Normalize: clip(50 + breadthChange x 50, 0, 100)
      // Breadth is in [0,1], so breadthChange is in [-1, +1]
      breadthMomentum = Math.max(0, Math.min(100, 50 + breadthChange * 50));
    }
  }

  // Relative Strength: use current P3-06 result if available, otherwise load from historical data
  // Only use VALID historical artifacts as baseline
  let relativeStrength: number | null = null;
  if (currentRS7d != null) {
    // Use the canonical current P3-06 result
    relativeStrength = currentRS7d;
  } else if (historicalBreadthData.length > 0) {
    // Fallback to historical data if current is unavailable
    const latestData = historicalBreadthData[historicalBreadthData.length - 1];
    const historicalRSData = await db
      .select({
        windowEnd: p3NarrativeIntelligence.windowEnd,
        relativeStrength7d: p3NarrativeIntelligence.relativeStrength7d,
      })
      .from(p3NarrativeIntelligence)
      .where(
        and(
          eq(p3NarrativeIntelligence.narrativeId, narrativeId),
          eq(p3NarrativeIntelligence.availabilityState, "VALID"),
          eq(p3NarrativeIntelligence.windowEnd, latestData.windowEnd)
        )
      )
      .limit(1);

    if (historicalRSData.length > 0) {
      const rs7d = historicalRSData[0].relativeStrength7d;
      if (rs7d != null) {
        relativeStrength = parseFloat(rs7d);
      }
    }
  }

  // Volume Expansion: 7D volume change for eligible constituents
  const volumeData = await db
    .select({
      coinId: marketPriceDaily.coinId,
      volume: marketPriceDaily.volume,
      date: marketPriceDaily.date,
    })
    .from(marketPriceDaily)
    .where(
      and(
        gte(marketPriceDaily.date, utcDateLabel(resolvedWindow.startTarget)),
        lte(marketPriceDaily.date, utcDateLabel(resolvedWindow.endTarget)),
        inArray(marketPriceDaily.coinId, eligibleCoinIds)
      )
    )
    .orderBy(marketPriceDaily.date);

  const volumeExpansions: number[] = [];
  for (const coinId of eligibleCoinIds) {
    const coinVolumes = volumeData
      .filter((v) => v.coinId === coinId)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (coinVolumes.length >= 2) {
      const startVolume = parseFloat(coinVolumes[0].volume as string);
      const endVolume = parseFloat(coinVolumes[coinVolumes.length - 1].volume as string);
      if (startVolume > 0) {
        const expansion = (endVolume / startVolume) - 1;
        volumeExpansions.push(expansion);
      }
    }
  }

  // Equal-weight average of volume expansions
  let volumeExpansion: number | null = null;
  if (volumeExpansions.length >= 3) {
    volumeExpansion = volumeExpansions.reduce((sum, v) => sum + v, 0) / volumeExpansions.length;
  }

  // OI Confirmation: 7D OI change + price change for eligible constituents
  // Load both OI and price data for matrix calculation
  // IMPORTANT: Filter by binance_futures source to avoid coingecko null OI records
  const oiData = await db
    .select({
      coinId: coinMetrics.coinId,
      openInterest: coinMetrics.openInterest,
      date: coinMetrics.date,
    })
    .from(coinMetrics)
    .where(
      and(
        gte(coinMetrics.date, utcDateLabel(resolvedWindow.startTarget)),
        lte(coinMetrics.date, utcDateLabel(resolvedWindow.endTarget)),
        inArray(coinMetrics.coinId, eligibleCoinIds),
        eq(coinMetrics.source, P3_FUTURES_PRICE_SOURCE)
      )
    )
    .orderBy(coinMetrics.date);

  const priceData = await db
    .select({
      coinId: marketPriceDaily.coinId,
      close: marketPriceDaily.close,
      date: marketPriceDaily.date,
    })
    .from(marketPriceDaily)
    .where(
      and(
        gte(marketPriceDaily.date, utcDateLabel(resolvedWindow.startTarget)),
        lte(marketPriceDaily.date, utcDateLabel(resolvedWindow.endTarget)),
        inArray(marketPriceDaily.coinId, eligibleCoinIds)
      )
    )
    .orderBy(marketPriceDaily.date);

  const oiConfirmations: number[] = [];
  for (const coinId of eligibleCoinIds) {
    const coinOI = oiData
      .filter((o) => o.coinId === coinId)
      .sort((a, b) => a.date.localeCompare(b.date));
    const coinPrice = priceData
      .filter((p) => p.coinId === coinId)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (coinOI.length >= 2 && coinPrice.length >= 2) {
      const startOI = coinOI[0].openInterest ? parseFloat(coinOI[0].openInterest as string) : null;
      const endOI = coinOI[coinOI.length - 1].openInterest ? parseFloat(coinOI[coinOI.length - 1].openInterest as string) : null;
      const startPrice = parseFloat(coinPrice[0].close as string);
      const endPrice = parseFloat(coinPrice[coinPrice.length - 1].close as string);

      if (startOI != null && endOI != null && startOI > 0 && startPrice > 0 && endPrice > 0) {
        const oiChange = (endOI / startOI) - 1;
        const priceChange = (endPrice / startPrice) - 1;

        // Apply OI confirmation matrix
        // positive price + positive OI → 100
        // positive price + zero OI → 75
        // positive price + negative OI → 50
        // zero price + any OI → 50
        // negative price + positive OI → 0
        // negative price + zero OI → 25
        // negative price + negative OI → 50
        const priceDir = priceChange > 0 ? "positive" : priceChange < 0 ? "negative" : "zero";
        const oiDir = oiChange > 0 ? "positive" : oiChange < 0 ? "negative" : "zero";

        const matrix: Record<string, Record<string, number>> = {
          positive: { positive: 100, zero: 75, negative: 50 },
          zero: { positive: 50, zero: 50, negative: 50 },
          negative: { positive: 0, zero: 25, negative: 50 },
        };

        oiConfirmations.push(matrix[priceDir][oiDir]);
      }
    }
  }

  // Equal-weight average of OI confirmations
  let oiConfirmation: number | null = null;
  if (oiConfirmations.length >= 3) {
    oiConfirmation = oiConfirmations.reduce((sum, v) => sum + v, 0) / oiConfirmations.length;
  }

  return {
    healthMomentum,
    breadthMomentum,
    relativeStrength,
    volumeExpansion,
    oiConfirmation,
    firstRun: rotationFirstRun,
    bootstrapPhase,
  };
}

// ---------------------------------------------------------------------------
// Version/Config Loading
// ---------------------------------------------------------------------------

async function loadActiveFeatureVersion(): Promise<number> {
  const [version] = await db
    .select()
    .from(featureVersions)
    .where(eq(featureVersions.isActive, true))
    .limit(1);

  if (!version) {
    throw new Error("No active feature version found");
  }

  return version.id;
}

async function loadActiveRuleVersion(): Promise<number> {
  const [version] = await db
    .select()
    .from(ruleVersions)
    .where(eq(ruleVersions.isActive, true))
    .limit(1);

  if (!version) {
    throw new Error("No active rule version found");
  }

  return version.id;
}

export interface LoadedP3ScoreConfig<T extends Record<string, number>> {
  id: number;
  configType: "P3";
  configKey: "regime_thresholds" | "rotation_thresholds";
  version: number;
  configValue: T;
}

async function loadP3ScoreConfig<T extends Record<string, number>>(
  configKey: LoadedP3ScoreConfig<T>["configKey"],
  version = 1
): Promise<LoadedP3ScoreConfig<T>> {
  const configs = await db
    .select({
      id: scoreConfigs.id,
      configType: scoreConfigs.configType,
      configKey: scoreConfigs.configKey,
      version: scoreConfigs.version,
      configValue: scoreConfigs.configValue,
    })
    .from(scoreConfigs)
    .where(
      and(
        eq(scoreConfigs.configType, "P3"),
        eq(scoreConfigs.configKey, configKey),
        eq(scoreConfigs.version, version),
        eq(scoreConfigs.isActive, true)
      )
    )
    .limit(2);

  if (configs.length === 0) {
    throw new Error(`P3 ${configKey} v${version} configuration not found in score_configs`);
  }
  if (configs.length > 1) {
    throw new Error(`Ambiguous active P3 ${configKey} v${version} configuration`);
  }

  const config = configs[0];
  return {
    id: config.id,
    configType: "P3",
    configKey,
    version: config.version,
    configValue: config.configValue as T,
  };
}

export async function loadRegimeScoreConfig(): Promise<LoadedP3ScoreConfig<Record<string, number>>> {
  const config = await loadP3ScoreConfig("regime_thresholds", 1);
  validateThresholdFields(config.configValue, [
    "healthHigh", "healthLow",
    "breadthHigh", "breadthLow",
    "momentumPositive", "momentumNegative",
    "accelerationDeclining",
    "healthImproving", "breadthIncreasing",
    "relativeStrengthImproving",
    "relativeStrengthPositive", "relativeStrengthNegative",
    "healthDeclining", "breadthDeclining",
    "momentumWeakening",
  ], "regime_thresholds");
  return config;
}

export async function loadRotationScoreConfig(): Promise<LoadedP3ScoreConfig<Record<string, number>>> {
  const config = await loadP3ScoreConfig("rotation_thresholds", 1);
  validateThresholdFields(config.configValue, [
    "acceleratingMin",
    "inflowMin",
    "stableMin",
    "deceleratingMin",
  ], "rotation_thresholds");
  return config;
}

function validateThresholdFields(
  thresholds: Record<string, number>,
  requiredFields: readonly string[],
  configKey: string
): void {
  for (const field of requiredFields) {
    if (thresholds[field] == null || !Number.isFinite(thresholds[field])) {
      throw new Error(`P3 ${configKey} missing or invalid field: ${field}`);
    }
  }
}

/**
 * Load P3 Regime thresholds from score_configs.
 * @throws Error if configuration is missing or invalid
 */
export async function loadRegimeThresholds(): Promise<Record<string, number>> {
  const config = await loadRegimeScoreConfig();
  return config.configValue;
}

/**
 * Load P3 Rotation thresholds from score_configs.
 * @throws Error if configuration is missing or invalid
 */
export async function loadRotationThresholds(): Promise<Record<string, number>> {
  const config = await loadRotationScoreConfig();
  return config.configValue;
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

export function utcDateLabel(value: Date): string {
  const day = utcDayStart(value);
  return day.toISOString().slice(0, 10);
}
