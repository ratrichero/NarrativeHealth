import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { coinMetrics, coins, marketPriceDaily } from "@/db/schema";
import type { P3AvailabilityState, P3Window } from "./availability";
import type { P3CalculationContext, P3CalculationResult, P3MetricResult } from "./context";
import { normalizeResult } from "./context";
import { persistP3Calculation, type P3PersistenceOutcome } from "./persistence";
import { resolveP3Window } from "./windows";

export const P3_RS_ALGORITHM_KEY = "relative-strength";
export const P3_RS_ALGORITHM_VERSION = "1";
export const BTC_COINGECKO_ID = "bitcoin";
export const BTC_PERPETUAL_INSTRUMENT = "BTCUSDT";
export const P3_FUTURES_PRICE_SOURCE = "binance_futures";
export const P3_MARKET_CAP_SOURCE = "coingecko";
export const MIN_VALID_RS_CONSTITUENTS = 3;

export type RSClassification = "strong_outperform" | "outperform" | "neutral" | "underperform" | "strong_underperform";

export interface FuturesCloseObservation { date: string; close: number; state?: P3AvailabilityState; reason?: string }
export interface RSConstituentInput {
  coinId: number;
  instrument: string | null;
  marketCapAvailable: boolean;
  prices: readonly FuturesCloseObservation[];
}
export interface RSBenchmarkInput { coinId: number | null; instrument: string | null; prices: readonly FuturesCloseObservation[] }
export interface ReturnResult {
  value: number | null;
  state: P3AvailabilityState;
  reason?: string;
  startPrice: number | null;
  endPrice: number | null;
  startDate: string | null;
  endDate: string | null;
}
export interface RSWindowResult {
  window: P3Window;
  narrativeReturn: ReturnResult;
  btcReturn: ReturnResult;
  relativeStrength: number | null;
  state: P3AvailabilityState;
  classification: RSClassification | null;
  validConstituents: number;
  excludedConstituents: Array<{ coinId: number; reason: string }>;
}

const WINDOWS: readonly P3Window[] = ["1D", "3D", "7D", "14D"];
const DAY = 86400000;

function dateLabel(date: Date): string { return date.toISOString().slice(0, 10); }
function isCanonicalUsdtPerpetual(instrument: string | null): instrument is string {
  return instrument != null && /^[A-Z0-9]+USDT$/.test(instrument);
}
function validClose(observation: FuturesCloseObservation | undefined): observation is FuturesCloseObservation {
  return observation != null && (observation.state ?? "VALID") === "VALID" && Number.isFinite(observation.close) && observation.close > 0;
}
function selectClose(prices: readonly FuturesCloseObservation[], target: Date): FuturesCloseObservation | undefined {
  const targetLabel = dateLabel(target);
  return [...prices]
    .filter((item) => item.date <= targetLabel)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
}

export function calculateAssetReturn(window: P3Window, windowEnd: Date, prices: readonly FuturesCloseObservation[]): ReturnResult {
  const resolved = resolveP3Window(window, windowEnd);
  const start = selectClose(prices, resolved.startTarget);
  const end = selectClose(prices, resolved.endTarget);
  if (!validClose(start) || !validClose(end)) {
    const state = start?.state === "STALE" || end?.state === "STALE" ? "STALE" : "INSUFFICIENT_HISTORY";
    return { value: null, state, reason: "Required perpetual-futures daily close is unavailable", startPrice: validClose(start) ? start.close : null, endPrice: validClose(end) ? end.close : null, startDate: start?.date ?? null, endDate: end?.date ?? null };
  }
  const startGap = Math.round((resolved.startTarget.getTime() - new Date(`${start.date}T00:00:00Z`).getTime()) / DAY);
  const endGap = Math.round((resolved.endTarget.getTime() - new Date(`${end.date}T00:00:00Z`).getTime()) / DAY);
  if (startGap < 0 || endGap < 0 || startGap > 1 || endGap > 1) {
    return { value: null, state: "INSUFFICIENT_HISTORY", reason: "Perpetual-futures endpoint gap exceeds one UTC day", startPrice: start.close, endPrice: end.close, startDate: start.date, endDate: end.date };
  }
  return { value: end.close / start.close - 1, state: "VALID", startPrice: start.close, endPrice: end.close, startDate: start.date, endDate: end.date };
}

