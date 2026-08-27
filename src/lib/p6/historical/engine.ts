/**
 * P6-08D — Historical Intelligence Comparison Engine
 *
 * PD-08A-01: Derive on-read — no new persistence.
 * PD-08A-02: Windows = 7d, 30d, baseline.
 * PD-08C-03: Warning matching = entity_type + entity_id + warning_type + detection_window.
 * PD-08C-04: Membership reconstruction = latest event per coin at effective_at ≤ T.
 *
 * Authority: P6-08B, P6-08C1, P6-08C2
 *
 * This engine is a pure function of persisted authoritative artifacts.
 * Same inputs → same output (PH-01).
 * No fabrication (PH-02).
 * No recalculation of P6-03/04/05/06 semantics (PH-03).
 */

import { readSnapshotHistory, readCurrentSnapshot } from "../snapshot/persistence";
import { readCurrentRegime, readRegimeHistory } from "../regime/persistence";
import { readActiveWarnings, readWarningHistory } from "../warning/persistence";
import { readSummaryHistory } from "../aggregation/persistence";
import { reconstructMembershipAtTime, detectMembershipChange } from "./membership";
import type {
  EntityType,
  ComparisonWindow,
  HistoricalComparisonResult,
  ComparisonDelta,
  ComparisonArtifactReference,
  ComparisonProvenance,
  ComparisonWarning,
  WarningMatch,
  TimelineDataPoint,
  HealthTimeline,
  HistoricalVersionTuple,
  HistoricalMembership,
} from "./types";
import { HISTORICAL_V1_VERSION, WINDOW_DAYS } from "./types";
import type { SnapshotRecord } from "../snapshot/persistence";
import type { WarningRecord } from "../warning/types";

// ─── SNAPSHOT TYPE MAPPING ────────────────────────────────────────

function getSnapshotType(entityType: EntityType): "COIN_HEALTH" | "NARRATIVE_HEALTH" {
  return entityType === "coin" ? "COIN_HEALTH" : "NARRATIVE_HEALTH";
}

// ─── REFERENCE TIME RESOLUTION ────────────────────────────────────

/**
 * Resolve the current reference snapshot.
 * PD-08A-01: Latest eligible authoritative current artifact.
 */
function resolveCurrentReference(
  snapshots: SnapshotRecord[]
): SnapshotRecord | null {
  // Snapshots are ordered by window_end ASC from readSnapshotHistory
  // Return the last one (most recent)
  return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
}

/**
 * Resolve the historical reference snapshot for a comparison window.
 * PD-08A-02: Deterministic reference selection.
 *
 * @param snapshots - All snapshots ordered by window_end ASC
 * @param targetDate - The target historical date
 * @returns The selected historical snapshot and actual window metadata
 */
function resolveHistoricalReference(
  snapshots: SnapshotRecord[],
  targetDate: Date
): {
  snapshot: SnapshotRecord | null;
  actualWindowDays: number;
  currentWindowEnd: Date;
} | null {
  if (snapshots.length === 0) return null;

  const current = snapshots[snapshots.length - 1];
  const currentWindowEnd = new Date(current.windowEnd);

  // Find the snapshot at or before the target date
  let selected: SnapshotRecord | null = null;
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const snap = snapshots[i];
    const snapDate = new Date(snap.windowEnd);
    if (snapDate <= targetDate) {
      selected = snap;
      break;
    }
  }

  // If no snapshot at or before target, use the earliest available
  if (!selected && snapshots.length > 0) {
    selected = snapshots[0];
  }

  if (!selected) return null;

  const actualWindowEnd = new Date(selected.windowEnd);
  const actualWindowDays = Math.round(
    (currentWindowEnd.getTime() - actualWindowEnd.getTime()) / (1000 * 60 * 60 * 24)
  );

  return {
    snapshot: selected,
    actualWindowDays,
    currentWindowEnd,
  };
}

/**
 * Resolve the baseline (first-observed) snapshot.
 * PD-08A-06: First-observed snapshot as baseline.
 */
function resolveBaseline(
  snapshots: SnapshotRecord[]
): {
  snapshot: SnapshotRecord;
  actualWindowDays: number;
  currentWindowEnd: Date;
} | null {
  if (snapshots.length === 0) return null;

  const current = snapshots[snapshots.length - 1];
  const baseline = snapshots[0];
  const currentWindowEnd = new Date(current.windowEnd);
  const baselineWindowEnd = new Date(baseline.windowEnd);

  const actualWindowDays = Math.round(
    (currentWindowEnd.getTime() - baselineWindowEnd.getTime()) / (1000 * 60 * 60 * 24)
  );

  return {
    snapshot: baseline,
    actualWindowDays,
    currentWindowEnd,
  };
}

