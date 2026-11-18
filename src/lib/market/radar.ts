// RADAR-CORE: dữ liệu cho màn hình Market Radar.
// Nguồn: Binance Futures public REST (ticker 24h toàn market, exchangeInfo,
// klines, funding, OI history). Không cần API key.
//
// Nguyên tắc:
// - Coin ngoài DB vẫn xuất hiện; DB chỉ dùng để gắn badge/narrative.
// - Enrich sâu (klines/OI/funding) chỉ cho top N mỗi bên để giữ weight thấp.
// - Mọi enrichment null-safe: thiếu nguồn thì row vẫn hiện với metric "—".

import axios from "axios";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { coins, coinNarratives, narratives } from "@/db/schema";
import {
  fetchBinanceFuturesKlines,
  fetchBinanceFundingRate,
  fetchBinanceOIHistory,
} from "@/lib/collectors/binance";
import { computeMarketMetrics, type MarketMetrics } from "@/lib/market/metrics";
import {
  compositeScore,
  scoreForSide,
  type Bias,
  type MoverSide,
} from "@/lib/market/scoring";
import { buildSetup, type SetupLevels } from "@/lib/market/setup";
import { isEligibleTicker, listingAgeDays } from "@/lib/market/universe";
import { buildDemoSnapshot, getDemoDetail } from "@/lib/market/demo";

const FUTURES_API = "https://fapi.binance.com/fapi/v1";

export const DEFAULT_MIN_VOLUME_USD = 10_000_000;
const PER_SIDE_ENRICH = Math.min(15, Math.max(5, Number(process.env.RADAR_ENRICH_PER_SIDE ?? 10)));
const UNUSUAL_CANDIDATES = Math.min(20, Math.max(6, Number(process.env.RADAR_UNUSUAL_CANDIDATES ?? 12)));
const UNUSUAL_POOL_VOLUME_USD = 20_000_000;

export interface FuturesTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
  count?: number;
}

interface ExchangeSymbol {
  symbol: string;
  status: string;
  contractType?: string;
  baseAsset: string;
  quoteAsset: string;
  onboardDate: number;
}

export interface RadarMarketContext {
  gainers: number;
  losers: number;
  totalVolumeUsd: number;
  btcChangePct: number | null;
  universe: number;
}

export interface RadarRow {
  symbol: string;
  pair: string;
  price: number;
  changePct: number;
  quoteVolume: number;
  trades: number;
  high24h: number;
  low24h: number;
  rangePosition: number;
  distanceFromHighPct: number;
  volumeRatio7d: number | null;
  volumeZ: number | null;
  atrPct: number | null;
  changeAtrMultiple: number | null;
  rsi14: number | null;
  fundingRate: number | null;
  oiChangePct: number | null;
  listingAgeDays: number | null;
  isBreakout7d: boolean;
  rangePct7d: number | null;
  high7d: number | null;
  inSystem: boolean;
  narratives: string[];
  bias: Bias;
  label: string;
  score: number;
  entryQuality: number;
  composite: number;
  reasons: string[];
  warnings: string[];
}

export interface RadarSnapshot {
  side: MoverSide;
  rows: RadarRow[];
  market: RadarMarketContext;
  collectedAt: string;
  /** true khi RADAR_DEMO=1 và dữ liệu là mẫu, không phải Binance thật. */
  demo?: boolean;
  notice?: string;
}

export interface RadarDetail {
  row: RadarRow;
  setup: SetupLevels | null;
  chart: { t: number; o: number; h: number; l: number; c: number }[];
  asOf: string;
}

const tickerCache: { value: FuturesTicker[]; expires: number } = { value: [], expires: 0 };
let tickerInflight: Promise<FuturesTicker[]> | null = null;

export async function fetchFuturesTickers(): Promise<FuturesTicker[]> {
  if (tickerCache.expires > Date.now() && tickerCache.value.length > 0) return tickerCache.value;
  if (tickerInflight) return tickerInflight;

  tickerInflight = (async () => {
    try {
      const response = await axios.get(`${FUTURES_API}/ticker/24hr`, { timeout: 15_000 });
      if (!Array.isArray(response.data)) throw new Error("Unexpected ticker payload");
      const tickers = response.data as FuturesTicker[];
      tickerCache.value = tickers;
      tickerCache.expires = Date.now() + 45_000;
      return tickers;
    } finally {
      tickerInflight = null;
    }
  })();

  return tickerInflight;
}

const infoCache: { value: Map<string, ExchangeSymbol>; expires: number } = {
  value: new Map(),
  expires: 0,
};
let infoInflight: Promise<Map<string, ExchangeSymbol>> | null = null;

