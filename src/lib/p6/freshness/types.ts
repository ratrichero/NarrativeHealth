// P6 Freshness — Type Definitions
// Frozen contract: P6-01C-C (commit 6179135)
// Observation contract: P6-01B (commit ad5d7df)

import type { SourceId, CanonicalMetric, Timeframe } from "../registry/types";

// ============================================================
// Freshness Status (frozen by P6-01B §9.1)
// ============================================================

/** Exactly three freshness states — no others permitted */
export type FreshnessStatus = "FRESH" | "STALE" | "UNKNOWN";

export const FRESHNESS_STATUSES: ReadonlySet<FreshnessStatus> = new Set([
  "FRESH",
  "STALE",
  "UNKNOWN",
]);

export function isValidFreshnessStatus(value: string): value is FreshnessStatus {
  return FRESHNESS_STATUSES.has(value as FreshnessStatus);
}

// ============================================================
// Freshness Policy (from P6-01C-C §5)
// ============================================================

/** Semantic freshness policy — matches the frozen contract model */
export interface FreshnessPolicy {
  sourceId: SourceId;
  metric: CanonicalMetric;
  timeframe: Timeframe;
  /** Expected time between observations, in milliseconds. Must be > 0. */
  expectedIntervalMs: number;
  /** Threshold after which data is classified as STALE, in milliseconds. Must be > 0. */
  staleAfterMs: number;
  /** Configuration version this policy belongs to */
  configVersion: number;
  /** Optional human-readable description */
  description: string | null;
}

/** Policy identity tuple — deterministic lookup key */
export interface PolicyIdentity {
  sourceId: SourceId;
  metric: CanonicalMetric;
  timeframe: Timeframe;
  configVersion: number;
}

// ============================================================
// Freshness Evaluation Result (from P6-01C-C §6)
// ============================================================

/** Result of a freshness evaluation */
export interface FreshnessEvaluationResult {
  /** The resolved freshness status */
  status: FreshnessStatus;
  /** The observation's observed_at timestamp (null if UNKNOWN) */
  observedAt: Date | null;
  /** The evaluation time used */
  evaluationTime: Date;
  /** Age in milliseconds (null if observed_at is UNKNOWN) */
  ageMs: number | null;
  /** The policy used for evaluation (null if no policy found) */
  policy: FreshnessPolicy | null;
  /** Human-readable reason for the status */
  reason: string;
}

// ============================================================
// Policy Resolution Result
// ============================================================

/** Result of policy resolution */
export interface PolicyResolutionResult {
  /** Whether a policy was found */
  found: boolean;
  /** The resolved policy (undefined if not found) */
  policy?: FreshnessPolicy;
  /** Error message if resolution failed */
  error?: string;
}
