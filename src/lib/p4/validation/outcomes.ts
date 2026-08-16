import { P3_TREND_EPSILONS } from "@/lib/services/p3-intelligence-history.service";
import type { P3IntelligenceViewModel } from "@/lib/types/p3-intelligence";
import type { OutcomeLabel, OutcomeRelation } from "./types";
import type { ReplayRecord } from "./types";

/**
 * P4-06 outcome derivation (P4-06A §4-C/§5) — narrative-state evolution ONLY.
 *
 * An OUTCOME is what the persisted P3 record says AT or AFTER the evaluation
 * horizon, compared with the P4 v1 interpretation at the horizon. Every label
 * compares the artifact AT the replay window (`current`) against the artifact
 * AT the evaluation horizon (`subsequent[last]`) — never data beyond the
 * caller-chosen horizon, never unavailable data.
 *
 * Explicitly NOT defined: price-return prediction labels. P4 Opportunity is
 * not a return prediction and P4 Risk is not loss probability (P4-06A §5).
 *
 * Epsilon use: the frozen P3-14/P3-18 trend epsilons are reused for DESCRIPTIVE
 * state classification of persisted deltas (the same classification the P3
 * read models already expose). No P4 threshold is created or reused.
 */

/** Descriptive epsilon classification of a persisted delta (P3-14 D.2). */
function classifyDelta(delta: number | null, epsilon: number): string {
  if (delta == null) return "unavailable";
  if (delta > epsilon) return "IMPROVING";
  if (delta < -epsilon) return "DETERIORATING";
  return "STABLE";
}

/** One numeric-metric outcome label (current vs horizon). */
function metricOutcome(
  id: OutcomeLabel["id"],
  interpretation: string,
  current: P3IntelligenceViewModel,
  horizon: P3IntelligenceViewModel,
  epsilon: number,
  pick: (vm: P3IntelligenceViewModel) => number | null
): OutcomeLabel {
  const prev = pick(current);
  const curr = pick(horizon);
  const delta = prev != null && curr != null ? curr - prev : null;
  const observation = classifyDelta(delta, epsilon);
  return {
    id,
    interpretation,
    observation,
    relation: observation === "unavailable" ? "NOT_APPLICABLE" : "CHANGE",
    sourceArtifactIds: [current.artifactId, horizon.artifactId],
    horizonWindows: 1,
  };
}

/**
 * Derive outcome labels for a replay record from the artifact at the replay
 * window plus the persisted artifacts that follow it (same identity,
 * `windowEnd > record.windowEnd`, ascending). Empty `subsequent` ⇒ `[]` (no
 * outcome exists yet — never fabricated).
 */
export function deriveOutcomes(input: {
  record: ReplayRecord;
  /** The artifact at the replay window (the record's current artifact). */
  current: P3IntelligenceViewModel;
  /** Ascending same-identity artifacts with windowEnd > record.windowEnd. */
  subsequent: P3IntelligenceViewModel[];
}): OutcomeLabel[] {
  const { record, current, subsequent } = input;
  if (subsequent.length === 0) return [];

  const horizon = subsequent[subsequent.length - 1]; // far horizon
  const interpretation = record.direction;
  const horizonWindows = subsequent.length;

  const labels: OutcomeLabel[] = [];

  // Trend overall — the primary "did the interpretation describe what
  // happened" check: momentum evolution over the horizon (P3-14 D.1 core).
  labels.push(
    metricOutcome(
      "trend_overall_evolution",
      interpretation,
      current,
      horizon,
      P3_TREND_EPSILONS.momentum,
      (vm) => vm.momentum.value
    )
  );

  // Regime / rotation — classification continuation or change.
  for (const [id, field] of [
    ["regime_evolution", "regime"],
    ["rotation_evolution", "rotation"],
  ] as const) {
    const prev = current[field].classification;
    const curr = horizon[field].classification;
    const observation = curr == null ? "unavailable" : curr;
    labels.push({
      id,
      interpretation,
      observation,
      relation:
        observation === "unavailable"
          ? "NOT_APPLICABLE"
          : prev != null && observation === prev
            ? "CONTINUATION"
            : "CHANGE",
      sourceArtifactIds: [current.artifactId, horizon.artifactId],
      horizonWindows,
    });
  }

  // Breadth / relative strength — descriptive epsilon classification.
  labels.push(
    metricOutcome("breadth_evolution", interpretation, current, horizon, P3_TREND_EPSILONS.breadth, (vm) => vm.breadth.value)
  );
  labels.push(
    metricOutcome(
      "relative_strength_evolution",
      interpretation,
      current,
      horizon,
      P3_TREND_EPSILONS.relativeStrength,
      (vm) => vm.relativeStrength.value
    )
  );

  // Leadership persistence — same leader identity at the horizon.
  const leaderAt = current.leadership.coinId;
  const leaderHorizon = horizon.leadership.coinId;
  labels.push({
    id: "leadership_persistence",
    interpretation,
    observation:
      leaderAt == null || leaderHorizon == null
        ? "unavailable"
        : leaderAt === leaderHorizon
          ? "same leader"
          : "leader changed",
    relation:
      leaderAt == null || leaderHorizon == null
        ? "NOT_APPLICABLE"
        : leaderAt === leaderHorizon
          ? "PERSISTENCE"
          : "CHANGE",
    sourceArtifactIds: [current.artifactId, horizon.artifactId],
    horizonWindows,
  });

  return labels;
}

/** Direction-relative trend relation (the P4-06B evaluation core). */
export function trendRelation(record: ReplayRecord, observation: string): OutcomeRelation {
  if (record.direction === "UNKNOWN" || record.direction === "MIXED" || record.direction === "NEUTRAL") {
    return "NOT_APPLICABLE";
  }
  if (observation === "unavailable") return "NOT_APPLICABLE";
  if (record.direction === "POSITIVE") {
    if (observation === "IMPROVING") return "CONTINUATION";
    if (observation === "DETERIORATING") return "REVERSAL";
    return "CHANGE";
  }
  if (observation === "DETERIORATING") return "CONTINUATION";
  if (observation === "IMPROVING") return "REVERSAL";
  return "CHANGE";
}
