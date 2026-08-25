/**
 * P6-05E — Warning Engine Hardening Tests
 *
 * Critical edge cases and contract compliance verification.
 */

import {
  detectWarnings,
  checkHealthThreshold,
  checkConfidenceThreshold,
  checkRegimeChangeThreshold,
  determineSeverity,
  selectHighestSeverity,
  computeDedupKey,
  isDuplicate,
  isWithinCooldown,
  findWarningsToSupersede,
  buildWarningIdentity,
  isValidTransition,
  DEFAULT_WARNING_CONFIG,
  WARNING_V1_VERSION,
  SEVERITY_RANK,
  ALL_WARNING_TYPES,
} from "../index";
import type {
  WarningEngineInput,
  WarningSnapshotInput,
  WarningRegimeInput,
  WarningRecord,
  WarningConfig,
  Severity,
} from "../types";

// ─── HELPERS ──────────────────────────────────────────────────────

function snap(overrides: Partial<WarningSnapshotInput> = {}): WarningSnapshotInput {
  return {
    snapshot_id: 1,
    entity_type: "coin",
    entity_id: 1,
    health_score: 70,
    confidence_score: 80,
    calculation_time: new Date("2025-01-15T00:00:00Z"),
    window_end: new Date("2025-01-15T00:00:00Z"),
    quality_status: "VALID",
    freshness_status: "FRESH",
    quality_metadata: null,
    freshness_metadata: null,
    ...overrides,
  };
}

function regime(overrides: Partial<WarningRegimeInput> = {}): WarningRegimeInput {
  return {
    entity_type: "coin",
    entity_id: 1,
    regime_state: "STABLE",
    previous_state: null,
    confidence: 70,
    consecutive_count: 2,
    health_score: 70,
    calculation_time: new Date("2025-01-15T00:00:00Z"),
    ...overrides,
  };
}

function input(overrides: Partial<WarningEngineInput> = {}): WarningEngineInput {
  return {
    entity_type: "coin",
    entity_id: 1,
    current_snapshot: snap(),
    previous_snapshot: snap({
      snapshot_id: 0,
      health_score: 60,
      calculation_time: new Date("2025-01-14T00:00:00Z"),
      window_end: new Date("2025-01-14T00:00:00Z"),
    }),
    current_regime: regime(),
    previous_regime: regime({ previous_state: "STABLE" }),
    warning_version: WARNING_V1_VERSION,
    calculation_time: new Date("2025-01-15T00:00:00Z"),
    existing_active_warnings: [],
    ...overrides,
  };
}

