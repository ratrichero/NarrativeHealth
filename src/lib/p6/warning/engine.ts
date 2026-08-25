/**
 * P6-05D — Warning Engine
 *
 * Orchestrates warning generation from P6-03 snapshots and P6-04 regimes.
 * Consumes P6-native outputs as input authority.
 *
 * Implements:
 * - PD-05B-01: 7 warning types (FROZEN)
 * - PD-05B-02: 5 severity levels (FROZEN)
 * - PD-05B-03: Multi-factor severity (FROZEN)
 * - PD-05B-04: Material thresholds (FROZEN)
 * - PD-05C-01: Occurrence-based identity (FROZEN)
 * - PD-05B-10: 4-state lifecycle (FROZEN)
 *
 * Authority: P6-05B, P6-05C, P6-05C1
 */

import type {
  WarningEngineInput,
  WarningOutput,
  WarningCandidate,
  WarningRecord,
  WarningConfig,
  WarningType,
  WarningVersionTuple,
  WarningProvenance,
} from "./types";
import { DEFAULT_WARNING_CONFIG, WARNING_V1_VERSION } from "./types";
import {
  checkHealthThreshold,
  checkConfidenceThreshold,
  checkRegimeChangeThreshold,
  checkQualityThreshold,
  checkFreshnessThreshold,
} from "./thresholds";
import { determineSeverity } from "./severity";
import {
  computeDedupKey,
  buildWarningIdentity,
  isDuplicate,
  isWithinCooldown,
  findWarningsToSupersede,
  findWarningsToResolve,
} from "./identity";
import { determineInitialLifecycle, afterPersistence } from "./lifecycle";
import {
  assembleWarningProvenance,
  assembleQualitySummary,
  assembleFreshnessSummary,
} from "./provenance";

// ─── MESSAGE GENERATION ───────────────────────────────────────────

function generateMessage(
  warningType: WarningType,
  entityType: string,
  entityId: number,
  healthDelta: number | null,
  regimeState: string | null,
  previousRegimeState: string | null,
  confidenceDrop: number | null
): string {
  switch (warningType) {
    case "HEALTH_DETERIORATION":
      return `${entityType} ${entityId}: health deteriorated by ${Math.abs(healthDelta ?? 0).toFixed(1)} points`;
    case "HEALTH_IMPROVEMENT":
      return `${entityType} ${entityId}: health improved by ${(healthDelta ?? 0).toFixed(1)} points`;
    case "REGIME_CHANGE":
      return `${entityType} ${entityId}: regime changed from ${previousRegimeState} to ${regimeState}`;
    case "REGIME_TRANSITION":
      return `${entityType} ${entityId}: regime entering TRANSITIONING from ${previousRegimeState}`;
    case "CONFIDENCE_DETERIORATION":
      return `${entityType} ${entityId}: confidence dropped by ${Math.abs(confidenceDrop ?? 0).toFixed(1)} points`;
    case "DATA_QUALITY_DEGRADATION":
      return `${entityType} ${entityId}: data quality degraded`;
    case "FRESHNESS_DEGRADATION":
      return `${entityType} ${entityId}: data freshness degraded`;
    default:
      return `${entityType} ${entityId}: ${warningType}`;
  }
}

function generateEvidence(
  warningType: WarningType,
  healthDelta: number | null,
  regimeState: string | null,
  previousRegimeState: string | null,
  confidence: number,
  qualityStatus: string | null,
  freshnessStatus: string | null
): Record<string, unknown> {
  return {
    warning_type: warningType,
    health_delta: healthDelta,
    regime_state: regimeState,
    previous_regime_state: previousRegimeState,
    confidence,
    quality_status: qualityStatus,
    freshness_status: freshnessStatus,
  };
}

// ─── MAIN ENGINE ──────────────────────────────────────────────────

/**
 * Run warning detection for an entity.
 *
 * Compares current snapshot/regime against previous to detect material changes.
 * Returns candidate warnings with severity, dedup keys, and provenance.
 *
 * @param input - Entity snapshots, regime data, existing warnings
 * @param config - Warning configuration (thresholds, cooldown)
 * @returns Warning output with candidates, resolutions, and supersessions
 */
