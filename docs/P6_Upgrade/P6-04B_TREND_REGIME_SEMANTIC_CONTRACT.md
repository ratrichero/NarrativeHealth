# P6-04B — Trend / Regime Detection Semantic Contract

**Date:** 2026-08-26
**Task Type:** CONTRACT DESIGN DOCUMENT ONLY — NO IMPLEMENTATION, NO SCHEMA, NO API
**Baseline:** P6-04A Next Phase Landscape Recon (`c5e9f1b`)
**Frozen Authorities:** P6-01B/C/D/E (frozen), P6-02B/C/C2/D/E (frozen), P6-03B/C1/C2 (frozen)
**P6-02/03 Status:** READY FOR PLANNER FREEZE (decisions remain PROPOSED)
**Git boundary:** ONLY this document. No production code. No schema. No P4/P5 changes.

---

## 1. Purpose

This document defines the semantic contract for P6-04 Trend/Regime Detection — the mechanism that detects **change** in coin and narrative intelligence over time, classifies the current regime, and produces transition events with full provenance.

### 1.1 What Trend Detection IS

- A **temporal analysis** that compares current intelligence state to recent history
- A **change detector** that identifies when health scores are improving, declining, or stable
- A **regime classifier** that assigns a categorical state to the current trajectory
- A **transition producer** that generates events when regime changes occur

### 1.2 What Trend Detection IS NOT

- A **health score** (P6-02/03) — trend operates on top of health, not alongside it
- A **decision engine** (P5) — trend describes state, not prescribes action
- A **prediction model** — trend is retrospective (what IS happening), not predictive (what WILL happen)
- A **trading signal** — no BUY/SELL, no execution permission, no action policy
- A **quality evaluator** (P6-01D) — quality remains separate vocabulary

### 1.3 Layer Position

```
Canonical Observation (P6-01)
    ↓
Derived Feature / Score (P6-02)
    ↓
Intelligence Snapshot (P6-03)
    ↓
TREND / REGIME DETECTION (P6-04) ← this contract
    ↓ (describes state of)
Health Intelligence
    ↓ (consumed by)
P5 Decision Support (frozen — reads P6 intelligence, NOT P6-04 directly)
```

**TR-01:** Trend detection MUST NOT bypass or replace any upstream layer. It consumes P6-03 snapshots, not raw observations or features.

**TR-02:** Trend detection MUST NOT introduce BUY/SELL, action, policy, or P5 decision semantics. It describes intelligence state; P5 consumes that state for decision-making.

---

## 2. Terminology

| Term | Definition | Source |
|---|---|---|
| **Health Score** | Numeric 0–100 measure of coin/narrative health | P6-02/03 |
| **Regime** | Categorical classification of current health trajectory | This document |
| **RegimeState** | Finite vocabulary of regime classifications | §4 |
| **Transition** | A change from one RegimeState to another | §5 |
| **Lookback Window** | Number of historical snapshots used for trend analysis | §5 |
| **Hysteresis** | Minimum score delta required to trigger a transition | §5 |
| **Neutral Zone** | Score range where regime remains unchanged | §5 |
| **Trend Direction** | Signed direction of health score change (improving/declining/stable) | §5 |
| **Transition Event** | A persisted record of a regime change with timestamp and evidence | §7 |
| **RegimeVersion** | Structured version tuple for the regime algorithm | §9 |

---

## 3. Input Authority

### 3.1 P6-Native Only

Trend detection MUST consume P6-03 snapshot outputs as its semantic source of truth.

**TR-03:** Trend detection MUST NOT read from legacy `market_price_daily`, `coin_metrics`, `indicators`, `features` (without P6 columns), `health_scores`, or `morning_snapshots` tables as semantic source-of-truth.

### 3.2 Snapshot Input

```
TrendInput
├── entity_type          ("coin" | "narrative")
├── entity_id            (coin or narrative ID)
├── current_snapshot     (latest P6-03 snapshot)
│   ├── health_score     (0–100)
│   ├── confidence_score (0–100)
│   ├── data_completeness (0–100)
│   ├── quality_metadata (QualityState summary)
│   ├── freshness_metadata (FreshnessState summary)
│   └── calculation_time (UTC)
├── historical_snapshots (array of previous snapshots, ordered by calculation_time DESC)
│   └── [same shape as current_snapshot]
├── regime_version       (RegimeVersion tuple)
└── calculation_time     (UTC wall-clock)
```

