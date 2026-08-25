# P6-04C — Trend / Regime Planner Decision Contract

**Date:** 2026-08-26
**Task Type:** PLANNER DECISION CONTRACT — proposed resolutions awaiting Planner acceptance
**Baseline:** P6-04B Semantic Contract (`ae8b1b1`)
**Frozen Authorities:** P6-01B/C/D/E, P6-02B/C/C2/D/E, P6-03B/C1/C2 (all frozen/accepted)
**Git boundary:** ONLY this document. No production code, schema, API, P4/P5, or P6-01/02/03 changes.

---

## 1. Purpose

Convert the P6-04B decision inventory into a formal Planner Decision Contract. Provides exact proposed resolutions, dependency mapping, semantic audits, and implementation readiness criteria for all 13 P6-04 decisions.

**Critical distinction:** This document contains PROPOSED resolutions. The Agent does NOT freeze decisions. Planner acceptance is required before any resolution becomes FROZEN.

---

## 2. Decision Status Summary

| ID | Decision | Status | Blocking |
|---|---|---|---|
| PD-04B-01 | Regime vocabulary | **PROPOSED** | YES |
| PD-04B-02 | Input dimensions | **PROPOSED** | NO |
| PD-04B-03 | Lookback window | **PROPOSED** | NO |
| PD-04B-04 | Transition threshold | **PROPOSED** | YES |
| PD-04B-05 | Minimum persistence | **PROPOSED** | YES |
| PD-04B-06 | Freshness weighting | **PROPOSED** | NO |
| PD-04B-07 | Temporal tolerance (OI-02) | **PROPOSED** | NO |
| PD-04B-08 | V1 timeframe | **PROPOSED** | NO |
| PD-04B-09 | Table design | **PROPOSED** | NO |
| PD-04B-10 | Coin vs narrative model | **PROPOSED** | NO |
| PD-04B-11 | Maximum gap tolerance | **PROPOSED** | NO |
| PD-04B-12 | Transition confidence formula | **PROPOSED** | NO |
| PD-04B-13 | UNKNOWN input handling | **PROPOSED** | NO |

---

## 3. Decision Register

### 3.1 PD-04B-01 — Regime Vocabulary (BLOCKING)

**Question:** What finite vocabulary defines regime states?

**Options Analyzed:**

| Option | Vocabulary | Pros | Cons |
|---|---|---|---|
| A: 3-state + transitions | STRONG, STABLE, WEAK + TRANSITIONING, INSUFFICIENT_DATA, UNKNOWN | Simple, clear, explainable, anti-oscillation natural | 3 states may miss nuance |
| B: 5-state direction | STRONG, STRENGTHENING, NEUTRAL, WEAKENING, DETERIORATING | More granular | Conflates direction with state; harder to explain; oscillation risk |
| C: Direction-only | IMPROVING, STABLE, DECLINING | Minimal, no categorical state | Loses "how healthy" information; only "which direction" |
| D: Configurable | Per-entity or per-narrative vocabulary | Maximum flexibility | Complexity; no standard vocabulary |

**Evidence Basis:**
- P6-02 health score is 0–100 (continuous numeric)
- P6-03 snapshots preserve this score
- P5 rule engine reads numeric scores for decision-making
- Master spec (§8) proposes direction vocabulary but conflates direction with state

**Proposed Resolution: Option A — 3-state core + transition/uncertainty**

```
RegimeState = STRONG | STABLE | WEAK | TRANSITIONING | INSUFFICIENT_DATA | UNKNOWN
```

**Rationale:**
- STRONG/STABLE/WEAK are categorical states that describe health trajectory
- TRANSITIONING captures the "in motion" state (anti-oscillation mechanism)
- INSUFFICIENT_DATA handles cold-start and data gaps
- UNKNOWN handles classification failure
- Separates "what direction" (transition metadata) from "what state" (regime)
- Compatible with P6-02 numeric scores (regime is a layer above score)
- Explainable: "The coin is in STRONG regime" is clearer than "The coin is STRENGTHENING"

**Dependencies:** None (foundational)

**Blocking:** YES — all downstream decisions depend on vocabulary

**Implementation Impact:** High — defines state machine, persistence schema, tests

**Related Invariants:** TR-04 (finite vocabulary), TR-07 (INSUFFICIENT_DATA ≠ QualityState)

**Planner Acceptance Criterion:** Accept Option A or specify alternative vocabulary with explicit states.

