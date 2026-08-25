/**
 * P6-05D — Warning Engine Comprehensive Tests
 *
 * Covers:
 * - All 7 warning types (PD-05B-01)
 * - 5 severity levels (PD-05B-02)
 * - Multi-factor severity (PD-05B-03)
 * - Material thresholds (PD-05B-04)
 * - Occurrence-based identity (PD-05C-01)
 * - 4-state lifecycle (PD-05B-10)
 * - Deduplication
 * - Quality/freshness independence
 * - Provenance
 * - Determinism
 * - Edge cases
 */

import {
  detectWarnings,
  checkHealthThreshold,
  checkConfidenceThreshold,
  checkRegimeChangeThreshold,
  checkQualityThreshold,
  checkFreshnessThreshold,
  determineSeverity,
  selectHighestSeverity,
  evaluateHealthDeltaSeverity,
  evaluateRegimeContextSeverity,
  evaluateConfidenceContextSeverity,
  getBaselineSeverity,
  computeDedupKey,
  isDuplicate,
  isWithinCooldown,
  findWarningsToSupersede,
  buildWarningIdentity,
  isValidTransition,
  transitionLifecycle,
  determineInitialLifecycle,
  afterPersistence,
  isLifecycleNotQualityState,
  isLifecycleNotRegimeState,
  assembleWarningProvenance,
  assembleQualitySummary,
  assembleFreshnessSummary,
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
  WarningType,
  Severity,
} from "../types";

// ─── HELPERS ──────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<WarningSnapshotInput> = {}): WarningSnapshotInput {
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

