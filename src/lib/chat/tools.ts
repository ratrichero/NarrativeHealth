// CHAT-P2: Tool registry for the chatbot — 8 DB tools + 4 Binance realtime tools.
// Every tool returns a compact JSON-safe object; the orchestrator serializes the
// result into the LLM conversation as the tool role message.

import { db } from "@/db";
import {
  coins,
  healthScores,
  recommendations,
  features,
  narratives,
  narrativeHealth,
  coinNarratives,
  marketPriceDaily,
  indicators,
  coinMetrics,
} from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  fetchBinanceFuturesCurrentPrice,
  fetchBinanceCurrentPrice,
  fetchBinanceFuturesMetrics,
  fetchBinanceGlobalLongShortRatio,
  fetchBinanceTopLongShortRatio,
  fetchBinanceFuturesKlines,
  fetchBinanceOIHistory,
  type BinanceInterval,
} from "@/lib/collectors/binance";

// ─── Helpers ────────────────────────────────────────────

/** Freshest date that has health data — same "freshest wins" as dashboard. */
async function getFreshestHealthDate(): Promise<string | null> {
  const [row] = await db
    .select({ date: healthScores.date })
    .from(healthScores)
    .orderBy(desc(healthScores.date))
    .limit(1);
  return row?.date ?? null;
}

interface CoinLookup {
  id: number;
  symbol: string;
  binanceSpotSymbol: string | null;
  binanceFuturesSymbol: string | null;
  hasFutures: boolean;
}

async function lookupCoin(symbol: string): Promise<CoinLookup | null> {
  const [coin] = await db
    .select({
      id: coins.id,
      symbol: coins.symbol,
      binanceSpotSymbol: coins.binanceSpotSymbol,
      binanceFuturesSymbol: coins.binanceFuturesSymbol,
      hasFutures: coins.hasFutures,
    })
    .from(coins)
    .where(eq(coins.symbol, symbol.toUpperCase()))
    .limit(1);
  return coin ?? null;
}

/** ATR(14) from daily rows — EWM span=14, same as top-recommendations route. */
function computeAtr(rows: { high: string; low: string; close: string }[]): number | null {
  if (rows.length < 15) return null;
  const tr: number[] = rows.map((d, i) => {
    const high = parseFloat(d.high);
    const low = parseFloat(d.low);
    const close = parseFloat(d.close);
    if (i === 0) return high - low;
    const prevClose = parseFloat(rows[i - 1].close);
    return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  });
  const alpha = 2 / 15;
  let emaVal = tr[0];
  for (let i = 1; i < tr.length; i++) emaVal = alpha * tr[i] + (1 - alpha) * emaVal;
  return Number.isFinite(emaVal) && emaVal > 0 ? emaVal : null;
}

interface SetupLevels {
  direction: "BULLISH" | "BEARISH";
  entryLow: number;
  entryHigh: number;
  tp1: number;
  tp2: number;
  stopLoss: number;
  riskRewardRatio: number | null;
}

function buildSetup(direction: "BULLISH" | "BEARISH", price: number, atr: number): SetupLevels {
  const sign = direction === "BULLISH" ? 1 : -1;
  const eLow = +(price - atr * 0.5 * sign).toFixed(6);
  const eHigh = +(price + atr * 0.5 * sign).toFixed(6);
  const mid = (Math.min(eLow, eHigh) + Math.max(eLow, eHigh)) / 2;
  const t1 = +(mid + sign * atr * 1.5).toFixed(6);
  const t2 = +(mid + sign * atr * 3).toFixed(6);
  const sl = +(mid - sign * atr * 1.5).toFixed(6);
  const risk = Math.abs(mid - sl);
  const reward = Math.abs(t1 - mid);
  return {
    direction,
    entryLow: Math.min(eLow, eHigh),
    entryHigh: Math.max(eLow, eHigh),
    tp1: t1,
    tp2: t2,
    stopLoss: sl,
    riskRewardRatio: risk > 0 ? +(reward / risk).toFixed(1) : null,
  };
}