### 3.3 Minimum Input Requirements

| Requirement | V1 Behavior |
|---|---|
| At least 1 snapshot | Compute regime from single snapshot → UNKNOWN |
| At least 2 snapshots | Basic trend direction possible |
| At least N snapshots (lookback window) | Full regime classification |
| Snapshots with gap > threshold | Flag as insufficient data |

---

## 4. Regime Vocabulary

### 4.1 V1 Candidate Vocabulary

**PLANNER DECISION REQUIRED (PD-04B-01):** Regime vocabulary selection.

| Candidate | Definition | Health Direction | Confidence |
|---|---|---|---|
| `STRONG` | Health score high and improving or stable | Positive | High |
| `STABLE` | Health score moderate, no significant change | Neutral | High |
| `WEAK` | Health score low or declining | Negative | High |
| `TRANSITIONING` | Regime is changing (between states) | Uncertain | Medium |
| `INSUFFICIENT_DATA` | Not enough history to classify | Unknown | Low |
| `UNKNOWN` | Classification not possible | Unknown | None |

### 4.2 Rationale for V1

The master specification (§8) proposes: `STABLE → STRENGTHENING → HEALTHY → WEAKENING → DETERIORATING`. However, this conflates direction (STRENGTHENING/WEAKENING) with state (HEALTHY). The proposed V1 vocabulary separates:

- **State** (STRONG/STABLE/WEAK) — what the current health trajectory IS
- **Transition** (TRANSITIONING) — that a change is occurring
- **Uncertainty** (INSUFFICIENT_DATA/UNKNOWN) — when classification is not possible

### 4.3 Relationship to Health Score

| Health Score Range | Candidate Regime (V1 default) |
|---|---|
| 70–100 + improving/stable | STRONG |
| 40–70 + stable | STABLE |
| 0–40 + declining/stable | WEAK |
| Any + rapid change | TRANSITIONING |
| < 2 snapshots | INSUFFICIENT_DATA |

**PD-04B-01 options:**
- A: 3-state (STRONG/STABLE/WEAK) + TRANSITIONING + INSUFFICIENT_DATA ← recommended
- B: 5-state (master spec: STRONG/STRENGTHENING/HEALTHY/WEAKENING/DETERIORATING)
- C: Direction-only (IMPROVING/STABLE/DECLINING) without categorical state
- D: Configurable thresholds (per-entity or per-narrative)

**TR-04:** The regime vocabulary MUST be a finite, versioned enumeration. No free-text regime labels.

---

## 5. Trend Model

### 5.1 Input Dimensions

Trend analysis operates on the `health_score` from P6-03 snapshots.

**PD-04B-02 (PLANNER DECISION REQUIRED):** Which dimensions feed trend analysis?

| Option | Dimensions | Complexity |
|---|---|---|
| A: Health score only | health_score | Low ← recommended V1 |
| B: Health + confidence | health_score + confidence_score | Medium |
| C: All dimensions | health_score + all feature scores | High |

**Rationale for A:** Health score is the canonical aggregation of all dimensions. Trend analysis on health_score captures the composite trajectory. Analyzing individual dimensions (trend_score, momentum_score, etc.) is a V2+ enhancement.

### 5.2 Lookback Window

**PD-04B-03 (PLANNER DECISION REQUIRED):** How many historical snapshots for trend analysis?

| Option | Window | Trade-off |
|---|---|---|
| A: 7 snapshots | ~7 days (daily) | Responsive but noisy |
| B: 14 snapshots | ~14 days | Balanced ← recommended |
| C: 30 snapshots | ~30 days | Stable but slow to detect changes |
| D: Configurable | Per-entity or global | Most flexible |

### 5.3 Score Delta / Transition Threshold

**PD-04B-04 (PLANNER DECISION REQUIRED):** Minimum health_score change to trigger regime transition?

| Option | Threshold | Trade-off |
|---|---|---|
| A: 5 points | Sensitive, may oscillate | — |
| B: 10 points | Balanced ← recommended | — |
| C: 15 points | Conservative, may miss changes | — |
| D: Configurable | Per-entity or global | Most flexible |

### 5.4 Hysteresis

To prevent oscillation (chattering), regime transitions require:

1. **Minimum score delta** (PD-04B-04) — health_score must change by threshold
2. **Minimum persistence** (PD-04B-5) — score must remain in new range for N consecutive snapshots
3. **Neutral zone** — score range where regime does NOT change

