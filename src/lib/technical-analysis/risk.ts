// Risk Management System

import { KlineData, RiskLevels, MarketRegime, RegimeType } from "./types";
import { atr } from "./indicators";

/**
 * Get TP multipliers based on signal strength
 */
function getTpMultipliers(strength: number): [number, number, number] {
  if (strength >= 65) return [2.0, 4.0, 6.0];
  if (strength >= 40) return [1.8, 3.2, 5.0];
  return [1.5, 2.5, 4.0];
}

/**
 * Apply regime adjustments to TP multipliers
 */
function applyRegimeToMultipliers(
  mults: [number, number, number],
  regime: MarketRegime
): [number, number, number] {
  switch (regime.type) {
    case RegimeType.VOLATILE:
      return mults.map(m => m * 1.20) as [number, number, number];
    case RegimeType.RANGING:
      return [mults[0] * 0.70, mults[0] * 1.30, mults[1]];
    case RegimeType.BREAKOUT:
      return mults.map(m => m * 1.30) as [number, number, number];
    default:
      return mults;
  }
}

/**
 * Calculate risk levels based on ATR and current price
 */
export function calculateRiskLevels(
  data: KlineData[],
  direction: "LONG" | "SHORT" | "NEUTRAL",
  compositeScore: number,
  regime?: MarketRegime
): RiskLevels | undefined {
  if (direction === "NEUTRAL") {
    return undefined;
  }
  
  const closes = data.map(d => d.close);
  const atrValues = atr(data, 14);
  
  const currentPrice = closes[closes.length - 1];
  const currentATR = atrValues[atrValues.length - 1] || 0;
  
  if (currentATR === 0 || currentPrice === 0) {
    return undefined;
  }
  
  // Calculate signal strength
  const strength = Math.abs(compositeScore) * 100;
  
  // Get TP multipliers based on strength
  const tpMults = getTpMultipliers(strength);
  
  // Apply regime adjustments if regime provided
  const adjustedMults = regime ? applyRegimeToMultipliers(tpMults, regime) : tpMults;
  const [tp1M, tp2M, tp3M] = adjustedMults;
  
  // Calculate stop loss based on ATR (1.5x ATR for stop loss)
  const atrMultiplier = 1.5;
  const stopLossDistance = currentATR * atrMultiplier;
  
  let entry: number;
  let stopLoss: number;
  let tp1: number;
  let tp2: number;
  let tp3: number;
  
  if (direction === "LONG") {
    entry = currentPrice;
    stopLoss = currentPrice - stopLossDistance;
    tp1 = currentPrice + tp1M * currentATR;
    tp2 = currentPrice + tp2M * currentATR;
    tp3 = currentPrice + tp3M * currentATR;
  } else {
    entry = currentPrice;
    stopLoss = currentPrice + stopLossDistance;
    tp1 = currentPrice - tp1M * currentATR;
    tp2 = currentPrice - tp2M * currentATR;
    tp3 = currentPrice - tp3M * currentATR;
  }
  
  // Calculate percentages
  const slPct = (stopLossDistance / currentPrice) * 100;
  const rrRatio = tp1M / atrMultiplier;
  
  // Suggested position size based on signal strength
  let suggestedPositionPct = 0;
  
  if (strength > 70) {
    suggestedPositionPct = 2.0; // Strong signal - 2% position
  } else if (strength > 50) {
    suggestedPositionPct = 1.5; // Good signal - 1.5% position
  } else if (strength > 30) {
    suggestedPositionPct = 1.0; // Moderate signal - 1% position
  } else {
    suggestedPositionPct = 0.5; // Weak signal - 0.5% position
  }
  
  return {
    entry,
    stopLoss,
    tp1,
    tp2,
    tp3,
    slPct,
    rrRatio,
    refAtr: currentATR,
    suggestedPositionPct,
  };
}

/**
 * Validate risk levels are reasonable
 */
export function validateRiskLevels(risk: RiskLevels): boolean {
  // Check if stop loss is too far (more than 5%)
  if (risk.slPct > 5) {
    return false;
  }
  
  // Check if risk-reward ratio is reasonable (at least 1:1)
  if (risk.rrRatio < 1) {
    return false;
  }
  
  // Check if take profits are in correct order
  if (risk.tp1 === risk.tp2 || risk.tp2 === risk.tp3) {
    return false;
  }
  
  return true;
}

/**
 * Adjust position size based on account risk
 */
export function calculatePositionSize(
  accountBalance: number,
  riskPerTrade: number,
  riskLevels: RiskLevels
): number {
  const riskAmount = accountBalance * (riskPerTrade / 100);
  const positionSize = riskAmount / riskLevels.slPct;
  
  return positionSize;
}