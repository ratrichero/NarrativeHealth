// P6 Feature Engine — Orchestrator
// Authority: P6-02B (Derived Feature Contract), P6-02C (Aggregation), P6-02C2 (Planner Decisions)
// PD-7: Builds new alongside legacy. Legacy engine untouched.
// PD-1/PD-C4: Quality-adjusted confidence.

import { calcEMA, calcROC, calcATR, calcVolumeMA } from "../../features/calculator";
import type {
  FeatureObservation,
  P6FeatureEngineResult,
  P6FeatureInput,
  FeatureVersionTuple,
  FeatureProvenance,
  HealthDimensionName,
  TrendFeatureResult,
  VolumeFeatureResult,
  MomentumFeatureResult,
  DerivativeFeatureResult,
  HealthFeatureResult,
  ConfidenceFeatureResult,
} from "./types";
import {
  isObservationIncluded,
  NEUTRAL_SCORE,
  NEUTRAL_CONFIDENCE,
  DEFAULT_HEALTH_WEIGHTS,
  DEFAULT_CONFIDENCE_WEIGHTS,
  SOURCE_PROCESSING_ORDER,
} from "./types";
import { computeConfidence } from "./confidence";
import { assembleProvenance } from "./provenance";

export { computeConfidence } from "./confidence";

// ─── VERSION CONSTANTS ────────────────────────────────────────────────

const V1_VERSION: FeatureVersionTuple = {
  algorithm_version: "1.0.0",
  parameter_version: "1.0.0",
  schema_version: "1.0.0",
  config_hash: "default-v1",
};

// ─── QUALITY GATING ──────────────────────────────────────────────────

function gateObservations(observations: FeatureObservation[]): {
  included: FeatureObservation[];
  excluded: FeatureObservation[];
  includedCount: number;
  excludedCount: number;
  totalCount: number;
} {
  const included: FeatureObservation[] = [];
  const excluded: FeatureObservation[] = [];

  for (const obs of observations) {
    if (isObservationIncluded(obs.quality_status)) {
      included.push(obs);
    } else {
      excluded.push(obs);
    }
  }

  return {
    included,
    excluded,
    includedCount: included.length,
    excludedCount: excluded.length,
    totalCount: observations.length,
  };
}

function extractValues(observations: FeatureObservation[]): number[] {
  return observations.map((o) => o.value).filter((v) => typeof v === "number" && !isNaN(v));
}

// ─── TREND ───────────────────────────────────────────────────────────

