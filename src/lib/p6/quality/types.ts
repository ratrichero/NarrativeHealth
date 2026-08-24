// P6 Data Quality V1 — Frozen Type Definitions
// Authority: P6-01D-B (Contract), P6-01D-C2 (Frozen Decisions)

// ─── FROZEN VOCABULARY ────────────────────────────────────────────────

/** Canonical V1 metric vocabulary (P6-01B, P6-01D-C2 PD-01-RES) */
export type Metric =
  | "OPEN"
  | "HIGH"
  | "LOW"
  | "CLOSE"
  | "VOLUME"
  | "QUOTE_VOLUME"
  | "MARKET_CAP"
  | "FDV"
  | "OPEN_INTEREST"
  | "FUNDING_RATE";

/** Frozen quality states — no other value permitted (DQ-01, DQ-02) */
export type QualityState = "VALID" | "INVALID" | "MISSING" | "UNKNOWN";

/** Frozen check outcomes — no other value permitted (P6-01D-B §7) */
export type CheckOutcome =
  | "PASS"
  | "FAIL"
  | "NOT_APPLICABLE"
  | "NOT_EVALUABLE";

/** Frozen check identifiers (P6-01D-D2 spec §QUALITY CHECK IDS) */
export type QualityCheckId =
  | "NUMERIC_PARSE"
  | "NUMERIC_FINITE"
  | "NEGATIVE_VALUE"
  | "ZERO_VALUE"
  | "OHLC_HIGH_GE_LOW"
  | "OHLC_OPEN_IN_RANGE"
  | "OHLC_CLOSE_IN_RANGE"
  | "ENTITY_RESOLUTION_FAIL";

// ─── INPUT TYPES ──────────────────────────────────────────────────────

/**
 * Canonical source identifiers (P6-01C-A/B).
 * Provided for type-safety; the validator itself only needs the string.
 */
export type SourceId = "BINANCE_SPOT" | "BINANCE_FUTURES" | "COINGECKO";

/** Frozen timeframe vocabulary (P6-01B) */
export type Timeframe = "DAILY" | "4H" | "SOURCE_SNAPSHOT";

/**
 * Single-metric observation input.
 * The value is the raw observed value — may be string, number, null, or undefined.
 */
export interface ObservationInput {
  entity_id: number;
  metric: Metric;
  source: string;
  observed_at: Date | null; // null = UNKNOWN (P6-01D-D1 §9)
  timeframe: Timeframe;
  value: string | number | null | undefined;
}

/**
 * OHLC validation group input.
 * All four members must share the same group key.
 */
export interface OHLCGroupInput {
  entity_id: number;
  source: string;
  observed_at: Date | null;
  timeframe: Timeframe;
  observations: {
    OPEN: string | number | null | undefined;
    HIGH: string | number | null | undefined;
    LOW: string | number | null | undefined;
    CLOSE: string | number | null | undefined;
  };
}

// ─── EVIDENCE / RESULT TYPES ──────────────────────────────────────────

/** Single validation evidence record (P6-01D-B §6-7) */
export interface QualityEvidence {
  check_id: QualityCheckId;
  field: Metric;
  outcome: CheckOutcome;
  detail?: Record<string, unknown>;
}

/** Result of validating a single metric */
export interface MetricValidationResult {
  quality_status: QualityState;
  evidence: QualityEvidence[];
}

/**
 * Result of validating an OHLC group.
 * Contains per-member results plus group-level relational evidence.
 */
export interface OHLCGroupValidationResult {
  members: Record<Metric, MetricValidationResult>;
  /** Group-level relational evidence (NOT_EVALUABLE if observed_at unknown) */
  group_evidence: QualityEvidence[];
  /** Whether any relational check failed */
  has_relational_failure: boolean;
}

// ─── PER-METRIC RULE CONFIGURATION (FROZEN V1) ────────────────────────

/**
 * Frozen V1 validation rules per metric (PD-01-RES / PD-18-RES Part A).
 * This is a compile-time constant, not loaded from DB in the pure validator.
 */
export interface MetricRule {
  allow_negative: boolean;
  zero_valid: boolean;
}

/** Frozen per-metric rules — the authoritative V1 configuration */
export const METRIC_RULES: Record<Metric, MetricRule> = {
  // OHLC: parse + sign≥0 + zero=INVALID
  OPEN: { allow_negative: false, zero_valid: false },
  HIGH: { allow_negative: false, zero_valid: false },
  LOW: { allow_negative: false, zero_valid: false },
  CLOSE: { allow_negative: false, zero_valid: false },
  // Volume metrics: parse + sign≥0 + zero=VALID
  VOLUME: { allow_negative: false, zero_valid: true },
  QUOTE_VOLUME: { allow_negative: false, zero_valid: true },
  // Market data: parse + sign≥0 + zero=INVALID
  MARKET_CAP: { allow_negative: false, zero_valid: false },
  FDV: { allow_negative: false, zero_valid: false },
  // Derivatives: parse only (FR allows negative, zero=VALID)
  OPEN_INTEREST: { allow_negative: false, zero_valid: true },
  FUNDING_RATE: { allow_negative: true, zero_valid: true },
} as const;

/** Frozen V1 quality config version */
export const QUALITY_CONFIG_VERSION = "v1" as const;