```
If current_regime = STRONG:
  transitioning to STABLE requires:
    health_score < (upper_threshold - hysteresis)
    AND persisting for min_persistence snapshots

If current_regime = WEAK:
  transitioning to STABLE requires:
    health_score > (lower_threshold + hysteresis)
    AND persisting for min_persistence snapshots
```

**PD-04B-05 (PLANNER DECISION REQUIRED):** Minimum persistence (consecutive snapshots) before regime change?

| Option | Persistence | Trade-off |
|---|---|---|
| A: 1 snapshot | Immediate (no persistence) | May oscillate |
| B: 2 snapshots | Quick response ← recommended | Balanced |
| C: 3 snapshots | Conservative | Slow to detect |

### 5.5 Neutral Zone

The neutral zone is the health_score range where regime remains unchanged regardless of small fluctuations.

**TR-05:** The neutral zone MUST be symmetric around the STRONG/STABLE and STABLE/WEAK boundaries. The width equals the hysteresis value (PD-04B-04).

### 5.6 Transition Detection

A transition occurs when:
1. Health score crosses a threshold (PD-04B-04)
2. Score persists in new range for minimum duration (PD-04B-05)
3. The previous regime is different from the new regime

**TR-06:** A transition MUST NOT be detected if the score merely touches a threshold and immediately reverts. Persistence requirement prevents false transitions.

### 5.7 Insufficient Data Handling

| Snapshots Available | Behavior |
|---|---|
| 0 | No regime computed; entity excluded from trend analysis |
| 1 | Regime = INSUFFICIENT_DATA; no transition possible |
| 2 | Basic direction possible (improving/declining); regime = INSUFFICIENT_DATA |
| ≥ lookback window | Full regime classification |

**TR-07:** INSUFFICIENT_DATA is NOT a QualityState. It is a regime classification for entities with insufficient history.

---

## 6. State Machine

### 6.1 States

```
                    ┌──────────────┐
                    │ INSUFFICIENT │
                    │    _DATA     │
                    └──────┬───────┘
                           │ (≥ lookback snapshots)
                           ▼
                    ┌──────────────┐
          ┌────────│   UNKNOWN    │────────┐
          │        └──────────────┘        │
          │               │                │
          ▼               ▼                ▼
   ┌──────────┐    ┌──────────┐    ┌──────────┐
   │  STRONG  │◄──►│  STABLE  │◄──►│   WEAK   │
   └──────────┘    └──────────┘    └──────────┘
          │               │                │
          └───────┬───────┘────────────────┘
                  │
                  ▼
           ┌──────────┐
           │TRANSITION│
           │   ING    │
           └──────────┘
```

### 6.2 Transition Rules

| From | To | Condition |
|---|---|---|
| INSUFFICIENT_DATA | UNKNOWN | ≥ 2 snapshots available |
| UNKNOWN | STRONG | health_score ≥ upper_threshold for persistence |
| UNKNOWN | STABLE | health_score in neutral zone for persistence |
| UNKNOWN | WEAK | health_score ≤ lower_threshold for persistence |
| STRONG | STABLE | health_score < (upper_threshold - hysteresis) for persistence |
| STRONG | WEAK | health_score ≤ lower_threshold for persistence (skips STABLE) |
| STABLE | STRONG | health_score ≥ upper_threshold for persistence |
| STABLE | WEAK | health_score ≤ lower_threshold for persistence |
| WEAK | STABLE | health_score > (lower_threshold + hysteresis) for persistence |
| WEAK | STRONG | health_score ≥ upper_threshold for persistence (skips STABLE) |
| Any | TRANSITIONING | Score is crossing threshold but persistence not yet met |
| TRANSITIONING | (target state) | Persistence requirement met |

### 6.3 Anti-Oscillation Mechanisms

| Mechanism | Description | PD Reference |
|---|---|---|
| Hysteresis | Score must cross threshold by hysteresis margin | PD-04B-04 |
| Persistence | Score must remain in new range for N snapshots | PD-04B-05 |
| Neutral zone | Score range where no transition occurs | Derived from PD-04B-04 |
| Direction lock | Once transitioning, direction is locked until completion or revert | TR-08 |

**TR-08:** Once a transition begins (TRANSITIONING state), the target regime is locked. The transition completes when persistence is met, or reverts if score returns to previous range before persistence is met.

