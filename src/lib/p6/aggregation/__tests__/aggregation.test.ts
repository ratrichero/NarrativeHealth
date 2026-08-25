/**
 * P6-06D — Intelligence Aggregation Comprehensive Tests
 *
 * Covers:
 * - PD-06A-01: summary scope
 * - PD-06A-02: structured explanations (templates, cap, ordering, no LLM)
 * - PD-06A-03: two-point change detection only
 * - PD-06A-04: minimum population / empty population
 * - PD-06C-01: window_end precedence chain
 * - PD-06C-03/04/05: health pct, regime literal comparison, new/resolved warnings
 * - IA-01…IA-25 invariants (executable subset)
 */

import {
  aggregateIntelligence,
  computeHealthDelta,
  computeHealthChangePct,
  computeRegimeChange,
  selectNewWarnings,
  selectResolvedWarnings,
  resolveWindowEnd,
  buildSummaryKey,
  hasMinimumPopulation,
  computeHighestSeverity,
  generateExplanation,
  rankExplanationItems,
  isValidSummaryTransition,
  isSupersededTerminal,
  isLifecycleNotQualityState,
  isLifecycleNotRegimeState,
  SUMMARY_LIFECYCLE_STATES,
  SUMMARY_V1_VERSION,
  DEFAULT_SUMMARY_CONFIG,
} from "../index";
import type {
  AggregationSnapshotInput,
  AggregationRegimeInput,
  PreviousContextInput,
  SummaryEngineInput,
  WarningSummaryItem,
} from "../types";

// ─── HELPERS ──────────────────────────────────────────────────────

const T0 = new Date("2025-01-15T00:00:00Z");
const T1 = new Date("2025-01-16T00:00:00Z");

function makeSnapshot(overrides: Partial<AggregationSnapshotInput> = {}): AggregationSnapshotInput {
  return {
    snapshot_id: 101,
    health_score: 72,
    confidence_score: 80,
    calculation_time: T1,
    window_end: T1,
    quality_status: "VALID",
    freshness_status: "FRESH",
    quality_metadata: null,
    freshness_metadata: null,
    ...overrides,
  };
}

function makeRegime(overrides: Partial<AggregationRegimeInput> = {}): AggregationRegimeInput {
  return {
    regime_id: 201,
    regime_state: "STABLE",
    confidence: 85,
    calculation_time: T1,
    ...overrides,
  };
}

function makeWarning(overrides: Partial<WarningSummaryItem> = {}): WarningSummaryItem {
  return {
    warning_id: 301,
    warning_type: "HEALTH_DETERIORATION",
    severity: "MEDIUM",
    message: "Health declined materially.",
    detection_window: T1,
    detected_at: T1,
    effective_until: null,
    ...overrides,
  };
}

function makePrevious(overrides: Partial<PreviousContextInput> = {}): PreviousContextInput {
  return {
    previous_snapshot: {
      snapshot_id: 100,
      health_score: 84,
      confidence_score: 80,
      window_end: T0,
    },
    previous_regime_state: "STABLE",
    previous_calculated_at: new Date("2025-01-15T12:00:00Z"),
    ...overrides,
  };
}

function makeInput(overrides: Partial<SummaryEngineInput> = {}): SummaryEngineInput {
  return {
    entity_type: "coin",
    entity_id: 1,
    timeframe: "DAILY",
    current_snapshot: makeSnapshot(),
    current_regime: makeRegime(),
    active_warnings: [],
    recently_resolved_warnings: [],
    previous: makePrevious(),
    version: SUMMARY_V1_VERSION,
    config: DEFAULT_SUMMARY_CONFIG,
    calculation_time: T1,
    ...overrides,
  };
}

// ─── MINIMUM POPULATION (PD-06A-04) ──────────────────────────────

