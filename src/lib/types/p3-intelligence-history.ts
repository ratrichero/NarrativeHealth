import type { P3IntelligenceViewModel } from "./p3-intelligence";

/**
 * P3 Historical Intelligence & Trend read model (P3-18).
 *
 * Built exclusively from persisted, immutable `p3_narrative_intelligence`
 * rows (same identity per P3-14 Part C). This is a READ MODEL ONLY — no P3
 * recalculation, no kernel import, no writes.
 */

/** Trend classification per P3-14 Part D (frozen contract). */
export type P3TrendState =
  | "IMPROVING"
  | "DETERIORATING"
  | "STABLE"
  | "TRANSITION"
  | "UNKNOWN";

/** Numeric delta trend: previous/current values + signed delta + state. */
export interface P3MetricTrend {
  previous: number | null;
  current: number | null;
  delta: number | null;
  previousDisplay: string;
  currentDisplay: string;
  deltaDisplay: string;
  state: P3TrendState;
}

/** Classification transition (string compare over the same identity). */
export interface P3ClassificationTrend {
  previous: string | null;
  current: string | null;
  state: P3TrendState;
}

/** Artifact-level leadership comparison (leader coin + narrative leader score). */
export interface P3LeadershipTrend {
  previous: {
    coinId: number | null;
    symbol: string | null;
    score: number | null;
    scoreDisplay: string;
  } | null;
  current: {
    coinId: number | null;
    symbol: string | null;
    score: number | null;
    scoreDisplay: string;
  } | null;
  /** True when the leader coin identity changed between the two windows. */
  changed: boolean;
  scoreDelta: number | null;
  scoreDeltaDisplay: string;
  state: P3TrendState;
}

/** Constituent membership change between two windows (set diff of coin ids). */
export interface P3ConstituentTrend {
  previousCount: number | null;
  currentCount: number | null;
  /** Coin ids present in current but absent in previous. */
  added: number[];
  /** Coin ids present in previous but absent in current. */
  removed: number[];
  changed: boolean;
  state: P3TrendState;
}

/** One consecutive-pair comparison (previous → current). */
export interface P3TrendStep {
  previous: P3IntelligenceViewModel;
  current: P3IntelligenceViewModel;
  regime: P3ClassificationTrend;
  rotation: P3ClassificationTrend;
  rotationScore: P3MetricTrend;
  breadth: P3MetricTrend;
  momentum: P3MetricTrend;
  relativeStrength: P3MetricTrend;
  leadership: P3LeadershipTrend;
  constituents: P3ConstituentTrend;
  /** Aggregate state for this single step (regime + rotation + momentum). */
  state: P3TrendState;
}

export interface P3IntelligenceHistoryViewModel {
  identity: {
    narrativeId: number;
    window: string;
    algorithmKey: string;
    algorithmVersion: string;
    calculationMode: string;
  };
  /** Same-identity VALID artifacts, ordered by windowEnd ASC. */
  series: P3IntelligenceViewModel[];
  /** Latest artifact (max windowEnd). */
  current: P3IntelligenceViewModel | null;
  /** Same identity, greatest windowEnd strictly before current; null with <2 artifacts. */
  previous: P3IntelligenceViewModel | null;
  /** Consecutive-pair comparisons (length = series.length - 1). */
  steps: P3TrendStep[];
  /** Aggregated trend states across all steps. */
  trend: {
    regime: P3TrendState;
    rotation: P3TrendState;
    rotationScore: P3TrendState;
    breadth: P3TrendState;
    momentum: P3TrendState;
    relativeStrength: P3TrendState;
    leadership: P3TrendState;
    constituents: P3TrendState;
    /** Overall narrative trend (regime + rotation + momentum, per P3-14 D.1). */
    overall: P3TrendState;
  };
  dataSufficiency: {
    comparableArtifacts: number;
    requiredMinimum: number;
    sufficient: boolean;
  };
}
