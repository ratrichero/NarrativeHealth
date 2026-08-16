import { describe, expect, it } from "@jest/globals";
import type { P3TrendState, P3TrendStep } from "@/lib/types/p3-intelligence-history";
import type { P3IntelligenceViewModel } from "@/lib/types/p3-intelligence";
import { interpretP4 } from "../interpretation";
import type { P4InterpretationResult } from "../types";
import type { P4Assembly } from "../assembler";
import {
  makeAssembly,
  makeDefaultCurrent,
  makeHistory,
  makeP2,
  makeStep,
  makeVm,
} from "./fixtures";

/**
 * P4-05A interpretation tests — the frozen P4-03 canonical §16 scenarios
 * (S1–S12), the §4.3 decision table, §5 MIXED/NEUTRAL/UNKNOWN separation,
 * degradation gates (§14), signal detection (§3) and P2 projection (§10/§11).
 *
 * Where the P4-03 prose and its canonical scenarios conflicted, the frozen
 * P4-05A SEMANTIC RESOLUTION (P4-03 §21 / Master §19B) governs:
 *  - C1: breadth-vs-core conflicts are MINOR (material = core split only).
 *  - C2: a material conflict caps Confidence at MEDIUM (never HIGH).
 *  - C3: Scenario 3 Confidence = HIGH (RS STABLE is not a §3.9 conflict).
 *  - C4: Scenario 2 includes EVIDENCE_CONFLICT; Scenario 4 includes
 *    NARROWING (deterministic §3 rules; scenario lists completed).
 */

function stepWith(
  previous: P3IntelligenceViewModel,
  current: P3IntelligenceViewModel,
  states: {
    regime?: P3TrendState;
    rotationScore?: P3TrendState;
    momentum?: P3TrendState;
    breadth?: P3TrendState;
    relativeStrength?: P3TrendState;
    leadership?: P3TrendState;
    leaderChanged?: boolean;
  }
): P3TrendStep {
  return makeStep({ previous, current, ...states });
}

/** Build a full assembly for a latest-step spec + trend overall. */
function assemblyFor(opts: {
  step?: P3TrendStep;
  trendOverall?: P3TrendState;
  seriesLength?: number;
  p2?: ReturnType<typeof makeP2>;
  current?: P3IntelligenceViewModel;
}): P4Assembly {
  const history = makeHistory({
    seriesLength: opts.seriesLength ?? 3,
    trendOverall: opts.trendOverall ?? "IMPROVING",
    step: opts.step,
  });
  const result = makeAssembly({
    history,
    p2: opts.p2,
    // Identity-consistent current: the latest artifact of the same series.
    current: opts.current !== undefined ? opts.current : (history.current ?? makeDefaultCurrent()),
  });
  if (!result.ok) throw new Error(`fixture assembly failed: ${result.detail}`);
  return result.assembly;
}

function resultFor(opts: {
  step?: P3TrendStep;
  trendOverall?: P3TrendState;
  seriesLength?: number;
  p2?: ReturnType<typeof makeP2>;
  current?: P3IntelligenceViewModel;
}): P4InterpretationResult {
  return interpretP4(assemblyFor(opts));
}

const PREV = makeVm({ artifactId: 101, windowEnd: "2026-08-10T00:00:00.000Z" });
const CURR = makeVm({ artifactId: 102, windowEnd: "2026-08-11T00:00:00.000Z" });

const signalIds = (result: P4InterpretationResult) => result.signals.map((signal) => signal.id);

