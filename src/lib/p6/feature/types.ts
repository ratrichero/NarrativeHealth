// P6 Derived Feature Types
// Authority: P6-02B (Derived Feature Contract), P6-02C (Aggregation Contract), P6-02C2 (Planner Decision Contract)
// Frozen by: P6-01B/C/D/E

import type { QualityState, Metric, Timeframe } from "../quality/types";
import type { FreshnessStatus } from "../freshness/types";

// ─── FROZEN VOCABULARY ────────────────────────────────────────────────

/** P6 V1 feature names (P6-02B §10.2) — frozen, no additions allowed */
export type FeatureName =
  | "TREND"
  | "VOLUME"
  | "MOMENTUM"
  | "DERIVATIVE"
  | "HEALTH"
  | "CONFIDENCE";

/** Health dimension names (P6-02B §9.2) */
export type HealthDimensionName =
  | "TREND"
  | "MOMENTUM"
  | "VOLUME"
  | "DERIVATIVE";

// ─── VERSION TUPLE ────────────────────────────────────────────────────

/** Structured version tuple (P6-02B §8.1, P6-02C2 §3.3) */
export interface FeatureVersionTuple {
  algorithm_version: string;
  parameter_version: string;
  schema_version: string;
  config_hash: string;
}

// ─── INPUT TYPES ──────────────────────────────────────────────────────

/** Quality-gated observation for feature input (P6-02B §4) */
export interface FeatureObservation {
  entity_id: number;
  metric: Metric;
  source: string;
  observed_at: Date | null;
  timeframe: Timeframe;
  value: number;
  quality_status: QualityState;
  freshness_status: FreshnessStatus;
}

/** Observation identity for provenance tracking */
export interface ObservationIdentity {
  entity_id: number;
  metric: Metric;
  source: string;
  observed_at: Date | null;
  timeframe: Timeframe;
}

// ─── QUALITY GATING ───────────────────────────────────────────────────

/**
 * Quality gate rule (P6-02B §5.2):
 * VALID → INCLUDED
 * INVALID → EXCLUDED
 * MISSING → EXCLUDED
 * UNKNOWN → INCLUDED
 */
export function isObservationIncluded(qs: QualityState): boolean {
  return qs === "VALID" || qs === "UNKNOWN";
}

// ─── FEATURE RESULTS ──────────────────────────────────────────────────

export interface TrendFeatureResult {
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

export interface VolumeFeatureResult {
  score: number;
  detail: {
    volume_current: number;
    volume_ma20: number;
    volume_ratio: number;
    days_used: number;
  };
}

export interface MomentumFeatureResult {
  score: number;
  detail: {
    roc_14: number;
    atr_14: number;
    atr_pct: number;
    roc_component: number;
    atr_component: number;
  };
}

export interface DerivativeFeatureResult {
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

export interface HealthFeatureResult {
  score: number;
  dimensions: {
    name: HealthDimensionName;
    score: number;
    weight: number;
    available: boolean;
  }[];
  data_completeness: number;
}

export interface ConfidenceFeatureResult {
  confidence_score: number;
  data_completeness: number;
  missing_sources: string[];
}

// ─── PROVENANCE ───────────────────────────────────────────────────────

/** Per-input observation record in provenance (P6-02B §7.1) */
export interface ProvenanceInputObservation {
  entity_id: number;
  metric: Metric;
  source: string;
  observed_at: Date | null;
  timeframe: Timeframe;
  quality_status: QualityState;
  freshness_status: FreshnessStatus;
}

/** Feature provenance (P6-02B §7.1) */
export interface FeatureProvenance {
  input_observations: ProvenanceInputObservation[];
  algorithm_version: string;
  parameter_version: string;
  schema_version: string;
  calculated_at: Date;
  input_window: string;
  total_inputs_expected: number;
  total_inputs_used: number;
  excluded_inputs: {
    identity: ObservationIdentity;
    reason: string;
  }[];
}

// ─── ENGINE RESULT ────────────────────────────────────────────────────

/** Full P6 feature engine result (P6-02C2 §4.4 output compatibility) */
export interface P6FeatureEngineResult {
  trend_score: number;
  volume_score: number;
  momentum_score: number;
  derivative_score: number;
  trend_detail: TrendFeatureResult["detail"];
  volume_detail: VolumeFeatureResult["detail"];
  momentum_detail: MomentumFeatureResult["detail"];
  derivative_detail: DerivativeFeatureResult["detail"];
  health_score: number;
  health_dimensions: HealthFeatureResult["dimensions"];
  confidence_score: number;
  data_completeness: number;
  missing_sources: string[];
  provenance: FeatureProvenance;
  version: FeatureVersionTuple;
}

// ─── NEUTRAL DEFAULTS ─────────────────────────────────────────────────

/** Neutral default score (P6-02C §6.4) */
export const NEUTRAL_SCORE = 50;

/** P6 Feature Engine input (P6-02C2 §4.4) */
export interface P6FeatureInput {
  entity_id: number;
  timeframe: "DAILY" | "4H" | "SOURCE_SNAPSHOT";
  trend_observations: FeatureObservation[];
  volume_observations: FeatureObservation[];
  close_observations: FeatureObservation[];
  high_observations: FeatureObservation[];
  low_observations: FeatureObservation[];
  oi_observations: FeatureObservation[];
  fr_observations: FeatureObservation[];
  source_availability: Record<string, boolean>;
  all_observations: FeatureObservation[];
  expected_counts?: Record<string, number>;
}

/** Neutral default confidence (no data) */
export const NEUTRAL_CONFIDENCE = 0;

/** Default health dimension weights — equal (P6-02C2 §6.1) */
export const DEFAULT_HEALTH_WEIGHTS: Record<HealthDimensionName, number> = {
  TREND: 0.25,
  MOMENTUM: 0.25,
  VOLUME: 0.25,
  DERIVATIVE: 0.25,
};

/** Default confidence source weights (from rule_versions seed) */
export const DEFAULT_CONFIDENCE_WEIGHTS: Record<string, number> = {
  BINANCE_SPOT: 0.4,
  BINANCE_FUTURES: 0.4,
  COINGECKO: 0.2,
};

/** Fixed source processing order for determinism (P6-02C2 §5.6) */
export const SOURCE_PROCESSING_ORDER = [
  "BINANCE_SPOT",
  "BINANCE_FUTURES",
  "COINGECKO",
] as const;
