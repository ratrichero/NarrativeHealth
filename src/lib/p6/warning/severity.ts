/**
 * P6-05D — Severity Determination
 *
 * PD-05B-02: Severity vocabulary (FROZEN): INFO < LOW < MEDIUM < HIGH < CRITICAL
 * PD-05B-03: Multi-factor severity determination (FROZEN)
 *
 * Factor hierarchy:
 * 1. health_delta_magnitude (PRIMARY)
 * 2. regime_context (SECONDARY)
 * 3. confidence_context (TERTIARY)
 * 4. warning_type_baseline (CONTEXT)
 *
 * Highest severity wins. Deterministic.
 *
 * Authority: P6-05C1 Decision Contract
 */

import type { Severity, SeverityFactor, WarningType, WarningSnapshotInput, WarningRegimeInput } from "./types";
import { SEVERITY_RANK } from "./types";

// ─── HIGHEST SEVERITY ─────────────────────────────────────────────

/**
 * Select the highest severity from a list of factors.
 * Deterministic: same inputs → same result.
 */
export function selectHighestSeverity(factors: ReadonlyArray<SeverityFactor>): Severity {
  if (factors.length === 0) return "INFO";

  let highest = factors[0].severity;
  for (let i = 1; i < factors.length; i++) {
    if (SEVERITY_RANK[factors[i].severity] > SEVERITY_RANK[highest]) {
      highest = factors[i].severity;
    }
  }
  return highest;
}

// ─── HEALTH DELTA SEVERITY (PRIMARY) ──────────────────────────────

/**
 * Determine severity from health score delta magnitude.
 * PD-05B-03: Primary factor.
 *
 * Rules:
 * ≥ 30 points: CRITICAL
 * ≥ 20 points + WEAK regime: HIGH
 * ≥ 20 points + STABLE/STRONG: MEDIUM
 * ≥ 10 points + WEAK regime: MEDIUM
 * ≥ 10 points + STABLE/STRONG: LOW
 * ≥ 5 points: INFO
 * < 5 points: no factor produced (no warning)
 */
export function evaluateHealthDeltaSeverity(
  delta: number,
  regimeState: string | null
): SeverityFactor | null {
  const absDelta = Math.abs(delta);

  if (absDelta >= 30) {
    return {
      factor: "health_delta",
      severity: "CRITICAL",
      description: `health delta ${delta.toFixed(1)}: CRITICAL (≥30)`,
    };
  }

  if (absDelta >= 20) {
    if (regimeState === "WEAK") {
      return {
        factor: "health_delta",
        severity: "HIGH",
        description: `health delta ${delta.toFixed(1)} + WEAK regime: HIGH`,
      };
    }
    return {
      factor: "health_delta",
      severity: "MEDIUM",
      description: `health delta ${delta.toFixed(1)}: MEDIUM`,
    };
  }

  if (absDelta >= 10) {
    if (regimeState === "WEAK") {
      return {
        factor: "health_delta",
        severity: "MEDIUM",
        description: `health delta ${delta.toFixed(1)} + WEAK regime: MEDIUM`,
      };
    }
    return {
      factor: "health_delta",
      severity: "LOW",
      description: `health delta ${delta.toFixed(1)}: LOW`,
    };
  }

  if (absDelta >= 5) {
    return {
      factor: "health_delta",
      severity: "INFO",
      description: `health delta ${delta.toFixed(1)}: INFO`,
    };
  }

  return null; // Below minimum threshold
}

// ─── REGIME CONTEXT SEVERITY (SECONDARY) ──────────────────────────

/**
 * Determine severity from regime change context.
 * PD-05B-03: Secondary factor.
 *
 * Rules:
 * Deterioration to WEAK: HIGH
 * Deterioration to STABLE: MEDIUM
 * Improvement to STRONG: LOW
 * Improvement to STABLE: INFO
 */
