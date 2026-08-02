// Technical Analysis Indicators

import { KlineData } from "./types";

// ═══════════════════════════════════════════════
// BASIC MATH HELPERS
// ═══════════════════════════════════════════════

export function sma(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
  }
  return result;
}

/**
 * EMA - ewm(span=period, adjust=False) matching Python pandas
 * alpha = 2 / (period + 1)
 */
export function ema(data: number[], period: number): number[] {
  const result: number[] = [];
  const alpha = 2 / (period + 1);
  let lastEma: number | undefined;

  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (!Number.isFinite(value)) {
      result.push(NaN);
      continue;
    }
    if (lastEma === undefined) {
      lastEma = value;
    } else {
      lastEma = alpha * value + (1 - alpha) * lastEma;
    }
    result.push(i < period - 1 ? NaN : lastEma);
  }
  return result;
}

function rollingSum(arr: number[], w: number): number[] {
  return arr.map((_, i) => {
    if (i < w - 1) return NaN;
    return arr.slice(i - w + 1, i + 1).reduce((a, b) => a + b, 0);
  });
}

function rollingStd(arr: number[], w: number): number[] {
  return arr.map((_, i) => {
    if (i < w - 1) return NaN;
    const slice = arr.slice(i - w + 1, i + 1);
    const mean  = slice.reduce((a, b) => a + b, 0) / w;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / w;
    return Math.sqrt(variance);
  });
}

function clip(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ═══════════════════════════════════════════════
// CORE INDICATORS
// ═══════════════════════════════════════════════

/**
 * RSI - ewm smoothing matching Python
 */
export function rsi(data: number[], period: number = 14): number[] {
  const result: number[] = new Array(data.length).fill(NaN);
  if (data.length < period + 1) return result;

  const alpha = 1 / period; // Wilder's smoothing = 1/period

  let avgGain = 0;
  let avgLoss = 0;

  // Seed with SMA of first period
  for (let i = 1; i <= period; i++) {
    const change = data[i] - data[i - 1];
    avgGain += change > 0 ? change : 0;
    avgLoss += change < 0 ? -change : 0;
  }
  avgGain /= period;
  avgLoss /= period;

  // First RSI value
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  // Smoothed RSI (Wilder's EMA = ewm span=period, adjust=False)
  for (let i = period + 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    const gain   = change > 0 ? change : 0;
    const loss   = change < 0 ? -change : 0;

    avgGain = alpha * gain + (1 - alpha) * avgGain;
    avgLoss = alpha * loss + (1 - alpha) * avgLoss;

    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

/**
 * RSI Smooth Mapping - Python v2.0 exact match
 * Không dùng step function mâu thuẫn
 */
export function rsiSmoothMapping(rsiVal: number, rsiSlope: number = 0): number {
  let base: number;

  if (rsiVal >= 80) {
    // Extreme overbought: -0.5 → -1.0
    base = -0.5 - (rsiVal - 80) / 20 * 0.5;
  } else if (rsiVal >= 70) {
    // Overbought: 0 → -0.5
    base = -(rsiVal - 70) / 10 * 0.5;
  } else if (rsiVal > 30) {
    // Neutral zone linear: RSI=50→0, RSI=70→-0.4, RSI=30→+0.4
    base = -(rsiVal - 50) / 50 * 0.4;
  } else if (rsiVal >= 20) {
    // Oversold: 0 → +0.5
    base = (30 - rsiVal) / 10 * 0.5;
  } else {
    // Extreme oversold: +0.5 → +1.0
    base = 0.5 + (20 - rsiVal) / 20 * 0.5;
  }

  const slopeAdj = clip(rsiSlope * 0.1, -0.2, 0.2);
  return clip(base + slopeAdj, -1, 1);
}

/**
 * MACD
 */
export function macd(
  data: number[],
  fastPeriod:   number = 12,
  slowPeriod:   number = 26,
  signalPeriod: number = 9
): { macdLine: number[]; signalLine: number[]; histogram: number[] } {
  const fastEma = ema(data, fastPeriod);
  const slowEma = ema(data, slowPeriod);

  const macdLine: number[] = data.map((_, i) =>
    isNaN(fastEma[i]) || isNaN(slowEma[i]) ? NaN : fastEma[i] - slowEma[i]
  );

  // Signal = EMA of MACD (only on valid values, then realign)
  const validMacd  = macdLine.filter(v => !isNaN(v));
  const signalRaw  = ema(validMacd, signalPeriod);

  const signalLine: number[] = new Array(macdLine.length).fill(NaN);
  let idx = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (!isNaN(macdLine[i])) {
      signalLine[i] = signalRaw[idx++] ?? NaN;
    }
  }

  const histogram = macdLine.map((m, i) =>
    isNaN(m) || isNaN(signalLine[i]) ? NaN : m - signalLine[i]
  );

  return { macdLine, signalLine, histogram };
}

/**
 * ATR
 */
export function atr(data: KlineData[], period: number = 14): number[] {
  const tr: number[] = data.map((d, i) => {
    if (i === 0) return d.high - d.low;
    return Math.max(
      d.high - d.low,
      Math.abs(d.high - data[i - 1].close),
      Math.abs(d.low  - data[i - 1].close)
    );
  });

  // EWM matching Python ewm(span=period, adjust=False)
  return ema(tr, period);
}

/**
 * ADX with +DI / -DI
 */
export function adxFull(data: KlineData[], period: number = 14): {
  adx: number[];
  plusDI: number[];
  minusDI: number[];
} {
  const tr: number[]      = [];
  const plusDm: number[]  = [];
  const minusDm: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      tr.push(data[i].high - data[i].low);
      plusDm.push(0);
      minusDm.push(0);
    } else {
      tr.push(Math.max(
        data[i].high - data[i].low,
        Math.abs(data[i].high - data[i - 1].close),
        Math.abs(data[i].low  - data[i - 1].close)
      ));
      const upMove   = data[i].high - data[i - 1].high;
      const downMove = data[i - 1].low - data[i].low;
      plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
  }

  const smoothTR  = ema(tr,      period);
  const smoothPDM = ema(plusDm,  period);
  const smoothMDM = ema(minusDm, period);

  const plusDI: number[]  = [];
  const minusDI: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (isNaN(smoothTR[i]) || smoothTR[i] === 0) {
      plusDI.push(NaN);
      minusDI.push(NaN);
    } else {
      plusDI.push((smoothPDM[i] / smoothTR[i]) * 100);
      minusDI.push((smoothMDM[i] / smoothTR[i]) * 100);
    }
  }

  const dx: number[] = plusDI.map((p, i) => {
    if (isNaN(p) || isNaN(minusDI[i])) return NaN;
    const diSum  = p + minusDI[i];
    const diDiff = Math.abs(p - minusDI[i]);
    return diSum === 0 ? 0 : (diDiff / diSum) * 100;
  });

  return {
    adx:     ema(dx, period),
    plusDI,
    minusDI,
  };
}

