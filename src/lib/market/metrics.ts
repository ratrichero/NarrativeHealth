// RADAR-METRICS: chỉ số dẫn xuất cho Market Radar.
// Toàn bộ hàm ở đây là pure (trừ computeMarketMetrics chỉ ráp dữ liệu đã fetch)
// để scoring và API dùng lại được, test không cần network.

import type { KlineData } from "@/lib/collectors/binance";

export interface MarketMetrics {
  price: number;
  changePct: number;
  quoteVolume: number;
  trades: number;
  high24h: number;
  low24h: number;
  /** 0 = sát đáy 24h, 1 = sát đỉnh 24h. */
  rangePosition: number;
  /** % giá đang cách đỉnh 24h (>= 0). */
  distanceFromHighPct: number;
  /** Volume 24h / trung bình 7 nến ngày đã đóng. */
  volumeRatio7d: number | null;
  /** Z-score của volume 24h so với 20 nến ngày đã đóng. */
  volumeZ: number | null;
  /** ATR(14) ngày / giá * 100. */
  atrPct: number | null;
  /** |change 24h| / ATR% — move đã đi bao nhiêu ATR. */
  changeAtrMultiple: number | null;
  ema20: number | null;
  ema50: number | null;
  /** EMA20 khung 1h — cấu trúc ngắn hạn, dùng cho xác nhận đảo chiều + giá vô hiệu bias. */
  ema20_1h?: number | null;
  rsi14: number | null;
  /** Đỉnh 7 nến ngày đã đóng (không tính nến đang chạy). */
  high7d: number | null;
  low7d: number | null;
  /** Biên độ 7 ngày / giá * 100 — càng nhỏ càng nén. */
  rangePct7d: number | null;
  /** Giá đã vượt đỉnh 7 ngày chưa. */
  isBreakout7d: boolean;
  /** % cách đỉnh 7 ngày; âm nghĩa là đã vượt đỉnh. */
  distanceFrom7dHighPct: number | null;
  fundingRate: number | null;
  oiChangePct: number | null;
  longShortRatio: number | null;
  listingAgeDays: number | null;
  /** 1h impulse: move bắt đầu cách đây bao lâu (giờ). */
  impulseAgeHours?: number | null;
  /** Giá đã đi bao nhiêu ATR kể từ origin của impulse. */
  impulseExtensionAtr?: number | null;
  /** Số nến 1h đang consolidation sau impulse. */
  impulseConsolidationBars?: number | null;
  /** Có retest EMA20 1h trong impulse không. */
  impulseRetestEma20?: boolean | null;
  /** Volume đỉnh impulse / baseline 1h. */
  impulseVolumeRatio?: number | null;
  /** Spot dẫn perp trong 24h. */
  spotLed?: boolean | null;
  /** Chênh lệch 24h so với BTC. */
  relativeStrengthPct?: number | null;
}

export interface MarketMetricsInput {
  price: number;
  changePct: number;
  quoteVolume: number;
  trades: number;
  high24h: number;
  low24h: number;
  dailyCandles: KlineData[];
  h4Candles: KlineData[];
  hourlyCandles?: KlineData[];
  fundingRate: number | null;
  oiHistory: { timestamp: number; openInterest: number }[];
  longShortRatio?: number | null;
  listingAgeDays: number | null;
  spotLed?: boolean | null;
  relativeStrengthPct?: number | null;
}

export function emaLast(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  for (let i = period; i < values.length; i += 1) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

/** RSI Wilder; trả null khi không đủ dữ liệu. */
export function rsiLast(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** ATR(period) / giá * 100, dùng nến đã đóng. */
export function atrPctLast(candles: KlineData[], period = 14): number | null {
  const closed = candles.length > 1 ? candles.slice(0, -1) : candles;
  if (closed.length < period + 1) return null;

  const ranges: number[] = [];
  for (let i = 1; i < closed.length; i += 1) {
    const high = Number(closed[i].high);
    const low = Number(closed[i].low);
    const prevClose = Number(closed[i - 1].close);
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    if (Number.isFinite(tr)) ranges.push(tr);
  }
  const recent = ranges.slice(-period);
  if (recent.length < period) return null;
  const atr = recent.reduce((sum, v) => sum + v, 0) / recent.length;
  const price = Number(closed[closed.length - 1].close);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(atr)) return null;
  return (atr / price) * 100;
}

/** Volume ratio + z-score của volume hiện tại so với các nến ngày đã đóng. */
export function volumeStats(
  candles: KlineData[],
  currentQuoteVolume: number
): { ratio7d: number | null; z: number | null } {
  const closed = candles.length > 1 ? candles.slice(0, -1) : candles;
  const volumes = closed
    .map((c) => Number(c.quoteVolume))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (volumes.length < 3 || !Number.isFinite(currentQuoteVolume) || currentQuoteVolume <= 0) {
    return { ratio7d: null, z: null };
  }

  const last7 = volumes.slice(-7);
  const avg7 = last7.reduce((sum, v) => sum + v, 0) / last7.length;

  const last20 = volumes.slice(-20);
  const mean20 = last20.reduce((sum, v) => sum + v, 0) / last20.length;
  const variance = last20.reduce((sum, v) => sum + (v - mean20) ** 2, 0) / last20.length;
  const sd = Math.sqrt(variance);

  return {
    ratio7d: avg7 > 0 ? currentQuoteVolume / avg7 : null,
    z: sd > 0 ? (currentQuoteVolume - mean20) / sd : null,
  };
}

export function rangePosition(price: number, low: number, high: number): number {  if (!Number.isFinite(price) || !Number.isFinite(low) || !Number.isFinite(high) || high <= low) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, (price - low) / (high - low)));
}