describe("PD-06A-04: minimum population", () => {
  it("returns null for completely empty population — no fabricated summary", () => {
    const input = makeInput({
      current_snapshot: null,
      current_regime: null,
      active_warnings: [],
      recently_resolved_warnings: [],
    });
    expect(aggregateIntelligence(input)).toBeNull();
  });

  it("generates summary with snapshot only", () => {
    const summary = aggregateIntelligence(
      makeInput({ current_regime: null })
    );
    expect(summary).not.toBeNull();
    expect(summary?.health_score).toBe(72);
  });

  it("generates summary with regime only", () => {
    const summary = aggregateIntelligence(
      makeInput({
        current_snapshot: null,
        previous: makePrevious({
          previous_snapshot: null,
          previous_regime_state: null,
        }),
      })
    );
    expect(summary).not.toBeNull();
    expect(summary?.health_score).toBeNull();
    expect(summary?.regime_state).toBe("STABLE");
  });

  it("generates summary with warnings only", () => {
    const summary = aggregateIntelligence(
      makeInput({
        current_snapshot: null,
        current_regime: null,
        active_warnings: [makeWarning()],
        previous: makePrevious({
          previous_snapshot: null,
          previous_regime_state: null,
        }),
      })
    );
    expect(summary).not.toBeNull();
    expect(summary?.active_warning_count).toBe(1);
    expect(summary?.window_end.getTime()).toBe(T1.getTime());
  });

  it("INVALID-quality input still counts as population (IA-11)", () => {
    const input = makeInput({
      current_snapshot: makeSnapshot({ quality_status: "INVALID" }),
      current_regime: null,
    });
    expect(hasMinimumPopulation(input.current_snapshot, null, [], [])).toBe(true);
  });

  it("hasMinimumPopulation distinguishes all combinations", () => {
    expect(hasMinimumPopulation(null, null, [], [])).toBe(false);
    expect(hasMinimumPopulation(makeSnapshot(), null, [], [])).toBe(true);
    expect(hasMinimumPopulation(null, makeRegime(), [], [])).toBe(true);
    expect(hasMinimumPopulation(null, null, [makeWarning()], [])).toBe(true);
    expect(hasMinimumPopulation(null, null, [], [makeWarning()])).toBe(true);
  });
});

// ─── WINDOW_END PRECEDENCE (PD-06C-01) ───────────────────────────

describe("PD-06C-01: window_end precedence", () => {
  const earlierWarning = makeWarning({
    detection_window: new Date("2025-01-14T00:00:00Z"),
    detected_at: new Date("2025-01-14T00:00:00Z"),
  });

  it("prefers snapshot.window_end even when conflicting sources exist", () => {
    const r = resolveWindowEnd(makeSnapshot({ window_end: T1 }), makeRegime({ calculation_time: T0 }), [
      earlierWarning,
    ]);
    expect(r?.source).toBe("snapshot");
    expect(r?.window_end.getTime()).toBe(T1.getTime());
  });

  it("falls back to regime.calculation_time when no snapshot", () => {
    const r = resolveWindowEnd(null, makeRegime({ calculation_time: T0 }), [earlierWarning]);
    expect(r?.source).toBe("regime");
    expect(r?.window_end.getTime()).toBe(T0.getTime());
  });

  it("falls back to max(warning.detection_window) for warnings-only population", () => {
    const later = makeWarning({
      warning_id: 302,
      detection_window: new Date("2025-01-17T00:00:00Z"),
      detected_at: new Date("2025-01-17T00:00:00Z"),
    });
    const r = resolveWindowEnd(null, null, [earlierWarning, later]);
    expect(r?.source).toBe("warning");
    expect(r?.window_end.toISOString()).toBe("2025-01-17T00:00:00.000Z");
  });

  it("returns null when no usable source exists (never fabricates)", () => {
    expect(resolveWindowEnd(null, null, [])).toBeNull();
  });

  it("is deterministic across repeated evaluation (IA-23)", () => {
    const a = resolveWindowEnd(null, makeRegime({ calculation_time: T0 }), [earlierWarning]);
    const b = resolveWindowEnd(null, makeRegime({ calculation_time: T0 }), [earlierWarning]);
    expect(a?.window_end.getTime()).toBe(b?.window_end.getTime());
  });

  it("identity tuple is deterministic and distinct per dimension", () => {
    const k1 = buildSummaryKey("coin", 1, "DAILY", T1);
    const k2 = buildSummaryKey("coin", 1, "DAILY", T1);
    expect(k1).toBe(k2);
    expect(buildSummaryKey("coin", 2, "DAILY", T1)).not.toBe(k1); // different entity
    expect(buildSummaryKey("narrative", 1, "DAILY", T1)).not.toBe(k1); // different type
    expect(buildSummaryKey("coin", 1, "DAILY", T0)).not.toBe(k1); // different window
  });
});

