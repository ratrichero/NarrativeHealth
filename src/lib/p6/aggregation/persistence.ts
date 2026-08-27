/**
 * P6-06D — Summary Persistence
 *
 * PD-06A-07: latest-only persistence in p6_intelligence_summaries.
 * PD-06C-02: idempotent re-run — same (entity, timeframe, window_end) UPSERTS
 *   rather than duplicating; a NEW window supersedes the prior CURRENT row.
 * IA-12: infrastructure/persistence failure NEVER becomes quality or content.
 * IA-08: never writes to P5 tables.
 */

import { and, asc, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { p6IntelligenceSummaries } from "@/db/schema";
import type {
  ExplanationItem,
  IntelligenceSummary,
  SummaryLifecycle,
  WarningSummaryItem,
} from "./types";

// ─── PERSIST ──────────────────────────────────────────────────────

/**
 * Persist a summary with idempotent supersession semantics:
 * 1. Supersede any other CURRENT summary for this entity+timeframe.
 * 2. Upsert the row for the exact identity tuple — repeated evaluation of the
 *    same window replaces content instead of creating duplicates (IA-24).
 */
export async function persistSummary(
  summary: IntelligenceSummary,
  lifecycle: SummaryLifecycle = "CURRENT"
): Promise<{ id: number } | null> {
  try {
    // Supersede other CURRENT rows for this entity (different window_end).
    await db
      .update(p6IntelligenceSummaries)
      .set({ status: "SUPERSEDED", updatedAt: new Date() })
      .where(
        and(
          eq(p6IntelligenceSummaries.entityType, summary.entity_type),
          eq(p6IntelligenceSummaries.entityId, summary.entity_id),
          eq(p6IntelligenceSummaries.timeframe, summary.timeframe),
          ne(p6IntelligenceSummaries.windowEnd, summary.window_end),
          eq(p6IntelligenceSummaries.status, "CURRENT")
        )
      );

    const values = {
      entityType: summary.entity_type,
      entityId: summary.entity_id,
      timeframe: summary.timeframe,
      status: lifecycle,
      healthScore: summary.health_score,
      snapshotConfidence: summary.snapshot_confidence,
      regimeState: summary.regime_state,
      regimeConfidence: summary.regime_confidence,
      activeWarningCount: summary.active_warning_count,
      highestSeverity: summary.highest_severity,
      activeWarnings: summary.active_warnings as unknown as Record<string, unknown>[],
      healthDelta: summary.health_delta,
      healthChangePct: summary.health_change_pct,
      regimeChanged: summary.regime_changed,
      previousRegimeState: summary.previous_regime_state,
      newWarningCount: summary.new_warning_count,
      resolvedWarningCount: summary.resolved_warning_count,
      whatChanged: summary.what_changed as unknown as Record<string, unknown>[],
      whyExplanation: summary.why as unknown as Record<string, unknown>[],
      whatToWatch: summary.what_to_watch as unknown as Record<string, unknown>[],
      qualityMetadata: summary.quality_metadata,
      freshnessMetadata: summary.freshness_metadata,
      provenance: summary.provenance as unknown as Record<string, unknown>,
      algorithmVersion: summary.version.algorithm_version,
      parameterVersion: summary.version.parameter_version,
      schemaVersion: summary.version.schema_version,
      configHash: summary.version.config_hash,
      calculatedAt: summary.calculated_at,
      windowEnd: summary.window_end,
      updatedAt: new Date(),
    };

    const result = await db
      .insert(p6IntelligenceSummaries)
      .values(values)
      .onConflictDoUpdate({
        target: [
          p6IntelligenceSummaries.entityType,
          p6IntelligenceSummaries.entityId,
          p6IntelligenceSummaries.timeframe,
          p6IntelligenceSummaries.windowEnd,
        ],
        set: {
          ...values,
          createdAt: undefined,
        } as Partial<typeof values>,
      })
      .returning({ id: p6IntelligenceSummaries.id });

    return result[0] ?? null;
  } catch (error) {
    // IA-12: infrastructure failure — never converted to quality or content.
    console.error("[P6-Summary] Persistence failure:", error);
    return null;
  }
}

// ─── READ ─────────────────────────────────────────────────────────

export interface StoredSummaryRow {
  readonly id: number;
  readonly entity_type: string;
  readonly entity_id: number;
  readonly timeframe: string;
  readonly status: SummaryLifecycle;
  readonly health_score: number | null;
  readonly snapshot_confidence: number | null;
  readonly regime_state: string | null;
  readonly regime_confidence: number | null;
  readonly active_warning_count: number;
  readonly highest_severity: string | null;
  readonly active_warnings: WarningSummaryItem[];
  readonly health_delta: number | null;
  readonly health_change_pct: number | null;
  readonly regime_changed: boolean;
  readonly previous_regime_state: string | null;
  readonly new_warning_count: number;
  readonly resolved_warning_count: number;
  readonly what_changed: ExplanationItem[];
  readonly why: ExplanationItem[];
  readonly what_to_watch: ExplanationItem[];
  readonly provenance: Record<string, unknown>;
  readonly calculated_at: Date;
  readonly window_end: Date;
}

/** Read the current summary for an entity (latest semantics). */
export async function readCurrentSummary(
  entityType: string,
  entityId: number,
  timeframe: string = "DAILY"
): Promise<StoredSummaryRow | null> {
  try {
    const rows = await db
      .select()
      .from(p6IntelligenceSummaries)
      .where(
        and(
          eq(p6IntelligenceSummaries.entityType, entityType),
          eq(p6IntelligenceSummaries.entityId, entityId),
          eq(p6IntelligenceSummaries.timeframe, timeframe)
        )
      )
      .orderBy(desc(p6IntelligenceSummaries.windowEnd))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return rowToStoredSummary(row);
  } catch (error) {
    console.error("[P6-Summary] Read failure:", error);
    return null;
  }
}

/**
 * Read summary history for an entity.
 * P6-08: Returns ALL records (CURRENT + SUPERSEDED) ordered by window_end ASC.
 */
export async function readSummaryHistory(
  entityType: string,
  entityId: number,
  timeframe: string = "DAILY",
  limit: number = 100
): Promise<StoredSummaryRow[]> {
  try {
    const rows = await db
      .select()
      .from(p6IntelligenceSummaries)
      .where(
        and(
          eq(p6IntelligenceSummaries.entityType, entityType),
          eq(p6IntelligenceSummaries.entityId, entityId),
          eq(p6IntelligenceSummaries.timeframe, timeframe)
        )
      )
      .orderBy(asc(p6IntelligenceSummaries.windowEnd))
      .limit(limit);

    return rows.map(rowToStoredSummary);
  } catch (error) {
    console.error("[P6-Summary] Read history failure:", error);
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToStoredSummary(row: any): StoredSummaryRow {
  return {
    id: row.id,
    entity_type: row.entityType,
    entity_id: row.entityId,
    timeframe: row.timeframe,
    status: row.status as SummaryLifecycle,
    health_score: row.healthScore,
    snapshot_confidence: row.snapshotConfidence,
    regime_state: row.regimeState,
    regime_confidence: row.regimeConfidence,
    active_warning_count: row.activeWarningCount,
    highest_severity: row.highestSeverity,
    active_warnings: (row.activeWarnings ?? []) as WarningSummaryItem[],
    health_delta: row.healthDelta,
    health_change_pct: row.healthChangePct,
    regime_changed: row.regimeChanged,
    previous_regime_state: row.previousRegimeState,
    new_warning_count: row.newWarningCount,
    resolved_warning_count: row.resolvedWarningCount,
    what_changed: (row.whatChanged ?? []) as ExplanationItem[],
    why: (row.whyExplanation ?? []) as ExplanationItem[],
    what_to_watch: (row.whatToWatch ?? []) as ExplanationItem[],
    provenance: row.provenance as Record<string, unknown>,
    calculated_at: row.calculatedAt,
    window_end: row.windowEnd,
  };
}
