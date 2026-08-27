/**
 * P6-07D — Pipeline Orchestration
 *
 * PD-07A-01: Wire P6-04 → P6-05 → P6-06 after P6-03 snapshot.
 * PD-E2: Never block refresh on P6-04/05/06 failure.
 *
 * Orchestrates the frozen P6 downstream engines:
 *   P6-03 (already persisted by refresh) → P6-04 → P6-05 → P6-06.
 *   Each entity is independently wrapped in try/catch per PD-E2.
 */

import { readCurrentCoinSnapshots, readCurrentNarrativeSnapshots, readSnapshotHistory, type SnapshotRecord } from "../snapshot/persistence";
import { detectRegime, REGIME_V1_VERSION } from "../regime";
import { persistRegimeState, readCurrentRegime } from "../regime/persistence";
import type { RegimeSnapshotInput } from "../regime/types";
import { detectWarnings, WARNING_V1_VERSION } from "../warning";
import { persistWarning, updateWarningLifecycle, readActiveWarnings } from "../warning/persistence";
import type { WarningSnapshotInput, WarningRegimeInput } from "../warning/types";
import { aggregateIntelligence, SUMMARY_V1_VERSION, DEFAULT_SUMMARY_CONFIG } from "../aggregation";
import { persistSummary, readCurrentSummary } from "../aggregation/persistence";

export interface PipelineResult {
  regimeCount: number;
  warningCount: number;
  summaryCount: number;
}

// ─── MAPPING HELPERS ───────────────────────────────────────────────

/** Map SnapshotRecord to RegimeSnapshotInput (P6-04). */
function toRegimeSnapshotInput(
  snapshot: SnapshotRecord,
  entityType: "coin" | "narrative",
  entityId: number
): RegimeSnapshotInput {
  return {
    snapshot_id: snapshot.id,
    entity_type: entityType,
    entity_id: entityId,
    health_score: snapshot.healthScore ?? 50,
    calculation_time: snapshot.calculationTime ?? snapshot.windowEnd,
    quality_status: "UNKNOWN",
    freshness_status: "UNKNOWN",
  };
}

/** Map SnapshotRecord to WarningSnapshotInput (P6-05). */
function toWarningSnapshotInput(
  snapshot: SnapshotRecord,
  entityType: "coin" | "narrative",
  entityId: number
): WarningSnapshotInput {
  return {
    snapshot_id: snapshot.id,
    entity_type: entityType,
    entity_id: entityId,
    health_score: snapshot.healthScore ?? 50,
    confidence_score: snapshot.confidenceScore ?? null,
    calculation_time: snapshot.calculationTime ?? snapshot.windowEnd,
    window_end: snapshot.windowEnd,
    quality_status: "UNKNOWN",
    freshness_status: "UNKNOWN",
    quality_metadata: snapshot.qualityMetadata as Record<string, unknown> | null,
    freshness_metadata: snapshot.freshnessMetadata as Record<string, unknown> | null,
  };
}

/** Map RegimeOutput fields to WarningRegimeInput (P6-05). */
function toWarningRegimeInput(
  entityType: "coin" | "narrative",
  entityId: number,
  regime: { regimeState: string; confidence: number; consecutiveCount: number; healthScore: number; calculationTime: Date }
): WarningRegimeInput {
  return {
    entity_type: entityType,
    entity_id: entityId,
    regime_state: regime.regimeState,
    previous_state: null,
    confidence: regime.confidence,
    consecutive_count: regime.consecutiveCount,
    health_score: regime.healthScore,
    calculation_time: regime.calculationTime,
  };
}

// ─── SINGLE-ENTITY PIPELINE ───────────────────────────────────────

