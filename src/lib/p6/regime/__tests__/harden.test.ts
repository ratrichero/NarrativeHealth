/**
 * P6-04E — Trend / Regime Detection Hardening Tests
 *
 * Edge-case validation, boundary conditions, gap tolerance,
 * quality/freshness independence, coin/narrative parity,
 * provenance completeness, direction lock, and determinism.
 *
 * Authority: P6-04B, P6-04C, P6-04C1, P6-04E Audit
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
  assembleRegimeProvenance,
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
  RegimeState,
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
    calculation_time: new Date(
      TEST_TIME.getTime() + (snapshots.length - 1) * 86400000
    ),
    ...overrides,
  };
}

function makeInputWithQuality(
  healthScores: number[],
  qualities: Array<"VALID" | "INVALID" | "MISSING" | "UNKNOWN">,
  freshnesses: Array<"FRESH" | "STALE" | "UNKNOWN"> = []
): RegimeInput {
  const snapshots = healthScores.map((score, i) =>
    makeSnapshot({
      snapshot_id: i + 1,
      health_score: score,
      calculation_time: new Date(TEST_TIME.getTime() + i * 86400000),
      quality_status: qualities[i] ?? "VALID",
      freshness_status: freshnesses[i] ?? "FRESH",
    })
  );

  return {
    entity_type: "coin",
    entity_id: 1,
    current_snapshot: snapshots[snapshots.length - 1],
    historical_snapshots: snapshots.slice(0, -1),
    regime_version: TEST_VERSION,
    calculation_time: new Date(
      TEST_TIME.getTime() + (snapshots.length - 1) * 86400000
    ),
  };
}

// ─── 1. EXACT BOUNDARY SCORES ─────────────────────────────────────

describe("P6-04E Exact Boundary Scores", () => {
  it("score = 0 → WEAK", () => {
    expect(classifyScore(0)).toBe("WEAK");
  });

  it("score = 10 → WEAK", () => {
    expect(classifyScore(10)).toBe("WEAK");
  });

  it("score = 20 → WEAK (inclusive toward lower)", () => {
    expect(classifyScore(20)).toBe("WEAK");
  });

  it("score = 21 → STABLE (just above WEAK)", () => {
    expect(classifyScore(21)).toBe("STABLE");
  });

  it("score = 39 → STABLE (just below STABLE lower bound)", () => {
    expect(classifyScore(39)).toBe("STABLE");
  });

  it("score = 40 → STABLE (inclusive toward higher)", () => {
    expect(classifyScore(40)).toBe("STABLE");
  });

  it("score = 41 → STABLE", () => {
    expect(classifyScore(41)).toBe("STABLE");
  });

  it("score = 59 → STABLE", () => {
    expect(classifyScore(59)).toBe("STABLE");
  });

  it("score = 60 → STABLE (inclusive toward higher)", () => {
    expect(classifyScore(60)).toBe("STABLE");
  });

  it("score = 61 → STABLE (just above STABLE upper bound, neutral band)", () => {
    expect(classifyScore(61)).toBe("STABLE");
  });

  it("score = 79 → STABLE (just below STRONG)", () => {
    expect(classifyScore(79)).toBe("STABLE");
  });

  it("score = 80 → STRONG (inclusive toward higher)", () => {
    expect(classifyScore(80)).toBe("STRONG");
  });

  it("score = 81 → STRONG", () => {
    expect(classifyScore(81)).toBe("STRONG");
  });

  it("score = 100 → STRONG", () => {
    expect(classifyScore(100)).toBe("STRONG");
  });
});

// ─── 2. NEUTRAL ZONE NON-TRANSITION ───────────────────────────────

describe("P6-04E Neutral Zone Non-Transition", () => {
  it("WEAK: scores 25, 30, 35 in neutral band → regime stays WEAK", () => {
    // 2 snapshots establish WEAK, then neutral band scores
    const result = detectRegime(makeInput([10, 10, 25, 30, 35]));
    expect(result.regime_state).toBe("WEAK");
  });

  it("STABLE: scores 65, 70, 75 in neutral band → regime stays STABLE", () => {
    const result = detectRegime(makeInput([50, 50, 65, 70, 75]));
    expect(result.regime_state).toBe("STABLE");
  });

  it("STRONG: score 70 in neutral band → regime stays STRONG", () => {
    const result = detectRegime(makeInput([80, 80, 70, 70]));
    expect(result.regime_state).toBe("STRONG");
  });

  it("WEAK: score 30 then 25 → oscillation in neutral band, stays WEAK", () => {
    const result = detectRegime(makeInput([10, 10, 30, 25, 30, 25]));
    expect(result.regime_state).toBe("WEAK");
  });
});

// ─── 3. HYSTERESIS WITH PERSISTENCE ───────────────────────────────

describe("P6-04E Hysteresis with Persistence", () => {
  it("WEAK → STABLE: first score ≥40 → TRANSITIONING, second → STABLE", () => {
    const r1 = detectRegime(makeInput([10, 10, 42]));
    expect(r1.regime_state).toBe("TRANSITIONING");

    const r2 = detectRegime(makeInput([10, 10, 42, 42]));
    expect(r2.regime_state).toBe("STABLE");
  });

  it("STABLE → STRONG: first score ≥80 → TRANSITIONING, second → STRONG", () => {
    const r1 = detectRegime(makeInput([50, 50, 82]));
    expect(r1.regime_state).toBe("TRANSITIONING");

    const r2 = detectRegime(makeInput([50, 50, 82, 82]));
    expect(r2.regime_state).toBe("STRONG");
  });

  it("STRONG → STABLE: first score ≤60 → TRANSITIONING, second → STABLE", () => {
    const r1 = detectRegime(makeInput([80, 80, 55]));
    expect(r1.regime_state).toBe("TRANSITIONING");

    const r2 = detectRegime(makeInput([80, 80, 55, 55]));
    expect(r2.regime_state).toBe("STABLE");
  });

  it("STABLE → WEAK: first score ≤20 → TRANSITIONING, second → WEAK", () => {
    const r1 = detectRegime(makeInput([50, 50, 15]));
    expect(r1.regime_state).toBe("TRANSITIONING");

    const r2 = detectRegime(makeInput([50, 50, 15, 15]));
    expect(r2.regime_state).toBe("WEAK");
  });

  it("interrupted WEAK→STABLE: 42, then 30, then 42, 42 → STABLE", () => {
    // 42 triggers transition, 30 reverts, then 42,42 completes
    const result = detectRegime(makeInput([10, 10, 42, 30, 42, 42]));
    expect(result.regime_state).toBe("STABLE");
  });

  it("oscillation around 40: 42,38,42,38,42,38 → stays WEAK", () => {
    const result = detectRegime(makeInput([10, 10, 42, 38, 42, 38, 42, 38]));
    expect(result.regime_state).toBe("WEAK");
  });

  it("oscillation around 60: 62,58,62,58 → stays STABLE", () => {
    const result = detectRegime(makeInput([50, 50, 62, 58, 62, 58]));
    expect(result.regime_state).toBe("STABLE");
  });

  it("oscillation around 80: 82,78,82,78 → stays STABLE", () => {
    // STABLE established, then oscillation around STRONG boundary
    const result = detectRegime(makeInput([50, 50, 82, 78, 82, 78]));
    expect(result.regime_state).toBe("STABLE");
  });
});

// ─── 4. GAP TOLERANCE ─────────────────────────────────────────────

describe("P6-04E Gap Tolerance", () => {
  it("2-day gap (1 missing day) tolerated", () => {
    const snapshots = [
      makeSnapshot({
        snapshot_id: 1,
        health_score: 50,
        calculation_time: new Date("2026-08-20"),
      }),
      makeSnapshot({
        snapshot_id: 2,
        health_score: 80,
        calculation_time: new Date("2026-08-22"),
      }),
      makeSnapshot({
        snapshot_id: 3,
        health_score: 80,
        calculation_time: new Date("2026-08-23"),
      }),
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

  it("4-day gap (3 missing days) tolerated at tolerance limit", () => {
    const snapshots = [
      makeSnapshot({
        snapshot_id: 1,
        health_score: 50,
        calculation_time: new Date("2026-08-18"),
      }),
      makeSnapshot({
        snapshot_id: 2,
        health_score: 80,
        calculation_time: new Date("2026-08-22"),
      }),
      makeSnapshot({
        snapshot_id: 3,
        health_score: 80,
        calculation_time: new Date("2026-08-23"),
      }),
    ];
    const result = detectRegime({
      entity_type: "coin",
      entity_id: 1,
      current_snapshot: snapshots[2],
      historical_snapshots: snapshots.slice(0, 2),
      regime_version: TEST_VERSION,
      calculation_time: new Date("2026-08-23"),
    });
    expect(["TRANSITIONING", "STABLE", "STRONG"]).toContain(
      result.regime_state
    );
  });

  it("5-day gap (4 missing days) exceeds tolerance → INSUFFICIENT_DATA", () => {
    const snapshots = [
      makeSnapshot({
        snapshot_id: 1,
        health_score: 50,
        calculation_time: new Date("2026-08-18"),
      }),
      makeSnapshot({
        snapshot_id: 2,
        health_score: 80,
        calculation_time: new Date("2026-08-24"),
      }),
      makeSnapshot({
        snapshot_id: 3,
        health_score: 80,
        calculation_time: new Date("2026-08-25"),
      }),
    ];
    const result = detectRegime({
      entity_type: "coin",
      entity_id: 1,
      current_snapshot: snapshots[2],
      historical_snapshots: snapshots.slice(0, 2),
      regime_version: TEST_VERSION,
      calculation_time: new Date("2026-08-25"),
    });
    expect(result.regime_state).toBe("INSUFFICIENT_DATA");
  });

  it("gap in middle of transition → transition still counts qualifying snapshots across gap", () => {
    // WEAK established, then score rises to 42 (transition starts),
    // 4-day gap, then 42 again (completes transition)
    const snapshots = [
      makeSnapshot({
        snapshot_id: 1,
        health_score: 10,
        calculation_time: new Date("2026-08-18"),
      }),
      makeSnapshot({
        snapshot_id: 2,
        health_score: 10,
        calculation_time: new Date("2026-08-19"),
      }),
      makeSnapshot({
        snapshot_id: 3,
        health_score: 42,
        calculation_time: new Date("2026-08-20"),
      }),
      makeSnapshot({
        snapshot_id: 4,
        health_score: 42,
        calculation_time: new Date("2026-08-24"),
      }),
      makeSnapshot({
        snapshot_id: 5,
        health_score: 42,
        calculation_time: new Date("2026-08-25"),
      }),
    ];
    const result = detectRegime({
      entity_type: "coin",
      entity_id: 1,
      current_snapshot: snapshots[4],
      historical_snapshots: snapshots.slice(0, 4),
      regime_version: TEST_VERSION,
      calculation_time: new Date("2026-08-25"),
    });
    // 3 qualifying snapshots (42,42,42) → should transition
    // But check if gap between day 3 and day 7 (4 days) triggers INSUFFICIENT_DATA
    // Day 20 to day 24 = 4 days. diffDays=4, maxGapDays+1=4, 4>4=false → tolerated
    expect(result.regime_state).toBe("STABLE");
  });

  it("consecutive day snapshots → no gap detected", () => {
    const result = detectRegime(makeInput([10, 10, 50, 50]));
    // All consecutive daily, no gaps
    expect(result.regime_state).toBe("STABLE");
  });
});

// ─── 5. INVALID PAUSING ───────────────────────────────────────────

describe("P6-04E INVALID Pausing", () => {
  it("INVALID between qualifying snapshots pauses persistence", () => {
    // 10, 10 → WEAK, then 42 (start transition), then INVALID (pause), then 42 (complete)
    const snapshots = [
      makeSnapshot({
        snapshot_id: 1,
        health_score: 10,
        calculation_time: new Date("2026-08-18"),
      }),
      makeSnapshot({
        snapshot_id: 2,
        health_score: 10,
        calculation_time: new Date("2026-08-19"),
      }),
      makeSnapshot({
        snapshot_id: 3,
        health_score: 42,
        calculation_time: new Date("2026-08-20"),
      }),
      makeSnapshot({
        snapshot_id: 4,
        health_score: 42,
        quality_status: "INVALID",
        calculation_time: new Date("2026-08-21"),
      }),
      makeSnapshot({
        snapshot_id: 5,
        health_score: 42,
        calculation_time: new Date("2026-08-22"),
      }),
    ];
    const result = detectRegime({
      entity_type: "coin",
      entity_id: 1,
      current_snapshot: snapshots[4],
      historical_snapshots: snapshots.slice(0, 4),
      regime_version: TEST_VERSION,
      calculation_time: new Date("2026-08-22"),
    });
    // Qualifying: [10, 10, 42, 42] → WEAK(10,10), then 42→TRANSITIONING, then 42→STABLE
    expect(result.regime_state).toBe("STABLE");
  });

  it("ALL INVALID → INSUFFICIENT_DATA", () => {
    const result = detectRegime(
      makeInputWithQuality([50, 50, 80], ["INVALID", "INVALID", "INVALID"])
    );
    expect(result.regime_state).toBe("INSUFFICIENT_DATA");
  });

  it("INVALID does not become regime state", () => {
    const result = detectRegime(
      makeInputWithQuality([50, 50, 80], ["VALID", "INVALID", "VALID"])
    );
    expect(["STABLE", "STRONG", "TRANSITIONING"]).toContain(
      result.regime_state
    );
    // Never INVALID as regime
    expect(result.regime_state).not.toBe("INVALID");
  });
});

// ─── 6. UNKNOWN QUALITY INDEPENDENCE ───────────────────────────────

describe("P6-04E UNKNOWN Quality Independence", () => {
  it("UNKNOWN quality snapshots count toward persistence", () => {
    const result = detectRegime(
      makeInputWithQuality([50, 80, 80], ["VALID", "UNKNOWN", "UNKNOWN"])
    );
    // All 3 qualify → WEAK→STRONG transition with 2 qualifying after init
    expect(result.regime_state).toBe("STRONG");
  });

  it("UNKNOWN quality does not become regime state", () => {
    const result = detectRegime(
      makeInputWithQuality([50, 50], ["UNKNOWN", "UNKNOWN"])
    );
    expect(result.regime_state).toBe("STABLE");
    expect(result.regime_state).not.toBe("UNKNOWN");
  });

  it("UNKNOWN quality metadata correctly recorded", () => {
    const result = detectRegime(
      makeInputWithQuality([50, 80, 80], ["UNKNOWN", "UNKNOWN", "VALID"])
    );
    expect(result.quality_metadata.input_snapshots_unknown_quality).toBe(2);
    expect(result.quality_metadata.input_snapshots_valid).toBe(1);
  });
});

// ─── 7. FRESHNESS INDEPENDENCE ────────────────────────────────────

describe("P6-04E Freshness Independence", () => {
  it("STALE freshness does not affect regime classification", () => {
    const fresh = detectRegime(
      makeInputWithQuality([50, 80, 80], ["VALID", "VALID", "VALID"], [
        "FRESH",
        "FRESH",
        "FRESH",
      ])
    );
    const stale = detectRegime(
      makeInputWithQuality([50, 80, 80], ["VALID", "VALID", "VALID"], [
        "FRESH",
        "STALE",
        "STALE",
      ])
    );
    expect(fresh.regime_state).toBe(stale.regime_state);
    expect(fresh.confidence).toBe(stale.confidence);
  });

  it("all STALE freshness still computes regime", () => {
    const result = detectRegime(
      makeInputWithQuality([50, 80, 80], ["VALID", "VALID", "VALID"], [
        "STALE",
        "STALE",
        "STALE",
      ])
    );
    expect(result.regime_state).toBe("STRONG");
    expect(result.freshness_metadata.input_snapshots_stale).toBe(3);
  });

  it("UNKNOWN freshness does not affect regime", () => {
    const result = detectRegime(
      makeInputWithQuality([50, 80, 80], ["VALID", "VALID", "VALID"], [
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
      ])
    );
    expect(result.regime_state).toBe("STRONG");
  });
});

// ─── 8. COIN / NARRATIVE PARITY ───────────────────────────────────

describe("P6-04E Coin/Narrative Parity", () => {
  it("same inputs → same regime for coin and narrative", () => {
    const coin = detectRegime(
      makeInput([50, 80, 80], { entity_type: "coin", entity_id: 1 })
    );
    const narrative = detectRegime(
      makeInput([50, 80, 80], { entity_type: "narrative", entity_id: 1 })
    );
    expect(coin.regime_state).toBe(narrative.regime_state);
    expect(coin.confidence).toBe(narrative.confidence);
  });

  it("different entities have independent regimes", () => {
    const r1 = detectRegime(makeInput([50, 80, 80], { entity_id: 1 }));
    const r2 = detectRegime(makeInput([50, 20, 20], { entity_id: 2 }));
    expect(r1.regime_state).toBe("STRONG");
    expect(r2.regime_state).toBe("WEAK");
  });

  it("narrative entity_type preserved in output", () => {
    const result = detectRegime(
      makeInput([50, 50], { entity_type: "narrative", entity_id: 42 })
    );
    expect(result.entity_type).toBe("narrative");
    expect(result.entity_id).toBe(42);
  });
});

// ─── 9. TRANSITIONING EDGE CASES ──────────────────────────────────

describe("P6-04E TRANSITIONING Edge Cases", () => {
  it("direction lock: cannot change target during TRANSITIONING", () => {
    // Start STABLE, score=82 triggers TRANSITIONING→STRONG
    // Then score=15 (WEAK) but transition is locked to STRONG → should revert
    const result = detectRegime(makeInput([50, 50, 82, 15]));
    // 82 triggers transition to STRONG, 15 reverts to STABLE (previous)
    expect(result.regime_state).toBe("STABLE");
  });

  it("UNKNOWN → first real regime: 2 qualifying snapshots completes", () => {
    // 1 snapshot → UNKNOWN (from engine)
    // 2 snapshots → establishes regime
    const result = detectRegime(makeInput([50, 80]));
    // 2 qualifying: 50→STABLE, 80→TRANSITIONING→STRONG
    expect(result.regime_state).toBe("TRANSITIONING");
  });

  it("multiple entities can be in different states simultaneously", () => {
    const r1 = detectRegime(makeInput([10, 10, 10, 10], { entity_id: 1 }));
    const r2 = detectRegime(makeInput([80, 80, 80, 80], { entity_id: 2 }));
    const r3 = detectRegime(makeInput([50, 50, 50, 50], { entity_id: 3 }));
    expect(r1.regime_state).toBe("WEAK");
    expect(r2.regime_state).toBe("STRONG");
    expect(r3.regime_state).toBe("STABLE");
  });
});

// ─── 10. CONFIDENCE ACCURACY ──────────────────────────────────────

describe("P6-04E Confidence Accuracy", () => {
  it("TRANSITIONING regime has correct confidence", () => {
    // 50, 80 → 2 qualifying, init=50(STABLE), 80→TRANSITIONING(count=1)
    // consecutive_count=1, confidence = floor(1/2*100) = 50
    const result = detectRegime(makeInput([50, 80]));
    expect(result.regime_state).toBe("TRANSITIONING");
    expect(result.confidence).toBe(50);
  });

  it("STABLE regime after 2 snapshots has confidence 100", () => {
    const result = detectRegime(makeInput([50, 50]));
    expect(result.regime_state).toBe("STABLE");
    expect(result.confidence).toBe(100);
  });

  it("STABLE regime after 5 snapshots has confidence 100 (clamped)", () => {
    const result = detectRegime(makeInput([50, 50, 50, 50, 50]));
    expect(result.regime_state).toBe("STABLE");
    expect(result.confidence).toBe(100);
  });

  it("confidence = 0 for INSUFFICIENT_DATA", () => {
    const result = detectRegime(makeInput([50]));
    expect(result.regime_state).toBe("UNKNOWN");
    expect(result.confidence).toBe(0);
  });
});

// ─── 11. VERSION TUPLE PRESERVATION ───────────────────────────────

describe("P6-04E Version Tuple Preservation", () => {
  it("output contains regime version tuple", () => {
    const result = detectRegime(makeInput([50, 50]));
    expect(result.regime_version).toEqual(REGIME_V1_VERSION);
    expect(result.regime_version.algorithm_version).toBe("p6-regime-v1");
    expect(result.regime_version.parameter_version).toBe("default-v1");
    expect(result.regime_version.schema_version).toBe("v1");
    expect(result.regime_version.config_hash).toBe("default-v1");
  });

  it("custom version tuple preserved in output", () => {
    const customVersion = {
      algorithm_version: "p6-regime-v2",
      parameter_version: "custom-v1",
      schema_version: "v2",
      config_hash: "custom-hash",
    };
    const result = detectRegime(
      makeInput([50, 50], { regime_version: customVersion })
    );
    expect(result.regime_version).toEqual(customVersion);
  });
});

// ─── 12. PROVENANCE COMPLETENESS ──────────────────────────────────

describe("P6-04E Provenance Completeness", () => {
  it("provenance contains all input snapshot IDs", () => {
    const result = detectRegime(makeInput([50, 80, 80]));
    expect(result.provenance.input_snapshot_ids).toHaveLength(3);
    expect(result.provenance.input_snapshot_ids[0].snapshot_id).toBe(1);
    expect(result.provenance.input_snapshot_ids[1].snapshot_id).toBe(2);
    expect(result.provenance.input_snapshot_ids[2].snapshot_id).toBe(3);
  });

  it("provenance contains quality summary", () => {
    const result = detectRegime(makeInput([50, 80, 80]));
    expect(result.provenance.quality_summary).toBeDefined();
    expect(result.provenance.quality_summary!.input_snapshots_total).toBe(3);
  });

  it("provenance contains freshness summary", () => {
    const result = detectRegime(makeInput([50, 80, 80]));
    expect(result.provenance.freshness_summary).toBeDefined();
  });

  it("provenance contains version and calculation time", () => {
    const result = detectRegime(makeInput([50, 50]));
    expect(result.provenance.regime_version).toEqual(REGIME_V1_VERSION);
    expect(result.provenance.calculation_time).toBeInstanceOf(Date);
  });

  it("provenance window_start and window_end are correct", () => {
    const result = detectRegime(makeInput([50, 50, 50]));
    expect(result.provenance.input_window_start).toBeInstanceOf(Date);
    expect(result.provenance.input_window_end).toBeInstanceOf(Date);
    expect(
      result.provenance.input_window_end!.getTime()
    ).toBeGreaterThanOrEqual(result.provenance.input_window_start!.getTime());
  });

  it("provenance does not influence regime classification", () => {
    const r1 = detectRegime(makeInput([50, 80, 80]));
    const r2 = detectRegime(makeInput([50, 80, 80]));
    // Same inputs → same regime regardless of provenance
    expect(r1.regime_state).toBe(r2.regime_state);
  });
});

// ─── 13. IDEMPOTENT REGIME DETECTION ───────────────────────────────

describe("P6-04E Idempotent Detection", () => {
  it("same input 3 times → identical results", () => {
    const input = makeInput([50, 80, 80]);
    const r1 = detectRegime(input);
    const r2 = detectRegime(input);
    const r3 = detectRegime(input);
    expect(r1.regime_state).toBe(r2.regime_state);
    expect(r2.regime_state).toBe(r3.regime_state);
    expect(r1.confidence).toBe(r2.confidence);
    expect(r2.confidence).toBe(r3.confidence);
  });

  it("reversed input order → same result (engine sorts)", () => {
    const input = makeInput([50, 80, 80]);
    const reversed = {
      ...input,
      historical_snapshots: [...input.historical_snapshots].reverse(),
    };
    const r1 = detectRegime(input);
    const r2 = detectRegime(reversed);
    expect(r1.regime_state).toBe(r2.regime_state);
  });
});

// ─── 14. EDGE CASE SCORES ─────────────────────────────────────────

describe("P6-04E Edge Case Scores", () => {
  it("score = 0 across all snapshots → WEAK", () => {
    const result = detectRegime(makeInput([0, 0, 0]));
    expect(result.regime_state).toBe("WEAK");
  });

  it("score = 100 across all snapshots → STRONG", () => {
    const result = detectRegime(makeInput([100, 100, 100]));
    expect(result.regime_state).toBe("STRONG");
  });

  it("extreme swing: 0 → 100 → 0", () => {
    // 0,0 → WEAK, then 100,100 → STRONG transition, then 0,0 → WEAK
    const result = detectRegime(makeInput([0, 0, 100, 100, 0, 0]));
    expect(result.regime_state).toBe("WEAK");
  });

  it("boundary values: 20, 40, 60, 80 → correct classification", () => {
    expect(classifyScore(20)).toBe("WEAK");
    expect(classifyScore(40)).toBe("STABLE");
    expect(classifyScore(60)).toBe("STABLE");
    expect(classifyScore(80)).toBe("STRONG");
  });
});

// ─── 15. PROVENANCE ASSEMBLY ──────────────────────────────────────

describe("P6-04E Provenance Assembly", () => {
  it("assembleQualityMetadata counts correctly", () => {
    const snapshots = [
      makeSnapshot({ quality_status: "VALID" }),
      makeSnapshot({ quality_status: "VALID" }),
      makeSnapshot({ quality_status: "INVALID" }),
      makeSnapshot({ quality_status: "MISSING" }),
      makeSnapshot({ quality_status: "UNKNOWN" }),
    ];
    const meta = assembleQualityMetadata(snapshots);
    expect(meta.input_snapshots_total).toBe(5);
    expect(meta.input_snapshots_valid).toBe(2);
    expect(meta.input_snapshots_invalid).toBe(1);
    expect(meta.input_snapshots_missing).toBe(1);
    expect(meta.input_snapshots_unknown_quality).toBe(1);
    expect(meta.data_sufficiency).toBe(40); // 2/5 * 100
  });

  it("assembleFreshnessMetadata counts correctly", () => {
    const snapshots = [
      makeSnapshot({ freshness_status: "FRESH" }),
      makeSnapshot({ freshness_status: "FRESH" }),
      makeSnapshot({ freshness_status: "STALE" }),
      makeSnapshot({ freshness_status: "UNKNOWN" }),
    ];
    const meta = assembleFreshnessMetadata(snapshots);
    expect(meta.input_snapshots_fresh).toBe(2);
    expect(meta.input_snapshots_stale).toBe(1);
    expect(meta.input_snapshots_unknown_freshness).toBe(1);
    expect(meta.freshness_coverage).toBe(50); // 2/4 * 100
  });

  it("assembleRegimeProvenance includes all required fields", () => {
    const snapshots = [
      makeSnapshot({ snapshot_id: 1, health_score: 50 }),
      makeSnapshot({ snapshot_id: 2, health_score: 80 }),
    ];
    const quality = assembleQualityMetadata(snapshots);
    const freshness = assembleFreshnessMetadata(snapshots);
    const prov = assembleRegimeProvenance(
      snapshots,
      TEST_VERSION,
      TEST_TIME,
      "STABLE",
      "STRONG",
      75,
      quality,
      freshness
    );
    expect(prov.calculation_time).toBe(TEST_TIME);
    expect(prov.regime_version).toEqual(TEST_VERSION);
    expect(prov.input_snapshot_ids).toHaveLength(2);
    expect(prov.transition_from).toBe("STABLE");
    expect(prov.transition_to).toBe("STRONG");
    expect(prov.transition_confidence).toBe(75);
    expect(prov.quality_summary).toBe(quality);
    expect(prov.freshness_summary).toBe(freshness);
  });
});

// ─── 16. STATE MACHINE UNIT HARDENING ─────────────────────────────

describe("P6-04E State Machine Unit Hardening", () => {
  it("UNKNOWN → TRANSITIONING with correct target", () => {
    const state = createUnknownState();
    const result = processSnapshot({
      currentRegime: state,
      healthScore: 85,
      snapshotCalculationTime: TEST_TIME,
      config: DEFAULT_REGIME_CONFIG,
    });
    expect(result.newRegime).toBe("TRANSITIONING");
    expect(result.transitionTarget).toBe("STRONG");
    expect(result.consecutiveCount).toBe(1);
  });

  it("TRANSITIONING revert: reverts to previous_state", () => {
    const state: RegimeStateProperties = {
      current_state: "TRANSITIONING",
      previous_state: "WEAK",
      transition_started_at: TEST_TIME,
      transition_target: "STABLE",
      consecutive_count: 1,
      score_at_transition: 42,
    };
    const result = processSnapshot({
      currentRegime: state,
      healthScore: 30, // reverted to neutral band
      snapshotCalculationTime: new Date(TEST_TIME.getTime() + 86400000),
      config: DEFAULT_REGIME_CONFIG,
    });
    expect(result.newRegime).toBe("WEAK");
    expect(result.consecutiveCount).toBe(0);
    expect(result.transitionTarget).toBeNull();
  });

  it("from STRONG: score=60 → TRANSITIONING to STABLE", () => {
    const state: RegimeStateProperties = {
      current_state: "STRONG",
      previous_state: null,
      transition_started_at: null,
      transition_target: null,
      consecutive_count: 5,
      score_at_transition: null,
    };
    const result = processSnapshot({
      currentRegime: state,
      healthScore: 60,
      snapshotCalculationTime: TEST_TIME,
      config: DEFAULT_REGIME_CONFIG,
    });
    expect(result.newRegime).toBe("TRANSITIONING");
    expect(result.transitionTarget).toBe("STABLE");
  });

  it("from WEAK: score=40 → TRANSITIONING to STABLE", () => {
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
      healthScore: 40,
      snapshotCalculationTime: TEST_TIME,
      config: DEFAULT_REGIME_CONFIG,
    });
    expect(result.newRegime).toBe("TRANSITIONING");
    expect(result.transitionTarget).toBe("STABLE");
  });

  it("from STABLE: score=39 → no transition (neutral band)", () => {
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
      healthScore: 39,
      snapshotCalculationTime: TEST_TIME,
      config: DEFAULT_REGIME_CONFIG,
    });
    expect(result.newRegime).toBe("STABLE");
    expect(result.transitionTarget).toBeNull();
  });

  it("from STABLE: score=61 → no transition (neutral band)", () => {
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
      healthScore: 61,
      snapshotCalculationTime: TEST_TIME,
      config: DEFAULT_REGIME_CONFIG,
    });
    expect(result.newRegime).toBe("STABLE");
    expect(result.transitionTarget).toBeNull();
  });
});

// ─── 17. CONFIDENCE EDGE CASES ────────────────────────────────────

describe("P6-04E Confidence Edge Cases", () => {
  it("confidence = 0 for 0 qualifying", () => {
    expect(calculateConfidence(0, 2)).toBe(0);
  });

  it("confidence = 50 for 1 qualifying (minPersistence=2)", () => {
    expect(calculateConfidence(1, 2)).toBe(50);
  });

  it("confidence = 100 for 2 qualifying", () => {
    expect(calculateConfidence(2, 2)).toBe(100);
  });

  it("confidence = 100 for 100 qualifying (clamped)", () => {
    expect(calculateConfidence(100, 2)).toBe(100);
  });

  it("confidence = 33 for 1 qualifying (minPersistence=3)", () => {
    expect(calculateConfidence(1, 3)).toBe(33);
  });

  it("confidence = 66 for 2 qualifying (minPersistence=3)", () => {
    expect(calculateConfidence(2, 3)).toBe(66);
  });

  it("confidence = 0 for negative count (clamped)", () => {
    expect(calculateConfidence(-1, 2)).toBe(0);
  });

  it("confidence = 100 for minPersistence=0", () => {
    expect(calculateConfidence(0, 0)).toBe(100);
  });
});

// ─── 18. LONG SEQUENCES ───────────────────────────────────────────

describe("P6-04E Long Sequences", () => {
  it("30 consecutive WEAK snapshots → WEAK with high confidence", () => {
    const scores = Array(30).fill(10);
    const result = detectRegime(makeInput(scores));
    expect(result.regime_state).toBe("WEAK");
    expect(result.confidence).toBe(100);
  });

  it("complex sequence: WEAK→STABLE→STRONG→STABLE→WEAK", () => {
    const scores = [
      10, 10, // WEAK established
      50, 50, // WEAK→STABLE transition
      80, 80, // STABLE→STRONG transition
      50, 50, // STRONG→STABLE transition
      10, 10, // STABLE→WEAK transition
    ];
    const result = detectRegime(makeInput(scores));
    expect(result.regime_state).toBe("WEAK");
  });

  it("14-day lookback with gap in middle", () => {
    const scores = [
      50, 50, 50, 50, // days 1-4: STABLE
      80, 80, // days 5-6: STRONG transition
      50, 50, // days 7-8: STRONG→STABLE
      10, 10, // days 9-10: STABLE→WEAK
      50, 50, // days 11-12: WEAK→STABLE
      80, 80, // days 13-14: STABLE→STRONG
    ];
    const result = detectRegime(makeInput(scores));
    expect(result.regime_state).toBe("STRONG");
  });
});
