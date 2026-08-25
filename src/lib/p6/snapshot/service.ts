/**
 * P6-03D — Snapshot Orchestration Service
 *
 * Orchestrates coin + narrative snapshot generation and persistence.
 * Implements PD-03B-09: synchronous in refresh boundary.
 * Implements IS-25: coin snapshot before narrative snapshot.
 */

import type { SnapshotVersionTuple, CoinSnapshotInput } from "./types";
import { generateCoinSnapshot } from "./coin-snapshot";
import { generateNarrativeSnapshot } from "./narrative-snapshot";
import {
  persistCoinSnapshot,
  persistNarrativeSnapshot,
  readCurrentCoinSnapshots,
} from "./persistence";
import type { NarrativeSnapshotInput } from "./types";

/**
 * Narrative membership data for snapshot generation.
 * PD-03B-14: membership from live coin_narratives.
 */
export interface NarrativeMembershipData {
  readonly entityId: number;
  readonly narrativeName: string;
  readonly members: Array<{
    readonly coin_id: number;
    readonly coin_symbol: string;
  }>;
}

/**
 * Result of a snapshot generation run.
 */
export interface SnapshotRunResult {
  coinSnapshotsGenerated: number;
  coinSnapshotsPersisted: number;
  coinSnapshotPersistenceFailed: number;
  narrativeSnapshotsGenerated: number;
  narrativeSnapshotsPersisted: number;
  narrativeSnapshotPersistenceFailed: number;
}

/**
 * Run snapshot generation and persistence for all coins and narratives.
 *
 * IS-25: coins processed first, then narratives.
 * PD-03B-09: synchronous execution.
 * IS-24: persistence failures tracked but never converted to quality states.
 */
export async function runSnapshotGeneration(
  calculatedAt: Date,
  snapshotVersion: SnapshotVersionTuple,
  coinInputs: CoinSnapshotInput[],
  narrativeMemberships: NarrativeMembershipData[]
): Promise<SnapshotRunResult> {
  const result: SnapshotRunResult = {
    coinSnapshotsGenerated: 0,
    coinSnapshotsPersisted: 0,
    coinSnapshotPersistenceFailed: 0,
    narrativeSnapshotsGenerated: 0,
    narrativeSnapshotsPersisted: 0,
    narrativeSnapshotPersistenceFailed: 0,
  };

  // IS-25: Coin snapshots first
  for (const coinInput of coinInputs) {
    const coinOutput = generateCoinSnapshot(coinInput, snapshotVersion, calculatedAt);
    result.coinSnapshotsGenerated++;

    const persisted = await persistCoinSnapshot({
      entityId: coinInput.entity_id,
      healthScore: coinOutput.health_score,
      confidenceScore: coinOutput.confidence_score,
      dataCompleteness: coinOutput.data_completeness,
      healthDimensions: coinOutput.health_dimensions,
      snapshotVersion: coinOutput.snapshot_version,
      featureVersionId: coinInput.feature_version_id,
      qualityMetadata: coinInput.quality_metadata,
      freshnessMetadata: coinInput.freshness_metadata,
      provenance: coinOutput.provenance,
      calculationTime: calculatedAt,
    });

    if (persisted) {
      result.coinSnapshotsPersisted++;
    } else {
      result.coinSnapshotPersistenceFailed++;
    }
  }

  // Narrative snapshots after all coin snapshots
  // PD-03B-11: read persisted coin snapshots
  const persistedCoinSnapshots = await readCurrentCoinSnapshots();
  const coinSnapshotMap = new Map(
    persistedCoinSnapshots.map((cs) => [cs.entityId, cs])
  );

  for (const membership of narrativeMemberships) {
    const members: NarrativeSnapshotInput["members"] = membership.members.map((m) => {
      const coinSnapshot = coinSnapshotMap.get(m.coin_id);
      if (!coinSnapshot) {
        // PD-03B-12: member without snapshot
        return {
          coin_id: m.coin_id,
          coin_symbol: m.coin_symbol,
          health_score: 50,
          market_cap: null,
          data_completeness: 0,
          snapshot_id: 0,
          quality_metadata: null as Record<string, unknown> | null,
        };
      }
      return {
        coin_id: m.coin_id,
        coin_symbol: m.coin_symbol,
        health_score: coinSnapshot.healthScore ?? 50,
        market_cap: null,
        data_completeness: 0,
        snapshot_id: coinSnapshot.id,
        quality_metadata: (coinSnapshot.qualityMetadata ?? null) as Record<string, unknown> | null,
      };
    });

    const narrativeInput: NarrativeSnapshotInput = {
      entity_id: membership.entityId,
      narrative_name: membership.narrativeName,
      members,
      membership_source: "coin_narratives",
    };

    const narrativeOutput = generateNarrativeSnapshot(narrativeInput, snapshotVersion, calculatedAt);
    result.narrativeSnapshotsGenerated++;

    const persisted = await persistNarrativeSnapshot({
      entityId: membership.entityId,
      healthScore: narrativeOutput.health_score,
      dataCompleteness: narrativeOutput.data_completeness,
      memberScores: narrativeOutput.member_scores,
      snapshotVersion: narrativeOutput.snapshot_version,
      provenance: narrativeOutput.provenance,
      calculationTime: calculatedAt,
    });

    if (persisted) {
      result.narrativeSnapshotsPersisted++;
    } else {
      result.narrativeSnapshotPersistenceFailed++;
    }
  }

  return result;
}
