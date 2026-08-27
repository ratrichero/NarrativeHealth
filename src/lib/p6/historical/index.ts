/**
 * P6-08D — Historical Intelligence Module Public API
 */

export type {
  HistoricalVersionTuple,
  ComparisonWindow,
  EntityType,
  TimelineDataPoint,
  HealthTimeline,
  ComparisonDelta,
  ComparisonArtifactReference,
  ComparisonProvenance,
  HistoricalComparisonResult,
  ComparisonWarning,
  WarningMatch,
  MembershipEvent,
  HistoricalMembership,
} from "./types";

export { HISTORICAL_V1_VERSION, WINDOW_DAYS } from "./types";

export {
  executeHistoricalComparison,
  buildHealthTimeline,
} from "./engine";

export {
  reconstructMembershipAtTime,
  detectMembershipChange,
  readMembershipEvents,
} from "./membership";
