// P6 Source Registry — Type Definitions
// Frozen contract: P6-01C (commit 18fb0f0)
// Observation contract: P6-01B (commit ad5d7df)

// ============================================================
// Source Identity
// ============================================================

/** Canonical source identifiers — EXACTLY these three values */
export type SourceId = "BINANCE_SPOT" | "BINANCE_FUTURES" | "COINGECKO";

/** Source type classification — classification only, not for scoring/health */
export type SourceType = "MARKET_SPOT" | "MARKET_DERIVATIVES" | "MARKET_AGGREGATOR";

/** Registry status — ACTIVE / INACTIVE only. NOT operational status (OK/PARTIAL/FAILED) */
export type SourceRegistryStatus = "ACTIVE" | "INACTIVE";

// ============================================================
// Canonical Metric Vocabulary (from P6-01B §6.1)
// ============================================================

/** Canonical metric IDs — ONLY these 10 values */
export type CanonicalMetric =
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

// ============================================================
// Timeframe Vocabulary (from P6-01B §5.3)
// ============================================================

/** Canonical timeframe IDs — ONLY these 3 values */
export type Timeframe = "DAILY" | "4H" | "SOURCE_SNAPSHOT";

// ============================================================
// Entity Coverage
// ============================================================

/** Entity type — currently only COIN */
export type EntityType = "COIN";

/** Entity coverage requirement description */
export type EntityCoverageRequirement = string;

// ============================================================
// Registry Configuration Version
// ============================================================

export interface RegistryConfigVersion {
  version: number;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
}

// ============================================================
// Supported Entities Set (for runtime queries)
// ============================================================

export const SUPPORTED_SOURCE_IDS: ReadonlySet<SourceId> = new Set([
  "BINANCE_SPOT",
  "BINANCE_FUTURES",
  "COINGECKO",
]);

export const SUPPORTED_SOURCE_TYPES: ReadonlySet<SourceType> = new Set([
  "MARKET_SPOT",
  "MARKET_DERIVATIVES",
  "MARKET_AGGREGATOR",
]);

export const SUPPORTED_REGISTRY_STATUSES: ReadonlySet<SourceRegistryStatus> = new Set([
  "ACTIVE",
  "INACTIVE",
]);

export const SUPPORTED_CANONICAL_METRICS: ReadonlySet<CanonicalMetric> = new Set([
  "OPEN",
  "HIGH",
  "LOW",
  "CLOSE",
  "VOLUME",
  "QUOTE_VOLUME",
  "MARKET_CAP",
  "FDV",
  "OPEN_INTEREST",
  "FUNDING_RATE",
]);

export const SUPPORTED_TIMEFRAMES: ReadonlySet<Timeframe> = new Set([
  "DAILY",
  "4H",
  "SOURCE_SNAPSHOT",
]);

// ============================================================
// Validation Helpers
// ============================================================

export function isValidSourceId(value: string): value is SourceId {
  return SUPPORTED_SOURCE_IDS.has(value as SourceId);
}

export function isValidSourceType(value: string): value is SourceType {
  return SUPPORTED_SOURCE_TYPES.has(value as SourceType);
}

export function isValidRegistryStatus(value: string): value is SourceRegistryStatus {
  return SUPPORTED_REGISTRY_STATUSES.has(value as SourceRegistryStatus);
}

export function isValidCanonicalMetric(value: string): value is CanonicalMetric {
  return SUPPORTED_CANONICAL_METRICS.has(value as CanonicalMetric);
}

export function isValidTimeframe(value: string): value is Timeframe {
  return SUPPORTED_TIMEFRAMES.has(value as Timeframe);
}

/** Runtime operational statuses that are NOT valid registry statuses */
export const RUNTIME_ONLY_STATUSES = new Set(["OK", "PARTIAL", "FAILED"]);

export function isRuntimeOnlyStatus(value: string): boolean {
  return RUNTIME_ONLY_STATUSES.has(value);
}