function makeRegime(overrides: Partial<WarningRegimeInput> = {}): WarningRegimeInput {
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

function makeEngineInput(overrides: Partial<WarningEngineInput> = {}): WarningEngineInput {
  return {
    entity_type: "coin",
    entity_id: 1,
    current_snapshot: makeSnapshot(),
    previous_snapshot: makeSnapshot({
      snapshot_id: 0,
      health_score: 60,
      calculation_time: new Date("2025-01-14T00:00:00Z"),
      window_end: new Date("2025-01-14T00:00:00Z"),
    }),
    current_regime: makeRegime(),
    previous_regime: makeRegime({ previous_state: "STABLE" }),
    warning_version: WARNING_V1_VERSION,
    calculation_time: new Date("2025-01-15T00:00:00Z"),
    existing_active_warnings: [],
    ...overrides,
  };
}

function makeWarningRecord(overrides: Partial<WarningRecord> = {}): WarningRecord {
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

// ─── WARNING TYPES ────────────────────────────────────────────────

describe("P6-05D Warning Vocabulary (PD-05B-01)", () => {
  it("has exactly 7 warning types", () => {
    expect(ALL_WARNING_TYPES).toHaveLength(7);
  });

  it("includes all required types", () => {
    expect(ALL_WARNING_TYPES).toContain("HEALTH_DETERIORATION");
    expect(ALL_WARNING_TYPES).toContain("HEALTH_IMPROVEMENT");
    expect(ALL_WARNING_TYPES).toContain("REGIME_CHANGE");
    expect(ALL_WARNING_TYPES).toContain("REGIME_TRANSITION");
    expect(ALL_WARNING_TYPES).toContain("CONFIDENCE_DETERIORATION");
    expect(ALL_WARNING_TYPES).toContain("DATA_QUALITY_DEGRADATION");
    expect(ALL_WARNING_TYPES).toContain("FRESHNESS_DEGRADATION");
  });
});

// ─── SEVERITY ─────────────────────────────────────────────────────

describe("P6-05D Severity (PD-05B-02, PD-05B-03)", () => {
  it("has 5 ordinal severity levels", () => {
    expect(SEVERITY_RANK["INFO"]).toBe(0);
    expect(SEVERITY_RANK["LOW"]).toBe(1);
    expect(SEVERITY_RANK["MEDIUM"]).toBe(2);
    expect(SEVERITY_RANK["HIGH"]).toBe(3);
    expect(SEVERITY_RANK["CRITICAL"]).toBe(4);
  });

  it("selectHighestSeverity returns highest from factors", () => {
    const factors = [
      { factor: "health_delta" as const, severity: "LOW" as Severity, description: "test" },
      { factor: "regime_context" as const, severity: "HIGH" as Severity, description: "test" },
    ];
    expect(selectHighestSeverity(factors)).toBe("HIGH");
  });

  it("selectHighestSeverity returns INFO for empty factors", () => {
    expect(selectHighestSeverity([])).toBe("INFO");
  });

  it("evaluateHealthDeltaSeverity returns CRITICAL for ≥30", () => {
    const factor = evaluateHealthDeltaSeverity(-30, "STABLE");
    expect(factor?.severity).toBe("CRITICAL");
  });

  it("evaluateHealthDeltaSeverity returns HIGH for ≥20 + WEAK", () => {
    const factor = evaluateHealthDeltaSeverity(-20, "WEAK");
    expect(factor?.severity).toBe("HIGH");
  });

  it("evaluateHealthDeltaSeverity returns MEDIUM for ≥20 + STABLE", () => {
    const factor = evaluateHealthDeltaSeverity(-20, "STABLE");
    expect(factor?.severity).toBe("MEDIUM");
  });

  it("evaluateHealthDeltaSeverity returns MEDIUM for ≥10 + WEAK", () => {
    const factor = evaluateHealthDeltaSeverity(-10, "WEAK");
    expect(factor?.severity).toBe("MEDIUM");
  });

  it("evaluateHealthDeltaSeverity returns LOW for ≥10 + STABLE", () => {
    const factor = evaluateHealthDeltaSeverity(-10, "STABLE");
    expect(factor?.severity).toBe("LOW");
  });

  it("evaluateHealthDeltaSeverity returns INFO for ≥5", () => {
    const factor = evaluateHealthDeltaSeverity(-5, "STABLE");
    expect(factor?.severity).toBe("INFO");
  });

  it("evaluateHealthDeltaSeverity returns null for <5", () => {
    const factor = evaluateHealthDeltaSeverity(-3, "STABLE");
    expect(factor).toBeNull();
  });

  it("evaluateHealthDeltaSeverity handles positive deltas (improvement)", () => {
    const factor = evaluateHealthDeltaSeverity(30, "STABLE");
    expect(factor?.severity).toBe("CRITICAL");
  });

  it("evaluateRegimeContextSeverity returns HIGH for deterioration to WEAK", () => {
    const factor = evaluateRegimeContextSeverity("REGIME_CHANGE", "WEAK", "STABLE");
    expect(factor?.severity).toBe("HIGH");
  });

  it("evaluateRegimeContextSeverity returns MEDIUM for improvement to STABLE", () => {
    const factor = evaluateRegimeContextSeverity("REGIME_CHANGE", "STABLE", "WEAK");
    expect(factor?.severity).toBe("MEDIUM");
  });

  it("evaluateRegimeContextSeverity returns LOW for improvement to STRONG", () => {
    const factor = evaluateRegimeContextSeverity("REGIME_CHANGE", "STRONG", "STABLE");
    expect(factor?.severity).toBe("LOW");
  });

  it("evaluateRegimeContextSeverity returns MEDIUM for REGIME_TRANSITION", () => {
    const factor = evaluateRegimeContextSeverity("REGIME_TRANSITION", "TRANSITIONING", "STABLE");
    expect(factor?.severity).toBe("MEDIUM");
  });

  it("evaluateConfidenceContextSeverity returns MEDIUM for <30", () => {
    const factor = evaluateConfidenceContextSeverity(25);
    expect(factor?.severity).toBe("MEDIUM");
  });

  it("evaluateConfidenceContextSeverity returns LOW for <50", () => {
    const factor = evaluateConfidenceContextSeverity(40);
    expect(factor?.severity).toBe("LOW");
  });

  it("evaluateConfidenceContextSeverity returns null for ≥50", () => {
    const factor = evaluateConfidenceContextSeverity(60);
    expect(factor).toBeNull();
  });

  it("getBaselineSeverity returns correct baselines", () => {
    expect(getBaselineSeverity("HEALTH_DETERIORATION").severity).toBe("LOW");
    expect(getBaselineSeverity("HEALTH_IMPROVEMENT").severity).toBe("INFO");
    expect(getBaselineSeverity("REGIME_CHANGE").severity).toBe("MEDIUM");
    expect(getBaselineSeverity("REGIME_TRANSITION").severity).toBe("MEDIUM");
    expect(getBaselineSeverity("CONFIDENCE_DETERIORATION").severity).toBe("LOW");
    expect(getBaselineSeverity("DATA_QUALITY_DEGRADATION").severity).toBe("INFO");
    expect(getBaselineSeverity("FRESHNESS_DEGRADATION").severity).toBe("INFO");
  });

  it("determineSeverity is deterministic", () => {
    const current = makeSnapshot({ health_score: 50 });
    const previous = makeSnapshot({ health_score: 70 });

    const result1 = determineSeverity("HEALTH_DETERIORATION", -20, "STABLE", "STABLE", 70, current, previous);
    const result2 = determineSeverity("HEALTH_DETERIORATION", -20, "STABLE", "STABLE", 70, current, previous);

    expect(result1.severity).toBe(result2.severity);
    expect(result1.factors.length).toBe(result2.factors.length);
  });

  it("determineSeverity highest-wins behavior", () => {
    const current = makeSnapshot({ health_score: 30 });
    const previous = makeSnapshot({ health_score: 70 });

    // health delta = -40 → CRITICAL, regime = STABLE → MEDIUM, confidence = 70 → null
    const { severity, factors } = determineSeverity(
      "HEALTH_DETERIORATION", -40, "STABLE", "STABLE", 70, current, previous
    );

    expect(severity).toBe("CRITICAL");
    expect(factors.some((f) => f.severity === "CRITICAL")).toBe(true);
  });
});

// ─── THRESHOLDS ───────────────────────────────────────────────────

describe("P6-05D Thresholds (PD-05B-04)", () => {
  it("health threshold triggers at ≥10 points", () => {
    const current = makeSnapshot({ health_score: 50 });
    const previous = makeSnapshot({ health_score: 60 });

    const result = checkHealthThreshold(current, previous);
    expect(result.triggered).toBe(true);
    expect(result.delta).toBe(-10);
  });

  it("health threshold triggers at exactly 10 points (inclusive)", () => {
    const current = makeSnapshot({ health_score: 50 });
    const previous = makeSnapshot({ health_score: 60 });

    const result = checkHealthThreshold(current, previous);
    expect(result.triggered).toBe(true);
  });

  it("health threshold does not trigger at 9 points", () => {
    const current = makeSnapshot({ health_score: 51 });
    const previous = makeSnapshot({ health_score: 60 });

    const result = checkHealthThreshold(current, previous);
    expect(result.triggered).toBe(false);
  });

  it("health threshold triggers for positive delta (improvement)", () => {
    const current = makeSnapshot({ health_score: 80 });
    const previous = makeSnapshot({ health_score: 60 });

    const result = checkHealthThreshold(current, previous);
    expect(result.triggered).toBe(true);
    expect(result.delta).toBe(20);
  });

  it("health threshold returns false with no previous snapshot", () => {
    const current = makeSnapshot({ health_score: 50 });
    const result = checkHealthThreshold(current, null);
    expect(result.triggered).toBe(false);
  });

  it("confidence threshold triggers at ≥20 points drop", () => {
    const current = makeRegime({ confidence: 50 });
    const previous = makeRegime({ confidence: 70 });

    const result = checkConfidenceThreshold(current, previous);
    expect(result.triggered).toBe(true);
    expect(result.delta).toBe(-20);
  });

  it("confidence threshold does not trigger on improvement", () => {
    const current = makeRegime({ confidence: 90 });
    const previous = makeRegime({ confidence: 70 });

    const result = checkConfidenceThreshold(current, previous);
    expect(result.triggered).toBe(false);
  });

  it("confidence threshold returns false with missing regime data", () => {
    const result = checkConfidenceThreshold(null, null);
    expect(result.triggered).toBe(false);
  });

  it("regime change triggers on state change", () => {
    const current = makeRegime({ regime_state: "WEAK", previous_state: "STABLE" });
    const previous = makeRegime({ regime_state: "STABLE", previous_state: "STABLE" });

    const result = checkRegimeChangeThreshold(current, previous);
    expect(result.regimeChange.triggered).toBe(true);
  });

  it("regime transition triggers on entering TRANSITIONING", () => {
    const current = makeRegime({ regime_state: "TRANSITIONING", previous_state: "STABLE" });
    const previous = makeRegime({ regime_state: "STABLE", previous_state: "STABLE" });

    const result = checkRegimeChangeThreshold(current, previous);
    expect(result.regimeTransition.triggered).toBe(true);
  });

  it("regime does not trigger when state unchanged", () => {
    const current = makeRegime({ regime_state: "STABLE", previous_state: "STABLE" });
    const previous = makeRegime({ regime_state: "STABLE", previous_state: "STABLE" });

    const result = checkRegimeChangeThreshold(current, previous);
    expect(result.regimeChange.triggered).toBe(false);
    expect(result.regimeTransition.triggered).toBe(false);
  });

  it("quality threshold triggers on VALID→INVALID", () => {
    const current = makeSnapshot({ quality_status: "INVALID" });
    const previous = makeSnapshot({ quality_status: "VALID" });

    const result = checkQualityThreshold(current, previous);
    expect(result.triggered).toBe(true);
  });

  it("quality threshold does not trigger on VALID→VALID", () => {
    const current = makeSnapshot({ quality_status: "VALID" });
    const previous = makeSnapshot({ quality_status: "VALID" });

    const result = checkQualityThreshold(current, previous);
    expect(result.triggered).toBe(false);
  });

  it("freshness threshold triggers on FRESH→STALE", () => {
    const current = makeSnapshot({ freshness_status: "STALE" });
    const previous = makeSnapshot({ freshness_status: "FRESH" });

    const result = checkFreshnessThreshold(current, previous);
    expect(result.triggered).toBe(true);
  });

  it("freshness threshold does not trigger on FRESH→FRESH", () => {
    const current = makeSnapshot({ freshness_status: "FRESH" });
    const previous = makeSnapshot({ freshness_status: "FRESH" });

    const result = checkFreshnessThreshold(current, previous);
    expect(result.triggered).toBe(false);
  });
});

// ─── IDENTITY / DEDUPLICATION ─────────────────────────────────────

describe("P6-05D Identity & Deduplication (PD-05C-01)", () => {
  it("computeDedupKey produces deterministic key", () => {
    const identity = buildWarningIdentity("coin", 1, "HEALTH_DETERIORATION", new Date("2025-01-15"));
    const key1 = computeDedupKey(identity);
    const key2 = computeDedupKey(identity);
    expect(key1).toBe(key2);
  });

  it("different detection windows produce different dedup keys", () => {
    const id1 = buildWarningIdentity("coin", 1, "HEALTH_DETERIORATION", new Date("2025-01-15"));
    const id2 = buildWarningIdentity("coin", 1, "HEALTH_DETERIORATION", new Date("2025-01-16"));
    expect(computeDedupKey(id1)).not.toBe(computeDedupKey(id2));
  });

  it("different warning types produce different dedup keys", () => {
    const id1 = buildWarningIdentity("coin", 1, "HEALTH_DETERIORATION", new Date("2025-01-15"));
    const id2 = buildWarningIdentity("coin", 1, "REGIME_CHANGE", new Date("2025-01-15"));
    expect(computeDedupKey(id1)).not.toBe(computeDedupKey(id2));
  });

  it("different entities produce different dedup keys", () => {
    const id1 = buildWarningIdentity("coin", 1, "HEALTH_DETERIORATION", new Date("2025-01-15"));
    const id2 = buildWarningIdentity("coin", 2, "HEALTH_DETERIORATION", new Date("2025-01-15"));
    expect(computeDedupKey(id1)).not.toBe(computeDedupKey(id2));
  });

  it("isDuplicate returns true for same dedup key with ACTIVE warning", () => {
    const key = "coin:1:HEALTH_DETERIORATION:2025-01-15T00:00:00.000Z";
    const existing = [makeWarningRecord({ dedup_key: key, lifecycle: "ACTIVE" })];
    expect(isDuplicate(key, existing)).toBe(true);
  });

  it("isDuplicate returns false for different dedup key", () => {
    const key = "coin:1:HEALTH_DETERIORATION:2025-01-15T00:00:00.000Z";
    const otherKey = "coin:1:HEALTH_DETERIORATION:2025-01-16T00:00:00.000Z";
    const existing = [makeWarningRecord({ dedup_key: otherKey, lifecycle: "ACTIVE" })];
    expect(isDuplicate(key, existing)).toBe(false);
  });

  it("isDuplicate returns false for SUPERSEDED warning with same key", () => {
    const key = "coin:1:HEALTH_DETERIORATION:2025-01-15T00:00:00.000Z";
    const existing = [makeWarningRecord({ dedup_key: key, lifecycle: "SUPERSEDED" })];
    expect(isDuplicate(key, existing)).toBe(false);
  });

  it("isWithinCooldown returns true within 24h for same detection window", () => {
    const window = new Date("2025-01-15T12:00:00Z");
    const detectedAt = new Date("2025-01-15T00:00:00Z");
    const dedupKey = computeDedupKey(buildWarningIdentity("coin", 1, "HEALTH_DETERIORATION", window));
    const existing = [makeWarningRecord({
      entity_type: "coin",
      entity_id: 1,
      warning_type: "HEALTH_DETERIORATION",
      detected_at: detectedAt,
      dedup_key: dedupKey,
      lifecycle: "ACTIVE",
    })];
    expect(isWithinCooldown("coin", 1, "HEALTH_DETERIORATION", window, existing)).toBe(true);
  });

  it("isWithinCooldown returns false after 24h for same detection window", () => {
    const window = new Date("2025-01-17T00:00:00Z");
    const detectedAt = new Date("2025-01-15T00:00:00Z");
    const dedupKey = computeDedupKey(buildWarningIdentity("coin", 1, "HEALTH_DETERIORATION", window));
    const existing = [makeWarningRecord({
      entity_type: "coin",
      entity_id: 1,
      warning_type: "HEALTH_DETERIORATION",
      detected_at: detectedAt,
      dedup_key: dedupKey,
      lifecycle: "ACTIVE",
    })];
    expect(isWithinCooldown("coin", 1, "HEALTH_DETERIORATION", window, existing)).toBe(false);
  });

  it("findWarningsToSupersede returns ACTIVE warnings of same type", () => {
    const existing = [
      makeWarningRecord({ warning_type: "HEALTH_DETERIORATION", lifecycle: "ACTIVE" }),
      makeWarningRecord({ id: 2, warning_type: "REGIME_CHANGE", lifecycle: "ACTIVE" }),
    ];
    const toSupersede = findWarningsToSupersede("coin", 1, "HEALTH_DETERIORATION", existing);
    expect(toSupersede).toHaveLength(1);
    expect(toSupersede[0].warning_type).toBe("HEALTH_DETERIORATION");
  });
});

// ─── LIFECYCLE ────────────────────────────────────────────────────

describe("P6-05D Lifecycle (PD-05B-10)", () => {
  it("DETECTED → ACTIVE is valid", () => {
    expect(isValidTransition("DETECTED", "ACTIVE")).toBe(true);
  });

  it("DETECTED → RESOLVED is valid", () => {
    expect(isValidTransition("DETECTED", "RESOLVED")).toBe(true);
  });

  it("ACTIVE → RESOLVED is valid", () => {
    expect(isValidTransition("ACTIVE", "RESOLVED")).toBe(true);
  });

  it("ACTIVE → SUPERSEDED is valid", () => {
    expect(isValidTransition("ACTIVE", "SUPERSEDED")).toBe(true);
  });

  it("RESOLVED → any is invalid (terminal)", () => {
    expect(isValidTransition("RESOLVED", "ACTIVE")).toBe(false);
    expect(isValidTransition("RESOLVED", "SUPERSEDED")).toBe(false);
  });

  it("SUPERSEDED → any is invalid (terminal)", () => {
    expect(isValidTransition("SUPERSEDED", "ACTIVE")).toBe(false);
    expect(isValidTransition("SUPERSEDED", "RESOLVED")).toBe(false);
  });

  it("transitionLifecycle throws on invalid transition", () => {
    expect(() => transitionLifecycle("RESOLVED", "ACTIVE")).toThrow();
  });

  it("transitionLifecycle returns target on valid transition", () => {
    expect(transitionLifecycle("DETECTED", "ACTIVE")).toBe("ACTIVE");
  });

  it("determineInitialLifecycle returns DETECTED", () => {
    expect(determineInitialLifecycle()).toBe("DETECTED");
  });

  it("afterPersistence returns ACTIVE", () => {
    expect(afterPersistence()).toBe("ACTIVE");
  });

  it("ESCALATED is not a valid lifecycle state", () => {
    expect(isValidTransition("DETECTED", "ESCALATED" as any)).toBe(false);
  });

  it("lifecycle states are not QualityState", () => {
    expect(isLifecycleNotQualityState("DETECTED")).toBe(true);
    expect(isLifecycleNotQualityState("ACTIVE")).toBe(true);
    expect(isLifecycleNotQualityState("RESOLVED")).toBe(true);
    expect(isLifecycleNotQualityState("SUPERSEDED")).toBe(true);
  });

  it("lifecycle states are not RegimeState", () => {
    expect(isLifecycleNotRegimeState("DETECTED")).toBe(true);
    expect(isLifecycleNotRegimeState("ACTIVE")).toBe(true);
    expect(isLifecycleNotRegimeState("RESOLVED")).toBe(true);
    expect(isLifecycleNotRegimeState("SUPERSEDED")).toBe(true);
  });
});

// ─── ENGINE ───────────────────────────────────────────────────────

describe("P6-05D Engine", () => {
  it("generates no warnings with no previous snapshot", () => {
    const input = makeEngineInput({ previous_snapshot: null });
    const result = detectWarnings(input);
    expect(result.warnings).toHaveLength(0);
  });

  it("generates HEALTH_DETERIORATION for significant drop", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 50 }),
      previous_snapshot: makeSnapshot({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result = detectWarnings(input);
    expect(result.warnings.some((w) => w.warning_type === "HEALTH_DETERIORATION")).toBe(true);
  });

  it("generates HEALTH_IMPROVEMENT for significant rise", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 90 }),
      previous_snapshot: makeSnapshot({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result = detectWarnings(input);
    expect(result.warnings.some((w) => w.warning_type === "HEALTH_IMPROVEMENT")).toBe(true);
  });

  it("does not generate health warning for small delta", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 65 }),
      previous_snapshot: makeSnapshot({ health_score: 60, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result = detectWarnings(input);
    expect(result.warnings.some((w) =>
      w.warning_type === "HEALTH_DETERIORATION" || w.warning_type === "HEALTH_IMPROVEMENT"
    )).toBe(false);
  });

  it("generates REGIME_CHANGE on state change", () => {
    const input = makeEngineInput({
      current_regime: makeRegime({ regime_state: "WEAK", previous_state: "STABLE" }),
      previous_regime: makeRegime({ regime_state: "STABLE", previous_state: "STABLE" }),
    });
    const result = detectWarnings(input);
    expect(result.warnings.some((w) => w.warning_type === "REGIME_CHANGE")).toBe(true);
  });

  it("generates REGIME_TRANSITION on entering TRANSITIONING", () => {
    const input = makeEngineInput({
      current_regime: makeRegime({ regime_state: "TRANSITIONING", previous_state: "STABLE" }),
      previous_regime: makeRegime({ regime_state: "STABLE", previous_state: "STABLE" }),
    });
    const result = detectWarnings(input);
    expect(result.warnings.some((w) => w.warning_type === "REGIME_TRANSITION")).toBe(true);
  });

  it("does not generate regime warning when state unchanged", () => {
    const input = makeEngineInput({
      current_regime: makeRegime({ regime_state: "STABLE", previous_state: "STABLE" }),
      previous_regime: makeRegime({ regime_state: "STABLE", previous_state: "STABLE" }),
    });
    const result = detectWarnings(input);
    expect(result.warnings.some((w) =>
      w.warning_type === "REGIME_CHANGE" || w.warning_type === "REGIME_TRANSITION"
    )).toBe(false);
  });

  it("generates CONFIDENCE_DETERIORATION for significant drop", () => {
    const input = makeEngineInput({
      current_regime: makeRegime({ confidence: 40 }),
      previous_regime: makeRegime({ confidence: 70, previous_state: "STABLE" }),
    });
    const result = detectWarnings(input);
    expect(result.warnings.some((w) => w.warning_type === "CONFIDENCE_DETERIORATION")).toBe(true);
  });

  it("generates DATA_QUALITY_DEGRADATION on quality degradation", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ quality_status: "INVALID" }),
      previous_snapshot: makeSnapshot({ quality_status: "VALID", window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result = detectWarnings(input);
    expect(result.warnings.some((w) => w.warning_type === "DATA_QUALITY_DEGRADATION")).toBe(true);
  });

  it("generates FRESHNESS_DEGRADATION on freshness degradation", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ freshness_status: "STALE" }),
      previous_snapshot: makeSnapshot({ freshness_status: "FRESH", window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result = detectWarnings(input);
    expect(result.warnings.some((w) => w.warning_type === "FRESHNESS_DEGRADATION")).toBe(true);
  });

  it("can generate multiple warning types simultaneously", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 40, quality_status: "INVALID", freshness_status: "STALE" }),
      previous_snapshot: makeSnapshot({ health_score: 70, quality_status: "VALID", freshness_status: "FRESH", window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
      current_regime: makeRegime({ regime_state: "WEAK", confidence: 40 }),
      previous_regime: makeRegime({ regime_state: "STABLE", confidence: 70, previous_state: "STABLE" }),
    });
    const result = detectWarnings(input);
    expect(result.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it("deduplicates within same detection window", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 50 }),
      previous_snapshot: makeSnapshot({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
      existing_active_warnings: [
        makeWarningRecord({
          dedup_key: "coin:1:HEALTH_DETERIORATION:2025-01-15T00:00:00.000Z",
          lifecycle: "ACTIVE",
        }),
      ],
    });
    const result = detectWarnings(input);
    expect(result.warnings.some((w) => w.warning_type === "HEALTH_DETERIORATION")).toBe(false);
  });

  it("does not deduplicate across different detection windows", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 50, window_end: new Date("2025-01-16"), calculation_time: new Date("2025-01-16") }),
      previous_snapshot: makeSnapshot({ health_score: 70, window_end: new Date("2025-01-15"), calculation_time: new Date("2025-01-15") }),
      existing_active_warnings: [
        makeWarningRecord({
          dedup_key: "coin:1:HEALTH_DETERIORATION:2025-01-15T00:00:00.000Z",
          lifecycle: "ACTIVE",
        }),
      ],
    });
    const result = detectWarnings(input);
    expect(result.warnings.some((w) => w.warning_type === "HEALTH_DETERIORATION")).toBe(true);
  });

  it("supersedes existing warnings of same type", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 50 }),
      previous_snapshot: makeSnapshot({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
      existing_active_warnings: [
        makeWarningRecord({
          dedup_key: "coin:1:HEALTH_DETERIORATION:2025-01-14T00:00:00.000Z",
          lifecycle: "ACTIVE",
        }),
      ],
    });
    const result = detectWarnings(input);
    expect(result.warnings_to_supersede.length).toBeGreaterThanOrEqual(1);
  });

  it("warning has correct severity", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 30 }),
      previous_snapshot: makeSnapshot({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result = detectWarnings(input);
    const healthWarning = result.warnings.find((w) => w.warning_type === "HEALTH_DETERIORATION");
    expect(healthWarning).toBeDefined();
    expect(["MEDIUM", "HIGH", "CRITICAL"]).toContain(healthWarning!.severity);
  });

  it("warning has complete provenance", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 50 }),
      previous_snapshot: makeSnapshot({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result = detectWarnings(input);
    const warning = result.warnings[0];
    expect(warning.provenance.source_layer).toBe("P6-05");
    expect(warning.provenance.source_entity.entity_type).toBe("coin");
    expect(warning.provenance.source_entity.entity_id).toBe(1);
    expect(warning.provenance.health_score).toBe(50);
    expect(warning.provenance.previous_health_score).toBe(70);
  });

  it("warning has version tuple", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 50 }),
      previous_snapshot: makeSnapshot({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result = detectWarnings(input);
    const warning = result.warnings[0];
    expect(warning.provenance.warning_version.algorithm_version).toBe("p6-warning-v1");
  });

  it("engine is deterministic", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 50 }),
      previous_snapshot: makeSnapshot({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result1 = detectWarnings(input);
    const result2 = detectWarnings(input);
    expect(result1.warnings.length).toBe(result2.warnings.length);
    if (result1.warnings.length > 0) {
      expect(result1.warnings[0].severity).toBe(result2.warnings[0].severity);
      expect(result1.warnings[0].warning_type).toBe(result2.warnings[0].warning_type);
    }
  });
});

