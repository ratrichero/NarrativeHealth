/**
 * P6-04D — Regime Detection Engine
 *
 * Orchestrates regime classification across a sequence of snapshots.
 * Consumes P6-03 snapshot outputs as input authority.
 *
 * Implements:
 * - PD-04B-01: RegimeState vocabulary (FROZEN)
 * - PD-04B-04: 10-point hysteresis (FROZEN)
 * - PD-04B-05: 2 consecutive qualifying snapshots (FROZEN)
 * - PD-04C-04: INVALID/MISSING pauses persistence
 * - PD-04C-05: UNKNOWN counts toward persistence
 * - PD-04C-06: Gap ≤ 3 days pauses persistence
 * - PD-04C-07: Gap tolerance = ignore (pause, don't break)
 * - PD-04C-12: > 3 consecutive gaps → INSUFFICIENT_DATA
 *
 * Authority: P6-04B, P6-04C, P6-04C1
 */

import type {
  RegimeInput,
  RegimeOutput,
  RegimeConfig,
  RegimeStateProperties,
  RegimeSnapshotInput,
  RegimeState,
} from "./types";
import { DEFAULT_REGIME_CONFIG, REGIME_V1_VERSION } from "./types";
import {
  classifyScore,
  processSnapshot,
} from "./state-machine";
import { calculateConfidence } from "./confidence";
import {
  assembleRegimeProvenance,
  assembleQualityMetadata,
  assembleFreshnessMetadata,
} from "./provenance";

// ─── SNAPSHOT FILTERING ───────────────────────────────────────────

/**
 * Filter snapshots for regime analysis.
 * PD-04C-04: INVALID/MISSING excluded (pause persistence).
 * PD-04C-05: UNKNOWN quality included (counts toward persistence).
 * PD-04B-07: Gap tolerance handled separately.
 */
function filterQualifyingSnapshots(
  snapshots: ReadonlyArray<RegimeSnapshotInput>
): RegimeSnapshotInput[] {
  return snapshots.filter(
    (s) => s.quality_status !== "INVALID" && s.quality_status !== "MISSING"
  );
}

/**
 * Check for temporal gaps exceeding tolerance.
 * PD-04C-06: Gap ≤ 3 days = pause (ignore).
 * PD-04C-12: Gap > 3 days → INSUFFICIENT_DATA trigger.
 */
function hasExcessiveGap(
  snapshots: ReadonlyArray<RegimeSnapshotInput>,
  maxGapDays: number
): boolean {
  if (snapshots.length < 2) return false;

  const sorted = [...snapshots].sort(
    (a, b) => a.calculation_time.getTime() - b.calculation_time.getTime()
  );

  for (let i = 1; i < sorted.length; i++) {
    const diffMs = sorted[i].calculation_time.getTime() - sorted[i - 1].calculation_time.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays > maxGapDays + 1) {
      // +1 because consecutive daily snapshots have 1-day gap
      return true;
    }
  }

  return false;
}

// ─── MAIN ENGINE ──────────────────────────────────────────────────

/**
 * Run regime detection for an entity.
 *
 * Processes snapshots in chronological order through the state machine.
 * Returns the final regime state with full provenance.
 *
 * @param input - Entity snapshots and configuration
 * @returns Regime output with state, confidence, provenance
 */
