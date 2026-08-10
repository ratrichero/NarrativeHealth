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

import { and, eq, gte, lte, desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  coins,
  coinNarratives,
  narratives,
  narrativeHealth,
  healthScores,
  marketPriceDaily,
  coinMetrics,
  featureVersions,
  ruleVersions,
  scoreConfigs,
} from "@/db/schema";
import type { P3AvailabilityState, P3Window, P3Availability } from "./availability";
import type { P3CalculationContext, P3Constituent } from "./context";
import { createCalculationContext } from "./context";
import { resolveP3Window, utcDayStart } from "./windows";
import type { BreadthConstituent } from "./breadth";
import type { LeadershipConstituentInput } from "./leadership";
import type { RSConstituentInput, RSBenchmarkInput, FuturesCloseObservation } from "./relative-strength";

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
  scoreConfigId?: number;
}

export interface P3ExecutionContextResult {
  context: P3CalculationContext;
  constituents: readonly P3Constituent[];
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
}

export interface PreparedRotationInputs {
  healthMomentum: number | null;
  breadthMomentum: number | null;
  relativeStrength: number | null;
  volumeExpansion: number | null;
  oiConfirmation: number | null;
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
  const scoreConfigId = config.scoreConfigId ?? await loadActiveScoreConfig();

  // Prepare constituents with historical snapshot
  const { constituents, snapshotId } = await prepareHistoricalConstituents(
    config.narrativeId,
    resolvedWindow.windowEnd
  );

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
    scoreConfigId,
    constituents,
    sourceAvailability: {} as Record<string, P3Availability<unknown>>, // Will be populated by individual module preparations
    btcBenchmark: undefined, // Will be populated by RS preparation
    provenance: {
      snapshotId,
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
    resolvedWindow: resolvedWindow,
  };
}

// ---------------------------------------------------------------------------
// Historical Constituent Snapshot
// ---------------------------------------------------------------------------

interface HistoricalConstituentResult {
  constituents: readonly P3Constituent[];
  snapshotId: string;
}

/**
 * Prepares the historical constituent snapshot for the given narrative at window_end.
 * This captures membership before any P3 calculations begin.
 */
async function prepareHistoricalConstituents(
  narrativeId: number,
  windowEnd: Date
): Promise<HistoricalConstituentResult> {
  const windowEndLabel = utcDateLabel(windowEnd);
  const snapshotId = `${narrativeId}|${windowEndLabel}`;

  // Query historical narrative membership
  const narrativeMembers = await db
    .select({
      coinId: coinNarratives.coinId,
      isPrimary: coinNarratives.isPrimary,
    })
    .from(coinNarratives)
    .where(eq(coinNarratives.narrativeId, narrativeId));

  if (narrativeMembers.length === 0) {
    return {
      constituents: [],
      snapshotId,
    };
  }

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
  const constituents: P3Constituent[] = narrativeMembers
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
    snapshotId,
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
  narrativeId: number,
  windowEnd: Date,
  constituents: readonly P3Constituent[]
): Promise<PreparedRelativeStrengthInputs> {
  const resolvedWindow = resolveP3Window("14D", windowEnd);
  const eligibleCoinIds = constituents
    .filter((c) => c.membershipState === "ELIGIBLE")
    .map((c) => c.coinId);

  if (eligibleCoinIds.length === 0) {
    return {
      constituents: [],
      btc: {
        coinId: 0,
        instrument: "BTCUSDT",
        prices: [],
      },
    };
  }

  // Load futures prices for constituents
  const constituentPrices = await loadFuturesPrices(eligibleCoinIds, resolvedWindow, constituents);

  // Load BTC benchmark prices
  const btcPrices = await loadFuturesPrices([0], resolvedWindow, null);

  // Build RSConstituentInput array
  const rsConstituents: RSConstituentInput[] = eligibleCoinIds
    .sort((a, b) => a - b)
    .map((coinId) => {
      const constituent = constituents.find((c) => c.coinId === coinId);
      const prices = constituentPrices.get(coinId) ?? [];
      const marketCapAvailable = constituent?.inputManifest?.marketCap != null;

      return {
        coinId,
        marketCapAvailable,
        instrument: constituent?.inputManifest?.instrument as string,
        prices,
      };
    });

  return {
    constituents: Object.freeze(rsConstituents),
    btc: {
      coinId: 0,
      instrument: "BTCUSDT",
      prices: btcPrices.get(0) ?? [],
    },
  };
}

