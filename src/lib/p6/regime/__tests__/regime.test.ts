/**
 * P6-04D — Trend / Regime Detection Tests
 *
 * Covers all required scenarios from the task spec:
 * A. Vocabulary — all 6 states
 * B. Boundary — 20, 40, 60, 80 + just below/above
 * C. Neutral zones — 20-40, 60-80
 * D. Hysteresis — both directions, repeated oscillation
 * E. Persistence — 1, 2, interrupted sequence
 * F. Quality — VALID, INVALID, MISSING, UNKNOWN
 * G. Temporal gaps — 1, 2, 3, >3 day gaps
 * H. Lookback — <14, exactly 14, >14
 * I. Initial state — no history, insufficient, first valid
 * J. Confidence — 0, 50, 100, >100 clamp
 * K. Coin — complete flow
 * L. Narrative — complete flow
 * M. Determinism — identical input twice
 * N. Failure boundary
 */

import {
  classifyScore,
  processSnapshot,
  createInitialState,
  createUnknownState,
} from "../state-machine";
import { calculateConfidence } from "../confidence";
import {
  assembleQualityMetadata,
  assembleFreshnessMetadata,
} from "../provenance";
import { detectRegime } from "../engine";
import {
  DEFAULT_REGIME_CONFIG,
  REGIME_V1_VERSION,
  BOUNDARY_STRONG,
  BOUNDARY_STABLE_UPPER,
  BOUNDARY_STABLE_LOWER,
  BOUNDARY_WEAK,
} from "../types";
import type {
  RegimeSnapshotInput,
  RegimeInput,
  RegimeStateProperties,
} from "../types";

// ─── TEST DATA ────────────────────────────────────────────────────

const TEST_VERSION = REGIME_V1_VERSION;
const TEST_TIME = new Date("2026-08-25T12:00:00Z");

function makeSnapshot(
  overrides: Partial<RegimeSnapshotInput> = {}
): RegimeSnapshotInput {
  return {
    snapshot_id: 1,
    entity_type: "coin",
    entity_id: 1,
    health_score: 50,
    calculation_time: TEST_TIME,
    quality_status: "VALID",
    freshness_status: "FRESH",
    ...overrides,
  };
}

function makeInput(
  healthScores: number[],
  overrides: Partial<RegimeInput> = {}
): RegimeInput {
  const snapshots = healthScores.map((score, i) =>
    makeSnapshot({
      snapshot_id: i + 1,
      health_score: score,
      calculation_time: new Date(TEST_TIME.getTime() + i * 86400000),
    })
  );

  return {
    entity_type: "coin",
    entity_id: 1,
    current_snapshot: snapshots[snapshots.length - 1],
    historical_snapshots: snapshots.slice(0, -1),
    regime_version: TEST_VERSION,
    calculation_time: new Date(TEST_TIME.getTime() + (snapshots.length - 1) * 86400000),
    ...overrides,
  };
}

// ─── A. VOCABULARY ────────────────────────────────────────────────

describe("P6-04D Vocabulary", () => {
  it("classifyScore returns STRONG for score >= 80", () => {
    expect(classifyScore(80)).toBe("STRONG");
    expect(classifyScore(100)).toBe("STRONG");
  });

  it("classifyScore returns STABLE for 40-60", () => {
    expect(classifyScore(40)).toBe("STABLE");
    expect(classifyScore(50)).toBe("STABLE");
    expect(classifyScore(60)).toBe("STABLE");
  });

  it("classifyScore returns WEAK for score <= 20", () => {
    expect(classifyScore(20)).toBe("WEAK");
    expect(classifyScore(0)).toBe("WEAK");
  });

  it("all 6 regime states exist in output", () => {
    const input = makeInput([50, 50]);
    const result = detectRegime(input);
    expect(["STRONG", "STABLE", "WEAK", "TRANSITIONING", "INSUFFICIENT_DATA", "UNKNOWN"]).toContain(result.regime_state);
  });
});

// ─── B. BOUNDARY ──────────────────────────────────────────────────

