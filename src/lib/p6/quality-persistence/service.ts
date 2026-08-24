// P6 Data Quality V1 — Persistence Service
// Authority: P6-01D-D1 (Frozen Persistence Model), P6-01D-D3 (Task)
//
// Operations:
// - upsertQualityResult(): persist latest quality classification
// - getQualityByIdentity(): retrieve by semantic identity
// - getQualityForMetric(): convenience for single metric lookup
//
// D1 constraints:
// - observed_at NULL = UNKNOWN (no sentinel)
// - Partial unique indexes enforce latest-only per slot
// - Evidence persisted losslessly as JSONB
// - quality_config_version carried through

import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { p6ObservationQuality, p6QualityRuleConfig } from "@/db/schema";
import type {
  ObservationQualityInsert,
  ObservationQualityRecord,
  QualityRuleConfigRecord,
  QualityLookupKey,
} from "./types";
import type { QualityState, QualityEvidence } from "../quality/types";

// ─── UPSERT ───────────────────────────────────────────────────────────

/**
 * Persist a quality classification result.
 *
 * Uses Drizzle's onConflictDoUpdate targeting the primary key.
 * Because PostgreSQL partial unique indexes cannot be directly used as
 * conflict targets by Drizzle's onConflictDoUpdate, the application-level
 * strategy is:
 *
 * 1. Try to find an existing row matching the full semantic identity.
 * 2. If found → UPDATE it.
 * 3. If not found → INSERT it.
 *
 * This guarantees latest-only semantics (PD-17-RES) for both KNOWN and
 * UNKNOWN observed_at slots.
 *
 * The application holds the refresh lock (checkRefreshLock), so concurrent
 * upserts for the same identity do not occur in production.
 */
export async function upsertQualityResult(
  insert: ObservationQualityInsert
): Promise<ObservationQualityRecord> {
  const { entityId, metric, source, observedAt, timeframe } = insert;

  // Try to find existing row
  const existing = await db
    .select()
    .from(p6ObservationQuality)
    .where(
      and(
        eq(p6ObservationQuality.entityId, entityId),
        eq(p6ObservationQuality.metric, metric),
        eq(p6ObservationQuality.source, source),
        observedAt === null
          ? isNull(p6ObservationQuality.observedAt)
          : eq(p6ObservationQuality.observedAt, observedAt),
        eq(p6ObservationQuality.timeframe, timeframe)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Update existing
    const [updated] = await db
      .update(p6ObservationQuality)
      .set({
        qualityStatus: insert.qualityStatus,
        observationStatus: insert.observationStatus,
        qualityConfigVersion: insert.qualityConfigVersion,
        evidence: insert.evidence as unknown as Record<string, unknown>[],
        qualityEvaluatedAt: insert.qualityEvaluatedAt,
        collectedAt: insert.collectedAt ?? null,
        updatedAt: new Date(),
      })
      .where(eq(p6ObservationQuality.id, existing[0].id))
      .returning();

    return toRecord(updated);
  }

  // Insert new
  const [created] = await db
    .insert(p6ObservationQuality)
    .values({
      entityId,
      metric,
      source,
      observedAt,
      timeframe,
      qualityStatus: insert.qualityStatus,
      observationStatus: insert.observationStatus,
      qualityConfigVersion: insert.qualityConfigVersion,
      evidence: insert.evidence as unknown as Record<string, unknown>[],
      qualityEvaluatedAt: insert.qualityEvaluatedAt,
      collectedAt: insert.collectedAt ?? null,
    })
    .returning();

  return toRecord(created);
}

// ─── RETRIEVAL ────────────────────────────────────────────────────────

/**
 * Retrieve quality classification by full semantic identity.
 * Returns null if no record exists.
 */
export async function getQualityByIdentity(
  key: QualityLookupKey
): Promise<ObservationQualityRecord | null> {
  const rows = await db
    .select()
    .from(p6ObservationQuality)
    .where(
      and(
        eq(p6ObservationQuality.entityId, key.entityId),
        eq(p6ObservationQuality.metric, key.metric),
        eq(p6ObservationQuality.source, key.source),
        key.observedAt === null
          ? isNull(p6ObservationQuality.observedAt)
          : eq(p6ObservationQuality.observedAt, key.observedAt),
        eq(p6ObservationQuality.timeframe, key.timeframe)
      )
    )
    .limit(1);

  return rows.length > 0 ? toRecord(rows[0]) : null;
}

/**
 * Convenience: get quality for a specific metric on a given entity/date.
 * Uses approximate join on (entityId, metric, source, timeframe) with
 * observed_at filtering.
 */
export async function getQualityForMetric(
  entityId: number,
  metric: string,
  source: string,
  timeframe: string
): Promise<ObservationQualityRecord[]> {
  const rows = await db
    .select()
    .from(p6ObservationQuality)
    .where(
      and(
        eq(p6ObservationQuality.entityId, entityId),
        eq(p6ObservationQuality.metric, metric),
        eq(p6ObservationQuality.source, source),
        eq(p6ObservationQuality.timeframe, timeframe)
      )
    )
    .orderBy(p6ObservationQuality.qualityEvaluatedAt);

  return rows.map(toRecord);
}

// ─── RULE CONFIG ──────────────────────────────────────────────────────

/**
 * Get all enabled rules for a given config version.
 */
export async function getRulesForConfig(
  configVersion: string
): Promise<QualityRuleConfigRecord[]> {
  const rows = await db
    .select()
    .from(p6QualityRuleConfig)
    .where(
      and(
        eq(p6QualityRuleConfig.qualityConfigVersion, configVersion),
        eq(p6QualityRuleConfig.isEnabled, true)
      )
    );

  return rows.map((r) => ({
    id: r.id,
    qualityConfigVersion: r.qualityConfigVersion,
    checkId: r.checkId,
    metric: r.metric,
    checkType: r.checkType,
    parameters: (r.parameters as Record<string, unknown>) ?? {},
    isEnabled: r.isEnabled,
    createdAt: r.createdAt,
  }));
}

// ─── HELPERS ──────────────────────────────────────────────────────────

function toRecord(row: typeof p6ObservationQuality.$inferSelect): ObservationQualityRecord {
  return {
    id: row.id,
    entityId: row.entityId,
    metric: row.metric,
    source: row.source,
    observedAt: row.observedAt,
    timeframe: row.timeframe,
    qualityStatus: row.qualityStatus,
    observationStatus: row.observationStatus,
    qualityConfigVersion: row.qualityConfigVersion,
    evidence: (row.evidence as QualityEvidence[]) ?? [],
    qualityEvaluatedAt: row.qualityEvaluatedAt,
    collectedAt: row.collectedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
