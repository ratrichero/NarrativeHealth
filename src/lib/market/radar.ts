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
  fetchBinanceFuturesDepth,
} from "@/lib/collectors/binance";
import { computeMarketMetrics, emaLast, type MarketMetrics } from "@/lib/market/metrics";
import { computeSpotLeadership, fetchSpotTickers, type SpotLeadership } from "@/lib/market/spot";
import { computeClusters, type ClusterInfo } from "@/lib/market/cluster";
import { PromiseCache } from "@/lib/market/promise-cache";
import { computeLiquidity, netRiskReward, type LiquidityMetrics } from "@/lib/market/liquidity";
import {
  compositeScore,
  scoreForSide,
  type Bias,
  type MoverSide,
} from "@/lib/market/scoring";
import { buildSetup, type SetupLevels } from "@/lib/market/setup";
import { shouldExplainCatalyst } from "@/lib/catalyst/matching";
import { isEligibleTicker, listingAgeDays } from "@/lib/market/universe";
import { buildDemoSnapshot, getDemoDetail } from "@/lib/market/demo";
import { peekRadarRuntimeConfig, readRadarRuntimeConfig } from "@/lib/settings/radar-config";
import {
  recordBinanceRequest,
  recordSnapshotCache,
  withSnapshotBuild,
} from "@/lib/market/binance-metrics";
import { readLatestBiasBySymbolSide } from "@/lib/market/bias-log";

const FUTURES_API = "https://fapi.binance.com/fapi/v1";

export const DEFAULT_MIN_VOLUME_USD = 10_000_000;

/**
 * Bucket cố định cho `minVolume` (USD), khớp các lựa chọn trong UI.
 *
 * `minVolume` là một phần cache key của snapshot — mỗi key là một lần build
 * đầy đủ (ticker + enrich klines/OI/funding cho ~30 coin). Nhận giá trị tuỳ ý
 * nghĩa là cache key vô hạn: người dùng chỉ cần đổi `?minVolume=10000001` là
 * có thêm một lần build Binance. Chuẩn hoá về 5 mốc dưới đây chặn việc đó.
 */
export const MIN_VOLUME_BUCKETS = [
  5_000_000,
  10_000_000,
  25_000_000,
  50_000_000,
  100_000_000,
] as const;

/**
 * Làm tròn LÊN mốc gần nhất để filter không bao giờ lỏng hơn mức người dùng
 * yêu cầu. Vượt mốc cao nhất thì TỪ CHỐI (`MinVolumeOutOfRangeError`) chứ không
 * kẹp xuống — kẹp xuống sẽ trả dữ liệu lỏng hơn yêu cầu. Giá trị thiếu/không hợp
 * lệ dùng default của hệ thống (`RADAR_MIN_VOLUME_USD` hoặc 10M).
 */
export function normalizeMinVolume(raw?: number | null): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return minVolumeDefault();
  const bucket = MIN_VOLUME_BUCKETS.find((candidate) => candidate >= value);
  if (!bucket) throw new MinVolumeOutOfRangeError(value);
  return bucket;
}

/** Mốc lọc cao nhất hỗ trợ; vượt mốc này request bị từ chối (400). */
export const MIN_VOLUME_MAX_USD = MIN_VOLUME_BUCKETS[MIN_VOLUME_BUCKETS.length - 1];

export class MinVolumeOutOfRangeError extends Error {
  constructor(readonly value: number) {
    super(
      `minVolume tối đa ${MIN_VOLUME_MAX_USD.toLocaleString("en-US")} USD (nhận ${value}).`
    );
    this.name = "MinVolumeOutOfRangeError";
  }
}
const UNUSUAL_POOL_VOLUME_USD = 20_000_000;
const CLUSTER_CACHE_MS = 5 * 60_000;
/** Cluster base gắn với một mốc ticker, nên chỉ cần sống bằng snapshot. */
const CLUSTER_BASE_TTL_MS = 60_000;

/**
 * Tham số tuning lấy từ config runtime (DB > env). Hàm thay cho các hằng
 * module-level trước đây để đổi cấu hình trên Admin không cần restart.
 * Clamp giữ đúng giới hạn an toàn như env cũ.
 */
export function radarTuning() {
  const cfg = peekRadarRuntimeConfig();
  const perSide = Math.min(15, Math.max(5, Math.floor(cfg.enrichPerSide)));
  const unusual = Math.min(20, Math.max(6, Math.floor(cfg.unusualCandidates)));
  // Đủ chỗ cho toàn bộ row có thể được enrich ở cả 3 tab + unusual.
  const minUniverse = perSide * 2 + unusual;
  const universe =
    cfg.clusterUniverse <= 0
      ? 0
      : Math.min(60, Math.max(minUniverse, Math.floor(cfg.clusterUniverse)));
  return {
    perSide,
    unusual,
    universe,
    threshold: Math.min(0.9, Math.max(0.3, cfg.clusterThreshold)),
    maxSize: Math.min(20, Math.max(3, Math.floor(cfg.clusterMaxSize))),
  };
}

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

export type MarketRegime = "risk-on" | "risk-off" | "neutral";