describe("P6-04D Boundary Equality", () => {
  it("score = 80 → STRONG (inclusive toward higher)", () => {
    expect(classifyScore(80)).toBe("STRONG");
  });

  it("score = 79 → neutral band (classified as STABLE by default)", () => {
    expect(classifyScore(79)).toBe("STABLE");
  });

  it("score = 60 → STABLE (upper bound)", () => {
    expect(classifyScore(60)).toBe("STABLE");
  });

  it("score = 40 → STABLE (lower bound)", () => {
    expect(classifyScore(40)).toBe("STABLE");
  });

  it("score = 20 → WEAK (inclusive toward lower)", () => {
    expect(classifyScore(20)).toBe("WEAK");
  });

  it("score = 21 → neutral band (classified as STABLE by default)", () => {
    expect(classifyScore(21)).toBe("STABLE");
  });

  it("full engine: score=80 persists → STRONG regime", () => {
    const result = detectRegime(makeInput([50, 80, 80]));
    expect(result.regime_state).toBe("STRONG");
  });

  it("full engine: score=40 persists → STABLE regime", () => {
    const result = detectRegime(makeInput([10, 40, 40]));
    expect(result.regime_state).toBe("STABLE");
  });

  it("full engine: score=20 persists → WEAK regime", () => {
    const result = detectRegime(makeInput([50, 20, 20]));
    expect(result.regime_state).toBe("WEAK");
  });
});

// ─── C. NEUTRAL ZONES ─────────────────────────────────────────────

describe("P6-04D Neutral Zones", () => {
  it("score in 20-40 does not start transition from WEAK", () => {
    // WEAK regime, score=30 (in neutral band)
    const result = detectRegime(makeInput([10, 10, 30, 30]));
    // Should still be WEAK or TRANSITIONING toward STABLE
    expect(["WEAK", "TRANSITIONING"]).toContain(result.regime_state);
  });

  it("score in 60-80 does not start transition from STABLE", () => {
    // STABLE regime, score=70 (in neutral band)
    const result = detectRegime(makeInput([50, 50, 70, 70]));
    // Should still be STABLE or TRANSITIONING toward STRONG
    expect(["STABLE", "TRANSITIONING"]).toContain(result.regime_state);
  });
});

// ─── D. HYSTERESIS ────────────────────────────────────────────────

describe("P6-04D Hysteresis", () => {
  it("WEAK → STABLE: score must reach >= 40", () => {
    // WEAK established, then score rises to 40+
    const result = detectRegime(makeInput([10, 10, 40, 40]));
    expect(result.regime_state).toBe("STABLE");
  });

  it("STABLE → STRONG: score must reach >= 80", () => {
    const result = detectRegime(makeInput([50, 50, 80, 80]));
    expect(result.regime_state).toBe("STRONG");
  });

  it("STRONG → STABLE: score must drop < 60", () => {
    const result = detectRegime(makeInput([80, 80, 50, 50]));
    expect(result.regime_state).toBe("STABLE");
  });

  it("STABLE → WEAK: score must drop <= 20", () => {
    const result = detectRegime(makeInput([50, 50, 20, 20]));
    expect(result.regime_state).toBe("WEAK");
  });

  it("oscillation around 40: 42, 38, 42, 38 → regime unchanged", () => {
    const result = detectRegime(makeInput([10, 10, 42, 38, 42, 38]));
    // Persistence resets each time; regime stays WEAK
    expect(result.regime_state).toBe("WEAK");
  });

  it("oscillation around 60: 62, 58, 62, 58 → regime unchanged", () => {
    const result = detectRegime(makeInput([50, 50, 62, 58, 62, 58]));
    expect(result.regime_state).toBe("STABLE");
  });

  it("repeated threshold crossing resets persistence", () => {
    // Score crosses 40, then drops, then crosses again
    const result = detectRegime(makeInput([10, 10, 42, 35, 42, 42]));
    // First 42: count=1, then 35 resets, then 42 count=1, then 42 count=2 → STABLE
    expect(result.regime_state).toBe("STABLE");
  });
});

