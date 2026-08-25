# P6-04C — Trend/Regime Decision Inventory & Gap Audit

**Date:** 2026-08-26
**Task Type:** AUDIT-ONLY — no implementation, no schema, no freeze decisions
**Baseline:** P6-04B Semantic Contract (`ae8b1b1`), P6-04C Planner Decision Contract (`b6aec30`)
**Frozen Authorities:** P6-01B/C/D/E, P6-02B/C/C2/D/E, P6-03B/C1/C2
**Git boundary:** ONLY this document

---

## 1. Purpose

Complete decision inventory and semantic gap audit for P6-04 Trend/Regime Detection. Identifies every decision — explicit and implicit — that must be accepted before implementation. Verifies internal consistency of proposed resolutions. Discovers hidden semantic gaps.

---

## 2. Source Documents Inspected

| Document | What It Provides |
|---|---|
| P6-04A Landscape Recon | Next phase identification, deferred items, dependency graph |
| P6-04B Semantic Contract | Regime vocabulary, state machine, quality/freshness, temporal, invariants |
| P6-04C Planner Decision Contract | Proposed resolutions for 13 decisions |
| P6-01B Observation Contract | QualityState vocabulary, FreshnessState, identity |
| P6-01D Quality Contracts | Quality evaluation, D2 authority, quality states |
| P6-02B Feature Contract | Feature identity, quality gating, health score semantics |
| P6-02C Aggregation Contract | State propagation, deterministic aggregation |
| P6-03B Snapshot Contract | Snapshot identity, provenance, lifecycle |
| P6-03C2 Snapshot Decision Contract | Snapshot planner decisions, persistence semantics |
| P6 Master Specification | P6-04 scope definition, trend/regime requirements |

---

## 3. Complete Decision Matrix

### 3.1 Explicit Decisions (PD-04B-01…13)

| ID | Question | Proposed | Blocking | Status |
|---|---|---|---|---|
| PD-04B-01 | Regime vocabulary | 3-state + transitions | YES | PROPOSED |
| PD-04B-02 | Input dimensions | health_score only | NO | PROPOSED |
| PD-04B-03 | Lookback window | 14 snapshots | NO | PROPOSED |
| PD-04B-04 | Transition threshold | 10 points | YES | PROPOSED |
| PD-04B-05 | Minimum persistence | 2 snapshots | YES | PROPOSED |
| PD-04B-06 | Freshness weighting | No V1 | NO | PROPOSED |
| PD-04B-07 | Temporal tolerance (OI-02) | Tolerate ≤ 3 day gaps | NO | PROPOSED |
| PD-04B-08 | V1 timeframe | DAILY only | NO | PROPOSED |
| PD-04B-09 | Table design | New p6_regime_states | NO | PROPOSED |
| PD-04B-10 | Coin vs narrative model | Same model V1 | NO | PROPOSED |
| PD-04B-11 | Maximum gap tolerance | 3 consecutive missing | NO | PROPOSED |
| PD-04B-12 | Transition confidence | min(100, count/min×100) | NO | PROPOSED |
| PD-04B-13 | UNKNOWN input handling | Include, flag metadata | NO | PROPOSED |

### 3.2 Implicit Decisions Discovered

