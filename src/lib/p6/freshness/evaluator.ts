// P6 Freshness Evaluator — Pure evaluation logic
// Frozen contract: P6-01C-C (commit 6179135)

import type {
  FreshnessPolicy,
  FreshnessStatus,
  FreshnessEvaluationResult,
  PolicyIdentity,
  PolicyResolutionResult,
} from "./types";

// ============================================================
// Constants
// ============================================================

/** Sentinel for UNKNOWN observed_at */
export const OBSERVED_AT_UNKNOWN = "UNKNOWN" as const;

// ============================================================
// Policy Resolution
// ============================================================

/**
 * Resolve a freshness policy from a list of candidates.
 *
 * Deterministic: given the same identity and candidates, always returns the same result.
 * If zero policies match → found: false
 * If exactly one matches → found: true, policy resolved
 * If multiple match → found: false, error (fail deterministically, do not choose arbitrarily)
 */
export function resolvePolicy(
  identity: PolicyIdentity,
  candidates: FreshnessPolicy[]
): PolicyResolutionResult {
  const matching = candidates.filter(
    (p) =>
      p.sourceId === identity.sourceId &&
      p.metric === identity.metric &&
      p.timeframe === identity.timeframe &&
      p.configVersion === identity.configVersion
  );

  if (matching.length === 0) {
    return {
      found: false,
      error: `No freshness policy found for (${identity.sourceId}, ${identity.metric}, ${identity.timeframe}, v${identity.configVersion})`,
    };
  }

  if (matching.length > 1) {
    return {
      found: false,
      error: `Duplicate freshness policies found for (${identity.sourceId}, ${identity.metric}, ${identity.timeframe}, v${identity.configVersion}): ${matching.length} matches`,
    };
  }

  return {
    found: true,
    policy: matching[0],
  };
}

// ============================================================
// Freshness Evaluation
// ============================================================

/**
 * Evaluate the freshness of an observation.
 *
 * Implements the frozen P6-01C-C contract:
 * - If observed_at is UNKNOWN → status: UNKNOWN
 * - age = evaluation_time - observed_at
 * - If age > stale_after → STALE
 * - Otherwise → FRESH
 *
 * This is a pure function — no database access, no side effects.
 */
export function evaluateFreshness(params: {
  observedAt: Date | null;
  observedAtIsUnknown: boolean;
  evaluationTime: Date;
  policy: FreshnessPolicy | null;
}): FreshnessEvaluationResult {
  const { observedAt, observedAtIsUnknown, evaluationTime, policy } = params;

  // Case 1: observed_at is UNKNOWN → UNKNOWN
  if (observedAtIsUnknown || observedAt === null) {
    return {
      status: "UNKNOWN",
      observedAt: null,
      evaluationTime,
      ageMs: null,
      policy,
      reason: "observed_at is UNKNOWN — freshness cannot be determined",
    };
  }

  // Case 2: No policy found → UNKNOWN
  if (policy === null) {
    return {
      status: "UNKNOWN",
      observedAt,
      evaluationTime,
      ageMs: null,
      policy: null,
      reason: "No freshness policy found for this (source, metric, timeframe, config_version)",
    };
  }

  // Case 3: Calculate age
  const ageMs = evaluationTime.getTime() - observedAt.getTime();

  // Case 4: Evaluate against stale_after
  // age > stale_after → STALE
  // age <= stale_after → FRESH
  // Note: negative age (future observed_at) is handled by the comparison:
  //   negative age is always <= stale_after (since stale_after > 0),
  //   so future observed_at → FRESH per the contract's comparison semantics.
  //   If this behavior needs to change, PLANNER DECISION REQUIRED.
  if (ageMs > policy.staleAfterMs) {
    return {
      status: "STALE",
      observedAt,
      evaluationTime,
      ageMs,
      policy,
      reason: `age (${formatDuration(ageMs)}) exceeds stale_after (${formatDuration(policy.staleAfterMs)})`,
    };
  }

  return {
    status: "FRESH",
    observedAt,
    evaluationTime,
    ageMs,
    policy,
    reason: `age (${formatDuration(ageMs)}) is within stale_after (${formatDuration(policy.staleAfterMs)})`,
  };
}

// ============================================================
// Convenience: Evaluate with identity resolution
// ============================================================

/**
 * Evaluate freshness given an observation's metadata and a list of available policies.
 *
 * Combines policy resolution and freshness evaluation in a single call.
 */
export function evaluateObservationFreshness(params: {
  sourceId: string;
  metric: string;
  timeframe: string;
  configVersion: number;
  observedAt: Date | null;
  observedAtIsUnknown: boolean;
  evaluationTime: Date;
  availablePolicies: FreshnessPolicy[];
}): FreshnessEvaluationResult {
  const identity: PolicyIdentity = {
    sourceId: params.sourceId as PolicyIdentity["sourceId"],
    metric: params.metric as PolicyIdentity["metric"],
    timeframe: params.timeframe as PolicyIdentity["timeframe"],
    configVersion: params.configVersion,
  };

  const resolution = resolvePolicy(identity, params.availablePolicies);

  return evaluateFreshness({
    observedAt: params.observedAt,
    observedAtIsUnknown: params.observedAtIsUnknown,
    evaluationTime: params.evaluationTime,
    policy: resolution.found ? resolution.policy! : null,
  });
}

// ============================================================
// Validation Helpers
// ============================================================

/**
 * Validate that a FreshnessPolicy has valid fields.
 */
export function validatePolicy(policy: FreshnessPolicy): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!policy.sourceId) errors.push("sourceId is required");
  if (!policy.metric) errors.push("metric is required");
  if (!policy.timeframe) errors.push("timeframe is required");
  if (typeof policy.expectedIntervalMs !== "number" || policy.expectedIntervalMs <= 0) {
    errors.push("expectedIntervalMs must be a positive number");
  }
  if (typeof policy.staleAfterMs !== "number" || policy.staleAfterMs <= 0) {
    errors.push("staleAfterMs must be a positive number");
  }
  if (typeof policy.configVersion !== "number" || policy.configVersion < 1) {
    errors.push("configVersion must be a positive integer");
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================
// Utilities
// ============================================================

/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 0) return `-${formatDuration(-ms)}`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
