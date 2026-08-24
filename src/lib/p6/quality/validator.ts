// P6 Data Quality V1 — Pure Validator (Orchestrator)
// Authority: P6-01D-B (Contract), P6-01D-C2 (Frozen Decisions), P6-01D-D1 (Persistence Model)
//
// Pure function: same input + same contract version = same output.
// No DB, no network, no side effects, no current time dependency.

import type {
  Metric,
  ObservationInput,
  OHLCGroupInput,
  QualityState,
  QualityEvidence,
  MetricValidationResult,
  OHLCGroupValidationResult,
  Timeframe,
} from "./types";
import { METRIC_RULES, QUALITY_CONFIG_VERSION } from "./types";
import {
  runFieldChecks,
  checkHighGeLow,
  checkOpenInRange,
  checkCloseInRange,
} from "./checks";
import { classifyFromEvidence, applyOHLCGroupScope } from "./classification";

// ─── SINGLE-METRIC VALIDATION ─────────────────────────────────────────

/**
 * Validate a single metric observation.
 *
 * Input: ObservationInput (value may be null/undefined for MISSING semantics)
 * Output: MetricValidationResult with quality_status + evidence
 *
 * Flow:
 *   value absent? → MISSING
 *   value present? → run field checks → classify from evidence
 */
export function validateMetric(input: ObservationInput): MetricValidationResult {
  const rule = METRIC_RULES[input.metric];
  const valuePresent = input.value !== null && input.value !== undefined;

  if (!valuePresent) {
    return {
      quality_status: "MISSING",
      evidence: [],
    };
  }

  const evidence = runFieldChecks(input.metric, input.value, rule);
  const quality_status = classifyFromEvidence(evidence, true);

  return { quality_status, evidence };
}

// ─── OHLC GROUP VALIDATION ────────────────────────────────────────────

/**
 * Validate an OHLC group with relational checks.
 *
 * PD-03-RES frozen semantics:
 * - Exact group identity: (entity_id, source, observed_at, timeframe)
 * - observed_at = null (UNKNOWN) → relational checks = NOT_EVALUABLE
 * - Relational violation → ALL four members INVALID (OHLC SET scope)
 * - No business_date or collected_at substitution
 *
 * Flow:
 *   1. Run field-level checks on each of OPEN/HIGH/LOW/CLOSE independently
 *   2. If observed_at is present, evaluate relational checks
 *   3. If observed_at is null, relational checks = NOT_EVALUABLE
 *   4. If any relational FAIL, apply OHLC SET scope (all four → INVALID)
 */
