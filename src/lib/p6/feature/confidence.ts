// P6 Confidence — Quality-adjusted confidence calculation
// Authority: P6-02C2 §5 (PD-1/PD-C4 frozen formula)
// Formula: confidence = Σ(weight × available × quality_ratio) / Σ(weight × available)
// quality_ratio = VALID_count / total_count
// denominator=0 → 0
// UNKNOWN/MISSING/INVALID NOT counted as VALID

import type { FeatureObservation, ConfidenceFeatureResult } from "./types";
import { NEUTRAL_CONFIDENCE, SOURCE_PROCESSING_ORDER } from "./types";
import type { QualityState } from "../quality/types";

/**
 * Count observations by quality status for a given source.
 */
function countBySource(
  observations: FeatureObservation[],
  source: string
): { total: number; valid: number } {
  const sourceObs = observations.filter((o) => o.source === source);
  return {
    total: sourceObs.length,
    valid: sourceObs.filter((o) => o.quality_status === "VALID").length,
  };
}

/**
 * PD-1/PD-C4: Quality-adjusted confidence formula.
 *
 * For each source s:
 *   quality_ratio_s = valid_count_s / total_count_s  (0 if total=0)
 *   source_indicator_s = available_s × quality_ratio_s
 *   source_weight_s = from confidence_weights
 *
 * confidence = Σ(weight × indicator) / Σ(weight × available)
 *
 * denominator=0 → confidence=0
 * Round to 1 decimal, clamp [0, 100].
 */
export function computeConfidence(
  observations: FeatureObservation[],
  sourceAvailability: Record<string, boolean>,
  weights: Record<string, number>,
  expectedCounts?: Record<string, number>
): ConfidenceFeatureResult {
  const missing: string[] = [];
  let weightedSum = 0;
  let weightSum = 0;

  for (const source of SOURCE_PROCESSING_ORDER) {
    const sourceWeight = weights[source] ?? 0;
    const available = sourceAvailability[source] ?? false;

    if (!available) {
      missing.push(source.toLowerCase());
      continue;
    }

    const { total, valid } = countBySource(observations, source);
    const totalCount = expectedCounts?.[source] ?? total;
    const qualityRatio = totalCount > 0 ? valid / totalCount : 0;

    weightedSum += sourceWeight * qualityRatio;
    weightSum += sourceWeight;
  }

  const confidenceScore =
    weightSum > 0
      ? Math.max(0, Math.min(100, Math.round((weightedSum / weightSum) * 1000) / 10))
      : NEUTRAL_CONFIDENCE;

  // data_completeness = proportion of available sources
  const availableCount = SOURCE_PROCESSING_ORDER.filter(
    (s) => sourceAvailability[s]
  ).length;
  const dataCompleteness =
    Math.round((availableCount / SOURCE_PROCESSING_ORDER.length) * 100 * 10) / 10;

  return {
    confidence_score: confidenceScore,
    data_completeness: dataCompleteness,
    missing_sources: missing,
  };
}