export interface RadarMarketContext {
  gainers: number;
  losers: number;
  totalVolumeUsd: number;
  btcChangePct: number | null;
  btcPrice: number | null;
  universe: number;
  breadthPct: number | null;
  btcTrend: "up" | "down" | "flat" | null;
  regime: MarketRegime;
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
  /** RADAR-BIAS-LOG: feature đầu vào của scoring, ghi kèm nhãn để backtest/ML. */
  ema20?: number | null;
  ema50?: number | null;
  distanceFrom7dHighPct?: number | null;
  high7d: number | null;
  inSystem: boolean;
  narratives: string[];
  impulseAgeHours?: number | null;
  impulseExtensionAtr?: number | null;
  impulseConsolidationBars?: number | null;
  impulseRetestEma20?: boolean | null;
  impulseVolumeRatio?: number | null;
  spotChangePct?: number | null;
  spotVolume24h?: number | null;
  basisPct?: number | null;
  spotLed?: boolean | null;
  relativeStrengthPct?: number | null;
  rsPercentile?: number | null;
  clusterId?: string | null;
  clusterLabel?: string | null;
  clusterSize?: number;
  clusterLeader?: boolean;
  clusterLaggard?: boolean;
  /** RADAR-06: row đủ bất thường để hiển thị panel “vì sao volume bất thường”. */
  catalystTriggered?: boolean;
  /** Giá làm bias này sai (từ scoring) — UI/backtest đọc cùng nhãn. */
  invalidationPrice?: number | null;
  invalidationNote?: string | null;
  bias: Bias;
  label: string;
  score: number;
  entryQuality: number;
  composite: number;
  reasons: string[];
  warnings: string[];
}

export interface RadarClusterMember {
  symbol: string;
  changePct: number;
  quoteVolumeUsd: number;
  leader?: boolean;
  laggard?: boolean;
}

export interface RadarClusterSummary {
  id: string;
  label: string;
  size: number;
  avgChangePct: number;
  totalVolumeUsd: number;
  leader: string | null;
  direction: "up" | "down";
  members: RadarClusterMember[];
}

export interface RadarSnapshot {
  side: MoverSide;
  rows: RadarRow[];
  market: RadarMarketContext;
  /**
   * Bucket minVolume (USD) thực sự đã áp cho rows/clusters — làm tròn LÊN mốc
   * gần nhất với tham số yêu cầu, nên không bao giờ lỏng hơn. Permalink và
   * ledger phải so sánh theo giá trị này, không theo `?minVolume` thô.
   */
  minVolume: number;
  /** Cụm phát hiện trên universe quét rộng (gồm coin ngoài top rows). */
  clusters?: RadarClusterSummary[];
  /**
   * Toàn bộ cụm của universe, chỉ dùng server-side để resolve `?cluster=<id>`
   * khi cụm đó không nằm trong top 6 của panel. Bị bỏ trước khi trả JSON.
   */
  allClusters?: RadarClusterSummary[];
  collectedAt: string;
  /** true khi RADAR_DEMO=1 và dữ liệu là mẫu, không phải Binance thật. */
  demo?: boolean;
  notice?: string;
}

export interface RadarDetail {
  row: RadarRow;
  setup: SetupLevels | null;
  netRiskRewardRatio?: number | null;
  liquidity?: LiquidityMetrics | null;
  chart: { t: number; o: number; h: number; l: number; c: number }[];
  asOf: string;
}

const tickerCache: { value: FuturesTicker[]; expires: number; loadedAt: number } = {
  value: [],
  expires: 0,
  loadedAt: 0,
};
let tickerInflight: Promise<FuturesTicker[]> | null = null;

/**
 * Mốc của bộ ticker đang dùng (ms lúc fetch). Cluster base được tính từ chính
 * bộ ticker này, nên mốc phải nằm trong cache key: hai snapshot khác mốc ticker
 * không được ghép chung một base, dù base còn hạn.
 */
export function futuresTickerEpoch(): number {
  return tickerCache.loadedAt;
}