export function validateOHLCGroup(
  input: OHLCGroupInput
): OHLCGroupValidationResult {
  const members = {} as Record<Metric, MetricValidationResult>;
  const OHLC_METRICS: Metric[] = ["OPEN", "HIGH", "LOW", "CLOSE"];

  // Step 1: Field-level checks on each member
  for (const metric of OHLC_METRICS as Metric[]) {
    const value = input.observations[metric as keyof typeof input.observations];
    const valuePresent = value !== null && value !== undefined;

    if (!valuePresent) {
      members[metric] = { quality_status: "MISSING", evidence: [] };
      continue;
    }

    const rule = METRIC_RULES[metric];
    const evidence = runFieldChecks(metric, value, rule);
    const quality_status = classifyFromEvidence(evidence, true);
    members[metric] = { quality_status, evidence };
  }

  // Step 2: Relational checks
  const group_evidence: QualityEvidence[] = [];

  // PD-03-RES: if observed_at is null (UNKNOWN), group key is unresolvable
  if (input.observed_at === null) {
    group_evidence.push({
      check_id: "OHLC_HIGH_GE_LOW",
      field: "HIGH",
      outcome: "NOT_EVALUABLE",
      detail: { reason: "observed_at is UNKNOWN — group key unresolvable" },
    });
    group_evidence.push({
      check_id: "OHLC_OPEN_IN_RANGE",
      field: "OPEN",
      outcome: "NOT_EVALUABLE",
      detail: { reason: "observed_at is UNKNOWN — group key unresolvable" },
    });
    group_evidence.push({
      check_id: "OHLC_CLOSE_IN_RANGE",
      field: "CLOSE",
      outcome: "NOT_EVALUABLE",
      detail: { reason: "observed_at is UNKNOWN — group key unresolvable" },
    });

    return {
      members,
      group_evidence,
      has_relational_failure: false,
    };
  }

  // Step 3: Check if all four members are present and parseable for relational checks
  const parsedValues: Record<Metric, number | null> = {
    OPEN: null,
    HIGH: null,
    LOW: null,
    CLOSE: null,
    VOLUME: null,
    QUOTE_VOLUME: null,
    MARKET_CAP: null,
    FDV: null,
    OPEN_INTEREST: null,
    FUNDING_RATE: null,
  };

  let allPresent = true;
  for (const metric of OHLC_METRICS as Metric[]) {
    const value = input.observations[metric as keyof typeof input.observations];
    if (value === null || value === undefined) {
      allPresent = false;
      break;
    }
    const rule = METRIC_RULES[metric];
    const evidence = runFieldChecks(metric, value, rule);
    const parseEvidence = evidence.find((e) => e.check_id === "NUMERIC_PARSE");
    if (parseEvidence && parseEvidence.outcome === "PASS") {
      parsedValues[metric] = (parseEvidence.detail as { parsed_value: number })
        .parsed_value;
    } else {
      allPresent = false;
      break;
    }
  }

  if (!allPresent) {
    // Cannot evaluate relational checks when any member is missing/invalid
    group_evidence.push({
      check_id: "OHLC_HIGH_GE_LOW",
      field: "HIGH",
      outcome: "NOT_EVALUABLE",
      detail: { reason: "not all OHLC members are present and parseable" },
    });
    group_evidence.push({
      check_id: "OHLC_OPEN_IN_RANGE",
      field: "OPEN",
      outcome: "NOT_EVALUABLE",
      detail: { reason: "not all OHLC members are present and parseable" },
    });
    group_evidence.push({
      check_id: "OHLC_CLOSE_IN_RANGE",
      field: "CLOSE",
      outcome: "NOT_EVALUABLE",
      detail: { reason: "not all OHLC members are present and parseable" },
    });

    return {
      members,
      group_evidence,
      has_relational_failure: false,
    };
  }

  // Step 4: Evaluate relational checks (all four members present and parseable)
  const high = parsedValues.HIGH!;
  const low = parsedValues.LOW!;
  const open = parsedValues.OPEN!;
  const close = parsedValues.CLOSE!;

  const highGeLow = checkHighGeLow(high, low);
  const openInRange = checkOpenInRange(open, low, high);
  const closeInRange = checkCloseInRange(close, low, high);

  group_evidence.push(highGeLow, openInRange, closeInRange);

  // Step 5: Apply OHLC SET scope (PD-03-RES)
  const has_relational_failure =
    highGeLow.outcome === "FAIL" ||
    openInRange.outcome === "FAIL" ||
    closeInRange.outcome === "FAIL";

  if (has_relational_failure) {
    applyOHLCGroupScope(members, group_evidence);
  }

  return {
    members,
    group_evidence,
    has_relational_failure,
  };
}

// ─── ENTITY RESOLUTION VALIDATION ─────────────────────────────────────

/**
 * Validate entity resolution for a set of metrics.
 *
 * PD-09-RES: entity resolution failure → MISSING + ENTITY_RESOLUTION_FAIL evidence.
 *
 * Returns validation results for each metric with MISSING status and
 * entity-resolution evidence.
 */
export function validateEntityResolution(
  metrics: Metric[],
  context: {
    entity_id: number;
    source: string;
    observed_at: Date | null;
    timeframe: Timeframe;
    reason: string;
  }
): MetricValidationResult[] {
  return metrics.map((metric) => ({
    quality_status: "MISSING" as QualityState,
    evidence: [
      {
        check_id: "ENTITY_RESOLUTION_FAIL" as const,
        field: metric,
        outcome: "FAIL" as const,
        detail: { reason: context.reason },
      },
    ],
  }));
}

// ─── CONVENIENCE: FULL VALIDATION RESULT ──────────────────────────────

/**
 * Validate an observation and produce a complete result with
 * quality_config_version and observation_status.
 */
export function validateObservation(
  input: ObservationInput
): MetricValidationResult & {
  quality_config_version: string;
  observation_status: QualityState;
} {
  const result = validateMetric(input);
  return {
    ...result,
    quality_config_version: QUALITY_CONFIG_VERSION,
    observation_status: result.quality_status,
  };
}