describe("P4-03 §16 canonical scenarios", () => {
  it("S1 — strong and broad: POSITIVE / HIGH / LOW / HIGH / HIGH", () => {
    const result = resultFor({
      step: stepWith(PREV, CURR, {
        regime: "IMPROVING",
        rotationScore: "IMPROVING",
        momentum: "IMPROVING",
        breadth: "IMPROVING",
        relativeStrength: "STABLE",
      }),
      trendOverall: "IMPROVING",
    });

    expect(result.status).toBe("AVAILABLE");
    expect(result.direction).toBe("POSITIVE");
    expect(result.opportunity).toBe("HIGH");
    expect(result.risk).toBe("LOW");
    expect(result.confidence).toBe("HIGH");
    expect(result.actionability).toBe("HIGH");

    expect(signalIds(result)).toEqual(
      expect.arrayContaining(["NARRATIVE_IMPROVEMENT", "REGIME_CHANGE", "ROTATION_CHANGE", "BROADENING"])
    );
    expect(signalIds(result)).not.toContain("NARROWING");
    expect(signalIds(result)).not.toContain("EVIDENCE_CONFLICT");
  });

  it("S2 — strong but concentrated: POSITIVE / MEDIUM / MEDIUM / MEDIUM / MEDIUM", () => {
    const result = resultFor({
      step: stepWith(PREV, CURR, {
        regime: "IMPROVING",
        rotationScore: "IMPROVING",
        momentum: "IMPROVING",
        breadth: "DETERIORATING",
        relativeStrength: "STABLE",
      }),
      trendOverall: "IMPROVING",
    });

    expect(result.direction).toBe("POSITIVE");
    expect(result.opportunity).toBe("MEDIUM");
    expect(result.risk).toBe("MEDIUM");
    expect(result.confidence).toBe("MEDIUM");
    expect(result.actionability).toBe("MEDIUM");

    expect(signalIds(result)).toEqual(
      expect.arrayContaining(["NARRATIVE_IMPROVEMENT", "NARROWING"])
    );
    // §3.9 + P4-05A RESOLUTION C1/C4: momentum POSITIVE vs breadth NEGATIVE
    // fires EVIDENCE_CONFLICT (minor — breadth-vs-core is not a core split).
    expect(signalIds(result)).toContain("EVIDENCE_CONFLICT");
    expect(result.signals.find((s) => s.id === "EVIDENCE_CONFLICT")?.severity).toBe("low");
  });

  it("S3 — clear deterioration: NEGATIVE / LOW / HIGH / actionability HIGH", () => {
    const result = resultFor({
      step: stepWith(PREV, CURR, {
        regime: "DETERIORATING",
        rotationScore: "DETERIORATING",
        momentum: "DETERIORATING",
        breadth: "DETERIORATING",
        relativeStrength: "STABLE",
      }),
      trendOverall: "DETERIORATING",
    });

    expect(result.direction).toBe("NEGATIVE");
    expect(result.opportunity).toBe("LOW");
    expect(result.risk).toBe("HIGH");
    expect(result.actionability).toBe("HIGH");
    // P4-05A RESOLUTION C3: RS STABLE is not a §3.9 conflict (no opposing
    // sign), so Confidence is HIGH; the old scenario parenthetical was
    // superseded.
    expect(result.confidence).toBe("HIGH");
    expect(signalIds(result)).toEqual(
      expect.arrayContaining(["NARRATIVE_DETERIORATION", "REGIME_CHANGE", "NARROWING"])
    );
  });

  it("S4 — weakening with still-positive RS: NEGATIVE / LOW / HIGH / MEDIUM / HIGH", () => {
    const result = resultFor({
      step: stepWith(PREV, CURR, {
        regime: "STABLE",
        rotationScore: "DETERIORATING",
        momentum: "DETERIORATING",
        breadth: "DETERIORATING",
        relativeStrength: "IMPROVING",
      }),
      trendOverall: "DETERIORATING",
    });

    expect(result.direction).toBe("NEGATIVE");
    expect(result.opportunity).toBe("LOW");
    expect(result.risk).toBe("HIGH");
    expect(result.confidence).toBe("MEDIUM");
    expect(result.actionability).toBe("HIGH");

    expect(signalIds(result)).toEqual(
      expect.arrayContaining(["NARRATIVE_DETERIORATION", "EVIDENCE_CONFLICT"])
    );
    // §3.5 + P4-05A RESOLUTION C4: breadthMove NEGATIVE fires NARROWING;
    // the scenario's signal list was completed.
    expect(signalIds(result)).toContain("NARROWING");
    expect(result.signals.find((s) => s.id === "EVIDENCE_CONFLICT")?.severity).toBe("low");
  });

  it("S5 — neutral regime with mixed metrics: MIXED / LOW / MEDIUM / MEDIUM / MEDIUM", () => {
    const result = resultFor({
      step: stepWith(PREV, CURR, {
        regime: "STABLE",
        rotationScore: "STABLE",
        momentum: "IMPROVING",
        breadth: "DETERIORATING",
        relativeStrength: "STABLE",
      }),
      trendOverall: "UNKNOWN",
    });

    expect(result.direction).toBe("MIXED");
    expect(result.opportunity).toBe("LOW");
    expect(result.risk).toBe("MEDIUM");
    expect(result.confidence).toBe("MEDIUM");
    expect(result.actionability).toBe("MEDIUM");

    expect(signalIds(result)).toEqual(
      expect.arrayContaining(["EVIDENCE_CONFLICT", "NARROWING"])
    );
    expect(result.signals.find((s) => s.id === "EVIDENCE_CONFLICT")?.severity).toBe("low");
  });

  it("S6 — true MIXED: core split ⇒ material conflict, MEDIUM confidence", () => {
    const result = resultFor({
      step: stepWith(PREV, CURR, {
        regime: "STABLE",
        rotationScore: "DETERIORATING",
        momentum: "IMPROVING",
        breadth: "IMPROVING",
        relativeStrength: "IMPROVING",
      }),
      trendOverall: "UNKNOWN",
    });

    expect(result.direction).toBe("MIXED");
    expect(result.opportunity).toBe("LOW");
    expect(result.risk).toBe("MEDIUM");
    expect(result.confidence).toBe("MEDIUM");
    expect(result.actionability).toBe("MEDIUM");

    expect(signalIds(result)).toEqual(
      expect.arrayContaining(["EVIDENCE_CONFLICT", "ROTATION_CHANGE"])
    );
    expect(result.signals.find((s) => s.id === "EVIDENCE_CONFLICT")?.severity).toBe("medium");
  });

  it("S7 — insufficient history: UNKNOWN / UNKNOWN / UNKNOWN / LOW / UNKNOWN (DEGRADED)", () => {
    // A single artifact has no latest step by construction (P3-18 series).
    const result = resultFor({
      trendOverall: "UNKNOWN",
      seriesLength: 1,
    });

    expect(result.status).toBe("DEGRADED");
    expect(result.degradation).toEqual([{ code: "INSUFFICIENT_HISTORY" }]);
    expect(result.direction).toBe("UNKNOWN");
    expect(result.opportunity).toBe("UNKNOWN");
    expect(result.risk).toBe("UNKNOWN");
    expect(result.confidence).toBe("LOW");
    expect(result.actionability).toBe("UNKNOWN");
    expect(result.signals).toEqual([]);
  });

  it("S8 — stale current: determinable with caps", () => {
    const staleCurrent: P3IntelligenceViewModel = { ...CURR, availabilityState: "STALE" };
    const result = resultFor({
      step: stepWith(PREV, CURR, {
        regime: "IMPROVING",
        rotationScore: "IMPROVING",
        momentum: "IMPROVING",
        breadth: "IMPROVING",
        relativeStrength: "STABLE",
      }),
      trendOverall: "IMPROVING",
      current: staleCurrent,
    });

    expect(result.status).toBe("DEGRADED");
    expect(result.degradation).toEqual([{ code: "STALE" }]);
    expect(result.direction).toBe("POSITIVE");
    expect(result.opportunity).toBe("MEDIUM");
    expect(result.confidence).toBe("MEDIUM");
  });

  it("S9 — coin-local P2 event: no narrative-level change", () => {
    const result = resultFor({
      step: stepWith(PREV, CURR, {
        regime: "IMPROVING",
        rotationScore: "IMPROVING",
        momentum: "IMPROVING",
        breadth: "IMPROVING",
        relativeStrength: "STABLE",
      }),
      trendOverall: "IMPROVING",
      p2: makeP2({
        coinLocal: [{ title: "Token unlock", coinId: 1, riskLevel: "HIGH", symbol: "BTC" }],
      }),
    });

    expect(result.direction).toBe("POSITIVE");
    expect(result.opportunity).toBe("HIGH");
    expect(result.risk).toBe("LOW");
    expect(result.confidence).toBe("HIGH");
    expect(result.actionability).toBe("HIGH");
    expect(signalIds(result)).toContain("NARRATIVE_IMPROVEMENT");
  });

  it("S10 — narrative-wide P2 event: Risk +1 tier, Opportunity/actionability capped", () => {
    const result = resultFor({
      step: stepWith(PREV, CURR, {
        regime: "IMPROVING",
        rotationScore: "IMPROVING",
        momentum: "IMPROVING",
        breadth: "IMPROVING",
        relativeStrength: "STABLE",
      }),
      trendOverall: "IMPROVING",
      p2: makeP2({
        narrativeWide: [{ title: "Regulatory filing", narrativeId: 1, riskLevel: "HIGH" }],
      }),
    });

    expect(result.direction).toBe("POSITIVE");
    expect(result.opportunity).toBe("MEDIUM");
    expect(result.risk).toBe("MEDIUM");
    expect(result.confidence).toBe("HIGH");
    expect(result.actionability).toBe("MEDIUM");

    const p2Refs = result.evidence.filter((ref) => ref.sourceLayer === "P2");
    expect(p2Refs.length).toBe(1);
    expect(p2Refs[0].sourceType).toBe("P2_EVENT_RISK");
    expect(p2Refs[0].artifactIdentity).toBeNull();
  });

  it("S11 — current positive + historical deterioration: MEDIUM confidence/opportunity/risk", () => {
    const result = resultFor({
      step: stepWith(PREV, CURR, {
        regime: "IMPROVING",
        rotationScore: "IMPROVING",
        momentum: "IMPROVING",
        breadth: "STABLE",
        relativeStrength: "STABLE",
      }),
      trendOverall: "DETERIORATING",
    });

    expect(result.direction).toBe("POSITIVE");
    expect(result.confidence).toBe("MEDIUM");
    expect(result.opportunity).toBe("MEDIUM");
    expect(result.risk).toBe("MEDIUM");
    expect(result.actionability).toBe("MEDIUM");
  });

  it("S12 — current negative + historical improvement: NEGATIVE / HIGH risk / HIGH actionability", () => {
    const result = resultFor({
      step: stepWith(PREV, CURR, {
        regime: "DETERIORATING",
        rotationScore: "DETERIORATING",
        momentum: "DETERIORATING",
        breadth: "STABLE",
        relativeStrength: "STABLE",
      }),
      trendOverall: "IMPROVING",
    });

    expect(result.direction).toBe("NEGATIVE");
    expect(result.risk).toBe("HIGH");
    expect(result.opportunity).toBe("LOW");
    expect(result.confidence).toBe("MEDIUM");
    expect(result.actionability).toBe("HIGH");
  });
});

