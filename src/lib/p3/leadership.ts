import { and, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { coinMetrics, coins, features, healthScores, marketPriceDaily, p3LeadershipMembers, p3NarrativeIntelligence } from "@/db/schema";
import type { P3AvailabilityState, P3Window } from "./availability";
import type { P3CalculationContext, P3CalculationResult, P3MetricResult } from "./context";
import { normalizeResult } from "./context";
import { persistP3Calculation, type P3PersistenceOutcome } from "./persistence";
import { BTC_COINGECKO_ID, BTC_PERPETUAL_INSTRUMENT, P3_FUTURES_PRICE_SOURCE, P3_MARKET_CAP_SOURCE, calculateAssetReturn, type FuturesCloseObservation } from "./relative-strength";
import { resolveP3Window } from "./windows";

export const P3_LEADERSHIP_ALGORITHM_KEY = "leadership-concentration";
export const P3_LEADERSHIP_ALGORITHM_VERSION = "1";
export const LEADERSHIP_WINDOW: P3Window = "7D";

export interface LeadershipConstituentInput {
  coinId: number;
  marketCapAvailable: boolean;
  health: number | null;
  volumeScore: number | null;
  coinReturn7d: number | null;
  relativeStrength7d: number | null;
  availabilityState?: P3AvailabilityState;
  instrument?: string | null;
}

export type LeadershipStatus = "LEADER" | "LEADERS" | "EMERGING_LEADER" | null;
export type ConcentrationClassification = "Broad" | "Moderate" | "Concentrated" | "Highly Concentrated" | null;

export interface LeadershipRankedConstituent {
  coinId: number;
  health: number;
  volumeScore: number;
  momentum: number;
  momentumScore: number;
  relativeStrength: number;
  relativeStrengthScore: number;
  leaderScore: number;
  rank: number;
  status: LeadershipStatus;
  emergingLeader: boolean;
  contribution: number;
  leaderDays7d: number | null;
  leaderPersistence7d: number | null;
}

export interface LeadershipHistoryObservation { date: string; top3CoinIds: readonly number[] }

export interface LeadershipCalculation {
  window: P3Window;
  availabilityState: P3AvailabilityState;
  ranked: readonly LeadershipRankedConstituent[];
  leaderCoinId: number | null;
  leaderScore: number | null;
  top1Contribution: number | null;
  top3Contribution: number | null;
  concentrationClassification: ConcentrationClassification;
  excluded: readonly { coinId: number; reason: string }[];
  provenance: Record<string, unknown>;
}

const percent = (value: number) => value * 100;
const clip = (value: number) => Math.max(0, Math.min(100, value));
const canonicalPerpetual = (instrument: string | null | undefined) => instrument != null && /^[A-Z0-9]+USDT$/.test(instrument);
export function normalizeLeadershipReturn(value: number): number { return clip(50 + 2.5 * percent(value)); }
export function normalizeLeadershipRelativeStrength(value: number): number { return clip(50 + 2.5 * percent(value)); }

function validComponent(value: number | null): value is number { return value != null && Number.isFinite(value) && value >= 0 && value <= 100; }

export function classifyConcentration(top3Contribution: number): Exclude<ConcentrationClassification, null> {
  if (top3Contribution < 0.4) return "Broad";
  if (top3Contribution < 0.55) return "Moderate";
  if (top3Contribution <= 0.70) return "Concentrated";
  return "Highly Concentrated";
}

function persistenceFor(coinId: number, history: readonly LeadershipHistoryObservation[]): { days: number | null; ratio: number | null } {
  if (history.length !== 7 || new Set(history.map((item) => item.date)).size !== 7) return { days: null, ratio: null };
  const days = history.filter((item) => item.top3CoinIds.includes(coinId)).length;
  return { days, ratio: days / 7 };
}

export function calculateLeadership(constituents: readonly LeadershipConstituentInput[], history: readonly LeadershipHistoryObservation[] = []): LeadershipCalculation {
  const excluded: { coinId: number; reason: string }[] = [];
  const eligible = constituents.filter((item) => {
    let reason: string | null = null;
    if (!item.marketCapAvailable) reason = "missing_market_cap";
    else if (!canonicalPerpetual(item.instrument)) reason = "missing_canonical_usdt_perpetual";
    else if (!validComponent(item.health)) reason = "missing_or_invalid_health";
    else if (!validComponent(item.volumeScore)) reason = "missing_or_invalid_volume";
    else if (item.coinReturn7d == null || !Number.isFinite(item.coinReturn7d)) reason = "missing_or_invalid_perpetual_history";
    else if (item.relativeStrength7d == null || !Number.isFinite(item.relativeStrength7d)) reason = "missing_or_invalid_relative_strength";
    if (reason) { excluded.push({ coinId: item.coinId, reason }); return false; }
    return true;
  }).map((item) => {
    const momentumScore = normalizeLeadershipReturn(item.coinReturn7d as number);
    const relativeStrengthScore = normalizeLeadershipRelativeStrength(item.relativeStrength7d as number);
    const leaderScore = (item.health as number) * 0.4 + momentumScore * 0.25 + relativeStrengthScore * 0.2 + (item.volumeScore as number) * 0.15;
    return { item, momentumScore, relativeStrengthScore, leaderScore };
  }).sort((a, b) => b.leaderScore - a.leaderScore || (b.item.health as number) - (a.item.health as number) || b.momentumScore - a.momentumScore || a.item.coinId - b.item.coinId);
  if (eligible.length < 3) return { window: LEADERSHIP_WINDOW, availabilityState: "INSUFFICIENT_HISTORY", ranked: [], leaderCoinId: null, leaderScore: null, top1Contribution: null, top3Contribution: null, concentrationClassification: null, excluded, provenance: { module: "leadership_concentration", minimumEligiblePopulation: 3, excluded } };
  const total = eligible.reduce((sum, value) => sum + value.leaderScore, 0);
  if (total <= 0) return { window: LEADERSHIP_WINDOW, availabilityState: "INVALID", ranked: [], leaderCoinId: null, leaderScore: null, top1Contribution: null, top3Contribution: null, concentrationClassification: null, excluded, provenance: { module: "leadership_concentration", reason: "Leader Score contribution denominator is not positive", excluded } };
  const ranked = eligible.map((value, index) => {
    const persistence = persistenceFor(value.item.coinId, history);
    const emergingLeader = index >= 3 && value.momentumScore >= 70 && value.relativeStrengthScore >= 60 && (value.item.health as number) < 70;
    return { coinId: value.item.coinId, health: value.item.health as number, volumeScore: value.item.volumeScore as number, momentum: value.item.coinReturn7d as number, momentumScore: value.momentumScore, relativeStrength: value.item.relativeStrength7d as number, relativeStrengthScore: value.relativeStrengthScore, leaderScore: value.leaderScore, rank: index + 1, status: index === 0 ? "LEADER" : index < 3 ? "LEADERS" : emergingLeader ? "EMERGING_LEADER" : null, emergingLeader, contribution: value.leaderScore / total, leaderDays7d: persistence.days, leaderPersistence7d: persistence.ratio };
  }) as LeadershipRankedConstituent[];
  const top3 = ranked.slice(0, 3).reduce((sum, item) => sum + item.contribution, 0);
  return { window: LEADERSHIP_WINDOW, availabilityState: "VALID", ranked, leaderCoinId: ranked[0].coinId, leaderScore: ranked[0].leaderScore, top1Contribution: ranked[0].contribution, top3Contribution: top3, concentrationClassification: classifyConcentration(top3), excluded, provenance: { module: "leadership_concentration", window: "7D", minimumEligiblePopulation: 3, ranking: ["leaderScore_desc", "health_desc", "momentumScore_desc", "coinId_asc"], weights: { health: 0.4, momentum: 0.25, relativeStrength: 0.2, volume: 0.15 }, marketCapRole: "eligibility_only", contribution: "leaderScore / sum_leader_scores", excluded } };
}

function metric(metricName: string, value: number | string | null, state: P3AvailabilityState, reason?: string): P3MetricResult<number | string> { return { metric: metricName, value, state, ...(reason ? { reason } : {}) }; }

export function calculateLeadershipResult(context: P3CalculationContext, constituents: readonly LeadershipConstituentInput[], history: readonly LeadershipHistoryObservation[] = []): P3CalculationResult {
  if (context.window !== LEADERSHIP_WINDOW) throw new Error("P3 Leadership v1 requires the 7D UTC window");
  const calculation = calculateLeadership(constituents, history);
  return normalizeResult(context, { availabilityState: calculation.availabilityState, confidence: null, metrics: { leaderScore: metric("leaderScore", calculation.leaderScore, calculation.availabilityState), concentrationTop1: metric("concentrationTop1", calculation.top1Contribution, calculation.availabilityState), concentrationTop3: metric("concentrationTop3", calculation.top3Contribution, calculation.availabilityState), concentrationClassification: metric("concentrationClassification", calculation.concentrationClassification, calculation.availabilityState), leaderCoinId: metric("leaderCoinId", calculation.leaderCoinId, calculation.availabilityState) }, explanation: { ranked: calculation.ranked }, provenance: calculation.provenance });
}

export async function persistLeadership(context: P3CalculationContext, constituents: readonly LeadershipConstituentInput[], history: readonly LeadershipHistoryObservation[] = []): Promise<{ result: P3CalculationResult; persistence: P3PersistenceOutcome }> {
  const calculation = calculateLeadership(constituents, history);
  const result = calculateLeadershipResult(context, constituents, history);
  const persistence = await persistP3Calculation({ context, result, membershipSource: "p3_constituent_snapshot", membershipMode: context.calculationMode, leadershipMembers: calculation.ranked.map((member) => ({ coinId: member.coinId, leaderScore: member.leaderScore, leaderRank: member.rank, leadershipStatus: member.status, isEmergingLeader: member.emergingLeader, leaderDays7d: member.leaderDays7d, leaderPersistence7d: member.leaderPersistence7d, contribution: member.contribution, healthScore: member.health, momentumScore: member.momentumScore, relativeStrengthScore: member.relativeStrengthScore, volumeScore: member.volumeScore })) });
  return { result, persistence };
}

function dateLabel(date: Date): string { return date.toISOString().slice(0, 10); }
function latestByCoin<T extends { coinId: number; date: string }>(rows: readonly T[]): Map<number, T> {
  const latest = new Map<number, T>();
  for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.coinId - b.coinId)) latest.set(row.coinId, row);
  return latest;
}