| ID | Question | Evidence | Proposed | Blocking |
|---|---|---|---|---|
| PD-04C-01 | Boundary equality (exact 20/40/60/80) | Score = threshold → which regime? | Inclusive toward higher state (≥80=STRONG) | NO |
| PD-04C-02 | Neutral band behavior | Bands 20-40 and 60-80 | Regime unchanged; no transition starts | NO |
| PD-04C-03 | Initial state for new entity | No history | INSUFFICIENT_DATA → UNKNOWN → first regime | NO |
| PD-04C-04 | INVALID/MISSING snapshot effect on persistence | PD-04B-05 persistence | INVALID/MISSING excluded; persistence count paused, not reset | NO |
| PD-04C-05 | UNKNOWN snapshot effect on persistence | PD-04B-05 persistence | UNKNOWN included; counts toward persistence | NO |
| PD-04C-06 | Temporal gap effect on persistence | PD-04B-07 tolerance ≤ 3 days | Gap within tolerance: persistence paused; gap > 3 days: INSUFFICIENT_DATA | NO |
| PD-04C-07 | Gap tolerance = ignore vs break | PD-04B-07 | Option A: missing records ignored when evaluating persistence | NO |
| PD-04C-08 | Confidence "count" definition | PD-04B-12 formula | Consecutive qualifying snapshots (VALID + UNKNOWN) | NO |
| PD-04C-09 | Confidence scope | PD-04B-12 | Transition confidence only (not regime confidence) | NO |
| PD-04C-10 | Confidence rounding | PD-04B-12 formula | Integer (floor), clamped [0, 100] | NO |
| PD-04C-11 | INSUFFICIENT_DATA → regime transition | State machine | INSUFFICIENT_DATA → UNKNOWN when ≥ 2 snapshots; UNKNOWN → STRONG/STABLE/WEAK when persistence met | NO |
| PD-04C-12 | Regime → INSUFFICIENT_DATA regression | State machine | If > 3 consecutive gaps, regime reverts to INSUFFICIENT_DATA | NO |
| PD-04C-13 | Persistence failure boundary | IS-24 pattern | Infrastructure failure; regime unchanged; no quality state created | NO |
| PD-04C-14 | Narrative membership changes | P6-03 PD-03B-14 | Narrative regime recomputed from current membership; membership change = new calculation | NO |
| PD-04C-15 | Concurrent refresh behavior | Refresh route pattern | Latest-only; supersede previous; no locking needed | NO |
| PD-04C-16 | Idempotency | Same inputs → same output | Same snapshots + same version = same regime (TR-19) | NO |
| PD-04C-17 | Snapshot ordering | Lookback window | Ordered by calculation_time DESC; most recent = current | NO |
| PD-04C-18 | Duplicate snapshot handling | Persistence latest-only | Most recent snapshot used; duplicates ignored | NO |
| PD-04C-19 | Same-score consecutive behavior | Persistence | Score unchanged = still qualifies for persistence toward target regime | NO |
| PD-04C-20 | Transition precedence | Score crosses multiple thresholds | Only one transition per calculation; nearest boundary first | NO |

---

## 4. Blocking Decisions

| ID | Question | Why Blocking | Proposed Resolution |
|---|---|---|---|
| PD-04B-01 | Regime vocabulary | All downstream depend on vocabulary | 3-state + transitions (STRONG/STABLE/WEAK + TRANSITIONING/INSUFFICIENT_DATA/UNKNOWN) |
| PD-04B-04 | Transition threshold | State machine cannot be implemented without thresholds | 10 points (absolute on 0–100 scale) |
| PD-04B-05 | Minimum persistence | Anti-oscillation depends on persistence | 2 consecutive snapshots |

---

## 5. Hysteresis / Neutral Zone Audit

### 5.1 Proposed Boundaries

```
STRONG:   health_score ≥ 80
STABLE:   40 ≤ health_score ≤ 60
WEAK:     health_score ≤ 20
```

### 5.2 Neutral Bands

```
Band 1: 20 < score < 40  (between WEAK and STABLE)
Band 2: 60 < score < 80  (between STABLE and STRONG)
```

### 5.3 Boundary Behavior (PD-04C-01)

| Score | Regime | Notes |
|---|---|---|
| 80 | STRONG | Inclusive toward higher state |
| 79 | Neutral band | No regime change |
| 60 | STABLE | Upper bound of stable |
| 40 | STABLE | Lower bound of stable |
| 20 | WEAK | Inclusive toward lower state |
| 19 | WEAK | Below threshold |

### 5.4 Neutral Band Semantics (PD-04C-02)