export async function fetchFuturesTickers(): Promise<FuturesTicker[]> {
  if (tickerCache.expires > Date.now() && tickerCache.value.length > 0) return tickerCache.value;
  if (tickerInflight) return tickerInflight;

  tickerInflight = (async () => {
    try {
      recordBinanceRequest();
      const response = await axios.get(`${FUTURES_API}/ticker/24hr`, { timeout: 15_000 });
      if (!Array.isArray(response.data)) throw new Error("Unexpected ticker payload");
      const tickers = response.data as FuturesTicker[];
      tickerCache.value = tickers;
      tickerCache.loadedAt = Date.now();
      tickerCache.expires = tickerCache.loadedAt + 45_000;
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
      recordBinanceRequest();
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
  const value = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MIN_VOLUME_USD;
  // Env cũng phải nằm trong bucket: giá trị lẻ (15M) tạo cache key ngoài bucket,
  // còn giá trị > mốc cao nhất sẽ lọt qua filter UI. Cấu hình env sai không được
  // làm sập cả trang market nên kẹp về bucket cao nhất thay vì throw như tham số
  // người dùng gửi lên.
  return MIN_VOLUME_BUCKETS.find((candidate) => candidate >= value) ?? MIN_VOLUME_MAX_USD;
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

export function percentileRank(sortedValues: number[], value: number): number | null {
  if (sortedValues.length === 0 || !Number.isFinite(value)) return null;
  let low = 0;
  let high = sortedValues.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (sortedValues[mid] <= value) low = mid + 1;
    else high = mid;
  }
  return Math.round((low / sortedValues.length) * 100);
}

export function classifyRegime(
  btcChangePct: number | null,
  btcTrend: "up" | "down" | "flat" | null,
  breadthPct: number | null
): MarketRegime {
  if (btcTrend === "up" || ((btcChangePct ?? 0) > 0 && (breadthPct ?? 50) >= 55)) return "risk-on";
  if (btcTrend === "down" || ((btcChangePct ?? 0) < 0 && (breadthPct ?? 50) <= 45)) return "risk-off";
  return "neutral";
}

function toRow(
  ticker: FuturesTicker,
  metrics: MarketMetrics,
  side: MoverSide,
  system: Map<string, SystemCoin>,
  spot: SpotLeadership | null = null,
  prevBias: Bias | null = null
): RadarRow {
  const symbol = ticker.symbol.replace(/USDT$/, "");
  // `prevBias` bật hysteresis: đổi phe phải vượt BIAS_SWITCH_MARGIN.
  const score = scoreForSide(metrics, side, { prevBias });
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
    ema20: metrics.ema20,
    ema50: metrics.ema50,
    distanceFrom7dHighPct: metrics.distanceFrom7dHighPct,
    high7d: metrics.high7d,
    inSystem: Boolean(membership),
    narratives: membership?.narratives.slice(0, 3) ?? [],
    impulseAgeHours: metrics.impulseAgeHours ?? null,
    impulseExtensionAtr: metrics.impulseExtensionAtr ?? null,
    impulseConsolidationBars: metrics.impulseConsolidationBars ?? null,
    impulseRetestEma20: metrics.impulseRetestEma20 ?? null,
    impulseVolumeRatio: metrics.impulseVolumeRatio ?? null,
    spotChangePct: spot?.spotChangePct ?? null,
    spotVolume24h: spot?.spotVolume24h ?? null,
    basisPct: spot?.basisPct ?? null,
    spotLed: spot?.spotLed ?? null,
    relativeStrengthPct: metrics.relativeStrengthPct ?? null,
    rsPercentile: null,
    clusterId: null,
    clusterLabel: null,
    clusterSize: 1,
    clusterLeader: false,
    clusterLaggard: false,
    catalystTriggered: shouldExplainCatalyst({
      volumeZ: metrics.volumeZ,
      volumeRatio7d: metrics.volumeRatio7d,
      changePct: metrics.changePct,
    }),
    bias: score.bias,
    label: score.label,
    score: score.score,
    entryQuality: score.entryQuality,
    composite: compositeScore(score.score, score.entryQuality),
    reasons: score.reasons,
    warnings: score.warnings,
    invalidationPrice: score.invalidationPrice,
    invalidationNote: score.invalidationNote,
  };
}

interface EnrichedRow {
  row: RadarRow;
  closes: number[];
}

async function enrichTicker(
  ticker: FuturesTicker,
  meta: ExchangeSymbol | undefined,
  side: MoverSide,
  system: Map<string, SystemCoin>,
  spotTicker: { lastPrice: string; priceChangePercent: string; quoteVolume: string } | undefined,
  btcChangePct: number | null,
  prevBias: Bias | null
): Promise<EnrichedRow> {
  const [daily, h4, hourly, funding, oi] = await Promise.all([
    fetchBinanceFuturesKlines(ticker.symbol, 30, "1d").catch(() => []),
    fetchBinanceFuturesKlines(ticker.symbol, 120, "4h").catch(() => []),
    fetchBinanceFuturesKlines(ticker.symbol, 72, "1h").catch(() => []),
    fetchBinanceFundingRate(ticker.symbol).catch(() => null),
    fetchBinanceOIHistory(ticker.symbol, "1h", 25).catch(() => []),
  ]);

  const changePct = Number(ticker.priceChangePercent);
  const spot = computeSpotLeadership(changePct, Number(ticker.lastPrice), spotTicker);
  const metrics = computeMarketMetrics({
    price: Number(ticker.lastPrice),
    changePct,
    quoteVolume: Number(ticker.quoteVolume),
    trades: Number(ticker.count ?? 0),
    high24h: Number(ticker.highPrice),
    low24h: Number(ticker.lowPrice),
    dailyCandles: daily,
    h4Candles: h4,
    hourlyCandles: hourly,
    fundingRate: funding,
    oiHistory: oi,
    listingAgeDays: listingAgeDays(meta?.onboardDate),
    spotLed: spot?.spotLed ?? null,
    relativeStrengthPct: btcChangePct === null ? null : changePct - btcChangePct,
  });

  return {
    row: toRow(ticker, metrics, side, system, spot, prevBias),
    closes: hourly.map((c) => Number(c.close)).filter(Number.isFinite),
  };
}

// ─── Snapshot ───────────────────────────────────────────

const snapshotCache = new PromiseCache<RadarSnapshot>({ ttlMs: 60_000 });

/**
 * RADAR-05-W7: cluster base dùng chung cho cả 3 tab, khoá theo `minVolume` **và
 * mốc ticker** (`futuresTickerEpoch`).
 *
 * Universe quét cluster (`selectClusterUniverse`), `absChangeRanks` và changePct/
 * leader của cụm đều tính từ ticker cache 45s. Nếu key chỉ có `minVolume`, một
 * snapshot mới (ticker mới) có thể nhận base cũ tới 5 phút → row mới ghép với
 * leader/changePct của universe cũ. Đưa mốc ticker vào key giữ nguyên lợi ích
 * của W7 (3 tab trong cùng một mốc ticker dùng chung base + inflight dedupe)
 * nhưng triệt tiêu trộn mốc: mốc ticker đổi thì base được tính lại.
 *
 * TTL hạ về cùng mức snapshot (60s) — key đã đảm bảo đúng dữ liệu, TTL chỉ còn
 * tác dụng dọn entry cũ khỏi bộ nhớ.
 */
const clusterBaseCache = new PromiseCache<ClusterBase>({ ttlMs: CLUSTER_BASE_TTL_MS });

/** Xoá cache snapshot/detail để đổi cấu hình radar áp dụng ngay, không chờ TTL. */
export function invalidateRadarSnapshotCache(): void {
  snapshotCache.clear();
  clusterBaseCache.clear();
  detailCache.clear();
  clusterInfoCache.clear();
}
// Cache membership cluster theo universe/minVolume để drawer detail của coin ngoài
// rows vẫn đọc được cluster/leader/laggard từ snapshot gần nhất.
const clusterInfoCache = new Map<
  number,
  { value: Map<string, ClusterInfo | null>; expires: number }
>();

let btcTrendCache: { value: "up" | "down" | "flat" | null; expires: number } = { value: null, expires: 0 };

async function getBtcTrend(): Promise<"up" | "down" | "flat" | null> {
  if (btcTrendCache.expires > Date.now()) return btcTrendCache.value;
  try {
    const candles = await fetchBinanceFuturesKlines("BTCUSDT", 60, "4h");
    const closes = candles.map((c) => Number(c.close)).filter(Number.isFinite);
    const ema20 = emaLast(closes, 20);
    const ema50 = emaLast(closes, 50);
    const value =
      ema20 === null || ema50 === null
        ? null
        : ema20 > ema50 * 1.002
          ? "up"
          : ema20 < ema50 * 0.998
            ? "down"
            : "flat";
    btcTrendCache = { value, expires: Date.now() + 5 * 60_000 };
    return value;
  } catch {
    btcTrendCache = { value: null, expires: Date.now() + 60_000 };
    return null;
  }
}

function buildMarket(
  tickers: FuturesTicker[],
  eligible: FuturesTicker[],
  btcTrend: "up" | "down" | "flat" | null
): RadarMarketContext {
  const usdt = tickers.filter((t) => /^[A-Z0-9]{2,15}USDT$/.test(t.symbol));
  let gainers = 0;
  let losers = 0;
  for (const t of eligible) {
    const change = Number(t.priceChangePercent);
    if (change > 0) gainers += 1;
    else if (change < 0) losers += 1;
  }
  const btc = tickers.find((t) => t.symbol === "BTCUSDT");
  const btcChange = btc ? Number(btc.priceChangePercent) : NaN;
  const btcChangePct = Number.isFinite(btcChange) ? btcChange : null;
  const btcPrice = btc && Number(btc.lastPrice) > 0 ? Number(btc.lastPrice) : null;
  const breadthPct = gainers + losers > 0 ? (gainers / (gainers + losers)) * 100 : null;

  return {
    gainers,
    losers,
    totalVolumeUsd: usdt.reduce((sum, t) => sum + (Number(t.quoteVolume) || 0), 0),
    btcChangePct,
    btcPrice,
    universe: eligible.length,
    breadthPct: breadthPct === null ? null : Number(breadthPct.toFixed(1)),
    btcTrend,
    regime: classifyRegime(btcChangePct, btcTrend, breadthPct),
  };
}

export interface ClusterCandidate {
  symbol: string;
  closes: number[];
  composite: number;
  narratives: string[];
  changePct: number;
  quoteVolumeUsd: number;
}

/**
 * RADAR-06: gán cụm rồi tính lại `catalystTriggered`.
 *
 * `toRow()` chạy trước khi biết cluster nên `clusterLeader` luôn false ở đó —
 * nếu giữ nguyên cờ đã tính ở `toRow()`, nhánh `clusterLeader` của
 * `shouldExplainCatalyst` không bao giờ bật. Mọi nơi gán cụm cho row phải đi
 * qua hàm này để cờ được tính lại với `clusterLeader` thật.
 */
export function applyClusterAssignments(
  rows: RadarRow[],
  clusters: ReturnType<typeof computeClusters>
): void {
  for (const row of rows) {
    applyClusterInfo(row, clusters.get(row.symbol) ?? null);
    row.catalystTriggered = shouldExplainCatalyst({
      volumeZ: row.volumeZ,
      volumeRatio7d: row.volumeRatio7d,
      changePct: row.changePct,
      clusterLeader: row.clusterLeader,
    });
  }
}

const clusterClosesCache = new Map<string, { value: number[]; expires: number }>();
const clusterClosesInflight = new Map<string, Promise<number[]>>();

async function getClusterCloses(symbol: string): Promise<number[]> {
  const cached = clusterClosesCache.get(symbol);
  if (cached && cached.expires > Date.now()) return cached.value;
  const inflight = clusterClosesInflight.get(symbol);
  if (inflight) return inflight;

  const promise = fetchBinanceFuturesKlines(symbol, 30, "1h")
    .then((candles) =>
      candles.map((candle) => Number(candle.close)).filter((close) => Number.isFinite(close) && close > 0)
    )
    .catch((error) => {
      console.warn(
        `[RADAR-CLUSTER] Không lấy được 1h ${symbol}:`,
        error instanceof Error ? error.message : String(error)
      );
      return [] as number[];
    })
    .then((closes) => {
      clusterClosesCache.set(symbol, {
        value: closes,
        expires: Date.now() + (closes.length >= 25 ? CLUSTER_CACHE_MS : 60_000),
      });
      return closes;
    })
    .finally(() => clusterClosesInflight.delete(symbol));

  clusterClosesInflight.set(symbol, promise);
  return promise;
}

/**
 * Chuẩn hoá strength của coin extra về phân bố composite của coin enrich.
 * Xếp hạng |biến động 24h| trong universe rồi nội suy đúng percentile đó trên
 * composite của các coin enrich — tránh extra luôn thắng vì thang abs(change)*6.
 */
export function normalizeExtraComposite(
  changePct: number,
  absChangeRanks: number[],
  enrichedComposites: number[]
): number {
  const percentile = percentileRank(absChangeRanks, Math.abs(changePct)) ?? 50;
  const sorted = enrichedComposites
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return percentile;

  const position = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  const value = sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
  return Math.round(Math.min(100, Math.max(0, value)));
}

/** Gộp enrich + extra, chuẩn hoá composite extra trước khi tính cluster. */
export function mergeClusterCandidates(
  enriched: ClusterCandidate[],
  extra: ClusterCandidate[],
  absChangeRanks: number[]
): ClusterCandidate[] {
  const enrichedComposites = enriched.map((item) => item.composite);
  return [
    ...enriched,
    ...extra.map((item) => ({
      ...item,
      composite: normalizeExtraComposite(item.changePct, absChangeRanks, enrichedComposites),
    })),
  ];
}

/**
 * Chọn universe quét cluster rộng hơn top enrich: ưu tiên volume, nhưng vẫn
 * dành quota cho top tăng/giảm để không bỏ sót cụm nhỏ.
 * Loại các symbol đã enrich để không fetch trùng.
 */
export function selectClusterPool(
  eligible: FuturesTicker[],
  excluded: Set<string>,
  limit = radarTuning().universe
): FuturesTicker[] {
  if (limit <= 0) return [];
  const seen = new Set(excluded);
  const picked: FuturesTicker[] = [];
  const volumeSorted = [...eligible].sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume));
  const gainers = [...eligible].sort(
    (a, b) => Number(b.priceChangePercent) - Number(a.priceChangePercent)
  );
  const losers = [...eligible].sort(
    (a, b) => Number(a.priceChangePercent) - Number(b.priceChangePercent)
  );

  const add = (ticker: FuturesTicker) => {
    if (picked.length >= limit || seen.has(ticker.symbol)) return;
    seen.add(ticker.symbol);
    picked.push(ticker);
  };
  const volumeQuota = Math.ceil(limit * 0.6);
  const gainerQuota = Math.ceil(limit * 0.8);

  for (const ticker of volumeSorted) {
    if (picked.length >= volumeQuota) break;
    add(ticker);
  }
  for (const ticker of gainers) {
    if (picked.length >= gainerQuota) break;
    add(ticker);
  }
  for (const ticker of losers) {
    if (picked.length >= limit) break;
    add(ticker);
  }
  for (const ticker of volumeSorted) {
    if (picked.length >= limit) break;
    add(ticker);
  }
  return picked;
}