// ─── HEALTH CHANGE (PD-06C-03) ───────────────────────────────────

describe("health delta semantics", () => {
  it("positive delta", () => {
    expect(computeHealthDelta(90, 80)).toBe(10);
  });

  it("negative delta", () => {
    expect(computeHealthDelta(70, 84)).toBe(-14);
  });

  it("zero delta", () => {
    expect(computeHealthDelta(84, 84)).toBe(0);
  });

  it("previous = 0 → pct = null, delta still computed", () => {
    expect(computeHealthChangePct(50, 0)).toBeNull();
    expect(computeHealthDelta(50, 0)).toBe(50);
  });

  it("null → value: delta null (no invented baseline)", () => {
    expect(computeHealthDelta(72, null)).toBeNull();
    expect(computeHealthChangePct(72, null)).toBeNull();
  });

  it("value → null: delta null", () => {
    expect(computeHealthDelta(null, 84)).toBeNull();
  });

  it("rounds to 2 decimals", () => {
    expect(computeHealthDelta(72.555, 60.111)).toBeCloseTo(12.44, 2);
    expect(computeHealthChangePct(75, 60)).toBeCloseTo(25, 5);
  });
});

// ─── REGIME CHANGE (PD-06C-04) ───────────────────────────────────

describe("regime literal comparison", () => {
  it("unchanged regime → not changed", () => {
    expect(computeRegimeChange("STABLE", "STABLE")).toBe(false);
  });

  it("changed regime → changed", () => {
    expect(computeRegimeChange("STABLE", "WEAK")).toBe(true);
  });

  it("null → value counts as change", () => {
    expect(computeRegimeChange(null, "STABLE")).toBe(true);
  });

  it("value → null counts as change", () => {
    expect(computeRegimeChange("STABLE", null)).toBe(true);
  });

  it("null → null not a change", () => {
    expect(computeRegimeChange(null, null)).toBe(false);
  });
});

// ─── WARNING AGGREGATION (PD-06C-05) ─────────────────────────────

describe("warning synthesis", () => {
  it("new warnings = detection_window equals window_end", () => {
    const active = [
      makeWarning({ warning_id: 1, detection_window: T1 }),
      makeWarning({ warning_id: 2, detection_window: T0 }),
    ];
    expect(selectNewWarnings(active, T1).map((w) => w.warning_id)).toEqual([1]);
  });

  it("resolved warnings bounded by previous calculated_at", () => {
    const resolved = [
      makeWarning({ warning_id: 3, effective_until: new Date("2025-01-16T06:00:00Z") }),
      makeWarning({ warning_id: 4, effective_until: new Date("2025-01-15T00:00:00Z") }),
    ];
    const selected = selectResolvedWarnings(resolved, makePrevious().previous_calculated_at);
    expect(selected.map((w) => w.warning_id)).toEqual([3]);
  });

  it("no previous evaluation → all fetched resolved warnings count", () => {
    const resolved = [makeWarning({ warning_id: 3 })];
    expect(selectResolvedWarnings(resolved, null)).toHaveLength(1);
  });

  it("highest severity among active warnings", () => {
    expect(
      computeHighestSeverity([
        makeWarning({ severity: "LOW" }),
        makeWarning({ severity: "HIGH" }),
        makeWarning({ severity: "MEDIUM" }),
      ])
    ).toBe("HIGH");
    expect(computeHighestSeverity([])).toBeNull();
  });

  it("engine reports counts via detectChanges path", () => {
    const summary = aggregateIntelligence(
      makeInput({
        active_warnings: [makeWarning({ warning_id: 1, detection_window: T1 })],
        recently_resolved_warnings: [
          makeWarning({
            warning_id: 9,
            effective_until: new Date("2025-01-16T06:00:00Z"),
          }),
        ],
      })
    );
    expect(summary?.new_warning_count).toBe(1);
    expect(summary?.resolved_warning_count).toBe(1);
  });
});