describe("P4-03 §4.3 direction decision table", () => {
  const directions: Array<{
    name: string;
    states: Parameters<typeof stepWith>[2];
    expected: P4InterpretationResult["direction"];
  }> = [
    { name: "NEU/UNK/POS + POS/NEG → MIXED", states: { regime: "STABLE", rotationScore: "UNKNOWN", momentum: "IMPROVING", breadth: "IMPROVING", relativeStrength: "DETERIORATING" }, expected: "MIXED" },
    { name: "NEG/UNK/NEG + UNK/POS → NEGATIVE", states: { regime: "DETERIORATING", rotationScore: "UNKNOWN", momentum: "DETERIORATING", breadth: "UNKNOWN", relativeStrength: "IMPROVING" }, expected: "NEGATIVE" },
    { name: "all NEUTRAL → NEUTRAL", states: { regime: "STABLE", rotationScore: "STABLE", momentum: "STABLE", breadth: "STABLE", relativeStrength: "STABLE" }, expected: "NEUTRAL" },
    { name: "core all UNKNOWN → UNKNOWN", states: { regime: "UNKNOWN", rotationScore: "UNKNOWN", momentum: "UNKNOWN", breadth: "IMPROVING", relativeStrength: "IMPROVING" }, expected: "UNKNOWN" },
    { name: "POS/POS/NEU + NEU/NEG → POSITIVE", states: { regime: "IMPROVING", rotationScore: "IMPROVING", momentum: "STABLE", breadth: "STABLE", relativeStrength: "DETERIORATING" }, expected: "POSITIVE" },
    { name: "NEG/NEG/NEU + POS/UNK → NEGATIVE", states: { regime: "DETERIORATING", rotationScore: "DETERIORATING", momentum: "STABLE", breadth: "IMPROVING", relativeStrength: "UNKNOWN" }, expected: "NEGATIVE" },
    { name: "POS/NEG/NEU → MIXED", states: { regime: "IMPROVING", rotationScore: "DETERIORATING", momentum: "STABLE", breadth: "UNKNOWN", relativeStrength: "UNKNOWN" }, expected: "MIXED" },
    { name: "NEU/NEU/UNK + split corroborators → MIXED", states: { regime: "STABLE", rotationScore: "STABLE", momentum: "UNKNOWN", breadth: "IMPROVING", relativeStrength: "DETERIORATING" }, expected: "MIXED" },
    { name: "NEG/UNK/UNK + RS POS → UNKNOWN", states: { regime: "DETERIORATING", rotationScore: "UNKNOWN", momentum: "UNKNOWN", breadth: "UNKNOWN", relativeStrength: "IMPROVING" }, expected: "UNKNOWN" },
  ];

  for (const row of directions) {
    it(`row — ${row.name}`, () => {
      const result = resultFor({ step: stepWith(PREV, CURR, row.states), trendOverall: "UNKNOWN" });
      expect(result.direction).toBe(row.expected);
    });
  }

  it("UNKNOWN gates take precedence over MIXED/lean (P4-03 §4.2)", () => {
    const result = resultFor({
      step: stepWith(PREV, CURR, {
        regime: "UNKNOWN",
        rotationScore: "UNKNOWN",
        momentum: "IMPROVING",
        breadth: "DETERIORATING",
        relativeStrength: "IMPROVING",
      }),
      trendOverall: "UNKNOWN",
    });
    expect(result.direction).toBe("UNKNOWN");
    expect(result.degradation).toEqual([{ code: "CRITICAL_EVIDENCE_MISSING" }]);
    expect(result.confidence).toBe("LOW");
    expect(result.opportunity).toBe("UNKNOWN");
    expect(result.risk).toBe("UNKNOWN");
    expect(result.actionability).toBe("UNKNOWN");
  });
});