/**
 * Universe quét cluster cố định: top gainer + top loser + unusual + volume.
 * Không nhận `side` và không loại coin đã enrich, nên mọi tab dùng cùng universe.
 */
export function selectClusterUniverse(
  eligible: FuturesTicker[],
  minVolume: number,
  limit = radarTuning().universe
): FuturesTicker[] {
  if (limit <= 0) return [];
  const { perSide, unusual: unusualCount } = radarTuning();
  const seen = new Set<string>();
  const picked: FuturesTicker[] = [];
  const add = (ticker: FuturesTicker) => {
    if (picked.length >= limit || seen.has(ticker.symbol)) return;
    seen.add(ticker.symbol);
    picked.push(ticker);
  };

  const byChangeDesc = [...eligible].sort(
    (a, b) => Number(b.priceChangePercent) - Number(a.priceChangePercent)
  );
  const byChangeAsc = [...eligible].sort(
    (a, b) => Number(a.priceChangePercent) - Number(b.priceChangePercent)
  );
  const byVolume = [...eligible].sort(
    (a, b) => Number(b.quoteVolume) - Number(a.quoteVolume)
  );
  const taken = new Set([
    ...byChangeDesc.slice(0, perSide).map((ticker) => ticker.symbol),
    ...byChangeAsc.slice(0, perSide).map((ticker) => ticker.symbol),
  ]);
  const unusual = eligible
    .filter(
      (ticker) =>
        Math.abs(Number(ticker.priceChangePercent)) <= 8 &&
        Number(ticker.quoteVolume) >= Math.max(minVolume, UNUSUAL_POOL_VOLUME_USD) &&
        !taken.has(ticker.symbol)
    )
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, unusualCount);

  // Thứ tự add cố định để label/cluster id không phụ thuộc tab.
  for (const ticker of byChangeDesc.slice(0, perSide)) add(ticker);
  for (const ticker of byChangeAsc.slice(0, perSide)) add(ticker);
  for (const ticker of unusual) add(ticker);
  for (const ticker of byVolume) add(ticker);
  return picked;
}

