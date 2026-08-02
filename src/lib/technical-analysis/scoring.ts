// Technical Analysis Scoring System

import { KlineData, IndicatorResult, MarketRegime, BASE_GROUP_WEIGHTS, REGIME_GROUP_WEIGHTS } from "./types";
import { sma, ema, rsi, macd, bollingerBands, stochastic, cci, adx, atr } from "./indicators";
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
export function calculateMomentumScore(data: KlineData[]): IndicatorResult {
  const closes = data.map(d => d.close);
  const rsiValues = rsi(closes, 14);
  const macdResult = macd(closes, 12, 26, 9);
  
  const currentRSI = rsiValues[rsiValues.length - 1] || 50;
  const currentMACD = macdResult.macd[macdResult.macd.length - 1] || 0;
  const currentSignal = macdResult.signal[macdResult.signal.length - 1] || 0;
  
  // RSI signal
  let rsiSignal = 0;
  if (currentRSI > 70) {
    rsiSignal = -0.6; // Overbought
  } else if (currentRSI > 60) {
    rsiSignal = -0.3; // Approaching overbought
  } else if (currentRSI < 30) {
    rsiSignal = 0.6; // Oversold
  } else if (currentRSI < 40) {
    rsiSignal = 0.3; // Approaching oversold
  } else {
    rsiSignal = 0; // Neutral
  }
  
  // MACD signal
  let macdSignal = 0;
  if (currentMACD > currentSignal && currentMACD > 0) {
    macdSignal = 0.5; // Bullish momentum
  } else if (currentMACD > currentSignal) {
    macdSignal = 0.3; // Bullish crossover
  } else if (currentMACD < currentSignal && currentMACD < 0) {
    macdSignal = -0.5; // Bearish momentum
  } else if (currentMACD < currentSignal) {
    macdSignal = -0.3; // Bearish crossover
  }
  
  // Combine signals
  const combinedSignal = (rsiSignal + macdSignal) / 2;
  
  return {
    name: "Momentum",
    value: combinedSignal,
    signal: Math.max(-1, Math.min(1, combinedSignal)),
    weight: 0.25,
    description: `RSI: ${currentRSI.toFixed(1)}, MACD: ${currentMACD.toFixed(4)}`,
  };
}

/**
 * Calculate volume score
 */
export function calculateVolumeScore(data: KlineData[]): IndicatorResult {
  const volumes = data.map(d => d.volume);
  const closes = data.map(d => d.close);
  
  const currentVolume = volumes[volumes.length - 1];
  const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
  
  const priceChange = closes[closes.length - 1] - closes[closes.length - 2];
  const priceChangePct = closes[closes.length - 2] > 0 ? (priceChange / closes[closes.length - 2]) * 100 : 0;
  
  // Volume analysis
  let signal = 0;
  if (volumeRatio > 1.5 && priceChangePct > 0) {
    signal = 0.7; // Strong buying volume
  } else if (volumeRatio > 1.2 && priceChangePct > 0) {
    signal = 0.4; // Moderate buying volume
  } else if (volumeRatio > 1.5 && priceChangePct < 0) {
    signal = -0.7; // Strong selling volume
  } else if (volumeRatio > 1.2 && priceChangePct < 0) {
    signal = -0.4; // Moderate selling volume
  } else if (volumeRatio < 0.8) {
    signal = -0.2; // Low volume, weak conviction
  } else {
    signal = 0; // Normal volume
  }
  
  return {
    name: "Volume",
    value: signal,
    signal: Math.max(-1, Math.min(1, signal)),
    weight: 0.2,
    description: `Vol ratio: ${volumeRatio.toFixed(2)}x`,
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
 * Calculate pattern score (simplified)
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