// ─── QUALITY / FRESHNESS INDEPENDENCE ─────────────────────────────

describe("P6-05D Quality & Freshness Independence", () => {
  it("INVALID input still generates health warning", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 50, quality_status: "INVALID" }),
      previous_snapshot: makeSnapshot({ health_score: 70, quality_status: "VALID", window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result = detectWarnings(input);
    // Should still generate health deterioration
    expect(result.warnings.some((w) => w.warning_type === "HEALTH_DETERIORATION")).toBe(true);
  });

  it("STALE input still generates health warning", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 50, freshness_status: "STALE" }),
      previous_snapshot: makeSnapshot({ health_score: 70, freshness_status: "FRESH", window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result = detectWarnings(input);
    expect(result.warnings.some((w) => w.warning_type === "HEALTH_DETERIORATION")).toBe(true);
  });

  it("quality metadata is preserved in warning", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({
        health_score: 50,
        quality_metadata: { source: "test" },
      }),
      previous_snapshot: makeSnapshot({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result = detectWarnings(input);
    const warning = result.warnings.find((w) => w.warning_type === "HEALTH_DETERIORATION");
    expect(warning?.quality_metadata).toEqual({ source: "test" });
  });

  it("freshness metadata is preserved in warning", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({
        health_score: 50,
        freshness_metadata: { last_update: "2025-01-15" },
      }),
      previous_snapshot: makeSnapshot({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result = detectWarnings(input);
    const warning = result.warnings.find((w) => w.warning_type === "HEALTH_DETERIORATION");
    expect(warning?.freshness_metadata).toEqual({ last_update: "2025-01-15" });
  });

  it("infrastructure failure does not become DATA_QUALITY_DEGRADATION", () => {
    // This tests that the engine doesn't convert null/error into quality warnings
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 50, quality_status: null }),
      previous_snapshot: makeSnapshot({ health_score: 70, quality_status: null, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result = detectWarnings(input);
    // No quality degradation warning should be generated when status is null on both
    expect(result.warnings.some((w) => w.warning_type === "DATA_QUALITY_DEGRADATION")).toBe(false);
  });
});