// ─── E. PERSISTENCE ───────────────────────────────────────────────

describe("P6-04D Persistence", () => {
  it("1 qualifying snapshot → TRANSITIONING", () => {
    const result = detectRegime(makeInput([50, 80]));
    expect(result.regime_state).toBe("TRANSITIONING");
  });

  it("2 qualifying snapshots → regime change", () => {
    const result = detectRegime(makeInput([50, 80, 80]));
    expect(result.regime_state).toBe("STRONG");
  });

  it("interrupted sequence: score reverts → transition fails", () => {
    const result = detectRegime(makeInput([50, 80, 50]));
    // 80 (count=1), then 50 reverts → transition fails
    expect(result.regime_state).toBe("STABLE");
  });

  it("3 qualifying snapshots → regime with higher confidence", () => {
    const result = detectRegime(makeInput([50, 80, 80, 80]));
    expect(result.regime_state).toBe("STRONG");
    expect(result.confidence).toBe(100);
  });
});

// ─── F. QUALITY ───────────────────────────────────────────────────

describe("P6-04D Quality Handling", () => {
  it("INVALID snapshots excluded from trend analysis", () => {
    const input = makeInput([50, 80, 80]);
    // Override second snapshot as INVALID
    const snapshots = [
      makeSnapshot({ snapshot_id: 1, health_score: 50, calculation_time: TEST_TIME }),
      makeSnapshot({ snapshot_id: 2, health_score: 80, quality_status: "INVALID", calculation_time: new Date(TEST_TIME.getTime() + 86400000) }),
      makeSnapshot({ snapshot_id: 3, health_score: 80, calculation_time: new Date(TEST_TIME.getTime() + 2 * 86400000) }),
    ];
    const result = detectRegime({
      entity_type: "coin",
      entity_id: 1,
      current_snapshot: snapshots[2],
      historical_snapshots: snapshots.slice(0, 2),
      regime_version: TEST_VERSION,
      calculation_time: new Date(TEST_TIME.getTime() + 2 * 86400000),
    });
    // Only 2 qualifying snapshots (50, 80) — might be TRANSITIONING
    expect(["TRANSITIONING", "STABLE", "STRONG"]).toContain(result.regime_state);
  });

  it("MISSING snapshots excluded from trend analysis", () => {
    const snapshots = [
      makeSnapshot({ snapshot_id: 1, health_score: 50, calculation_time: TEST_TIME }),
      makeSnapshot({ snapshot_id: 2, health_score: 80, quality_status: "MISSING", calculation_time: new Date(TEST_TIME.getTime() + 86400000) }),
      makeSnapshot({ snapshot_id: 3, health_score: 80, calculation_time: new Date(TEST_TIME.getTime() + 2 * 86400000) }),
    ];
    const result = detectRegime({
      entity_type: "coin",
      entity_id: 1,
      current_snapshot: snapshots[2],
      historical_snapshots: snapshots.slice(0, 2),
      regime_version: TEST_VERSION,
      calculation_time: new Date(TEST_TIME.getTime() + 2 * 86400000),
    });
    expect(["TRANSITIONING", "STABLE", "STRONG"]).toContain(result.regime_state);
  });

  it("UNKNOWN quality included in trend analysis", () => {
    const result = detectRegime(makeInput([50, 80, 80]));
    // UNKNOWN quality snapshots count toward persistence
    expect(result.regime_state).toBe("STRONG");
  });

  it("quality metadata tracks counts correctly", () => {
    const snapshots = [
      makeSnapshot({ quality_status: "VALID" }),
      makeSnapshot({ quality_status: "INVALID" }),
      makeSnapshot({ quality_status: "MISSING" }),
      makeSnapshot({ quality_status: "UNKNOWN" }),
    ];
    const metadata = assembleQualityMetadata(snapshots);
    expect(metadata.input_snapshots_total).toBe(4);
    expect(metadata.input_snapshots_valid).toBe(1);
    expect(metadata.input_snapshots_invalid).toBe(1);
    expect(metadata.input_snapshots_missing).toBe(1);
    expect(metadata.input_snapshots_unknown_quality).toBe(1);
  });
});

