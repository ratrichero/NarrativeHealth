import { buildP3IntelligenceHistory } from "@/lib/services/p3-intelligence-history.service";
import type { P3IntelligenceViewModel } from "@/lib/types/p3-intelligence";
import type { EventRisk } from "@/lib/types/event-risk";
import { assembleP4Evidence, classifyP2 } from "../assembler";
import { interpretP4 } from "../interpretation";
import { buildExplanation } from "../explanation/engine";
import {
  P4_ALGORITHM_VERSION,
  P4_EXPLANATION_VERSION,
  P4_INTERPRETATION_RULE_VERSION,
  P4_SEMANTIC_VERSION,
} from "../types";
import type { P4FiredSignal } from "../types";
import type { ReplayIdentity, ReplayRecord } from "./types";

/**
 * P4-06 historical replay (P4-06A §3) — pure, deterministic.
 *
 * Replays the FROZEN P4-03 v1 interpretation over a historical snapshot:
 * an ascending, same-identity series of persisted P3 view models ending at
 * the evaluation window. The replay REUSES the production interpretation
 * path — `buildP3IntelligenceHistory` → `assembleP4Evidence` →
 * `interpretP4` → `buildExplanation` — with no duplicated interpretation
 * logic and no second P4 algorithm.
 *
 * Replay safety (P4-06A §8):
 * - same identity only: the series is validated before replay (`null` on
 *   any identity mix — never silently re-grouped);
 * - no future leakage: the caller supplies a series whose windowEnd values
 *   are already <= the evaluation window (`seriesUpTo` enforces it);
 * - no modification of persisted artifacts, no P3 recalculation, no P2
 *   threshold reuse, no semantic changes;
 * - deterministic: identical input ⇒ identical record (modulo the
 *   metadata-only `generatedAt`).
 */

/** Assert every series artifact shares the full replay identity. */
export function assertSameIdentity(series: P3IntelligenceViewModel[]): ReplayIdentity | null {
  if (series.length === 0) return null;
  const first = series[0];
  const identity: ReplayIdentity = {
    narrativeId: first.narrativeId,
    window: first.window,
    algorithmKey: first.algorithmKey,
    algorithmVersion: first.algorithmVersion,
    calculationMode: first.calculationMode,
  };
  for (const artifact of series) {
    if (
      artifact.narrativeId !== identity.narrativeId ||
      artifact.window !== identity.window ||
      artifact.algorithmKey !== identity.algorithmKey ||
      artifact.algorithmVersion !== identity.algorithmVersion ||
      artifact.calculationMode !== identity.calculationMode
    ) {
      return null;
    }
  }
  return identity;
}

/**
 * Leakage-safe prefix: artifacts with `windowEnd <= atWindow` (ISO UTC,
 * same-length strings compare lexicographically). Replay must never see an
 * artifact after the evaluation point.
 */
export function seriesUpTo(
  series: P3IntelligenceViewModel[],
  atWindow: string
): P3IntelligenceViewModel[] {
  return series.filter((artifact) => artifact.windowEnd <= atWindow);
}

/** Derive the conflict classification from the fired EVIDENCE_CONFLICT signal. */
function conflictOf(signals: P4FiredSignal[]): ReplayRecord["conflict"] {
  const signal = signals.find((s) => s.id === "EVIDENCE_CONFLICT");
  if (!signal) return { fired: false, material: false, severity: null };
  const severity = signal.severity ?? "low";
  return { fired: true, material: severity !== "low", severity };
}

/**
 * Replay P4-03 v1 at the evaluation window defined by `series` (ascending,
 * same identity, already truncated to the evaluation window by the caller or
 * via `seriesUpTo`).
 *
 * Returns `null` (never throws) when the snapshot is not replayable: empty
 * series, mixed identity, unavailable P4 interpretation, or an assembly
 * rejection (P4-02 §7/§9 failure isolation).
 */
export function replayP4AtWindow(input: {
  series: P3IntelligenceViewModel[];
  constituentsByArtifact?: Record<number, number[] | null>;
  p2: {
    narrativeWideEvents: EventRisk[];
    coinLocalEvents: Array<EventRisk & { symbol?: string | null }>;
  };
}): ReplayRecord | null {
  const { series, constituentsByArtifact, p2: p2Input } = input;
  if (series.length === 0) return null;

  const identity = assertSameIdentity(series);
  if (identity == null) return null;

  const history = buildP3IntelligenceHistory(series, constituentsByArtifact ?? {});
  if (history == null) return null;

  const p2 = classifyP2(p2Input);
  const assembled = assembleP4Evidence({ current: history.current, history, p2 });
  if (!assembled.ok) return null;

  const interpretation = interpretP4(assembled.assembly);
  if (interpretation.status === "UNAVAILABLE") return null;

  const explanation = buildExplanation(interpretation);

  const current = history.current;
  if (current == null) return null;
  return {
    identity,
    windowEnd: current.windowEnd,
    artifactId: current.artifactId,
    precedingArtifactIds: series.slice(0, -1).map((artifact) => artifact.artifactId),
    semanticVersion: P4_SEMANTIC_VERSION,
    interpretationRuleVersion: P4_INTERPRETATION_RULE_VERSION,
    explanationVersion: P4_EXPLANATION_VERSION,
    status: interpretation.status === "AVAILABLE" ? "VALID" : interpretation.status,
    direction: interpretation.direction,
    signals: interpretation.signals,
    opportunity: interpretation.opportunity,
    risk: interpretation.risk,
    confidence: interpretation.confidence,
    actionability: interpretation.actionability,
    conflict: conflictOf(interpretation.signals),
    degradation: interpretation.degradation,
    evidence: interpretation.evidence,
    p2Scope: p2.scope,
    generatedAt: explanation.generatedAt,
  };
}

/** Replay identity label used by the P4-06B dataset writer / inventory. */
export function replayIdentityKey(identity: ReplayIdentity): string {
  return `${identity.narrativeId}|${identity.window}|${identity.algorithmKey}|${identity.algorithmVersion}|${identity.calculationMode}`;
}

/** Frozen P4 v1 version tuple (P4-03 §18 / P4-04 §21). */
export const P4_REPLAY_VERSIONS = {
  algorithmVersion: P4_ALGORITHM_VERSION,
  semanticVersion: P4_SEMANTIC_VERSION,
  interpretationRuleVersion: P4_INTERPRETATION_RULE_VERSION,
  explanationVersion: P4_EXPLANATION_VERSION,
} as const;