// ─── DELTA CALCULATION ────────────────────────────────────────────

/**
 * Calculate comparison delta between current and historical snapshots.
 * PH-01: Deterministic — same inputs → same output.
 */
function calculateDelta(
  current: SnapshotRecord,
  historical: SnapshotRecord,
  currentRegime: string | null,
  historicalRegime: string | null,
  currentWarnings: WarningRecord[],
  historicalWarnings: WarningRecord[]
): ComparisonDelta {
  // Health delta
  const healthDelta = roundToTwo(
    current.healthScore - historical.healthScore
  );

  // Health change percentage (PD-06C-03: null when previous = 0)
  let healthChangePct: number | null = null;
  if (historical.healthScore !== 0) {
    healthChangePct = roundToTwo(
      ((current.healthScore - historical.healthScore) / historical.healthScore) * 100
    );
  }

  // Confidence delta
  const confidenceDelta =
    current.confidenceScore != null && historical.confidenceScore != null
      ? roundToTwo(current.confidenceScore - historical.confidenceScore)
      : null;

  // Regime changed
  const regimeChanged = currentRegime !== historicalRegime;

  // Warning count delta
  const warningCountDelta = currentWarnings.length - historicalWarnings.length;

  return {
    health_delta: healthDelta,
    health_change_pct: healthChangePct,
    confidence_delta: confidenceDelta,
    regime_changed: regimeChanged,
    current_regime: currentRegime,
    historical_regime: historicalRegime,
    warning_count_delta: warningCountDelta,
  };
}

// ─── WARNING COMPARISON (PD-08C-03) ───────────────────────────────

/**
 * Compare warnings between current and historical snapshots.
 * PD-08C-03: Match by entity_type + entity_id + warning_type + detection_window.
 */
function compareWarnings(
  currentWarnings: WarningRecord[],
  historicalWarnings: WarningRecord[]
): {
  matched: WarningMatch[];
  new: ComparisonWarning[];
  resolved: ComparisonWarning[];
} {
  // Build lookup keys for historical warnings
  const historicalKeys = new Map<string, WarningRecord>();
  for (const w of historicalWarnings) {
    const key = `${w.warning_type}:${w.detection_window.toISOString()}`;
    historicalKeys.set(key, w);
  }

  // Build lookup keys for current warnings
  const currentKeys = new Map<string, WarningRecord>();
  for (const w of currentWarnings) {
    const key = `${w.warning_type}:${w.detection_window.toISOString()}`;
    currentKeys.set(key, w);
  }

  // Find matched warnings (exist in both)
  const matched: WarningMatch[] = [];
  for (const [key, current] of currentKeys) {
    const historical = historicalKeys.get(key);
    if (historical) {
      matched.push({
        warning_type: current.warning_type,
        detection_window: current.detection_window.toISOString(),
        current_severity: current.severity,
        historical_severity: historical.severity,
        severity_changed: current.severity !== historical.severity,
      });
    }
  }

  // Find new warnings (in current but not historical)
  const newWarnings: ComparisonWarning[] = [];
  for (const w of currentWarnings) {
    const key = `${w.warning_type}:${w.detection_window.toISOString()}`;
    if (!historicalKeys.has(key)) {
      newWarnings.push(toComparisonWarning(w));
    }
  }

  // Find resolved warnings (in historical but not current)
  const resolvedWarnings: ComparisonWarning[] = [];
  for (const w of historicalWarnings) {
    const key = `${w.warning_type}:${w.detection_window.toISOString()}`;
    if (!currentKeys.has(key)) {
      resolvedWarnings.push(toComparisonWarning(w));
    }
  }

  return { matched, new: newWarnings, resolved: resolvedWarnings };
}

function toComparisonWarning(w: WarningRecord): ComparisonWarning {
  return {
    warning_id: w.id,
    warning_type: w.warning_type,
    severity: w.severity,
    lifecycle: w.lifecycle,
    detection_window: w.detection_window.toISOString(),
  };
}

// ─── TIMELINE ─────────────────────────────────────────────────────

/**
 * Build a health timeline from historical snapshots.
 * PH-02: No fabrication — gaps are explicit.
 */
function buildTimeline(
  snapshots: SnapshotRecord[],
  entityType: EntityType,
  entityId: number
): HealthTimeline {
  const dataPoints: TimelineDataPoint[] = snapshots.map((snap) => ({
    window_end: snap.windowEnd.toISOString(),
    health_score: snap.healthScore,
    confidence_score: snap.confidenceScore,
    regime_state: null, // Regime is separate; timeline shows health
    warning_count: 0, // Warnings are separate; timeline shows health
    has_data: true,
    snapshot_id: snap.id,
  }));

  return {
    entity_type: entityType,
    entity_id: entityId,
    data_points: dataPoints,
    history_length: dataPoints.length,
    first_snapshot_window_end: dataPoints.length > 0 ? dataPoints[0].window_end : null,
    last_snapshot_window_end:
      dataPoints.length > 0 ? dataPoints[dataPoints.length - 1].window_end : null,
  };
}