/** Process a single entity through P6-04 → P6-05 → P6-06. */
async function processEntity(
  entityType: "coin" | "narrative",
  entityId: number,
  currentSnapshot: SnapshotRecord
): Promise<{ regime: boolean; warnings: number; summary: boolean }> {
  let regimePersisted = false;
  let warningCount = 0;
  let summaryPersisted = false;

  // ── Step 1: P6-04 Regime Detection ──
  // Read historical snapshots (excluding current) for regime lookback
  const history = await readSnapshotHistory(entityType, entityId, currentSnapshot.snapshotType as "COIN_HEALTH" | "NARRATIVE_HEALTH", 100);
  const historicalSnapshots = history
    .filter((s) => s.id !== currentSnapshot.id)
    .map((s) => toRegimeSnapshotInput(s, entityType, entityId));

  const regimeInput = {
    entity_type: entityType as "coin" | "narrative",
    entity_id: entityId,
    current_snapshot: toRegimeSnapshotInput(currentSnapshot, entityType, entityId),
    historical_snapshots: historicalSnapshots,
    regime_version: REGIME_V1_VERSION,
    calculation_time: new Date(),
  };

  const regimeOutput = detectRegime(regimeInput);

  // Persist P6-04 regime
  const regimePersistResult = await persistRegimeState({
    entityType,
    entityId,
    regimeState: regimeOutput.regime_state,
    previousState: regimeOutput.previous_state,
    confidence: regimeOutput.confidence,
    consecutiveCount: regimeOutput.consecutive_count,
    healthScore: regimeOutput.health_score,
    regimeVersion: regimeOutput.regime_version,
    snapshotVersionId: regimeOutput.snapshot_version_id,
    provenance: regimeOutput.provenance,
    qualityMetadata: regimeOutput.quality_metadata,
    freshnessMetadata: regimeOutput.freshness_metadata,
    calculationTime: regimeOutput.calculation_time,
  });
  regimePersisted = regimePersistResult !== null;

  // ── Step 2: P6-05 Warning Detection ──
  // Get previous snapshot (if available)
  const previousSnapshot = history.length > 1 ? history[history.length - 2] : null;
  const currentSnapshotInput = toWarningSnapshotInput(currentSnapshot, entityType, entityId);
  const previousSnapshotInput = previousSnapshot ? toWarningSnapshotInput(previousSnapshot, entityType, entityId) : null;

  // Get previous regime from history
  const previousRegime = previousSnapshot
    ? await readCurrentRegime(entityType, entityId)
    : null;

  const currentRegimeForWarning = toWarningRegimeInput(entityType, entityId, {
    regimeState: regimeOutput.regime_state,
    confidence: regimeOutput.confidence,
    consecutiveCount: regimeOutput.consecutive_count,
    healthScore: regimeOutput.health_score,
    calculationTime: regimeOutput.calculation_time,
  });

  const previousRegimeForWarning = previousRegime
    ? toWarningRegimeInput(entityType, entityId, previousRegime)
    : null;

  // Get existing active warnings for dedup check
  const existingActiveWarnings = await readActiveWarnings(entityType, entityId);

  const warningOutput = detectWarnings({
    entity_type: entityType,
    entity_id: entityId,
    current_snapshot: currentSnapshotInput,
    previous_snapshot: previousSnapshotInput,
    current_regime: currentRegimeForWarning,
    previous_regime: previousRegimeForWarning,
    warning_version: WARNING_V1_VERSION,
    calculation_time: new Date(),
    existing_active_warnings: existingActiveWarnings,
  });

  // Persist new warnings
  for (const candidate of warningOutput.warnings) {
    const persistResult = await persistWarning({
      entityType,
      entityId,
      warningType: candidate.warning_type,
      severity: candidate.severity,
      lifecycle: "ACTIVE",
      message: candidate.message,
      healthScore: candidate.health_score,
      previousHealthScore: candidate.previous_health_score,
      healthDelta: candidate.health_delta,
      regimeState: candidate.regime_state,
      previousRegimeState: candidate.previous_regime_state,
      confidence: candidate.confidence,
      dedupKey: candidate.dedup_key,
      qualityMetadata: candidate.quality_metadata,
      freshnessMetadata: candidate.freshness_metadata,
      evidence: candidate.evidence,
      version: WARNING_V1_VERSION,
      provenance: candidate.provenance,
      detectionWindow: candidate.detection_window,
      detectedAt: candidate.detected_at,
      effectiveFrom: candidate.detected_at,
    });
    if (persistResult) warningCount++;
  }

  // Update lifecycle for warnings to resolve/supersede
  for (const warning of warningOutput.warnings_to_resolve) {
    await updateWarningLifecycle(warning.id, "RESOLVED");
    warningCount++;
  }
  for (const warning of warningOutput.warnings_to_supersede) {
    await updateWarningLifecycle(warning.id, "SUPERSEDED");
    warningCount++;
  }

  // ── Step 3: P6-06 Intelligence Aggregation ──
  const activeWarnings = await readActiveWarnings(entityType, entityId);
  const previousSummary = await readCurrentSummary(entityType, entityId);
  const summaryInput = {
    entity_type: entityType,
    entity_id: entityId,
    timeframe: "DAILY" as const,
    current_snapshot: {
      snapshot_id: currentSnapshot.id,
      health_score: currentSnapshot.healthScore ?? null,
      confidence_score: currentSnapshot.confidenceScore ?? null,
      calculation_time: currentSnapshot.calculationTime ?? currentSnapshot.windowEnd,
      window_end: currentSnapshot.windowEnd,
      quality_status: "UNKNOWN",
      freshness_status: "UNKNOWN",
      quality_metadata: currentSnapshot.qualityMetadata as Record<string, unknown> | null,
      freshness_metadata: currentSnapshot.freshnessMetadata as Record<string, unknown> | null,
    },
    current_regime: {
      regime_id: regimePersistResult?.id ?? 0,
      regime_state: regimeOutput.regime_state,
      confidence: regimeOutput.confidence,
      calculation_time: regimeOutput.calculation_time,
    },
    previous: {
      previous_snapshot: previousSnapshot ? {
        snapshot_id: previousSnapshot.id,
        health_score: previousSnapshot.healthScore ?? null,
        confidence_score: previousSnapshot.confidenceScore ?? null,
        window_end: previousSnapshot.windowEnd,
      } : null,
      previous_regime_state: previousRegime?.regimeState ?? null,
      previous_calculated_at: previousRegime?.calculationTime ?? null,
    },
    active_warnings: activeWarnings.map((w) => ({
      warning_id: w.id,
      warning_type: w.warning_type,
      severity: w.severity,
      message: w.message,
      detection_window: w.detection_window,
      detected_at: w.detected_at,
      effective_until: w.effective_until ?? null,
    })),
    recently_resolved_warnings: warningOutput.warnings_to_resolve.map((w) => ({
      warning_id: w.id,
      warning_type: w.warning_type,
      severity: w.severity,
      message: w.message,
      detection_window: w.detection_window,
      detected_at: w.detected_at,
      effective_until: w.effective_until ?? null,
    })),
    calculation_time: new Date(),
    version: SUMMARY_V1_VERSION,
    config: DEFAULT_SUMMARY_CONFIG,
  };

  const summary = aggregateIntelligence(summaryInput);

  if (summary) {
    const summaryPersistResult = await persistSummary(summary);
    summaryPersisted = summaryPersistResult !== null;
  }

  return { regime: regimePersisted, warnings: warningCount, summary: summaryPersisted };
}

