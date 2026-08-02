// Technical Analysis Indicators

import { KlineData } from "./types";

/**
 * Simple Moving Average (SMA)
 */
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
 * Exponential Moving Average (EMA)
 */
export function ema(data: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);
  
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      result.push(data[i]);
    } else if (i < period - 1) {
      result.push(NaN);
    } else {
      const emaValue = (data[i] - result[i - 1]) * multiplier + result[i - 1];
      result.push(emaValue);
    }
  }
  return result;
}

/**
 * Relative Strength Index (RSI)
 */
export function rsi(data: number[], period: number = 14): number[] {
  const result: number[] = [];
  const changes: number[] = [];
  
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i] - data[i - 1]);
  }
  
  let gains: number[] = [];
  let losses: number[] = [];
  
  for (let i = 0; i < changes.length; i++) {
    gains.push(changes[i] > 0 ? changes[i] : 0);
    losses.push(changes[i] < 0 ? Math.abs(changes[i]) : 0);
  }
  
  let avgGain = 0;
  let avgLoss = 0;
  
  // First average
  if (gains.length >= period) {
    avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    result.push(100 - (100 / (1 + avgGain / avgLoss)));
  } else {
    result.push(NaN);
  }
  
  // Smoothed RSI
  for (let i = period; i < changes.length; i++) {
    avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
    avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
    
    const rs = avgGain / avgLoss;
    result.push(100 - (100 / (1 + rs)));
  }
  
  // Fill beginning with NaN
  while (result.length < data.length) {
    result.unshift(NaN);
  }
  
  return result;
}

/**
 * MACD (Moving Average Convergence Divergence)
 */
export function macd(data: number[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9): {
  macd: number[];
  signal: number[];
  histogram: number[];
} {
  const fastEma = ema(data, fastPeriod);
  const slowEma = ema(data, slowPeriod);
  
  const macdLine: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (isNaN(fastEma[i]) || isNaN(slowEma[i])) {
      macdLine.push(NaN);
    } else {
      macdLine.push(fastEma[i] - slowEma[i]);
    }
  }
  
  const signalLine = ema(macdLine.filter(v => !isNaN(v)), signalPeriod);
  const histogram: number[] = [];
  
  let signalIndex = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (isNaN(macdLine[i])) {
      histogram.push(NaN);
    } else if (signalIndex < signalLine.length) {
      histogram.push(macdLine[i] - signalLine[signalIndex]);
      signalIndex++;
    } else {
      histogram.push(NaN);
    }
  }
  
  return {
    macd: macdLine,
    signal: signalLine,
    histogram,
  };
}

/**
 * Average True Range (ATR)
 */
export function atr(data: KlineData[], period: number = 14): number[] {
  const tr: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      tr.push(data[i].high - data[i].low);
    } else {
      const highLow = data[i].high - data[i].low;
      const highClose = Math.abs(data[i].high - data[i - 1].close);
      const lowClose = Math.abs(data[i].low - data[i - 1].close);
      tr.push(Math.max(highLow, highClose, lowClose));
    }
  }
  
  const atrValues: number[] = [];
  let atrSum = 0;
  
  for (let i = 0; i < tr.length; i++) {
    if (i < period - 1) {
      atrValues.push(NaN);
      atrSum += tr[i];
    } else if (i === period - 1) {
      atrSum += tr[i];
      atrValues.push(atrSum / period);
    } else {
      const atrValue = ((atrValues[i - 1] * (period - 1)) + tr[i]) / period;
      atrValues.push(atrValue);
    }
  }
  
  return atrValues;
}

/**
 * Average Directional Index (ADX)
 */