---

### 3.2 PD-04B-02 — Input Dimensions

**Question:** Which health dimensions feed trend analysis?

**Options:**

| Option | Dimensions | Complexity | Coverage |
|---|---|---|---|
| A: Health score only | health_score (0–100) | Low | Composite view ← recommended |
| B: Health + confidence | health_score + confidence_score | Medium | Adds data quality signal |
| C: All dimensions | health + trend + momentum + volume + derivative | High | Maximum detail |

**Proposed Resolution: Option A — health_score only**

**Rationale:** Health score is the canonical P6-02 aggregation of all dimensions. Trend analysis on health_score captures the composite trajectory. Individual dimension analysis is a V2 enhancement.

**Dependencies:** PD-04B-01

---

### 3.3 PD-04B-03 — Lookback Window

**Question:** How many historical snapshots for trend analysis?

**Options:**

| Option | Window | ~Duration (daily) | Trade-off |
|---|---|---|---|
| A: 7 | 7 snapshots | 7 days | Responsive but noisy |
| B: 14 | 14 snapshots | 14 days | Balanced ← recommended |
| C: 30 | 30 snapshots | 30 days | Stable but slow |
| D: Configurable | Per-entity or global | Variable | Most flexible |

**Proposed Resolution: Option B — 14 snapshots (~2 weeks)**

**Rationale:** 14 daily snapshots provide 2 weeks of history, sufficient to detect regime changes without being overly sensitive to daily noise. Consistent with typical crypto market cycle observation windows.

**Dependencies:** PD-04B-01

---

### 3.4 PD-04B-04 — Transition Threshold (BLOCKING)

**Question:** Minimum health_score change to trigger regime transition?

**Analysis:**

| Threshold | Neutral Zone Width | False Transition Risk | Sensitivity | Determinism |
|---|---|---|---|---|
| 5 points | ±5 (10 total) | HIGH — daily noise exceeds 5pts | Very sensitive | May oscillate |
| 10 points | ±10 (20 total) | MEDIUM — balanced | Balanced ← recommended | Deterministic |
| 15 points | ±15 (30 total) | LOW — only large moves trigger | Conservative | Stable |

**Relation to health score scale (0–100):**
- 5 points = 5% of scale — too sensitive
- 10 points = 10% of scale — captures meaningful changes
- 15 points = 15% of scale — only major shifts

**Neutral zone derivation:**
- Threshold = 10 points
- Hysteresis = 10 points (same as threshold for simplicity)
- Neutral zone = ±10 around STRONG/STABLE boundary (70) and STABLE/WEAK boundary (30)
- STRONG: health_score ≥ 80 (70 + 10 hysteresis)
- STABLE: 40 ≤ health_score ≤ 60 (with hysteresis)
- WEAK: health_score ≤ 20 (30 - 10 hysteresis)

**Proposed Resolution: 10 points (absolute threshold on 0–100 scale)**

**Dependencies:** PD-04B-01

---

### 3.5 PD-04B-05 — Minimum Persistence (BLOCKING)

**Question:** How many consecutive snapshots must the score remain in new range before regime change?

**Analysis:**

| Persistence | Transition Latency | Noise Resistance | Interaction with Hysteresis |
|---|---|---|---|
| 1 snapshot | Immediate (0 day delay) | LOW — any spike triggers | Hysteresis alone prevents oscillation |
| 2 snapshots | 1 day delay | MEDIUM ← recommended | Hysteresis + persistence = robust |
| 3 snapshots | 2 day delay | HIGH — very stable | May miss fast transitions |

**Daily timeframe implications:**
- 1 snapshot = regime changes within same day
- 2 snapshots = regime changes next day (1-day confirmation)
- 3 snapshots = regime changes in 2 days (2-day confirmation)

**Proposed Resolution: 2 consecutive snapshots**

**Rationale:** 2-day confirmation balances responsiveness with noise resistance. Combined with 10-point hysteresis, this provides robust anti-oscillation without excessive delay.

**Dependencies:** PD-04B-04

---

### 3.6 PD-04B-06 — Freshness Weighting

**Question:** Should freshness affect trend analysis?

**Proposed Resolution: Option A — No weighting V1**

**Rationale:** Consistent with P6-03 PD-03B-01 (no freshness weighting V1). Freshness metadata is recorded for provenance; weighting is a future enhancement.

**Dependencies:** P6-03 PD-03B-01

---

