// Risk Management System

import { KlineData, RiskLevels } from "./types";
import { atr } from "./indicators";

/**
 * Calculate risk levels based on ATR and current price
 */
export function calculateRiskLevels(
  data: KlineData[],
  direction: "LONG" | "SHORT" | "NEUTRAL",
  compositeScore: number
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
  
  // Calculate stop loss based on ATR (1.5x ATR for stop loss)
  const atrMultiplier = 1.5;
  const stopLossDistance = currentATR * atrMultiplier;
  
  // Calculate take profit levels
  const tp1Distance = stopLossDistance * 1.5; // 1.5x risk
  const tp2Distance = stopLossDistance * 2.5; // 2.5x risk
  const tp3Distance = stopLossDistance * 4.0; // 4.0x risk
  
  let entry: number;
  let stopLoss: number;
  let tp1: number;
  let tp2: number;
  let tp3: number;
  
  if (direction === "LONG") {
    entry = currentPrice;
    stopLoss = currentPrice - stopLossDistance;
    tp1 = currentPrice + tp1Distance;
    tp2 = currentPrice + tp2Distance;
    tp3 = currentPrice + tp3Distance;
  } else {
    entry = currentPrice;
    stopLoss = currentPrice + stopLossDistance;
    tp1 = currentPrice - tp1Distance;
    tp2 = currentPrice - tp2Distance;
    tp3 = currentPrice - tp3Distance;
  }
  
  // Calculate percentages
  const slPct = (stopLossDistance / currentPrice) * 100;
  const rrRatio = tp1Distance / stopLossDistance;
  
  // Suggested position size based on signal strength
  const strength = Math.abs(compositeScore);
  let suggestedPositionPct = 0;
  
  if (strength > 0.7) {
    suggestedPositionPct = 2.0; // Strong signal - 2% position
  } else if (strength > 0.5) {
    suggestedPositionPct = 1.5; // Good signal - 1.5% position
  } else if (strength > 0.3) {
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