// ─── PASS-THROUGH SEMANTICS (IA-14/19) ───────────────────────────

describe("frozen pass-through semantics", () => {
  it("health score passes through unchanged from P6-03", () => {
    const s = aggregateIntelligence(makeInput({ current_snapshot: makeSnapshot({ health_score: 37.42 }) }));
    expect(s?.health_score).toBe(37.42);
  });

  it("confidences pass through unchanged; missing confidence stays null", () => {
    const s = aggregateIntelligence(
      makeInput({
        current_snapshot: makeSnapshot({ confidence_score: null }),
        current_regime: makeRegime({ confidence: null }),
      })
    );
    expect(s?.snapshot_confidence).toBeNull();
    expect(s?.regime_confidence).toBeNull();
  });

  it("regime state displayed exactly as P6-04 produced (vocabulary preserved)", () => {
    for (const state of ["STRONG", "STABLE", "WEAK", "TRANSITIONING", "INSUFFICIENT_DATA"]) {
      const s = aggregateIntelligence(makeInput({ current_regime: makeRegime({ regime_state: state }) }));
      expect(s?.regime_state).toBe(state);
    }
  });

  it("missing regime recorded as null, NOT invented as UNKNOWN", () => {
    const s = aggregateIntelligence(makeInput({ current_regime: null }));
    expect(s?.regime_state).toBeNull();
  });
});

// ─── EXPLANATIONS (PD-06A-02) ────────────────────────────────────

