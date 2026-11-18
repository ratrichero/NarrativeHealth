// RADAR-DEMO: dữ liệu mẫu CHỈ dùng khi RADAR_DEMO=1 (mặc định tắt).
// Mục đích: xem/kiểm tra UI ở môi trường server bị Binance geo-block (HTTP 451).
// Không bao giờ tự bật trong production; API trả cờ `demo` để UI cảnh báo.

import type { MarketMetrics } from "@/lib/market/metrics";
import { compositeScore, scoreForSide, type MoverSide } from "@/lib/market/scoring";
import { buildSetup } from "@/lib/market/setup";
import type { RadarDetail, RadarRow, RadarSnapshot } from "@/lib/market/radar";
import {
  HORIZONS,
  LEDGER_NOTE,
  summarizeByBias,
  type HorizonId,
  type HorizonResult,
  type RadarSignalRecord,
  type TrackRecordResult,
  type TrackedSignal,
} from "@/lib/market/ledger";
import type { Bias } from "@/lib/market/scoring";

interface DemoSpec {
  symbol: string;
  change: number;
  price: number;
  volume: number;
  volRatio: number;
  volZ: number;
  oi: number;
  funding: number;
  rsi: number;
  rangePos: number;
  atr: number;
  range7d: number;
  distance7d: number;
  breakout?: boolean;
  narratives?: string[];
}

const GAINERS: DemoSpec[] = [
  { symbol: "AERO", change: 28.4, price: 1.42, volume: 480e6, volRatio: 7.2, volZ: 6.1, oi: -6, funding: 0.00092, rsi: 83, rangePos: 0.97, atr: 5.2, range7d: 22, distance7d: -2, breakout: true },
  { symbol: "WIF", change: 17.6, price: 2.31, volume: 310e6, volRatio: 3.8, volZ: 4.2, oi: 14, funding: 0.00018, rsi: 69, rangePos: 0.78, atr: 4.1, range7d: 18, distance7d: -1, breakout: true },
  { symbol: "ENA", change: 11.2, price: 0.58, volume: 190e6, volRatio: 2.9, volZ: 2.8, oi: 9, funding: 0.00021, rsi: 64, rangePos: 0.71, atr: 3.4, range7d: 16, distance7d: 2, narratives: ["DeFi"] },
  { symbol: "SUI", change: 8.4, price: 3.12, volume: 260e6, volRatio: 2.4, volZ: 2.3, oi: 11, funding: 0.00012, rsi: 61, rangePos: 0.68, atr: 2.8, range7d: 15, distance7d: 3, narratives: ["Layer 1"] },
  { symbol: "TIA", change: 6.8, price: 4.85, volume: 120e6, volRatio: 1.9, volZ: 1.7, oi: 5, funding: 0.0003, rsi: 58, rangePos: 0.66, atr: 3.1, range7d: 14, distance7d: 4, narratives: ["Modular"] },
  { symbol: "JUP", change: 5.9, price: 0.92, volume: 88e6, volRatio: 1.6, volZ: 1.4, oi: 4, funding: 0.00025, rsi: 57, rangePos: 0.62, atr: 3.6, range7d: 17, distance7d: 3, narratives: ["DeFi"] },
  { symbol: "SEI", change: 5.2, price: 0.48, volume: 64e6, volRatio: 2.2, volZ: 2.1, oi: 7, funding: 0.00016, rsi: 59, rangePos: 0.6, atr: 3.9, range7d: 20, distance7d: 5, narratives: ["Layer 1"] },
  { symbol: "ORDI", change: 4.6, price: 38.2, volume: 71e6, volRatio: 3.4, volZ: 3.1, oi: 13, funding: 0.00008, rsi: 55, rangePos: 0.58, atr: 4.8, range7d: 19, distance7d: 2 },
  { symbol: "FET", change: 3.8, price: 1.24, volume: 55e6, volRatio: 1.4, volZ: 1.2, oi: 2, funding: 0.0001, rsi: 54, rangePos: 0.55, atr: 2.9, range7d: 13, distance7d: 4, narratives: ["AI"] },
  { symbol: "RNDR", change: 3.3, price: 6.4, volume: 48e6, volRatio: 1.2, volZ: 0.9, oi: -2, funding: 0.00006, rsi: 52, rangePos: 0.54, atr: 3.2, range7d: 14, distance7d: 6, narratives: ["AI"] },
  { symbol: "AR", change: 2.9, price: 21.6, volume: 31e6, volRatio: 1.1, volZ: 0.7, oi: 1, funding: 0.00004, rsi: 51, rangePos: 0.5, atr: 3.5, range7d: 16, distance7d: 7, narratives: ["Storage"] },
  { symbol: "GALA", change: 2.4, price: 0.031, volume: 40e6, volRatio: 2.6, volZ: 2.5, oi: 6, funding: 0.00009, rsi: 50, rangePos: 0.55, atr: 4.2, range7d: 18, distance7d: 5 },
];