// ─── MAIN COMPARISON ENGINE ───────────────────────────────────────

/**
 * Execute a historical comparison for an entity.
 *
 * PD-08A-01: Derive on-read — no persistence.
 * PH-01: Deterministic — same inputs → same output.
 * PH-02: No fabrication.
 * PH-03: No recalculation of P6-03/04/05/06.
 */
export async function executeHistoricalComparison(
  entityType: EntityType,
  entityId: number,
  window: ComparisonWindow,
  membership?: HistoricalMembership
): Promise<HistoricalComparisonResult> {
  const snapshotType = getSnapshotType(entityType);
  const now = new Date();

  // 1. Load all historical snapshots
  const snapshots = await readSnapshotHistory(entityType, entityId, snapshotType);

  if (snapshots.length === 0) {
    return emptyResult(entityType, entityId, window, now);
  }

  const current = resolveCurrentReference(snapshots);
  if (!current) {
    return emptyResult(entityType, entityId, window, now);
  }

  // 2. Resolve historical reference
  let historicalRef: SnapshotRecord | null = null;
  let actualWindowDays: number | null = null;
  let requestedWindowDays: number | null = null;
  let insufficientHistory = false;

  if (window === "baseline") {
    const baseline = resolveBaseline(snapshots);
    if (baseline) {
      historicalRef = baseline.snapshot;
      actualWindowDays = baseline.actualWindowDays;
      requestedWindowDays = null; // Baseline has no fixed window
    } else {
      insufficientHistory = true;
    }
  } else {
    const days = WINDOW_DAYS[window];
    requestedWindowDays = days;
    const targetDate = new Date(current.windowEnd);
    targetDate.setDate(targetDate.getDate() - days);

    const result = resolveHistoricalReference(snapshots, targetDate);
    if (result) {
      historicalRef = result.snapshot;
      actualWindowDays = result.actualWindowDays;
      // Check if we got the exact window we wanted
      if (actualWindowDays < days) {
        insufficientHistory = true;
      }
    } else {
      insufficientHistory = true;
    }
  }

  if (!historicalRef) {
    return emptyResult(entityType, entityId, window, now);
  }

  // 3. Load regime and warning data for both points
  const [currentRegimeData, historicalRegimeData] = await Promise.all([
    readCurrentRegime(entityType, entityId),
    // For historical regime, we use the regime closest to the historical snapshot
    // readRegimeHistory returns all, we find the one closest to historical window_end
    readRegimeHistory(entityType, entityId, "HEALTH", 50),
  ]);

  // Find historical regime closest to the historical snapshot
  const historicalRegimeRecord = findClosestRegime(
    historicalRegimeData,
    new Date(historicalRef.windowEnd)
  );

  const currentRegime = currentRegimeData?.regimeState ?? null;
  const historicalRegime = historicalRegimeRecord?.regimeState ?? null;

  // 4. Load warnings
  const [currentWarnings, historicalWarnings] = await Promise.all([
    readActiveWarnings(entityType, entityId),
    readWarningHistory(entityType, entityId, 100),
  ]);

  // For historical warnings, filter to those that were active at the historical point
  const historicalActiveWarnings = filterWarningsAtTime(
    historicalWarnings,
    new Date(historicalRef.windowEnd)
  );

  // 5. Compare warnings (PD-08C-03)
  const warningComparison = compareWarnings(currentWarnings, historicalActiveWarnings);

  // 6. Calculate delta
  const delta = calculateDelta(
    current,
    historicalRef,
    currentRegime,
    historicalRegime,
    currentWarnings,
    historicalActiveWarnings
  );

  // 7. Membership (narrative only)
  let membershipChanged: boolean | null = null;
  let currentMemberCount: number | null = null;
  let historicalMemberCount: number | null = null;

  if (entityType === "narrative" && membership) {
    historicalMemberCount = membership.member_count;
    membershipChanged = membership.membership_changed;

    // Current member count from snapshot member_scores (narrative snapshot stores member data)
    const memberScores = (current.healthDimensions ?? []) as Array<{ coin_id: number }>;
    currentMemberCount = memberScores.length;
  }

  // 8. Quality/freshness metadata
  const qualityMetadata = current.qualityMetadata as Record<string, unknown> | null;
  const freshnessMetadata = current.freshnessMetadata as Record<string, unknown> | null;

  // 9. Build provenance
  const provenance: ComparisonProvenance = {
    comparison_algorithm: HISTORICAL_V1_VERSION.comparison_algorithm_version,
    calculated_at: now.toISOString(),
    current_snapshot_id: current.id,
    current_snapshot_window_end: current.windowEnd.toISOString(),
    historical_snapshot_id: historicalRef.id,
    historical_snapshot_window_end: historicalRef.windowEnd.toISOString(),
    membership_reconstructed: entityType === "narrative",
    membership_event_count: membership?.event_count ?? 0,
  };

  // 10. Build result
  return {
    entity_type: entityType,
    entity_id: entityId,
    comparison_type: window === "baseline" ? "baseline" : "vs_n_day_ago",
    comparison_window: window,
    requested_window_days: requestedWindowDays,
    actual_window_days: actualWindowDays,
    insufficient_history: insufficientHistory,

    current: toArtifactReference(current),
    historical: toArtifactReference(historicalRef),
    delta,

    current_regime: currentRegime,
    historical_regime: historicalRegime,
    current_warnings: currentWarnings.map(toComparisonWarning),
    historical_warnings: historicalActiveWarnings.map(toComparisonWarning),
    matched_warnings: warningComparison.matched,
    new_warnings: warningComparison.new,
    resolved_warnings: warningComparison.resolved,

    membership_changed: membershipChanged,
    current_member_count: currentMemberCount,
    historical_member_count: historicalMemberCount,

    quality_metadata: qualityMetadata,
    freshness_metadata: freshnessMetadata,
    provenance,
    version: HISTORICAL_V1_VERSION,
  };
}