// ─── Simple TTL cache for Binance calls ─────────────────

const cache = new Map<string, { value: unknown; expires: number }>();
const CACHE_TTL_MS = 45_000;

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  if (hit) cache.delete(key);
  return null;
}

function cacheSet(key: string, value: unknown): void {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

// ─── Symbol resolution (DB first, then Binance direct) ──

interface ResolvedSymbol {
  spotSymbol: string | null;
  futuresSymbol: string | null;
  source: "db" | "binance-direct" | "not-found";
  coinId: number | null;
}

/**
 * Resolve a user-facing symbol to Binance pairs.
 * CHỐT 2026-09-19: coins not present in the DB are resolved DIRECTLY against
 * Binance exchangeInfo so the bot can answer for any Binance-listed coin.
 */
async function resolveSymbol(rawSymbol: string): Promise<ResolvedSymbol> {
  const symbol = rawSymbol.toUpperCase().replace(/^\$/, "").replace(/USDT$/, "");

  // 1) DB lookup first
  const coin = await lookupCoin(symbol);
  if (coin) {
    return {
      spotSymbol: coin.binanceSpotSymbol ?? `${symbol}USDT`,
      futuresSymbol: coin.hasFutures ? coin.binanceFuturesSymbol ?? `${symbol}USDT` : null,
      source: "db",
      coinId: coin.id,
    };
  }

  // 2) Unknown coin → direct Binance exchangeInfo probe (cached)
  const cacheKey = `resolve:${symbol}`;
  const cached = cacheGet<ResolvedSymbol>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo", {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        symbols: { symbol: string; status: string; contractType: string }[];
      };
      const pair = `${symbol}USDT`;
      const found = data.symbols.find(
        (s) => s.symbol === pair && s.status === "TRADING" && s.contractType === "PERPETUAL"
      );
      const resolved: ResolvedSymbol = found
        ? { spotSymbol: pair, futuresSymbol: pair, source: "binance-direct", coinId: null }
        : { spotSymbol: pair, futuresSymbol: null, source: "binance-direct", coinId: null };
      cacheSet(cacheKey, resolved);
      return resolved;
    }
  } catch {
    // fall through to not-found
  }

  return { spotSymbol: null, futuresSymbol: null, source: "not-found", coinId: null };
}

// ─── Tool implementations (DB) ──────────────────────────

async function getCoinHealth(symbol: string) {
  const coin = await lookupCoin(symbol);
  if (!coin) return { error: `Không tìm thấy coin '${symbol}' trong hệ thống.` };
  const date = await getFreshestHealthDate();
  if (!date) return { error: "Chưa có dữ liệu health trong hệ thống." };

  const [hs] = await db
    .select()
    .from(healthScores)
    .where(and(eq(healthScores.coinId, coin.id), eq(healthScores.date, date)))
    .limit(1);
  if (!hs) return { error: `Chưa có health score cho ${coin.symbol} ngày ${date}.` };

  const [rec] = await db
    .select()
    .from(recommendations)
    .where(and(eq(recommendations.coinId, coin.id), eq(recommendations.date, date)))
    .limit(1);

  return {
    symbol: coin.symbol,
    date,
    healthScore: hs.healthScore,
    scoreChange: hs.scoreChange,
    signal: rec?.signal ?? null,
    reason: rec?.reason ?? null,
  };
}