**What happens inside neutral bands?**
- Current regime remains UNCHANGED
- No transition starts
- Score is "in transit" between regimes

**Can a neutral-band score start a transition?**
- YES, if the score is moving TOWARD a regime boundary and crosses it
- NO, if the score is within the band and not approaching a boundary

**Example:**
- Current regime: WEAK (score was 15)
- Score rises to 25 (enters neutral band 20-40)
- Regime remains WEAK
- Score rises to 45 (crosses into STABLE zone ≥40)
- Persistence starts counting toward STABLE
- After 2 consecutive snapshots ≥40, regime transitions WEAK → STABLE

### 5.5 Hysteresis Direction Dependence

**WEAK → STABLE transition:**
- Score must rise ABOVE lower_threshold + hysteresis = 20 + 10 = 30? No — this contradicts the 40 boundary.

**Correction:** The proposed boundaries already embed hysteresis:
- STRONG entry = 80 (not 70)
- STABLE entry from below = 40 (not 30)
- WEAK entry = 20 (not 30)

This means:
- WEAK → STABLE: score must reach ≥ 40 (not 30)
- STABLE → STRONG: score must reach ≥ 80 (not 70)
- STRONG → STABLE: score must drop < 60 (not 70)
- STABLE → WEAK: score must drop < 40 (not 30)

**The neutral bands ARE the hysteresis zones.** The hysteresis is already embedded in the proposed boundaries (PD-04C-01).

### 5.6 Oscillation Around Boundaries (PD-04C-19)

**What happens when score oscillates around 40?**
- Score: 42, 38, 42, 38
- Current regime: WEAK (score was < 40)
- First snapshot: 42 → persistence count = 1 (toward STABLE)
- Second snapshot: 38 → persistence RESET (score back in neutral band, not ≥ 40)
- Third snapshot: 42 → persistence count = 1 again
- Fourth snapshot: 38 → persistence RESET

**Result:** Regime remains WEAK. Oscillation prevented by persistence requirement.

### 5.7 Invalid/Missing Effect on Persistence (PD-04C-04)

**What happens if an INVALID snapshot occurs during persistence counting?**
- INVALID/MISSING snapshots are EXCLUDED from trend analysis
- Persistence count is PAUSED (not reset)
- Next valid snapshot continues counting from where it left off

**What happens if > 3 consecutive INVALID/MISSING snapshots occur?**
- Gap tolerance (PD-04B-07) applies
- If gap ≤ 3 days: persistence paused, regime unchanged
- If gap > 3 days: regime → INSUFFICIENT_DATA

---

## 6. Temporal / OI-02 Audit

### 6.1 PD-04B-07 Proposal

Tolerate ≤ 3 consecutive missing daily snapshots.

### 6.2 Gap Handling (PD-04C-07)

**Option A: Missing records IGNORED when evaluating persistence**

| Scenario | Behavior |
|---|---|
| Day 1: score=45 (persistence=1) | Counting |
| Day 2: MISSING | Gap=1, within tolerance; persistence PAUSED |
| Day 3: score=46 (persistence=2) | Resumed; persistence=2 (meets minimum) |
| Result | Regime transitions if persistence ≥ 2 |

**Option B: Missing records BREAK persistence**

| Scenario | Behavior |
|---|---|
| Day 1: score=45 (persistence=1) | Counting |
| Day 2: MISSING | Persistence RESET to 0 |
| Day 3: score=46 (persistence=1) | Restarting |
| Result | Regime transitions delayed |

