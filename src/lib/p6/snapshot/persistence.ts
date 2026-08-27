/**
 * P6-03D — Snapshot Persistence
 *
 * Handles persistence of P6 intelligence snapshots.
 * Implements PD-03B-05: new p6_snapshots table.
 * Implements PD-03B-03: latest-only operational semantics.
 * Implements PD-03B-09: synchronous persistence in refresh boundary.
 *
 * Per IS-24: persistence failure ≠ quality state.
 * Per IS-28: uniqueness per (entity_type, entity_id, snapshot_type, window_end).
 */

import { eq, and, asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { p6Snapshots } from "@/db/schema";
import type {
  SnapshotVersionTuple,
  SnapshotStatus,
  SnapshotProvenance,
  NarrativeSnapshotProvenance,
} from "./types";

/**
 * Persist a coin snapshot record.
 *
 * PD-03B-03: latest-only.
 * IS-28: uniqueness per (entity_type, entity_id, snapshot_type, window_end).
 * IS-24: errors propagated as infrastructure errors, never quality states.
 */
export interface PersistCoinSnapshotInput {
  readonly entityId: number;
  readonly healthScore: number;
  readonly confidenceScore: number;
  readonly dataCompleteness: number;
  readonly healthDimensions: Array<{
    readonly name: string;
    readonly score: number;
    readonly weight: number;
    readonly available: boolean;
  }>;
  readonly snapshotVersion: SnapshotVersionTuple;
  readonly featureVersionId: number | null;
  readonly qualityMetadata: Record<string, unknown> | null;
  readonly freshnessMetadata: Record<string, unknown> | null;
  readonly provenance: SnapshotProvenance;
  readonly calculationTime: Date;
}

/**
 * Persist a narrative snapshot record.
 */
export interface PersistNarrativeSnapshotInput {
  readonly entityId: number;
  readonly healthScore: number;
  readonly dataCompleteness: number;
  readonly memberScores: Array<{
    readonly coin_id: number;
    readonly coin_symbol: string;
    readonly health_score: number;
    readonly weight: number;
    readonly included: boolean;
    readonly exclusion_reason: string | null;
  }>;
  readonly snapshotVersion: SnapshotVersionTuple;
  readonly provenance: NarrativeSnapshotProvenance;
  readonly calculationTime: Date;
}

/**
 * Persist a coin snapshot and supersede any previous for the same identity.
 *
 * @returns The persisted snapshot ID, or null if persistence failed.
 *   IS-24: null MUST NOT be treated as a quality state by callers.
 */
export async function persistCoinSnapshot(
  input: PersistCoinSnapshotInput
): Promise<{ id: number; status: SnapshotStatus } | null> {
  try {
    const windowEnd = new Date(input.calculationTime);
    windowEnd.setHours(0, 0, 0, 0);

    // Supersede any existing snapshot for this identity (IS-28)
    const existing = await db
      .select({ id: p6Snapshots.id })
      .from(p6Snapshots)
      .where(
        and(
          eq(p6Snapshots.entityType, "coin"),
          eq(p6Snapshots.entityId, input.entityId),
          eq(p6Snapshots.snapshotType, "COIN_HEALTH"),
          eq(p6Snapshots.windowEnd, windowEnd)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(p6Snapshots)
        .set({ status: "SUPERSEDED" })
        .where(eq(p6Snapshots.id, existing[0].id));
    }

    const [inserted] = await db
      .insert(p6Snapshots)
      .values({
        entityType: "coin",
        entityId: input.entityId,
        snapshotType: "COIN_HEALTH",
        timeframe: "DAILY",
        windowEnd,
        healthScore: input.healthScore,
        confidenceScore: input.confidenceScore,
        dataCompleteness: input.dataCompleteness,
        status: "CURRENT",
        snapshotAlgorithmVersion: input.snapshotVersion.algorithm_version,
        snapshotParameterVersion: input.snapshotVersion.parameter_version,
        snapshotSchemaVersion: input.snapshotVersion.schema_version,
        snapshotConfigHash: input.snapshotVersion.config_hash,
        featureVersionId: input.featureVersionId,
        healthDimensions: input.healthDimensions,
        qualityMetadata: input.qualityMetadata,
        freshnessMetadata: input.freshnessMetadata,
        provenance: input.provenance,
        calculationTime: input.calculationTime,
      })
      .returning({ id: p6Snapshots.id });

    return { id: inserted.id, status: "CURRENT" };
  } catch {
    // IS-24: persistence failure returned as null
    return null;
  }
}

/**
 * Persist a narrative snapshot record.
 */
export async function persistNarrativeSnapshot(
  input: PersistNarrativeSnapshotInput
): Promise<{ id: number; status: SnapshotStatus } | null> {
  try {
    const windowEnd = new Date(input.calculationTime);
    windowEnd.setHours(0, 0, 0, 0);

    // Supersede existing
    const existing = await db
      .select({ id: p6Snapshots.id })
      .from(p6Snapshots)
      .where(
        and(
          eq(p6Snapshots.entityType, "narrative"),
          eq(p6Snapshots.entityId, input.entityId),
          eq(p6Snapshots.snapshotType, "NARRATIVE_HEALTH"),
          eq(p6Snapshots.windowEnd, windowEnd)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(p6Snapshots)
        .set({ status: "SUPERSEDED" })
        .where(eq(p6Snapshots.id, existing[0].id));
    }

    const [inserted] = await db
      .insert(p6Snapshots)
      .values({
        entityType: "narrative",
        entityId: input.entityId,
        snapshotType: "NARRATIVE_HEALTH",
        timeframe: "DAILY",
        windowEnd,
        healthScore: input.healthScore,
        dataCompleteness: input.dataCompleteness,
        status: "CURRENT",
        snapshotAlgorithmVersion: input.snapshotVersion.algorithm_version,
        snapshotParameterVersion: input.snapshotVersion.parameter_version,
        snapshotSchemaVersion: input.snapshotVersion.schema_version,
        snapshotConfigHash: input.snapshotVersion.config_hash,
        featureVersionId: null,
        healthDimensions: input.memberScores,
        qualityMetadata: null,
        freshnessMetadata: null,
        provenance: input.provenance,
        calculationTime: input.calculationTime,
      })
      .returning({ id: p6Snapshots.id });

    return { id: inserted.id, status: "CURRENT" };
  } catch {
    return null;
  }
}

/**
 * Read the current snapshot for a given entity/type.
 */
export async function readCurrentSnapshot(
  entityType: "coin" | "narrative",
  entityId: number,
  snapshotType: "COIN_HEALTH" | "NARRATIVE_HEALTH"
): Promise<SnapshotRecord | null> {
  const [record] = await db
    .select()
    .from(p6Snapshots)
    .where(
      and(
        eq(p6Snapshots.entityType, entityType),
        eq(p6Snapshots.entityId, entityId),
        eq(p6Snapshots.snapshotType, snapshotType),
        eq(p6Snapshots.status, "CURRENT")
      )
    )
    .orderBy(desc(p6Snapshots.calculationTime))
    .limit(1);

  return record ?? null;
}

/**
 * Read all current coin snapshots for narrative aggregation.
 * PD-03B-11: narrative consumes persisted coin snapshots.
 */
export async function readCurrentCoinSnapshots(): Promise<SnapshotRecord[]> {
  return db
    .select()
    .from(p6Snapshots)
    .where(
      and(
        eq(p6Snapshots.entityType, "coin"),
        eq(p6Snapshots.snapshotType, "COIN_HEALTH"),
        eq(p6Snapshots.status, "CURRENT")
      )
    )
    .orderBy(desc(p6Snapshots.calculationTime));
}

/**
 * Read historical snapshots for an entity, ordered by window_end ASC.
 * P6-08: Returns ALL records (CURRENT + SUPERSEDED) for temporal browsing.
 */
export async function readSnapshotHistory(
  entityType: "coin" | "narrative",
  entityId: number,
  snapshotType: "COIN_HEALTH" | "NARRATIVE_HEALTH",
  limit: number = 100
): Promise<SnapshotRecord[]> {
  return db
    .select()
    .from(p6Snapshots)
    .where(
      and(
        eq(p6Snapshots.entityType, entityType),
        eq(p6Snapshots.entityId, entityId),
        eq(p6Snapshots.snapshotType, snapshotType)
      )
    )
    .orderBy(asc(p6Snapshots.windowEnd))
    .limit(limit);
}

/**
 * A raw snapshot record from the database.
 */
export type SnapshotRecord = typeof p6Snapshots.$inferSelect;