const LOSERS: DemoSpec[] = [
  { symbol: "ZEC", change: -24.6, price: 48.2, volume: 620e6, volRatio: 4.8, volZ: 4.6, oi: -18, funding: -0.00085, rsi: 21, rangePos: 0.06, atr: 6.8, range7d: 30, distance7d: 18, narratives: ["Privacy"] },
  { symbol: "DASH", change: -15.2, price: 29.4, volume: 180e6, volRatio: 3.1, volZ: 3.2, oi: 12, funding: -0.0002, rsi: 34, rangePos: 0.12, atr: 4.6, range7d: 24, distance7d: 14 },
  { symbol: "UNI", change: -11.4, price: 7.85, volume: 140e6, volRatio: 2, volZ: 1.9, oi: 8, funding: -0.0001, rsi: 38, rangePos: 0.15, atr: 3.8, range7d: 19, distance7d: 11, narratives: ["DeFi"] },
  { symbol: "CRV", change: -9.6, price: 0.42, volume: 96e6, volRatio: 2.7, volZ: 2.8, oi: -9, funding: -0.0004, rsi: 28, rangePos: 0.1, atr: 5.1, range7d: 21, distance7d: 12 },
  { symbol: "LDO", change: -8.1, price: 1.62, volume: 74e6, volRatio: 1.9, volZ: 1.8, oi: 6, funding: -0.00015, rsi: 36, rangePos: 0.14, atr: 4.4, range7d: 20, distance7d: 10, narratives: ["LSD"] },
  { symbol: "APT", change: -7.2, price: 8.9, volume: 88e6, volRatio: 2.1, volZ: 2.2, oi: -4, funding: -0.0003, rsi: 30, rangePos: 0.12, atr: 3.7, range7d: 18, distance7d: 9, narratives: ["Layer 1"] },
  { symbol: "AVAX", change: -6.1, price: 24.3, volume: 150e6, volRatio: 1.5, volZ: 1.3, oi: 3, funding: -0.00008, rsi: 40, rangePos: 0.2, atr: 3.2, range7d: 15, distance7d: 8, narratives: ["Layer 1"] },
  { symbol: "DOT", change: -5.4, price: 5.85, volume: 62e6, volRatio: 1.4, volZ: 1.1, oi: 2, funding: -0.00005, rsi: 42, rangePos: 0.22, atr: 3, range7d: 14, distance7d: 7, narratives: ["Interop"] },
  { symbol: "ATOM", change: -4.8, price: 6.4, volume: 44e6, volRatio: 1.3, volZ: 0.9, oi: -1, funding: -0.00002, rsi: 44, rangePos: 0.25, atr: 2.8, range7d: 12, distance7d: 6, narratives: ["Interop"] },
  { symbol: "FIL", change: -4.2, price: 4.15, volume: 51e6, volRatio: 1.6, volZ: 1.4, oi: 4, funding: -0.00012, rsi: 39, rangePos: 0.18, atr: 3.4, range7d: 16, distance7d: 8, narratives: ["Storage"] },
  { symbol: "NEAR", change: -3.7, price: 3.95, volume: 38e6, volRatio: 1.2, volZ: 0.8, oi: -2, funding: -0.00006, rsi: 45, rangePos: 0.27, atr: 3.3, range7d: 13, distance7d: 7, narratives: ["AI"] },
  { symbol: "OP", change: -3.1, price: 1.18, volume: 42e6, volRatio: 1.5, volZ: 1.2, oi: 5, funding: -0.00011, rsi: 43, rangePos: 0.24, atr: 3.6, range7d: 15, distance7d: 6, narratives: ["Layer 2"] },
];

