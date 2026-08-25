/**
 * P6-05D — Warning Thresholds
 *
 * PD-05B-04: Material change thresholds (FROZEN).
 * Configurable, versioned, deterministic.
 *
 * Authority: P6-05C1 Decision Contract
 */

import type { WarningType, WarningConfig, WarningSnapshotInput, WarningRegimeInput } from "./types";
import { DEFAULT_WARNING_CONFIG } from "./types";

// ─── THRESHOLD CHECK RESULT ───────────────────────────────────────

export interface ThresholdCheckResult {
  readonly triggered: boolean;
  readonly delta: number | null;
  readonly reason: string;
}

// ─── HEALTH THRESHOLD ─────────────────────────────────────────────

/**
 * Check if health score change exceeds threshold.
 * PD-05B-04: ≥ 10 points (inclusive boundary).
 *
 * Direction: negative delta = deterioration, positive = improvement.
 */
export function checkHealthThreshold(
  current: WarningSnapshotInput,
  previous: WarningSnapshotInput | null,
  config: WarningConfig = DEFAULT_WARNING_CONFIG
): ThresholdCheckResult {
  if (!previous) {
    return { triggered: false, delta: null, reason: "no previous snapshot" };
  }

  const delta = current.health_score - previous.health_score;
  const absDelta = Math.abs(delta);

  if (absDelta >= config.healthDeltaThreshold) {
    const direction = delta < 0 ? "deterioration" : "improvement";
    return {
      triggered: true,
      delta,
      reason: `health ${direction}: ${delta.toFixed(1)} points (threshold: ${config.healthDeltaThreshold})`,
    };
  }

  return {
    triggered: false,
    delta,
    reason: `health delta ${delta.toFixed(1)} below threshold ${config.healthDeltaThreshold}`,
  };
}

// ─── CONFIDENCE THRESHOLD ─────────────────────────────────────────

/**
 * Check if confidence drop exceeds threshold.
 * PD-05B-04: ≥ 20 points (inclusive boundary).
 *
 * Only checks deterioration (drop), not improvement.
 */
export function checkConfidenceThreshold(
  current: WarningRegimeInput | null,
  previous: WarningRegimeInput | null,
  config: WarningConfig = DEFAULT_WARNING_CONFIG
): ThresholdCheckResult {
  if (!current || !previous) {
    return { triggered: false, delta: null, reason: "missing regime data" };
  }

  const delta = current.confidence - previous.confidence;
  const absDelta = Math.abs(delta);

  // Only trigger on deterioration (drop)
  if (delta < 0 && absDelta >= config.confidenceDeltaThreshold) {
    return {
      triggered: true,
      delta,
      reason: `confidence dropped: ${delta.toFixed(1)} points (threshold: ${config.confidenceDeltaThreshold})`,
    };
  }

  return {
    triggered: false,
    delta,
    reason: delta >= 0
      ? "confidence stable or improved"
      : `confidence drop ${absDelta.toFixed(1)} below threshold ${config.confidenceDeltaThreshold}`,
  };
}

// ─── REGIME THRESHOLD ─────────────────────────────────────────────

/**
 * Check if regime state changed.
 * REGIME_CHANGE: confirmed transition from one state to another.
 * REGIME_TRANSITION: entering TRANSITIONING state.
 *
 * Qualitative threshold — any change triggers.
 */
export function checkRegimeChangeThreshold(
  current: WarningRegimeInput | null,
  previous: WarningRegimeInput | null
): { regimeChange: ThresholdCheckResult; regimeTransition: ThresholdCheckResult } {
  if (!current || !previous) {
    return {
      regimeChange: { triggered: false, delta: null, reason: "missing regime data" },
      regimeTransition: { triggered: false, delta: null, reason: "missing regime data" },
    };
  }

  const currentState = current.regime_state;
  const previousState = previous.regime_state;

  if (currentState === previousState) {
    return {
      regimeChange: { triggered: false, delta: null, reason: "regime unchanged" },
      regimeTransition: { triggered: false, delta: null, reason: "regime unchanged" },
    };
  }

  // REGIME_TRANSITION: entering TRANSITIONING
  const isTransitioning = currentState === "TRANSITIONING" && previousState !== "TRANSITIONING";

  // REGIME_CHANGE: confirmed transition to a non-TRANSITIONING target
  // This happens when the regime was TRANSITIONING and now confirms a target,
  // OR when it directly changes to a new stable state (if P6-04 skips TRANSITIONING)
  const isConfirmedChange =
    currentState !== "TRANSITIONING" &&
    previousState !== "currentState" &&
    currentState !== previousState;

  return {
    regimeChange: {
      triggered: isConfirmedChange,
      delta: null,
      reason: isConfirmedChange
        ? `regime changed: ${previousState} → ${currentState}`
        : "no confirmed regime change",
    },
    regimeTransition: {
      triggered: isTransitioning,
      delta: null,
      reason: isTransitioning
        ? `regime transitioning: ${previousState} → TRANSITIONING`
        : "not a transition event",
    },
  };
}

// ─── QUALITY THRESHOLD ────────────────────────────────────────────

/**
 * Check for quality metadata degradation.
 * Qualitative — any increase in INVALID/MISSING triggers.
 */
export function checkQualityThreshold(
  current: WarningSnapshotInput,
  previous: WarningSnapshotInput | null
): ThresholdCheckResult {
  if (!previous) {
    return { triggered: false, delta: null, reason: "no previous snapshot" };
  }

  const currentQuality = current.quality_status ?? "VALID";
  const previousQuality = previous.quality_status ?? "VALID";

  // Degrading: VALID → INVALID, VALID → MISSING, etc.
  const isDegradation =
    (previousQuality === "VALID" && (currentQuality === "INVALID" || currentQuality === "MISSING")) ||
    (previousQuality === "UNKNOWN" && (currentQuality === "INVALID" || currentQuality === "MISSING"));

  return {
    triggered: isDegradation,
    delta: null,
    reason: isDegradation
      ? `quality degraded: ${previousQuality} → ${currentQuality}`
      : `quality status: ${currentQuality}`,
  };
}

// ─── FRESHNESS THRESHOLD ──────────────────────────────────────────

/**
 * Check for freshness metadata degradation.
 * Qualitative — FRESH → STALE triggers.
 */
export function checkFreshnessThreshold(
  current: WarningSnapshotInput,
  previous: WarningSnapshotInput | null
): ThresholdCheckResult {
  if (!previous) {
    return { triggered: false, delta: null, reason: "no previous snapshot" };
  }

  const currentFreshness = current.freshness_status ?? "UNKNOWN";
  const previousFreshness = previous.freshness_status ?? "UNKNOWN";

  const isDegradation =
    previousFreshness === "FRESH" && currentFreshness === "STALE";

  return {
    triggered: isDegradation,
    delta: null,
    reason: isDegradation
      ? `freshness degraded: ${previousFreshness} → ${currentFreshness}`
      : `freshness status: ${currentFreshness}`,
  };
}