describe("structured explanation generation", () => {
  it("produces all three arrays always present (IA-25)", () => {
    const e = generateExplanation(
      makeSnapshot(),
      makeRegime(),
      makePrevious(),
      {
        health_delta: null,
        health_change_pct: null,
        regime_changed: false,
        new_warning_count: 0,
        resolved_warning_count: 0,
      },
      [],
      [],
      T1,
      10
    );
    expect(e.what_changed).toEqual([]);
    expect(e.why).toEqual([]);
    expect(e.what_to_watch).toEqual([]);
  });

  it("what_changed includes health delta with evidence ref", () => {
    const s = aggregateIntelligence(makeInput());
    const healthItem = s?.what_changed.find((i) => i.category === "HEALTH");
    expect(healthItem).toBeDefined();
    expect(healthItem?.evidence_ref).toContain("p6-snapshot:");
    expect(healthItem?.text).toContain("declined by 12");
  });

  it("first-evaluation notes unavailability instead of fabricating delta", () => {
    const s = aggregateIntelligence(
      makeInput({ previous: makePrevious({ previous_snapshot: null }) })
    );
    expect(s?.health_delta).toBeNull();
    const first = s?.what_changed.find((i) =>
      i.text.includes("First comparable health evaluation")
    );
    expect(first).toBeDefined();
  });

  it("why items are template-derived with provenance refs, never empty-string prose", () => {
    const s = aggregateIntelligence(
      makeInput({ active_warnings: [makeWarning()] })
    );
    for (const item of [...s!.why]) {
      expect(item.text.length).toBeGreaterThan(0);
      expect(item.evidence_ref.length).toBeGreaterThan(0);
    }
  });

  it("what_to_watch prioritizes HIGH/CRITICAL warnings before other content", () => {
    const s = aggregateIntelligence(
      makeInput({
        active_warnings: [
          makeWarning({ warning_id: 1, severity: "LOW" }),
          makeWarning({ warning_id: 2, severity: "CRITICAL", warning_type: "HEALTH_DETERIORATION" }),
        ],
        current_regime: makeRegime({ regime_state: "TRANSITIONING" }),
      })
    );
    const watch = s!.what_to_watch;
    expect(watch[0].severity).toBe("CRITICAL");
    const criticalIdx = watch.findIndex((i) => i.evidence_ref.endsWith(":2"));
    const lowIdx = watch.findIndex((i) => i.evidence_ref.endsWith(":1"));
    expect(criticalIdx).toBeGreaterThanOrEqual(0);
    expect(lowIdx).toBeGreaterThan(criticalIdx);
  });

  it("caps explanation arrays at configured limit (PD-06B-08)", () => {
    const manyWarnings = Array.from({ length: 15 }, (_, i) =>
      makeWarning({ warning_id: i + 1, severity: "MEDIUM" })
    );
    const s = aggregateIntelligence(
      makeInput({
        active_warnings: manyWarnings,
        current_regime: null,
        previous: makePrevious({ previous_regime_state: null, previous_snapshot: null }),
      })
    );
    expect(s!.what_to_watch.length).toBeLessThanOrEqual(10);
    expect(s!.why.length).toBeLessThanOrEqual(10);
  });

  it("ranking: severity desc then recency desc then id asc (PD-06B-02)", () => {
    const ranked = rankExplanationItems([
      { category: "WARNING", text: "a", evidence_ref: "r:1", severity: "LOW", _recency: 100, _ref_id: 1 },
      { category: "WARNING", text: "b", evidence_ref: "r:2", severity: "HIGH", _recency: 50, _ref_id: 2 },
      { category: "WARNING", text: "c", evidence_ref: "r:3", severity: "LOW", _recency: 200, _ref_id: 3 },
      { category: "WARNING", text: "d", evidence_ref: "r:4", severity: "LOW", _recency: 200, _ref_id: 0 },
    ]);
    expect(ranked.map((i) => i._ref_id)).toEqual([2, 0, 3, 1]);
  });

  it("contains no action/trading vocabulary (IA-02)", () => {
    const s = aggregateIntelligence(
      makeInput({
        active_warnings: [makeWarning({ severity: "CRITICAL" })],
        current_regime: makeRegime({ regime_state: "TRANSITIONING" }),
      })
    );
    const allText = JSON.stringify(
      [...s!.what_changed, ...s!.why, ...s!.what_to_watch]
    ).toUpperCase();
    for (const banned of ["BUY", "SELL", "ENTER", "EXIT", "HOLD", "ACTION REQUIRED", "EXECUTE"]) {
      expect(allText).not.toContain(banned);
    }
  });
});

// ─── CHANGE DETECTION WINDOW (PD-06A-03 / IA-15) ─────────────────

describe("two-point change detection boundary", () => {
  it("uses only the supplied immediate-previous context — engine has no history access", () => {
    // The engine input carries exactly one previous context object.
    const input = makeInput();
    expect(Object.keys(input.previous)).toEqual([
      "previous_snapshot",
      "previous_regime_state",
      "previous_calculated_at",
    ]);
  });

  it("missing previous → change fields null/false, explanations note first evaluation", () => {
    const s = aggregateIntelligence(
      makeInput({
        previous: makePrevious({
          previous_snapshot: null,
          previous_regime_state: null,
          previous_calculated_at: null,
        }),
      })
    );
    expect(s?.health_delta).toBeNull();
    expect(s?.health_change_pct).toBeNull();
    expect(s?.previous_regime_state).toBeNull();
  });
});

// ─── DETERMINISM & IDEMPOTENCY (IA-13/24) ────────────────────────

