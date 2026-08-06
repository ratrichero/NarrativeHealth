// Risk Management System

import { KlineData, RiskLevels, MarketRegime, RegimeType } from "./types";
import { atr } from "./indicators";

// ── Constants ──────────────────────────────────────────
const MAX_SL_PCT = 5.0;   // Maximum 5% stop loss
const MIN_SL_PCT = 0.5;   // Minimum 0.5% stop loss
const MIN_RR_RATIO = 1.0; // Minimum 1:1 risk-reward

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

  // compositeScore đã là scale [-100, +100], dùng trực tiếp
  const strength = Math.min(Math.abs(compositeScore), 100);

  const baseTpMults = getTpMultipliers(strength);
  const baseSlMult  = getSlMultiplier(strength);

  const { tp: tpMults, sl: slMult } = regime
    ? applyRegimeToMultipliers(baseTpMults, baseSlMult, regime)
    : { tp: baseTpMults, sl: baseSlMult };

  const [tp1M, tp2M, tp3M] = tpMults;

  // ── Raw SL distance ──────────────────────────────────
  let slDistance = slMult * refAtr;
  const rawSlPct = (slDistance / price) * 100;

  // ── SL% Cap: clamp between MIN and MAX ───────────────
  if (rawSlPct > MAX_SL_PCT) {
    slDistance = price * (MAX_SL_PCT / 100);
  } else if (rawSlPct < MIN_SL_PCT) {
    slDistance = price * (MIN_SL_PCT / 100);
  }

  // ── TP distances ─────────────────────────────────────
  let tp1Dist = tp1M * refAtr;
  let tp2Dist = tp2M * refAtr;
  let tp3Dist = tp3M * refAtr;

  // ── R:R Floor: TP1 distance >= SL distance (R:R >= 1) ─
  if (tp1Dist < slDistance * MIN_RR_RATIO) {
    // Scale all TPs proportionally to maintain ratios
    const scaleFactor = (slDistance * MIN_RR_RATIO) / tp1Dist;
    tp1Dist *= scaleFactor;
    tp2Dist *= scaleFactor;
    tp3Dist *= scaleFactor;
  }

  // ── Calculate price levels ───────────────────────────
  let entry:    number;
  let stopLoss: number;
  let tp1:      number;
  let tp2:      number;
  let tp3:      number;

  if (direction === "LONG") {
    entry    = price;
    stopLoss = price - slDistance;
    tp1      = price + tp1Dist;
    tp2      = price + tp2Dist;
    tp3      = price + tp3Dist;
  } else {
    entry    = price;
    stopLoss = price + slDistance;
    tp1      = price - tp1Dist;
    tp2      = price - tp2Dist;
    tp3      = price - tp3Dist;
  }

  // ── Final calculations ───────────────────────────────
  const slPct   = (slDistance / price) * 100;
  const rrRatio = tp1Dist / slDistance;
  const suggestedPositionPct = calcPositionSize(price, slDistance);

  return {
    entry:                 Math.round(entry    * 1e8) / 1e8,
    stopLoss:              Math.round(stopLoss * 1e8) / 1e8,
    tp1:                   Math.round(tp1      * 1e8) / 1e8,
    tp2:                   Math.round(tp2      * 1e8) / 1e8,
    tp3:                   Math.round(tp3      * 1e8) / 1e8,
    slPct:                 Math.round(slPct  * 1000) / 1000,
    rrRatio:               Math.round(rrRatio * 100) / 100,
    refAtr:                refAtr,
    suggestedPositionPct:  Math.round(suggestedPositionPct * 100) / 100,
  };
}

export function validateRiskLevels(risk: RiskLevels): boolean {
  if (risk.slPct > MAX_SL_PCT)    return false;
  if (risk.rrRatio < MIN_RR_RATIO) return false;
  if (risk.tp1 === risk.tp2)       return false;
  if (risk.tp2 === risk.tp3)       return false;
  return true;
}

export function calculatePositionSize(
  accountBalance: number,
  riskPerTrade:   number,
  riskLevels:     RiskLevels
): number {
  if (riskLevels.slPct <= 0) return 0;
  const riskAmount = accountBalance * (riskPerTrade / 100);
  const slAbsolute = riskLevels.entry * (riskLevels.slPct / 100);
  return slAbsolute > 0 ? riskAmount / slAbsolute : 0;
}