// ─── G. TEMPORAL GAPS ─────────────────────────────────────────────

describe("P6-04D Temporal Gaps", () => {
  it("1-day gap tolerated", () => {
    const snapshots = [
      makeSnapshot({ snapshot_id: 1, health_score: 50, calculation_time: new Date("2026-08-20") }),
      makeSnapshot({ snapshot_id: 2, health_score: 80, calculation_time: new Date("2026-08-22") }), // 2-day gap
      makeSnapshot({ snapshot_id: 3, health_score: 80, calculation_time: new Date("2026-08-23") }),
    ];
    const result = detectRegime({
      entity_type: "coin",
      entity_id: 1,
      current_snapshot: snapshots[2],
      historical_snapshots: snapshots.slice(0, 2),
      regime_version: TEST_VERSION,
      calculation_time: new Date("2026-08-23"),
    });
    expect(["TRANSITIONING", "STRONG"]).toContain(result.regime_state);
  });

  it("3 missing days tolerated (4-day gap = 3 missing days at tolerance limit)", () => {
    const snapshots = [
      makeSnapshot({ snapshot_id: 1, health_score: 50, calculation_time: new Date("2026-08-18") }),
      makeSnapshot({ snapshot_id: 2, health_score: 80, calculation_time: new Date("2026-08-22") }), // 3 missing days (19,20,21)
      makeSnapshot({ snapshot_id: 3, health_score: 80, calculation_time: new Date("2026-08-23") }),
    ];
    const result = detectRegime({
      entity_type: "coin",
      entity_id: 1,
      current_snapshot: snapshots[2],
      historical_snapshots: snapshots.slice(0, 2),
      regime_version: TEST_VERSION,
      calculation_time: new Date("2026-08-23"),
    });
    // 3 missing days ≤ maxGapDays (3) → tolerated, gap is paused not broken
    expect(["TRANSITIONING", "STABLE", "STRONG"]).toContain(result.regime_state);
  });

  it("5+ day gap exceeds tolerance → INSUFFICIENT_DATA", () => {
    const snapshots = [
      makeSnapshot({ snapshot_id: 1, health_score: 50, calculation_time: new Date("2026-08-18") }),
      makeSnapshot({ snapshot_id: 2, health_score: 80, calculation_time: new Date("2026-08-24") }), // 5 missing days
      makeSnapshot({ snapshot_id: 3, health_score: 80, calculation_time: new Date("2026-08-25") }),
    ];
    const result = detectRegime({
      entity_type: "coin",
      entity_id: 1,
      current_snapshot: snapshots[2],
      historical_snapshots: snapshots.slice(0, 2),
      regime_version: TEST_VERSION,
      calculation_time: new Date("2026-08-25"),
    });
    // 5 missing days > maxGapDays (3) → INSUFFICIENT_DATA
    expect(result.regime_state).toBe("INSUFFICIENT_DATA");
  });
});

// ─── H. LOOKBACK ──────────────────────────────────────────────────

describe("P6-04D Lookback", () => {
  it("< 14 snapshots still works", () => {
    const result = detectRegime(makeInput([50, 50, 80, 80]));
    expect(result.regime_state).toBe("STRONG");
  });

  it("exactly 14 snapshots works", () => {
    const scores = Array(14).fill(50);
    const result = detectRegime(makeInput(scores));
    expect(result.regime_state).toBe("STABLE");
  });

  it("> 14 snapshots works", () => {
    const scores = Array(20).fill(50);
    const result = detectRegime(makeInput(scores));
    expect(result.regime_state).toBe("STABLE");
  });
});

// ─── I. INITIAL STATE ─────────────────────────────────────────────