async function fetchExchangeSymbols(): Promise<Map<string, ExchangeSymbol>> {
  if (infoCache.expires > Date.now() && infoCache.value.size > 0) return infoCache.value;
  if (infoInflight) return infoInflight;

  infoInflight = (async () => {
    try {
      const response = await axios.get(`${FUTURES_API}/exchangeInfo`, { timeout: 15_000 });
      const list = Array.isArray(response.data?.symbols)
        ? (response.data.symbols as ExchangeSymbol[])
        : [];
      const map = new Map(list.map((s) => [s.symbol, s]));
      infoCache.value = map;
      infoCache.expires = Date.now() + 30 * 60_000;
      return map;
    } finally {
      infoInflight = null;
    }
  })();

  return infoInflight;
}

// ─── System membership (badge only, never a filter) ─────

interface SystemCoin {
  narratives: string[];
}

const systemCache: { value: Map<string, SystemCoin>; expires: number } = {
  value: new Map(),
  expires: 0,
};
let systemInflight: Promise<Map<string, SystemCoin>> | null = null;

export async function getSystemCoins(): Promise<Map<string, SystemCoin>> {
  if (systemCache.expires > Date.now()) return systemCache.value;
  if (systemInflight) return systemInflight;

  systemInflight = (async () => {
    try {
      const rows = await db
        .select({
          symbol: coins.symbol,
          futuresSymbol: coins.binanceFuturesSymbol,
          narrative: narratives.name,
        })
        .from(coins)
        .leftJoin(coinNarratives, eq(coinNarratives.coinId, coins.id))
        .leftJoin(narratives, eq(narratives.id, coinNarratives.narrativeId))
        .where(eq(coins.isActive, true));

      const map = new Map<string, SystemCoin>();
      for (const row of rows) {
        const keys = [row.symbol, row.futuresSymbol]
          .filter((s): s is string => Boolean(s))
          .map((s) => s.toUpperCase().replace(/USDT$/, ""));
        for (const key of keys) {
          const existing = map.get(key) ?? { narratives: [] };
          if (row.narrative && !existing.narratives.includes(row.narrative)) {
            existing.narratives.push(row.narrative);
          }
          map.set(key, existing);
        }
      }
      systemCache.value = map;
      systemCache.expires = Date.now() + 5 * 60_000;
      return map;
    } catch (error) {
      console.warn(
        "[RADAR] Không đọc được coins/narratives — badge hệ thống tạm trống:",
        error instanceof Error ? error.message : String(error)
      );
      systemCache.value = new Map();
      systemCache.expires = Date.now() + 60_000;
      return systemCache.value;
    } finally {
      systemInflight = null;
    }
  })();

  return systemInflight;
}

// ─── Helpers ────────────────────────────────────────────

