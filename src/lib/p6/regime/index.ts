/**
 * P6-04D — Trend / Regime Detection Module
 *
 * Public API for P6-native regime detection layer.
 */

export type {
  RegimeState,
  EntityType,
  RegimeConfig,
  RegimeStateProperties,
  RegimeVersionTuple,
  RegimeQualityMetadata,
  RegimeFreshnessMetadata,
  RegimeProvenance,
  RegimeSnapshotInput,
  RegimeInput,
  RegimeOutput,
  RegimeStatus,
  PersistRegimeInput,
} from "./types";

export {
  DEFAULT_REGIME_CONFIG,
  REGIME_V1_VERSION,
  BOUNDARY_STRONG,
  BOUNDARY_STABLE_UPPER,
  BOUNDARY_STABLE_LOWER,
  BOUNDARY_WEAK,
} from "./types";

export {
  classifyScore,
  processSnapshot,
  createInitialState,
  createUnknownState,
} from "./state-machine";

export { calculateConfidence } from "./confidence";

export {
  assembleRegimeProvenance,
  assembleQualityMetadata,
  assembleFreshnessMetadata,
} from "./provenance";

export { detectRegime } from "./engine";