const UNUSUAL: DemoSpec[] = [
  { symbol: "ALT", change: 1.8, price: 0.42, volume: 46e6, volRatio: 3.2, volZ: 4.4, oi: 12, funding: 0.00005, rsi: 52, rangePos: 0.55, atr: 3.2, range7d: 8, distance7d: 4, narratives: ["Restaking"] },
  { symbol: "OM", change: 0.9, price: 1.06, volume: 38e6, volRatio: 2.6, volZ: 3.1, oi: 8, funding: 0.00002, rsi: 50, rangePos: 0.5, atr: 3.8, range7d: 9, distance7d: 3 },
  { symbol: "PENDLE", change: 2.2, price: 5.4, volume: 34e6, volRatio: 2.2, volZ: 2.6, oi: 6, funding: 0.00007, rsi: 54, rangePos: 0.58, atr: 3.1, range7d: 11, distance7d: 5, narratives: ["DeFi"] },
  { symbol: "PYTH", change: -1.1, price: 0.38, volume: 31e6, volRatio: 2.4, volZ: 3.3, oi: 9, funding: 0.00003, rsi: 47, rangePos: 0.45, atr: 4, range7d: 7, distance7d: 4, narratives: ["Oracle"] },
  { symbol: "STRK", change: 0.4, price: 0.52, volume: 28e6, volRatio: 1.8, volZ: 2.2, oi: 5, funding: 0.00001, rsi: 49, rangePos: 0.48, atr: 3.5, range7d: 13, distance7d: 6, narratives: ["Layer 2"] },
  { symbol: "BLUR", change: -2.6, price: 0.24, volume: 26e6, volRatio: 2, volZ: 2.4, oi: 4, funding: 0.00002, rsi: 43, rangePos: 0.4, atr: 4.1, range7d: 12, distance7d: 7 },
  { symbol: "ENS", change: 3.1, price: 24.8, volume: 22e6, volRatio: 3.1, volZ: 3.8, oi: 10, funding: 0.00006, rsi: 56, rangePos: 0.7, atr: 3.6, range7d: 14, distance7d: -0.5, breakout: true, narratives: ["Infra"] },
  { symbol: "GMX", change: 1.2, price: 28.4, volume: 21e6, volRatio: 2.5, volZ: 2.9, oi: 7, funding: 0.00004, rsi: 51, rangePos: 0.53, atr: 3.3, range7d: 9, distance7d: 2 },
  { symbol: "SNX", change: -0.7, price: 1.95, volume: 20e6, volRatio: 2.1, volZ: 2.2, oi: 3, funding: 0.00001, rsi: 48, rangePos: 0.46, atr: 3.7, range7d: 10, distance7d: 5 },
  { symbol: "1INCH", change: 2.8, price: 0.29, volume: 19e6, volRatio: 1.9, volZ: 2.3, oi: 5, funding: 0.00003, rsi: 53, rangePos: 0.57, atr: 4.2, range7d: 11, distance7d: 3 },
  { symbol: "COMP", change: -1.9, price: 42.6, volume: 18e6, volRatio: 1.7, volZ: 2, oi: 2, funding: 0.00002, rsi: 46, rangePos: 0.42, atr: 3, range7d: 12, distance7d: 6 },
];

function toMetrics(spec: DemoSpec, side: MoverSide): MarketMetrics {
  const bullish = side === "gainer" || spec.change >= 0;
  const high24h = spec.price * (1 + (1 - spec.rangePos) * 0.12 + 0.002);
  const low24h = spec.price * (1 - spec.rangePos * 0.12);
  const high7d = spec.breakout ? spec.price * 0.995 : spec.price * (1 + spec.distance7d / 100);
  const low7d = high7d * (1 - spec.range7d / 100);

  return {
    price: spec.price,
    changePct: spec.change,
    quoteVolume: spec.volume,
    trades: Math.round(spec.volume / 1200),
    high24h,
    low24h,
    rangePosition: spec.rangePos,
    distanceFromHighPct: Math.max(0, ((high24h - spec.price) / spec.price) * 100),
    volumeRatio7d: spec.volRatio,
    volumeZ: spec.volZ,
    atrPct: spec.atr,
    changeAtrMultiple: Math.abs(spec.change) / spec.atr,
    ema20: spec.price * (bullish ? 1.01 : 0.99),
    ema50: spec.price * (bullish ? 0.97 : 1.03),
    rsi14: spec.rsi,
    high7d,
    low7d,
    rangePct7d: spec.range7d,
    isBreakout7d: Boolean(spec.breakout),
    distanceFrom7dHighPct: spec.breakout ? -0.5 : spec.distance7d,
    fundingRate: spec.funding,
    oiChangePct: spec.oi,
    longShortRatio: null,
    listingAgeDays: 180,
  };
}