function round(value: number | null, digits = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

export interface ImpulseMetrics {
  ageHours: number;
  extensionAtr: number;
  consolidationBars: number;
  retestEma20: boolean;
  volumeRatio: number;
  direction: "up" | "down";
}

/**
 * Tìm impulse gần nhất trên nến 1h: nến volume >=2.5× baseline, range >=0.8 ATR
 * và body >=0.3 ATR. Trả null nếu không có impulse trong 48h gần nhất.
 */
export function computeImpulse(hourlyCandles: KlineData[]): ImpulseMetrics | null {
  const closed = hourlyCandles.length > 1 ? hourlyCandles.slice(0, -1) : hourlyCandles;
  if (closed.length < 30) return null;

  const last = closed[closed.length - 1];
  const closes = closed.map((c) => Number(c.close)).filter(Number.isFinite);
  if (closes.length < 20) return null;

  const trueRanges: number[] = [];
  for (let i = closed.length - 14; i < closed.length; i += 1) {
    if (i <= 0) continue;
    const high = Number(closed[i].high);
    const low = Number(closed[i].low);
    const prev = Number(closed[i - 1].close);
    if ([high, low, prev].every(Number.isFinite)) {
      trueRanges.push(Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev)));
    }
  }
  if (trueRanges.length === 0) return null;
  const atr = trueRanges.reduce((s, v) => s + v, 0) / trueRanges.length;
  if (!Number.isFinite(atr) || atr <= 0) return null;

  const baselineBars = closed.slice(-48, -24);
  if (baselineBars.length < 8) return null;
  const baseline = baselineBars.reduce((s, c) => s + Number(c.quoteVolume), 0) / baselineBars.length;
  if (!Number.isFinite(baseline) || baseline <= 0) return null;

  let ignition = -1;
  for (let i = Math.max(24, closed.length - 48); i < closed.length; i += 1) {
    const c = closed[i];
    const open = Number(c.open);
    const close = Number(c.close);
    const high = Number(c.high);
    const low = Number(c.low);
    const vol = Number(c.quoteVolume);
    if (![open, close, high, low, vol].every(Number.isFinite)) continue;
    if (
      vol >= baseline * 2.5 &&
      high - low >= atr * 0.8 &&
      Math.abs(close - open) >= atr * 0.3
    ) {
      ignition = i;
    }
  }
  if (ignition < 0) return null;

  const startBar = closed[ignition];
  const startPrice = Number(startBar.open);
  const direction: "up" | "down" = Number(last.close) >= startPrice ? "up" : "down";

  let maxHigh = -Infinity;
  let minLow = Infinity;
  let maxVolume = 0;
  for (let i = ignition; i < closed.length; i += 1) {
    maxHigh = Math.max(maxHigh, Number(closed[i].high));
    minLow = Math.min(minLow, Number(closed[i].low));
    maxVolume = Math.max(maxVolume, Number(closed[i].quoteVolume));
  }
  const extreme = direction === "up" ? maxHigh : minLow;
  const extension = Math.abs(extreme - startPrice) / atr;

  let consolidationBars = 0;
  for (let i = closed.length - 1; i >= ignition; i -= 1) {
    const range = Number(closed[i].high) - Number(closed[i].low);
    if (range <= atr * 0.8) consolidationBars += 1;
    else break;
  }

  const ema = emaLast(closes, 20) ?? Number(last.close);
  let retest = false;
  for (let i = ignition + 1; i < closed.length; i += 1) {
    const low = Number(closed[i].low);
    const high = Number(closed[i].high);
    if (direction === "up" && low <= ema * 1.003 && Number(last.close) >= ema) retest = true;
    if (direction === "down" && high >= ema * 0.997 && Number(last.close) <= ema) retest = true;
  }

  return {
    ageHours: Number(Math.max(0, (last.closeTime - startBar.openTime) / 3_600_000).toFixed(1)),
    extensionAtr: Number(extension.toFixed(2)),
    consolidationBars,
    retestEma20: retest,
    volumeRatio: Number((maxVolume / baseline).toFixed(2)),
    direction,
  };
}

