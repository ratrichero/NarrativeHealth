// Technical Analysis Scoring System

import { KlineData, IndicatorResult, MarketRegime, BASE_GROUP_WEIGHTS, REGIME_GROUP_WEIGHTS } from "./types";
import { sma, ema, rsi, macd, bollingerBands, stochastic, cci, adx, atr, vwapRollingAnalysis } from "./indicators";
import { detectMarketRegime } from "./regime";

/**
 * Calculate trend score based on moving averages and ADX
 */
export function calculateTrendScore(data: KlineData[]): IndicatorResult {
  const closes = data.map(d => d.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const adxValues = adx(data, 14);
  
  const currentPrice = closes[closes.length - 1];
  const currentEMA20 = ema20[ema20.length - 1] || currentPrice;
  const currentEMA50 = ema50[ema50.length - 1] || currentPrice;
  const currentADX = adxValues[adxValues.length - 1] || 0;
  
  // Price vs EMAs
  const priceAboveEMA20 = currentPrice > currentEMA20;
  const priceAboveEMA50 = currentPrice > currentEMA50;
  const ema20AboveEMA50 = currentEMA20 > currentEMA50;
  
  // Calculate signal
  let signal = 0;
  if (priceAboveEMA20 && priceAboveEMA50 && ema20AboveEMA50) {
    signal = 0.8; // Strong uptrend
  } else if (priceAboveEMA20 && ema20AboveEMA50) {
    signal = 0.5; // Moderate uptrend
  } else if (!priceAboveEMA20 && !priceAboveEMA50 && !ema20AboveEMA50) {
    signal = -0.8; // Strong downtrend
  } else if (!priceAboveEMA20 && !ema20AboveEMA50) {
    signal = -0.5; // Moderate downtrend
  } else {
    signal = 0; // Neutral/sideways
  }
  
  // Adjust by ADX strength
  const adxMultiplier = Math.min(currentADX / 40, 1.5);
  signal *= adxMultiplier;
  
  return {
    name: "Trend",
    value: signal,
    signal: Math.max(-1, Math.min(1, signal)),
    weight: 0.3,
    description: `EMA cross: ${ema20AboveEMA50 ? 'Bullish' : 'Bearish'}, ADX: ${currentADX.toFixed(1)}`,
  };
}

/**
 * Calculate momentum score using RSI and MACD
 */
function rsiSmoothMapping(rsiVal: number, rsiSlope: number = 0): number {
  let base: number;
  
  if (rsiVal >= 80) {
    // Extreme overbought: -0.5 → -1.0
    base = -0.5 - (rsiVal - 80) / 20 * 0.5;
  } else if (rsiVal >= 70) {
    // Overbought: 0 → -0.5
    base = -(rsiVal - 70) / 10 * 0.5;
  } else if (rsiVal > 30) {
    // Neutral zone: linear ±0.4 (RSI=50 → 0, RSI=70 → -0.4, RSI=30 → +0.4)
    base = -(rsiVal - 50) / 50 * 0.4;
  } else if (rsiVal >= 20) {
    // Oversold: 0 → +0.5
    base = (30 - rsiVal) / 10 * 0.5;
  } else {
    // Extreme oversold: +0.5 → +1.0
    base = 0.5 + (20 - rsiVal) / 20 * 0.5;
  }
  
  // Slope adjustment: RSI đang tăng → thêm bullish bias
  const slopeAdj = Math.max(-0.2, Math.min(0.2, rsiSlope * 0.1));
  
  return Math.max(-1, Math.min(1, base + slopeAdj));
}

/**
 * Calculate momentum score using RSI and MACD
 */
export function calculateMomentumScore(data: KlineData[]): IndicatorResult {
  const closes = data.map(d => d.close);
  const rsiValues = rsi(closes, 14);
  const macdResult = macd(closes, 12, 26, 9);
  
  const currentRSI = rsiValues[rsiValues.length - 1] || 50;
  const currentMACD = macdResult.macd[macdResult.macd.length - 1] || 0;
  const currentSignal = macdResult.signal[macdResult.signal.length - 1] || 0;
  
  // Calculate RSI slope (4-bar lookback)
  const rsiSlope = rsiValues.length >= 5 
    ? rsiValues[rsiValues.length - 1] - rsiValues[rsiValues.length - 5]
    : 0;
  
  // RSI signal using smooth mapping
  const rsiSignal = rsiSmoothMapping(currentRSI, rsiSlope);
  
  return {
    name: "Momentum",
    value: rsiSignal,
    signal: Math.max(-1, Math.min(1, rsiSignal)),
    weight: 0.28,
    description: `RSI: ${currentRSI.toFixed(1)}, Slope: ${rsiSlope.toFixed(2)}`,
  };
}

/**
 * Calculate volume score using VWAP Rolling
 */
export function calculateVolumeScore(data: KlineData[]): IndicatorResult {
  const high = data.map(d => d.high);
  const low = data.map(d => d.low);
  const close = data.map(d => d.close);
  const volume = data.map(d => d.volume);
  
  const vwapResult = vwapRollingAnalysis(high, low, close, volume, 20);
  
  return {
    name: "Volume",
    value: vwapResult.value,
    signal: vwapResult.signal,
    weight: 0.35,
    description: vwapResult.description,
  };
}

/**
 * Calculate oscillator score using Stochastic and CCI
 */
export function calculateOscillatorScore(data: KlineData[]): IndicatorResult {
  const stoch = stochastic(data, 14, 3);
  const cciValues = cci(data, 20);
  
  const currentK = stoch.k[stoch.k.length - 1] || 50;
  const currentD = stoch.d[stoch.d.length - 1] || 50;
  const currentCCI = cciValues[cciValues.length - 1] || 0;
  
  // Stochastic signal
  let stochSignal = 0;
  if (currentK > 80 && currentD > 80) {
    stochSignal = -0.6; // Overbought
  } else if (currentK > currentD && currentK > 50) {
    stochSignal = 0.3; // Bullish crossover
  } else if (currentK < 20 && currentD < 20) {
    stochSignal = 0.6; // Oversold
  } else if (currentK < currentD && currentK < 50) {
    stochSignal = -0.3; // Bearish crossover
  }
  
  // CCI signal
  let cciSignal = 0;
  if (currentCCI > 100) {
    cciSignal = -0.4; // Overbought
  } else if (currentCCI < -100) {
    cciSignal = 0.4; // Oversold
  }
  
  // Combine signals
  const combinedSignal = (stochSignal + cciSignal) / 2;
  
  return {
    name: "Oscillator",
    value: combinedSignal,
    signal: Math.max(-1, Math.min(1, combinedSignal)),
    weight: 0.15,
    description: `Stoch K: ${currentK.toFixed(1)}, CCI: ${currentCCI.toFixed(1)}`,
  };
}

/**
 * Calculate pattern score using Bollinger Bands
 */
export function calculatePatternScore(data: KlineData[]): IndicatorResult {
  const closes = data.map(d => d.close);
  const bb = bollingerBands(closes, 20, 2);
  
  const currentPrice = closes[closes.length - 1];
  const upperBB = bb.upper[bb.upper.length - 1] || currentPrice;
  const lowerBB = bb.lower[bb.lower.length - 1] || currentPrice;
  const middleBB = bb.middle[bb.middle.length - 1] || currentPrice;
  
  // Bollinger Band position
  const bbPosition = (currentPrice - lowerBB) / (upperBB - lowerBB);
  
  let signal = 0;
  if (bbPosition > 0.9) {
    signal = -0.5; // Near upper band (potential reversal)
  } else if (bbPosition < 0.1) {
    signal = 0.5; // Near lower band (potential reversal)
  } else if (bbPosition > 0.7 && currentPrice > middleBB) {
    signal = 0.2; // Strong but not extreme
  } else if (bbPosition < 0.3 && currentPrice < middleBB) {
    signal = -0.2; // Weak but not extreme
  }
  
  return {
    name: "Pattern",
    value: signal,
    signal: Math.max(-1, Math.min(1, signal)),
    weight: 0.1,
    description: `BB position: ${(bbPosition * 100).toFixed(0)}%`,
  };
}

/**
 * Calculate composite score for a timeframe
 */
export function calculateTimeframeScore(data: KlineData[], regime: MarketRegime): {
  indicators: IndicatorResult[];
  groupScores: Record<string, number>;
  compositeScore: number;
  signal: string;
} {
  const indicators = [
    calculateTrendScore(data),
    calculateMomentumScore(data),
    calculateVolumeScore(data),
    calculateOscillatorScore(data),
    calculatePatternScore(data),
  ];
  
  // Get weights based on regime
  const weightKey = regime.indicatorBias;
  const weights = REGIME_GROUP_WEIGHTS[weightKey] || BASE_GROUP_WEIGHTS;
  
  // Calculate weighted score
  const groupScores: Record<string, number> = {};
  let compositeScore = 0;
  
  for (const indicator of indicators) {
    const weight = weights[indicator.name.toLowerCase() as keyof typeof weights] || indicator.weight;
    groupScores[indicator.name.toLowerCase()] = indicator.signal * weight;
    compositeScore += indicator.signal * weight;
  }
  
  // Apply regime multiplier
  compositeScore *= regime.signalMultiplier;
  
  // Determine signal
  let signal = "NEUTRAL";
  if (compositeScore > 0.6) {
    signal = "LONG";
  } else if (compositeScore > 0.3) {
    signal = "WEAK_LONG";
  } else if (compositeScore < -0.6) {
    signal = "SHORT";
  } else if (compositeScore < -0.3) {
    signal = "WEAK_SHORT";
  }
  
  return {
    indicators,
    groupScores,
    compositeScore: Math.max(-1, Math.min(1, compositeScore)),
    signal,
  };
}