async function getCoinMetrics(symbol: string) {
  const coin = await lookupCoin(symbol);
  if (!coin) return { error: `Không tìm thấy coin '${symbol}' trong hệ thống.` };
  const date = await getFreshestHealthDate();
  if (!date) return { error: "Chưa có dữ liệu trong hệ thống." };

  const [feat] = await db
    .select()
    .from(features)
    .where(and(eq(features.coinId, coin.id), eq(features.date, date)))
    .limit(1);

  const indRows = await db
    .select({ type: indicators.indicatorType, value: indicators.indicatorValue })
    .from(indicators)
    .where(and(eq(indicators.coinId, coin.id), eq(indicators.date, date), eq(indicators.timeframe, "1d")));

  const [metric] = await db
    .select()
    .from(coinMetrics)
    .where(and(eq(coinMetrics.coinId, coin.id), eq(coinMetrics.date, date)))
    .limit(1);

  const ind = Object.fromEntries(indRows.map((r) => [r.type, r.value != null ? parseFloat(r.value) : null]));

  return {
    symbol: coin.symbol,
    date,
    trendScore: feat?.trendScore ?? null,
    volumeScore: feat?.volumeScore ?? null,
    momentumScore: feat?.momentumScore ?? null,
    rsi14: ind.RSI_14 ?? null,
    ema20: ind.EMA_21 ?? null,
    atr14: ind.ATR_14 ?? null,
    fundingRate: metric?.fundingRate != null ? parseFloat(String(metric.fundingRate)) : null,
    openInterest: metric?.openInterest != null ? parseFloat(String(metric.openInterest)) : null,
    source: "db",
  };
}

async function getSetupLevels(symbol: string) {
  const coin = await lookupCoin(symbol);
  if (!coin) return { error: `Không tìm thấy coin '${symbol}' trong hệ thống.` };
  const date = await getFreshestHealthDate();
  if (!date) return { error: "Chưa có dữ liệu trong hệ thống." };

  const [hs] = await db
    .select()
    .from(healthScores)
    .where(and(eq(healthScores.coinId, coin.id), eq(healthScores.date, date)))
    .limit(1);
  if (!hs) return { error: `Chưa có health score cho ${coin.symbol} ngày ${date}.` };

  // Price: DB daily close for the data date
  const [priceRow] = await db
    .select({ close: marketPriceDaily.close })
    .from(marketPriceDaily)
    .where(and(eq(marketPriceDaily.coinId, coin.id), eq(marketPriceDaily.date, date)))
    .limit(1);
  const price = priceRow ? parseFloat(priceRow.close) : 0;
  if (price <= 0) return { error: `Không có giá cho ${coin.symbol} ngày ${date}.` };

  // ATR: indicators table first, fallback computed from price history
  const [atrRow] = await db
    .select({ value: indicators.indicatorValue })
    .from(indicators)
    .where(
      and(
        eq(indicators.coinId, coin.id),
        eq(indicators.date, date),
        eq(indicators.timeframe, "1d"),
        eq(indicators.indicatorType, "ATR_14")
      )
    )
    .limit(1);
  let atr = atrRow?.value ? parseFloat(atrRow.value) : null;
  if (!atr || atr <= 0) {
    const hist = await db
      .select({ high: marketPriceDaily.high, low: marketPriceDaily.low, close: marketPriceDaily.close })
      .from(marketPriceDaily)
      .where(eq(marketPriceDaily.coinId, coin.id))
      .orderBy(desc(marketPriceDaily.date))
      .limit(30);
    atr = computeAtr(hist);
  }
  if (!atr) return { error: `Chưa đủ dữ liệu ATR cho ${coin.symbol}.` };

  const direction = hs.healthScore >= 50 ? "BULLISH" : "BEARISH";
  const setup = buildSetup(direction, price, atr);
  return { symbol: coin.symbol, date, price, ...setup, note: "Mức advisory từ ATR — không phải lệnh giao dịch." };
}