**Proposed: Option A (ignore, don't break)**

**Rationale:** Consistent with PD-04B-07 "tolerate gaps." If gaps break persistence, tolerance is meaningless. The gap is tolerated by pausing, not by breaking.

### 6.3 Gap vs INSUFFICIENT_DATA

| Gap Duration | Behavior |
|---|---|
| 0 days | Normal processing |
| 1–3 days | Persistence paused; regime unchanged |
| > 3 days | Regime → INSUFFICIENT_DATA |

### 6.4 Interaction with Lookback

- Lookback = 14 snapshots
- Gap tolerance = 3 days
- If 3 consecutive gaps within 14-day window, those days are skipped
- Lookback still requires 14 VALID snapshots for full classification
- Fewer than 14 valid snapshots → regime computed with available data

---

## 7. Quality / Freshness Audit

### 7.1 QualityState Preservation

| State | Used? | Impact on Regime |
|---|---|---|
| VALID | YES | Snapshot included normally |
| INVALID | YES | Snapshot excluded from trend analysis |
| MISSING | YES | Snapshot excluded from trend analysis |
| UNKNOWN | YES | Snapshot included; flagged in metadata |
| NEW states | NO | No new QualityState created |

**TR-11:** COMPLIANT — no new QualityState.

### 7.2 Freshness Independence

- Freshness (FRESH/STALE/UNKNOWN) preserved as metadata
- No freshness weighting (PD-04B-06)
- STALE does not become INVALID
- No semantic contradiction with P6-01C or P6-03

**TR-12:** COMPLIANT.

---

## 8. Initial State / INSUFFICIENT_DATA Audit

### 8.1 Entity Lifecycle

```
First snapshot → INSUFFICIENT_DATA
  ↓ (≥ 2 snapshots)
UNKNOWN → (persistence met) → STRONG/STABLE/WEAK
  ↓ (regime established)
STRONG/STABLE/WEAK ↔ transitions
  ↓ (> 3 consecutive gaps)
INSUFFICIENT_DATA
```

### 8.2 Cold Start (PD-04C-03)

| Snapshots | Regime | Transitions Possible? |
|---|---|---|
| 0 | (no record) | NO |
| 1 | INSUFFICIENT_DATA | NO |
| 2 | UNKNOWN | NO (persistence not met) |
| ≥ 2 + persistence met | STRONG/STABLE/WEAK | YES |

### 8.3 All Inputs Invalid/Missing (PD-04C-04)

- If all snapshots in lookback are INVALID/MISSING → INSUFFICIENT_DATA
- If some are valid → regime computed from valid snapshots only

### 8.4 UNKNOWN-Only History (PD-04C-05)

- UNKNOWN snapshots ARE included in trend analysis
- UNKNOWN-only history → regime computed normally (UNKNOWN ≠ INVALID)
- UNKNOWN quality is metadata, not a filter

---

## 9. Confidence Audit

### 9.1 Formula

```
transition_confidence = min(100, consecutive_count / min_persistence × 100)
```

### 9.2 "Count" Definition (PD-04C-08)

**Consecutive qualifying snapshots** = snapshots that qualify for the target regime:
- health_score in target range
- NOT INVALID or MISSING (excluded)
- UNKNOWN IS included (qualifies)
- Gap within tolerance IS included (paused, not broken)

### 9.3 Scope (PD-04C-09)

**Transition confidence only.** Not regime confidence. When no transition is occurring, confidence = 0 or not applicable.

### 9.4 Rounding (PD-04C-10)

Integer (floor), clamped [0, 100].

### 9.5 UNKNOWN/INSUFFICIENT_DATA

- UNKNOWN regime: confidence = 0
- INSUFFICIENT_DATA: confidence = 0
- Transition from UNKNOWN → regime: confidence = min(100, count/min×100)

---

## 10. Coin vs Narrative Audit

### 10.1 Same Model (PD-04B-10)

- Same state machine (STRONG/STABLE/WEAK)
- Same thresholds (10 points)
- Same persistence (2 snapshots)
- Same lookback (14 snapshots)
- Same confidence semantics

### 10.2 Narrative-Specific Considerations

| Concern | Resolution |
|---|---|
| Membership changes | Regime recomputed from current membership (PD-04C-14) |
| Missing member snapshots | Excluded from narrative health; regime uses available data |
| Market-cap weighting | Inherited from P6-03; P6-04 reads health_score directly |
| Partial membership | Narrative regime computed from available members; data_completeness recorded |

---

## 11. Persistence / Version / Provenance Audit

### 11.1 Table Design (PD-04B-09)

Proposed `p6_regime_states` table with:
- Primary identity: (entity_type, entity_id)
- Unique constraint: (entity_type, entity_id) WHERE status = 'CURRENT'
- Status: CURRENT | SUPERSEDED
- RegimeVersion tuple: 4 text columns
- Provenance: JSONB
- Quality/freshness metadata: JSONB

### 11.2 Schema Sufficient?

| Requirement | Covered? |
|---|---|
| Primary identity | ✅ |
| Unique key | ✅ |
| Latest/current state | ✅ (status = CURRENT) |
| Historical state | ✅ (status = SUPERSEDED) |
| Supersession | ✅ |
| Idempotency | ✅ (same inputs → same output → same record) |
| Algorithm version | ✅ |
| Input snapshot IDs | ✅ (via provenance JSONB) |
| Provenance | ✅ |
| calculation_time | ✅ |
| timeframe | ✅ (default DAILY) |

**Assessment:** Schema design can safely proceed from current contract.

---

## 12. Determinism / Replay Audit

### 12.1 Determinism (TR-19)

- Same input snapshots → same regime
- Same lookback window → same classification
- Same regime version → same algorithm
- No live external dependency
- No wall-clock dependency
- No nondeterministic ordering (snapshots ordered by calculation_time)

### 12.2 Replay Boundary (TR-20)

- P6-04 regime records are NOT P5 replay artifacts
- P5-07 replay reads from P5's own artifact tables
- P6-04 regime history is supplementary intelligence, not P5 decision data

---

## 13. Error / Persistence Failure Audit

### 13.1 Failure Boundary (PD-04C-13)

| Failure | Behavior | Quality State? |
|---|---|---|
| DB persistence failure | Return null; regime unchanged | NO |
| Snapshot read failure | Exclude from analysis; regime unchanged | NO |
| Regime calculation error | Log error; regime unchanged | NO |

**IS-24 pattern:** Infrastructure failure ≠ quality state.

### 13.2 No Silent Swallow

- Errors logged (console.error)
- Not converted to UNKNOWN or INSUFFICIENT_DATA
- Regime remains whatever it was before the failed calculation

---

## 14. P4/P5 Compatibility Audit

| Check | Status |
|---|---|
| P4 interpretation engine untouched | ✅ |
| P5 rule engine untouched | ✅ |
| P5 policy/safety untouched | ✅ |
| No BUY/SELL semantics | ✅ |
| No legacy table modification | ✅ |
| P6-04 reads from P6-03 only | ✅ |
| P4/P5 consumers continue functioning | ✅ |

---

## 15. Decision Dependency Graph

```
PD-04B-01 (vocabulary) ─────────────────────────┐
  │                                              │
  ├→ PD-04B-02 (dimensions) ────────────────────┤
  ├→ PD-04B-03 (lookback) ──────────────────────┤
  ├→ PD-04B-04 (threshold) ───→ PD-04B-05 (persistence) ──→ PD-04B-12 (confidence)
  │     │                        │                  │
  │     ├→ PD-04C-01 (boundary equality)           │
  │     ├→ PD-04C-02 (neutral band behavior)       │
  │     └→ PD-04C-04 (INVALID effect on persist)   │
  │                           ├→ PD-04C-05 (UNKNOWN effect on persist)
  │                           └→ PD-04C-06 (gap effect on persist)
  ├→ PD-04B-10 (coin vs narrative) ─────────────┤
  ├→ PD-04B-11 (max gap) ───────────────────────┤
  │     └→ PD-04C-07 (gap = ignore vs break)
  └→ PD-04B-09 (table design) ──────────────────┘
                                                  │
PD-04B-06 (freshness) ────────────────────────────┤
PD-04B-07 (temporal tolerance / OI-02) ───────────┤
PD-04B-08 (timeframe) ───────────────────────────┘
```

**Critical path:** PD-04B-01 → PD-04B-04 → PD-04B-05 → PD-04C-04 → implementation

---

## 16. Implementation Readiness Gate

| Condition | Status |
|---|---|
| P6-04B contract complete | ✅ |
| P6-04C decision contract complete | ✅ |
| PD-04B-01 (vocabulary) resolved | PROPOSED — needs Planner |
| PD-04B-04 (threshold) resolved | PROPOSED — needs Planner |
| PD-04B-05 (persistence) resolved | PROPOSED — needs Planner |
| Boundary equality defined | ✅ (PD-04C-01) |
| Neutral band behavior defined | ✅ (PD-04C-02) |
| Initial state defined | ✅ (PD-04C-03) |
| INVALID/MISSING effect on persistence defined | ✅ (PD-04C-04) |
| UNKNOWN effect on persistence defined | ✅ (PD-04C-05) |
| Gap effect on persistence defined | ✅ (PD-04C-06/07) |
| Confidence "count" defined | ✅ (PD-04C-08) |
| Error boundary defined | ✅ (PD-04C-13) |
| Deterministic behavior defined | ✅ (TR-19) |
| P4/P5 boundary verified | ✅ |
| P6-02/P6-03 compatibility verified | ✅ |
| No hidden semantic ambiguity | ✅ (20 implicit decisions resolved) |

**READY for P6-04D implementation** after Planner accepts PD-04B-01, PD-04B-04, PD-04B-05.

---

## 17. Findings

| ID | Class | Finding | Impact |
|---|---|---|---|
| F-1 | C | 20 implicit decisions discovered and resolved | Non-blocking — all have safe defaults |
| F-2 | C | Boundary equality (exact 20/40/60/80) was not explicit in P6-04B | Resolved as PD-04C-01 |
| F-3 | C | Neutral band behavior was not explicit | Resolved as PD-04C-02 |
| F-4 | C | Gap tolerance = ignore vs break was ambiguous | Resolved as PD-04C-07 (ignore) |
| F-5 | C | Confidence "count" definition was ambiguous | Resolved as PD-04C-08 (consecutive qualifying) |
| F-6 | C | INVALID effect on persistence was not explicit | Resolved as PD-04C-04 (pause, not reset) |

---

## 18. Evidence Gaps

| ID | Gap | Resolution |
|---|---|---|
| EG-1 | Production health score variance | Monitor after deployment |
| EG-2 | Production refresh frequency | PD-04B-07 default (3 days) |
| EG-3 | Coin vs narrative trend differences | PD-04B-10 default (same model) |

---

## 19. Recommended Next Task

**P6-04D — Trend/Regime Implementation**

After Planner accepts PD-04B-01, PD-04B-04, PD-04B-05:
- Implement state machine (`src/lib/p6/regime/`)
- Add `p6_regime_states` schema
- Write comprehensive tests
- Wire into refresh route

---

## 20. Acceptance Checklist

- [x] 33 decisions inventoried (13 explicit + 20 implicit)
- [x] 3 blocking decisions identified with proposed resolutions
- [x] 20 implicit decisions discovered and resolved
- [x] Hysteresis/neutral-zone semantics fully documented
- [x] Temporal/OI-02 gap handling resolved (ignore, don't break)
- [x] Quality/freshness verified against P6-01/02/03
- [x] Initial state lifecycle documented
- [x] Confidence formula "count" defined
- [x] Persistence/version/provenance audited
- [x] Determinism/replay verified
- [x] Error boundary defined
- [x] P4/P5 compatibility verified
- [x] No production code modified
- [x] No schema changes
- [x] No frozen contract modifications
- [x] All decisions marked PROPOSED
