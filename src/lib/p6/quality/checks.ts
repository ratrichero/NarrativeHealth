// P6 Data Quality V1 — Pure Check Functions
// Authority: P6-01D-B (Contract), P6-01D-C2 (Frozen Decisions)
//
// Every function is pure: same input + same contract = same output.
// No DB, no network, no side effects.

import type {
  Metric,
  MetricRule,
  QualityEvidence,
  QualityCheckId,
} from "./types";

// ─── NUMERIC PARSING ──────────────────────────────────────────────────

/**
 * Attempt to parse a value to a finite number.
 * Returns { parsed: number } on success, { error: string } on failure.
 *
 * Rejects: NaN, Infinity, -Infinity, non-numeric strings.
 * Does NOT coerce or silently fix values.
 */
export function parseNumeric(
  value: string | number | null | undefined
): { parsed: number } | { error: string } {
  if (value === null || value === undefined) {
    return { error: "value is null or undefined" };
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { error: `non-finite number: ${value}` };
    }
    return { parsed: value };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return { error: "empty string" };
    }
    const num = Number(trimmed);
    if (!Number.isFinite(num)) {
      return { error: `non-numeric string: "${trimmed}"` };
    }
    return { parsed: num };
  }

  return { error: `unsupported type: ${typeof value}` };
}

/**
 * NUMERIC_PARSE check (PD-02-RES: malformed present value → FAIL).
 * If the value is present but unparseable, returns FAIL evidence.
 * If the value is absent (null/undefined), returns null (not a value check — absence is MISSING).
 */
export function checkNumericParse(
  field: Metric,
  value: string | number | null | undefined
): QualityEvidence | null {
  // Absent values are not parse failures — they are MISSING (handled by caller)
  if (value === null || value === undefined) {
    return null;
  }

  const result = parseNumeric(value);
  if ("error" in result) {
    return {
      check_id: "NUMERIC_PARSE",
      field,
      outcome: "FAIL",
      detail: { observed_value: value, reason: result.error },
    };
  }

  return {
    check_id: "NUMERIC_PARSE",
    field,
    outcome: "PASS",
    detail: { parsed_value: result.parsed },
  };
}

// ─── NUMERIC SIGN ─────────────────────────────────────────────────────

/**
 * NEGATIVE_VALUE check (PD-04-RES).
 * Returns FAIL if value < 0 and the metric does not allow negatives.
 * Returns null if negative checking is not applicable (allow_negative = true).
 */
export function checkNegativeValue(
  field: Metric,
  numericValue: number,
  rule: MetricRule
): QualityEvidence | null {
  if (rule.allow_negative) {
    return {
      check_id: "NEGATIVE_VALUE",
      field,
      outcome: "NOT_APPLICABLE",
      detail: { reason: "metric allows negative values" },
    };
  }

  if (numericValue < 0) {
    return {
      check_id: "NEGATIVE_VALUE",
      field,
      outcome: "FAIL",
      detail: { parsed_value: numericValue },
    };
  }

  return {
    check_id: "NEGATIVE_VALUE",
    field,
    outcome: "PASS",
    detail: { parsed_value: numericValue },
  };
}

// ─── ZERO VALUE ───────────────────────────────────────────────────────

/**
 * ZERO_VALUE check (PD-05-RES).
 * Returns FAIL if value === 0 and the metric treats zero as invalid.
 * Returns null if zero is allowed for this metric.
 */
export function checkZeroValue(
  field: Metric,
  numericValue: number,
  rule: MetricRule
): QualityEvidence | null {
  if (rule.zero_valid) {
    return {
      check_id: "ZERO_VALUE",
      field,
      outcome: "NOT_APPLICABLE",
      detail: { reason: "zero is valid for this metric" },
    };
  }

  if (numericValue === 0) {
    return {
      check_id: "ZERO_VALUE",
      field,
      outcome: "FAIL",
      detail: { parsed_value: 0 },
    };
  }

  return {
    check_id: "ZERO_VALUE",
    field,
    outcome: "PASS",
    detail: { parsed_value: numericValue },
  };
}

// ─── FULL METRIC CHECK PIPELINE ───────────────────────────────────────

/**
 * Run all applicable field-level checks for a single metric value.
 * Returns ordered evidence list.
 *
 * Check order (frozen PD-01-RES):
 *   1. NUMERIC_PARSE (present value must be parseable)
 *   2. NEGATIVE_VALUE (if parseable and rule disallows negatives)
 *   3. ZERO_VALUE (if parseable and rule treats zero as invalid)
 *
 * Returns null evidence array entry for absent values (caller classifies as MISSING).
 */
export function runFieldChecks(
  field: Metric,
  value: string | number | null | undefined,
  rule: MetricRule
): QualityEvidence[] {
  const evidence: QualityEvidence[] = [];

  // Step 1: Parse check
  const parseEvidence = checkNumericParse(field, value);
  if (parseEvidence === null) {
    // Value is absent — not a parse failure. Caller handles MISSING.
    return evidence;
  }
  evidence.push(parseEvidence);

  // If parse failed, no further checks (the value is not a valid number)
  if (parseEvidence.outcome === "FAIL") {
    return evidence;
  }

  // Value parsed successfully — extract the numeric value
  const numericValue = (parseEvidence.detail as { parsed_value: number })
    .parsed_value;

  // Step 2: Sign check
  const signEvidence = checkNegativeValue(field, numericValue, rule);
  if (signEvidence !== null) {
    evidence.push(signEvidence);
  }

  // Step 3: Zero check
  const zeroEvidence = checkZeroValue(field, numericValue, rule);
  if (zeroEvidence !== null) {
    evidence.push(zeroEvidence);
  }

  return evidence;
}

// ─── OHLC RELATIONAL CHECKS (PD-03-RES) ───────────────────────────────

/**
 * OHLC relational check: HIGH >= LOW.
 * Requires both HIGH and LOW to be present and parseable.
 */
export function checkHighGeLow(
  high: number,
  low: number
): QualityEvidence {
  const pass = high >= low;
  return {
    check_id: "OHLC_HIGH_GE_LOW",
    field: "HIGH", // relational check spans HIGH and LOW
    outcome: pass ? "PASS" : "FAIL",
    detail: { high, low },
  };
}

/**
 * OHLC relational check: LOW <= OPEN <= HIGH.
 */
export function checkOpenInRange(
  open: number,
  low: number,
  high: number
): QualityEvidence {
  const pass = open >= low && open <= high;
  return {
    check_id: "OHLC_OPEN_IN_RANGE",
    field: "OPEN",
    outcome: pass ? "PASS" : "FAIL",
    detail: { open, low, high },
  };
}

/**
 * OHLC relational check: LOW <= CLOSE <= HIGH.
 */
export function checkCloseInRange(
  close: number,
  low: number,
  high: number
): QualityEvidence {
  const pass = close >= low && close <= high;
  return {
    check_id: "OHLC_CLOSE_IN_RANGE",
    field: "CLOSE",
    outcome: pass ? "PASS" : "FAIL",
    detail: { close, low, high },
  };
}

// ─── ENTITY RESOLUTION (PD-09-RES) ────────────────────────────────────

/**
 * Entity resolution failure evidence (PD-09-RES).
 * Returns evidence for when an entity cannot be resolved to a source.
 */
export function entityResolutionFailEvidence(
  field: Metric,
  reason: string
): QualityEvidence {
  return {
    check_id: "ENTITY_RESOLUTION_FAIL",
    field,
    outcome: "FAIL",
    detail: { reason },
  };
}