export async function loadLeadershipInputs(context: P3CalculationContext): Promise<LeadershipConstituentInput[]> {
  if (context.window !== LEADERSHIP_WINDOW) throw new Error("P3 Leadership v1 requires the 7D UTC window");
  const coinIds = [...new Set(context.constituents.map((item) => item.coinId))];
  if (!coinIds.length) return [];
  const btcRows = await db.select({ id: coins.id, instrument: coins.binanceFuturesSymbol }).from(coins).where(eq(coins.coingeckoId, BTC_COINGECKO_ID)).limit(2);
  if (btcRows.length > 1) throw new Error("Ambiguous canonical BTC identity");
  const btc = btcRows[0];
  const coinRows = await db.select({ id: coins.id, instrument: coins.binanceFuturesSymbol }).from(coins).where(inArray(coins.id, coinIds));
  const idsForPrices = [...coinIds, ...(btc ? [btc.id] : [])];
  const resolved = resolveP3Window("7D", context.windowEnd);
  const startDate = dateLabel(new Date(resolved.startTarget.getTime() - 86400000));
  const endDate = dateLabel(resolved.endTarget);
  const priceRows = await db.select({ coinId: marketPriceDaily.coinId, date: marketPriceDaily.date, close: marketPriceDaily.close }).from(marketPriceDaily).where(and(inArray(marketPriceDaily.coinId, idsForPrices), eq(marketPriceDaily.source, P3_FUTURES_PRICE_SOURCE), lte(marketPriceDaily.date, endDate)));
  const capRows = await db.select({ coinId: coinMetrics.coinId, marketCap: coinMetrics.marketCap }).from(coinMetrics).where(and(inArray(coinMetrics.coinId, coinIds), eq(coinMetrics.source, P3_MARKET_CAP_SOURCE), lte(coinMetrics.date, endDate)));
  const healthRows = await db.select({ coinId: healthScores.coinId, date: healthScores.date, health: healthScores.healthScore }).from(healthScores).where(and(inArray(healthScores.coinId, coinIds), lte(healthScores.date, endDate)));
  const featureConditions = [inArray(features.coinId, coinIds), lte(features.date, endDate)];
  if (context.featureVersionId != null) featureConditions.push(eq(features.versionId, context.featureVersionId));
  const featureRows = await db.select({ coinId: features.coinId, date: features.date, volumeScore: features.volumeScore }).from(features).where(and(...featureConditions));
  const pricesFor = (coinId: number): FuturesCloseObservation[] => priceRows.filter((row) => row.coinId === coinId && row.date >= startDate).map((row) => ({ date: String(row.date), close: Number(row.close) }));
  const btcReturn = btc && canonicalPerpetual(btc.instrument) && btc.instrument === BTC_PERPETUAL_INSTRUMENT ? calculateAssetReturn("7D", context.windowEnd, pricesFor(btc.id)) : { value: null };
  const capEligible = new Set(capRows.filter((row) => row.marketCap != null && Number(row.marketCap) > 0).map((row) => row.coinId));
  const healthByCoin = latestByCoin(healthRows.map((row) => ({ ...row, date: String(row.date) })));
  const featureByCoin = latestByCoin(featureRows.map((row) => ({ ...row, date: String(row.date) })));
  const instrumentByCoin = new Map(coinRows.map((row) => [row.id, row.instrument]));
  return context.constituents.map((member) => {
    const coinReturn = calculateAssetReturn("7D", context.windowEnd, pricesFor(member.coinId));
    return { coinId: member.coinId, instrument: instrumentByCoin.get(member.coinId) ?? null, marketCapAvailable: capEligible.has(member.coinId), health: healthByCoin.get(member.coinId)?.health ?? null, volumeScore: featureByCoin.get(member.coinId)?.volumeScore ?? null, coinReturn7d: coinReturn.value, relativeStrength7d: coinReturn.value != null && btcReturn.value != null ? coinReturn.value - btcReturn.value : null };
  });
}

export async function loadLeadershipHistory(context: P3CalculationContext): Promise<LeadershipHistoryObservation[]> {
  const start = new Date(context.windowEnd.getTime() - 6 * 86400000);
  const rows = await db.select({ windowEnd: p3NarrativeIntelligence.windowEnd, coinId: p3LeadershipMembers.coinId, rank: p3LeadershipMembers.leaderRank }).from(p3LeadershipMembers).innerJoin(p3NarrativeIntelligence, eq(p3LeadershipMembers.intelligenceId, p3NarrativeIntelligence.id)).where(and(eq(p3NarrativeIntelligence.narrativeId, context.narrativeId), eq(p3NarrativeIntelligence.algorithmKey, context.algorithmKey), eq(p3NarrativeIntelligence.algorithmVersion, context.algorithmVersion), lte(p3NarrativeIntelligence.windowEnd, context.windowEnd)));
  const byDate = new Map<string, number[]>();
  for (const row of rows.filter((item) => item.windowEnd >= start && item.rank <= 3)) {
    const date = dateLabel(row.windowEnd);
    byDate.set(date, [...(byDate.get(date) ?? []), row.coinId].sort((a, b) => a - b));
  }
  return [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, top3CoinIds]) => ({ date, top3CoinIds }));
}
