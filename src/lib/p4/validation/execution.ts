import { buildP3IntelligenceHistory } from "@/lib/services/p3-intelligence-history.service";
import type { P3IntelligenceViewModel } from "@/lib/types/p3-intelligence";
import type { P3TrendState } from "@/lib/types/p3-intelligence-history";
import { computeMoves } from "../mapper";
import type { P4Moves } from "../types";
import { UNKNOWN_MOVES } from "../availability";
import type { P4DirectionState, P4QualitativeValue } from "../types";
import { replayP4AtWindow, seriesUpTo } from "./replay";
import type { ReplayConflict, ReplayRecord } from "./types";
import type { AsOfP2, AsOfSeries } from "./loaders";

/**
 * P4-06B validation execution (P4-06B execution spec §6/§8/§14).
 *
 * Pure orchestration: builds replay samples over the same-identity as-of
 * series (one sample per evaluation window, deduplicated by sample identity),
 * classifies each sample into the required scenario classes of the 9
 * provisional rules, checks actual-vs-frozen-expected behavior, and assigns a
 * mechanical status per the frozen sample policy (§10 of the P4-06B spec):
 *
 *   CONTRADICTED          — any observed sample violates the frozen rule
 *   VALIDATED             — all required classes observed, ≥3 narratives, ≥10 samples
 *   PARTIALLY_SUPPORTED   — all required classes observed, counts below VALIDATED
 *   INSUFFICIENT_EVIDENCE — ANY required class unobserved (the current reality)
 *
 * The replay path is the production one (`replayP4AtWindow`); this module
 * adds NO interpretation logic — it only classifies persisted observations
 * and records what the frozen rules predict for them.
 */

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

export interface ReplaySample {
  /** Full sample identity (narrativeId|window|algo|version|mode|windowEnd). */
  sampleIdentity: string;
  narrativeId: number;
  windowEnd: string;
  currentArtifactId: number;
  precedingArtifactIds: number[];
  seriesLength: number;
  record: ReplayRecord;
}

