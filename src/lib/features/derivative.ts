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

/**
 * Continuous OI scoring using tanh-based sigmoid.
 * Maps OI change % to a smooth score in [10, 90].
 * Neutral (0% change) maps to ~50.
 * Positive change → bullish (higher score).
 * Negative change → bearish (lower score).
 */
function scoreOIChange(pct: number): number {
  // tanh gives a smooth S-curve: [-∞,+∞] → [-1,+1]
  // Scale: 15% OI change ≈ tanh(1) ≈ 0.76
  const normalized = Math.tanh(pct / 15);
  // Map [-1,+1] → [10, 90], centered at 50
  return Math.round((50 + normalized * 40) * 10) / 10;
}

/**
 * Continuous funding rate scoring using linear mapping with soft bounds.
 * Maps funding rate to a smooth score in [15, 90].
 * Negative funding = bullish (shorts paying longs) → higher score.
 * Positive funding = bearish (longs paying shorts) → lower score.
 * Neutral (0) maps to ~52.5.
 */
function scoreFunding(rate: number): number {
  // Linear mapping: rate [-0.001, +0.001] → score [90, 15]
  // Center at rate=0 → score=52.5 (slightly bullish default)
  const clamped = Math.max(-0.001, Math.min(0.001, rate));
  return Math.round((52.5 - clamped * 37500) * 10) / 10;
}
