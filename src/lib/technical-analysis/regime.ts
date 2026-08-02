// Market Regime Detection

import { KlineData, MarketRegime, RegimeType } from "./types";
import { adx, atr, sma, ema } from "./indicators";

/**
 * Detect market regime based on technical indicators
 */
export function detectMarketRegime(data: KlineData[]): MarketRegime {
  if (data.length < 50) {
    return {
      type: RegimeType.TRANSITIONING,
      adx: 0,
      atrPct: 0,
      efficiencyRatio: 0,
      volSurge: 1,
      pricePosition: 0.5,
      signalMultiplier: 1,
      indicatorBias: "neutral",
    };
  }

  const closes = data.map(d => d.close);
  const atrValues = atr(data, 14);
  const adxValues = adx(data, 14);
  
  const currentPrice = closes[closes.length - 1];
  const currentATR = atrValues[atrValues.length - 1] || 0;
  const currentADX = adxValues[adxValues.length - 1] || 0;
  
  // Calculate ATR as percentage of price
  const atrPct = currentPrice > 0 ? (currentATR / currentPrice) * 100 : 0;
  
  // Calculate price position in recent range
  const recentCloses = closes.slice(-20);
  const recentHigh = Math.max(...recentCloses);
  const recentLow = Math.min(...recentCloses);
  const pricePosition = recentHigh > recentLow ? 
    (currentPrice - recentLow) / (recentHigh - recentLow) : 0.5;
  
  // Calculate efficiency ratio (directional efficiency)
  const priceChange = Math.abs(closes[closes.length - 1] - closes[closes.length - 20]);
  const totalPath = closes.slice(-20).reduce((sum, val, i, arr) => {
    if (i === 0) return 0;
    return sum + Math.abs(val - arr[i - 1]);
  }, 0);
  const efficiencyRatio = totalPath > 0 ? priceChange / totalPath : 0;
  
  // Calculate volume surge
  const volumes = data.map(d => d.volume);
  const recentVolume = volumes[volumes.length - 1];
  const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volSurge = avgVolume > 0 ? recentVolume / avgVolume : 1;
  
  // Detect regime type - PRIORITY ORDER (Python source of truth)
  let regimeType: RegimeType;
  let signalMultiplier = 1;
  let indicatorBias = "neutral";
  
  // PRIORITY 1: Volatile (override everything)
  if (atrPct > 4.0) {
    regimeType = RegimeType.VOLATILE;
    signalMultiplier = 0.6;
    indicatorBias = "neutral";
  }
  // PRIORITY 2: Breakout (high volume + price at extremes)
  else if (volSurge > 2.5 && (pricePosition > 0.85 || pricePosition < 0.15)) {
    regimeType = RegimeType.BREAKOUT;
    signalMultiplier = 1.3;
    indicatorBias = "momentum";
  }
  // PRIORITY 3: Trending (strong ADX + efficient movement)
  else if (currentADX > 30 && efficiencyRatio > 0.5) {
    regimeType = pricePosition >= 0.5 
      ? RegimeType.TRENDING_UP 
      : RegimeType.TRENDING_DOWN;
    signalMultiplier = 1.2;
    indicatorBias = "trend";
  }
  // PRIORITY 4: Ranging (weak ADX + inefficient movement)
  else if (currentADX < 20 && efficiencyRatio < 0.3) {
    regimeType = RegimeType.RANGING;
    signalMultiplier = 0.8;
    indicatorBias = "oscillator";
  }
  // PRIORITY 5: Transitioning (default)
  else {
    regimeType = RegimeType.TRANSITIONING;
    signalMultiplier = 0.9;
    indicatorBias = "neutral";
  }
  
  return {
    type: regimeType,
    adx: currentADX,
    atrPct,
    efficiencyRatio,
    volSurge,
    pricePosition,
    signalMultiplier,
    indicatorBias,
  };
}

/**
 * Check if regime is suitable for trading
 */
export function isRegimeSuitableForTrading(regime: MarketRegime): boolean {
  // Avoid trading in extremely volatile or transitioning markets
  return regime.type !== RegimeType.TRANSITIONING && 
         regime.type !== RegimeType.VOLATILE &&
         regime.adx > 15 &&
         regime.efficiencyRatio > 0.3;
}

/**
 * Get recommended indicator weights based on regime
 */
export function getRegimeIndicatorWeights(regime: MarketRegime): string {
  return regime.indicatorBias;
}