### 6.4 State Properties

| Property | Definition |
|---|---|
| current_state | The current RegimeState |
| previous_state | The state before the most recent transition |
| transition_started_at | When the current transition began (null if stable) |
| transition_target | The target state during transition (null if stable) |
| consecutive_count | Number of consecutive snapshots in current regime |
| score_at_transition | Health score when the current transition began |

---

## 7. Quality Semantics

### 7.1 QualityState Preservation

**TR-09:** Quality states (VALID/INVALID/MISSING/UNKNOWN) from P6-03 snapshots MUST be preserved as metadata in regime results. They MUST NOT be reinterpreted, converted into regime states, or used to generate new QualityState values.

### 7.2 Quality Impact on Regime

| Input Quality | Impact on Regime |
|---|---|
| VALID | Regime computed normally |
| INVALID | Snapshot excluded from trend analysis; regime unchanged |
| MISSING | Snapshot excluded from trend analysis; regime unchanged |
| UNKNOWN | Snapshot included but flagged; regime computed with reduced confidence |

**TR-10:** INVALID or MISSING input snapshots are excluded from trend analysis but do NOT change the current regime. The regime remains whatever it was before the invalid/missing data.

### 7.3 Quality Metadata in Regime Output

```
RegimeQualityMetadata
├── input_snapshots_total
├── input_snapshots_valid
├── input_snapshots_invalid
├── input_snapshots_missing
├── input_snapshots_unknown_quality
└── data_sufficiency  (0–100, based on valid/total)
```

**TR-11:** The regime MUST NOT create new QualityState values. Quality vocabulary remains: VALID | INVALID | MISSING | UNKNOWN.

---

## 8. Freshness Semantics

### 8.1 Independence from Quality

**TR-12:** Freshness (FRESH/STALE/UNKNOWN) from P6-03 snapshots MUST be preserved as metadata. It MUST NOT be converted into quality states, regime states, or used to gate regime computation.

### 8.2 Freshness Weighting — DEFERRED

**PD-04B-06 (PLANNER DECISION REQUIRED):** Should freshness weighting affect trend analysis?

| Option | Behavior |
|---|---|
| A: No weighting V1 | All snapshots treated equally regardless of freshness ← recommended |
| B: STALE snapshots reduced weight | Stale data contributes less to trend analysis |
| C: STALE snapshots excluded | Only FRESH snapshots used for trend |

**Rationale for A:** Consistent with P6-03 PD-03B-01 (no freshness weighting V1). Freshness metadata is recorded for provenance; weighting is a future enhancement.

### 8.3 Freshness Metadata in Regime Output

```
RegimeFreshnessMetadata
├── input_snapshots_fresh
├── input_snapshots_stale
├── input_snapshots_unknown_freshness
└── freshness_coverage  (0–100, fresh/total)
```

---

## 9. Temporal Semantics

### 9.1 Lookback Window

The lookback window defines how many historical snapshots are used for trend analysis.

**PD-04B-03:** Configurable (7/14/30 snapshots).

### 9.2 Temporal Alignment

**TR-13:** Snapshots used for trend analysis MUST be ordered by `calculation_time` (or `window_end`). The most recent snapshot is the "current" state.

### 9.3 Temporal Tolerance (OI-02)

**PD-04B-07 (PLANNER DECISION REQUIRED — maps to OI-02):** How to handle gaps in snapshot history?

| Option | Behavior |
|---|---|
| A: Tolerate gaps up to N days | Snapshots within tolerance treated as continuous ← recommended |
| B: Require strict daily snapshots | Any gap breaks trend analysis |
| C: Interpolate missing days | Synthetic snapshots for gaps |
| D: Configurable tolerance | Per-entity or global |

**Evidence gap:** OI-02 was deferred in P6-01. P6-04 is the first phase that genuinely needs temporal alignment. Recommend resolving OI-02 in P6-04C1 decision inventory.

### 9.4 Calculation Time vs Window End

- `calculation_time` = wall-clock when regime was computed (for provenance)
- `window_end` = end of input data window (from snapshot)
- Regime is computed from snapshots, not from wall-clock time

---

## 10. Multi-Timeframe — V1 Scope

**PD-04B-08 (PLANNER DECISION REQUIRED):** V1 timeframe scope?

| Option | Scope |
|---|---|
| A: DAILY only | Single timeframe, consistent with P6-03 V1 ← recommended |
| B: DAILY + 4H | Multi-timeframe regime detection |
| C: Configurable | Per-entity timeframe |