export type ClusterInfoFields = Pick<
  RadarRow,
  "clusterId" | "clusterLabel" | "clusterSize" | "clusterLeader" | "clusterLaggard"
>;

/** Gắn (hoặc xoá) metadata cụm lên row detail từ snapshot/cache. */
export function applyClusterInfo(row: ClusterInfoFields, info: ClusterInfo | null): void {
  row.clusterId = info?.clusterId ?? null;
  row.clusterLabel = info?.label ?? null;
  row.clusterSize = info?.size ?? 1;
  row.clusterLeader = info?.leader ?? false;
  row.clusterLaggard = info?.laggard ?? false;
}

/** Gộp kết quả cluster thành summary cho panel cụm/rotation (gồm cả coin ngoài rows). */
export function summarizeClusters(
  items: Array<{ symbol: string; changePct: number; quoteVolumeUsd: number }>,
  clusters: Map<string, ClusterInfo | null>,
  limit = 6
): RadarClusterSummary[] {
  const groups = new Map<
    string,
    { info: ClusterInfo; members: Array<RadarClusterMember & { leader: boolean; laggard: boolean }> }
  >();

  for (const item of items) {
    const info = clusters.get(item.symbol);
    if (!info) continue;
    const group = groups.get(info.clusterId) ?? { info, members: [] };
    group.members.push({
      symbol: item.symbol,
      changePct: item.changePct,
      quoteVolumeUsd: item.quoteVolumeUsd,
      leader: info.leader,
      laggard: info.laggard,
    });
    groups.set(info.clusterId, group);
  }

  return [...groups.values()]
    .map(({ info, members }) => {
      const sorted = [...members].sort((a, b) => b.changePct - a.changePct);
      const avgChangePct =
        members.reduce((sum, member) => sum + member.changePct, 0) / Math.max(1, members.length);
      return {
        // Dùng đúng id của computeClusters (hash member + narrative) để permalink,
        // cluster-history và clusterId trong signal ledger là một id duy nhất.
        id: info.clusterId,
        label: info.label,
        size: members.length,
        avgChangePct: Number(avgChangePct.toFixed(2)),
        totalVolumeUsd: members.reduce((sum, member) => sum + member.quoteVolumeUsd, 0),
        leader: members.find((member) => member.leader)?.symbol ?? null,
        direction: avgChangePct >= 0 ? ("up" as const) : ("down" as const),
        members: sorted.map(({ symbol, changePct, quoteVolumeUsd, leader, laggard }) => ({
          symbol,
          changePct,
          quoteVolumeUsd,
          leader,
          laggard,
        })),
      } satisfies RadarClusterSummary;
    })
    .sort((a, b) => b.size - a.size || Math.abs(b.avgChangePct) - Math.abs(a.avgChangePct))
    .slice(0, limit);
}