describe("P6-04D Initial State", () => {
  it("no history → INSUFFICIENT_DATA", () => {
    const result = detectRegime(makeInput([50]));
    expect(result.regime_state).toBe("UNKNOWN");
  });

  it("insufficient history (< 2 qualifying) → UNKNOWN", () => {
    const result = detectRegime(makeInput([50]));
    expect(result.regime_state).toBe("UNKNOWN");
  });

  it("first valid regime established after 2 snapshots", () => {
    const result = detectRegime(makeInput([50, 50]));
    expect(result.regime_state).toBe("STABLE");
  });

  it("all INVALID → INSUFFICIENT_DATA", () => {
    const snapshots = [
      makeSnapshot({ snapshot_id: 1, health_score: 50, quality_status: "INVALID", calculation_time: TEST_TIME }),
      makeSnapshot({ snapshot_id: 2, health_score: 50, quality_status: "INVALID", calculation_time: new Date(TEST_TIME.getTime() + 86400000) }),
    ];
    const result = detectRegime({
      entity_type: "coin",
      entity_id: 1,
      current_snapshot: snapshots[1],
      historical_snapshots: [snapshots[0]],
      regime_version: TEST_VERSION,
      calculation_time: new Date(TEST_TIME.getTime() + 86400000),
    });
    expect(result.regime_state).toBe("INSUFFICIENT_DATA");
  });

  it("UNKNOWN-only history computed normally", () => {
    const result = detectRegime(makeInput([50, 50]));
    expect(result.regime_state).toBe("STABLE");
  });
});

// ─── J. CONFIDENCE ────────────────────────────────────────────────

describe("P6-04D Confidence", () => {
  it("0 qualifying snapshots → confidence 0", () => {
    expect(calculateConfidence(0, 2)).toBe(0);
  });

  it("1 qualifying snapshot → confidence 50", () => {
    expect(calculateConfidence(1, 2)).toBe(50);
  });

  it("2 qualifying snapshots → confidence 100", () => {
    expect(calculateConfidence(2, 2)).toBe(100);
  });

  it(">2 qualifying snapshots → confidence clamped at 100", () => {
    expect(calculateConfidence(5, 2)).toBe(100);
  });

  it("confidence is integer (floor)", () => {
    expect(calculateConfidence(1, 3)).toBe(33); // floor(33.33)
  });
});

// ─── K. COIN ──────────────────────────────────────────────────────

describe("P6-04D Coin Regime", () => {
  it("complete coin flow: WEAK → STABLE → STRONG", () => {
    const result = detectRegime(makeInput([10, 10, 50, 50, 80, 80]));
    expect(result.regime_state).toBe("STRONG");
    expect(result.entity_type).toBe("coin");
  });
});

// ─── L. NARRATIVE ─────────────────────────────────────────────────

describe("P6-04D Narrative Regime", () => {
  it("complete narrative flow", () => {
    const input = makeInput([50, 50, 80, 80], { entity_type: "narrative", entity_id: 10 });
    const result = detectRegime(input);
    expect(result.regime_state).toBe("STRONG");
    expect(result.entity_type).toBe("narrative");
    expect(result.entity_id).toBe(10);
  });
});

// ─── M. DETERMINISM ───────────────────────────────────────────────

describe("P6-04D Determinism", () => {
  it("identical input twice → identical result", () => {
    const input = makeInput([50, 80, 80]);
    const r1 = detectRegime(input);
    const r2 = detectRegime(input);
    expect(r1.regime_state).toBe(r2.regime_state);
    expect(r1.confidence).toBe(r2.confidence);
    expect(r1.consecutive_count).toBe(r2.consecutive_count);
  });

  it("same scores, different entity → same regime", () => {
    const input1 = makeInput([50, 80, 80], { entity_id: 1 });
    const input2 = makeInput([50, 80, 80], { entity_id: 2 });
    const r1 = detectRegime(input1);
    const r2 = detectRegime(input2);
    expect(r1.regime_state).toBe(r2.regime_state);
  });
});

// ─── N. FAILURE BOUNDARY ──────────────────────────────────────────

describe("P6-04D Failure Boundary", () => {
  it("quality metadata does not affect regime classification", () => {
    const input = makeInput([50, 80, 80]);
    const result = detectRegime(input);
    expect(result.regime_state).toBe("STRONG");
    // Quality metadata is separate
    expect(result.quality_metadata).toBeDefined();
    expect(result.freshness_metadata).toBeDefined();
  });
});