export function computeMarketMetrics(input: MarketMetricsInput): MarketMetrics {
  const closedDaily = input.dailyCandles.length > 1
    ? input.dailyCandles.slice(0, -1)
    : input.dailyCandles;

  const atr = atrPctLast(input.dailyCandles);
  const changeAbs = Math.abs(input.changePct);
  const changeAtrMultiple = atr && atr > 0 ? changeAbs / atr : null;

  const h4Closes = input.h4Candles.map((c) => Number(c.close)).filter(Number.isFinite);
  const ema20 = emaLast(h4Closes, 20);
  const ema50 = emaLast(h4Closes, 50);
  const rsi14 = rsiLast(h4Closes, 14);
  const hourlyCloses = (input.hourlyCandles ?? [])
    .map((candle) => Number(candle.close))
    .filter(Number.isFinite);
  const ema20_1h = emaLast(hourlyCloses, 20);

  const last7 = closedDaily.slice(-7);
  const high7d = last7.length > 0 ? Math.max(...last7.map((c) => Number(c.high))) : null;
  const low7d = last7.length > 0 ? Math.min(...last7.map((c) => Number(c.low))) : null;
  const rangePct7d =
    high7d !== null && low7d !== null && input.price > 0
      ? ((high7d - low7d) / input.price) * 100
      : null;
  const isBreakout7d = high7d !== null && input.price > high7d;
  const distanceFrom7dHighPct =
    high7d !== null && input.price > 0 ? ((high7d - input.price) / input.price) * 100 : null;

  const { ratio7d, z } = volumeStats(input.dailyCandles, input.quoteVolume);
  const impulse = computeImpulse(input.hourlyCandles ?? []);
  const relativeStrength = input.relativeStrengthPct ?? null;

  let oiChangePct: number | null = null;
  const oi = input.oiHistory.filter((p) => Number.isFinite(p.openInterest) && p.openInterest > 0);
  if (oi.length >= 2) {
    const first = oi[0].openInterest;
    const last = oi[oi.length - 1].openInterest;
    if (first > 0) oiChangePct = ((last - first) / first) * 100;
  }

  const high24h = input.high24h > 0 ? input.high24h : input.price;
  const low24h = input.low24h > 0 ? input.low24h : input.price;

  return {
    price: input.price,
    changePct: input.changePct,
    quoteVolume: input.quoteVolume,
    trades: input.trades,
    high24h,
    low24h,
    rangePosition: rangePosition(input.price, low24h, high24h),
    distanceFromHighPct: high24h > 0 ? Math.max(0, ((high24h - input.price) / input.price) * 100) : 0,
    volumeRatio7d: round(ratio7d, 2),
    volumeZ: round(z, 2),
    atrPct: round(atr, 2),
    changeAtrMultiple: round(changeAtrMultiple, 2),
    ema20: round(ema20, 8),
    ema50: round(ema50, 8),
    ema20_1h: round(ema20_1h, 8),
    rsi14: round(rsi14, 1),
    high7d: round(high7d, 8),
    low7d: round(low7d, 8),
    rangePct7d: round(rangePct7d, 2),
    isBreakout7d,
    distanceFrom7dHighPct: round(distanceFrom7dHighPct, 2),
    fundingRate: input.fundingRate,
    oiChangePct: round(oiChangePct, 2),
    longShortRatio: input.longShortRatio ?? null,
    listingAgeDays: input.listingAgeDays,
    impulseAgeHours: impulse?.ageHours ?? null,
    impulseExtensionAtr: impulse?.extensionAtr ?? null,
    impulseConsolidationBars: impulse?.consolidationBars ?? null,
    impulseRetestEma20: impulse?.retestEma20 ?? null,
    impulseVolumeRatio: impulse?.volumeRatio ?? null,
    spotLed: input.spotLed ?? null,
    relativeStrengthPct: relativeStrength,
  };
}