// Legacy single-output ADX for regime.ts
export function adx(data: KlineData[], period: number = 14): number[] {
  return adxFull(data, period).adx;
}

/**
 * Bollinger Bands
 */
export function bollingerBands(
  data: number[],
  period: number = 20,
  stdDev: number = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = sma(data, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
    } else {
      const slice    = data.slice(i - period + 1, i + 1);
      const mean     = middle[i];
      const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
      const std      = Math.sqrt(variance);
      upper.push(mean + std * stdDev);
      lower.push(mean - std * stdDev);
    }
  }
  return { upper, middle, lower };
}

/**
 * VWAP Rolling(20) - Crypto 24/7 (không có session reset)
 * Có ±2σ bands
 */
export function vwapRollingAnalysis(
  high:   number[],
  low:    number[],
  close:  number[],
  volume: number[],
  window: number = 20
): { value: number; signal: number; description: string } {
  const n    = close.length;
  const tp   = high.map((h, i) => (h + low[i] + close[i]) / 3);
  const tpVol= tp.map((t, i) => t * volume[i]);

  const rollTpVol = rollingSum(tpVol,   window);
  const rollVol   = rollingSum(volume,  window);
  const vwap      = rollTpVol.map((v, i) => v / (rollVol[i] + 1e-10));

  const vwapStd = rollingStd(tp, window);
  const upper2  = vwap.map((v, i) => v + 2 * vwapStd[i]);
  const lower2  = vwap.map((v, i) => v - 2 * vwapStd[i]);

  const price   = close[n - 1];
  const vwapVal = vwap[n - 1];
  const u2Val   = upper2[n - 1];
  const l2Val   = lower2[n - 1];

  const bandWidth = u2Val - l2Val;
  let signal: number;
  let position: number;

  if (bandWidth > 0 && Number.isFinite(bandWidth)) {
    position = (price - l2Val) / bandWidth;
    signal   = clip((position - 0.5) * 2, -1, 1);
  } else {
    position = 0.5;
    signal   = Math.sign(price - vwapVal) * 0.30;
  }

  const pctDiff = Math.abs((price - vwapVal) / (vwapVal || 1) * 100);

  return {
    value: Math.round(vwapVal * 1e6) / 1e6,
    signal,
    description:
      `Price ${price > vwapVal ? "above" : "below"} VWAP by ` +
      `${pctDiff.toFixed(2)}% | Band pos: ${(position * 100).toFixed(0)}%`,
  };
}

