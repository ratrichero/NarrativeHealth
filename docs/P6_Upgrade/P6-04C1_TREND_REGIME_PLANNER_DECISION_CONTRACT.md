# P6-04C1 — Trend/Regime Planner Decision Contract (Blocking)

**Date:** 2026-08-26
**Task Type:** PLANNER DECISION CONTRACT — 3 blocking decisions only
**Baseline:** P6-04B (`ae8b1b1`), P6-04C Planner Contract (`b6aec30`), P6-04C Inventory (`aae424d`)
**Git boundary:** ONLY this document

---

## 1. Purpose

Focused contract for the **3 blocking decisions** that must be accepted before P6-04D implementation. Maps all 20 implicit decisions to their dependencies on these 3 blockers. Minimal, unambiguous, Planner-ready.

---

## 2. The 3 Blocking Decisions

### PD-04B-01 — Regime Vocabulary

**Question:** What finite vocabulary defines regime states?

**PROPOSED RESOLUTION:**

```
RegimeState = STRONG | STABLE | WEAK | TRANSITIONING | INSUFFICIENT_DATA | UNKNOWN
```

| State | Meaning | When Assigned |
|---|---|---|
| STRONG | Health ≥ 80, improving or stable | Score persists ≥ 80 for 2+ snapshots |
| STABLE | Health 40–60, no significant change | Score persists in 40–60 for 2+ snapshots |
| WEAK | Health ≤ 20, declining or low | Score persists ≤ 20 for 2+ snapshots |
| TRANSITIONING | Score is crossing threshold, persistence not yet met | Score crossed boundary, < 2 qualifying snapshots |
| INSUFFICIENT_DATA | Not enough history | < 2 valid snapshots available |
| UNKNOWN | Classification not possible | Calculation failure or all inputs excluded |

**Why this vocabulary:**
- Separates STATE (STRONG/STABLE/WEAK) from TRANSITION (TRANSITIONING) and UNCERTAINTY (INSUFFICIENT_DATA/UNKNOWN)
- 3 core states are sufficient for V1 health trajectory classification
- TRANSITIONING captures "in motion" without conflating direction with state
- Compatible with P6-02 numeric scores (regime is a layer above score)
- Explainable: "The coin is in STRONG regime" is clearer than "The coin is STRENGTHENING"

**Alternatives considered:**
- 5-state (STRONG/STRENGTHENING/HEALTHY/WEAKENING/DETERIORATING): conflates direction with state, harder to explain, oscillation risk
- Direction-only (IMPROVING/STABLE/DECLINING): loses "how healthy" information
- Configurable: complexity without V1 benefit

---

### PD-04B-04 — Transition Threshold

**Question:** Minimum health_score change to trigger regime transition?

**PROPOSED RESOLUTION: 10 points (absolute on 0–100 scale)**

Derived boundaries:

```
STRONG:   health_score ≥ 80
STABLE:   40 ≤ health_score ≤ 60
WEAK:     health_score ≤ 20

Neutral bands: 20–40 and 60–80 (regime unchanged in these ranges)
```

**How it works:**

| Current Regime | To Transition To | Score Must | Then Persist |
|---|---|---|---|
| WEAK | STABLE | ≥ 40 | 2 consecutive snapshots |
| STABLE | STRONG | ≥ 80 | 2 consecutive snapshots |
| STRONG | STABLE | < 60 | 2 consecutive snapshots |
| STABLE | WEAK | < 40 | 2 consecutive snapshots |
| WEAK | STRONG | ≥ 80 | 2 consecutive snapshots (skips STABLE) |
| STRONG | WEAK | ≤ 20 | 2 consecutive snapshots (skips STABLE) |

**Boundary equality:** Score = 80 → STRONG (inclusive toward higher state). Score = 60 → STABLE. Score = 40 → STABLE. Score = 20 → WEAK.