**TR-14:** V1 scope is DAILY timeframe only, consistent with P6-03 PD-03B-07. Multi-timeframe is a V2 enhancement.

---

## 11. Versioning

### 11.1 RegimeVersion Tuple

```
RegimeVersion = {
  algorithm_version: string;    // "p6-regime-v1"
  parameter_version: string;    // "default-v1"
  schema_version: string;       // "v1"
  config_hash: string;          // hash of regime configuration
}
```

### 11.2 Version Layering

| Layer | Version Source | Propagation |
|---|---|---|
| Feature calculation | P6-02 FeatureVersion | Feature → Snapshot |
| Snapshot generation | P6-03 SnapshotVersion | Snapshot → Regime |
| Regime detection | P6-04 RegimeVersion | Regime → provenance |

**TR-15:** The regime version tuple is SEPARATE from the snapshot version tuple. A regime record records which snapshot version it consumed AND its own algorithm version.

---

## 12. Provenance

### 12.1 Minimum Regime Provenance

```
RegimeProvenance
├── calculation_time          (UTC wall-clock)
├── regime_version            (RegimeVersion tuple)
├── input_snapshot_ids        (references to P6-03 snapshots used)
│   ├── snapshot_id           (FK to p6_snapshots)
│   ├── entity_type           ("coin" | "narrative")
│   ├── entity_id             (coin or narrative ID)
│   ├── health_score          (value at time of snapshot)
│   ├── calculation_time      (when snapshot was computed)
│   └── snapshot_version      (SnapshotVersion tuple)
├── lookback_window           (number of snapshots analyzed)
├── input_window_start        (earliest snapshot used)
├── input_window_end          (latest snapshot used)
├── transition_from           (previous RegimeState, if transition occurred)
├── transition_to             (new RegimeState, if transition occurred)
├── transition_confidence     (0–100, based on persistence and evidence)
└── quality_summary           (from input snapshots)
```

### 12.2 Provenance Immutability

**TR-16:** Once a regime record is persisted, its provenance is immutable. Recalculation produces a new regime record with new `calculation_time` and potentially different provenance.

---

## 13. Persistence

### 13.1 Proposed Table: `p6_regime_states`

**PLANNER DECISION REQUIRED (PD-04B-09):** Table design.

| Column | Type | Purpose |
|---|---|---|
| id | serial PK | Primary key |
| entity_type | varchar(20) | "coin" \| "narrative" |
| entity_id | integer | Coin or narrative ID |
| regime_state | varchar(20) | Current RegimeState |
| previous_state | varchar(20) \| null | Previous RegimeState |
| health_score_at_transition | real \| null | Score when transition began |
| consecutive_count | integer | Snapshots in current regime |
| transition_started_at | timestamp \| null | When transition began |
| regime_version_* | text (4 cols) | RegimeVersion tuple |
| snapshot_version_id | integer \| null | FK to p6_snapshots |
| provenance | jsonb NOT NULL | Full provenance |
| quality_metadata | jsonb | Quality summary |
| freshness_metadata | jsonb | Freshness summary |
| calculation_time | timestamp NOT NULL | UTC wall-clock |
| created_at | timestamp NOT NULL | Record creation |

### 13.2 Identity

```
RegimeIdentity = (entity_type, entity_id, regime_state, calculation_time)
```

**TR-17:** Uniqueness per `(entity_type, entity_id)` for CURRENT regime. Historical regime records retained for trend analysis.

### 13.3 Latest-Only + History

- **Current regime:** Only one record per `(entity_type, entity_id)` with `status = "CURRENT"`
- **Historical regime:** Previous records retained with `status = "SUPERSEDED"` for trend analysis
- **Retention:** DEFERRED to V2 (P6-08)

**TR-18:** Current regime is the single latest record. Historical records enable lookback window computation.

---

## 14. Determinism / Replay

### 14.1 Determinism Contract

**TR-19:** Given the same input snapshots, same lookback window, same regime version, and same configuration, regime computation MUST produce identical output.

### 14.2 Recomputation vs Historical Read

| Concept | Definition | Who Owns |
|---|---|---|
| **Recomputation** | Fresh regime calculation from current snapshots | P6-04 |
| **Historical Regime Read** | Reading a persisted regime record | P6-04 (read path) |
| **P5 Replay** | Reconstructing P5 decisions from historical artifacts | P5 (frozen) |

