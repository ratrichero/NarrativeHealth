// Derivative score calculation (OI + Funding Rate)

export interface DerivativeResult {
  score: number;
  detail: {
    oi_current: number | null;
    oi_prev: number | null;
    oi_change_pct: number;
    funding_rate: number | null;
    oi_component: number;
    funding_component: number;
    accumulation_bonus: number;
    no_futures: boolean;
  };
}

/**
 * Calculate derivative score based on Open Interest and Funding Rate
 */
export function calculateDerivativeScore(
  oiCurrent: number | null,
  oiPrev: number | null,
  fundingRate: number | null,
  hasFutures: boolean = true
): DerivativeResult {
  // If coin doesn't have futures, return neutral score
  if (!hasFutures) {
    return {
      score: 50,
      detail: {
        oi_current: null,
        oi_prev: null,
        oi_change_pct: 0,
        funding_rate: null,
        oi_component: 50,
        funding_component: 50,
        accumulation_bonus: 0,
        no_futures: true,
      },
    };
  }

  // Calculate OI Change
  let oiChangePct = 0;
  if (oiCurrent && oiPrev && oiPrev !== 0) {
    oiChangePct = ((oiCurrent - oiPrev) / oiPrev) * 100;
  }

  const oiComponent = scoreOIChange(oiChangePct);

  // Funding Rate Component
  const fundingComponent = fundingRate !== null ? scoreFunding(fundingRate) : 55;

  // Accumulation Bonus: OI increasing while funding is negative (shorts paying longs)
  let accumulationBonus = 0;
  if (oiChangePct > 10 && fundingRate !== null && fundingRate < 0) {
    accumulationBonus = 10;
  }

  const rawScore = oiComponent * 0.5 + fundingComponent * 0.5 + accumulationBonus;
  const score = Math.max(0, Math.min(100, rawScore));

  return {
    score,
    detail: {
      oi_current: oiCurrent,
      oi_prev: oiPrev,
      oi_change_pct: Number(oiChangePct.toFixed(2)),
      funding_rate: fundingRate,
      oi_component: oiComponent,
      funding_component: fundingComponent,
      accumulation_bonus: accumulationBonus,
      no_futures: false,
    },
  };
}

function scoreOIChange(pct: number): number {
  if (pct > 20) return 90;
  if (pct > 10) return 75;
  if (pct > 0) return 60;
  if (pct > -10) return 40;
  return 20;
}

function scoreFunding(rate: number): number {
  // rate is decimal: -0.0105 = -1.05%
  if (rate < -0.0001) return 90; // Very negative = bullish (shorts paying longs heavily)
  if (rate < 0) return 75; // Slightly negative = bullish
  if (rate < 0.0002) return 55; // Neutral range
  if (rate < 0.0005) return 35; // Slightly positive = bearish
  return 15; // Very positive = bearish (longs paying shorts)
}