/**
 * Loads perpetual futures daily close prices for given coins.
 */
async function loadFuturesPrices(
  coinIds: readonly number[],
  resolvedWindow: { startTarget: Date; endTarget: Date },
  constituents: readonly P3Constituent[] | null
): Promise<Map<number, FuturesCloseObservation[]>> {
  const startDateLabel = utcDateLabel(resolvedWindow.startTarget);
  const endDateLabel = utcDateLabel(resolvedWindow.endTarget);

  const priceData = await db
    .select({
      coinId: marketPriceDaily.coinId,
      date: marketPriceDaily.date,
      close: marketPriceDaily.close,
    })
    .from(marketPriceDaily)
    .where(
      and(
        gte(marketPriceDaily.date, startDateLabel),
        lte(marketPriceDaily.date, endDateLabel),
        inArray(marketPriceDaily.coinId, coinIds)
      )
    )
    .orderBy(marketPriceDaily.date);

  const pricesMap = new Map<number, FuturesCloseObservation[]>();

  for (const coinId of coinIds) {
    const coinPrices = priceData
      .filter((p) => p.coinId === coinId)
      .map((p) => ({
        date: p.date,
        close: parseFloat(p.close),
        state: "VALID" as const,
      }));

    pricesMap.set(coinId, coinPrices);
  }

  return pricesMap;
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
  constituents: readonly P3Constituent[]
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

  // Load volume scores (placeholder - actual implementation depends on volume calculation)
  const volumeMap = new Map<number, number>();

  // Load 7D returns (placeholder - needs calculation from price data)
  const returnMap = new Map<number, number>();

  // Load 7D relative strength (placeholder - needs RS calculation)
  const rsMap = new Map<number, number>();

  // Build LeadershipConstituentInput array
  const leadershipConstituents: LeadershipConstituentInput[] = eligibleCoinIds
    .sort((a, b) => a - b)
    .map((coinId) => {
      const constituent = constituents.find((c) => c.coinId === coinId);
      const health = healthMap.get(coinId);

      return {
        coinId,
        marketCapAvailable: constituent?.inputManifest?.marketCap != null,
        health: health ?? null,
        volumeScore: volumeMap.get(coinId) ?? null,
        coinReturn7d: returnMap.get(coinId) ?? null,
        relativeStrength7d: rsMap.get(coinId) ?? null,
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
 * This is a placeholder - actual implementation requires P3-04, P3-05, P3-06 results.
 */
export async function prepareRegimeInputs(
  narrativeId: number,
  windowEnd: Date
): Promise<PreparedRegimeInputs> {
  // Placeholder: These inputs come from P3-04, P3-05, P3-06 calculations
  // The actual implementation will receive these from the orchestrator
  return {
    health: null,
    healthChange: null,
    breadth: null,
    breadthChange: null,
    momentum: null,
    acceleration: null,
    relativeStrength: null,
    relativeStrengthChange: null,
    confidence: null,
  };
}

// ---------------------------------------------------------------------------
// Rotation Input Preparation
// ---------------------------------------------------------------------------

/**
 * Prepares Rotation inputs from upstream P3 module outputs.
 * This is a placeholder - actual implementation requires P3-04, P3-05, P3-06 results
 * plus volume and OI data.
 */
export async function prepareRotationInputs(
  narrativeId: number,
  windowEnd: Date,
  constituents: readonly P3Constituent[]
): Promise<PreparedRotationInputs> {
  // Placeholder: These inputs come from P3-04, P3-05, P3-06 calculations
  // Plus volume and OI data for volume expansion and OI confirmation
  return {
    healthMomentum: null,
    breadthMomentum: null,
    relativeStrength: null,
    volumeExpansion: null,
    oiConfirmation: null,
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

async function loadActiveScoreConfig(): Promise<number> {
  const [config] = await db
    .select()
    .from(scoreConfigs)
    .where(eq(scoreConfigs.isActive, true))
    .limit(1);

  if (!config) {
    throw new Error("No active score config found");
  }

  return config.id;
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function utcDateLabel(value: Date): string {
  const day = utcDayStart(value);
  return day.toISOString().slice(0, 10);
}