// Legacy cumulative VWAP (kept for other uses)
export function vwap(data: KlineData[]): number[] {
  let cTPV = 0;
  let cVol = 0;
  return data.map(d => {
    const tp = (d.high + d.low + d.close) / 3;
    cTPV += tp * d.volume;
    cVol += d.volume;
    return cVol === 0 ? 0 : cTPV / cVol;
  });
}

/**
 * Stochastic
 */
export function stochastic(
  data:    KlineData[],
  kPeriod: number = 14,
  dPeriod: number = 3
): { k: number[]; d: number[] } {
  const k: number[] = data.map((d, i) => {
    if (i < kPeriod - 1) return NaN;
    const slice  = data.slice(i - kPeriod + 1, i + 1);
    const high   = Math.max(...slice.map(x => x.high));
    const low    = Math.min(...slice.map(x => x.low));
    return high === low ? 50 : ((d.close - low) / (high - low)) * 100;
  });

  // D = SMA(3) of K — aligned to full array
  const validK    = k.filter(v => !isNaN(v));
  const dRaw      = sma(validK, dPeriod);
  const d: number[]= new Array(k.length).fill(NaN);
  let idx = 0;
  for (let i = 0; i < k.length; i++) {
    if (!isNaN(k[i])) d[i] = dRaw[idx++] ?? NaN;
  }

  return { k, d };
}

/**
 * CCI
 */
export function cci(data: KlineData[], period: number = 20): number[] {
  const tp   = data.map(d => (d.high + d.low + d.close) / 3);
  const smaTP= sma(tp, period);

  return tp.map((tpVal, i) => {
    if (i < period - 1) return NaN;
    const slice = tp.slice(i - period + 1, i + 1);
    const mean  = smaTP[i];
    const mad   = slice.reduce((s, v) => s + Math.abs(v - mean), 0) / period;
    return mad === 0 ? 0 : (tpVal - mean) / (0.015 * mad);
  });
}

/**
 * Williams %R
 */
export function williamsR(data: KlineData[], period: number = 14): number[] {
  return data.map((d, i) => {
    if (i < period - 1) return NaN;
    const slice = data.slice(i - period + 1, i + 1);
    const hh    = Math.max(...slice.map(x => x.high));
    const ll    = Math.min(...slice.map(x => x.low));
    return hh === ll ? -50 : -100 * (hh - d.close) / (hh - ll);
  });
}

/**
 * MFI - Money Flow Index
 */
export function mfi(data: KlineData[], period: number = 14): number[] {
  const tp  = data.map(d => (d.high + d.low + d.close) / 3);
  const mf  = tp.map((t, i) => t * data[i].volume);
  const result: number[] = new Array(data.length).fill(NaN);

  for (let i = period; i < data.length; i++) {
    let posMF = 0;
    let negMF = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (tp[j] > tp[j - 1])      posMF += mf[j];
      else if (tp[j] < tp[j - 1]) negMF += mf[j];
    }
    const mfr = negMF === 0 ? 100 : posMF / negMF;
    result[i] = 100 - 100 / (1 + mfr);
  }
  return result;
}

/**
 * OBV - On Balance Volume
 */
export function obv(data: KlineData[]): number[] {
  const result: number[] = [0];
  for (let i = 1; i < data.length; i++) {
    const prev = result[i - 1];
    if (data[i].close > data[i - 1].close)      result.push(prev + data[i].volume);
    else if (data[i].close < data[i - 1].close) result.push(prev - data[i].volume);
    else                                          result.push(prev);
  }
  return result;
}