export function classifyRelativeStrength(value: number): RSClassification {
  if (value >= 0.10) return "strong_outperform";
  if (value >= 0.05) return "outperform";
  if (value > -0.05) return "neutral";
  if (value >= -0.10) return "underperform";
  return "strong_underperform";
}

export function calculateRelativeStrengthWindow(window: P3Window, windowEnd: Date, constituents: readonly RSConstituentInput[], btc: RSBenchmarkInput): RSWindowResult {
  const excludedConstituents: Array<{ coinId: number; reason: string }> = [];
  const returns: number[] = [];
  for (const constituent of [...constituents].sort((a, b) => a.coinId - b.coinId)) {
    if (!constituent.marketCapAvailable) { excludedConstituents.push({ coinId: constituent.coinId, reason: "missing_market_cap" }); continue; }
    if (!isCanonicalUsdtPerpetual(constituent.instrument)) { excludedConstituents.push({ coinId: constituent.coinId, reason: "missing_canonical_usdt_perpetual" }); continue; }
    const result = calculateAssetReturn(window, windowEnd, constituent.prices);
    if (result.state !== "VALID" || result.value == null) { excludedConstituents.push({ coinId: constituent.coinId, reason: result.reason ?? result.state }); continue; }
    returns.push(result.value);
  }
  const narrativeReturn: ReturnResult = returns.length < MIN_VALID_RS_CONSTITUENTS
    ? { value: null, state: "INSUFFICIENT_HISTORY", reason: "Fewer than three eligible constituents", startPrice: null, endPrice: null, startDate: null, endDate: null }
    : { value: returns.reduce((sum, value) => sum + value, 0) / returns.length, state: "VALID", startPrice: null, endPrice: null, startDate: null, endDate: null };

  const btcReturn = btc.instrument === BTC_PERPETUAL_INSTRUMENT
    ? calculateAssetReturn(window, windowEnd, btc.prices)
    : { value: null, state: "MISSING" as const, reason: "BTC-USDT perpetual benchmark is unavailable", startPrice: null, endPrice: null, startDate: null, endDate: null };
  if (narrativeReturn.state !== "VALID" || narrativeReturn.value == null) return { window, narrativeReturn, btcReturn, relativeStrength: null, state: narrativeReturn.state, classification: null, validConstituents: returns.length, excludedConstituents };
  if (btcReturn.state !== "VALID" || btcReturn.value == null) return { window, narrativeReturn, btcReturn, relativeStrength: null, state: btcReturn.state, classification: null, validConstituents: returns.length, excludedConstituents };
  const relativeStrength = narrativeReturn.value - btcReturn.value;
  return { window, narrativeReturn, btcReturn, relativeStrength, state: "VALID", classification: classifyRelativeStrength(relativeStrength), validConstituents: returns.length, excludedConstituents };
}

function metric(name: string, result: RSWindowResult): P3MetricResult<number> { return { metric: name, value: result.relativeStrength, state: result.state, ...(result.state !== "VALID" ? { reason: result.narrativeReturn.reason ?? result.btcReturn.reason } : {}) }; }

