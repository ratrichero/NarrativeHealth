// Momentum score calculation

import { calcROC, calcATR } from "./calculator";

export interface MomentumResult {
  score: number;
  detail: {
    roc_14: number;
    atr_14: number;
    atr_pct: number;
    roc_component: number;
    atr_component: number;
  };
}

/**
 * Calculate momentum score based on ROC and ATR
 */
export function calculateMomentumScore(
  closes: number[],
  highs: number[],
  lows: number[]
): MomentumResult {
  if (closes.length < 15) {
    return {
      score: 50,
      detail: {
        roc_14: 0,
        atr_14: 0,
        atr_pct: 0,
        roc_component: 50,
        atr_component: 50,
      },
    };
  }

  const roc14 = calcROC(closes, 14);
  const atr14 = calcATR(highs, lows, closes, 14);
  const price = closes[closes.length - 1];
  const atrPct = price > 0 ? (atr14 / price) * 100 : 0;

  const rocComponent = scoreROC(roc14);
  const atrComponent = scoreATR(atrPct);

  const rawScore = rocComponent * 0.6 + atrComponent * 0.4;
  const score = Math.max(0, Math.min(100, rawScore));

  return {
    score,
    detail: {
      roc_14: Number(roc14.toFixed(2)),
      atr_14: Number(atr14.toFixed(8)),
      atr_pct: Number(atrPct.toFixed(2)),
      roc_component: rocComponent,
      atr_component: atrComponent,
    },
  };
}

function scoreROC(v: number): number {
  if (v > 30) return 95;
  if (v > 20) return 85;
  if (v > 10) return 75;
  if (v > 5) return 65;
  if (v > 0) return 55;
  if (v > -5) return 45;
  if (v > -10) return 35;
  if (v > -20) return 25;
  return 15;
}

function scoreATR(v: number): number {
  if (v > 15) return 80;
  if (v > 10) return 70;
  if (v > 5) return 60;
  if (v > 2) return 50;
  return 35;
}