async function getNarrativeHealth(name: string) {
  const date = await getFreshestHealthDate();
  if (!date) return { error: "Chưa có dữ liệu trong hệ thống." };

  const [narr] = await db
    .select()
    .from(narratives)
    .where(sql`UPPER(${narratives.name}) = ${name.toUpperCase()}`)
    .limit(1);
  if (!narr) return { error: `Không tìm thấy narrative '${name}'.` };

  const [nh] = await db
    .select()
    .from(narrativeHealth)
    .where(and(eq(narrativeHealth.narrativeId, narr.id), eq(narrativeHealth.date, date)))
    .limit(1);
  if (!nh) return { error: `Chưa có narrative health cho ${narr.name} ngày ${date}.` };

  // Breadth: coins up vs down inside the narrative
  const breadthRows = await db
    .select({
      symbol: coins.symbol,
      score: healthScores.healthScore,
      change: healthScores.scoreChange,
    })
    .from(coinNarratives)
    .innerJoin(healthScores, and(eq(healthScores.coinId, coinNarratives.coinId), eq(healthScores.date, date)))
    .innerJoin(coins, eq(coins.id, coinNarratives.coinId))
    .where(eq(coinNarratives.narrativeId, narr.id));

  const up = breadthRows.filter((r) => (r.change ?? 0) > 0).length;
  return {
    narrative: narr.name,
    date,
    healthScore: nh.healthScore,
    scoreChange: nh.scoreChange,
    coinCount: breadthRows.length,
    breadth: `${up}/${breadthRows.length} coins đang tăng`,
    topCoins: breadthRows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3).map((r) => r.symbol),
  };
}

async function getTopRecommendations() {
  const date = await getFreshestHealthDate();
  if (!date) return { error: "Chưa có dữ liệu trong hệ thống." };

  const rows = await db
    .select({
      symbol: coins.symbol,
      healthScore: healthScores.healthScore,
      scoreChange: healthScores.scoreChange,
      signal: recommendations.signal,
      trend: features.trendScore,
      momentum: features.momentumScore,
    })
    .from(healthScores)
    .innerJoin(coins, eq(coins.id, healthScores.coinId))
    .leftJoin(recommendations, and(eq(recommendations.coinId, healthScores.coinId), eq(recommendations.date, date)))
    .leftJoin(features, and(eq(features.coinId, healthScores.coinId), eq(features.date, date)))
    .where(and(eq(healthScores.date, date), eq(coins.isActive, true)));

  const scored = rows
    .map((r) => ({
      ...r,
      composite:
        (r.healthScore ?? 0) * 0.4 + (r.trend ?? 50) * 0.35 + (r.momentum ?? 50) * 0.15,
    }))
    .sort((a, b) => b.composite - a.composite)
    .slice(0, 3);

  return { date, topCoins: scored };
}

async function compareCoins(a: string, b: string) {
  const [ha, hb] = await Promise.all([getCoinHealth(a), getCoinHealth(b)]);
  const [ma, mb] = await Promise.all([getCoinMetrics(a), getCoinMetrics(b)]);
  return { coinA: { health: ha, metrics: ma }, coinB: { health: hb, metrics: mb } };
}

async function getPriceHistory(symbol: string, days: number) {
  const coin = await lookupCoin(symbol);
  if (!coin) return { error: `Không tìm thấy coin '${symbol}' trong hệ thống.` };
  const capped = Math.min(Math.max(days || 14, 3), 60);
  const rows = await db
    .select({ date: marketPriceDaily.date, close: marketPriceDaily.close })
    .from(marketPriceDaily)
    .where(eq(marketPriceDaily.coinId, coin.id))
    .orderBy(desc(marketPriceDaily.date))
    .limit(capped);
  return {
    symbol: coin.symbol,
    history: rows.reverse().map((r) => ({ date: r.date, close: parseFloat(r.close) })),
  };
}

async function getNarrativeLeaders(name: string) {
  const nh = await getNarrativeHealth(name);
  if ("error" in nh) return nh;
  return { narrative: nh.narrative, date: nh.date, leaders: nh.topCoins, breadth: nh.breadth };
}

// ─── Compute-heavy analysis (P5) ────────────────────────

interface ComputeResult {
  symbol: string;
  window: { days: number; from: string; to: string };
  price: { start: number; end: number; min: number; max: number };
  periodReturnPct: number;
  annualizedVolatilityPct: number;
  maxDrawdownPct: number;
  maxDrawdownDate: string;
  benchmark?: { symbol: string; correlation: number; read: string };
}

/**
 * P5: heavy numeric analysis. Tries the FastAPI compute endpoint (pandas)
 * first; falls back to a lean pure-TS implementation when FastAPI is down
 * (the lesson from the FastAPI self-lock incident: never hard-depend on it).
 */