export function calculateRelativeStrengthResult(context: P3CalculationContext, constituents: readonly RSConstituentInput[], btc: RSBenchmarkInput): P3CalculationResult {
  const results = Object.fromEntries(WINDOWS.map((window) => [window, calculateRelativeStrengthWindow(window, context.windowEnd, constituents, btc)])) as Record<P3Window, RSWindowResult>;
  const firstUnavailable = WINDOWS.map((window) => results[window]).find((item) => item.state !== "VALID");
  return normalizeResult(context, {
    availabilityState: firstUnavailable?.state ?? "VALID",
    confidence: null,
    metrics: {
      relativeStrength1d: metric("relativeStrength1d", results["1D"]),
      relativeStrength3d: metric("relativeStrength3d", results["3D"]),
      relativeStrength7d: metric("relativeStrength7d", results["7D"]),
      relativeStrength14d: metric("relativeStrength14d", results["14D"]),
    },
    explanation: { windows: results },
    provenance: {
      module: "relative_strength",
      algorithmKey: context.algorithmKey,
      algorithmVersion: context.algorithmVersion,
      benchmark: { coinId: btc.coinId, instrument: BTC_PERPETUAL_INSTRUMENT, source: P3_FUTURES_PRICE_SOURCE, field: "daily_close" },
      weightingMethod: "equal",
      weightTimestamp: "N/A",
      marketCapRole: "eligibility_only",
      minimumValidConstituents: MIN_VALID_RS_CONSTITUENTS,
      windows: results,
    },
  });
}

export async function persistRelativeStrength(context: P3CalculationContext, constituents: readonly RSConstituentInput[], btc: RSBenchmarkInput): Promise<{ result: P3CalculationResult; persistence: P3PersistenceOutcome }> {
  const result = calculateRelativeStrengthResult(context, constituents, btc);
  const persistence = await persistP3Calculation({ context, result, membershipSource: "p3_constituent_snapshot", membershipMode: context.calculationMode });
  return { result, persistence };
}

export async function loadRelativeStrengthInputs(context: P3CalculationContext): Promise<{ constituents: RSConstituentInput[]; btc: RSBenchmarkInput }> {
  const coinIds = context.constituents.map((item) => item.coinId);
  const allIds = [...new Set(coinIds)];
  const coinRows = allIds.length ? await db.select({ id: coins.id, futures: coins.binanceFuturesSymbol }).from(coins).where(inArray(coins.id, allIds)) : [];
  const btcRows = await db.select({ id: coins.id, futures: coins.binanceFuturesSymbol }).from(coins).where(eq(coins.coingeckoId, BTC_COINGECKO_ID)).limit(2);
  if (btcRows.length > 1) throw new Error("Ambiguous canonical BTC identity");
  const btc = btcRows[0];
  const idsForData = [...allIds, ...(btc ? [btc.id] : [])];
  const start = dateLabel(new Date(resolveP3Window("14D", context.windowEnd).startTarget.getTime() - DAY));
  const end = dateLabel(resolveP3Window("14D", context.windowEnd).endTarget);
  const priceRows = idsForData.length ? await db.select({ coinId: marketPriceDaily.coinId, date: marketPriceDaily.date, close: marketPriceDaily.close, source: marketPriceDaily.source }).from(marketPriceDaily).where(and(inArray(marketPriceDaily.coinId, idsForData), gte(marketPriceDaily.date, start), lte(marketPriceDaily.date, end), eq(marketPriceDaily.source, P3_FUTURES_PRICE_SOURCE))) : [];
  const capRows = allIds.length ? await db.select({ coinId: coinMetrics.coinId, marketCap: coinMetrics.marketCap }).from(coinMetrics).where(and(inArray(coinMetrics.coinId, allIds), eq(coinMetrics.source, P3_MARKET_CAP_SOURCE), lte(coinMetrics.date, end))) : [];
  const capEligible = new Set(capRows.filter((row) => row.marketCap != null && Number(row.marketCap) > 0).map((row) => row.coinId));
  const pricesFor = (coinId: number): FuturesCloseObservation[] => priceRows.filter((row) => row.coinId === coinId).map((row) => ({ date: String(row.date), close: Number(row.close) }));
  const instrumentById = new Map(coinRows.map((row) => [row.id, row.futures]));
  return {
    constituents: context.constituents.map((item) => ({ coinId: item.coinId, instrument: instrumentById.get(item.coinId) ?? null, marketCapAvailable: capEligible.has(item.coinId), prices: pricesFor(item.coinId) })),
    btc: { coinId: btc?.id ?? null, instrument: btc?.futures ?? null, prices: btc ? pricesFor(btc.id) : [] },
  };
}