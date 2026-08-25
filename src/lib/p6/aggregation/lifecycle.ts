/**
 * P6-06D — Summary Lifecycle (PD-06B-06)
 *
 * Exactly two states: CURRENT | SUPERSEDED.
 * - New summary supersedes the existing CURRENT summary for the entity.
 * - SUPERSEDED is terminal.
 * - Independent from QualityState, RegimeState, WarningLifecycle, SnapshotStatus (IA-20).
 */

import type { SummaryLifecycle } from "./types";

/** The only valid lifecycle transition: CURRENT → SUPERSEDED. */
export function isValidSummaryTransition(
  from: SummaryLifecycle,
  to: SummaryLifecycle
): boolean {
  return from === "CURRENT" && to === "SUPERSEDED";
}

export function isSupersededTerminal(state: SummaryLifecycle): boolean {
  return state === "SUPERSEDED";
}

export function isCurrentState(state: SummaryLifecycle): boolean {
  return state === "CURRENT";
}

/** IA-20 separation guards. */
export const SUMMARY_LIFECYCLE_STATES: readonly SummaryLifecycle[] = [
  "CURRENT",
  "SUPERSEDED",
];

export function isLifecycleNotQualityState(state: SummaryLifecycle | string): boolean {
  // Quality vocabulary: VALID | INVALID | MISSING | UNKNOWN
  return !["VALID", "INVALID", "MISSING", "UNKNOWN"].includes(state);
}

export function isLifecycleNotRegimeState(state: SummaryLifecycle | string): boolean {
  // Regime vocabulary: STRONG | STABLE | WEAK | TRANSITIONING | INSUFFICIENT_DATA | UNKNOWN
  return ![
    "STRONG",
    "STABLE",
    "WEAK",
    "TRANSITIONING",
    "INSUFFICIENT_DATA",
  ].includes(state);
}
