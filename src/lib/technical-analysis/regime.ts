// Market Regime Detection

import { KlineData, MarketRegime, RegimeType } from "./types";
import { adx, atr } from "./indicators";

export function detectMarketRegime(data: KlineData[]): MarketRegime {
  if (data.length < 50) {
    return {
      type:             RegimeType.TRANSITIONING,
      adx:              0,
      atrPct:           0,
      efficiencyRatio:  0,
      volSurge:         1,
      pricePosition:    0.5,
      signalMultiplier: 0.9,
      indicatorBias:    "neutral",
    };
  }

  const closes    = data.map(d => d.close);
  const atrValues = atr(data, 14);
  const adxValues = adx(data, 14);

  const currentPrice = closes[closes.length - 1];
  const currentATR   = atrValues[atrValues.length - 1] || 0;
  const currentADX   = adxValues[adxValues.length - 1] || 0;

  // ATR as % of price
  const atrPct = currentPrice > 0 ? (currentATR / currentPrice) * 100 : 0;

  // Price position in 20-period high/low range
  const recent20    = data.slice(-20);
  const high20      = Math.max(...recent20.map(d => d.high));
  const low20       = Math.min(...recent20.map(d => d.low));
  const pricePosition =
    high20 > low20 ? (currentPrice - low20) / (high20 - low20) : 0.5;

  // Kaufman Efficiency Ratio (20-bar)
  const n          = Math.min(20, closes.length - 1);
  const dirMove    = Math.abs(closes[closes.length - 1] - closes[closes.length - 1 - n]);
  let   pathLength = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    pathLength += Math.abs(closes[i] - closes[i - 1]);
  }
  const efficiencyRatio = pathLength > 0 ? dirMove / pathLength : 0;

  // Volume surge vs 20-bar average
  const volumes    = data.map(d => d.volume);
  const lastVol    = volumes[volumes.length - 1];
  const avgVol20   = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volSurge   = avgVol20 > 0 ? lastVol / avgVol20 : 1;

  // ── PRIORITY ORDER (matches Python exactly) ──

  let type:             RegimeType;
  let signalMultiplier: number;
  let indicatorBias:    string;

  // PRIORITY 1: Volatile
  if (atrPct > 4.0) {
    type             = RegimeType.VOLATILE;
    signalMultiplier = 0.6;
    indicatorBias    = "neutral";
  }
  // PRIORITY 2: Breakout
  else if (volSurge > 2.5 && (pricePosition > 0.85 || pricePosition < 0.15)) {
    type             = RegimeType.BREAKOUT;
    signalMultiplier = 1.3;
    indicatorBias    = "momentum";
  }
  // PRIORITY 3: Trending
  else if (currentADX > 30 && efficiencyRatio > 0.5) {
    type             = pricePosition >= 0.5
      ? RegimeType.TRENDING_UP
      : RegimeType.TRENDING_DOWN;
    signalMultiplier = 1.2;
    indicatorBias    = "trend";
  }
  // PRIORITY 4: Ranging
  else if (currentADX < 20 && efficiencyRatio < 0.3) {
    type             = RegimeType.RANGING;
    signalMultiplier = 0.8;
    indicatorBias    = "oscillator";
  }
  // PRIORITY 5: Transitioning
  else {
    type             = RegimeType.TRANSITIONING;
    signalMultiplier = 0.9;
    indicatorBias    = "neutral";
  }

  return {
    type,
    adx:             currentADX,
    atrPct,
    efficiencyRatio,
    volSurge,
    pricePosition,
    signalMultiplier,
    indicatorBias,
  };
}

export function isRegimeSuitableForTrading(regime: MarketRegime): boolean {
  return (
    regime.type !== RegimeType.TRANSITIONING &&
    regime.type !== RegimeType.VOLATILE      &&
    regime.adx  > 15                         &&
    regime.efficiencyRatio > 0.3
  );
}