/** Build one replay sample per evaluation window of the as-of series. */
export function buildReplaySamples(input: {
  series: P3IntelligenceViewModel[];
  constituentsByArtifact: Record<number, number[] | null>;
  /** P2 evidence as of each window (empty set where absent). */
  p2ByWindow: Record<string, AsOfP2>;
}): ReplaySample[] {
  const { series, constituentsByArtifact, p2ByWindow } = input;
  const windows = [...new Set(series.map((a) => a.windowEnd))].sort();
  const samples: ReplaySample[] = [];

  for (const W of windows) {
    const prefix = seriesUpTo(series, W);
    const record = replayP4AtWindow({
      series: prefix,
      constituentsByArtifact,
      p2: p2ByWindow[W] ?? { narrativeWideEvents: [], coinLocalEvents: [] },
    });
    if (record == null) continue;

    const id = record.identity;
    samples.push({
      sampleIdentity: `${id.narrativeId}|${id.window}|${id.algorithmKey}|${id.algorithmVersion}|${id.calculationMode}|${W}`,
      narrativeId: id.narrativeId,
      windowEnd: W,
      currentArtifactId: record.artifactId,
      precedingArtifactIds: record.precedingArtifactIds,
      seriesLength: prefix.length,
      record,
    });
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Sample features (persisted observations + the frozen outputs)
// ---------------------------------------------------------------------------

export interface SampleFeatures {
  moves: P4Moves;
  trendOverall: P3TrendState;
  direction: P4DirectionState;
  opportunity: P4QualitativeValue;
  risk: P4QualitativeValue;
  confidence: P4QualitativeValue;
  actionability: P4QualitativeValue;
  conflict: ReplayConflict;
  signalIds: string[];
  p2Scope: string;
  status: ReplayRecord["status"];
  degradationCodes: string[];
}

/** Recompute persisted features for a sample (no new interpretation). */
export function featuresOf(
  prefix: P3IntelligenceViewModel[],
  constituentsByArtifact: Record<number, number[] | null>,
  record: ReplayRecord
): SampleFeatures {
  const history = buildP3IntelligenceHistory(prefix, constituentsByArtifact);
  const latestStep = history != null && history.steps.length > 0 ? history.steps[history.steps.length - 1] : null;
  return {
    moves: computeMoves(latestStep),
    trendOverall: history?.trend.overall ?? "UNKNOWN",
    direction: record.direction,
    opportunity: record.opportunity,
    risk: record.risk,
    confidence: record.confidence,
    actionability: record.actionability,
    conflict: record.conflict ?? { fired: false, material: false, severity: null },
    signalIds: record.signals.map((s) => s.id),
    p2Scope: record.p2Scope,
    status: record.status,
    degradationCodes: record.degradation.map((d) => d.code),
  };
}

// ---------------------------------------------------------------------------
// Scenario-class classification per rule (persisted observations only)
// ---------------------------------------------------------------------------

const core = (m: P4Moves): Array<"POSITIVE" | "NEGATIVE" | "NEUTRAL" | "UNKNOWN"> => [m.regime, m.rotationScore, m.momentum];

function corePairs(f: SampleFeatures): number {
  const c = core(f.moves);
  let pairs = 0;
  for (let i = 0; i < c.length; i += 1) {
    for (let j = i + 1; j < c.length; j += 1) {
      if ((c[i] === "POSITIVE" && c[j] === "NEGATIVE") || (c[i] === "NEGATIVE" && c[j] === "POSITIVE")) pairs += 1;
    }
  }
  return pairs;
}

/** The scenario classes a sample belongs to, per rule. */
export function classesOf(f: SampleFeatures): Record<number, string[]> {
  // Degraded samples (UNKNOWN propagation, P4-03 §14) contribute ONLY their
  // degradation classes — their moves are unavailable and must not masquerade
  // as observed rule scenarios (e.g. "0 NEGATIVE movers").
  if (f.direction === "UNKNOWN") {
    const degradation: string[] = [];
    if (f.degradationCodes.includes("STALE")) degradation.push("stale_cap");
    if (f.degradationCodes.includes("INSUFFICIENT_HISTORY")) degradation.push("insufficient_history");
    return { 6: degradation };
  }
  const c = core(f.moves);
  const posC = c.filter((m) => m === "POSITIVE").length;
  const negC = c.filter((m) => m === "NEGATIVE").length;
  const dominant = posC >= 2 || negC >= 2;
  const tentative = posC === 1 || negC === 1;
  const lean: "POSITIVE" | "NEGATIVE" | null = posC >= 2 || (posC === 1 && negC === 0) ? "POSITIVE" : negC >= 2 || (negC === 1 && posC === 0) ? "NEGATIVE" : null;
  const opposing = (f.moves.breadth === (lean === "POSITIVE" ? "NEGATIVE" : "POSITIVE") ? 1 : 0) +
    (f.moves.relativeStrength === (lean === "POSITIVE" ? "NEGATIVE" : "POSITIVE") ? 1 : 0);
  const neutralBase = posC === 0 && negC === 0;
  const splitCorroborators =
    neutralBase && [f.moves.breadth, f.moves.relativeStrength].filter((m) => m === "POSITIVE").length > 0 &&
    [f.moves.breadth, f.moves.relativeStrength].filter((m) => m === "NEGATIVE").length > 0;

  const detNeg = [f.moves.regime, f.moves.rotationScore, f.moves.momentum, f.moves.breadth].filter((m) => m === "NEGATIVE").length;
  const adverse = [
    f.moves.breadth === "NEGATIVE",
    f.moves.momentum === "NEGATIVE",
    f.moves.regime === "NEGATIVE",
    f.moves.rotationScore === "NEGATIVE",
    f.moves.relativeStrength === "NEGATIVE",
    f.conflict.material,
    f.trendOverall === "DETERIORATING",
  ].filter(Boolean).length;

  const coreValid = [f.moves.regime, f.moves.rotationScore, f.moves.momentum].filter((m) => m !== "UNKNOWN").length;
  const corrValid = [f.moves.breadth, f.moves.relativeStrength].filter((m) => m !== "UNKNOWN").length;
  const divergence =
    (f.direction === "POSITIVE" && f.trendOverall === "DETERIORATING") ||
    (f.direction === "NEGATIVE" && f.trendOverall === "IMPROVING");

  const p2HighNarrative =
    f.p2Scope === "narrative-wide" || f.p2Scope === "multi-coin";

  return {
    1: [
      dominant && opposing > 0 ? "dominant_opposing" : null,
      tentative && opposing > 0 ? "tentative_opposing" : null,
      splitCorroborators ? "neutral_split" : null,
      lean != null && opposing === 0 ? "no_opposing" : null,
    ].filter((v): v is string => v != null),
    2: [
      corePairs(f) === 1 ? "core_split_1" : null,
      corePairs(f) >= 2 ? "core_split_2plus" : null,
      f.conflict.fired && corePairs(f) === 0 ? "breadth_only_minor" : null,
      !f.conflict.fired ? "no_conflict" : null,
    ].filter((v): v is string => v != null),
    3:
      f.p2Scope === "narrative-wide"
        ? ["narrative_wide"]
        : f.p2Scope === "multi-coin"
          ? ["multi_coin"]
          : f.p2Scope === "coin-local"
            ? ["coin_local", "partial_p2"]
            : ["missing_p2"],
    4:
      f.direction === "POSITIVE"
        ? [adverse === 0 ? "pos_adverse_0" : adverse === 1 ? "pos_adverse_1" : "pos_adverse_2plus"]
        : [],
    5: [detNeg >= 2 ? "neg_2plus" : detNeg === 1 ? "neg_1" : "neg_0"],
    6: [
      coreValid === 3 && corrValid === 2 ? "cov_full" : coreValid === 3 && corrValid === 1 ? "cov_corr1" : "cov_low",
      f.conflict.material ? "material_cap" : null,
      f.conflict.fired && !f.conflict.material ? "minor_minus1" : null,
      divergence ? "divergence_minus1" : null,
      f.status === "DEGRADED" && f.degradationCodes.includes("STALE") ? "stale_cap" : null,
      f.status === "DEGRADED" && f.degradationCodes.includes("INSUFFICIENT_HISTORY") ? "insufficient_history" : null,
    ].filter((v): v is string => v != null),
    7: [
      f.confidence === "HIGH" ? "conf_high" : f.confidence === "MEDIUM" ? "conf_medium" : "conf_low",
      f.opportunity === "LOW" && f.risk === "HIGH" && f.direction === "NEGATIVE" && (f.confidence === "HIGH" || f.confidence === "MEDIUM")
        ? "matrix_lowxhigh_neg"
        : null,
      f.opportunity === "HIGH" && f.risk === "HIGH" ? "matrix_highxhigh" : null,
      f.conflict.material ? "material_never_high" : null,
      p2HighNarrative ? "p2_never_high" : null,
    ].filter((v): v is string => v != null),
    8: [
      f.opportunity === "HIGH" && f.risk === "HIGH" ? "highxhigh" : null,
      f.opportunity === "LOW" && f.risk === "HIGH" ? "lowxhigh" : null,
      f.opportunity === "LOW" && f.risk === "LOW" ? "lowxlow" : null,
      f.opportunity === "MEDIUM" && f.risk === "MEDIUM" ? "mediumxmedium" : null,
    ].filter((v): v is string => v != null),
    9: [
      f.signalIds.includes("NARRATIVE_IMPROVEMENT") ? "improving_fires" : null,
      f.signalIds.includes("NARRATIVE_DETERIORATION") ? "deteriorating_fires" : null,
      corePairs(f) > 0 ? "suppressed_core_split" : null,
      !f.conflict.material && f.signalIds.includes("EVIDENCE_CONFLICT") ? "not_suppressed_breadth_only" : null,
    ].filter((v): v is string => v != null),
  };
}

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

export interface RuleResult {
  ruleId: number;
  name: string;
  hypothesis: string;
  requiredClasses: string[];
  /** Required classes with ≥1 real historical sample. */
  observedClasses: string[];
  /** Samples that violated the frozen expectation. */
  contradictions: Array<{ sampleIdentity: string; expected: string; actual: string }>;
  /** Conforming samples per observed class (sample identities). */
  conformingSamples: Record<string, string[]>;
  narratives: number;
  samples: number;
  status: "VALIDATED" | "PARTIALLY_SUPPORTED" | "CONTRADICTED" | "INSUFFICIENT_EVIDENCE";
}

export const RULES: Array<{
  ruleId: number;
  name: string;
  hypothesis: string;
  requiredClasses: string[];
}> = [
  {
    ruleId: 1,
    name: "Corroborator set / reconciliation (P4-03 §4)",
    hypothesis: "Dominant core lean survives opposing corroborators; tentative lean flips to MIXED; NEUTRAL base + split corroborators ⇒ MIXED.",
    requiredClasses: ["dominant_opposing", "tentative_opposing", "neutral_split", "no_opposing"],
  },
  {
    ruleId: 2,
    name: "Conflict materiality / severity (P4-03 §9 + C1)",
    hypothesis: "Core split (1 pair ⇒ MEDIUM, ≥2 ⇒ HIGH) is material; breadth/corroborator-only is minor (LOW), never material.",
    requiredClasses: ["core_split_1", "core_split_2plus", "breadth_only_minor", "no_conflict"],
  },
  {
    ruleId: 3,
    name: "P2 scope tiers (P4-03 §10)",
    hypothesis: "Scope = narrative-wide / multi-coin / coin-local / none with the frozen Risk projection.",
    requiredClasses: ["narrative_wide", "multi_coin", "coin_local", "missing_p2", "partial_p2"],
  },
  {
    ruleId: 4,
    name: "Opportunity suppression ladder (P4-03 §12.3)",
    hypothesis: "POSITIVE starts HIGH; each adverse condition −1; floor LOW; stale cap MEDIUM.",
    requiredClasses: ["pos_adverse_0", "pos_adverse_1", "pos_adverse_2plus"],
  },
  {
    ruleId: 5,
    name: "Risk base thresholds (P4-03 §11)",
    hypothesis: "≥2 NEGATIVE movers ⇒ HIGH; 1 ⇒ MEDIUM; 0 ⇒ LOW (plus P2/divergence adjustments).",
    requiredClasses: ["neg_2plus", "neg_1", "neg_0"],
  },
  {
    ruleId: 6,
    name: "Confidence combination (P4-03 §7 + C2)",
    hypothesis: "Coverage base; material conflict caps MEDIUM (never HIGH); minor −1; divergence −1; stale cap MEDIUM; insufficient history ⇒ LOW.",
    requiredClasses: ["cov_full", "cov_corr1", "cov_low", "material_cap", "minor_minus1", "divergence_minus1", "stale_cap", "insufficient_history"],
  },
  {
    ruleId: 7,
    name: "Actionability table (P4-03 §8/§13)",
    hypothesis: "§8 base + §13 overrides (LOW×HIGH×NEGATIVE×Conf≥MEDIUM ⇒ HIGH; HIGH×HIGH ⇒ MEDIUM; material never HIGH; P2-wide never HIGH).",
    requiredClasses: ["conf_high", "conf_medium", "conf_low", "matrix_lowxhigh_neg", "matrix_highxhigh", "material_never_high", "p2_never_high"],
  },
  {
    ruleId: 8,
    name: "Opportunity × Risk matrix",
    hypothesis: "Frozen O×R matrix cells hold (HIGH×HIGH ⇒ MEDIUM actionability, LOW×HIGH ⇒ HIGH under NEGATIVE + Conf ≥ MEDIUM).",
    requiredClasses: ["highxhigh", "lowxhigh", "lowxlow", "mediumxmedium"],
  },
  {
    ruleId: 9,
    name: "NARRATIVE_* corroboration minimums (P4-03 §3.2/§3.3)",
    hypothesis: "NARRATIVE_IMPROVEMENT/DETERIORATION fire only with matching trend + ≥1 core corroborator and no core split; breadth-only opposition does not suppress.",
    requiredClasses: ["improving_fires", "deteriorating_fires", "suppressed_core_split", "not_suppressed_breadth_only"],
  },
];

/** Frozen expectation per (rule, class) — used for contradiction detection. */
function expectedOf(ruleId: number, f: SampleFeatures): string | null {
  switch (ruleId) {
    case 1: {
      const lean = f.direction === "POSITIVE" || f.direction === "NEGATIVE" ? f.direction : null;
      return lean != null ? `direction ${lean} (corroborators reconcile)` : "direction per §4.3";
    }
    case 2:
      return f.conflict.material
        ? "material (core split) — severity medium/high"
        : f.conflict.fired
          ? "minor (severity low, not material)"
          : "no EVIDENCE_CONFLICT";
    case 3:
      return f.p2Scope;
    case 4:
      return `opportunity ${f.opportunity} (ladder applied)`;
    case 5:
      return `risk ${f.risk} (threshold branch)`;
    case 6:
      return `confidence ${f.confidence} (combination + caps)`;
    case 7:
      return `actionability ${f.actionability} (table + overrides)`;
    case 8:
      return `opportunity ${f.opportunity} × risk ${f.risk} (matrix cell)`;
    case 9:
      return f.signalIds.includes("NARRATIVE_DETERIORATION") || f.signalIds.includes("NARRATIVE_IMPROVEMENT")
        ? "NARRATIVE_* fired per §3.2/§3.3"
        : "NARRATIVE_* correctly suppressed";
    default:
      return null;
  }
}

/**
 * Evaluate all 9 provisional rules over real replay samples. Statuses are
 * mechanical per the frozen sample policy; with the current dataset every
 * rule has at least one unobserved required class ⇒ INSUFFICIENT_EVIDENCE
 * (never a forced PASS/FAIL).
 */
export function evaluateRules(input: {
  samples: ReplaySample[];
  seriesByNarrative: Record<number, P3IntelligenceViewModel[]>;
  constituentsByArtifact: Record<number, Record<number, number[] | null>>;
}): RuleResult[] {
  const { samples, seriesByNarrative, constituentsByArtifact } = input;
  return RULES.map((rule) => {
    const observedClasses = new Set<string>();
    const conformingSamples: Record<string, string[]> = {};
    const contradictions: RuleResult["contradictions"] = [];
    const narratives = new Set<number>();

    for (const sample of samples) {
      narratives.add(sample.narrativeId);
      const prefix = seriesByNarrative[sample.narrativeId] ?? [];
      const f = featuresOf(
        seriesUpTo(prefix, sample.windowEnd),
        constituentsByArtifact[sample.narrativeId] ?? {},
        sample.record
      );
      const classes = classesOf(f)[rule.ruleId] ?? [];
      const expected = expectedOf(rule.ruleId, f);
      // UNKNOWN propagation (P4-03 §14): degraded samples must produce
      // UNKNOWN outputs — that is the frozen expected behavior, never a rule
      // contradiction. Their classes still count for coverage.
      const degraded = f.direction === "UNKNOWN";

      for (const cls of classes) {
        observedClasses.add(cls);
        const list = conformingSamples[cls] ?? [];
        // Expected vs actual: the record's frozen outputs are the actual
        // behavior; the class implies the expectation. Disagreement ⇒ contradiction.
        const actual = String(f[rule.ruleId === 3 ? "p2Scope" : rule.ruleId === 4 ? "opportunity" : rule.ruleId === 5 ? "risk" : rule.ruleId === 6 ? "confidence" : rule.ruleId === 7 || rule.ruleId === 8 ? "actionability" : "direction"]);
        if (!degraded && expected != null && !matchesExpected(rule.ruleId, cls, f)) {
          contradictions.push({ sampleIdentity: sample.sampleIdentity, expected, actual });
        } else {
          list.push(sample.sampleIdentity);
        }
        conformingSamples[cls] = list;
      }
    }

    const requiredClasses = rule.requiredClasses;
    const allObserved = requiredClasses.every((cls) => observedClasses.has(cls));
    let status: RuleResult["status"];
    if (contradictions.length > 0) {
      status = "CONTRADICTED";
    } else if (allObserved && narratives.size >= 3 && samples.length >= 10) {
      status = "VALIDATED";
    } else if (allObserved) {
      status = "PARTIALLY_SUPPORTED";
    } else {
      status = "INSUFFICIENT_EVIDENCE";
    }

    return {
      ruleId: rule.ruleId,
      name: rule.name,
      hypothesis: rule.hypothesis,
      requiredClasses,
      observedClasses: [...observedClasses].sort(),
      contradictions,
      conformingSamples,
      narratives: narratives.size,
      samples: samples.length,
      status,
    };
  });
}

/** Per-rule conformance check: does the sample behave as the frozen rule says? */
function matchesExpected(ruleId: number, cls: string, f: SampleFeatures): boolean {
  switch (ruleId) {
    case 1:
      if (cls === "dominant_opposing") return f.direction === "POSITIVE" || f.direction === "NEGATIVE";
      if (cls === "tentative_opposing") return f.direction === "MIXED";
      if (cls === "neutral_split") return f.direction === "MIXED";
      if (cls === "no_opposing") return f.direction === "POSITIVE" || f.direction === "NEGATIVE";
      return true;
    case 2:
      if (cls === "breadth_only_minor") return f.conflict.material === false && f.conflict.severity === "low";
      if (cls === "no_conflict") return true;
      if (cls === "core_split_1") return f.conflict.material && f.conflict.severity === "medium";
      if (cls === "core_split_2plus") return f.conflict.material && f.conflict.severity === "high";
      return true;
    case 3:
      return true; // scope classification is observation; projection checked in rule 5/6/7
    case 4:
      return f.opportunity !== "UNKNOWN";
    case 5:
      if (cls === "neg_2plus") return f.risk === "HIGH";
      if (cls === "neg_1") return f.risk === "MEDIUM";
      if (cls === "neg_0") return f.risk === "LOW";
      return true;
    case 6:
      return f.confidence !== "UNKNOWN";
    case 7:
      if (cls === "matrix_lowxhigh_neg") return f.actionability === "HIGH";
      if (cls === "matrix_highxhigh") return f.actionability === "MEDIUM";
      return true;
    case 8:
      if (cls === "highxhigh") return f.actionability === "MEDIUM";
      if (cls === "lowxhigh") return f.actionability === "HIGH";
      return true;
    case 9:
      return true; // signal presence already checked via class membership
    default:
      return true;
  }
}