**TR-20:** P6-04 regime records are NOT part of the P5 replay artifact chain. P5-07 replay reads from P5's own artifact tables.

---

## 15. P4/P5 Boundary

### 15.1 Non-Interference

**TR-21:** P6-04 MUST NOT modify any P4 or P5 contract, implementation, or behavior.

| Protected | Obligation |
|---|---|
| P4 interpretation engine | Untouched |
| P5 rule engine | Untouched |
| P5 policy/safety evaluator | Untouched |
| P5 decision producer | Untouched |
| P5 artifact recorder | Untouched |
| P5 replay engine | Untouched |

### 15.2 No Action Semantics

**TR-22:** Regime states MUST NOT be interpreted as:
- Buy/sell signals
- Execution permissions
- Action policies
- Risk management thresholds
- Position sizing
- Entry/exit levels

Regime describes intelligence state; P5 consumes that state for decision-making.

---

## 16. Decision Inventory

### 16.1 Explicit Decisions

| ID | Question | Options | Recommended | Blocking | Dependency |
|---|---|---|---|---|---|
| PD-04B-01 | Regime vocabulary | A: 3-state + transitions, B: 5-state, C: direction-only, D: configurable | A | YES | None |
| PD-04B-02 | Input dimensions | A: health_score only, B: health+confidence, C: all dimensions | A | NO | PD-04B-01 |
| PD-04B-03 | Lookback window | A: 7, B: 14, C: 30, D: configurable | B | NO | PD-04B-01 |
| PD-04B-04 | Transition threshold | A: 5pts, B: 10pts, C: 15pts, D: configurable | B | YES | PD-04B-01 |
| PD-04B-05 | Minimum persistence | A: 1, B: 2, C: 3 snapshots | B | YES | PD-04B-04 |
| PD-04B-06 | Freshness weighting | A: no V1, B: reduced weight, C: excluded | A | NO | P6-03 PD-03B-01 |
| PD-04B-07 | Temporal tolerance (OI-02) | A: tolerate gaps, B: strict, C: interpolate, D: configurable | A | NO | None |
| PD-04B-08 | V1 timeframe | A: DAILY only, B: DAILY+4H, C: configurable | A | NO | P6-03 PD-03B-07 |
| PD-04B-09 | Table design | New p6_regime_states table | — | NO | None |

### 16.2 Implicit Decisions

| ID | Question | Evidence | Recommendation |
|---|---|---|---|
| PD-04B-10 | Coin vs narrative regime: same model? | P6-03 uses same snapshot structure | Yes, same model V1 |
| PD-04B-11 | Maximum gap tolerance? | No production evidence | 3 consecutive missing snapshots → INSUFFICIENT_DATA |
| PD-04B-12 | Transition confidence formula? | No existing formula | Persistence met → high confidence; partial → proportional |
| PD-04B-13 | UNKNOWN input handling? | P6-03 UNKNOWN quality included | Include in trend, flag in metadata |

### 16.3 Decision Dependencies

```
PD-04B-01 (vocabulary) ─────────────────────────┐
  ├→ PD-04B-02 (dimensions) ───────────────────┤
  ├→ PD-04B-03 (lookback) ─────────────────────┤
  ├→ PD-04B-04 (threshold) ─→ PD-04B-05 (persistence) ─┤
  ├→ PD-04B-10 (coin vs narrative) ────────────┤
  ├→ PD-04B-11 (max gap) ──────────────────────┤
  └→ PD-04B-12 (confidence) ───────────────────┘
                                              │
PD-04B-06 (freshness) ────────────────────────┤
PD-04B-07 (temporal tolerance / OI-02) ───────┤
PD-04B-08 (timeframe) ────────────────────────┤
PD-04B-09 (table design) ─────────────────────┘
```

**Critical path:** PD-04B-01 → PD-04B-04 → PD-04B-05 → implementation

---

## 17. Invariants