### 3.7 PD-04B-07 — Temporal Tolerance (OI-02)

**Question:** How to handle gaps in snapshot history?

**OI-02 Mapping:** This decision resolves OI-02 (temporal tolerance) for P6-04 scope. OI-02 was deferred in P6-01; P6-04 is the first phase that genuinely needs temporal alignment.

**Options:**

| Option | Behavior | Trade-off |
|---|---|---|
| A: Tolerate gaps ≤ 3 days | Snapshots within tolerance treated as continuous ← recommended | May miss gap信号 |
| B: Strict daily | Any gap breaks trend analysis | Too strict; production gaps expected |
| C: Interpolate | Synthetic snapshots for gaps | Complexity; may fabricate data |
| D: Configurable | Per-entity tolerance | Maximum flexibility |

**Proposed Resolution: Option A — Tolerate gaps up to 3 consecutive missing snapshots**

**Rationale:** Production refresh may miss days (API failures, manual triggers). Tolerating 3-day gaps maintains trend continuity without fabricating data. Gaps > 3 days → INSUFFICIENT_DATA.

**Boundary:** This resolves OI-02 ONLY for P6-04 trend detection scope. OI-02 for other P6 phases remains deferred.

**Dependencies:** None

---

### 3.8 PD-04B-08 — V1 Timeframe

**Question:** V1 timeframe scope for regime detection?

**Proposed Resolution: Option A — DAILY only**

**Rationale:** Consistent with P6-03 PD-03B-07 (DAILY only V1). Multi-timeframe is a V2 enhancement.

**Snapshot input compatibility:** P6-03 produces DAILY snapshots only in V1. P6-04 reads these directly.

**Dependencies:** P6-03 PD-03B-07

---

### 3.9 PD-04B-09 — Table Design

**Question:** Persistence model for regime states?

**Proposed Resolution: New `p6_regime_states` table**

**Schema proposal:**
```sql
p6_regime_states (
  id serial PRIMARY KEY,
  entity_type varchar(20) NOT NULL,      -- "coin" | "narrative"
  entity_id integer NOT NULL,
  regime_state varchar(20) NOT NULL,     -- RegimeState vocabulary
  previous_state varchar(20),            -- nullable for initial state
  health_score_at_transition real,       -- score when transition began
  consecutive_count integer NOT NULL,    -- snapshots in current regime
  transition_started_at timestamp,       -- when transition began
  snapshot_version_id integer,           -- FK to p6_snapshots
  -- RegimeVersion tuple
  regime_algorithm_version text NOT NULL,
  regime_parameter_version text NOT NULL,
  regime_schema_version text NOT NULL,
  regime_config_hash text NOT NULL,
  -- Metadata
  provenance jsonb NOT NULL,
  quality_metadata jsonb,
  freshness_metadata jsonb,
  -- Status
  status varchar(20) NOT NULL DEFAULT 'CURRENT',  -- CURRENT | SUPERSEDED
  -- Timestamps
  calculation_time timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
)
```

**Indexes:**
- `entity_idx` on (entity_type, entity_id, status)
- `unique_current` on (entity_type, entity_id) WHERE status = 'CURRENT'

**Dependencies:** PD-04B-01

---

### 3.10 PD-04B-10 — Coin vs Narrative Model

**Question:** Same regime model for coins and narratives?

**Proposed Resolution: Yes, same model V1**

**Rationale:** P6-03 uses the same snapshot structure for both. Health score (0–100) is the universal input. Same thresholds, same state machine, same vocabulary.

**Dependencies:** PD-04B-01

---

### 3.11 PD-04B-11 — Maximum Gap Tolerance

**Question:** How many consecutive missing snapshots before INSUFFICIENT_DATA?

**Proposed Resolution: 3 consecutive missing snapshots**

**Rationale:** Aligns with PD-04B-07 (tolerate gaps ≤ 3 days). After 3 consecutive missing snapshots, the lookback window has insufficient data for reliable trend analysis.

**Dependencies:** PD-04B-07

---

### 3.12 PD-04B-12 — Transition Confidence Formula

**Question:** How to compute confidence in a regime transition?

**Proposed Resolution:**

```
transition_confidence = min(100, consecutive_count / min_persistence × 100)
```

- consecutive_count ≥ min_persistence → confidence = 100
- consecutive_count < min_persistence → confidence proportional
- No transition → confidence = 0

**Rationale:** Confidence reflects how strongly the transition is confirmed. Full persistence = full confidence. Partial persistence = proportional confidence.

