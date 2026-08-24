// P6 Data Quality V1 — Evaluation Persistence Integration (D4)
// Authority: P6-01D-B (Contract), P6-01D-C2 (Decisions), P6-01D-D1 (Persistence)
//
// D4 is the orchestration layer:
//   Observation Input → D2 Validator → QualityValidationResult → D3 Persistence
//
// D4 does NOT implement validation rules (D2 owns that).
// D4 does NOT implement persistence mechanics (D3 owns that).
// D4 bridges them.

import type {
  Metric,
  ObservationInput,
  OHLCGroupInput,
  QualityState,
  QualityEvidence,
  MetricValidationResult,
  OHLCGroupValidationResult,
} from "./types";
import { QUALITY_CONFIG_VERSION } from "./types";
import { validateMetric, validateOHLCGroup } from "./validator";
import type { ObservationQualityInsert, ObservationQualityRecord } from "../quality-persistence/types";
import { upsertQualityResult } from "../quality-persistence/service";

// ─── RESULT TYPES ─────────────────────────────────────────────────────

/** Result of evaluateAndPersist for a single metric */
export interface EvaluationResult {
  /** The D2 validation result (unchanged) */
  validation: MetricValidationResult;
  /** The persisted quality record (from D3) */
  persisted: ObservationQualityRecord;
}

/** Result of evaluateAndPersistOHLC for an OHLC group */
export interface OHLCEvaluationResult {
  /** Per-member D2 validation results */
  memberValidations: Record<Metric, MetricValidationResult>;
  /** Group-level evidence from D2 */
  groupEvidence: QualityEvidence[];
  /** Whether any relational check failed */
  hasRelationalFailure: boolean;
  /** Persisted records for each OHLC member */
  persisted: ObservationQualityRecord[];
}

// ─── SINGLE-METRIC EVALUATION + PERSISTENCE ───────────────────────────

/**
 * Evaluate a single metric observation and persist the result.
 *
 * Flow:
 *   1. D2 validateMetric(input)
 *   2. Map result → ObservationQualityInsert
 *   3. D3 upsertQualityResult(insert)
 *   4. Return both validation result and persisted record
 *
 * Evidence is persisted losslessly — no reinterpretation.
 * observed_at is passed through unchanged — no substitution.
 */
export async function evaluateAndPersistQuality(
  input: ObservationInput,
  options?: {
    collectedAt?: Date | null;
    /** Evaluation timestamp — supplied by caller, NOT generated inside (pure function req.) */
    evaluatedAt?: Date;
  }
): Promise<EvaluationResult> {
  // Step 1: Pure validation (D2)
  const validation = validateMetric(input);

  // Step 2: Construct persistence payload
  const now = options?.evaluatedAt ?? new Date();
  const insert: ObservationQualityInsert = {
    entityId: input.entity_id,
    metric: input.metric,
    source: input.source,
    observedAt: input.observed_at, // NULL = UNKNOWN, no substitution
    timeframe: input.timeframe,
    qualityStatus: validation.quality_status,
    observationStatus: validation.quality_status, // single metric = observation status
    qualityConfigVersion: QUALITY_CONFIG_VERSION,
    evidence: validation.evidence, // lossless evidence pass-through
    qualityEvaluatedAt: now,
    collectedAt: options?.collectedAt ?? null, // informational only, never substitutes observed_at
  };

  // Step 3: Persist (D3)
  const persisted = await upsertQualityResult(insert);

  return { validation, persisted };
}

// ─── OHLC GROUP EVALUATION + PERSISTENCE ──────────────────────────────

/**
 * Evaluate an OHLC group and persist all four member results.
 *
 * Flow:
 *   1. D2 validateOHLCGroup(input)
 *   2. Map each member result → ObservationQualityInsert
 *   3. D3 upsertQualityResult() for each member
 *   4. Return all validation results and persisted records
 *
 * OHLC SET scope: if any relational check fails, all four members
 * are INVALID (PD-03-RES) — D2 handles this internally.
 */
export async function evaluateAndPersistOHLCQuality(
  input: OHLCGroupInput,
  options?: {
    collectedAt?: Date | null;
    evaluatedAt?: Date;
  }
): Promise<OHLCEvaluationResult> {
  // Step 1: Pure validation (D2)
  const ohlcResult = validateOHLCGroup(input);

  const now = options?.evaluatedAt ?? new Date();
  const OHLC_METRICS: Metric[] = ["OPEN", "HIGH", "LOW", "CLOSE"];
  const persisted: ObservationQualityRecord[] = [];

  // Step 2-3: Persist each member
  for (const metric of OHLC_METRICS) {
    const memberResult = ohlcResult.members[metric];

    const insert: ObservationQualityInsert = {
      entityId: input.entity_id,
      metric,
      source: input.source,
      observedAt: input.observed_at, // NULL = UNKNOWN, no substitution
      timeframe: input.timeframe,
      qualityStatus: memberResult.quality_status,
      observationStatus: memberResult.quality_status, // per-member status
      qualityConfigVersion: QUALITY_CONFIG_VERSION,
      evidence: [
        ...memberResult.evidence, // field-level evidence
        ...ohlcResult.group_evidence, // group-level evidence
      ], // lossless: field + group evidence merged
      qualityEvaluatedAt: now,
      collectedAt: options?.collectedAt ?? null,
    };

    const record = await upsertQualityResult(insert);
    persisted.push(record);
  }

  return {
    memberValidations: ohlcResult.members,
    groupEvidence: ohlcResult.group_evidence,
    hasRelationalFailure: ohlcResult.has_relational_failure,
    persisted,
  };
}

// ─── BATCH EVALUATION (convenience) ───────────────────────────────────

/**
 * Evaluate and persist multiple metric observations in sequence.
 * Useful for bulk operations like refresh pipeline integration.
 */
export async function evaluateAndPersistMultiple(
  inputs: ObservationInput[],
  options?: {
    collectedAt?: Date | null;
    evaluatedAt?: Date;
  }
): Promise<EvaluationResult[]> {
  const results: EvaluationResult[] = [];
  for (const input of inputs) {
    const result = await evaluateAndPersistQuality(input, options);
    results.push(result);
  }
  return results;
}