export function detectWarnings(
  input: WarningEngineInput,
  config: WarningConfig = DEFAULT_WARNING_CONFIG
): WarningOutput {
  const {
    entity_type,
    entity_id,
    current_snapshot,
    previous_snapshot,
    current_regime,
    previous_regime,
    warning_version,
    calculation_time,
    existing_active_warnings,
  } = input;

  const warnings: WarningCandidate[] = [];
  const warningsToResolve: WarningRecord[] = [];
  const warningsToSupersede: WarningRecord[] = [];

  // Skip if no previous snapshot for comparison
  if (!previous_snapshot) {
    return { warnings: [], warnings_to_resolve: [], warnings_to_supersede: [] };
  }

  const healthDelta = current_snapshot.health_score - previous_snapshot.health_score;
  const confidenceDrop =
    current_regime && previous_regime
      ? current_regime.confidence - previous_regime.confidence
      : null;

  // ── 1. HEALTH_DETERIORATION / HEALTH_IMPROVEMENT ──
  const healthCheck = checkHealthThreshold(current_snapshot, previous_snapshot, config);
  if (healthCheck.triggered && healthCheck.delta !== null) {
    const isDeterioration = healthCheck.delta < 0;
    const warningType: WarningType = isDeterioration
      ? "HEALTH_DETERIORATION"
      : "HEALTH_IMPROVEMENT";

    const { severity, factors } = determineSeverity(
      warningType,
      healthCheck.delta,
      current_regime?.regime_state ?? null,
      previous_regime?.regime_state ?? null,
      current_regime?.confidence ?? 0,
      current_snapshot,
      previous_snapshot
    );

    const detectionWindow = current_snapshot.window_end;
    const identity = buildWarningIdentity(entity_type, entity_id, warningType, detectionWindow);
    const dedupKey = computeDedupKey(identity);

    // Check dedup and cooldown
    if (!isDuplicate(dedupKey, existing_active_warnings) &&
        !isWithinCooldown(entity_type, entity_id, warningType, detectionWindow, existing_active_warnings, config)) {
      const provenance = assembleWarningProvenance({
        entityType: entity_type,
        entityId: entity_id,
        sourceRecordId: null,
        currentSnapshot: current_snapshot,
        previousSnapshot: previous_snapshot,
        currentRegime: current_regime,
        healthDelta: healthCheck.delta,
        warningVersion: warning_version,
        detectionTime: calculation_time,
        detectionWindow,
        qualitySummary: assembleQualitySummary(current_snapshot, previous_snapshot),
        freshnessSummary: assembleFreshnessSummary(current_snapshot, previous_snapshot),
      });

      warnings.push({
        warning_type: warningType,
        severity,
        severity_factors: factors,
        message: generateMessage(warningType, entity_type, entity_id, healthCheck.delta, null, null, null),
        health_score: current_snapshot.health_score,
        previous_health_score: previous_snapshot.health_score,
        health_delta: healthCheck.delta,
        regime_state: current_regime?.regime_state ?? null,
        previous_regime_state: previous_regime?.regime_state ?? null,
        confidence: current_regime?.confidence ?? 0,
        dedup_key: dedupKey,
        quality_metadata: current_snapshot.quality_metadata,
        freshness_metadata: current_snapshot.freshness_metadata,
        evidence: generateEvidence(warningType, healthCheck.delta, null, null, 0, null, null),
        provenance,
        detection_window: detectionWindow,
        detected_at: calculation_time,
      });

      // Supersede existing warnings of same type
      const toSupersede = findWarningsToSupersede(entity_type, entity_id, warningType, existing_active_warnings);
      warningsToSupersede.push(...toSupersede);
    }
  }

  // ── 2. CONFIDENCE_DETERIORATION ──
  const confidenceCheck = checkConfidenceThreshold(current_regime, previous_regime, config);
  if (confidenceCheck.triggered && confidenceCheck.delta !== null) {
    const warningType: WarningType = "CONFIDENCE_DETERIORATION";

    const { severity, factors } = determineSeverity(
      warningType,
      null,
      current_regime?.regime_state ?? null,
      previous_regime?.regime_state ?? null,
      current_regime?.confidence ?? 0,
      current_snapshot,
      previous_snapshot
    );

    const detectionWindow = current_snapshot.window_end;
    const identity = buildWarningIdentity(entity_type, entity_id, warningType, detectionWindow);
    const dedupKey = computeDedupKey(identity);

    if (!isDuplicate(dedupKey, existing_active_warnings) &&
        !isWithinCooldown(entity_type, entity_id, warningType, detectionWindow, existing_active_warnings, config)) {
      const provenance = assembleWarningProvenance({
        entityType: entity_type,
        entityId: entity_id,
        sourceRecordId: null,
        currentSnapshot: current_snapshot,
        previousSnapshot: previous_snapshot,
        currentRegime: current_regime,
        healthDelta: null,
        warningVersion: warning_version,
        detectionTime: calculation_time,
        detectionWindow,
        qualitySummary: assembleQualitySummary(current_snapshot, previous_snapshot),
        freshnessSummary: assembleFreshnessSummary(current_snapshot, previous_snapshot),
      });

      warnings.push({
        warning_type: warningType,
        severity,
        severity_factors: factors,
        message: generateMessage(warningType, entity_type, entity_id, null, null, null, confidenceCheck.delta),
        health_score: current_snapshot.health_score,
        previous_health_score: previous_snapshot.health_score,
        health_delta: null,
        regime_state: current_regime?.regime_state ?? null,
        previous_regime_state: previous_regime?.regime_state ?? null,
        confidence: current_regime?.confidence ?? 0,
        dedup_key: dedupKey,
        quality_metadata: current_snapshot.quality_metadata,
        freshness_metadata: current_snapshot.freshness_metadata,
        evidence: generateEvidence(warningType, null, null, null, 0, null, null),
        provenance,
        detection_window: detectionWindow,
        detected_at: calculation_time,
      });

      const toSupersede = findWarningsToSupersede(entity_type, entity_id, warningType, existing_active_warnings);
      warningsToSupersede.push(...toSupersede);
    }
  }

  // ── 3. REGIME_CHANGE / REGIME_TRANSITION ──
  const regimeCheck = checkRegimeChangeThreshold(current_regime, previous_regime);

  if (regimeCheck.regimeChange.triggered) {
    const warningType: WarningType = "REGIME_CHANGE";
    const { severity, factors } = determineSeverity(
      warningType,
      null,
      current_regime?.regime_state ?? null,
      previous_regime?.regime_state ?? null,
      current_regime?.confidence ?? 0,
      current_snapshot,
      previous_snapshot
    );

    const detectionWindow = current_snapshot.window_end;
    const identity = buildWarningIdentity(entity_type, entity_id, warningType, detectionWindow);
    const dedupKey = computeDedupKey(identity);

    if (!isDuplicate(dedupKey, existing_active_warnings) &&
        !isWithinCooldown(entity_type, entity_id, warningType, detectionWindow, existing_active_warnings, config)) {
      const provenance = assembleWarningProvenance({
        entityType: entity_type,
        entityId: entity_id,
        sourceRecordId: null,
        currentSnapshot: current_snapshot,
        previousSnapshot: previous_snapshot,
        currentRegime: current_regime,
        healthDelta: null,
        warningVersion: warning_version,
        detectionTime: calculation_time,
        detectionWindow,
        qualitySummary: assembleQualitySummary(current_snapshot, previous_snapshot),
        freshnessSummary: assembleFreshnessSummary(current_snapshot, previous_snapshot),
      });

      warnings.push({
        warning_type: warningType,
        severity,
        severity_factors: factors,
        message: generateMessage(warningType, entity_type, entity_id, null,
          current_regime?.regime_state ?? null, previous_regime?.regime_state ?? null, null),
        health_score: current_snapshot.health_score,
        previous_health_score: previous_snapshot.health_score,
        health_delta: null,
        regime_state: current_regime?.regime_state ?? null,
        previous_regime_state: previous_regime?.regime_state ?? null,
        confidence: current_regime?.confidence ?? 0,
        dedup_key: dedupKey,
        quality_metadata: current_snapshot.quality_metadata,
        freshness_metadata: current_snapshot.freshness_metadata,
        evidence: generateEvidence(warningType, null,
          current_regime?.regime_state ?? null, previous_regime?.regime_state ?? null,
          current_regime?.confidence ?? 0, null, null),
        provenance,
        detection_window: detectionWindow,
        detected_at: calculation_time,
      });

      const toSupersede = findWarningsToSupersede(entity_type, entity_id, warningType, existing_active_warnings);
      warningsToSupersede.push(...toSupersede);
    }
  }

  if (regimeCheck.regimeTransition.triggered) {
    const warningType: WarningType = "REGIME_TRANSITION";
    const { severity, factors } = determineSeverity(
      warningType,
      null,
      current_regime?.regime_state ?? null,
      previous_regime?.regime_state ?? null,
      current_regime?.confidence ?? 0,
      current_snapshot,
      previous_snapshot
    );

    const detectionWindow = current_snapshot.window_end;
    const identity = buildWarningIdentity(entity_type, entity_id, warningType, detectionWindow);
    const dedupKey = computeDedupKey(identity);

    if (!isDuplicate(dedupKey, existing_active_warnings) &&
        !isWithinCooldown(entity_type, entity_id, warningType, detectionWindow, existing_active_warnings, config)) {
      const provenance = assembleWarningProvenance({
        entityType: entity_type,
        entityId: entity_id,
        sourceRecordId: null,
        currentSnapshot: current_snapshot,
        previousSnapshot: previous_snapshot,
        currentRegime: current_regime,
        healthDelta: null,
        warningVersion: warning_version,
        detectionTime: calculation_time,
        detectionWindow,
        qualitySummary: assembleQualitySummary(current_snapshot, previous_snapshot),
        freshnessSummary: assembleFreshnessSummary(current_snapshot, previous_snapshot),
      });

      warnings.push({
        warning_type: warningType,
        severity,
        severity_factors: factors,
        message: generateMessage(warningType, entity_type, entity_id, null,
          current_regime?.regime_state ?? null, previous_regime?.regime_state ?? null, null),
        health_score: current_snapshot.health_score,
        previous_health_score: previous_snapshot.health_score,
        health_delta: null,
        regime_state: current_regime?.regime_state ?? null,
        previous_regime_state: previous_regime?.regime_state ?? null,
        confidence: current_regime?.confidence ?? 0,
        dedup_key: dedupKey,
        quality_metadata: current_snapshot.quality_metadata,
        freshness_metadata: current_snapshot.freshness_metadata,
        evidence: generateEvidence(warningType, null,
          current_regime?.regime_state ?? null, previous_regime?.regime_state ?? null,
          current_regime?.confidence ?? 0, null, null),
        provenance,
        detection_window: detectionWindow,
        detected_at: calculation_time,
      });

      const toSupersede = findWarningsToSupersede(entity_type, entity_id, warningType, existing_active_warnings);
      warningsToSupersede.push(...toSupersede);
    }
  }

  // ── 4. DATA_QUALITY_DEGRADATION ──
  const qualityCheck = checkQualityThreshold(current_snapshot, previous_snapshot);
  if (qualityCheck.triggered) {
    const warningType: WarningType = "DATA_QUALITY_DEGRADATION";
    const { severity, factors } = determineSeverity(
      warningType,
      null,
      current_regime?.regime_state ?? null,
      previous_regime?.regime_state ?? null,
      current_regime?.confidence ?? 0,
      current_snapshot,
      previous_snapshot
    );

    const detectionWindow = current_snapshot.window_end;
    const identity = buildWarningIdentity(entity_type, entity_id, warningType, detectionWindow);
    const dedupKey = computeDedupKey(identity);

    if (!isDuplicate(dedupKey, existing_active_warnings) &&
        !isWithinCooldown(entity_type, entity_id, warningType, detectionWindow, existing_active_warnings, config)) {
      const provenance = assembleWarningProvenance({
        entityType: entity_type,
        entityId: entity_id,
        sourceRecordId: null,
        currentSnapshot: current_snapshot,
        previousSnapshot: previous_snapshot,
        currentRegime: current_regime,
        healthDelta: null,
        warningVersion: warning_version,
        detectionTime: calculation_time,
        detectionWindow,
        qualitySummary: assembleQualitySummary(current_snapshot, previous_snapshot),
        freshnessSummary: assembleFreshnessSummary(current_snapshot, previous_snapshot),
      });

      warnings.push({
        warning_type: warningType,
        severity,
        severity_factors: factors,
        message: generateMessage(warningType, entity_type, entity_id, null, null, null, null),
        health_score: current_snapshot.health_score,
        previous_health_score: previous_snapshot.health_score,
        health_delta: null,
        regime_state: current_regime?.regime_state ?? null,
        previous_regime_state: previous_regime?.regime_state ?? null,
        confidence: current_regime?.confidence ?? 0,
        dedup_key: dedupKey,
        quality_metadata: current_snapshot.quality_metadata,
        freshness_metadata: current_snapshot.freshness_metadata,
        evidence: generateEvidence(warningType, null, null, null, 0,
          current_snapshot.quality_status, null),
        provenance,
        detection_window: detectionWindow,
        detected_at: calculation_time,
      });

      const toSupersede = findWarningsToSupersede(entity_type, entity_id, warningType, existing_active_warnings);
      warningsToSupersede.push(...toSupersede);
    }
  }

  // ── 5. FRESHNESS_DEGRADATION ──
  const freshnessCheck = checkFreshnessThreshold(current_snapshot, previous_snapshot);
  if (freshnessCheck.triggered) {
    const warningType: WarningType = "FRESHNESS_DEGRADATION";
    const { severity, factors } = determineSeverity(
      warningType,
      null,
      current_regime?.regime_state ?? null,
      previous_regime?.regime_state ?? null,
      current_regime?.confidence ?? 0,
      current_snapshot,
      previous_snapshot
    );

    const detectionWindow = current_snapshot.window_end;
    const identity = buildWarningIdentity(entity_type, entity_id, warningType, detectionWindow);
    const dedupKey = computeDedupKey(identity);

    if (!isDuplicate(dedupKey, existing_active_warnings) &&
        !isWithinCooldown(entity_type, entity_id, warningType, detectionWindow, existing_active_warnings, config)) {
      const provenance = assembleWarningProvenance({
        entityType: entity_type,
        entityId: entity_id,
        sourceRecordId: null,
        currentSnapshot: current_snapshot,
        previousSnapshot: previous_snapshot,
        currentRegime: current_regime,
        healthDelta: null,
        warningVersion: warning_version,
        detectionTime: calculation_time,
        detectionWindow,
        qualitySummary: assembleQualitySummary(current_snapshot, previous_snapshot),
        freshnessSummary: assembleFreshnessSummary(current_snapshot, previous_snapshot),
      });

      warnings.push({
        warning_type: warningType,
        severity,
        severity_factors: factors,
        message: generateMessage(warningType, entity_type, entity_id, null, null, null, null),
        health_score: current_snapshot.health_score,
        previous_health_score: previous_snapshot.health_score,
        health_delta: null,
        regime_state: current_regime?.regime_state ?? null,
        previous_regime_state: previous_regime?.regime_state ?? null,
        confidence: current_regime?.confidence ?? 0,
        dedup_key: dedupKey,
        quality_metadata: current_snapshot.quality_metadata,
        freshness_metadata: current_snapshot.freshness_metadata,
        evidence: generateEvidence(warningType, null, null, null, 0,
          null, current_snapshot.freshness_status),
        provenance,
        detection_window: detectionWindow,
        detected_at: calculation_time,
      });

      const toSupersede = findWarningsToSupersede(entity_type, entity_id, warningType, existing_active_warnings);
      warningsToSupersede.push(...toSupersede);
    }
  }

  return {
    warnings,
    warnings_to_resolve: warningsToResolve,
    warnings_to_supersede: warningsToSupersede,
  };
}