describe("P4-03 §3 signal detection", () => {
  it("NARRATIVE_* are mutually exclusive (single frozen trend)", () => {
    const improving = resultFor({
      step: stepWith(PREV, CURR, { regime: "IMPROVING", momentum: "IMPROVING" }),
      trendOverall: "IMPROVING",
    });
    expect(signalIds(improving)).toContain("NARRATIVE_IMPROVEMENT");
    expect(signalIds(improving)).not.toContain("NARRATIVE_DETERIORATION");

    const deteriorating = resultFor({
      step: stepWith(PREV, CURR, { regime: "DETERIORATING", momentum: "DETERIORATING" }),
      trendOverall: "DETERIORATING",
    });
    expect(signalIds(deteriorating)).toContain("NARRATIVE_DETERIORATION");
    expect(signalIds(deteriorating)).not.toContain("NARRATIVE_IMPROVEMENT");
  });

  it("NARRATIVE_IMPROVEMENT is suppressed by a core split (material conflict)", () => {
    const result = resultFor({
      step: stepWith(PREV, CURR, {
        regime: "IMPROVING",
        rotationScore: "DETERIORATING",
        momentum: "IMPROVING",
      }),
      trendOverall: "IMPROVING",
    });
    expect(signalIds(result)).not.toContain("NARRATIVE_IMPROVEMENT");
    expect(signalIds(result)).toContain("EVIDENCE_CONFLICT");
  });

  it("REGIME_CHANGE directionRelation follows regimeMove; unranked ⇒ not emitted", () => {
    const improved = resultFor({
      step: stepWith(PREV, CURR, { regime: "IMPROVING" }),
      trendOverall: "UNKNOWN",
    });
    expect(signalIds(improved)).toContain("REGIME_CHANGE");
    expect(improved.signals.find((s) => s.id === "REGIME_CHANGE")?.directionRelation).toBe("POSITIVE");

    const unchanged = resultFor({
      step: stepWith(PREV, CURR, { regime: "STABLE" }),
      trendOverall: "UNKNOWN",
    });
    expect(signalIds(unchanged)).not.toContain("REGIME_CHANGE");
  });

  it("LEADERSHIP_CHANGE fires only when both sides are available", () => {
    const previous = makeVm({ artifactId: 101, windowEnd: "2026-08-10T00:00:00.000Z", leadership: { availabilityState: "VALID", coinId: 1, symbol: "BTC", score: 80, scoreDisplay: "80.00" } });
    const current = makeVm({ artifactId: 102, windowEnd: "2026-08-11T00:00:00.000Z", leadership: { availabilityState: "VALID", coinId: 2, symbol: "ETH", score: 82, scoreDisplay: "82.00" } });
    const result = resultFor({
      step: stepWith(previous, current, { leadership: "TRANSITION", leaderChanged: true }),
      trendOverall: "UNKNOWN",
    });
    expect(signalIds(result)).toContain("LEADERSHIP_CHANGE");
    expect(result.signals.find((s) => s.id === "LEADERSHIP_CHANGE")?.directionRelation).toBe("MIXED");
  });

  it("BROADENING vs NARROWING are mutually exclusive", () => {
    const broadening = resultFor({ step: stepWith(PREV, CURR, { breadth: "IMPROVING" }), trendOverall: "UNKNOWN" });
    expect(signalIds(broadening)).toContain("BROADENING");
    expect(signalIds(broadening)).not.toContain("NARROWING");

    const narrowing = resultFor({ step: stepWith(PREV, CURR, { breadth: "DETERIORATING" }), trendOverall: "UNKNOWN" });
    expect(signalIds(narrowing)).toContain("NARROWING");
    expect(signalIds(narrowing)).not.toContain("BROADENING");
  });

  it("EVIDENCE_CONFLICT severity: ≥2 core pairs ⇒ high", () => {
    const result = resultFor({
      step: stepWith(PREV, CURR, {
        regime: "IMPROVING",
        rotationScore: "IMPROVING",
        momentum: "DETERIORATING",
      }),
      trendOverall: "UNKNOWN",
    });
    const conflict = result.signals.find((s) => s.id === "EVIDENCE_CONFLICT");
    expect(conflict).toBeDefined();
    expect(conflict?.severity).toBe("high");
    expect(conflict?.evidenceKeys.length).toBeGreaterThan(0);
    expect(conflict?.conflictingEvidenceKeys?.length).toBeGreaterThan(0);
  });
});

