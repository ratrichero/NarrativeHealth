// Trend score calculation

import { calcEMA } from "./calculator";

export interface TrendResult {
  score: number;
  detail: {
    price: number;
    ema20: number;
    ema50: number;
    ema200: number;
    price_vs_ema20: boolean;
    price_vs_ema50: boolean;
    price_vs_ema200: boolean;
    ema20_vs_ema50: boolean;
    ema50_vs_ema200: boolean;
    score_breakdown: Record<string, number>;
  };
}

/**
 * Calculate trend score based on EMA relationships
 * @param closes Array of closing prices (at least 200 data points recommended)
 * @returns TrendResult with score and detail breakdown
 */
export function calculateTrendScore(closes: number[]): TrendResult {
  if (closes.length < 20) {
    return {
      score: 50,
      detail: {
        price: closes[closes.length - 1] || 0,
        ema20: 0,
        ema50: 0,
        ema200: 0,
        price_vs_ema20: false,
        price_vs_ema50: false,
        price_vs_ema200: false,
        ema20_vs_ema50: false,
        ema50_vs_ema200: false,
        score_breakdown: { base: 50, insufficient_data: 0 },
      },
    };
  }

  const ema20Series = calcEMA(closes, 20);
  const ema50Series = calcEMA(closes, Math.min(50, closes.length));
  const ema200Series = calcEMA(closes, Math.min(200, closes.length));

  const price = closes[closes.length - 1];
  const e20 = ema20Series[ema20Series.length - 1];
  const e50 = ema50Series[ema50Series.length - 1];
  const e200 = ema200Series[ema200Series.length - 1];

  const pVsE20 = price > e20;
  const pVsE50 = price > e50;
  const pVsE200 = price > e200;
  const e20E50 = e20 > e50;
  const e50E200 = e50 > e200;

  const breakdown: Record<string, number> = {
    base: 50,
    price_vs_ema20: pVsE20 ? 15 : -15,
    price_vs_ema50: pVsE50 ? 20 : -20,
    price_vs_ema200: pVsE200 ? 15 : -15,
    ema20_vs_ema50: e20E50 ? 5 : -5,
    ema50_vs_ema200: e50E200 ? 5 : -5,
  };

  const rawScore = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const score = Math.max(0, Math.min(100, rawScore));

  return {
    score,
    detail: {
      price: Number(price.toFixed(8)),
      ema20: Number(e20.toFixed(8)),
      ema50: Number(e50.toFixed(8)),
      ema200: Number(e200.toFixed(8)),
      price_vs_ema20: pVsE20,
      price_vs_ema50: pVsE50,
      price_vs_ema200: pVsE200,
      ema20_vs_ema50: e20E50,
      ema50_vs_ema200: e50E200,
      score_breakdown: breakdown,
    },
  };
}
