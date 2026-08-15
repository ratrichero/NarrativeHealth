import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  coins,
  p3ConstituentSnapshotMembers,
  p3ConstituentSnapshots,
  p3NarrativeIntelligence,
} from "@/db/schema";
import {
  formatP3Momentum,
  formatP3Ratio,
  formatP3Score,
  formatP3SignedRatio,
  inferP3Window,
  toP3IntelligenceViewModel,
  type P3IntelligenceReadSource,
} from "@/lib/services/p3-intelligence.service";
import type { P3IntelligenceViewModel } from "@/lib/types/p3-intelligence";
import type {
  P3ClassificationTrend,
  P3ConstituentTrend,
  P3IntelligenceHistoryViewModel,
  P3LeadershipTrend,
  P3MetricTrend,
  P3TrendState,
  P3TrendStep,
} from "@/lib/types/p3-intelligence-history";

// ===========================================================================
// READ-ONLY P3 HISTORICAL INTELLIGENCE SERVICE (P3-18)
// ---------------------------------------------------------------------------
// Derives historical intelligence and trend from *persisted immutable*
// artifacts only. It never imports P3 kernel modules (src/lib/p3/*), never
// recalculates, never writes. Trend is arithmetic/string comparison over
// stored rows, filtered to a single identity (P3-14 Part C).
// ===========================================================================

/**
 * Trend epsilon thresholds — adopted verbatim from the frozen P3-14 Part D.2
 * contract (PROPOSED placeholders adopted as the P3-18 implementation
 * constants; no new threshold was invented by P3-18).
 */
export const P3_TREND_EPSILONS = {
  /** Momentum delta ε (± percentage points, window-matched). */
  momentum: 1.0,
  /** Rotation score delta ε (0–100 scale). */
  rotationScore: 5.0,
  /** Breadth delta ε. */
  breadth: 0.05,
  /** Relative-strength delta ε. */
  relativeStrength: 0.01,
  /** Leader score delta ε. */
  leaderScore: 5.0,
} as const;

/**
 * Regime direction mapping — implementation mapping derived from the frozen
 * P3-14 Part D.1 examples (NEUTRAL → EMERGING/STRONG improves; regime
 * weakening deteriorates) over the canonical P3-08 regime list. Any regime
 * value not in this table yields UNKNOWN (never guessed).
 */
const REGIME_RANK: Record<string, number> = {
  DEAD: 0,
  WEAKENING: 1,
  NEUTRAL: 2,
  MATURE: 3,
  EMERGING: 4,
  STRONG: 5,
};

/**
 * Rotation direction mapping — directly from the P3-09 threshold ordering
 * (acceleratingMin > inflowMin > stableMin > deceleratingMin), so the rank
 * mirrors the frozen rotation contract. Unknown values → UNKNOWN.
 */
const ROTATION_RANK: Record<string, number> = {
  OUTFLOW: 0,
  DECELERATING: 1,
  STABLE: 2,
  INFLOW: 3,
  ACCELERATING: 4,
};

/** Minimum artifacts (same identity) for the first comparability point (P3-14 G.2). */
export const P3_TREND_MINIMUM_ARTIFACTS = 2;

// ---------------------------------------------------------------------------
// Pure trend functions (unit-testable, no DB / no React)
// ---------------------------------------------------------------------------