export interface ClusterBaseOptions {
  absChangeRanks: number[];
  btcCloses?: number[];
  threshold?: number;
  maxSize?: number;
}

export interface ClusterBase {
  clusters: Map<string, ClusterInfo | null>;
  summaries: RadarClusterSummary[];
  /** Không cắt top 6 — dùng để mở permalink cụm ngoài panel. */
  allSummaries: RadarClusterSummary[];
  items: ClusterCandidate[];
}

/**
 * Tính cluster từ universe cố định. Composite ở đây là percentile |24h change|
 * trong universe, không lấy từ row enrich của tab hiện tại — nhờ vậy đổi tab
 * không đổi membership/leader/laggard. Enriched rows chỉ merge metadata sau.
 */
export function buildClusterBase(
  candidates: ClusterCandidate[],
  options: ClusterBaseOptions
): ClusterBase {
  const items = candidates.map((candidate) => ({
    ...candidate,
    composite: percentileRank(options.absChangeRanks, Math.abs(candidate.changePct)) ?? 50,
  }));
  const tuning = radarTuning();
  const clusters = computeClusters(items, {
    btcCloses: options.btcCloses,
    threshold: options.threshold ?? tuning.threshold,
    maxSize: options.maxSize ?? tuning.maxSize,
  });
  const allSummaries = summarizeClusters(
    items.map(({ symbol, changePct, quoteVolumeUsd }) => ({ symbol, changePct, quoteVolumeUsd })),
    clusters,
    Number.POSITIVE_INFINITY
  );
  return { clusters, summaries: allSummaries.slice(0, 6), allSummaries, items };
}

async function loadClusterBase(
  universe: FuturesTicker[],
  system: Map<string, { narratives: string[] }>,
  absChangeRanks: number[],
  enrichedCloses: Map<string, number[]>
): Promise<ClusterBase> {
  if (universe.length === 0) {
    return { clusters: new Map(), summaries: [], allSummaries: [], items: [] };
  }

  const candidates = (
    await mapLimit(universe, 6, async (ticker) => {
      const symbol = ticker.symbol.replace(/USDT$/, "");
      const closes = enrichedCloses.get(symbol) ?? (await getClusterCloses(ticker.symbol));
      if (closes.length < 25) return null;
      return {
        symbol,
        closes,
        composite: 0,
        narratives: system.get(symbol)?.narratives.slice(0, 3) ?? [],
        changePct: Number(ticker.priceChangePercent),
        quoteVolumeUsd: Number(ticker.quoteVolume) || 0,
      } satisfies ClusterCandidate;
    })
  ).filter((item): item is ClusterCandidate => item !== null);

  if (candidates.length === 0) {
    return { clusters: new Map(), summaries: [], allSummaries: [], items: [] };
  }
  const btcCloses =
    candidates.find((item) => item.symbol === "BTC")?.closes ??
    (await getClusterCloses("BTCUSDT").catch(() => []));
  return buildClusterBase(candidates, { absChangeRanks, btcCloses });
}