async function getCoinAnalysis(symbol: string, days: number, benchmark: string) {
  const capped = Math.min(Math.max(days || 60, 10), 180);
  const base = process.env.FASTAPI_URL || "http://localhost:8000";

  // 1) FastAPI (pandas) — preferred
  try {
    const res = await fetch(
      `${base}/api/compute/coin-analysis?symbol=${encodeURIComponent(symbol)}&days=${capped}&benchmark=${encodeURIComponent(benchmark)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const data = await res.json();
      if (!data.error) return { ...data, engine: "fastapi-pandas" };
    }
  } catch {
    // FastAPI down → TS fallback below
  }

  // 2) Pure-TS fallback from DB price history
  const coin = await lookupCoin(symbol);
  if (!coin) return { error: `Không tìm thấy coin '${symbol}' trong hệ thống.` };

  const benchCoin = await lookupCoin(benchmark);

  const [rows, benchRows] = await Promise.all([
    db
      .select({ date: marketPriceDaily.date, close: marketPriceDaily.close })
      .from(marketPriceDaily)
      .where(eq(marketPriceDaily.coinId, coin.id))
      .orderBy(desc(marketPriceDaily.date))
      .limit(capped),
    benchCoin
      ? db
          .select({ date: marketPriceDaily.date, close: marketPriceDaily.close })
          .from(marketPriceDaily)
          .where(eq(marketPriceDaily.coinId, benchCoin.id))
          .orderBy(desc(marketPriceDaily.date))
          .limit(capped)
      : Promise.resolve([]),
  ]);

  if (rows.length < 10) return { error: `Chưa đủ lịch sử giá cho ${coin.symbol} (${rows.length} ngày).` };

  const series = rows.slice().reverse().map((r) => ({ date: String(r.date), close: parseFloat(r.close) }));
  const closes = series.map((s) => s.close);
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(closes[i] / closes[i - 1] - 1);

  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const volAnnual = Math.sqrt(variance) * Math.sqrt(365) * 100;

  let peak = closes[0];
  let maxDd = 0;
  let maxDdDate = series[0].date;
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] > peak) peak = closes[i];
    const dd = (closes[i] - peak) / peak;
    if (dd < maxDd) {
      maxDd = dd;
      maxDdDate = series[i].date;
    }
  }

  const result: ComputeResult & { engine: string } = {
    symbol: coin.symbol,
    window: { days: series.length, from: series[0].date, to: series[series.length - 1].date },
    price: {
      start: closes[0],
      end: closes[closes.length - 1],
      min: Math.min(...closes),
      max: Math.max(...closes),
    },
    periodReturnPct: +(((closes[closes.length - 1] / closes[0] - 1) * 100).toFixed(2)),
    annualizedVolatilityPct: +(volAnnual.toFixed(1)),
    maxDrawdownPct: +(maxDd * 100).toFixed(2),
    maxDrawdownDate: maxDdDate,
    engine: "ts-fallback",
  };

  // Correlation vs benchmark when overlapping dates exist
  if (benchRows.length >= 10) {
    const benchMap = new Map(benchRows.map((r) => [String(r.date), parseFloat(r.close)]));
    const common = series.filter((s) => benchMap.has(s.date));
    if (common.length >= 10) {
      const ra: number[] = [];
      const rb: number[] = [];
      for (let i = 1; i < common.length; i++) {
        ra.push(common[i].close / common[i - 1].close - 1);
        rb.push(benchMap.get(common[i].date)! / benchMap.get(common[i - 1].date)! - 1);
      }
      const ma = ra.reduce((a, b) => a + b, 0) / ra.length;
      const mb = rb.reduce((a, b) => a + b, 0) / rb.length;
      const cov = ra.reduce((acc, v, i) => acc + (v - ma) * (rb[i] - mb), 0);
      const sa = Math.sqrt(ra.reduce((acc, v) => acc + (v - ma) ** 2, 0));
      const sb = Math.sqrt(rb.reduce((acc, v) => acc + (v - mb) ** 2, 0));
      const corr = sa > 0 && sb > 0 ? +(cov / (sa * sb)).toFixed(3) : null;
      if (corr !== null) {
        result.benchmark = {
          symbol: benchCoin?.symbol ?? benchmark.toUpperCase(),
          correlation: corr,
          read:
            corr > 0.7 ? "di chuyển cùng chiều mạnh"
            : corr > 0.3 ? "cùng chiều yếu"
            : corr > -0.3 ? "độc lập tương đối"
            : corr > -0.7 ? "ngược chiều"
            : "ngược chiều mạnh",
        };
      }
    }
  }

  return result;
}

// ─── Tool implementations (Binance realtime) ────────────

function geoBlockMessage(): { error: string } {
  return { error: "Binance API không khả dụng từ vùng này (geo-block). Hãy dùng dữ liệu DB nếu có." };
}

async function getLivePrice(symbol: string) {
  const resolved = await resolveSymbol(symbol);
  if (resolved.source === "not-found")
    return { error: `Không tìm thấy symbol '${symbol}' trên Binance.` };

  const cacheKey = `price:${symbol}`;
  const cached = cacheGet<Record<string, unknown>>(cacheKey);
  if (cached) return cached;

  const out: Record<string, unknown> = { symbol: symbol.toUpperCase(), source: resolved.source };

  if (resolved.futuresSymbol) {
    const fp = await fetchBinanceFuturesCurrentPrice(resolved.futuresSymbol);
    if (fp != null) out.futuresPrice = fp;
  }
  if (out.futuresPrice === undefined && resolved.spotSymbol) {
    const sp = await fetchBinanceCurrentPrice(resolved.spotSymbol);
    if (sp != null) out.spotPrice = sp;
  }
  if (out.futuresPrice === undefined && out.spotPrice === undefined)
    return { error: `Không lấy được giá cho ${symbol} từ Binance lúc này (có thể do geo-block).` };

  cacheSet(cacheKey, out);
  return out;
}

async function getFuturesSnapshot(symbol: string) {
  const resolved = await resolveSymbol(symbol);
  if (resolved.source === "not-found")
    return { error: `Không tìm thấy symbol '${symbol}' trên Binance.` };
  if (!resolved.futuresSymbol)
    return { error: `${symbol.toUpperCase()} không có hợp đồng futures trên Binance — dùng get_live_price để lấy giá spot.` };

  const cacheKey = `snapshot:${symbol}`;
  const cached = cacheGet<Record<string, unknown>>(cacheKey);
  if (cached) return cached;

  const [metrics, globalLs, topLs] = await Promise.all([
    fetchBinanceFuturesMetrics(resolved.futuresSymbol),
    fetchBinanceGlobalLongShortRatio(resolved.futuresSymbol).catch(() => null),
    fetchBinanceTopLongShortRatio(resolved.futuresSymbol).catch(() => null),
  ]);
  if (metrics.openInterest == null && metrics.fundingRate == null)
    return { error: `Không lấy được futures snapshot cho ${symbol} lúc này (có thể do geo-block).` };
  const out = {
    symbol: resolved.futuresSymbol,
    source: resolved.source,
    fundingRate: metrics.fundingRate,
    openInterest: metrics.openInterest,
    globalLongShortRatio: globalLs,
    topTraderLongShortRatio: topLs,
  };
  cacheSet(cacheKey, out);
  return out;
}

const ALLOWED_INTERVALS = new Set(["15m", "1h", "4h", "1d"]);

async function getKlines(symbol: string, interval: string, limit: number) {
  const resolved = await resolveSymbol(symbol);
  if (resolved.source === "not-found")
    return { error: `Không tìm thấy symbol '${symbol}' trên Binance.` };
  if (!resolved.futuresSymbol)
    return { error: `${symbol.toUpperCase()} không có futures — chỉ hỗ trợ klines futures.` };

  const iv = ALLOWED_INTERVALS.has(interval) ? interval : "4h";
  const capped = Math.min(Math.max(limit || 24, 6), 100);

  const klines = await fetchBinanceFuturesKlines(resolved.futuresSymbol, capped, iv as BinanceInterval);
  if (klines.length === 0)
    return { error: `Không lấy được klines cho ${symbol} lúc này (có thể do geo-block).` };
  // Compact: only OHLC per candle to save tokens
  return {
    symbol: resolved.futuresSymbol,
    interval: iv,
    candles: klines.map((k) => ({
      o: k.open, h: k.high, l: k.low, c: k.close,
    })),
  };
}

async function getOiTrend(symbol: string, period: string) {
  const resolved = await resolveSymbol(symbol);
  if (resolved.source === "not-found")
    return { error: `Không tìm thấy symbol '${symbol}' trên Binance.` };
  if (!resolved.futuresSymbol)
    return { error: `${symbol.toUpperCase()} không có futures — không có OI history.` };

  const p = (["5m", "15m", "30m", "1h", "4h", "1d"] as const).includes(period as "5m") ? (period as "5m") : "1h";
  const history = await fetchBinanceOIHistory(resolved.futuresSymbol, p, 24);
  if (history.length === 0)
    return { error: `Không lấy được OI history cho ${symbol} lúc này (có thể do geo-block).` };
  const values = history.map((h) => h.openInterest);
  const first = values[0];
  const last = values[values.length - 1];
  const changePct = first ? +((((last - first) / first) * 100)).toFixed(2) : null;
  return {
    symbol: resolved.futuresSymbol,
    period: p,
    points: values,
    changePct,
    read: changePct === null ? null : changePct > 2 ? "OI tăng — tiền đang chảy vào" : changePct < -2 ? "OI giảm — tiền đang rút ra" : "OI tương đối ổn định",
  };
}

// ─── OpenAI-format tool registry ────────────────────────

export interface ChatToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

const str = (desc: string) => ({ type: "string", description: desc });
const num = (desc: string) => ({ type: "number", description: desc });

export const CHAT_TOOLS: ChatToolDef[] = [
  // DB tools
  {
    name: "get_coin_health",
    description: "Health score, score change, signal và lý do recommendation của 1 coin trong hệ thống (data theo chu kỳ refresh).",
    parameters: { type: "object", properties: { symbol: str("Coin symbol, ví dụ PENDLE") }, required: ["symbol"] },
    execute: (a) => getCoinHealth(String(a.symbol)),
  },
  {
    name: "get_coin_metrics",
    description: "Metrics trong DB của 1 coin (theo chu kỳ refresh, CÓ THỂ ĐÃ CŨ HÀNG GIỜ): trend/volume/momentum score, RSI, EMA, ATR, funding, OI. KHÔNG dùng cho câu hỏi về giá/điều kiện HIỆN TẠI — dùng get_live_price/get_futures_snapshot.",
    parameters: { type: "object", properties: { symbol: str("Coin symbol") }, required: ["symbol"] },
    execute: (a) => getCoinMetrics(String(a.symbol)),
  },
  {
    name: "get_setup_levels",
    description: "Mức advisory Entry/TP1/TP2/Stop + R:R cho 1 coin trong hệ thống (tính từ ATR). Chỉ advisory, không phải lệnh.",
    parameters: { type: "object", properties: { symbol: str("Coin symbol") }, required: ["symbol"] },
    execute: (a) => getSetupLevels(String(a.symbol)),
  },
  {
    name: "get_narrative_health",
    description: "Health score của 1 narrative + breadth (bao nhiêu coin đang tăng) + top coins.",
    parameters: { type: "object", properties: { name: str("Tên narrative, ví dụ AI, RWA, LAYER 2") }, required: ["name"] },
    execute: (a) => getNarrativeHealth(String(a.name)),
  },
  {
    name: "get_top_recommendations",
    description: "Top 3 coin có xu hướng tốt nhất trong hệ thống theo composite score.",
    parameters: { type: "object", properties: {} },
    execute: () => getTopRecommendations(),
  },
  {
    name: "compare_coins",
    description: "So sánh health + metrics song song giữa 2 coin trong hệ thống.",
    parameters: { type: "object", properties: { a: str("Symbol coin A"), b: str("Symbol coin B") }, required: ["a", "b"] },
    execute: (a) => compareCoins(String(a.a), String(a.b)),
  },
  {
    name: "get_price_history",
    description: "Lịch sử giá close hàng ngày từ DB (3-60 ngày) cho 1 coin.",
    parameters: { type: "object", properties: { symbol: str("Coin symbol"), days: num("Số ngày, mặc định 14") } },
    execute: (a) => getPriceHistory(String(a.symbol), Number(a.days ?? 14)),
  },
  {
    name: "get_narrative_leaders",
    description: "Các coin dẫn dắt (leaders) của 1 narrative.",
    parameters: { type: "object", properties: { name: str("Tên narrative") }, required: ["name"] },
    execute: (a) => getNarrativeLeaders(String(a.name)),
  },
  {
    name: "get_coin_analysis",
    description: "Phân tích định lượng sâu 1 coin trong hệ thống: lợi nhuận kỳ, biến động thường niên (volatility), rủi ro sụt giảm tối đa (max drawdown) và tương quan với BTC. Dùng khi user hỏi về rủi ro, biến động, hay so sánh với BTC.",
    parameters: {
      type: "object",
      properties: {
        symbol: str("Coin symbol"),
        days: num("Số ngày phân tích 10-180, mặc định 60"),
        benchmark: str("Benchmark so tương quan, mặc định BTC"),
      },
    },
    execute: (a) => getCoinAnalysis(String(a.symbol), Number(a.days ?? 60), String(a.benchmark ?? "BTC")),
  },
  // Binance realtime tools
  {
    name: "get_live_price",
    description: "Giá THỜI ĐIỂM HIỆN TẠI từ Binance (futures nếu có, fallback spot). BẮT BUỘC dùng cho mọi câu hỏi giá “bây giờ/hiện tại/now” — không dùng số DB. Hoạt động với MỌI coin trên Binance kể cả coin ngoài hệ thống.",
    parameters: { type: "object", properties: { symbol: str("Coin symbol, ví dụ BTC hoặc PENDLE") }, required: ["symbol"] },
    execute: (a) => getLivePrice(String(a.symbol)),
  },
  {
    name: "get_futures_snapshot",
    description: "Snapshot futures realtime: funding rate, OI, mark price, long/short ratio (global + top trader).",
    parameters: { type: "object", properties: { symbol: str("Coin symbol") }, required: ["symbol"] },
    execute: (a) => getFuturesSnapshot(String(a.symbol)),
  },
  {
    name: "get_klines",
    description: "Chuỗi nến OHLC gần nhất từ Binance futures (interval: 15m/1h/4h/1d, tối đa 100 nến) — dùng để đọc cấu hình giá hiện tại.",
    parameters: {
      type: "object",
      properties: { symbol: str("Coin symbol"), interval: str("15m|1h|4h|1d, mặc định 4h"), limit: num("Số nến 6-100, mặc định 24") },
    },
    execute: (a) => getKlines(String(a.symbol), String(a.interval ?? "4h"), Number(a.limit ?? 24)),
  },
  {
    name: "get_oi_trend",
    description: "Xu hướng Open Interest realtime (tăng/giảm %) — xác nhận tiền đang chảy vào hay rút ra.",
    parameters: { type: "object", properties: { symbol: str("Coin symbol"), period: str("5m|15m|30m|1h|4h|1d, mặc định 1h") } },
    execute: (a) => getOiTrend(String(a.symbol), String(a.period ?? "1h")),
  },
];

export const CHAT_TOOLS_OPENAI_FORMAT = CHAT_TOOLS.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  },
}));

export async function executeChatTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = CHAT_TOOLS.find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    return await tool.execute(args);
  } catch (e) {
    return { error: `Tool ${name} failed: ${String(e).slice(0, 200)}` };
  }
}