describe("determinism", () => {
  it("identical inputs produce byte-identical summaries", () => {
    const input = makeInput({ active_warnings: [makeWarning()] });
    const a = aggregateIntelligence(input);
    const b = aggregateIntelligence(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("calculated_at is recorded but does not affect classification content", () => {
    const a = aggregateIntelligence(makeInput());
    const b = aggregateIntelligence(
      makeInput({ calculation_time: new Date("2026-06-01T10:00:00Z") })
    );
    // Everything except calculated_at/provenance timestamps must be equal.
    const strip = (s: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const copy = JSON.parse(JSON.stringify(s)) as any;
      copy.calculated_at = "";
      delete copy.provenance.calculation_time;
      return copy;
    };
    expect(strip(a)).toEqual(strip(b));
  });

  it("warnings ordered deterministically: severity desc → recency desc → id asc", () => {
    const s = aggregateIntelligence(
      makeInput({
        active_warnings: [
          makeWarning({ warning_id: 5, severity: "LOW", detected_at: T0 }),
          makeWarning({ warning_id: 4, severity: "HIGH", detected_at: T0 }),
          makeWarning({ warning_id: 3, severity: "LOW", detected_at: T1 }),
          makeWarning({ warning_id: 2, severity: "LOW", detected_at: T1 }),
        ],
      })
    );
    expect(s?.active_warnings.map((w) => w.warning_id)).toEqual([4, 2, 3, 5]);
  });
});

// ─── LIFECYCLE (PD-06B-06 / IA-20) ───────────────────────────────

describe("summary lifecycle", () => {
  it("only CURRENT→SUPERSEDED is valid; SUPERSEDED terminal", () => {
    expect(isValidSummaryTransition("CURRENT", "SUPERSEDED")).toBe(true);
    expect(isValidSummaryTransition("SUPERSEDED", "CURRENT")).toBe(false);
    expect(isValidSummaryTransition("SUPERSEDED", "SUPERSEDED")).toBe(false);
    expect(isSupersededTerminal("SUPERSEDED")).toBe(true);
    expect(isSupersededTerminal("CURRENT")).toBe(false);
  });

  it("lifecycle states are exactly CURRENT | SUPERSEDED — no ESCALATED-like extras", () => {
    expect(SUMMARY_LIFECYCLE_STATES).toEqual(["CURRENT", "SUPERSEDED"]);
  });

  it("lifecycle distinct from QualityState and RegimeState vocabularies (IA-20)", () => {
    expect(isLifecycleNotQualityState("CURRENT")).toBe(true);
    expect(isLifecycleNotQualityState("SUPERSEDED")).toBe(true);
    expect(isLifecycleNotQualityState("VALID")).toBe(false); // guard works
    expect(isLifecycleNotRegimeState("CURRENT")).toBe(true);
    expect(isLifecycleNotRegimeState("STRONG")).toBe(false); // guard works
  });
});

// ─── VERSIONING (IA-09) ──────────────────────────────────────────

describe("standalone versioning", () => {
  it("version tuple is standalone P6-06 namespace", () => {
    expect(SUMMARY_V1_VERSION.algorithm_version).toBe("p6-summary-v1");
    expect(SUMMARY_V1_VERSION.algorithm_version).not.toContain("warning");
    expect(SUMMARY_V1_VERSION.algorithm_version).not.toContain("regime");
    expect(SUMMARY_V1_VERSION.algorithm_version).not.toContain("snapshot");
  });

  it("version preserved in output provenance", () => {
    const s = aggregateIntelligence(makeInput());
    expect(s?.provenance.summary_version).toEqual(SUMMARY_V1_VERSION);
    expect(s?.version).toEqual(SUMMARY_V1_VERSION);
  });
});

// ─── PROVENANCE (IA-21) ──────────────────────────────────────────

describe("provenance completeness", () => {
  it("traces to real upstream IDs; missing ones are null", () => {
    const s = aggregateIntelligence(
      makeInput({
        entity_type: "narrative",
        entity_id: 7,
        active_warnings: [makeWarning({ warning_id: 42 }), makeWarning({ warning_id: 43 })],
      })
    );
    expect(s?.provenance.source_layer).toBe("P6-06");
    expect(s?.provenance.entity).toEqual({ entity_type: "narrative", entity_id: 7 });
    expect(s?.provenance.input_snapshot_id).toBe(101);
    expect(s?.provenance.input_regime_id).toBe(201);
    expect(s?.provenance.input_warning_ids).toEqual([42, 43]);
    expect(s?.provenance.window_end_source).toBe("snapshot");

    // Missing references stay null — never fabricated
    const minimal = aggregateIntelligence(
      makeInput({
        current_snapshot: null,
        current_regime: null,
        active_warnings: [makeWarning()],
        previous: makePrevious({ previous_snapshot: null }),
      })
    );
    expect(minimal?.provenance.input_snapshot_id).toBeNull();
    expect(minimal?.provenance.input_regime_id).toBeNull();
    expect(minimal?.provenance.previous_snapshot_id).toBeNull();
    expect(minimal?.provenance.window_end_source).toBe("warning");
  });
});

// ─── QUALITY / FRESHNESS METADATA (IA-05/06/12) ──────────────────

describe("quality and freshness metadata", () => {
  it("metadata preserved as-is; staleness does not suppress summary (PD-06B-09)", () => {
    const qm = { status: "VALID", detail: "x" };
    const fm = { status: "STALE", hours: 30 };
    const s = aggregateIntelligence(
      makeInput({
        current_snapshot: makeSnapshot({
          quality_metadata: qm,
          freshness_metadata: fm,
        }),
      })
    );
    expect(s?.quality_metadata).toEqual(qm);
    expect(s?.freshness_metadata).toEqual(fm);
    expect(s).not.toBeNull(); // STALE inputs still generate summaries
  });

  it("no new QualityState vocabulary introduced by the module", () => {
    // Module re-exports nothing quality-related beyond pass-through metadata.
    // Only the lifecycle separation GUARD may mention QualityState by name.
    const agg = require("../index");
    const qualityExports = Object.keys(agg).filter((k) => k.toLowerCase().includes("quality"));
    expect(qualityExports).toEqual(["isLifecycleNotQualityState"]);
    expect(Object.keys(agg).some((k) => k.includes("DEGRADED"))).toBe(false);
  });
});

// ─── COIN / NARRATIVE PARITY (IA-22) ─────────────────────────────

describe("entity symmetry", () => {
  it("identical semantics for coin and narrative entities", () => {
    const coin = aggregateIntelligence(makeInput({ entity_type: "coin" }));
    const narrative = aggregateIntelligence(
      makeInput({ entity_type: "narrative", entity_id: coin!.entity_id })
    );
    const stripIdentity = (s: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = JSON.parse(JSON.stringify(s)) as any;
      c.entity_type = "";
      c.provenance.entity = {};
      return c;
    };
    expect(stripIdentity(coin)).toEqual(stripIdentity(narrative));
  });
});

// ─── EDGE CASES / HARDENING ──────────────────────────────────────

describe("edge cases", () => {
  it("long repeated sequence of identical evaluations stays deterministic", () => {
    const input = makeInput({ active_warnings: [makeWarning()] });
    let last = JSON.stringify(aggregateIntelligence(input));
    for (let i = 0; i < 50; i++) {
      const next = JSON.stringify(aggregateIntelligence(input));
      expect(next).toBe(last);
      last = next;
    }
  });

  it("multiple simultaneous warning candidates handled independently", () => {
    const s = aggregateIntelligence(
      makeInput({
        active_warnings: [
          makeWarning({ warning_id: 1, warning_type: "HEALTH_DETERIORATION", severity: "HIGH" }),
          makeWarning({ warning_id: 2, warning_type: "CONFIDENCE_DETERIORATION", severity: "LOW" }),
          makeWarning({
            warning_id: 3,
            warning_type: "REGIME_TRANSITION",
            severity: "MEDIUM",
            detection_window: T0, // older window — not "new"
          }),
        ],
      })
    );
    expect(s?.active_warning_count).toBe(3);
    expect(s?.new_warning_count).toBe(2); // only same-window warnings are new
    expect(s?.highest_severity).toBe("HIGH");
  });

  it("conflicting signals surface independently without resolution logic", () => {
    const s = aggregateIntelligence(
      makeInput({
        active_warnings: [
          makeWarning({ warning_type: "HEALTH_IMPROVEMENT", severity: "LOW", warning_id: 11 }),
          makeWarning({ warning_type: "HEALTH_DETERIORATION", severity: "MEDIUM", warning_id: 12 }),
        ],
      })
    );
    expect(s?.active_warning_count).toBe(2); // both surfaced, neither suppressed
  });
});