function minVolumeDefault(): number {
  const raw = Number(process.env.RADAR_MIN_VOLUME_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MIN_VOLUME_USD;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function toRow(
  ticker: FuturesTicker,
  metrics: MarketMetrics,
  side: MoverSide,
  system: Map<string, SystemCoin>
): RadarRow {
  const symbol = ticker.symbol.replace(/USDT$/, "");
  const score = scoreForSide(metrics, side);
  const membership = system.get(symbol);

  return {
    symbol,
    pair: ticker.symbol,
    price: metrics.price,
    changePct: metrics.changePct,
    quoteVolume: metrics.quoteVolume,
    trades: metrics.trades,
    high24h: metrics.high24h,
    low24h: metrics.low24h,
    rangePosition: metrics.rangePosition,
    distanceFromHighPct: metrics.distanceFromHighPct,
    volumeRatio7d: metrics.volumeRatio7d,
    volumeZ: metrics.volumeZ,
    atrPct: metrics.atrPct,
    changeAtrMultiple: metrics.changeAtrMultiple,
    rsi14: metrics.rsi14,
    fundingRate: metrics.fundingRate,
    oiChangePct: metrics.oiChangePct,
    listingAgeDays: metrics.listingAgeDays,
    isBreakout7d: metrics.isBreakout7d,
    rangePct7d: metrics.rangePct7d,
    high7d: metrics.high7d,
    inSystem: Boolean(membership),
    narratives: membership?.narratives.slice(0, 3) ?? [],
    bias: score.bias,
    label: score.label,
    score: score.score,
    entryQuality: score.entryQuality,
    composite: compositeScore(score.score, score.entryQuality),
    reasons: score.reasons,
    warnings: score.warnings,
  };
}

async function enrichTicker(
  ticker: FuturesTicker,
  meta: ExchangeSymbol | undefined,
  side: MoverSide,
  system: Map<string, SystemCoin>
): Promise<RadarRow> {
  const [daily, h4, funding, oi] = await Promise.all([
    fetchBinanceFuturesKlines(ticker.symbol, 30, "1d").catch(() => []),
    fetchBinanceFuturesKlines(ticker.symbol, 120, "4h").catch(() => []),
    fetchBinanceFundingRate(ticker.symbol).catch(() => null),
    fetchBinanceOIHistory(ticker.symbol, "1h", 25).catch(() => []),
  ]);

  const metrics = computeMarketMetrics({
    price: Number(ticker.lastPrice),
    changePct: Number(ticker.priceChangePercent),
    quoteVolume: Number(ticker.quoteVolume),
    trades: Number(ticker.count ?? 0),
    high24h: Number(ticker.highPrice),
    low24h: Number(ticker.lowPrice),
    dailyCandles: daily,
    h4Candles: h4,
    fundingRate: funding,
    oiHistory: oi,
    listingAgeDays: listingAgeDays(meta?.onboardDate),
  });

  return toRow(ticker, metrics, side, system);
}

// ─── Snapshot ───────────────────────────────────────────

const snapshotCache = new Map<string, { expires: number; promise: Promise<RadarSnapshot> }>();

function buildMarket(tickers: FuturesTicker[], eligible: FuturesTicker[]): RadarMarketContext {
  const usdt = tickers.filter((t) => /^[A-Z0-9]{2,15}USDT$/.test(t.symbol));
  let gainers = 0;
  let losers = 0;
  for (const t of eligible) {
    const change = Number(t.priceChangePercent);
    if (change > 0) gainers += 1;
    else if (change < 0) losers += 1;
  }
  return {
    gainers,
    losers,
    totalVolumeUsd: usdt.reduce((sum, t) => sum + (Number(t.quoteVolume) || 0), 0),
    btcChangePct: (() => {
      const btc = tickers.find((t) => t.symbol === "BTCUSDT");
      const change = btc ? Number(btc.priceChangePercent) : NaN;
      return Number.isFinite(change) ? change : null;
    })(),
    universe: eligible.length,
  };
}

async function buildSnapshot(side: MoverSide, minVolume: number): Promise<RadarSnapshot> {
  const [tickers, info, system] = await Promise.all([
    fetchFuturesTickers(),
    fetchExchangeSymbols(),
    getSystemCoins(),
  ]);

  const eligible = tickers.filter((t) => isEligibleTicker(t, info.get(t.symbol), minVolume));

  if (eligible.length < 10) {
    throw new Error("Binance trả quá ít symbol hợp lệ — thử lại sau.");
  }

  const market = buildMarket(tickers, eligible);
  const byChangeDesc = [...eligible].sort(
    (a, b) =>
      Number(b.priceChangePercent) - Number(a.priceChangePercent) ||
      Number(b.quoteVolume) - Number(a.quoteVolume)
  );
  const byChangeAsc = [...eligible].sort(
    (a, b) =>
      Number(a.priceChangePercent) - Number(b.priceChangePercent) ||
      Number(b.quoteVolume) - Number(a.quoteVolume)
  );

  let chosen: FuturesTicker[] = [];
  if (side === "gainer") chosen = byChangeDesc.slice(0, PER_SIDE_ENRICH);
  else if (side === "loser") chosen = byChangeAsc.slice(0, PER_SIDE_ENRICH);
  else {
    const taken = new Set([
      ...byChangeDesc.slice(0, PER_SIDE_ENRICH).map((t) => t.symbol),
      ...byChangeAsc.slice(0, PER_SIDE_ENRICH).map((t) => t.symbol),
    ]);
    const pool = eligible
      .filter(
        (t) =>
          Math.abs(Number(t.priceChangePercent)) <= 8 &&
          Number(t.quoteVolume) >= Math.max(minVolume, UNUSUAL_POOL_VOLUME_USD) &&
          !taken.has(t.symbol)
      )
      .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
      .slice(0, UNUSUAL_CANDIDATES);
    chosen = pool;
  }

  const rows = await mapLimit(chosen, 8, (ticker) =>
    enrichTicker(ticker, info.get(ticker.symbol), side, system).catch((error) => {
      console.warn(
        `[RADAR] Enrich ${ticker.symbol} lỗi:`,
        error instanceof Error ? error.message : String(error)
      );
      return null;
    })
  );

  const clean = rows.filter((r): r is RadarRow => r !== null);
  const filtered =
    side === "unusual"
      ? clean.filter(
          (r) =>
            (r.volumeZ !== null && r.volumeZ >= 2) ||
            ((r.volumeRatio7d ?? 0) >= 2.2 && (r.oiChangePct ?? 0) >= 2)
        )
      : clean;

  filtered.sort((a, b) => b.composite - a.composite || Math.abs(b.changePct) - Math.abs(a.changePct));

  return {
    side,
    rows: filtered,
    market,
    collectedAt: new Date().toISOString(),
  };
}

export type RadarSort = "composite" | "change" | "volume" | "fresh";

export interface RadarQuery {
  side?: MoverSide;
  limit?: number;
  minVolume?: number;
  excludeSystem?: boolean;
  sort?: RadarSort;
}

function shapeSnapshot(snapshot: RadarSnapshot, query: RadarQuery): RadarSnapshot {
  const limit = Math.min(30, Math.max(5, query.limit ?? 15));
  const sort = query.sort ?? "composite";
  const rows = snapshot.rows
    .filter((r) => !query.excludeSystem || !r.inSystem)
    .sort((a, b) => {
      if (sort === "change") return Math.abs(b.changePct) - Math.abs(a.changePct);
      if (sort === "volume") return b.quoteVolume - a.quoteVolume;
      if (sort === "fresh") return b.entryQuality - a.entryQuality;
      return b.composite - a.composite;
    })
    .slice(0, limit);
  return { ...snapshot, rows };
}

export async function getRadarSnapshot(query: RadarQuery = {}): Promise<RadarSnapshot> {
  const side = query.side ?? "gainer";
  const minVolume = query.minVolume && query.minVolume > 0 ? query.minVolume : minVolumeDefault();

  if (process.env.RADAR_DEMO === "1") {
    return shapeSnapshot(buildDemoSnapshot(side), query);
  }

  const key = `${side}|${minVolume}`;
  const cached = snapshotCache.get(key);
  let entry = cached;
  if (!entry || entry.expires <= Date.now()) {
    const promise = buildSnapshot(side, minVolume);
    entry = { expires: Date.now() + 60_000, promise };
    snapshotCache.set(key, entry);
    promise.catch(() => {
      if (snapshotCache.get(key) === entry) snapshotCache.delete(key);
    });
  }

  return shapeSnapshot(await entry.promise, query);
}

// ─── Detail ─────────────────────────────────────────────

const detailCache = new Map<string, { expires: number; promise: Promise<RadarDetail | null> }>();

export function normalizeSymbol(raw: string): string {
  return raw.toUpperCase().replace(/^\$/, "").replace(/USDT$/, "").replace(/[^A-Z0-9]/g, "");
}

export async function getMoverDetail(rawSymbol: string): Promise<RadarDetail | null> {
  const symbol = normalizeSymbol(rawSymbol);
  if (!/^[A-Z0-9]{2,15}$/.test(symbol)) return null;
  if (process.env.RADAR_DEMO === "1") return getDemoDetail(symbol);
  const pair = `${symbol}USDT`;

  const cached = detailCache.get(pair);
  if (cached && cached.expires > Date.now()) return cached.promise;

  const promise = (async (): Promise<RadarDetail | null> => {
    const [tickers, info, system] = await Promise.all([
      fetchFuturesTickers(),
      fetchExchangeSymbols(),
      getSystemCoins(),
    ]);
    const ticker = tickers.find((t) => t.symbol === pair);
    if (!ticker) return null;

    const [daily, h4, funding, oi] = await Promise.all([
      fetchBinanceFuturesKlines(pair, 30, "1d").catch(() => []),
      fetchBinanceFuturesKlines(pair, 120, "4h").catch(() => []),
      fetchBinanceFundingRate(pair).catch(() => null),
      fetchBinanceOIHistory(pair, "1h", 25).catch(() => []),
    ]);

    const metrics = computeMarketMetrics({
      price: Number(ticker.lastPrice),
      changePct: Number(ticker.priceChangePercent),
      quoteVolume: Number(ticker.quoteVolume),
      trades: Number(ticker.count ?? 0),
      high24h: Number(ticker.highPrice),
      low24h: Number(ticker.lowPrice),
      dailyCandles: daily,
      h4Candles: h4,
      fundingRate: funding,
      oiHistory: oi,
      listingAgeDays: listingAgeDays(info.get(pair)?.onboardDate),
    });

    const change = metrics.changePct;
    const side: MoverSide = change > 2 ? "gainer" : change < -2 ? "loser" : "unusual";
    const row = toRow(ticker, metrics, side, system);

    const bullish: Bias[] = ["continuation", "flush-bounce", "breakout", "accumulation"];
    const bearish: Bias[] = ["exhaustion", "breakdown"];
    const atrValue = metrics.atrPct ? (metrics.price * metrics.atrPct) / 100 : null;
    const setup =
      atrValue && atrValue > 0 && (bullish.includes(row.bias) || bearish.includes(row.bias))
        ? buildSetup(bullish.includes(row.bias) ? "BULLISH" : "BEARISH", metrics.price, atrValue)
        : null;

    return {
      row,
      setup,
      chart: h4.slice(-60).map((k) => ({
        t: k.openTime,
        o: Number(k.open),
        h: Number(k.high),
        l: Number(k.low),
        c: Number(k.close),
      })),
      asOf: new Date().toISOString(),
    };
  })();

  detailCache.set(pair, { expires: Date.now() + 45_000, promise });
  promise.catch(() => detailCache.delete(pair));
  return promise;
}