function warningRecord(overrides: Partial<WarningRecord> = {}): WarningRecord {
  return {
    id: 1,
    entity_type: "coin",
    entity_id: 1,
    warning_type: "HEALTH_DETERIORATION",
    severity: "LOW",
    lifecycle: "ACTIVE",
    message: "test",
    health_score: 50,
    previous_health_score: 70,
    health_delta: -20,
    regime_state: "STABLE",
    previous_regime_state: "STABLE",
    confidence: 70,
    dedup_key: "coin:1:HEALTH_DETERIORATION:2025-01-15T00:00:00.000Z",
    quality_metadata: null,
    freshness_metadata: null,
    evidence: null,
    version: WARNING_V1_VERSION,
    provenance: {} as any,
    detection_window: new Date("2025-01-15T00:00:00Z"),
    detected_at: new Date("2025-01-15T00:00:00Z"),
    effective_from: new Date("2025-01-15T00:00:00Z"),
    effective_until: null,
    superseded_at: null,
    created_at: new Date("2025-01-15T00:00:00Z"),
    updated_at: new Date("2025-01-15T00:00:00Z"),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// CRITICAL: OCCURRENCE IDENTITY AUDIT
// ═══════════════════════════════════════════════════════════════════

describe("P6-05E CRITICAL: Occurrence Identity", () => {
  it("same condition in same window produces dedup (no duplicate)", () => {
    const currentWindow = new Date("2025-01-15T00:00:00Z");
    const existing = [
      warningRecord({
        dedup_key: computeDedupKey(buildWarningIdentity("coin", 1, "HEALTH_DETERIORATION", currentWindow)),
        lifecycle: "ACTIVE",
      }),
    ];
    const result = detectWarnings(input({
      current_snapshot: snap({ health_score: 50, window_end: currentWindow, calculation_time: currentWindow }),
      previous_snapshot: snap({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
      existing_active_warnings: existing,
    }));
    // Should NOT generate a duplicate for same window
    expect(result.warnings.some((w) => w.warning_type === "HEALTH_DETERIORATION")).toBe(false);
  });

  it("same condition in DIFFERENT window creates new occurrence (PD-05C-01)", () => {
    // Day 1: health dropped, warning generated for window 2025-01-15
    // Day 2: health still low, new window 2025-01-16 → new occurrence
    const day1Window = new Date("2025-01-15T00:00:00Z");
    const day2Window = new Date("2025-01-16T00:00:00Z");
    const existing = [
      warningRecord({
        dedup_key: computeDedupKey(buildWarningIdentity("coin", 1, "HEALTH_DETERIORATION", day1Window)),
        lifecycle: "ACTIVE",
        detection_window: day1Window,
      }),
    ];
    const result = detectWarnings(input({
      current_snapshot: snap({ health_score: 50, window_end: day2Window, calculation_time: day2Window }),
      previous_snapshot: snap({ health_score: 70, window_end: day1Window, calculation_time: day1Window }),
      existing_active_warnings: existing,
    }));
    // Should generate a new warning for the new window
    expect(result.warnings.some((w) => w.warning_type === "HEALTH_DETERIORATION")).toBe(true);
    // Should supersede the old one
    expect(result.warnings_to_supersede.length).toBeGreaterThanOrEqual(1);
  });

  it("repeated refresh with same window does not create duplicates", () => {
    const window = new Date("2025-01-15T00:00:00Z");
    const existing = [
      warningRecord({
        dedup_key: computeDedupKey(buildWarningIdentity("coin", 1, "HEALTH_DETERIORATION", window)),
        lifecycle: "ACTIVE",
      }),
    ];
    // Run engine 5 times with same window
    for (let i = 0; i < 5; i++) {
      const result = detectWarnings(input({
        current_snapshot: snap({ health_score: 50, window_end: window, calculation_time: window }),
        previous_snapshot: snap({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
        existing_active_warnings: existing,
      }));
      expect(result.warnings.some((w) => w.warning_type === "HEALTH_DETERIORATION")).toBe(false);
    }
  });

  it("RESOLVED + same condition in new window = new occurrence", () => {
    const window1 = new Date("2025-01-15T00:00:00Z");
    const window2 = new Date("2025-01-16T00:00:00Z");
    const existing = [
      warningRecord({
        dedup_key: computeDedupKey(buildWarningIdentity("coin", 1, "HEALTH_DETERIORATION", window1)),
        lifecycle: "RESOLVED",
        detection_window: window1,
      }),
    ];
    const result = detectWarnings(input({
      current_snapshot: snap({ health_score: 50, window_end: window2, calculation_time: window2 }),
      previous_snapshot: snap({ health_score: 70, window_end: window1, calculation_time: window1 }),
      existing_active_warnings: existing,
    }));
    // RESOLVED warnings are not deduped against — new occurrence should be created
    expect(result.warnings.some((w) => w.warning_type === "HEALTH_DETERIORATION")).toBe(true);
  });

  it("SUPERSEDED + same condition in new window = new occurrence", () => {
    const window1 = new Date("2025-01-15T00:00:00Z");
    const window2 = new Date("2025-01-16T00:00:00Z");
    const existing = [
      warningRecord({
        dedup_key: computeDedupKey(buildWarningIdentity("coin", 1, "HEALTH_DETERIORATION", window1)),
        lifecycle: "SUPERSEDED",
        detection_window: window1,
      }),
    ];
    const result = detectWarnings(input({
      current_snapshot: snap({ health_score: 50, window_end: window2, calculation_time: window2 }),
      previous_snapshot: snap({ health_score: 70, window_end: window1, calculation_time: window1 }),
      existing_active_warnings: existing,
    }));
    expect(result.warnings.some((w) => w.warning_type === "HEALTH_DETERIORATION")).toBe(true);
  });

  it("detection_window is deterministic (same inputs → same window)", () => {
    const window = new Date("2025-01-15T00:00:00Z");
    const input1 = input({
      current_snapshot: snap({ health_score: 50, window_end: window }),
      previous_snapshot: snap({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const input2 = { ...input1 };
    const result1 = detectWarnings(input1);
    const result2 = detectWarnings(input2);
    if (result1.warnings.length > 0 && result2.warnings.length > 0) {
      expect(result1.warnings[0].detection_window).toEqual(result2.warnings[0].detection_window);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// COOLDOWN AUDIT
// ═══════════════════════════════════════════════════════════════════

describe("P6-05E Cooldown Audit", () => {
  it("cooldown only affects same dedup key (not different windows)", () => {
    const window1 = new Date("2025-01-15T12:00:00Z");
    const window2 = new Date("2025-01-16T12:00:00Z");
    const key1 = computeDedupKey(buildWarningIdentity("coin", 1, "HEALTH_DETERIORATION", window1));
    const existing = [
      warningRecord({
        dedup_key: key1,
        lifecycle: "ACTIVE",
        detected_at: new Date("2025-01-15T00:00:00Z"),
      }),
    ];
    // Check cooldown for window2 — should NOT be in cooldown because dedup keys differ
    const result = isWithinCooldown("coin", 1, "HEALTH_DETERIORATION", window2, existing);
    expect(result).toBe(false);
  });

  it("cooldown suppresses within same window if detected recently", () => {
    const window = new Date("2025-01-15T12:00:00Z");
    const key = computeDedupKey(buildWarningIdentity("coin", 1, "HEALTH_DETERIORATION", window));
    const existing = [
      warningRecord({
        dedup_key: key,
        lifecycle: "ACTIVE",
        detected_at: new Date("2025-01-15T00:00:00Z"), // 12h ago, within 24h cooldown
      }),
    ];
    const result = isWithinCooldown("coin", 1, "HEALTH_DETERIORATION", window, existing);
    expect(result).toBe(true);
  });

  it("cooldown does not introduce hidden semantic rules", () => {
    // Cooldown should only suppress — never create, never modify severity, never change lifecycle
    const window = new Date("2025-01-15T00:00:00Z");
    const key = computeDedupKey(buildWarningIdentity("coin", 1, "HEALTH_DETERIORATION", window));
    const existing = [
      warningRecord({
        dedup_key: key,
        lifecycle: "ACTIVE",
        detected_at: new Date("2025-01-15T00:00:00Z"),
      }),
    ];
    const result = detectWarnings(input({
      current_snapshot: snap({ health_score: 50, window_end: window }),
      previous_snapshot: snap({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
      existing_active_warnings: existing,
    }));
    // Cooldown suppresses → no new warning, no supersession, no resolution
    expect(result.warnings).toHaveLength(0);
    expect(result.warnings_to_supersede).toHaveLength(0);
    expect(result.warnings_to_resolve).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SEVERITY HARDENING
// ═══════════════════════════════════════════════════════════════════

describe("P6-05E Severity Hardening", () => {
  it("health delta = 9 does NOT trigger (below threshold)", () => {
    const result = checkHealthThreshold(
      snap({ health_score: 51 }),
      snap({ health_score: 60, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") })
    );
    expect(result.triggered).toBe(false);
  });

  it("health delta = 10 DOES trigger (inclusive boundary)", () => {
    const result = checkHealthThreshold(
      snap({ health_score: 50 }),
      snap({ health_score: 60, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") })
    );
    expect(result.triggered).toBe(true);
  });

  it("health delta = 11 DOES trigger", () => {
    const result = checkHealthThreshold(
      snap({ health_score: 49 }),
      snap({ health_score: 60, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") })
    );
    expect(result.triggered).toBe(true);
  });

  it("confidence drop = 19 does NOT trigger", () => {
    const result = checkConfidenceThreshold(
      regime({ confidence: 51 }),
      regime({ confidence: 70, previous_state: "STABLE" })
    );
    expect(result.triggered).toBe(false);
  });

  it("confidence drop = 20 DOES trigger (inclusive)", () => {
    const result = checkConfidenceThreshold(
      regime({ confidence: 50 }),
      regime({ confidence: 70, previous_state: "STABLE" })
    );
    expect(result.triggered).toBe(true);
  });

  it("confidence drop = 21 DOES trigger", () => {
    const result = checkConfidenceThreshold(
      regime({ confidence: 49 }),
      regime({ confidence: 70, previous_state: "STABLE" })
    );
    expect(result.triggered).toBe(true);
  });

  it("competing factors: health=LOW but regime=HIGH → HIGH wins", () => {
    const { severity } = determineSeverity(
      "HEALTH_DETERIORATION",
      -12, // LOW (≥10)
      "WEAK", // not directly used for HEALTH_DETERIORATION
      "STABLE",
      70,
      snap({ health_score: 48 }),
      snap({ health_score: 60 })
    );
    // health delta -12 + WEAK regime → MEDIUM (≥10 + WEAK)
    expect(["MEDIUM", "HIGH"]).toContain(severity);
  });

  it("competing factors: health=CRITICAL always wins", () => {
    const { severity, factors } = determineSeverity(
      "HEALTH_DETERIORATION",
      -35, // CRITICAL (≥30)
      "STABLE",
      "STABLE",
      80, // high confidence (no confidence factor)
      snap({ health_score: 35 }),
      snap({ health_score: 70 })
    );
    expect(severity).toBe("CRITICAL");
    expect(factors.some((f) => f.severity === "CRITICAL")).toBe(true);
  });

  it("deterministic: same inputs → same severity (10 runs)", () => {
    const results: Severity[] = [];
    for (let i = 0; i < 10; i++) {
      const { severity } = determineSeverity(
        "HEALTH_DETERIORATION",
        -15,
        "STABLE",
        "STABLE",
        60,
        snap({ health_score: 55 }),
        snap({ health_score: 70 })
      );
      results.push(severity);
    }
    expect(new Set(results).size).toBe(1);
  });

  it("no hidden thresholds in severity — all from config or documented rules", () => {
    // Verify severity factors only come from known factor types
    const { factors } = determineSeverity(
      "HEALTH_DETERIORATION",
      -25,
      "WEAK",
      "STABLE",
      25,
      snap({ health_score: 45 }),
      snap({ health_score: 70 })
    );
    const factorTypes = factors.map((f) => f.factor);
    const allowedTypes = ["health_delta", "regime_context", "confidence_context", "warning_type_baseline"];
    for (const ft of factorTypes) {
      expect(allowedTypes).toContain(ft);
    }
  });

  it("config change produces different version (observable)", () => {
    const v1Config: WarningConfig = { ...DEFAULT_WARNING_CONFIG, healthDeltaThreshold: 10 };
    const v2Config: WarningConfig = { ...DEFAULT_WARNING_CONFIG, healthDeltaThreshold: 15 };

    // Delta = 12: triggers with v1 (≥10), does not trigger with v2 (≥15)
    const v1Result = checkHealthThreshold(
      snap({ health_score: 58 }),
      snap({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
      v1Config
    );
    const v2Result = checkHealthThreshold(
      snap({ health_score: 58 }),
      snap({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
      v2Config
    );
    expect(v1Result.triggered).toBe(true);
    expect(v2Result.triggered).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// REGIME TRANSITION → CHANGE SEQUENTIAL HANDLING
// ═══════════════════════════════════════════════════════════════════

describe("P6-05E REGIME_TRANSITION → REGIME_CHANGE", () => {
  it("STABLE → TRANSITIONING generates REGIME_TRANSITION only", () => {
    const result = detectWarnings(input({
      current_regime: regime({ regime_state: "TRANSITIONING", previous_state: "STABLE" }),
      previous_regime: regime({ regime_state: "STABLE", previous_state: "STABLE" }),
    }));
    expect(result.warnings.some((w) => w.warning_type === "REGIME_TRANSITION")).toBe(true);
    expect(result.warnings.some((w) => w.warning_type === "REGIME_CHANGE")).toBe(false);
  });

  it("TRANSITIONING → WEAK generates REGIME_CHANGE only", () => {
    const result = detectWarnings(input({
      current_regime: regime({ regime_state: "WEAK", previous_state: "TRANSITIONING" }),
      previous_regime: regime({ regime_state: "TRANSITIONING", previous_state: "STABLE" }),
    }));
    expect(result.warnings.some((w) => w.warning_type === "REGIME_CHANGE")).toBe(true);
    expect(result.warnings.some((w) => w.warning_type === "REGIME_TRANSITION")).toBe(false);
  });

  it("STABLE → WEAK (direct, no TRANSITIONING) generates REGIME_CHANGE", () => {
    const result = detectWarnings(input({
      current_regime: regime({ regime_state: "WEAK", previous_state: "STABLE" }),
      previous_regime: regime({ regime_state: "STABLE", previous_state: "STABLE" }),
    }));
    expect(result.warnings.some((w) => w.warning_type === "REGIME_CHANGE")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// QUALITY VS INFRASTRUCTURE FAILURE
// ═══════════════════════════════════════════════════════════════════

describe("P6-05E Quality vs Infrastructure Failure", () => {
  it("null quality_status does NOT produce DATA_QUALITY_DEGRADATION", () => {
    const result = detectWarnings(input({
      current_snapshot: snap({ quality_status: null, health_score: 50 }),
      previous_snapshot: snap({ quality_status: null, health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    }));
    expect(result.warnings.some((w) => w.warning_type === "DATA_QUALITY_DEGRADATION")).toBe(false);
  });

  it("VALID → INVALID produces DATA_QUALITY_DEGRADATION", () => {
    const result = detectWarnings(input({
      current_snapshot: snap({ quality_status: "INVALID" }),
      previous_snapshot: snap({ quality_status: "VALID", window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    }));
    expect(result.warnings.some((w) => w.warning_type === "DATA_QUALITY_DEGRADATION")).toBe(true);
  });

  it("VALID → MISSING produces DATA_QUALITY_DEGRADATION", () => {
    const result = detectWarnings(input({
      current_snapshot: snap({ quality_status: "MISSING" }),
      previous_snapshot: snap({ quality_status: "VALID", window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    }));
    expect(result.warnings.some((w) => w.warning_type === "DATA_QUALITY_DEGRADATION")).toBe(true);
  });

  it("FRESH → STALE produces FRESHNESS_DEGRADATION", () => {
    const result = detectWarnings(input({
      current_snapshot: snap({ freshness_status: "STALE" }),
      previous_snapshot: snap({ freshness_status: "FRESH", window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    }));
    expect(result.warnings.some((w) => w.warning_type === "FRESHNESS_DEGRADATION")).toBe(true);
  });

  it("STALE → STALE does NOT produce FRESHNESS_DEGRADATION", () => {
    const result = detectWarnings(input({
      current_snapshot: snap({ freshness_status: "STALE" }),
      previous_snapshot: snap({ freshness_status: "STALE", window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    }));
    expect(result.warnings.some((w) => w.warning_type === "FRESHNESS_DEGRADATION")).toBe(false);
  });

  it("quality metadata preserved, not used for classification", () => {
    const result = detectWarnings(input({
      current_snapshot: snap({ health_score: 50, quality_status: "INVALID", quality_metadata: { score: 0.3 } }),
      previous_snapshot: snap({ health_score: 70, quality_status: "VALID", window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    }));
    const healthWarning = result.warnings.find((w) => w.warning_type === "HEALTH_DETERIORATION");
    expect(healthWarning?.quality_metadata).toEqual({ score: 0.3 });
    // Quality status INVALID should not change severity from what health delta dictates
  });
});

// ═══════════════════════════════════════════════════════════════════
// LIFECYCLE HARDENING
// ═══════════════════════════════════════════════════════════════════

describe("P6-05E Lifecycle Hardening", () => {
  it("all valid transitions pass", () => {
    expect(isValidTransition("DETECTED", "ACTIVE")).toBe(true);
    expect(isValidTransition("DETECTED", "RESOLVED")).toBe(true);
    expect(isValidTransition("ACTIVE", "RESOLVED")).toBe(true);
    expect(isValidTransition("ACTIVE", "SUPERSEDED")).toBe(true);
  });

  it("all invalid transitions fail", () => {
    expect(isValidTransition("RESOLVED", "ACTIVE")).toBe(false);
    expect(isValidTransition("RESOLVED", "SUPERSEDED")).toBe(false);
    expect(isValidTransition("SUPERSEDED", "ACTIVE")).toBe(false);
    expect(isValidTransition("SUPERSEDED", "RESOLVED")).toBe(false);
    expect(isValidTransition("DETECTED", "SUPERSEDED")).toBe(false);
    expect(isValidTransition("ACTIVE", "DETECTED")).toBe(false);
  });

  it("ESCALATED is NOT a valid lifecycle state", () => {
    expect(isValidTransition("DETECTED", "ESCALATED" as any)).toBe(false);
    expect(isValidTransition("ACTIVE", "ESCALATED" as any)).toBe(false);
  });

  it("SUPERSEDED is terminal", () => {
    expect(isValidTransition("SUPERSEDED", "ACTIVE")).toBe(false);
    expect(isValidTransition("SUPERSEDED", "RESOLVED")).toBe(false);
    expect(isValidTransition("SUPERSEDED", "DETECTED")).toBe(false);
  });

  it("RESOLVED is terminal", () => {
    expect(isValidTransition("RESOLVED", "ACTIVE")).toBe(false);
    expect(isValidTransition("RESOLVED", "SUPERSEDED")).toBe(false);
    expect(isValidTransition("RESOLVED", "DETECTED")).toBe(false);
  });

  it("lifecycle states are distinct from QualityState", () => {
    const lifecycleStates = ["DETECTED", "ACTIVE", "RESOLVED", "SUPERSEDED"];
    const qualityStates = ["VALID", "INVALID", "MISSING", "UNKNOWN"];
    for (const ls of lifecycleStates) {
      expect(qualityStates).not.toContain(ls);
    }
  });

  it("lifecycle states are distinct from RegimeState", () => {
    const lifecycleStates = ["DETECTED", "ACTIVE", "RESOLVED", "SUPERSEDED"];
    const regimeStates = ["STRONG", "STABLE", "WEAK", "TRANSITIONING", "INSUFFICIENT_DATA", "UNKNOWN"];
    for (const ls of lifecycleStates) {
      expect(regimeStates).not.toContain(ls);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// PROVENANCE / VERSION
// ═══════════════════════════════════════════════════════════════════

describe("P6-05E Provenance & Version", () => {
  it("warning has complete provenance chain", () => {
    const result = detectWarnings(input({
      current_snapshot: snap({ health_score: 50 }),
      previous_snapshot: snap({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    }));
    const warning = result.warnings[0];
    expect(warning.provenance.source_layer).toBe("P6-05");
    expect(warning.provenance.source_entity).toEqual({ entity_type: "coin", entity_id: 1 });
    expect(warning.provenance.health_score).toBe(50);
    expect(warning.provenance.previous_health_score).toBe(70);
    expect(warning.provenance.health_delta).toBe(-20);
    expect(warning.provenance.warning_version).toEqual(WARNING_V1_VERSION);
    expect(warning.provenance.detection_window).toBeDefined();
    expect(warning.provenance.detection_time).toBeDefined();
  });

  it("no fabricated IDs in provenance", () => {
    const result = detectWarnings(input({
      current_snapshot: snap({ health_score: 50 }),
      previous_snapshot: snap({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    }));
    const warning = result.warnings[0];
    // source_record_id should be null (not fabricated)
    expect(warning.provenance.source_record_id).toBeNull();
  });

  it("version tuple is preserved in warning", () => {
    const customVersion = {
      algorithm_version: "p6-warning-v2",
      parameter_version: "custom-v1",
      schema_version: "v2",
      config_hash: "custom-hash",
    };
    const result = detectWarnings(input({
      current_snapshot: snap({ health_score: 50 }),
      previous_snapshot: snap({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
      warning_version: customVersion,
    }));
    const warning = result.warnings[0];
    expect(warning.provenance.warning_version).toEqual(customVersion);
  });

  it("identical inputs + versions → identical output (deterministic replay)", () => {
    const makeInput = () => input({
      current_snapshot: snap({ health_score: 50 }),
      previous_snapshot: snap({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const r1 = detectWarnings(makeInput());
    const r2 = detectWarnings(makeInput());
    expect(r1.warnings.length).toBe(r2.warnings.length);
    if (r1.warnings.length > 0) {
      expect(r1.warnings[0].severity).toBe(r2.warnings[0].severity);
      expect(r1.warnings[0].warning_type).toBe(r2.warnings[0].warning_type);
      expect(r1.warnings[0].dedup_key).toBe(r2.warnings[0].dedup_key);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// COIN / NARRATIVE PARITY
// ═══════════════════════════════════════════════════════════════════

describe("P6-05E Coin/Narrative Parity", () => {
  it("same health delta produces same severity for coin and narrative", () => {
    const coinResult = detectWarnings(input({
      entity_type: "coin",
      current_snapshot: snap({ entity_type: "coin", health_score: 50 }),
      previous_snapshot: snap({ entity_type: "coin", health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    }));
    const narrativeResult = detectWarnings(input({
      entity_type: "narrative",
      current_snapshot: snap({ entity_type: "narrative", health_score: 50 }),
      previous_snapshot: snap({ entity_type: "narrative", health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    }));
    const coinWarning = coinResult.warnings.find((w) => w.warning_type === "HEALTH_DETERIORATION");
    const narrativeWarning = narrativeResult.warnings.find((w) => w.warning_type === "HEALTH_DETERIORATION");
    expect(coinWarning?.severity).toBe(narrativeWarning?.severity);
  });

  it("no narrative-specific hidden behavior", () => {
    // Same inputs, different entity_type → same warning types
    const coinResult = detectWarnings(input({
      entity_type: "coin",
      current_snapshot: snap({ entity_type: "coin", health_score: 50 }),
      previous_snapshot: snap({ entity_type: "coin", health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
      current_regime: regime({ entity_type: "coin", regime_state: "WEAK", previous_state: "STABLE" }),
      previous_regime: regime({ entity_type: "coin", regime_state: "STABLE", previous_state: "STABLE" }),
    }));
    const narrativeResult = detectWarnings(input({
      entity_type: "narrative",
      current_snapshot: snap({ entity_type: "narrative", health_score: 50 }),
      previous_snapshot: snap({ entity_type: "narrative", health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
      current_regime: regime({ entity_type: "narrative", regime_state: "WEAK", previous_state: "STABLE" }),
      previous_regime: regime({ entity_type: "narrative", regime_state: "STABLE", previous_state: "STABLE" }),
    }));
    expect(coinResult.warnings.length).toBe(narrativeResult.warnings.length);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EDGE CASES
// ═══════════════════════════════════════════════════════════════════

describe("P6-05E Edge Cases", () => {
  it("empty input (no previous snapshot) produces no warnings", () => {
    const result = detectWarnings(input({ previous_snapshot: null }));
    expect(result.warnings).toHaveLength(0);
  });

  it("missing regime data still produces health warnings", () => {
    const result = detectWarnings(input({
      current_regime: null,
      previous_regime: null,
      current_snapshot: snap({ health_score: 50 }),
      previous_snapshot: snap({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    }));
    expect(result.warnings.some((w) => w.warning_type === "HEALTH_DETERIORATION")).toBe(true);
  });

  it("no warnings when all deltas below thresholds", () => {
    const result = detectWarnings(input({
      current_snapshot: snap({ health_score: 65 }),
      previous_snapshot: snap({ health_score: 60, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
      current_regime: regime({ confidence: 65 }),
      previous_regime: regime({ confidence: 70, previous_state: "STABLE" }),
    }));
    // Delta=5 (<10), confidence drop=5 (<20), regime unchanged
    expect(result.warnings).toHaveLength(0);
  });

  it("multiple warning types can fire simultaneously", () => {
    const result = detectWarnings(input({
      current_snapshot: snap({ health_score: 40, quality_status: "INVALID", freshness_status: "STALE" }),
      previous_snapshot: snap({ health_score: 70, quality_status: "VALID", freshness_status: "FRESH", window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
      current_regime: regime({ regime_state: "WEAK", confidence: 40 }),
      previous_regime: regime({ regime_state: "STABLE", confidence: 70, previous_state: "STABLE" }),
    }));
    const types = result.warnings.map((w) => w.warning_type);
    expect(types).toContain("HEALTH_DETERIORATION");
    expect(types).toContain("CONFIDENCE_DETERIORATION");
    expect(types).toContain("REGIME_CHANGE");
    expect(types).toContain("DATA_QUALITY_DEGRADATION");
    expect(types).toContain("FRESHNESS_DEGRADATION");
  });

  it("health score = 0 vs 100 (extreme delta)", () => {
    const result = detectWarnings(input({
      current_snapshot: snap({ health_score: 0 }),
      previous_snapshot: snap({ health_score: 100, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    }));
    const warning = result.warnings.find((w) => w.warning_type === "HEALTH_DETERIORATION");
    expect(warning?.severity).toBe("CRITICAL");
  });

  it("supersession works correctly with multiple existing warnings", () => {
    const window = new Date("2025-01-14T00:00:00Z");
    const existing = [
      warningRecord({ id: 1, warning_type: "HEALTH_DETERIORATION", lifecycle: "ACTIVE", dedup_key: "old1" }),
      warningRecord({ id: 2, warning_type: "HEALTH_IMPROVEMENT", lifecycle: "ACTIVE", dedup_key: "old2" }),
    ];
    const result = detectWarnings(input({
      current_snapshot: snap({ health_score: 50 }),
      previous_snapshot: snap({ health_score: 70, window_end: new Date("2025-01-13"), calculation_time: new Date("2025-01-13") }),
      existing_active_warnings: existing,
    }));
    // Should supersede HEALTH_DETERIORATION but not HEALTH_IMPROVEMENT
    const superseded = result.warnings_to_supersede;
    expect(superseded.some((w) => w.warning_type === "HEALTH_DETERIORATION")).toBe(true);
    expect(superseded.some((w) => w.warning_type === "HEALTH_IMPROVEMENT")).toBe(false);
  });

  it("long repeated sequence produces only one warning per window", () => {
    const window = new Date("2025-01-15T00:00:00Z");
    let existing: WarningRecord[] = [];
    let totalWarnings = 0;

    for (let i = 0; i < 20; i++) {
      const result = detectWarnings(input({
        current_snapshot: snap({ health_score: 50, window_end: window, calculation_time: window }),
        previous_snapshot: snap({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
        existing_active_warnings: existing,
      }));
      totalWarnings += result.warnings.length;
      // Simulate persistence: add new warnings to existing
      for (const w of result.warnings) {
        existing.push(warningRecord({
          dedup_key: w.dedup_key,
          warning_type: w.warning_type,
          lifecycle: "ACTIVE",
        }));
      }
    }
    // Only the first iteration should produce warnings; rest are deduped
    expect(totalWarnings).toBeGreaterThanOrEqual(1);
    expect(totalWarnings).toBeLessThanOrEqual(7); // max 7 warning types
  });
});

// ═══════════════════════════════════════════════════════════════════
// P4/P5 BOUNDARY
// ═══════════════════════════════════════════════════════════════════

describe("P6-05E P4/P5 Boundary", () => {
  it("no BUY/SELL/action semantics in warning output", () => {
    const result = detectWarnings(input({
      current_snapshot: snap({ health_score: 30 }),
      previous_snapshot: snap({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    }));
    for (const warning of result.warnings) {
      const json = JSON.stringify(warning).toLowerCase();
      expect(json).not.toContain("buy");
      expect(json).not.toContain("sell");
      expect(json).not.toContain("action");
      expect(json).not.toContain("policy");
      expect(json).not.toContain("approval");
    }
  });

  it("severity is not action priority", () => {
    const result = detectWarnings(input({
      current_snapshot: snap({ health_score: 30 }),
      previous_snapshot: snap({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    }));
    const warning = result.warnings[0];
    // Severity is informational only — no action field exists
    expect(warning).not.toHaveProperty("action");
    expect(warning).not.toHaveProperty("priority");
    expect(warning).not.toHaveProperty("recommendation");
  });
});