async function buildSnapshot(side: MoverSide, minVolume: number): Promise<RadarSnapshot> {
  // Bias lần chấm trước (6 giờ, cache 60s) để scoring giữ nhãn ổn định.
  const [tickers, info, system, spotMap, btcTrend, prevBiasMap] = await Promise.all([
    fetchFuturesTickers(),
    fetchExchangeSymbols(),
    getSystemCoins(),
    fetchSpotTickers(),
    getBtcTrend(),
    readLatestBiasBySymbolSide().catch(() => new Map<string, string>()),
  ]);

  // Chụp mốc ticker ngay sau khi fetch, trước bước enrich (có thể kéo dài vài
  // giây): base phải được khoá theo đúng bộ ticker đã dùng để tính universe.
  const tickerEpoch = futuresTickerEpoch();

  const eligible = tickers.filter((t) => isEligibleTicker(t, info.get(t.symbol), minVolume));

  if (eligible.length < 10) {
    throw new Error("Binance trả quá ít symbol hợp lệ — thử lại sau.");
  }

  const market = buildMarket(tickers, eligible, btcTrend);
  const btcChangePct = market.btcChangePct;
  const changeRanks = eligible.map((t) => Number(t.priceChangePercent)).sort((a, b) => a - b);
  const absChangeRanks = eligible
    .map((t) => Math.abs(Number(t.priceChangePercent)))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
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

  const tuning = radarTuning();
  let chosen: FuturesTicker[] = [];
  if (side === "gainer") chosen = byChangeDesc.slice(0, tuning.perSide);
  else if (side === "loser") chosen = byChangeAsc.slice(0, tuning.perSide);
  else {
    const taken = new Set([
      ...byChangeDesc.slice(0, tuning.perSide).map((t) => t.symbol),
      ...byChangeAsc.slice(0, tuning.perSide).map((t) => t.symbol),
    ]);
    const pool = eligible
      .filter(
        (t) =>
          Math.abs(Number(t.priceChangePercent)) <= 8 &&
          Number(t.quoteVolume) >= Math.max(minVolume, UNUSUAL_POOL_VOLUME_USD) &&
          !taken.has(t.symbol)
      )
      .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
      .slice(0, tuning.unusual);
    chosen = pool;
  }

  const clusterUniverse = selectClusterUniverse(eligible, minVolume);
  const enriched = await mapLimit(chosen, 8, (ticker) =>
    enrichTicker(
      ticker,
      info.get(ticker.symbol),
      side,
      system,
      spotMap.get(ticker.symbol),
      btcChangePct,
      (prevBiasMap.get(`${ticker.symbol.replace(/USDT$/, "")}|${side}`) as Bias | undefined) ??
        null
    ).catch((error) => {
      console.warn(
        `[RADAR] Enrich ${ticker.symbol} lỗi:`,
        error instanceof Error ? error.message : String(error)
      );
      return null;
    })
  );

  const clean = enriched.filter((r): r is EnrichedRow => r !== null);
  for (const entry of clean) {
    entry.row.rsPercentile = percentileRank(changeRanks, entry.row.changePct);
  }

  // Cluster được tính trên universe cố định trước; row enrich chỉ merge vào sau.
  const enrichedCloses = new Map(clean.map((entry) => [entry.row.symbol, entry.closes]));
  // W7: chia sẻ cluster base theo minVolume + mốc ticker giữa các tab
  // (xem clusterBaseCache).
  const clusterBase = await clusterBaseCache.lookup(`base|${minVolume}|${tickerEpoch}`, () =>
    loadClusterBase(clusterUniverse, system, absChangeRanks, enrichedCloses)
  ).promise;
  clusterInfoCache.set(minVolume, {
    value: clusterBase.clusters,
    expires: Date.now() + 60_000,
  });
  for (const entry of clean) {
    applyClusterInfo(entry.row, clusterBase.clusters.get(entry.row.symbol) ?? null);
  }
  // Cụm chỉ biết sau computeClusters → cờ catalyst phải tính lại ở đây (RADAR-06).
  applyClusterAssignments(
    clean.map((entry) => entry.row),
    clusterBase.clusters
  );
  const clusterSummaries = clusterBase.summaries;

  let rows = clean.map((entry) => entry.row);
  if (side === "unusual") {
    rows = rows.filter(
      (r) =>
        (r.volumeZ !== null && r.volumeZ >= 2) ||
        ((r.volumeRatio7d ?? 0) >= 2.2 && (r.oiChangePct ?? 0) >= 2)
    );
  }

  rows.sort((a, b) => b.composite - a.composite || Math.abs(b.changePct) - Math.abs(a.changePct));

  return {
    side,
    rows,
    market,
    clusters: clusterSummaries,
    allClusters: clusterBase.allSummaries,
    minVolume,
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
  /** `?cluster=<id>` — ghim đúng cụm vào snapshot kể cả ngoài top 6 của panel. */
  cluster?: string;
}

export function shapeRadarSnapshot(snapshot: RadarSnapshot, query: RadarQuery): RadarSnapshot {
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

  // Permalink: cụm được hỏi có thể nằm ngoài top 6 panel (hoặc khác tab).
  // Ghim nó lên đầu để client luôn mở đúng cụm + đủ member từ URL.
  const pinned = query.cluster
    ? [...(snapshot.clusters ?? []), ...(snapshot.allClusters ?? [])].find(
        (cluster) => cluster.id === query.cluster
      ) ?? null
    : null;
  const clusters =
    pinned && !(snapshot.clusters ?? []).some((cluster) => cluster.id === pinned.id)
      ? [pinned, ...(snapshot.clusters ?? [])]
      : snapshot.clusters;

  // allClusters chỉ là dữ liệu tra cứu server-side, không đưa vào payload API.
  const { allClusters: _allClusters, ...rest } = snapshot;
  return { ...rest, rows, ...(clusters ? { clusters } : {}) };
}

export async function getRadarSnapshot(query: RadarQuery = {}): Promise<RadarSnapshot> {
  const side = query.side ?? "gainer";
  // Chuẩn hoá về bucket cố định: `?minVolume` tuỳ ý không được tạo cache key mới
  // (mỗi key là một lần build Binance đầy đủ).
  const minVolume =
    query.minVolume && query.minVolume > 0
      ? normalizeMinVolume(query.minVolume)
      : minVolumeDefault();

  if (process.env.RADAR_DEMO === "1") {
    return shapeRadarSnapshot(buildDemoSnapshot(side, minVolume), query);
  }

  // Nạp config runtime (DB > env) trước khi snapshot dùng tuning sync.
  await readRadarRuntimeConfig();

  const key = `${side}|${minVolume}`;
  const { promise, cached } = snapshotCache.lookup(key, () =>
    withSnapshotBuild(
      { side, minVolume },
      () => buildSnapshot(side, minVolume),
      (snapshot) => ({ rows: snapshot.rows.length, clusters: snapshot.clusters?.length ?? 0 })
    )
  );
  // `cached` gồm cả inflight: request dùng chung snapshot/build của người khác
  // thì không phải lần gọi Binance "nguội" — đây là phần cần đo tải.
  recordSnapshotCache(cached);

  return shapeRadarSnapshot(await promise, query);
}

function cachedClusterInfo(symbol: string): ClusterInfo | null | undefined {
  const now = Date.now();
  const defaultKey = minVolumeDefault();
  const defaultEntry = clusterInfoCache.get(defaultKey);
  const defaultFresh = defaultEntry && defaultEntry.expires > now ? defaultEntry : null;

  // Ưu tiên cache của đúng minVolume mặc định; nếu không có thì tìm cụm trong
  // cache của filter khác mà người dùng đang xem.
  if (defaultFresh) {
    const hit = defaultFresh.value.get(symbol);
    if (hit) return hit;
  }
  for (const [key, entry] of clusterInfoCache) {
    if (key === defaultKey || entry.expires <= now) continue;
    const hit = entry.value.get(symbol);
    if (hit) return hit;
  }
  if (defaultFresh && defaultFresh.value.has(symbol)) return null;
  return defaultFresh ? null : undefined;
}

async function getClusterInfoForSymbol(symbol: string): Promise<ClusterInfo | null> {
  const cached = cachedClusterInfo(symbol);
  if (cached !== undefined) return cached;

  try {
    await getRadarSnapshot({ side: "gainer", limit: 30, minVolume: minVolumeDefault() });
  } catch {
    return null;
  }
  return clusterInfoCache.get(minVolumeDefault())?.value.get(symbol) ?? null;
}

// ─── Detail ─────────────────────────────────────────────

const detailCache = new Map<string, { expires: number; promise: Promise<RadarDetail | null> }>();

/**
 * Gán cụm cho row detail bằng chính computation của list.
 * RADAR-05 E5: detail trước đây không tính cụm nên mở từ panel cụm bị mất
 * clusterId/label/leader và cờ catalyst ở detail không bao giờ xét nhánh
 * `clusterLeader`.
 */
export function applyDetailCluster(row: RadarRow, cluster: ClusterInfo | null): void {
  applyClusterAssignments([row], new Map([[row.symbol, cluster]]));
}

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
    const [tickers, info, system, spotMap] = await Promise.all([
      fetchFuturesTickers(),
      fetchExchangeSymbols(),
      getSystemCoins(),
      fetchSpotTickers(),
    ]);
    const ticker = tickers.find((t) => t.symbol === pair);
    if (!ticker) return null;

    const [daily, h4, hourly, funding, oi, depth] = await Promise.all([
      fetchBinanceFuturesKlines(pair, 30, "1d").catch(() => []),
      fetchBinanceFuturesKlines(pair, 120, "4h").catch(() => []),
      fetchBinanceFuturesKlines(pair, 72, "1h").catch(() => []),
      fetchBinanceFundingRate(pair).catch(() => null),
      fetchBinanceOIHistory(pair, "1h", 25).catch(() => []),
      fetchBinanceFuturesDepth(pair, 50).catch(() => null),
    ]);

    const btc = tickers.find((t) => t.symbol === "BTCUSDT");
    const btcChangePct = btc && Number.isFinite(Number(btc.priceChangePercent))
      ? Number(btc.priceChangePercent)
      : null;
    const changePct = Number(ticker.priceChangePercent);
    const spot = computeSpotLeadership(changePct, Number(ticker.lastPrice), spotMap.get(pair));

    const metrics = computeMarketMetrics({
      price: Number(ticker.lastPrice),
      changePct,
      quoteVolume: Number(ticker.quoteVolume),
      trades: Number(ticker.count ?? 0),
      high24h: Number(ticker.highPrice),
      low24h: Number(ticker.lowPrice),
      dailyCandles: daily,
      h4Candles: h4,
      hourlyCandles: hourly,
      fundingRate: funding,
      oiHistory: oi,
      listingAgeDays: listingAgeDays(info.get(pair)?.onboardDate),
      spotLed: spot?.spotLed ?? null,
      relativeStrengthPct: btcChangePct === null ? null : changePct - btcChangePct,
    });

    const change = metrics.changePct;
    const side: MoverSide = change > 2 ? "gainer" : change < -2 ? "loser" : "unusual";
    const prevBiasMap = await readLatestBiasBySymbolSide().catch(() => new Map<string, string>());
    const prevBias =
      (prevBiasMap.get(`${ticker.symbol.replace(/USDT$/, "")}|${side}`) as Bias | undefined) ??
      null;
    const row = toRow(ticker, metrics, side, system, spot, prevBias);
    row.rsPercentile = percentileRank(
      tickers.map((t) => Number(t.priceChangePercent)).filter(Number.isFinite).sort((a, b) => a - b),
      row.changePct
    );
    // Cụm phải gán trước khi trả row: panel cụm → detail cần giữ label/leader,
    // và cờ catalyst phải được tính lại với clusterLeader thật (RADAR-05 E5).
    applyDetailCluster(row, await getClusterInfoForSymbol(symbol));

    const bullish: Bias[] = ["continuation", "flush-bounce", "breakout", "accumulation"];
    const bearish: Bias[] = ["exhaustion", "breakdown"];
    const atrValue = metrics.atrPct ? (metrics.price * metrics.atrPct) / 100 : null;
    const setup =
      atrValue && atrValue > 0 && (bullish.includes(row.bias) || bearish.includes(row.bias))
        ? buildSetup(bullish.includes(row.bias) ? "BULLISH" : "BEARISH", metrics.price, atrValue)
        : null;

    const liquidity = depth
      ? computeLiquidity(
          depth.bids.map(([price, qty]) => ({ price: Number(price), qty: Number(qty) })),
          depth.asks.map(([price, qty]) => ({ price: Number(price), qty: Number(qty) })),
          metrics.price
        )
      : null;

    return {
      row,
      setup,
      netRiskRewardRatio: setup
        ? netRiskReward((setup.entryLow + setup.entryHigh) / 2, setup.stopLoss, setup.tp1)
        : null,
      liquidity,
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