export function computeTrend(
  observations: FeatureObservation[]
): TrendFeatureResult {
  const gated = observations.filter((o) => isObservationIncluded(o.quality_status));
  const closes = extractValues(gated);

  if (closes.length < 20) {
    return {
      score: NEUTRAL_SCORE,
      detail: {
        price: closes[closes.length - 1] ?? 0,
        ema20: 0,
        ema50: 0,
        ema200: 0,
        price_vs_ema20: false,
        price_vs_ema50: false,
        price_vs_ema200: false,
        ema20_vs_ema50: false,
        ema50_vs_ema200: false,
        score_breakdown: { base: 50 },
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

// ─── VOLUME ──────────────────────────────────────────────────────────

export function computeVolume(
  observations: FeatureObservation[]
): VolumeFeatureResult {
  const gated = observations.filter((o) => isObservationIncluded(o.quality_status));
  const volumes = extractValues(gated);

  if (volumes.length === 0) {
    return {
      score: NEUTRAL_SCORE,
      detail: {
        volume_current: 0,
        volume_ma20: 0,
        volume_ratio: 1,
        days_used: 0,
      },
    };
  }

  const current = volumes[volumes.length - 1];
  const ma20 = calcVolumeMA(volumes, 20);
  const ratio = ma20 > 0 ? current / ma20 : 1;

  let s: number;
  if (ratio > 3.0) s = 95;
  else if (ratio > 2.0) s = 85;
  else if (ratio > 1.5) s = 75;
  else if (ratio > 1.0) s = 60;
  else if (ratio > 0.7) s = 45;
  else if (ratio > 0.5) s = 30;
  else s = 15;

  return {
    score: s,
    detail: {
      volume_current: Number(current.toFixed(2)),
      volume_ma20: Number(ma20.toFixed(2)),
      volume_ratio: Number(ratio.toFixed(3)),
      days_used: Math.min(20, volumes.length),
    },
  };
}

// ─── MOMENTUM ────────────────────────────────────────────────────────

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

export function computeMomentum(
  closeObs: FeatureObservation[],
  highObs: FeatureObservation[],
  lowObs: FeatureObservation[]
): MomentumFeatureResult {
  const gatedClose = closeObs.filter((o) => isObservationIncluded(o.quality_status));
  const gatedHigh = highObs.filter((o) => isObservationIncluded(o.quality_status));
  const gatedLow = lowObs.filter((o) => isObservationIncluded(o.quality_status));
  const closes = extractValues(gatedClose);

  if (closes.length < 15) {
    return {
      score: NEUTRAL_SCORE,
      detail: {
        roc_14: 0,
        atr_14: 0,
        atr_pct: 0,
        roc_component: 50,
        atr_component: 50,
      },
    };
  }

  const highs = extractValues(gatedHigh);
  const lows = extractValues(gatedLow);

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

// ─── DERIVATIVE ──────────────────────────────────────────────────────

function scoreOIChange(pct: number): number {
  if (pct > 20) return 90;
  if (pct > 10) return 75;
  if (pct > 0) return 60;
  if (pct > -10) return 40;
  return 20;
}

function scoreFunding(rate: number): number {
  if (rate < -0.0001) return 90;
  if (rate < 0) return 75;
  if (rate < 0.0002) return 55;
  if (rate < 0.0005) return 35;
  return 15;
}

export function computeDerivative(
  oiObservations: FeatureObservation[],
  frObservations: FeatureObservation[]
): DerivativeFeatureResult {
  const gatedOi = oiObservations.filter((o) => isObservationIncluded(o.quality_status));
  const gatedFr = frObservations.filter((o) => isObservationIncluded(o.quality_status));
  const oiValues = extractValues(gatedOi);
  const frValues = extractValues(gatedFr);

  // No futures data available
  if (gatedOi.length === 0 && gatedFr.length === 0) {
    return {
      score: NEUTRAL_SCORE,
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

  const oiCurrent = oiValues.length > 0 ? oiValues[oiValues.length - 1] : null;
  const oiPrev = oiValues.length > 1 ? oiValues[oiValues.length - 2] : null;
  const fundingRate = frValues.length > 0 ? frValues[frValues.length - 1] : null;

  let oiChangePct = 0;
  if (oiCurrent !== null && oiPrev !== null && oiPrev !== 0) {
    oiChangePct = ((oiCurrent - oiPrev) / oiPrev) * 100;
  }

  const oiComponent = scoreOIChange(oiChangePct);
  const fundingComponent = fundingRate !== null ? scoreFunding(fundingRate) : 55;

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

// ─── HEALTH ──────────────────────────────────────────────────────────

export function computeHealth(
  dimensionScores: Record<HealthDimensionName, number>,
  dimensionAvailable: Record<HealthDimensionName, boolean>,
  weights: Record<HealthDimensionName, number> = DEFAULT_HEALTH_WEIGHTS
): HealthFeatureResult {
  const dims: HealthFeatureResult["dimensions"] = [];
  let totalWeight = 0;
  let weightedSum = 0;

  for (const name of Object.keys(weights) as HealthDimensionName[]) {
    const available = dimensionAvailable[name];
    const w = weights[name];
    const s = available ? dimensionScores[name] : NEUTRAL_SCORE;

    dims.push({ name, score: s, weight: w, available });
    totalWeight += w;
    weightedSum += w * s;
  }

  const score = totalWeight > 0
    ? Math.max(0, Math.min(100, Math.round((weightedSum / totalWeight) * 100) / 100))
    : NEUTRAL_SCORE;

  const availableCount = dims.filter((d) => d.available).length;
  const dataCompleteness = (availableCount / dims.length) * 100;

  return {
    score,
    dimensions: dims,
    data_completeness: dataCompleteness,
  };
}

// ─── MAIN ENGINE ─────────────────────────────────────────────────────

export type { P6FeatureInput } from "./types";

/**
 * P6 Feature Engine — deterministic, quality-gated, canonical-observation-based.
 *
 * PD-7: This is the new P6-native engine alongside legacy.
 * PD-1/PD-C4: Quality-adjusted confidence.
 * PD-5: Equal weights default (25% each dimension).
 */
export function runP6FeatureEngine(input: P6FeatureInput): P6FeatureEngineResult {
  const {
    entity_id,
    timeframe,
    trend_observations,
    volume_observations,
    close_observations,
    high_observations,
    low_observations,
    oi_observations,
    fr_observations,
    source_availability,
    all_observations,
    expected_counts,
  } = input;

  // ── Quality gate all input sets ──
  const trendGate = gateObservations(trend_observations);
  const volumeGate = gateObservations(volume_observations);
  const closeGate = gateObservations(close_observations);
  const highGate = gateObservations(high_observations);
  const lowGate = gateObservations(low_observations);
  const oiGate = gateObservations(oi_observations);
  const frGate = gateObservations(fr_observations);

  // ── Compute features from quality-gated observations ──
  const trendResult = computeTrend(trendGate.included);
  const volumeResult = computeVolume(volumeGate.included);
  const momentumResult = computeMomentum(
    closeGate.included,
    highGate.included,
    lowGate.included
  );
  const derivativeResult = computeDerivative(oiGate.included, frGate.included);

  // ── Health dimensions ──
  const dimensionScores: Record<HealthDimensionName, number> = {
    TREND: trendResult.score,
    MOMENTUM: momentumResult.score,
    VOLUME: volumeResult.score,
    DERIVATIVE: derivativeResult.score,
  };
  const dimensionAvailable: Record<HealthDimensionName, boolean> = {
    TREND: trendGate.includedCount > 0,
    MOMENTUM: closeGate.includedCount > 0,
    VOLUME: volumeGate.includedCount > 0,
    DERIVATIVE: oiGate.includedCount > 0 || frGate.includedCount > 0,
  };

  const healthResult = computeHealth(dimensionScores, dimensionAvailable);

  // ── Confidence (PD-1/PD-C4: quality-adjusted) ──
  const confidenceResult = computeConfidence(
    all_observations,
    source_availability,
    DEFAULT_CONFIDENCE_WEIGHTS,
    expected_counts
  );

  // ── Provenance ──
  const totalInputsExpected =
    Object.values(expected_counts ?? {}).reduce((a, b) => a + b, 0) ||
    all_observations.length;
  const totalInputsUsed =
    trendGate.includedCount +
    volumeGate.includedCount +
    closeGate.includedCount +
    highGate.includedCount +
    lowGate.includedCount +
    oiGate.includedCount +
    frGate.includedCount;

  const allExcluded = [
    ...trendGate.excluded,
    ...volumeGate.excluded,
    ...closeGate.excluded,
    ...highGate.excluded,
    ...lowGate.excluded,
    ...oiGate.excluded,
    ...frGate.excluded,
  ];

  const provenance = assembleProvenance(
    all_observations,
    allExcluded,
    V1_VERSION,
    timeframe,
    totalInputsExpected,
    totalInputsUsed
  );

  return {
    trend_score: trendResult.score,
    volume_score: volumeResult.score,
    momentum_score: momentumResult.score,
    derivative_score: derivativeResult.score,
    trend_detail: trendResult.detail,
    volume_detail: volumeResult.detail,
    momentum_detail: momentumResult.detail,
    derivative_detail: derivativeResult.detail,
    health_score: healthResult.score,
    health_dimensions: healthResult.dimensions,
    confidence_score: confidenceResult.confidence_score,
    data_completeness: confidenceResult.data_completeness,
    missing_sources: confidenceResult.missing_sources,
    provenance,
    version: V1_VERSION,
  };
}