function signed(value: number, decimals: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}`;
}

/**
 * Classify a numeric delta against an epsilon (P3-14 D.1/D.2):
 * > +ε → IMPROVING, < -ε → DETERIORATING, |Δ| ≤ ε → STABLE, unavailable → UNKNOWN.
 */
export function trendFromDelta(delta: number | null, epsilon: number): P3TrendState {
  if (delta == null || !Number.isFinite(delta)) return "UNKNOWN";
  if (delta > epsilon) return "IMPROVING";
  if (delta < -epsilon) return "DETERIORATING";
  return "STABLE";
}

/**
 * Classification transition (P3-14 D.1/D.3). Same classification → STABLE
 * (includes NEUTRAL → NEUTRAL = STABLE). Ranked movement → IMPROVING /
 * DETERIORATING. Unavailable or unranked classification → UNKNOWN.
 */
export function classificationTransition(
  previous: string | null,
  current: string | null,
  rank: Record<string, number>
): P3TrendState {
  if (previous == null || previous === "" || current == null || current === "") return "UNKNOWN";
  const previousRank = rank[previous];
  const currentRank = rank[current];
  if (previousRank == null || currentRank == null) return "UNKNOWN";
  if (currentRank > previousRank) return "IMPROVING";
  if (currentRank < previousRank) return "DETERIORATING";
  return "STABLE";
}

/**
 * Aggregate per-step trend states into a series-level state.
 * UNKNOWN anywhere → UNKNOWN (P3-14 D.3: never fabricate). Mixed improving +
 * deteriorating → TRANSITION. Any TRANSITION without a consistent direction →
 * TRANSITION. Otherwise the single direction (or STABLE when nothing moved).
 */
export function aggregateTrendStates(states: P3TrendState[]): P3TrendState {
  if (states.length === 0) return "UNKNOWN";
  if (states.some((state) => state === "UNKNOWN")) return "UNKNOWN";
  const improving = states.some((state) => state === "IMPROVING");
  const deteriorating = states.some((state) => state === "DETERIORATING");
  if (improving && deteriorating) return "TRANSITION";
  if (improving) return "IMPROVING";
  if (deteriorating) return "DETERIORATING";
  if (states.some((state) => state === "TRANSITION")) return "TRANSITION";
  return "STABLE";
}

/**
 * Overall narrative trend (P3-14 D.1): regime + rotation + momentum. Any
 * UNKNOWN → UNKNOWN; mixed directions → TRANSITION; single direction wins.
 */
export function overallTrend(
  regime: P3TrendState,
  rotation: P3TrendState,
  momentum: P3TrendState
): P3TrendState {
  const states = [regime, rotation, momentum];
  if (states.some((state) => state === "UNKNOWN")) return "UNKNOWN";
  const improving = states.some((state) => state === "IMPROVING");
  const deteriorating = states.some((state) => state === "DETERIORATING");
  if (improving && deteriorating) return "TRANSITION";
  if (improving) return "IMPROVING";
  if (deteriorating) return "DETERIORATING";
  if (states.some((state) => state === "TRANSITION")) return "TRANSITION";
  return "STABLE";
}

function metricTrend(
  previousValue: number | null,
  currentValue: number | null,
  epsilon: number,
  format: (value: number) => string
): P3MetricTrend {
  const delta =
    previousValue != null && currentValue != null ? currentValue - previousValue : null;
  return {
    previous: previousValue,
    current: currentValue,
    delta,
    previousDisplay: previousValue == null ? "—" : format(previousValue),
    currentDisplay: currentValue == null ? "—" : format(currentValue),
    deltaDisplay: delta == null ? "—" : signed(delta, format === formatP3Ratio || format === formatP3SignedRatio ? 3 : 2),
    state: trendFromDelta(delta, epsilon),
  };
}

function leadershipTrend(
  previous: P3IntelligenceViewModel["leadership"],
  current: P3IntelligenceViewModel["leadership"],
  epsilon: number
): P3LeadershipTrend {
  const prev =
    previous == null
      ? null
      : {
          coinId: previous.coinId,
          symbol: previous.symbol,
          score: previous.score,
          scoreDisplay: previous.scoreDisplay,
        };
  const curr =
    current == null
      ? null
      : {
          coinId: current.coinId,
          symbol: current.symbol,
          score: current.score,
          scoreDisplay: current.scoreDisplay,
        };
  if (prev == null || curr == null) {
    return {
      previous: prev,
      current: curr,
      changed: prev?.coinId != null && curr?.coinId != null && prev.coinId !== curr.coinId,
      scoreDelta: null,
      scoreDeltaDisplay: "—",
      state: "UNKNOWN",
    };
  }
  const scoreDelta =
    prev.score != null && curr.score != null ? curr.score - prev.score : null;
  const changed = prev.coinId != null && curr.coinId != null && prev.coinId !== curr.coinId;
  let state: P3TrendState;
  if (scoreDelta == null) {
    state = "UNKNOWN";
  } else if (changed) {
    // A leader identity change is a classification-level transition: the
    // direction of a cross-coin score comparison is not defined by contract.
    state = "TRANSITION";
  } else {
    state = trendFromDelta(scoreDelta, epsilon);
  }
  return {
    previous: prev,
    current: curr,
    changed,
    scoreDelta,
    scoreDeltaDisplay: scoreDelta == null ? "—" : signed(scoreDelta, 2),
    state,
  };
}

function constituentTrend(
  previousCount: number | null,
  currentCount: number | null,
  previousCoinIds: number[] | null,
  currentCoinIds: number[] | null
): P3ConstituentTrend {
  if (
    previousCount == null ||
    currentCount == null ||
    previousCoinIds == null ||
    currentCoinIds == null
  ) {
    return {
      previousCount,
      currentCount,
      added: [],
      removed: [],
      changed: false,
      state: "UNKNOWN",
    };
  }
  const previousSet = new Set(previousCoinIds);
  const currentSet = new Set(currentCoinIds);
  const added = currentCoinIds.filter((coinId) => !previousSet.has(coinId));
  const removed = previousCoinIds.filter((coinId) => !currentSet.has(coinId));
  const changed = added.length > 0 || removed.length > 0;
  return {
    previousCount,
    currentCount,
    added,
    removed,
    changed,
    state: changed ? "TRANSITION" : "STABLE",
  };
}

/**
 * Build the historical view model from an ascending same-identity series.
 * Pure — all inputs are persisted view models + constituent coin ids.
 */
export function buildP3IntelligenceHistory(
  series: P3IntelligenceViewModel[],
  constituentsByArtifact: Record<number, number[] | null>
): P3IntelligenceHistoryViewModel | null {
  if (series.length === 0) return null;

  const latest = series[series.length - 1];
  const identity = {
    narrativeId: latest.narrativeId,
    window: latest.window,
    algorithmKey: latest.algorithmKey,
    algorithmVersion: latest.algorithmVersion,
    calculationMode: latest.calculationMode,
  };

  const steps: P3TrendStep[] = [];
  for (let i = 1; i < series.length; i += 1) {
    const previous = series[i - 1];
    const current = series[i];

    const regime: P3ClassificationTrend = {
      previous: previous.regime.classification,
      current: current.regime.classification,
      state: classificationTransition(
        previous.regime.classification,
        current.regime.classification,
        REGIME_RANK
      ),
    };
    const rotation: P3ClassificationTrend = {
      previous: previous.rotation.classification,
      current: current.rotation.classification,
      state: classificationTransition(
        previous.rotation.classification,
        current.rotation.classification,
        ROTATION_RANK
      ),
    };
    const rotationScore = metricTrend(
      previous.rotation.score,
      current.rotation.score,
      P3_TREND_EPSILONS.rotationScore,
      formatP3Score
    );
    const breadth = metricTrend(
      previous.breadth.value,
      current.breadth.value,
      P3_TREND_EPSILONS.breadth,
      formatP3Ratio
    );
    const momentum = metricTrend(
      previous.momentum.value,
      current.momentum.value,
      P3_TREND_EPSILONS.momentum,
      formatP3Momentum
    );
    const relativeStrength = metricTrend(
      previous.relativeStrength.value,
      current.relativeStrength.value,
      P3_TREND_EPSILONS.relativeStrength,
      formatP3SignedRatio
    );
    const leadership = leadershipTrend(
      previous.leadership,
      current.leadership,
      P3_TREND_EPSILONS.leaderScore
    );
    const constituents = constituentTrend(
      previous.constituents.count,
      current.constituents.count,
      constituentsByArtifact[previous.artifactId] ?? null,
      constituentsByArtifact[current.artifactId] ?? null
    );

    steps.push({
      previous,
      current,
      regime,
      rotation,
      rotationScore,
      breadth,
      momentum,
      relativeStrength,
      leadership,
      constituents,
      state: overallTrend(regime.state, rotation.state, momentum.state),
    });
  }

  const trendRegimeAggregate = aggregateTrendStates(steps.map((step) => step.regime.state));
  const trendRotationAggregate = aggregateTrendStates(steps.map((step) => step.rotation.state));
  const trendMomentumAggregate = aggregateTrendStates(steps.map((step) => step.momentum.state));

  return {
    identity,
    series,
    current: latest,
    previous: series.length >= 2 ? series[series.length - 2] : null,
    steps,
    trend: {
      regime: trendRegimeAggregate,
      rotation: trendRotationAggregate,
      rotationScore: aggregateTrendStates(steps.map((step) => step.rotationScore.state)),
      breadth: aggregateTrendStates(steps.map((step) => step.breadth.state)),
      momentum: trendMomentumAggregate,
      relativeStrength: aggregateTrendStates(steps.map((step) => step.relativeStrength.state)),
      leadership: aggregateTrendStates(steps.map((step) => step.leadership.state)),
      constituents: aggregateTrendStates(steps.map((step) => step.constituents.state)),
      overall: overallTrend(trendRegimeAggregate, trendRotationAggregate, trendMomentumAggregate),
    },
    dataSufficiency: {
      comparableArtifacts: series.length,
      requiredMinimum: P3_TREND_MINIMUM_ARTIFACTS,
      sufficient: series.length >= P3_TREND_MINIMUM_ARTIFACTS,
    },
  };
}

// ---------------------------------------------------------------------------
// Read service — identity-filtered historical series
// ---------------------------------------------------------------------------

/**
 * Retrieve the same-identity VALID artifact series for a narrative and derive
 * the historical intelligence view model. Returns null when no VALID artifact
 * exists. Read-only: SELECTs persisted rows only; never recalculation.
 */
export async function getP3IntelligenceHistory(
  narrativeId: number
): Promise<P3IntelligenceHistoryViewModel | null> {
  const artifacts = await db
    .select()
    .from(p3NarrativeIntelligence)
    .where(
      and(
        eq(p3NarrativeIntelligence.narrativeId, narrativeId),
        eq(p3NarrativeIntelligence.availabilityState, "VALID")
      )
    )
    .orderBy(asc(p3NarrativeIntelligence.windowEnd), asc(p3NarrativeIntelligence.id));

  if (artifacts.length === 0) return null;

  // P3-14 Part C — compare only within a single identity. Group artifacts by
  // (algorithmKey, algorithmVersion, calculationMode, window) and keep the
  // group that contains the latest artifact.
  const groups = new Map<string, typeof artifacts>();
  for (const artifact of artifacts) {
    const window = inferP3Window(artifact);
    const key = `${artifact.algorithmKey}|${artifact.algorithmVersion}|${artifact.calculationMode}|${window}`;
    const group = groups.get(key) ?? [];
    group.push(artifact);
    groups.set(key, group);
  }
  const latestArtifact = artifacts[artifacts.length - 1];
  const latestWindow = inferP3Window(latestArtifact);
  const identityKey = `${latestArtifact.algorithmKey}|${latestArtifact.algorithmVersion}|${latestArtifact.calculationMode}|${latestWindow}`;
  const identityArtifacts = (groups.get(identityKey) ?? []).sort((a, b) => {
    const byWindow = a.windowEnd.getTime() - b.windowEnd.getTime();
    return byWindow !== 0 ? byWindow : a.id - b.id;
  });

  // Enrich: leader symbols + constituent summary per artifact.
  const leaderCoinIds = [...new Set(identityArtifacts.map((a) => a.leaderCoinId).filter((v): v is number => v != null))];
  const leaderCoins = leaderCoinIds.length
    ? await db
        .select({ id: coins.id, symbol: coins.symbol })
        .from(coins)
        .where(inArray(coins.id, leaderCoinIds))
    : [];
  const leaderSymbolById = new Map(leaderCoins.map((c) => [c.id, c.symbol]));

  const artifactIds = identityArtifacts.map((a) => a.id);
  const snapshots = artifactIds.length
    ? await db
        .select({
          id: p3ConstituentSnapshots.id,
          intelligenceId: p3ConstituentSnapshots.intelligenceId,
          memberCount: p3ConstituentSnapshots.memberCount,
        })
        .from(p3ConstituentSnapshots)
        .where(inArray(p3ConstituentSnapshots.intelligenceId, artifactIds))
    : [];
  const memberCountById = new Map(snapshots.map((s) => [s.intelligenceId, s.memberCount]));

  const snapshotIds = snapshots.map((s) => s.id);
  const memberRows = snapshotIds.length
    ? await db
        .select({
          snapshotId: p3ConstituentSnapshotMembers.snapshotId,
          coinId: p3ConstituentSnapshotMembers.coinId,
        })
        .from(p3ConstituentSnapshotMembers)
        .where(inArray(p3ConstituentSnapshotMembers.snapshotId, snapshotIds))
    : [];
  const coinIdsBySnapshot = new Map<number, number[]>();
  for (const row of memberRows) {
    const list = coinIdsBySnapshot.get(row.snapshotId) ?? [];
    list.push(row.coinId);
    coinIdsBySnapshot.set(row.snapshotId, list);
  }
  const snapshotIdByIntelligence = new Map(snapshots.map((s) => [s.intelligenceId, s.id]));

  const series: P3IntelligenceViewModel[] = identityArtifacts.map((artifact) => {
    const source: P3IntelligenceReadSource = {
      artifact,
      leaderSymbol: artifact.leaderCoinId != null ? (leaderSymbolById.get(artifact.leaderCoinId) ?? null) : null,
      memberCount: memberCountById.get(artifact.id) ?? null,
    };
    return toP3IntelligenceViewModel(source);
  });

  const constituentsByArtifact: Record<number, number[] | null> = {};
  for (const artifact of identityArtifacts) {
    const snapshotId = snapshotIdByIntelligence.get(artifact.id);
    constituentsByArtifact[artifact.id] =
      snapshotId != null ? (coinIdsBySnapshot.get(snapshotId) ?? []) : null;
  }

  return buildP3IntelligenceHistory(series, constituentsByArtifact);
}