function toRow(spec: DemoSpec, side: MoverSide): RadarRow {
  const metrics = toMetrics(spec, side);
  const score = scoreForSide(metrics, side);
  return {
    symbol: spec.symbol,
    pair: `${spec.symbol}USDT`,
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
    inSystem: Boolean(spec.narratives?.length),
    narratives: spec.narratives ?? [],
    bias: score.bias,
    label: score.label,
    score: score.score,
    entryQuality: score.entryQuality,
    composite: compositeScore(score.score, score.entryQuality),
    reasons: score.reasons,
    warnings: score.warnings,
  };
}

const rowsCache = new Map<MoverSide, RadarRow[]>();

function demoRows(side: MoverSide): RadarRow[] {
  const hit = rowsCache.get(side);
  if (hit) return hit;
  const specs = side === "gainer" ? GAINERS : side === "loser" ? LOSERS : UNUSUAL;
  const rows = specs
    .map((spec) => toRow(spec, side))
    .sort((a, b) => b.composite - a.composite);
  rowsCache.set(side, rows);
  return rows;
}

export function buildDemoSnapshot(side: MoverSide): RadarSnapshot {
  return {
    side,
    rows: demoRows(side),
    market: {
      gainers: 182,
      losers: 96,
      totalVolumeUsd: 68.4e9,
      btcChangePct: 1.24,
      btcPrice: 94_250,
      universe: 278,
    },
    collectedAt: new Date().toISOString(),
    demo: true,
    notice:
      "Dữ liệu MẪU: server hiện tại không truy cập được Binance Futures (HTTP 451). " +
      "Đặt RADAR_DEMO=0 khi deploy ở mạng được Binance cho phép.",
  };
}

function seededRandom(seedText: string): () => number {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    seed ^= seedText.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
}

function demoChart(row: RadarRow): RadarDetail["chart"] {
  const rand = seededRandom(row.symbol);
  const start = row.price * (1 - row.changePct / 100);
  const step = (row.price - start) / 60;
  const candles: RadarDetail["chart"] = [];
  let previous = start;
  const now = Date.now();
  for (let i = 0; i < 60; i += 1) {
    const noise = (rand() - 0.5) * (row.price * 0.004);
    const close = i === 59 ? row.price : start + step * i + noise;
    candles.push({
      t: now - (59 - i) * 4 * 3_600_000,
      o: previous,
      h: Math.max(previous, close) * (1 + rand() * 0.002),
      l: Math.min(previous, close) * (1 - rand() * 0.002),
      c: close,
    });
    previous = close;
  }
  return candles;
}

interface DemoLedgerSpec {
  symbol: string;
  bias: Bias;
  score: number;
  entryQuality: number;
  price: number;
  base24h: number;
  ageHours: number;
}

// 14 tín hiệu mẫu với kết quả khác nhau để panel track record có dữ liệu đọc.
const DEMO_LEDGER: DemoLedgerSpec[] = [
  { symbol: "WIF", bias: "continuation", score: 82, entryQuality: 71, price: 2.31, base24h: 9.4, ageHours: 190 },
  { symbol: "ENA", bias: "continuation", score: 76, entryQuality: 64, price: 0.58, base24h: 5.2, ageHours: 96 },
  { symbol: "SUI", bias: "continuation", score: 71, entryQuality: 68, price: 3.12, base24h: -2.1, ageHours: 48 },
  { symbol: "AERO", bias: "exhaustion", score: 80, entryQuality: 22, price: 1.42, base24h: -6.8, ageHours: 190 },
  { symbol: "DASH", bias: "exhaustion", score: 63, entryQuality: 31, price: 29.4, base24h: 3.4, ageHours: 72 },
  { symbol: "ZEC", bias: "flush-bounce", score: 88, entryQuality: 46, price: 48.2, base24h: 11.6, ageHours: 190 },
  { symbol: "CRV", bias: "flush-bounce", score: 79, entryQuality: 52, price: 0.42, base24h: 4.8, ageHours: 30 },
  { symbol: "APT", bias: "breakdown", score: 84, entryQuality: 58, price: 8.9, base24h: -8.2, ageHours: 120 },
  { symbol: "LDO", bias: "breakdown", score: 69, entryQuality: 44, price: 1.62, base24h: 1.9, ageHours: 24 },
  { symbol: "ALT", bias: "accumulation", score: 74, entryQuality: 88, price: 0.42, base24h: 6.1, ageHours: 168 },
  { symbol: "OM", bias: "accumulation", score: 66, entryQuality: 81, price: 1.06, base24h: -1.4, ageHours: 60 },
  { symbol: "ENS", bias: "breakout", score: 78, entryQuality: 55, price: 24.8, base24h: 7.7, ageHours: 96 },
  { symbol: "COMP", bias: "neutral", score: 41, entryQuality: 62, price: 42.6, base24h: 0.8, ageHours: 72 },
  { symbol: "RNDR", bias: "neutral", score: 35, entryQuality: 57, price: 6.4, base24h: -0.6, ageHours: 24 },
];