**Neutral band behavior:** Score in 20–40 or 60–80 → regime unchanged, no transition starts. Score must cross boundary AND persist.

**Why 10 points:**
- 5 points = too sensitive (daily noise exceeds 5pts)
- 10 points = 10% of scale, captures meaningful changes
- 15 points = too conservative, may miss real transitions
- Neutral zone = ±10 around boundaries, provides natural hysteresis

---

### PD-04B-05 — Minimum Persistence

**Question:** How many consecutive snapshots must the score remain in new range before regime change?

**PROPOSED RESOLUTION: 2 consecutive snapshots**

| Behavior | Detail |
|---|---|
| Transition latency | 1 day (score must qualify for 2 consecutive daily snapshots) |
| Noise resistance | Hysteresis (10pts) + persistence (2 snapshots) = robust anti-oscillation |
| Oscillation around boundary | Score: 42, 38, 42, 38 → persistence resets each time → regime unchanged |
| INVALID/MISSING during persistence | Count PAUSED (not reset); next valid snapshot resumes |
| UNKNOWN during persistence | Count CONTINUES (UNKNOWN qualifies) |
| Temporal gap ≤ 3 days | Count PAUSED; gap ignored |
| Temporal gap > 3 days | Regime → INSUFFICIENT_DATA |

**Why 2 snapshots:**
- 1 snapshot = immediate (no confirmation, oscillation risk)
- 2 snapshots = 1-day confirmation, balanced
- 3 snapshots = 2-day confirmation, may miss fast transitions
- Combined with 10pt hysteresis = robust anti-oscillation

---

## 3. Dependency Matrix — 20 Implicit Decisions

Every implicit decision depends on one or more of the 3 blocking decisions. This matrix shows exactly which blocker(s) each depends on.

### 3.1 Dependent on PD-04B-01 (Vocabulary)

| ID | Implicit Decision | Resolution | Depends On |
|---|---|---|---|
| PD-04C-01 | Boundary equality (exact 20/40/60/80) | Inclusive toward higher state | PD-04B-01 |
| PD-04C-02 | Neutral band behavior (20–40, 60–80) | Regime unchanged; no transition starts | PD-04B-01 |
| PD-04C-03 | Initial state for new entity | INSUFFICIENT_DATA → UNKNOWN → first regime | PD-04B-01 |
| PD-04C-11 | INSUFFICIENT_DATA → regime transition | INSUFFICIENT_DATA → UNKNOWN when ≥ 2 snapshots | PD-04B-01 |
| PD-04C-12 | Regime → INSUFFICIENT_DATA regression | > 3 consecutive gaps → INSUFFICIENT_DATA | PD-04B-01 |
| PD-04C-20 | Transition precedence | Only one transition per calculation; nearest boundary first | PD-04B-01 |

### 3.2 Dependent on PD-04B-04 (Threshold)

| ID | Implicit Decision | Resolution | Depends On |
|---|---|---|---|
| PD-04C-01 | Boundary equality | Inclusive toward higher state | PD-04B-04 |
| PD-04C-02 | Neutral band behavior | Score in 20–40 or 60–80 → regime unchanged | PD-04B-04 |
| PD-04C-04 | INVALID/MISSING effect on persistence | Pause count, don't reset | PD-04B-04 |
| PD-04C-19 | Same-score consecutive behavior | Score unchanged = still qualifies | PD-04B-04 |

### 3.3 Dependent on PD-04B-05 (Persistence)

| ID | Implicit Decision | Resolution | Depends On |
|---|---|---|---|
| PD-04C-04 | INVALID/MISSING effect on persistence | Pause count, don't reset | PD-04B-05 |
| PD-04C-05 | UNKNOWN effect on persistence | Included, counts toward persistence | PD-04B-05 |
| PD-04C-06 | Temporal gap effect on persistence | Gap ≤ 3 days: pause; gap > 3 days: INSUFFICIENT_DATA | PD-04B-05 |
| PD-04C-08 | Confidence "count" definition | Consecutive qualifying snapshots | PD-04B-05 |
| PD-04C-09 | Confidence scope | Transition confidence only | PD-04B-05 |
| PD-04C-10 | Confidence rounding | Integer (floor), clamped [0, 100] | PD-04B-05 |
| PD-04C-15 | Concurrent refresh behavior | Latest-only; supersede previous | PD-04B-05 |