describe("P4-03 §14 UNKNOWN propagation & identity", () => {
  it("identity ambiguity ⇒ IDENTITY_AMBIGUOUS, all UNKNOWN, Confidence UNKNOWN", () => {
    const current = makeVm({ artifactId: 102, windowEnd: "2026-08-11T00:00:00.000Z", window: "" });
    const history = makeHistory({ seriesLength: 3, window: "" });
    const result = makeAssembly({ current, history });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const interpreted = interpretP4(result.assembly);
    expect(interpreted.status).toBe("DEGRADED");
    expect(interpreted.degradation).toEqual([{ code: "IDENTITY_AMBIGUOUS" }]);
    expect(interpreted.direction).toBe("UNKNOWN");
    expect(interpreted.confidence).toBe("UNKNOWN");
    expect(interpreted.opportunity).toBe("UNKNOWN");
    expect(interpreted.actionability).toBe("UNKNOWN");
  });

  it("P2 multi-coin scope raises structural Risk one tier (LOW → MEDIUM)", () => {
    const result = resultFor({
      step: stepWith(PREV, CURR, {
        regime: "IMPROVING",
        rotationScore: "IMPROVING",
        momentum: "IMPROVING",
        breadth: "IMPROVING",
        relativeStrength: "STABLE",
      }),
      trendOverall: "IMPROVING",
      p2: makeP2({
        coinLocal: [
          { title: "Unlock A", coinId: 1, riskLevel: "HIGH", symbol: "BTC" },
          { title: "Unlock B", coinId: 2, riskLevel: "HIGH", symbol: "ETH" },
        ],
      }),
    });
    expect(result.risk).toBe("MEDIUM");
    expect(result.direction).toBe("POSITIVE");
  });
});

describe("determinism", () => {
  it("identical input ⇒ identical interpretation (deep equal, no timestamps)", () => {
    const assembly = assemblyFor({
      step: stepWith(PREV, CURR, {
        regime: "IMPROVING",
        rotationScore: "IMPROVING",
        momentum: "DETERIORATING",
        breadth: "IMPROVING",
      }),
      trendOverall: "IMPROVING",
    });
    const first = interpretP4(assembly);
    const second = interpretP4(assembly);
    expect(first).toStrictEqual(second);
  });
});
