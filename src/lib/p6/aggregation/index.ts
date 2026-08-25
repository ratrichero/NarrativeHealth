/**
 * P6-06D — Intelligence Aggregation Module
 *
 * Public API for the P6-native intelligence aggregation layer.
 */

export type {
  EntityType,
  Timeframe,
  SummaryLifecycle,
  SummaryVersionTuple,
  SummaryConfig,
  ExplanationCategory,
  ExplanationItem,
  Explanation,
  WarningSummaryItem,
  AggregationSnapshotInput,
  AggregationRegimeInput,
  PreviousContextInput,
  SummaryEngineInput,
  ChangeDetectionResult,
  IntelligenceSummary,
  SummaryProvenance,
  WindowEndSource,
} from "./types";

export { SUMMARY_V1_VERSION, DEFAULT_SUMMARY_CONFIG } from "./types";

export {
  resolveWindowEnd,
  buildSummaryKey,
} from "./identity";

export type { WindowEndResult } from "./identity";

export {
  computeHealthDelta,
  computeHealthChangePct,
  computeRegimeChange,
  selectNewWarnings,
  selectResolvedWarnings,
  detectChanges,
} from "./change";

export {
  rankExplanationItems,
  generateWhatChanged,
  generateWhy,
  generateWhatToWatch,
  generateExplanation,
} from "./explanation";

export { assembleSummaryProvenance } from "./provenance";

export {
  isValidSummaryTransition,
  isSupersededTerminal,
  isCurrentState,
  isLifecycleNotQualityState,
  isLifecycleNotRegimeState,
  SUMMARY_LIFECYCLE_STATES,
} from "./lifecycle";

export {
  hasMinimumPopulation,
  computeHighestSeverity,
  aggregateIntelligence,
} from "./engine";

export {
  persistSummary,
  readCurrentSummary,
} from "./persistence";

export type { StoredSummaryRow } from "./persistence";