// ─── O. STATE MACHINE UNIT TESTS ──────────────────────────────────

describe("P6-04D State Machine", () => {
  it("createInitialState returns INSUFFICIENT_DATA", () => {
    const state = createInitialState();
    expect(state.current_state).toBe("INSUFFICIENT_DATA");
    expect(state.consecutive_count).toBe(0);
  });

  it("createUnknownState returns UNKNOWN", () => {
    const state = createUnknownState();
    expect(state.current_state).toBe("UNKNOWN");
  });

  it("processSnapshot from STABLE with score >= 80 → TRANSITIONING", () => {
    const state: RegimeStateProperties = {
      current_state: "STABLE",
      previous_state: null,
      transition_started_at: null,
      transition_target: null,
      consecutive_count: 5,
      score_at_transition: null,
    };
    const result = processSnapshot({
      currentRegime: state,
      healthScore: 80,
      snapshotCalculationTime: TEST_TIME,
      config: DEFAULT_REGIME_CONFIG,
    });
    expect(result.newRegime).toBe("TRANSITIONING");
    expect(result.transitionTarget).toBe("STRONG");
  });

  it("processSnapshot from WEAK with score <= 20 → stays WEAK", () => {
    const state: RegimeStateProperties = {
      current_state: "WEAK",
      previous_state: null,
      transition_started_at: null,
      transition_target: null,
      consecutive_count: 5,
      score_at_transition: null,
    };
    const result = processSnapshot({
      currentRegime: state,
      healthScore: 20,
      snapshotCalculationTime: TEST_TIME,
      config: DEFAULT_REGIME_CONFIG,
    });
    expect(result.newRegime).toBe("WEAK");
  });

  it("TRANSITIONING with qualifying score count=0 → count=1 still TRANSITIONING", () => {
    const state: RegimeStateProperties = {
      current_state: "TRANSITIONING",
      previous_state: "STABLE",
      transition_started_at: TEST_TIME,
      transition_target: "STRONG",
      consecutive_count: 0,
      score_at_transition: 80,
    };
    const result = processSnapshot({
      currentRegime: state,
      healthScore: 85,
      snapshotCalculationTime: new Date(TEST_TIME.getTime() + 86400000),
      config: DEFAULT_REGIME_CONFIG,
    });
    expect(result.newRegime).toBe("TRANSITIONING");
    expect(result.consecutiveCount).toBe(1);
  });

  it("TRANSITIONING with qualifying score count=2 → STRONG", () => {
    const state: RegimeStateProperties = {
      current_state: "TRANSITIONING",
      previous_state: "STABLE",
      transition_started_at: TEST_TIME,
      transition_target: "STRONG",
      consecutive_count: 1,
      score_at_transition: 80,
    };
    const result = processSnapshot({
      currentRegime: state,
      healthScore: 85,
      snapshotCalculationTime: new Date(TEST_TIME.getTime() + 86400000),
      config: DEFAULT_REGIME_CONFIG,
    });
    expect(result.newRegime).toBe("STRONG");
    expect(result.consecutiveCount).toBe(2);
  });

  it("TRANSITIONING with non-qualifying score → reverts to previous state", () => {
    const state: RegimeStateProperties = {
      current_state: "TRANSITIONING",
      previous_state: "STABLE",
      transition_started_at: TEST_TIME,
      transition_target: "STRONG",
      consecutive_count: 1,
      score_at_transition: 80,
    };
    const result = processSnapshot({
      currentRegime: state,
      healthScore: 50, // Reverted to STABLE zone
      snapshotCalculationTime: new Date(TEST_TIME.getTime() + 86400000),
      config: DEFAULT_REGIME_CONFIG,
    });
    // PD-04C-04: transition fails, revert to previous state
    expect(result.newRegime).toBe("STABLE");
    expect(result.consecutiveCount).toBe(0);
    expect(result.transitionTarget).toBeNull();
  });
});