| ID | Invariant | Rationale | Violation |
|---|---|---|---|
| **TR-01** | Trend MUST NOT bypass pipeline layers | Layer integrity | CLASS-A |
| **TR-02** | Trend MUST NOT introduce BUY/SELL or P5 semantics | P4/P5 boundary | CLASS-A |
| **TR-03** | Trend MUST consume P6-03 snapshots only | Input authority | CLASS-A |
| **TR-04** | Regime vocabulary MUST be finite and versioned | Determinism | CLASS-B |
| **TR-05** | Neutral zone MUST be symmetric | Prevent bias | CLASS-B |
| **TR-06** | Transition MUST require persistence (anti-oscillation) | Stability | CLASS-B |
| **TR-07** | INSUFFICIENT_DATA is NOT a QualityState | Vocabulary separation | CLASS-A |
| **TR-08** | Transition direction locked once started | Consistency | CLASS-B |
| **TR-09** | Quality preserved as metadata, not regime state | P6-01D boundary | CLASS-A |
| **TR-10** | INVALID/MISSING excludes snapshot, does not change regime | Quality independence | CLASS-A |
| **TR-11** | Trend MUST NOT create new QualityState values | P6-01D vocabulary | CLASS-A |
| **TR-12** | Freshness preserved as metadata, not regime state | P6-01C boundary | CLASS-A |
| **TR-13** | Snapshots ordered by calculation_time | Temporal correctness | CLASS-B |
| **TR-14** | V1 DAILY timeframe only | Scope control | CLASS-B |
| **TR-15** | RegimeVersion separate from SnapshotVersion | Layer independence | CLASS-B |
| **TR-16** | Provenance immutable once persisted | Record integrity | CLASS-B |
| **TR-17** | Current regime unique per (entity_type, entity_id) | Consistency | CLASS-B |
| **TR-18** | Current regime = single latest record | Latest-only semantics | CLASS-B |
| **TR-19** | Same inputs + versions → same regime | Determinism | CLASS-B |
| **TR-20** | P6-04 regime ≠ P5 replay artifact | Replay boundary | CLASS-A |
| **TR-21** | P6-04 MUST NOT modify P4/P5 | P4/P5 boundary | CLASS-A |
| **TR-22** | Regime MUST NOT be interpreted as action/signal | No BUY/SELL | CLASS-A |

---

## 18. Deferred Items

| ID | Item | Resolution Phase | Blocking P6-04? |
|---|---|---|---|
| OI-01 | FR range bound | P6-02+ | NO |
| OI-02 | Temporal tolerance | **P6-04B PD-04B-07** | NO (resolved in this contract) |
| OI-03 | Dedup remediation | Product decision | NO |
| OI-04 | Cross-source comparator | P6-02+ | NO |
| OI-05 | Historical retention | P6-08 | NO |
| OI-06 | Feature gating | P6-02 | NO |
| OI-07 | Signal unification | P6-06 | NO |
| OI-08 | Mixed aggregation | P6-02 | NO |
| PD-03B-01 | STALE weighting | P6-02E+ / P6-04B PD-04B-06 | NO |
| PD-03B-13 | Snapshot retention | P6-08 | NO |

---

## 19. Implementation Readiness Gate

Before P6-04C (decision inventory) can proceed:

| Condition | Status |
|---|---|
| P6-04B contract complete | ✅ THIS DOCUMENT |
| PD-04B-01 (vocabulary) resolved | PENDING Planner |
| PD-04B-04 (threshold) resolved | PENDING Planner |
| PD-04B-05 (persistence) resolved | PENDING Planner |
| P6-02 frozen | PENDING Planner |
| P6-03 frozen | PENDING Planner |

**PD-04B-01, PD-04B-04, PD-04B-05 are BLOCKING for P6-04D implementation.**

---

## 20. Acceptance Checklist

- [x] Purpose and boundary defined (§1)
- [x] Input authority defined (§2–3)
- [x] Regime vocabulary proposed (§4)
- [x] Trend model designed (§5)
- [x] State machine designed (§6)
- [x] Quality semantics preserved (§7)
- [x] Freshness semantics preserved (§8)
- [x] Temporal semantics defined (§9)
- [x] V1 scope defined (§10)
- [x] Versioning designed (§11)
- [x] Provenance defined (§12)
- [x] Persistence proposed (§13)
- [x] Determinism/replay defined (§14)
- [x] P4/P5 boundary protected (§15)
- [x] Decision inventory complete (§16) — 9 explicit + 4 implicit
- [x] Invariants defined (§17) — 22 invariants
- [x] Deferred items mapped (§18)
- [x] Implementation readiness gate defined (§19)
- [x] No production code modified
- [x] No schema/migration changes
- [x] No P6-01/02/03 contract modifications
- [x] No P3/P4/P5 modifications
- [x] All decisions marked PROPOSED