**Dependencies:** PD-04B-05

---

### 3.13 PD-04B-13 — UNKNOWN Input Handling

**Question:** How to handle snapshots with UNKNOWN quality in trend analysis?

**Proposed Resolution: Include in trend, flag in metadata**

**Rationale:** Consistent with P6-02 PD-03 (UNKNOWN observations are included in feature computation). UNKNOWN quality ≠ INVALID. The snapshot has a health_score; trend analysis uses it. Quality metadata flags the uncertainty.

**Dependencies:** P6-01D quality vocabulary

---

## 4. Dependency Graph

```
PD-04B-01 (vocabulary) ─────────────────────────┐
  │                                              │
  ├→ PD-04B-02 (dimensions) ────────────────────┤
  ├→ PD-04B-03 (lookback) ──────────────────────┤
  ├→ PD-04B-04 (threshold) ───→ PD-04B-05 (persistence) ──→ PD-04B-12 (confidence)
  ├→ PD-04B-10 (coin vs narrative) ─────────────┤
  ├→ PD-04B-11 (max gap) ───────────────────────┤
  └→ PD-04B-09 (table design) ──────────────────┘
                                                  │
PD-04B-06 (freshness) ────────────────────────────┤
PD-04B-07 (temporal tolerance / OI-02) ───────────┤
PD-04B-08 (timeframe) ───────────────────────────┘
```

**Critical path:** PD-04B-01 → PD-04B-04 → PD-04B-05 → PD-04B-12 → implementation

---

## 5. Blocking Analysis

| Decision | Why Blocking | Safe Default? | Resolution Required Before |
|---|---|---|---|
| PD-04B-01 | Defines state machine vocabulary; all downstream depend on it | NO — vocabulary must be explicit | P6-04D |
| PD-04B-04 | Defines transition thresholds; state machine cannot be implemented without it | NO — thresholds must be explicit | P6-04D |
| PD-04B-05 | Defines persistence requirement; anti-oscillation depends on it | NO — persistence must be explicit | P6-04D |

**All 3 blocking decisions have PROPOSED resolutions.** No decision requires further evidence to resolve.

---

## 6. Temporal Decision (OI-02)

**PD-04B-07 resolves OI-02 for P6-04 scope.**

- **Current OI-02 status:** Deferred in P6-01
- **P6-04 resolution:** Tolerate gaps ≤ 3 consecutive missing snapshots
- **Boundary:** This resolution applies ONLY to P6-04 trend detection
- **Other P6 phases:** OI-02 remains deferred for non-trend use cases
- **No frozen contract modified:** OI-02 was never frozen; resolution is within P6-04 scope

---

## 7. Multi-Timeframe Confirmation

**PD-04B-08 confirms DAILY V1.**

- P6-03 produces DAILY snapshots only (PD-03B-07)
- P6-04 reads these DAILY snapshots directly
- No 4H or intraday regime detection in V1
- Multi-timeframe is explicitly deferred to V2

---

## 8. Persistence Identity Audit

**Proposed identity:** `(entity_type, entity_id, regime_state, calculation_time)`

**Uniqueness constraint:** `(entity_type, entity_id)` WHERE status = 'CURRENT'

**Audit:**
- ✅ Distinct from observation identity (P6-01B)
- ✅ Distinct from feature identity (P6-02B)
- ✅ Distinct from snapshot identity (P6-03B)
- ✅ Latest-only semantics via status = CURRENT/SUPERSEDED
- ✅ Historical records retained for lookback window
- ✅ Transition events are persisted as separate records (status = SUPERSEDED after transition)
- ✅ Version integrity via RegimeVersion tuple
- ✅ Provenance immutable once persisted

---

## 9. Invariants Audit

### 9.1 TR-01…TR-22 Verification