/**
 * SuperTrend
 */
export function superTrend(
  data:       KlineData[],
  period:     number = 10,
  multiplier: number = 3.0
): { value: number[]; direction: number[] } {
  const atrVals = atr(data, period);
  const hl2     = data.map(d => (d.high + d.low) / 2);

  const upperBand = hl2.map((h, i) => h + multiplier * (atrVals[i] || 0));
  const lowerBand = hl2.map((h, i) => h - multiplier * (atrVals[i] || 0));

  const stValue:    number[] = new Array(data.length).fill(0);
  const stDirection:number[] = new Array(data.length).fill(-1);

  stValue[0]     = upperBand[0];
  stDirection[0] = -1;

  for (let i = 1; i < data.length; i++) {
    if (data[i].close > upperBand[i - 1]) {
      stDirection[i] = 1;
    } else if (data[i].close < lowerBand[i - 1]) {
      stDirection[i] = -1;
    } else {
      stDirection[i] = stDirection[i - 1];
    }
    stValue[i] = stDirection[i] === 1 ? lowerBand[i] : upperBand[i];
  }

  return { value: stValue, direction: stDirection };
}

/**
 * Heikin-Ashi
 */
export function heikinAshi(data: KlineData[]): {
  haOpen: number[];
  haClose: number[];
  haHigh: number[];
  haLow: number[];
} {
  const haClose = data.map(d => (d.open + d.high + d.low + d.close) / 4);
  const haOpen: number[] = [( data[0].open + data[0].close) / 2];

  for (let i = 1; i < data.length; i++) {
    haOpen.push((haOpen[i - 1] + haClose[i - 1]) / 2);
  }

  const haHigh = data.map((d, i) => Math.max(d.high, haOpen[i], haClose[i]));
  const haLow  = data.map((d, i) => Math.min(d.low,  haOpen[i], haClose[i]));

  return { haOpen, haClose, haHigh, haLow };
}

/**
 * Ichimoku Cloud
 */
export function ichimoku(data: KlineData[]): {
  tenkan:  number[];
  kijun:   number[];
  senkouA: number[];
  senkouB: number[];
} {
  const midpoint = (arr: KlineData[], period: number, i: number): number => {
    if (i < period - 1) return NaN;
    const slice = arr.slice(i - period + 1, i + 1);
    return (Math.max(...slice.map(d => d.high)) + Math.min(...slice.map(d => d.low))) / 2;
  };

  const tenkan  = data.map((_, i) => midpoint(data, 9,  i));
  const kijun   = data.map((_, i) => midpoint(data, 26, i));
  const senkouA = tenkan.map((t, i) =>
    isNaN(t) || isNaN(kijun[i]) ? NaN : (t + kijun[i]) / 2
  );
  const senkouB = data.map((_, i) => midpoint(data, 52, i));

  return { tenkan, kijun, senkouA, senkouB };
}

/**
 * Convert Binance kline data to standard format
 */
export function convertBinanceKlines(binanceKlines: unknown[]): KlineData[] {
  return (binanceKlines as any[])
    .map(k => ({
      openTime:    Number(Array.isArray(k) ? k[0] : k.openTime),
      open:        parseFloat(Array.isArray(k) ? k[1] : k.open),
      high:        parseFloat(Array.isArray(k) ? k[2] : k.high),
      low:         parseFloat(Array.isArray(k) ? k[3] : k.low),
      close:       parseFloat(Array.isArray(k) ? k[4] : k.close),
      volume:      parseFloat(Array.isArray(k) ? k[5] : k.volume),
      closeTime:   Number(Array.isArray(k) ? k[6] : k.closeTime),
      quoteVolume: parseFloat(Array.isArray(k) ? k[7] : k.quoteVolume),
    }))
    .filter(k =>
      Number.isFinite(k.openTime)  &&
      Number.isFinite(k.open)      &&
      Number.isFinite(k.high)      &&
      Number.isFinite(k.low)       &&
      Number.isFinite(k.close)     &&
      Number.isFinite(k.volume)    &&
      Number.isFinite(k.closeTime) &&
      Number.isFinite(k.quoteVolume)
    );
}