// ─── MAIN PIPELINE ─────────────────────────────────────────────────

/**
 * Run the P6 downstream pipeline: P6-04 → P6-05 → P6-06.
 * Called after P6-03 snapshot generation completes.
 *
 * Processes each entity independently per PD-E2.
 */
export async function runP6DownstreamPipeline(): Promise<PipelineResult> {
  const result: PipelineResult = { regimeCount: 0, warningCount: 0, summaryCount: 0 };

  try {
    // Read all current snapshots (coins + narratives)
    const coinSnapshots = await readCurrentCoinSnapshots();

    // Also read current narrative snapshots
    const currentNarrativeSnapshots = await readCurrentNarrativeSnapshots();

    const allCurrentSnapshots = [
      ...coinSnapshots.map((s) => ({ ...s, entityType: "coin" as const })),
      ...currentNarrativeSnapshots.map((s) => ({ ...s, entityType: "narrative" as const })),
    ];

    if (allCurrentSnapshots.length === 0) {
      console.log("P6 downstream pipeline: no snapshots to process");
      return result;
    }

    console.log(`P6 downstream pipeline: processing ${allCurrentSnapshots.length} entities (${coinSnapshots.length} coins, ${currentNarrativeSnapshots.length} narratives)`);

    // Process each entity independently (PD-E2: entity failure does not block others)
    for (const snapshot of allCurrentSnapshots) {
      const entityType = snapshot.entityType;
      const entityId = snapshot.entityId;

      try {
        const entityResult = await processEntity(entityType, entityId, snapshot);
        if (entityResult.regime) result.regimeCount++;
        result.warningCount += entityResult.warnings;
        if (entityResult.summary) result.summaryCount++;
      } catch (error) {
        // PD-E2: entity-level failure does not block other entities
        console.error(`P6 downstream pipeline: entity ${entityType}:${entityId} failed (non-blocking):`, error);
      }
    }

    console.log(`P6 downstream pipeline: regime=${result.regimeCount} warnings=${result.warningCount} summaries=${result.summaryCount}`);
  } catch (error) {
    console.error("P6 downstream pipeline error (non-blocking):", error);
  }

  return result;
}
