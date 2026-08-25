/**
 * P6-03D — COIN_HEALTH Snapshot Generation
 *
 * Generates deterministic coin-level health snapshots from P6-02 feature outputs.
 * Implements PD-03B-10: coin score = pass-through P6 feature health_score.
 *
 * Per P6-03B IS-15: deterministic — same inputs + versions → same output.
 * Per P6-03B IS-06: quality is metadata, never a score.
 * Per P6-03C2 IS-24: persistence failure ≠ quality state.
 */

import type {
  SnapshotVersionTuple,
  CoinSnapshotInput,
  CoinSnapshotOutput,
} from "./types";
import { createSnapshotIdentity, snapshotIdentityKey } from "./identity";
import { assembleCoinProvenance } from "./provenance";
import { SNAPSHOT_NEUTRAL_SCORE } from "./types";

/**
 * Generate a COIN_HEALTH snapshot from P6-02 feature outputs.
 *
 * PD-03B-10: coin score = pass-through P6 feature health_score.
 * IS-06: quality metadata preserved, not converted to score.
 * IS-10: freshness metadata preserved, independent from quality.
 * IS-15: deterministic — same inputs → same output.
 * IS-18: lifecycle starts as GENERATED conceptually; persistence assigns CURRENT.
 *
 * @returns CoinSnapshotOutput with full provenance and metadata.
 *   Caller is responsible for persistence (persistence.ts).
 *   Persistence failure MUST NOT be converted to quality state (IS-24).
 */
export function generateCoinSnapshot(
  input: CoinSnapshotInput,
  snapshotVersion: SnapshotVersionTuple,
  calculationTime: Date
): CoinSnapshotOutput {
  const windowEnd = new Date(calculationTime);
  windowEnd.setHours(0, 0, 0, 0);

  const identity = createSnapshotIdentity(
    "coin",
    input.entity_id,
    "COIN_HEALTH",
    windowEnd
  );

  // Build health dimensions from individual scores (P6-02 dimension scores)
  const healthDimensions = [
    { name: "TREND", score: input.trend_score ?? SNAPSHOT_NEUTRAL_SCORE, weight: 0.25, available: input.trend_score !== null },
    { name: "MOMENTUM", score: input.momentum_score ?? SNAPSHOT_NEUTRAL_SCORE, weight: 0.25, available: input.momentum_score !== null },
    { name: "VOLUME", score: input.volume_score ?? SNAPSHOT_NEUTRAL_SCORE, weight: 0.25, available: input.volume_score !== null },
    { name: "DERIVATIVE", score: input.derivative_score ?? SNAPSHOT_NEUTRAL_SCORE, weight: 0.25, available: input.derivative_score !== null },
  ];

  const provenance = assembleCoinProvenance(
    input,
    snapshotVersion,
    windowEnd,
    calculationTime
  );

  // PD-03B-10: health_score is pass-through from feature computation
  // confidence_score is pass-through from feature computation
  return {
    identity,
    health_score: input.health_score,
    confidence_score: input.confidence_score ?? 0,
    data_completeness: input.data_completeness ?? 0,
    health_dimensions: healthDimensions,
    quality_metadata: input.quality_metadata,
    freshness_metadata: input.freshness_metadata,
    snapshot_version: snapshotVersion,
    feature_version_id: input.feature_version_id,
    feature_version_tuple: {
      algorithm_version: input.feature_algorithm_version,
      parameter_version: input.feature_parameter_version,
      schema_version: input.feature_schema_version,
      config_hash: input.feature_config_hash,
    },
    calculation_time: calculationTime,
    provenance,
  };
}

/**
 * Produce the identity key for deduplication.
 * IS-28: uniqueness per (entity_type, entity_id, snapshot_type, window_end)
 */
export function coinSnapshotIdentityKey(output: CoinSnapshotOutput): string {
  return snapshotIdentityKey(output.identity);
}