// ─── COIN/NARRATIVE SYMMETRY ──────────────────────────────────────

describe("P6-05D Coin/Narrative Symmetry (PD-05B-13)", () => {
  it("generates warnings for coins", () => {
    const input = makeEngineInput({
      entity_type: "coin",
      current_snapshot: makeSnapshot({ entity_type: "coin", health_score: 50 }),
      previous_snapshot: makeSnapshot({ entity_type: "coin", health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result = detectWarnings(input);
    expect(result.warnings.some((w) => w.warning_type === "HEALTH_DETERIORATION")).toBe(true);
  });

  it("generates warnings for narratives", () => {
    const input = makeEngineInput({
      entity_type: "narrative",
      current_snapshot: makeSnapshot({ entity_type: "narrative", health_score: 50 }),
      previous_snapshot: makeSnapshot({ entity_type: "narrative", health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result = detectWarnings(input);
    expect(result.warnings.some((w) => w.warning_type === "HEALTH_DETERIORATION")).toBe(true);
  });

  it("same input produces same severity for both entity types", () => {
    const coinInput = makeEngineInput({
      entity_type: "coin",
      current_snapshot: makeSnapshot({ entity_type: "coin", health_score: 50 }),
      previous_snapshot: makeSnapshot({ entity_type: "coin", health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const narrativeInput = makeEngineInput({
      entity_type: "narrative",
      current_snapshot: makeSnapshot({ entity_type: "narrative", health_score: 50 }),
      previous_snapshot: makeSnapshot({ entity_type: "narrative", health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const coinResult = detectWarnings(coinInput);
    const narrativeResult = detectWarnings(narrativeInput);

    const coinWarning = coinResult.warnings.find((w) => w.warning_type === "HEALTH_DETERIORATION");
    const narrativeWarning = narrativeResult.warnings.find((w) => w.warning_type === "HEALTH_DETERIORATION");

    expect(coinWarning?.severity).toBe(narrativeWarning?.severity);
  });
});

// ─── PROVENANCE ───────────────────────────────────────────────────

describe("P6-05D Provenance", () => {
  it("assembleWarningProvenance includes all required fields", () => {
    const snapshot = makeSnapshot();
    const provenance = assembleWarningProvenance({
      entityType: "coin",
      entityId: 1,
      sourceRecordId: null,
      currentSnapshot: snapshot,
      previousSnapshot: null,
      currentRegime: null,
      healthDelta: -20,
      warningVersion: WARNING_V1_VERSION,
      detectionTime: new Date(),
      detectionWindow: new Date(),
      qualitySummary: null,
      freshnessSummary: null,
    });

    expect(provenance.source_layer).toBe("P6-05");
    expect(provenance.source_entity.entity_type).toBe("coin");
    expect(provenance.source_entity.entity_id).toBe(1);
    expect(provenance.health_score).toBe(70);
    expect(provenance.health_delta).toBe(-20);
    expect(provenance.warning_version).toEqual(WARNING_V1_VERSION);
  });

  it("provenance has no fabricated IDs", () => {
    const provenance = assembleWarningProvenance({
      entityType: "coin",
      entityId: 1,
      sourceRecordId: null,
      currentSnapshot: makeSnapshot(),
      previousSnapshot: null,
      currentRegime: null,
      healthDelta: null,
      warningVersion: WARNING_V1_VERSION,
      detectionTime: new Date(),
      detectionWindow: new Date(),
      qualitySummary: null,
      freshnessSummary: null,
    });

    expect(provenance.source_record_id).toBeNull();
  });
});

// ─── EDGE CASES ───────────────────────────────────────────────────

describe("P6-05D Edge Cases", () => {
  it("handles empty existing warnings", () => {
    const input = makeEngineInput({
      existing_active_warnings: [],
    });
    const result = detectWarnings(input);
    expect(result.warnings).toBeDefined();
  });

  it("handles missing regime data", () => {
    const input = makeEngineInput({
      current_regime: null,
      previous_regime: null,
      current_snapshot: makeSnapshot({ health_score: 50 }),
      previous_snapshot: makeSnapshot({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result = detectWarnings(input);
    // Should still generate health warning
    expect(result.warnings.some((w) => w.warning_type === "HEALTH_DETERIORATION")).toBe(true);
  });

  it("handles health score exactly at boundary (50 vs 60 = exactly 10)", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 50 }),
      previous_snapshot: makeSnapshot({ health_score: 60, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result = detectWarnings(input);
    expect(result.warnings.some((w) => w.warning_type === "HEALTH_DETERIORATION")).toBe(true);
  });

  it("does not generate warning for health delta of exactly 9", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 51 }),
      previous_snapshot: makeSnapshot({ health_score: 60, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result = detectWarnings(input);
    expect(result.warnings.some((w) =>
      w.warning_type === "HEALTH_DETERIORATION" || w.warning_type === "HEALTH_IMPROVEMENT"
    )).toBe(false);
  });

  it("handles repeated same input (idempotent dedup)", () => {
    const input = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 50 }),
      previous_snapshot: makeSnapshot({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });
    const result1 = detectWarnings(input);
    // Simulate second evaluation with same active warning
    const input2 = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 50 }),
      previous_snapshot: makeSnapshot({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
      existing_active_warnings: result1.warnings.map((w) => makeWarningRecord({
        dedup_key: w.dedup_key,
        lifecycle: "ACTIVE",
        warning_type: w.warning_type,
      })),
    });
    const result2 = detectWarnings(input2);
    // Second evaluation should produce no new warnings (dedup)
    expect(result2.warnings).toHaveLength(0);
  });

  it("handles long repeated sequences", () => {
    let input = makeEngineInput({
      current_snapshot: makeSnapshot({ health_score: 50 }),
      previous_snapshot: makeSnapshot({ health_score: 70, window_end: new Date("2025-01-14"), calculation_time: new Date("2025-01-14") }),
    });

    const allWarnings: WarningRecord[] = [];

    // Run 10 evaluations
    for (let i = 0; i < 10; i++) {
      const result = detectWarnings(input, DEFAULT_WARNING_CONFIG);
      // Convert candidates to records for next iteration's existing warnings
      for (const w of result.warnings) {
        allWarnings.push(makeWarningRecord({
          dedup_key: w.dedup_key,
          warning_type: w.warning_type,
          lifecycle: "ACTIVE",
        }));
      }
      input = {
        ...input,
        existing_active_warnings: allWarnings,
      };
    }

    // After first iteration, all subsequent should be deduplicated
    // Only the first iteration produces warnings
    expect(allWarnings.length).toBeGreaterThanOrEqual(1);
  });
});
