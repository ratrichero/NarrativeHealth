// Core math functions for feature calculation - TypeScript implementation of pandas-like operations

export interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Calculate Exponential Moving Average
 */
export function calcEMA(series: number[], period: number): number[] {
  if (series.length === 0) return [];
  
  const multiplier = 2 / (period + 1);
  const ema: number[] = [];
  
  // First value is just the first data point (or SMA of first period)
  let currentEma = series[0];
  ema.push(currentEma);
  
  for (let i = 1; i < series.length; i++) {
    currentEma = (series[i] - currentEma) * multiplier + currentEma;
    ema.push(currentEma);
  }
  
  return ema;
}

/**
 * Calculate Rate of Change (%)
 */
export function calcROC(series: number[], period: number = 14): number {
  if (series.length < period + 1) return 0;
  
  const current = series[series.length - 1];
  const previous = series[series.length - 1 - period];
  
  if (previous === 0) return 0;
  
  return ((current - previous) / previous) * 100;
}

/**
 * Calculate Average True Range
 */
export function calcATR(
  high: number[],
  low: number[],
  close: number[],
  period: number = 14
): number {
  if (high.length < 2) return 0;
  
  const trueRanges: number[] = [];
  
  for (let i = 1; i < high.length; i++) {
    const prevClose = close[i - 1];
    const tr = Math.max(
      high[i] - low[i],
      Math.abs(high[i] - prevClose),
      Math.abs(low[i] - prevClose)
    );
    trueRanges.push(tr);
  }
  
  // Calculate EMA of true range
  const atrSeries = calcEMA(trueRanges, period);
  return atrSeries.length > 0 ? atrSeries[atrSeries.length - 1] : 0;
}

/**
 * Calculate Simple Moving Average
 */
export function calcSMA(series: number[], period: number): number {
  if (series.length < period) {
    return series.reduce((a, b) => a + b, 0) / series.length;
  }
  
  const slice = series.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Calculate Volume Moving Average
 */
export function calcVolumeMA(volume: number[], period: number = 20): number {
  return calcSMA(volume, period);
}

/**
 * Prepare price data series from raw data
 */
export function preparePriceSeries(data: PriceData[]): {
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
} {
  return {
    closes: data.map((d) => d.close),
    highs: data.map((d) => d.high),
    lows: data.map((d) => d.low),
    volumes: data.map((d) => d.volume),
  };
}