| ID | Invariant | Status |
|---|---|---|
| TR-01 | No pipeline bypass | ✅ Consumes P6-03 snapshots |
| TR-02 | No BUY/SELL semantics | ✅ Regime describes state |
| TR-03 | P6-native inputs only | ✅ Reads from p6_snapshots |
| TR-04 | Finite versioned vocabulary | ✅ 6 states defined |
| TR-05 | Symmetric neutral zone | ✅ Derived from threshold |
| TR-06 | Persistence anti-oscillation | ✅ 2 consecutive snapshots |
| TR-07 | INSUFFICIENT_DATA ≠ QualityState | ✅ Regime vocabulary |
| TR-08 | Transition direction lock | ✅ Target locked once started |
| TR-09 | Quality as metadata | ✅ Preserved, not regime state |
| TR-10 | INVALID/MISSING excludes, not changes regime | ✅ Excluded from analysis |
| TR-11 | No new QualityState | ✅ 4 frozen states only |
| TR-12 | Freshness as metadata | ✅ Preserved, not regime state |
| TR-13 | Snapshots ordered by calculation_time | ✅ Temporal ordering |
| TR-14 | V1 DAILY only | ✅ Consistent with P6-03 |
| TR-15 | RegimeVersion separate from SnapshotVersion | ✅ Independent tuples |
| TR-16 | Provenance immutable | ✅ Stored as JSONB |
| TR-17 | Current regime unique per entity | ✅ Unique constraint |
| TR-18 | Current = single latest | ✅ Status = CURRENT |
| TR-19 | Deterministic | ✅ Same inputs → same output |
| TR-20 | ≠ P5 replay artifact | ✅ No P5 dependency |
| TR-21 | P4/P5 untouched | ✅ No imports |
| TR-22 | No action semantics | ✅ No BUY/SELL |

### 9.2 Additional Invariants

| ID | Invariant | Rationale | Violation |
|---|---|---|---|
| **TR-23** | Regime MUST NOT invent health scores | No synthetic data | CLASS-A |
| **TR-24** | Gap tolerance ≤ max_gap before INSUFFICIENT_DATA | Data sufficiency | CLASS-B |
| **TR-25** | Transition confidence = 100 when persistence met | Determinism | CLASS-B |
| **TR-26** | UNKNOWN inputs included in trend, flagged in metadata | Consistency with P6-02 PD-03 | CLASS-B |

---

## 10. Evidence Gaps

| ID | Gap | Why Needed | Resolution |
|---|---|---|---|
| EG-1 | Production health score variance | Threshold calibration | Monitor after deployment |
| EG-2 | Production refresh frequency | Gap tolerance tuning | PD-04B-07 default (3 days) |
| EG-3 | Coin vs narrative trend differences | Model separation | PD-04B-10 default (same model) |

**Assessment:** All gaps have safe V1 defaults. None blocks implementation.

---

## 11. Implementation Readiness Gate

| Condition | Status |
|---|---|
| P6-04B contract complete | ✅ |
| PD-04B-01 (vocabulary) resolved | PROPOSED — needs Planner |
| PD-04B-04 (threshold) resolved | PROPOSED — needs Planner |
| PD-04B-05 (persistence) resolved | PROPOSED — needs Planner |
| P6-02 frozen | PENDING Planner |
| P6-03 frozen | PENDING Planner |
| Table design decided | PROPOSED |
| State machine design complete | ✅ (P6-04B §6) |

**Minimum decisions before P6-04D:** PD-04B-01, PD-04B-04, PD-04B-05

**Safe defaults for non-blocking decisions:**

| Decision | Default | Override Window |
|---|---|---|
| PD-04B-02 | health_score only | P6-04D |
| PD-04B-03 | 14 snapshots | P6-04D |
| PD-04B-06 | No weighting V1 | P6-04E+ |
| PD-04B-07 | Tolerate ≤ 3 day gaps | P6-04D |
| PD-04B-08 | DAILY only | P6-04D |
| PD-04B-09 | New p6_regime_states table | P6-04D |
| PD-04B-10 | Same model V1 | P6-04D |
| PD-04B-11 | 3 consecutive missing → INSUFFICIENT_DATA | P6-04D |
| PD-04B-12 | confidence = min(100, count/min_persistence × 100) | P6-04D |
| PD-04B-13 | Include UNKNOWN, flag in metadata | P6-04D |

---

## 12. Acceptance Checklist

- [x] 13 decisions inventoried (9 explicit + 4 implicit)
- [x] 3 blocking decisions have exact PROPOSED resolutions
- [x] Dependency graph documented
- [x] Temporal decision (OI-02) resolved for P6-04 scope
- [x] Multi-timeframe confirmed (DAILY V1)
- [x] Persistence identity audited
- [x] All 22+ invariants verified
- [x] Evidence gaps documented with safe defaults
- [x] Implementation readiness gate defined
- [x] No production code modified
- [x] No schema changes
- [x] No P4/P5 changes
- [x] All decisions marked PROPOSED
- [x] Git working tree clean