/**
 * Build a health timeline for an entity.
 * PH-02: No fabrication — gaps are explicit.
 */
export async function buildHealthTimeline(
  entityType: EntityType,
  entityId: number
): Promise<HealthTimeline> {
  const snapshotType = getSnapshotType(entityType);
  const snapshots = await readSnapshotHistory(entityType, entityId, snapshotType);
  return buildTimeline(snapshots, entityType, entityId);
}

// ─── HELPERS ──────────────────────────────────────────────────────

function toArtifactReference(snap: SnapshotRecord): ComparisonArtifactReference {
  return {
    snapshot_id: snap.id,
    window_end: snap.windowEnd.toISOString(),
    health_score: snap.healthScore,
    confidence_score: snap.confidenceScore,
  };
}

function findClosestRegime(
  regimes: Array<{ regimeState: string; calculationTime: Date; status: string }>,
  targetDate: Date
): { regimeState: string } | null {
  // Find the regime record closest to (but not after) the target date
  let closest: { regimeState: string } | null = null;
  for (const regime of regimes) {
    const regimeTime = new Date(regime.calculationTime);
    if (regimeTime <= targetDate) {
      closest = regime;
      break; // Regimes are ordered newest first, so first match is closest
    }
  }
  return closest;
}

function filterWarningsAtTime(
  warnings: WarningRecord[],
  asOf: Date
): WarningRecord[] {
  return warnings.filter((w) => {
    const detectedAt = new Date(w.detected_at);
    const effectiveUntil = w.effective_until ? new Date(w.effective_until) : null;

    // Warning was detected before or at the historical point
    if (detectedAt > asOf) return false;

    // Warning was not yet resolved/superseded at the historical point
    if (effectiveUntil && effectiveUntil <= asOf) return false;

    return true;
  });
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function emptyResult(
  entityType: EntityType,
  entityId: number,
  window: ComparisonWindow,
  now: Date
): HistoricalComparisonResult {
  return {
    entity_type: entityType,
    entity_id: entityId,
    comparison_type: window === "baseline" ? "baseline" : "vs_n_day_ago",
    comparison_window: window,
    requested_window_days: window === "baseline" ? null : WINDOW_DAYS[window] ?? null,
    actual_window_days: null,
    insufficient_history: true,

    current: null,
    historical: null,
    delta: null,

    current_regime: null,
    historical_regime: null,
    current_warnings: [],
    historical_warnings: [],
    matched_warnings: [],
    new_warnings: [],
    resolved_warnings: [],

    membership_changed: null,
    current_member_count: null,
    historical_member_count: null,

    quality_metadata: null,
    freshness_metadata: null,
    provenance: {
      comparison_algorithm: HISTORICAL_V1_VERSION.comparison_algorithm_version,
      calculated_at: now.toISOString(),
      current_snapshot_id: 0,
      current_snapshot_window_end: "",
      historical_snapshot_id: 0,
      historical_snapshot_window_end: "",
      membership_reconstructed: false,
      membership_event_count: 0,
    },
    version: HISTORICAL_V1_VERSION,
  };
}
