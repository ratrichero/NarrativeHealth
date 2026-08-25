/**
 * P6-05D — Warning Lifecycle State Machine
 *
 * PD-05B-10: 4 states (FROZEN):
 * DETECTED → ACTIVE → RESOLVED (terminal)
 *                 → SUPERSEDED (terminal)
 *
 * Valid transitions:
 * - DETECTED → ACTIVE
 * - DETECTED → RESOLVED
 * - ACTIVE → RESOLVED
 * - ACTIVE → SUPERSEDED
 *
 * Authority: P6-05C1 Decision Contract
 */

import type { WarningLifecycle } from "./types";

// ─── VALID TRANSITIONS ────────────────────────────────────────────

const VALID_TRANSITIONS: Record<WarningLifecycle, readonly WarningLifecycle[]> = {
  DETECTED: ["ACTIVE", "RESOLVED"],
  ACTIVE: ["RESOLVED", "SUPERSEDED"],
  RESOLVED: [],  // terminal
  SUPERSEDED: [], // terminal
};

// ─── STATE VALIDATION ─────────────────────────────────────────────

/**
 * Check if a lifecycle transition is valid.
 * Deterministic: same from + same to → same result.
 */
export function isValidTransition(
  from: WarningLifecycle,
  to: WarningLifecycle
): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Transition warning lifecycle state.
 * Throws if transition is invalid (fail-fast for correctness).
 */
export function transitionLifecycle(
  current: WarningLifecycle,
  target: WarningLifecycle
): WarningLifecycle {
  if (!isValidTransition(current, target)) {
    throw new Error(
      `[P6-Warning] Invalid lifecycle transition: ${current} → ${target}`
    );
  }
  return target;
}

// ─── TRANSITION DETECTION ─────────────────────────────────────────

/**
 * Determine the appropriate lifecycle transition for a warning
 * based on whether it's new or existing.
 */
export function determineInitialLifecycle(): WarningLifecycle {
  // New warnings always start as DETECTED
  // (they become ACTIVE immediately on persistence per PD-05B-10)
  return "DETECTED";
}

/**
 * After persistence, DETECTED → ACTIVE.
 */
export function afterPersistence(): WarningLifecycle {
  return "ACTIVE";
}

// ─── QUALITY / FRESHNESS SEPARATION ───────────────────────────────

/**
 * Verify that lifecycle states are NOT QualityState values.
 * EW-05, EW-11: Lifecycle ≠ QualityState.
 */
export function isLifecycleNotQualityState(state: string): boolean {
  const qualityStates = ["VALID", "INVALID", "MISSING", "UNKNOWN"];
  return !qualityStates.includes(state);
}

/**
 * Verify that lifecycle states are NOT RegimeState values.
 * EW-06: Lifecycle ≠ RegimeState.
 */
export function isLifecycleNotRegimeState(state: string): boolean {
  const regimeStates = [
    "STRONG",
    "STABLE",
    "WEAK",
    "TRANSITIONING",
    "INSUFFICIENT_DATA",
    "UNKNOWN",
  ];
  return !regimeStates.includes(state);
}
