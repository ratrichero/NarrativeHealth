/**
 * P6-03D — NARRATIVE_HEALTH Snapshot Generation
 *
 * Generates deterministic narrative-level health snapshots from coin snapshots.
 * Implements PD-03B-04: market-cap weighted aggregation.
 * Implements PD-03B-11: consumes persisted coin snapshots.
 * Implements PD-03B-14: membership from live coin_narratives.
 * Implements PD-03B-12: missing data persisted with metadata.
 *
 * Per P6-03B IS-25: coin snapshot before narrative snapshot.
 * Per P6-03C2 IS-26: no invented health for missing members.
 * Per P6-03B IS-15: deterministic — same inputs → same output.
 */

import type {
  SnapshotVersionTuple,
  NarrativeSnapshotInput,
  NarrativeSnapshotOutput,
  NarrativeMemberInput,
} from "./types";
import { createSnapshotIdentity, snapshotIdentityKey } from "./identity";
import { assembleNarrativeProvenance } from "./provenance";
import { SNAPSHOT_NEUTRAL_SCORE } from "./types";

/**
 * Compute market-cap weighted narrative health score.
 *
 * PD-03B-04: market-cap weighted aggregation.
 * IS-26: members without usable snapshot are EXCLUDED, not assigned invented health.
 * IS-15: deterministic — consistent member ordering, deterministic rounding.
 *
 * @returns Weighted health score (0–100), or SNAPSHOT_NEUTRAL_SCORE if zero usable members.
 */
function computeNarrativeHealthScore(
  members: NarrativeMemberInput[]
): number {
  // Sort deterministically by coin_id for reproducibility (IS-15)
  const sorted = [...members].sort((a, b) => a.coin_id - b.coin_id);

  // IS-26: only include members with positive market cap and non-neutral health
  const usableMembers = sorted.filter(
    (m) => m.market_cap !== null && m.market_cap > 0
  );

  if (usableMembers.length === 0) {
    return SNAPSHOT_NEUTRAL_SCORE;
  }

  const totalMarketCap = usableMembers.reduce(
    (sum, m) => sum + (m.market_cap ?? 0),
    0
  );

  if (totalMarketCap === 0) {
    return SNAPSHOT_NEUTRAL_SCORE;
  }

  const weightedSum = usableMembers.reduce(
    (sum, m) => sum + m.health_score * (m.market_cap ?? 0),
    0
  );

  // IS-15: deterministic rounding to 2 decimal places
  return Math.round((weightedSum / totalMarketCap) * 100) / 100;
}

/**
 * Generate a NARRATIVE_HEALTH snapshot from coin snapshots.
 *
 * PD-03B-04: market-cap weighted aggregation.
 * PD-03B-11: consumes persisted coin snapshots.
 * PD-03B-14: membership from live coin_narratives.
 * PD-03B-12: missing data persisted with metadata.
 * IS-25: caller MUST ensure coin snapshots exist before calling.
 * IS-26: no invented health for missing members.
 * IS-15: deterministic — same inputs → same output.
 */
export function generateNarrativeSnapshot(
  input: NarrativeSnapshotInput,
  snapshotVersion: SnapshotVersionTuple,
  calculationTime: Date
): NarrativeSnapshotOutput {
  const windowEnd = new Date(calculationTime);
  windowEnd.setHours(0, 0, 0, 0);

  const identity = createSnapshotIdentity(
    "narrative",
    input.entity_id,
    "NARRATIVE_HEALTH",
    windowEnd
  );

  // Sort deterministically (IS-15)
  const sortedMembers = [...input.members].sort(
    (a, b) => a.coin_id - b.coin_id
  );

  const healthScore = computeNarrativeHealthScore(sortedMembers);

  // Determine which members are included vs excluded (PD-03B-12)
  const memberScores = sortedMembers.map((m) => {
    const included = m.market_cap !== null && m.market_cap > 0;
    const weight = m.market_cap ?? 0;
    return {
      coin_id: m.coin_id,
      coin_symbol: m.coin_symbol,
      health_score: m.health_score,
      weight,
      included,
      exclusion_reason: included ? null : "no_market_cap",
    };
  });

  const memberCountActual = memberScores.filter((m) => m.included).length;
  const dataCompleteness =
    sortedMembers.length > 0
      ? Math.round((memberCountActual / sortedMembers.length) * 100 * 10) / 10
      : 0;

  const provenance = assembleNarrativeProvenance(
    sortedMembers,
    snapshotVersion,
    windowEnd,
    calculationTime,
    sortedMembers.length
  );

  return {
    identity,
    health_score: healthScore,
    data_completeness: dataCompleteness,
    member_count_expected: sortedMembers.length,
    member_count_actual: memberCountActual,
    member_scores: memberScores,
    snapshot_version: snapshotVersion,
    calculation_time: calculationTime,
    provenance,
  };
}

/**
 * Produce the identity key for deduplication.
 */
export function narrativeSnapshotIdentityKey(
  output: NarrativeSnapshotOutput
): string {
  return snapshotIdentityKey(output.identity);
}