export function adx(data: KlineData[], period: number = 14): number[] {
  const tr: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      tr.push(data[i].high - data[i].low);
      plusDm.push(0);
      minusDm.push(0);
    } else {
      const highLow = data[i].high - data[i].low;
      const highClose = Math.abs(data[i].high - data[i - 1].close);
      const lowClose = Math.abs(data[i].low - data[i - 1].close);
      tr.push(Math.max(highLow, highClose, lowClose));
      
      const upMove = data[i].high - data[i - 1].high;
      const downMove = data[i - 1].low - data[i].low;
      
      if (upMove > downMove && upMove > 0) {
        plusDm.push(upMove);
      } else {
        plusDm.push(0);
      }
      
      if (downMove > upMove && downMove > 0) {
        minusDm.push(downMove);
      } else {
        minusDm.push(0);
      }
    }
  }
  
  const smoothedTR = ema(tr, period);
  const smoothedPlusDM = ema(plusDm, period);
  const smoothedMinusDM = ema(minusDm, period);
  
  const plusDI: number[] = [];
  const minusDI: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    if (smoothedTR[i] === 0 || isNaN(smoothedTR[i])) {
      plusDI.push(NaN);
      minusDI.push(NaN);
    } else {
      plusDI.push((smoothedPlusDM[i] / smoothedTR[i]) * 100);
      minusDI.push((smoothedMinusDM[i] / smoothedTR[i]) * 100);
    }
  }
  
  const dx: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (isNaN(plusDI[i]) || isNaN(minusDI[i])) {
      dx.push(NaN);
    } else {
      const diDiff = Math.abs(plusDI[i] - minusDI[i]);
      const diSum = plusDI[i] + minusDI[i];
      dx.push(diSum === 0 ? 0 : (diDiff / diSum) * 100);
    }
  }
  
  return ema(dx, period);
}

/**
 * Bollinger Bands
 */
export function bollingerBands(data: number[], period: number = 20, stdDev: number = 2): {
  upper: number[];
  middle: number[];
  lower: number[];
} {
  const middle = sma(data, period);
  const upper: number[] = [];
  const lower: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
    } else {
      const slice = data.slice(i - period + 1, i + 1);
      const mean = middle[i];
      const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
      const std = Math.sqrt(variance);
      
      upper.push(mean + (std * stdDev));
      lower.push(mean - (std * stdDev));
    }
  }
  
  return { upper, middle, lower };
}

/**
 * Volume Weighted Average Price (VWAP)
 */
export function vwap(data: KlineData[]): number[] {
  const result: number[] = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  
  for (let i = 0; i < data.length; i++) {
    const typicalPrice = (data[i].high + data[i].low + data[i].close) / 3;
    cumulativeTPV += typicalPrice * data[i].volume;
    cumulativeVolume += data[i].volume;
    
    result.push(cumulativeVolume === 0 ? 0 : cumulativeTPV / cumulativeVolume);
  }
  
  return result;
}

/**
 * Stochastic Oscillator
 */
export function stochastic(data: KlineData[], kPeriod: number = 14, dPeriod: number = 3): {
  k: number[];
  d: number[];
} {
  const k: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    if (i < kPeriod - 1) {
      k.push(NaN);
    } else {
      const slice = data.slice(i - kPeriod + 1, i + 1);
      const high = Math.max(...slice.map(d => d.high));
      const low = Math.min(...slice.map(d => d.low));
      
      if (high === low) {
        k.push(50);
      } else {
        k.push(((data[i].close - low) / (high - low)) * 100);
      }
    }
  }
  
  const d = sma(k.filter(v => !isNaN(v)), dPeriod);
  
  // Pad d array to match length
  const paddedD: number[] = [];
  let dIndex = 0;
  for (let i = 0; i < k.length; i++) {
    if (isNaN(k[i])) {
      paddedD.push(NaN);
    } else if (dIndex < d.length) {
      paddedD.push(d[dIndex]);
      dIndex++;
    } else {
      paddedD.push(NaN);
    }
  }
  
  return { k, d: paddedD };
}

/**
 * Commodity Channel Index (CCI)
 */
export function cci(data: KlineData[], period: number = 20): number[] {
  const typicalPrices: number[] = [];
  for (const candle of data) {
    typicalPrices.push((candle.high + candle.low + candle.close) / 3);
  }
  
  const smaTP = sma(typicalPrices, period);
  const result: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const slice = typicalPrices.slice(i - period + 1, i + 1);
      const mean = smaTP[i];
      const meanDeviation = slice.reduce((sum, val) => sum + Math.abs(val - mean), 0) / period;
      
      result.push(meanDeviation === 0 ? 0 : (typicalPrices[i] - mean) / (0.015 * meanDeviation));
    }
  }
  
  return result;
}