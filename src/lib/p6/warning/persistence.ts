/**
 * P6-05D — Warning Persistence Layer
 *
 * Persists warnings to the p6_warnings table with:
 * - Occurrence-based identity
 * - Append-only semantics (never DELETE, status UPDATE)
 * - Full provenance round-trip
 * - Standalone warning version tuple
 *
 * PD-05B-14: Append-only persistence.
 * EW-19: Persistence failure = infrastructure failure.
 * EW-20: Persistence ≠ quality state.
 *
 * Authority: P6-05B, P6-05C, P6-05C1
 */

import { eq, and, desc } from "drizzle-orm";
import { db } from "@/db";
import { p6Warnings } from "@/db/schema";
import type {
  EntityType,
  WarningType,
  Severity,
  WarningLifecycle,
  WarningVersionTuple,
  WarningProvenance,
  WarningRecord,
} from "./types";

// ─── PERSIST INPUT ────────────────────────────────────────────────

export interface PersistWarningInput {
  readonly entityType: EntityType;
  readonly entityId: number;
  readonly warningType: WarningType;
  readonly severity: Severity;
  readonly lifecycle: WarningLifecycle;
  readonly message: string;
  readonly healthScore: number;
  readonly previousHealthScore: number | null;
  readonly healthDelta: number | null;
  readonly regimeState: string | null;
  readonly previousRegimeState: string | null;
  readonly confidence: number;
  readonly dedupKey: string;
  readonly qualityMetadata: Record<string, unknown> | null;
  readonly freshnessMetadata: Record<string, unknown> | null;
  readonly evidence: Record<string, unknown> | null;
  readonly version: WarningVersionTuple;
  readonly provenance: WarningProvenance;
  readonly detectionWindow: Date;
  readonly detectedAt: Date;
  readonly effectiveFrom: Date;
}

// ─── INSERT ───────────────────────────────────────────────────────

/**
 * Persist a new warning record.
 * EW-19: Persistence failure = infrastructure failure (return null, don't convert).
 */
export async function persistWarning(
  input: PersistWarningInput
): Promise<{ id: number } | null> {
  try {
    const result = await db
      .insert(p6Warnings)
      .values({
        entityType: input.entityType,
        entityId: input.entityId,
        warningType: input.warningType,
        severity: input.severity,
        lifecycle: input.lifecycle,
        message: input.message,
        healthScore: input.healthScore,
        previousHealthScore: input.previousHealthScore,
        healthDelta: input.healthDelta,
        regimeState: input.regimeState,
        previousRegimeState: input.previousRegimeState,
        confidence: input.confidence,
        dedupKey: input.dedupKey,
        qualityMetadata: input.qualityMetadata,
        freshnessMetadata: input.freshnessMetadata,
        evidence: input.evidence,
        algorithmVersion: input.version.algorithm_version,
        parameterVersion: input.version.parameter_version,
        schemaVersion: input.version.schema_version,
        configHash: input.version.config_hash,
        provenance: input.provenance as unknown as Record<string, unknown>,
        detectionWindow: input.detectionWindow,
        detectedAt: input.detectedAt,
        effectiveFrom: input.effectiveFrom,
        lifecycleStatus: input.lifecycle,
      })
      .returning({ id: p6Warnings.id });

    return result[0] ?? null;
  } catch (error) {
    // EW-19: Persistence failure = infrastructure failure
    // Do NOT convert to QualityState or WarningType
    console.error("[P6-Warning] Persistence failure:", error);
    return null;
  }
}

// ─── UPDATE LIFECYCLE ─────────────────────────────────────────────

/**
 * Update warning lifecycle status.
 * Used for ACTIVE→RESOLVED and ACTIVE→SUPERSEDED transitions.
 */
export async function updateWarningLifecycle(
  warningId: number,
  newLifecycle: WarningLifecycle
): Promise<boolean> {
  try {
    const updateData: Record<string, unknown> = {
      lifecycle: newLifecycle,
      lifecycleStatus: newLifecycle,
    };

    if (newLifecycle === "RESOLVED") {
      updateData.effectiveUntil = new Date();
    } else if (newLifecycle === "SUPERSEDED") {
      updateData.supersededAt = new Date();
    }

    await db
      .update(p6Warnings)
      .set(updateData as any)
      .where(eq(p6Warnings.id, warningId));

    return true;
  } catch (error) {
    console.error("[P6-Warning] Lifecycle update failure:", error);
    return false;
  }
}

// ─── READ ACTIVE WARNINGS ─────────────────────────────────────────

/**
 * Read all ACTIVE warnings for an entity.
 * Used for dedup checks during warning generation.
 */
export async function readActiveWarnings(
  entityType: EntityType,
  entityId: number
): Promise<WarningRecord[]> {
  try {
    const rows = await db
      .select()
      .from(p6Warnings)
      .where(
        and(
          eq(p6Warnings.entityType, entityType),
          eq(p6Warnings.entityId, entityId),
          eq(p6Warnings.lifecycleStatus, "ACTIVE")
        )
      )
      .orderBy(desc(p6Warnings.detectedAt));

    return rows.map(rowToWarningRecord);
  } catch (error) {
    console.error("[P6-Warning] Read active warnings failure:", error);
    return [];
  }
}

/**
 * Read warning history for an entity.
 */
export async function readWarningHistory(
  entityType: EntityType,
  entityId: number,
  limit: number = 50
): Promise<WarningRecord[]> {
  try {
    const rows = await db
      .select()
      .from(p6Warnings)
      .where(
        and(
          eq(p6Warnings.entityType, entityType),
          eq(p6Warnings.entityId, entityId)
        )
      )
      .orderBy(desc(p6Warnings.detectedAt))
      .limit(limit);

    return rows.map(rowToWarningRecord);
  } catch (error) {
    console.error("[P6-Warning] Read warning history failure:", error);
    return [];
  }
}

// ─── ROW MAPPER ───────────────────────────────────────────────────

function rowToWarningRecord(row: typeof p6Warnings.$inferSelect): WarningRecord {
  return {
    id: row.id,
    entity_type: row.entityType as EntityType,
    entity_id: row.entityId,
    warning_type: row.warningType as WarningType,
    severity: row.severity as Severity,
    lifecycle: row.lifecycle as WarningLifecycle,
    message: row.message,
    health_score: row.healthScore,
    previous_health_score: row.previousHealthScore,
    health_delta: row.healthDelta,
    regime_state: row.regimeState,
    previous_regime_state: row.previousRegimeState,
    confidence: row.confidence,
    dedup_key: row.dedupKey,
    quality_metadata: row.qualityMetadata as Record<string, unknown> | null,
    freshness_metadata: row.freshnessMetadata as Record<string, unknown> | null,
    evidence: row.evidence as Record<string, unknown> | null,
    version: {
      algorithm_version: row.algorithmVersion,
      parameter_version: row.parameterVersion,
      schema_version: row.schemaVersion,
      config_hash: row.configHash,
    },
    provenance: row.provenance as unknown as WarningProvenance,
    detection_window: row.detectionWindow,
    detected_at: row.detectedAt,
    effective_from: row.effectiveFrom,
    effective_until: row.effectiveUntil,
    superseded_at: row.supersededAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
