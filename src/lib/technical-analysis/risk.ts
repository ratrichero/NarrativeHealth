// Risk Management System

import { KlineData, RiskLevels, MarketRegime, RegimeType } from "./types";
import { atr } from "./indicators";

function getTpMultipliers(strength: number): [number, number, number] {
  if (strength >= 65) return [2.0, 4.0, 6.0];
  if (strength >= 40) return [1.8, 3.2, 5.0];
  return [1.5, 2.5, 4.0];
}

function getSlMultiplier(strength: number): number {
  if (strength >= 65) return 2.0;
  if (strength >= 40) return 1.8;
  return 1.5;
}

function applyRegimeToMultipliers(
  mults:  [number, number, number],
  slMult: number,
  regime: MarketRegime
): { tp: [number, number, number]; sl: number } {
  let tp = [...mults] as [number, number, number];
  let sl = slMult;

  switch (regime.type) {
    case RegimeType.VOLATILE:
      tp = tp.map(m => m * 1.20) as [number, number, number];
      sl = sl * 1.35;
      break;
    case RegimeType.RANGING:
      tp = [tp[0] * 0.70, tp[0] * 1.30, tp[1]];
      sl = sl * 0.80;
      break;
    case RegimeType.BREAKOUT:
      tp = tp.map(m => m * 1.30) as [number, number, number];
      sl = sl * 0.90;
      break;
    default:
      break;
  }

  return { tp, sl };
}

/**
 * Position sizing: 1% account risk rule, cap 20%
 */
function calcPositionSize(
  price:      number,
  slDistance: number,
  accountSize: number = 10_000,
  riskPct:    number  = 1.0
): number {
  if (slDistance <= 0 || price <= 0) return 0;
  const riskAmount   = accountSize * (riskPct / 100);
  const units        = riskAmount / slDistance;
  const positionVal  = units * price;
  return Math.min((positionVal / accountSize) * 100, 20.0);
}

export function calculateRiskLevels(
  data:          KlineData[],
  direction:     "LONG" | "SHORT" | "NEUTRAL",
  compositeScore: number,
  regime?:       MarketRegime
): RiskLevels | undefined {
  if (direction === "NEUTRAL") return undefined;

  const closes    = data.map(d => d.close);
  const atrValues = atr(data, 14);
  const price     = closes[closes.length - 1];
  const refAtr    = atrValues[atrValues.length - 1] || 0;

  if (refAtr === 0 || price === 0) return undefined;

  // strength is abs(compositeScore) already on 0-100 scale
  const strength = Math.min(Math.abs(compositeScore) * 100, 100);

  const baseTpMults = getTpMultipliers(strength);
  const baseSlMult  = getSlMultiplier(strength);

  const { tp: tpMults, sl: slMult } = regime
    ? applyRegimeToMultipliers(baseTpMults, baseSlMult, regime)
    : { tp: baseTpMults, sl: baseSlMult };

  const [tp1M, tp2M, tp3M] = tpMults;
  const slDistance = slMult * refAtr;

  let entry:  number;
  let stopLoss: number;
  let tp1: number;
  let tp2: number;
  let tp3: number;

  if (direction === "LONG") {
    entry    = price;
    stopLoss = price - slDistance;
    tp1      = price + tp1M * refAtr;
    tp2      = price + tp2M * refAtr;
    tp3      = price + tp3M * refAtr;
  } else {
    entry    = price;
    stopLoss = price + slDistance;
    tp1      = price - tp1M * refAtr;
    tp2      = price - tp2M * refAtr;
    tp3      = price - tp3M * refAtr;
  }

  const slPct  = (slDistance / price) * 100;
  const rrRatio= tp1M / slMult;
  const suggestedPositionPct = calcPositionSize(price, slDistance);

  return {
    entry,
    stopLoss,
    tp1,
    tp2,
    tp3,
    slPct,
    rrRatio,
    refAtr,
    suggestedPositionPct,
  };
}

export function validateRiskLevels(risk: RiskLevels): boolean {
  if (risk.slPct > 5)          return false;
  if (risk.rrRatio < 1)        return false;
  if (risk.tp1 === risk.tp2)   return false;
  if (risk.tp2 === risk.tp3)   return false;
  return true;
}

export function calculatePositionSize(
  accountBalance: number,
  riskPerTrade:   number,
  riskLevels:     RiskLevels
): number {
  const riskAmount = accountBalance * (riskPerTrade / 100);
  return riskAmount / riskLevels.slPct;
}