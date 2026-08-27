/**
 * P6-06E — Intelligence Aggregation Hardening Tests
 *
 * Freeze-readiness hardening for P6-06D implementation.
 * Covers: identity precedence paths, population combinations, change detection
 * edge cases, severity vocabulary, regime vocabulary, quality/freshness
 * combinations, explanation determinism/caps/duplicates, provenance fidelity,
 * version independence, lifecycle semantics, long-sequence determinism,
 * coin/narrative parity, and boundary vocabulary scans (IA-01…IA-25).
 *
 * NO production code modified by this suite — pure behavioral verification.
 */

import {
  aggregateIntelligence,
  computeHighestSeverity,
  computeHealthDelta,
  computeHealthChangePct,
  computeRegimeChange,
  resolveWindowEnd,
  hasMinimumPopulation,
  isValidSummaryTransition,
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
const T2 = new Date("2025-01-17T00:00:00Z");

function snap(overrides: Partial<AggregationSnapshotInput> = {}): AggregationSnapshotInput {
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

function reg(overrides: Partial<AggregationRegimeInput> = {}): AggregationRegimeInput {
  return {
    regime_id: 201,
    regime_state: "STABLE",
    confidence: 85,
    calculation_time: T1,
    ...overrides,
  };
}

function warn(overrides: Partial<WarningSummaryItem> = {}): WarningSummaryItem {
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

function prev(overrides: Partial<PreviousContextInput> = {}): PreviousContextInput {
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

function input(overrides: Partial<SummaryEngineInput> = {}): SummaryEngineInput {
  return {
    entity_type: "coin",
    entity_id: 1,
    timeframe: "DAILY",
    current_snapshot: snap(),
    current_regime: reg(),
    active_warnings: [],
    recently_resolved_warnings: [],
    previous: prev(),
    version: SUMMARY_V1_VERSION,
    config: DEFAULT_SUMMARY_CONFIG,
    calculation_time: T1,
    ...overrides,
  };
}

// ─── A. IDENTITY / WINDOW_END PRECEDENCE PATHS ───────────────────

describe("hardening: window_end precedence paths (PD-06C-01)", () => {
  it("path A: snapshot wins even when regime/warning timestamps are later", () => {
    const r = resolveWindowEnd(snap({ window_end: T1 }), reg({ calculation_time: T2 }), [
      warn({ detection_window: T2 }),
    ]);
    expect(r).toEqual({ window_end: T1, source: "snapshot" });
  });

  it("path B: snapshot absent → regime.calculation_time", () => {
    const r = resolveWindowEnd(null, reg({ calculation_time: T2 }), [warn({ detection_window: T0 })]);
    expect(r).toEqual({ window_end: T2, source: "regime" });
  });

  it("path C: snapshot+regime absent → max(warning.detection_window)", () => {
    const warnings = [
      warn({ warning_id: 1, detection_window: T0 }),
      warn({ warning_id: 2, detection_window: T2 }),
      warn({ warning_id: 3, detection_window: T1 }),
    ];
    const r = resolveWindowEnd(null, null, warnings);
    expect(r?.source).toBe("warning");
    expect(r?.window_end.getTime()).toBe(T2.getTime());
  });

  it("path D: no authoritative input → null (no fabrication)", () => {
    expect(resolveWindowEnd(null, null, [])).toBeNull();
  });

  it("single-element warning list uses that element deterministically", () => {
    const r = resolveWindowEnd(null, null, [warn({ detection_window: T0 })]);
    expect(r?.window_end.getTime()).toBe(T0.getTime());
  });

  it("identity is independent of evaluation order of warning arrays", () => {
    const a = resolveWindowEnd(null, null, [
      warn({ warning_id: 1, detection_window: T1 }),
      warn({ warning_id: 2, detection_window: T2 }),
    ]);
    const b = resolveWindowEnd(null, null, [
      warn({ warning_id: 2, detection_window: T2 }),
      warn({ warning_id: 1, detection_window: T1 }),
    ]);
    expect(a?.window_end.getTime()).toBe(b?.window_end.getTime());
  });

  it("coin and narrative identities remain independent namespaces", () => {
    const c = aggregateIntelligence(input({ entity_type: "coin" }));
    const n = aggregateIntelligence(input({ entity_type: "narrative", entity_id: 1 }));
    expect(c?.entity_type).toBe("coin");
    expect(n?.entity_type).toBe("narrative");
    // Same numeric id but distinct entity_type — provenance records both fully.
    expect(c?.provenance.entity.entity_type).not.toBe(n?.provenance.entity.entity_type);
  });
});

// ─── B. POPULATION COMBINATIONS ──────────────────────────────────

describe("hardening: population combinations (PD-06A-04)", () => {
  it("minimum population is exactly 1 authoritative artifact", () => {
    expect(hasMinimumPopulation(null, null, [], [])).toBe(false);
    expect(hasMinimumPopulation(snap(), null, [], [])).toBe(true);
    expect(hasMinimumPopulation(null, reg(), [], [])).toBe(true);
    expect(hasMinimumPopulation(null, null, [warn()], [])).toBe(true);
    expect(hasMinimumPopulation(null, null, [], [warn({ effective_until: T1 })])).toBe(true);
  });

  it("all-missing population produces no summary and no fabricated fields", () => {
    expect(
      aggregateIntelligence(
        input({
          current_snapshot: null,
          current_regime: null,
          active_warnings: [],
          recently_resolved_warnings: [],
        })
      )
    ).toBeNull();
  });

  it("partial population: snapshot + warnings without regime works with nulls propagating", () => {
    const s = aggregateIntelligence(
      input({
        current_regime: null,
        current_snapshot: snap({ health_score: null, confidence_score: null }),
        active_warnings: [warn()],
        previous: prev({
          previous_snapshot: null,
          previous_regime_state: null,
          previous_calculated_at: null,
        }),
      })
    );
    expect(s).not.toBeNull();
    expect(s?.health_score).toBeNull();
    expect(s?.snapshot_confidence).toBeNull();
    expect(s?.regime_state).toBeNull();
    expect(s?.active_warning_count).toBe(1);
  });

  it("resolved-warnings-only population counts as population", () => {
    const s = aggregateIntelligence(
      input({
        current_snapshot: null,
        current_regime: null,
        recently_resolved_warnings: [warn({ effective_until: T1 })],
        previous: prev({ previous_snapshot: null, previous_regime_state: null, previous_calculated_at: null }),
      })
    );
    // Resolved-only still satisfies ≥1-input rule; window falls back through
    // resolved items do NOT participate in the max(detection_window) chain
    // (only ACTIVE do), so window_end resolution fails → no summary.
    // This documents the exact behavior rather than hiding it.
    expect(s).toBeNull();
  });
});

// ─── C. CHANGE DETECTION EDGE CASES ──────────────────────────────

describe("hardening: change detection edge cases (PD-06A-03/06C-03/04/05)", () => {
  it("first-ever summary: no fabricated previous state, pct null", () => {
    const s = aggregateIntelligence(input({ previous: prev({ previous_snapshot: null, previous_regime_state: null }) }));
    expect(s?.health_delta).toBeNull();
    expect(s?.health_change_pct).toBeNull();
    expect(s?.previous_regime_state).toBeNull();
    expect(s?.regime_changed).toBe(true); // null→STABLE per PD-06C-04 literal comparison
  });

  it("health_change_pct: previous=0 → null; delta still computed", () => {
    const s = aggregateIntelligence(
      input({
        current_snapshot: snap({ health_score: 40 }),
        previous: prev({ previous_snapshot: { snapshot_id: 100, health_score: 0, confidence_score: null, window_end: T0 } }),
      })
    );
    expect(s?.health_delta).toBe(40);
    expect(s?.health_change_pct).toBeNull();
  });

  it("unchanged values produce zero delta, zero pct, no regime change", () => {
    const s = aggregateIntelligence(
      input({
        current_snapshot: snap({ health_score: 84 }),
        current_regime: reg({ regime_state: "STABLE" }),
      })
    );
    expect(s?.health_delta).toBe(0);
    expect(s?.health_change_pct).toBe(0);
    expect(s?.regime_changed).toBe(false);
  });

  it("value→null regime counts as changed; missing current regime recorded as null not UNKNOWN", () => {
    const s = aggregateIntelligence(input({ current_regime: null }));
    expect(s?.regime_changed).toBe(true);
    expect(s?.regime_state).toBeNull();
  });

  it("warning still active across windows is NOT counted as new", () => {
    const s = aggregateIntelligence(
      input({ active_warnings: [warn({ detection_window: T0 })] })
    );
    expect(s?.new_warning_count).toBe(0);
    expect(s?.active_warning_count).toBe(1);
  });

  it("two-point only: engine cannot see beyond the single supplied previous context", () => {
    const i = input();
    expect(Array.isArray(i.previous.previous_snapshot)).toBe(false);
    // Structural proof: the input type carries exactly one previous point.
    const keys = Object.keys(i.previous).sort();
    expect(keys).toEqual(["previous_calculated_at", "previous_regime_state", "previous_snapshot"]);
  });
});

// ─── D. SEVERITY VOCABULARY HARDENING ────────────────────────────

describe("hardening: all five severities in aggregation", () => {
  it.each(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const)(
    "severity %s passes through unchanged",
    (severity) => {
      const s = aggregateIntelligence(input({ active_warnings: [warn({ severity })] }));
      expect(s?.highest_severity).toBe(severity);
      const item = s?.what_changed.find((i) => i.category === "WARNING");
      expect(item?.severity).toBe(severity);
    }
  );

  it("CRITICAL outranks all other severities in highest_severity", () => {
    expect(
      computeHighestSeverity([
        warn({ severity: "CRITICAL" }),
        warn({ severity: "INFO" }),
        warn({ severity: "HIGH" }),
      ])
    ).toBe("CRITICAL");
  });

  it("warning identity/severity never rewritten by aggregation", () => {
    const w = warn({ warning_id: 777, severity: "HIGH", warning_type: "REGIME_TRANSITION" });
    const s = aggregateIntelligence(input({ active_warnings: [w] }));
    const out = s?.active_warnings.find((x) => x.warning_id === 777);
    expect(out?.severity).toBe("HIGH");
    expect(out?.warning_type).toBe("REGIME_TRANSITION");
    expect(out?.detection_window.getTime()).toBe(w.detection_window.getTime());
  });
});

// ─── E. REGIME VOCABULARY HARDENING ──────────────────────────────

describe("hardening: full regime vocabulary pass-through", () => {
  it.each([
    "STRONG",
    "STABLE",
    "WEAK",
    "TRANSITIONING",
    "INSUFFICIENT_DATA",
    "UNKNOWN",
  ] as const)("regime %s displayed exactly as produced by P6-04", (state) => {
    const s = aggregateIntelligence(
      input({
        current_regime: reg({ regime_state: state }),
        previous: prev({ previous_regime_state: state }),
      })
    );
    expect(s?.regime_state).toBe(state);
    expect(s?.regime_changed).toBe(false);
  });

  it("regime-change literal comparisons across full vocabulary", () => {
    expect(computeRegimeChange("STRONG", "WEAK")).toBe(true);
    expect(computeRegimeChange("TRANSITIONING", "TRANSITIONING")).toBe(false);
    expect(computeRegimeChange("INSUFFICIENT_DATA", "STABLE")).toBe(true);
    expect(computeRegimeChange("UNKNOWN", "UNKNOWN")).toBe(false);
    expect(computeRegimeChange(null, "UNKNOWN")).toBe(true);
  });

  it("module introduces no new regime states (structural audit)", () => {
    const agg = require("../index");
    // Only the lifecycle separation GUARD may mention RegimeState by name.
    const regimeExports = Object.keys(agg).filter((k) => k.toLowerCase().includes("regime"));
    expect(regimeExports.sort()).toEqual(["computeRegimeChange", "isLifecycleNotRegimeState"].sort());
  });
});

// ─── F. QUALITY / FRESHNESS COMBINATIONS ─────────────────────────

describe("hardening: quality/freshness metadata combinations", () => {
  const combos: Array<[string | null, string | null]> = [
    ["VALID", "FRESH"],
    ["INVALID", "FRESH"],
    ["MISSING", "STALE"],
    ["UNKNOWN", "UNKNOWN"],
    ["INVALID", "UNKNOWN"],
    ["UNKNOWN", "STALE"],
    [null, null],
  ];

  it.each(combos)("quality=%s freshness=%s generates summary with metadata preserved", (q, f) => {
    const qm = q ? { status: q } : null;
    const fm = f ? { status: f } : null;
    const s = aggregateIntelligence(
      input({ current_snapshot: snap({ quality_metadata: qm, freshness_metadata: fm }) })
    );
    expect(s).not.toBeNull(); // INVALID/UNKNOWN/STALE never suppress summaries
    expect(s?.quality_metadata).toEqual(qm);
    expect(s?.freshness_metadata).toEqual(fm);
  });

  it("INVALID data is passed through as-is, never fabricated into a value", () => {
    const s = aggregateIntelligence(
      input({
        current_snapshot: snap({ health_score: null, quality_status: "INVALID" }),
        previous: prev({ previous_snapshot: null }),
      })
    );
    expect(s?.health_score).toBeNull();
    expect(s?.health_delta).toBeNull();
  });

  it("freshness does not alter regime or warning semantics (orthogonality)", () => {
    const fresh = aggregateIntelligence(
      input({
        current_regime: reg({ regime_state: "STABLE" }),
        active_warnings: [warn()],
        current_snapshot: snap({ freshness_status: "FRESH" }),
      })
    );
    const stale = aggregateIntelligence(
      input({
        current_regime: reg({ regime_state: "STABLE" }),
        active_warnings: [warn()],
        current_snapshot: snap({ freshness_status: "STALE" }),
      })
    );
    expect(fresh?.regime_state).toBe(stale?.regime_state);
    expect(fresh?.active_warning_count).toBe(stale?.active_warning_count);
    expect(fresh?.highest_severity).toBe(stale?.highest_severity);
  });
});

// ─── G. EXPLANATION HARDENING ────────────────────────────────────

describe("hardening: explanations", () => {
  it("every explanation item carries non-empty text and evidence_ref", () => {
    const s = aggregateIntelligence(
      input({
        active_warnings: Array.from({ length: 14 }, (_, i) =>
          warn({ warning_id: i + 1, severity: "LOW" })
        ),
        current_regime: reg({ regime_state: "TRANSITIONING" }),
      })
    );
    for (const arr of [s!.what_changed, s!.why, s!.what_to_watch]) {
      for (const item of arr) {
        expect(item.text.length).toBeGreaterThan(0);
        expect(item.evidence_ref.length).toBeGreaterThan(0);
        expect(["HEALTH", "REGIME", "WARNING", "QUALITY", "FRESHNESS"]).toContain(item.category);
      }
    }
  });

  it("cap of exactly 10 enforced under flood", () => {
    const s = aggregateIntelligence(
      input({
        active_warnings: Array.from({ length: 25 }, (_, i) =>
          warn({ warning_id: i + 1, severity: "LOW" })
        ),
        current_regime: null,
        previous: prev({ previous_regime_state: null, previous_snapshot: null }),
      })
    );
    expect(s!.why.length).toBe(10);
    expect(s!.what_to_watch.length).toBe(10);
  });

  it("capped selection keeps highest-ranked items (deterministic prefix)", () => {
    const warnings = [
      ...Array.from({ length: 10 }, (_, i) =>
        warn({ warning_id: i + 1, severity: "LOW", detected_at: T0 })
      ),
      warn({ warning_id: 99, severity: "CRITICAL", detected_at: T0 }),
    ];
    const s = aggregateIntelligence(input({ active_warnings: warnings }));
    expect(s?.what_to_watch[0].evidence_ref).toBe("p6-warning:99");
  });

  it("no duplicate explanation items within an array", () => {
    const s = aggregateIntelligence(
      input({
        active_warnings: Array.from({ length: 15 }, (_, i) =>
          warn({ warning_id: i + 1, severity: "MEDIUM" })
        ),
      })
    );
    for (const arr of [s!.what_changed, s!.why, s!.what_to_watch]) {
      const seen = new Set(arr.map((i) => `${i.category}:${i.evidence_ref}:${i.text}`));
      expect(seen.size).toBe(arr.length);
    }
  });

  it("explanations contain no recommendation/action phrasing (IA-02)", () => {
    const s = aggregateIntelligence(
      input({
        active_warnings: [warn({ severity: "CRITICAL" })],
        current_regime: reg({ regime_state: "TRANSITIONING" }),
      })
    );
    const all = JSON.stringify([s!.what_changed, s!.why, s!.what_to_watch]).toUpperCase();
    for (const banned of [
      "BUY", "SELL", "SHORT", "LONG POSITION", "RECOMMEND", "SHOULD TRADE",
      "ACTION REQUIRED", "MUST ACT", "EXECUTE", "APPROVE",
    ]) {
      expect(all).not.toContain(banned);
    }
  });

  it("explanations are pure functions: same evidence → same wording", () => {
    const a = aggregateIntelligence(input({ active_warnings: [warn()] }));
    const b = aggregateIntelligence(input({ active_warnings: [warn()] }));
    expect(a?.why.map((i) => i.text)).toEqual(b?.why.map((i) => i.text));
  });
});

// ─── H. PROVENANCE FIDELITY ──────────────────────────────────────

describe("hardening: provenance", () => {
  it("full-chain provenance with all sources present", () => {
    const s = aggregateIntelligence(
      input({ active_warnings: [warn({ warning_id: 5 }), warn({ warning_id: 3 })] })
    );
    expect(s?.provenance.source_layer).toBe("P6-06");
    expect(s?.provenance.input_snapshot_id).toBe(101);
    expect(s?.provenance.input_snapshot_window_end?.getTime()).toBe(T1.getTime());
    expect(s?.provenance.previous_snapshot_id).toBe(100);
    expect(s?.provenance.input_regime_id).toBe(201);
    expect([...s?.provenance.input_warning_ids ?? []].sort()).toEqual([3, 5]);
  });

  it("warning ids preserve upstream identity — never regenerated", () => {
    const ids = [913, 42, 7];
    const s = aggregateIntelligence(
      input({ active_warnings: ids.map((id, i) => warn({ warning_id: id, detection_window: i === 0 ? T0 : T1 })) })
    );
    for (const id of ids) {
      expect(s?.provenance.input_warning_ids).toContain(id);
    }
  });

  it("provenance is deterministic across repeated evaluation", () => {
    const a = aggregateIntelligence(input({ active_warnings: [warn()] }))?.provenance;
    const b = aggregateIntelligence(input({ active_warnings: [warn()] }))?.provenance;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("upstream artifacts are never mutated by aggregation", () => {
    const snapshot = snap();
    const regime = reg();
    const warning = warn();
    const snapshotBefore = JSON.stringify(snapshot);
    const regimeBefore = JSON.stringify(regime);
    const warningBefore = JSON.stringify(warning);
    aggregateIntelligence(
      input({ current_snapshot: snapshot, current_regime: regime, active_warnings: [warning] })
    );
    expect(JSON.stringify(snapshot)).toBe(snapshotBefore);
    expect(JSON.stringify(regime)).toBe(regimeBefore);
    expect(JSON.stringify(warning)).toBe(warningBefore);
  });
});

// ─── I. VERSION INDEPENDENCE ─────────────────────────────────────

describe("hardening: version tuple independence", () => {
  it("P6-06 algorithm namespace distinct from frozen layer versions", () => {
    expect(SUMMARY_V1_VERSION.algorithm_version.startsWith("p6-summary")).toBe(true);
    expect(SUMMARY_V1_VERSION.algorithm_version).not.toBe("p6-warning-v1");
    expect(SUMMARY_V1_VERSION.algorithm_version).not.toBe("p6-regime-v1");
    expect(SUMMARY_V1_VERSION.algorithm_version).not.toBe("p6-snapshot-v1");
  });

  it("custom version tuple flows through to output and provenance unchanged", () => {
    const custom = {
      algorithm_version: "p6-summary-v2-test",
      parameter_version: "param-x",
      schema_version: "v2",
      config_hash: "hash-x",
    };
    const s = aggregateIntelligence(input({ version: custom }));
    expect(s?.version).toEqual(custom);
    expect(s?.provenance.summary_version).toEqual(custom);
  });

  it("version changes do not alter semantic content (invalidation-safe recomputation)", () => {
    const a = aggregateIntelligence(input({ active_warnings: [warn()] }));
    const b = aggregateIntelligence(
      input({
        active_warnings: [warn()],
        version: { ...SUMMARY_V1_VERSION, parameter_version: "default-v2" },
      })
    );
    // Semantic content identical; only recorded version differs.
    expect(a?.health_delta).toBe(b?.health_delta);
    expect(a?.what_changed.length).toBe(b?.what_changed.length);
    expect(a?.version.parameter_version).not.toBe(b?.version.parameter_version);
  });
});

// ─── J. LIFECYCLE / IA-24 SEMANTICS ──────────────────────────────

describe("hardening: lifecycle semantics", () => {
  it("transition table: only CURRENT→SUPERSEDED valid", () => {
    expect(isValidSummaryTransition("CURRENT", "SUPERSEDED")).toBe(true);
    expect(isValidSummaryTransition("CURRENT", "CURRENT")).toBe(false);
    expect(isValidSummaryTransition("SUPERSEDED", "CURRENT")).toBe(false);
    expect(isValidSummaryTransition("SUPERSEDED", "SUPERSEDED")).toBe(false);
  });

  it("engine output itself carries no lifecycle field — lifecycle belongs to persistence boundary", () => {
    const s = aggregateIntelligence(input()) as unknown as Record<string, unknown>;
    expect("lifecycle" in s || "status" in s).toBe(false);
  });

  it("IA-24 structural: identical inputs → identical summary content (re-run safe)", () => {
    const mk = () =>
      JSON.stringify(aggregateIntelligence(input({ active_warnings: [warn()] })));
    expect(mk()).toBe(mk());
  });
});

// ─── K. LONG SEQUENCE DETERMINISM ────────────────────────────────

describe("hardening: long repeated sequences", () => {
  it("100 repeated evaluations produce byte-identical output every time", () => {
    const i = input({
      active_warnings: [
        warn({ warning_id: 1, severity: "HIGH", detected_at: T0 }),
        warn({ warning_id: 2, severity: "LOW", detected_at: T1 }),
      ],
    });
    let last = "";
    for (let run = 0; run < 100; run++) {
      const out = JSON.stringify(aggregateIntelligence(i));
      if (run > 0) expect(out).toBe(last);
      last = out;
    }
  });

  it("input array order does not affect deterministic output fields", () => {
    const w = (id: number) => warn({ warning_id: id, severity: "MEDIUM", detected_at: T1 });
    const a = aggregateIntelligence(input({ active_warnings: [w(1), w(2), w(3)] }));
    const b = aggregateIntelligence(input({ active_warnings: [w(3), w(1), w(2)] }));
    // Ordering canonicalized by severity desc → recency desc → id asc
    expect(a?.active_warnings.map((x) => x.warning_id)).toEqual(b?.active_warnings.map((x) => x.warning_id));
    expect(a?.active_warning_count).toBe(b?.active_warning_count);
  });
});