### 3.4 Independent of All 3 Blockers

| ID | Implicit Decision | Resolution | Depends On |
|---|---|---|---|
| PD-04C-07 | Gap tolerance = ignore vs break | Ignore (pause, don't break) | PD-04B-07 |
| PD-04C-13 | Persistence failure boundary | Infrastructure failure; regime unchanged | IS-24 |
| PD-04C-14 | Narrative membership changes | Regime recomputed from current membership | P6-03 |
| PD-04C-16 | Idempotency | Same inputs → same output (TR-19) | TR-19 |
| PD-04C-17 | Snapshot ordering | Ordered by calculation_time DESC | TR-13 |
| PD-04C-18 | Duplicate snapshot handling | Most recent snapshot used | PD-04B-09 |

---

## 4. Decision Flow

```
PLANNER accepts PD-04B-01 (vocabulary)
  │
  ├→ 6 implicit decisions resolved (PD-04C-01/02/03/11/12/20)
  │
  └→ PLANNER accepts PD-04B-04 (threshold = 10pts)
       │
       ├→ 4 implicit decisions resolved (PD-04C-01/02/04/19)
       │
       └→ PLANNER accepts PD-04B-05 (persistence = 2 snapshots)
            │
            ├→ 7 implicit decisions resolved (PD-04C-04/05/06/08/09/10/15)
            │
            └→ ALL 23 decisions resolved → P6-04D READY
```

---

## 5. What Planner Must Decide

| # | Decision | Proposed | Accept/Reject |
|---|---|---|---|
| 1 | PD-04B-01: Regime vocabulary | STRONG / STABLE / WEAK / TRANSITIONING / INSUFFICIENT_DATA / UNKNOWN | ___ |
| 2 | PD-04B-04: Transition threshold | 10 points (absolute on 0–100) | ___ |
| 3 | PD-04B-05: Minimum persistence | 2 consecutive snapshots | ___ |

**That's it.** 3 decisions. All downstream semantics follow automatically.

---

## 6. Non-Blocking Decisions (Safe Defaults)

These do NOT require Planner acceptance. They use documented defaults.

| ID | Decision | Default | Override Window |
|---|---|---|---|
| PD-04B-02 | Input dimensions | health_score only | P6-04E+ |
| PD-04B-03 | Lookback window | 14 snapshots | P6-04E+ |
| PD-04B-06 | Freshness weighting | No V1 | P6-04E+ |
| PD-04B-07 | Temporal tolerance | Tolerate ≤ 3 day gaps | P6-04E+ |
| PD-04B-08 | V1 timeframe | DAILY only | P6-04E+ |
| PD-04B-09 | Table design | New p6_regime_states | P6-04D |
| PD-04B-10 | Coin vs narrative model | Same model V1 | P6-04E+ |
| PD-04B-11 | Maximum gap tolerance | 3 consecutive missing | P6-04E+ |
| PD-04B-12 | Transition confidence | min(100, count/min×100) | P6-04E+ |
| PD-04B-13 | UNKNOWN input handling | Include, flag metadata | P6-04E+ |

---

## 7. Acceptance Checklist

- [x] 3 blocking decisions identified with exact PROPOSED resolutions
- [x] 20 implicit decisions mapped to dependencies
- [x] Dependency matrix complete
- [x] Decision flow documented
- [x] Non-blocking defaults documented
- [x] No production code modified
- [x] No schema changes
- [x] No P4/P5 changes
- [x] All decisions marked PROPOSED
