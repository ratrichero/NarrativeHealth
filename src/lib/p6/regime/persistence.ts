/**
 * P6-04D — Regime Persistence Layer
 *
 * Persists regime state to the p6_regime_states table with:
 * - PD-04B-09: New p6_regime_states table
 * - Latest-only semantics via status (CURRENT/SUPERSEDED)
 * - Idempotent repeated calculation
 * - Full provenance round-trip
 * - Standalone regime version tuple
 *
 * Authority: P6-04B, P6-04C, P6-04C1
 */

import { eq, and, desc } from "drizzle-orm";
import { db } from "@/db";
import { p6RegimeStates } from "@/db/schema";
import type {
  EntityType,
  RegimeState,
  RegimeVersionTuple,
  RegimeProvenance,
  RegimeQualityMetadata,
  RegimeFreshnessMetadata,
} from "./types";

// ─── PERSIST INPUT ────────────────────────────────────────────────

export interface PersistRegimeStateInput {
  readonly entityType: EntityType;
  readonly entityId: number;
  readonly regimeState: RegimeState;
  readonly previousState: RegimeState | null;
  readonly confidence: number;
  readonly consecutiveCount: number;
  readonly healthScore: number;
  readonly regimeVersion: RegimeVersionTuple;
  readonly snapshotVersionId: number | null;
  readonly provenance: RegimeProvenance;
  readonly qualityMetadata: RegimeQualityMetadata;
  readonly freshnessMetadata: RegimeFreshnessMetadata;
  readonly calculationTime: Date;
}

// ─── UPSERT ───────────────────────────────────────────────────────

/**
 * Persist a regime state with latest-only semantics.
 *
 * 1. Supersede any existing CURRENT regime for this entity/type
 * 2. Insert new regime as CURRENT
 *
 * Idempotent: calling with the same inputs produces the same result.
 * Deterministic: same inputs → same persisted state.
 *
 * PD-04B-09: Synchronous persistence in refresh boundary.
 * PD-04C-21: Persistence failure = infrastructure failure, not quality state.
 */
export async function persistRegimeState(
  input: PersistRegimeStateInput
): Promise<{ id: number } | null> {
  try {
    // 1. Supersede existing CURRENT regime
    await db
      .update(p6RegimeStates)
      .set({ status: "SUPERSEDED" })
      .where(
        and(
          eq(p6RegimeStates.entityType, input.entityType),
          eq(p6RegimeStates.entityId, input.entityId),
          eq(p6RegimeStates.regimeType, "HEALTH"),
          eq(p6RegimeStates.status, "CURRENT")
        )
      );

    // 2. Insert new CURRENT regime
    const result = await db
      .insert(p6RegimeStates)
      .values({
        entityType: input.entityType,
        entityId: input.entityId,
        regimeType: "HEALTH",
        regimeState: input.regimeState,
        previousState: input.previousState,
        confidence: input.confidence,
        consecutiveCount: input.consecutiveCount,
        healthScore: input.healthScore,
        // Version tuple
        algorithmVersion: input.regimeVersion.algorithm_version,
        parameterVersion: input.regimeVersion.parameter_version,
        schemaVersion: input.regimeVersion.schema_version,
        configHash: input.regimeVersion.config_hash,
        // Snapshot linkage
        snapshotVersionId: input.snapshotVersionId,
        // Timeframe
        timeframe: "DAILY",
        // Metadata
        qualityMetadata: input.qualityMetadata,
        freshnessMetadata: input.freshnessMetadata,
        provenance: input.provenance,
        // Timestamps
        calculationTime: input.calculationTime,
        // Status
        status: "CURRENT",
      })
      .returning({ id: p6RegimeStates.id });

    return result[0] ?? null;
  } catch (error) {
    // PD-04C-21: Persistence failure = infrastructure failure
    // Do NOT convert to quality state or regime state
    console.error("[P6-Regime] Persistence failure:", error);
    return null;
  }
}

// ─── READ ──────────────────────────────────────────────────────────

/**
 * Read the current regime state for an entity.
 * Returns the most recent CURRENT regime, or null if none exists.
 */
export async function readCurrentRegime(
  entityType: EntityType,
  entityId: number,
  regimeType: string = "HEALTH"
): Promise<{
  regimeState: RegimeState;
  confidence: number;
  consecutiveCount: number;
  healthScore: number;
  regimeVersion: RegimeVersionTuple;
  calculationTime: Date;
} | null> {
  const rows = await db
    .select()
    .from(p6RegimeStates)
    .where(
      and(
        eq(p6RegimeStates.entityType, entityType),
        eq(p6RegimeStates.entityId, entityId),
        eq(p6RegimeStates.regimeType, regimeType),
        eq(p6RegimeStates.status, "CURRENT")
      )
    )
    .orderBy(desc(p6RegimeStates.calculationTime))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    regimeState: row.regimeState as RegimeState,
    confidence: row.confidence,
    consecutiveCount: row.consecutiveCount,
    healthScore: row.healthScore,
    regimeVersion: {
      algorithm_version: row.algorithmVersion,
      parameter_version: row.parameterVersion,
      schema_version: row.schemaVersion,
      config_hash: row.configHash,
    },
    calculationTime: row.calculationTime,
  };
}

/**
 * Read regime history for an entity.
 * Returns all regime states ordered by calculation time (newest first).
 */
export async function readRegimeHistory(
  entityType: EntityType,
  entityId: number,
  regimeType: string = "HEALTH",
  limit: number = 50
): Promise<
  Array<{
    id: number;
    regimeState: RegimeState;
    confidence: number;
    healthScore: number;
    status: string;
    calculationTime: Date;
  }>
> {
  const rows = await db
    .select({
      id: p6RegimeStates.id,
      regimeState: p6RegimeStates.regimeState,
      confidence: p6RegimeStates.confidence,
      healthScore: p6RegimeStates.healthScore,
      status: p6RegimeStates.status,
      calculationTime: p6RegimeStates.calculationTime,
    })
    .from(p6RegimeStates)
    .where(
      and(
        eq(p6RegimeStates.entityType, entityType),
        eq(p6RegimeStates.entityId, entityId),
        eq(p6RegimeStates.regimeType, regimeType)
      )
    )
    .orderBy(desc(p6RegimeStates.calculationTime))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    regimeState: row.regimeState as RegimeState,
    confidence: row.confidence,
    healthScore: row.healthScore,
    status: row.status,
    calculationTime: row.calculationTime,
  }));
}