export function evaluateRegimeContextSeverity(
  warningType: WarningType,
  currentRegime: string,
  previousRegime: string | null
): SeverityFactor | null {
  if (warningType === "REGIME_CHANGE") {
    if (currentRegime === "WEAK" && previousRegime !== "WEAK") {
      return {
        factor: "regime_context",
        severity: "HIGH",
        description: `regime deterioration to WEAK: HIGH`,
      };
    }
    if (currentRegime === "STABLE" && previousRegime === "WEAK") {
      return {
        factor: "regime_context",
        severity: "MEDIUM",
        description: `regime improvement to STABLE: MEDIUM`,
      };
    }
    if (currentRegime === "STRONG" && previousRegime !== "STRONG") {
      return {
        factor: "regime_context",
        severity: "LOW",
        description: `regime improvement to STRONG: LOW`,
      };
    }
    if (currentRegime === "STABLE" && previousRegime === "STRONG") {
      return {
        factor: "regime_context",
        severity: "INFO",
        description: `regime decline to STABLE: INFO`,
      };
    }
  }

  if (warningType === "REGIME_TRANSITION") {
    if (currentRegime === "TRANSITIONING") {
      // Check target based on what comes after TRANSITIONING
      // For TRANSITIONING warnings, we use LOW as baseline
      return {
        factor: "regime_context",
        severity: "MEDIUM",
        description: `regime entering TRANSITIONING: MEDIUM`,
      };
    }
  }

  return null;
}

// ─── CONFIDENCE CONTEXT SEVERITY (TERTIARY) ───────────────────────

/**
 * Determine severity from confidence context.
 * PD-05B-03: Tertiary factor.
 *
 * Rules:
 * Confidence < 30: MEDIUM (low confidence is concerning)
 * Confidence < 50: LOW
 */
export function evaluateConfidenceContextSeverity(
  confidence: number
): SeverityFactor | null {
  if (confidence < 30) {
    return {
      factor: "confidence_context",
      severity: "MEDIUM",
      description: `low confidence ${confidence.toFixed(1)}: MEDIUM`,
    };
  }
  if (confidence < 50) {
    return {
      factor: "confidence_context",
      severity: "LOW",
      description: `moderate confidence ${confidence.toFixed(1)}: LOW`,
    };
  }
  return null;
}

// ─── WARNING TYPE BASELINE SEVERITY ───────────────────────────────

/**
 * Baseline severity per warning type.
 * Used when no other factor produces a severity.
 */
export function getBaselineSeverity(warningType: WarningType): SeverityFactor {
  const baselines: Record<WarningType, Severity> = {
    HEALTH_DETERIORATION: "LOW",
    HEALTH_IMPROVEMENT: "INFO",
    REGIME_CHANGE: "MEDIUM",
    REGIME_TRANSITION: "MEDIUM",
    CONFIDENCE_DETERIORATION: "LOW",
    DATA_QUALITY_DEGRADATION: "INFO",
    FRESHNESS_DEGRADATION: "INFO",
  };

  return {
    factor: "warning_type_baseline",
    severity: baselines[warningType],
    description: `baseline for ${warningType}: ${baselines[warningType]}`,
  };
}

// ─── COMBINE SEVERITY ─────────────────────────────────────────────

/**
 * Determine final severity from all applicable factors.
 * PD-05B-03: Highest severity wins.
 * Deterministic: same inputs → same output.
 */
export function determineSeverity(
  warningType: WarningType,
  healthDelta: number | null,
  regimeState: string | null,
  previousRegimeState: string | null,
  confidence: number,
  current: WarningSnapshotInput,
  previous: WarningSnapshotInput | null
): { severity: Severity; factors: ReadonlyArray<SeverityFactor> } {
  const factors: SeverityFactor[] = [];

  // 1. Health delta (PRIMARY)
  if (healthDelta !== null) {
    const healthFactor = evaluateHealthDeltaSeverity(healthDelta, regimeState);
    if (healthFactor) factors.push(healthFactor);
  }

  // 2. Regime context (SECONDARY)
  if (regimeState && previousRegimeState) {
    const regimeFactor = evaluateRegimeContextSeverity(
      warningType,
      regimeState,
      previousRegimeState
    );
    if (regimeFactor) factors.push(regimeFactor);
  }

  // 3. Confidence context (TERTIARY)
  const confFactor = evaluateConfidenceContextSeverity(confidence);
  if (confFactor) factors.push(confFactor);

  // 4. Baseline (always present)
  factors.push(getBaselineSeverity(warningType));

  const severity = selectHighestSeverity(factors);
  return { severity, factors };
}