function demoHorizons(base24h: number, bias: Bias): TrackedSignal["horizons"] {
  const factors: Record<HorizonId, number> = { "1h": 0.2, "4h": 0.45, "24h": 1, "3d": 1.7, "7d": 2.4 };
  const bullish = ["continuation", "flush-bounce", "breakout", "accumulation"].includes(bias);
  const bearish = ["exhaustion", "breakdown"].includes(bias);
  const result: TrackedSignal["horizons"] = {};

  for (const horizon of HORIZONS) {
    const ret = Number((base24h * factors[horizon.id]).toFixed(2));
    const btc = Number((0.9 * factors[horizon.id]).toFixed(2));
    const mfe = Number((Math.max(ret, 0) + Math.abs(base24h) * 0.35 + 1.2).toFixed(2));
    const mae = Number((Math.min(ret, 0) - Math.abs(base24h) * 0.3 - 1.1).toFixed(2));
    const tp1Hit = bullish ? mfe >= 3 : bearish ? mae <= -3 : null;
    const slHit = bullish ? mae <= -3 : bearish ? mfe >= 3 : null;
    result[horizon.id] = {
      returnPct: ret,
      btcReturnPct: btc,
      relativePct: Number((ret - btc).toFixed(2)),
      mfePct: mfe,
      maePct: mae,
      tp1Hit,
      slHit,
      firstEvent: tp1Hit && slHit ? "ambiguous" : tp1Hit ? "tp" : slHit ? "sl" : null,
      win: bullish ? ret > 0 : bearish ? ret < 0 : null,
      pending: false,
    } satisfies HorizonResult;
  }
  return result;
}

export function buildDemoTrackRecord(): TrackRecordResult {
  const now = Date.now();
  const tracked: TrackedSignal[] = DEMO_LEDGER.map((spec) => {
    const bullish = ["continuation", "flush-bounce", "breakout", "accumulation"].includes(spec.bias);
    const bearish = ["exhaustion", "breakdown"].includes(spec.bias);
    const setup =
      bullish || bearish
        ? buildSetup(bullish ? "BULLISH" : "BEARISH", spec.price, spec.price * 0.035)
        : null;
    const at = new Date(now - spec.ageHours * 3_600_000).toISOString();
    const record: RadarSignalRecord = {
      symbol: spec.symbol,
      side: bullish ? "gainer" : bearish ? "loser" : "unusual",
      bias: spec.bias,
      score: spec.score,
      entryQuality: spec.entryQuality,
      price: spec.price,
      at,
      btcPrice: 94_250,
      setup: setup
        ? {
            direction: setup.direction,
            entryLow: setup.entryLow,
            entryHigh: setup.entryHigh,
            tp1: setup.tp1,
            tp2: setup.tp2,
            stopLoss: setup.stopLoss,
          }
        : null,
      actionable: spec.bias !== "neutral" && spec.score >= 55,
    };
    return {
      ...record,
      ageHours: spec.ageHours,
      horizons: demoHorizons(spec.base24h, spec.bias),
    };
  });

  return {
    summaries: summarizeByBias(tracked),
    recent: [...tracked].sort((a, b) => a.ageHours - b.ageHours).slice(0, 20),
    total: tracked.length,
    actionable: tracked.filter((s) => s.actionable).length,
    note: `${LEDGER_NOTE} (Dữ liệu mẫu vì server bị Binance geo-block.)`,
    demo: true,
    evaluatedAt: new Date().toISOString(),
  };
}

export function getDemoDetail(rawSymbol: string): RadarDetail | null {
  const symbol = rawSymbol.toUpperCase().replace(/USDT$/, "");
  const all = [...demoRows("gainer"), ...demoRows("loser"), ...demoRows("unusual")];
  const row = all.find((r) => r.symbol === symbol);
  if (!row) return null;

  const bullish = ["continuation", "flush-bounce", "breakout", "accumulation"].includes(row.bias);
  const bearish = ["exhaustion", "breakdown"].includes(row.bias);
  const atrValue = row.atrPct ? (row.price * row.atrPct) / 100 : null;

  return {
    row,
    setup:
      atrValue && (bullish || bearish)
        ? buildSetup(bullish ? "BULLISH" : "BEARISH", row.price, atrValue)
        : null,
    chart: demoChart(row),
    asOf: new Date().toISOString(),
  };
}
