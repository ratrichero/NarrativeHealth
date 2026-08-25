/**
 * P6-05D — Early Warning Engine Module
 *
 * Public API for P6-native early warning layer.
 */

export type {
  WarningType,
  Severity,
  WarningLifecycle,
  EntityType,
  WarningConfig,
  SeverityFactor,
  WarningVersionTuple,
  WarningIdentity,
  WarningProvenance,
  WarningRecord,
  WarningSnapshotInput,
  WarningRegimeInput,
  WarningEngineInput,
  WarningOutput,
  WarningCandidate,
  PersistWarningInput as PersistWarningInputType,
} from "./types";

export {
  ALL_WARNING_TYPES,
  SEVERITY_ORDER,
  SEVERITY_RANK,
  DEFAULT_WARNING_CONFIG,
  WARNING_V1_VERSION,
} from "./types";

export {
  checkHealthThreshold,
  checkConfidenceThreshold,
  checkRegimeChangeThreshold,
  checkQualityThreshold,
  checkFreshnessThreshold,
} from "./thresholds";

export type { ThresholdCheckResult } from "./thresholds";

export {
  selectHighestSeverity,
  evaluateHealthDeltaSeverity,
  evaluateRegimeContextSeverity,
  evaluateConfidenceContextSeverity,
  getBaselineSeverity,
  determineSeverity,
} from "./severity";

export {
  computeDedupKey,
  isDuplicate,
  isWithinCooldown,
  findWarningsToSupersede,
  findWarningsToResolve,
  buildWarningIdentity,
} from "./identity";

export {
  isValidTransition,
  transitionLifecycle,
  determineInitialLifecycle,
  afterPersistence,
  isLifecycleNotQualityState,
  isLifecycleNotRegimeState,
} from "./lifecycle";

export {
  assembleWarningProvenance,
  assembleQualitySummary,
  assembleFreshnessSummary,
} from "./provenance";

export { detectWarnings } from "./engine";

export {
  persistWarning,
  updateWarningLifecycle,
  readActiveWarnings,
  readWarningHistory,
} from "./persistence";

export type { PersistWarningInput } from "./persistence";
