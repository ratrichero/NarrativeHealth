// P6 Snapshot Provenance
// Authority: P6-03B §9, P6-03C2 PD-03B-06
// IS-11: Complete provenance chain required
// IS-12: Provenance immutable once persisted

import type {
  SnapshotVersionTuple,
  SnapshotProvenance,
  NarrativeSnapshotProvenance,
  CoinSnapshotInput,
  NarrativeMemberInput,
} from "./types";

/**
 * Assemble coin snapshot provenance.
 * PD-03B-06: Full provenance — snapshot → feature → observation lineage.
 */
export function assembleCoinProvenance(
  input: CoinSnapshotInput,
  snapshotVersion: SnapshotVersionTuple,
  windowEnd: Date,
  calculationTime: Date
): SnapshotProvenance {
  return {
    calculation_time: calculationTime,
    snapshot_version: snapshotVersion,
    input_features: [
      {
        feature_id: null, // filled by persistence layer if available
        feature_name: "HEALTH",
        feature_score: input.health_score,
        feature_p6_version_id: input.feature_version_id,
        feature_calculated_at: null,
      },
    ],
    input_observations_count: 0, // feature-level count; actual count from feature provenance
    data_completeness: input.data_completeness ?? 0,
    quality_summary: input.quality_metadata,
    freshness_summary: input.freshness_metadata,
    input_window_start: null,
    input_window_end: windowEnd,
    entity_snapshot_time: calculationTime,
  };
}

/**
 * Assemble narrative snapshot provenance.
 * PD-03B-04: Market-cap weighted aggregation.
 * PD-03B-14: Live coin_narratives membership.
 */
export function assembleNarrativeProvenance(
  members: NarrativeMemberInput[],
  snapshotVersion: SnapshotVersionTuple,
  windowEnd: Date,
  calculationTime: Date,
  memberCountExpected: number,
  aggregationMethod: string = "market_cap_weighted",
  weightingMethod: string = "market_cap"
): NarrativeSnapshotProvenance {
  const includedMembers = members.filter((m) => m.health_score !== SNAPSHOT_NEUTRAL || m.data_completeness !== 0);

  return {
    calculation_time: calculationTime,
    snapshot_version: snapshotVersion,
    input_features: members.map((m) => ({
      feature_id: null,
      feature_name: "COIN_HEALTH",
      feature_score: m.health_score,
      feature_p6_version_id: null,
      feature_calculated_at: null,
    })),
    input_observations_count: 0,
    data_completeness: memberCountExpected > 0
      ? Math.round((includedMembers.length / memberCountExpected) * 100 * 10) / 10
      : 0,
    quality_summary: null,
    freshness_summary: null,
    input_window_start: null,
    input_window_end: windowEnd,
    entity_snapshot_time: calculationTime,
    member_coin_snapshots: members
      .filter((m) => m.health_score !== SNAPSHOT_NEUTRAL || m.data_completeness !== 0)
      .map((m) => ({
        snapshot_id: m.snapshot_id,
        coin_id: m.coin_id,
        health_score: m.health_score,
        weight: m.market_cap ?? 0,
      })),
    member_count: includedMembers.length,
    aggregation_method: aggregationMethod,
    weighting_method: weightingMethod,
  };
}

const SNAPSHOT_NEUTRAL = 50;