export function detectRegime(
  input: RegimeInput,
  config: RegimeConfig = DEFAULT_REGIME_CONFIG
): RegimeOutput {
  const {
    entity_type,
    entity_id,
    current_snapshot,
    historical_snapshots,
    regime_version,
    calculation_time,
  } = input;

  // Combine all snapshots, sort chronologically
  const allSnapshots = [...historical_snapshots, current_snapshot].sort(
    (a, b) => a.calculation_time.getTime() - b.calculation_time.getTime()
  );

  // Quality/freshness metadata (from ALL snapshots, not just qualifying)
  const qualityMetadata = assembleQualityMetadata(allSnapshots);
  const freshnessMetadata = assembleFreshnessMetadata(allSnapshots);

  // Filter for qualifying snapshots (exclude INVALID/MISSING)
  const qualifyingSnapshots = filterQualifyingSnapshots(allSnapshots);

  // Check for excessive gaps
  const excessiveGap = hasExcessiveGap(qualifyingSnapshots, config.maxGapDays);

  // ── INSUFFICIENT_DATA: no qualifying snapshots or excessive gap ──
  if (qualifyingSnapshots.length === 0 || excessiveGap) {
    const provenance = assembleRegimeProvenance(
      allSnapshots,
      regime_version,
      calculation_time,
      null,
      null,
      0,
      qualityMetadata,
      freshnessMetadata
    );

    return {
      entity_type,
      entity_id,
      regime_state: "INSUFFICIENT_DATA",
      previous_state: null,
      confidence: 0,
      consecutive_count: 0,
      health_score: current_snapshot.health_score,
      regime_version,
      snapshot_version_id: current_snapshot.snapshot_id,
      provenance,
      quality_metadata: qualityMetadata,
      freshness_metadata: freshnessMetadata,
      calculation_time,
    };
  }

  // ── UNKNOWN: only 1 qualifying snapshot ──
  if (qualifyingSnapshots.length < 2) {
    const provenance = assembleRegimeProvenance(
      allSnapshots,
      regime_version,
      calculation_time,
      null,
      null,
      0,
      qualityMetadata,
      freshnessMetadata
    );

    return {
      entity_type,
      entity_id,
      regime_state: "UNKNOWN",
      previous_state: null,
      confidence: 0,
      consecutive_count: 0,
      health_score: current_snapshot.health_score,
      regime_version,
      snapshot_version_id: current_snapshot.snapshot_id,
      provenance,
      quality_metadata: qualityMetadata,
      freshness_metadata: freshnessMetadata,
      calculation_time,
    };
  }

  // ── Initialize state from first qualifying snapshot ──
  // First snapshot establishes the initial regime via classifyScore.
  // Subsequent snapshots are processed through the state machine.
  const firstRegime = classifyScore(qualifyingSnapshots[0].health_score);
  let state: RegimeStateProperties = {
    current_state: firstRegime,
    previous_state: null,
    transition_started_at: null,
    transition_target: null,
    consecutive_count: 1,
    score_at_transition: null,
  };
  let lastTransitionFrom: RegimeState | null = null;
  let lastTransitionTo: RegimeState | null = null;

  for (let i = 1; i < qualifyingSnapshots.length; i++) {
    const snapshot = qualifyingSnapshots[i];
    const result = processSnapshot({
      currentRegime: state,
      healthScore: snapshot.health_score,
      snapshotCalculationTime: snapshot.calculation_time,
      config,
    });

    // Track transitions for provenance
    // 1. Entering TRANSITIONING from a stable regime: record the initiation
    if (result.newRegime === "TRANSITIONING" && state.current_state !== "TRANSITIONING") {
      lastTransitionFrom = state.current_state;
      lastTransitionTo = result.transitionTarget ?? result.newRegime;
    }
    // 2. Completing a transition (TRANSITIONING → target regime)
    if (result.newRegime !== "TRANSITIONING" && state.current_state === "TRANSITIONING") {
      // Either completed or reverted — only record completions
      if (result.newRegime === state.transition_target) {
        lastTransitionTo = result.newRegime;
      }
      // Reverts: don't overwrite lastTransitionFrom/To
    }

    state = {
      current_state: result.newRegime,
      previous_state: result.previousState,
      transition_started_at: result.transitionStartedAt,
      transition_target: result.transitionTarget,
      consecutive_count: result.consecutiveCount,
      score_at_transition: result.scoreAtTransition,
    };
  }

  // ── Compute confidence ──
  const confidence = calculateConfidence(
    state.consecutive_count,
    config.minPersistence
  );

  // NOTE: INSUFFICIENT_DATA is handled by early returns above.
  // State machine always initializes from classifyScore when ≥2 qualifying snapshots exist.

  // ── Assemble provenance ──
  const provenance = assembleRegimeProvenance(
    allSnapshots,
    regime_version,
    calculation_time,
    lastTransitionFrom,
    lastTransitionTo,
    confidence,
    qualityMetadata,
    freshnessMetadata
  );

  return {
    entity_type,
    entity_id,
    regime_state: state.current_state,
    previous_state: state.previous_state,
    confidence,
    consecutive_count: state.consecutive_count,
    health_score: current_snapshot.health_score,
    regime_version,
    snapshot_version_id: current_snapshot.snapshot_id,
    provenance,
    quality_metadata: qualityMetadata,
    freshness_metadata: freshnessMetadata,
    calculation_time,
  };
}
