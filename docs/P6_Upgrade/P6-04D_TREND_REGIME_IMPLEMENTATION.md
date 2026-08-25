# P6-04D — Trend / Regime Detection Implementation

## Executive Summary

Implemented the P6-native Trend/Regime Detection engine consuming P6-03 Intelligence Snapshots.

**58 tests PASS. Full regression PASS (850 tests).**

## Architecture

### Module: `src/lib/p6/regime/`

| File | Responsibility |
|---|---|
| `types.ts` | RegimeState vocabulary, config, version tuple, input/output types |
| `state-machine.ts` | Core state machine with hysteresis, persistence, boundary logic |
| `confidence.ts` | Confidence calculation (PD-04B-12) |
| `provenance.ts` | Quality/freshness metadata assembly |
| `engine.ts` | Orchestration: filter snapshots, run state machine, assemble output |
| `persistence.ts` | DB persistence with latest-only semantics |
| `index.ts` | Public API re-exports |

### Schema: `p6_regime_states` (additive)

New table in `src/db/schema.ts` with:
- Entity identity (entity_type, entity_id, regime_type)
- Regime state + previous state
- Confidence, consecutive count, health score
- Standalone version tuple (algorithm/parameter/schema/config)
- Snapshot linkage (snapshot_version_id)
- Quality/freshness/provenance JSONB metadata
- Lifecycle status (CURRENT/SUPERSEDED)
- Calculation time + created_at
- Indexes on entity, status, calculation time

## Frozen Decisions Implemented

| Decision | Value | Implementation |
|---|---|---|
| PD-04B-01 | STRONG/STABLE/WEAK + TRANSITIONING/INSUFFICIENT_DATA/UNKNOWN | `types.ts` RegimeState union |
| PD-04B-04 | 10-point threshold | Boundary constants: 80/60/40/20 |
| PD-04B-05 | 2 consecutive snapshots | `minPersistence: 2` in config |

## State Machine

### Boundaries (PD-04C-01: inclusive toward higher state)

| Regime | Score Range |
|---|---|
| STRONG | ≥ 80 |
| STABLE | 40–60 |
| WEAK | ≤ 20 |
| Neutral (lower) | 20–40 |
| Neutral (upper) | 60–80 |

### Transition Rules

1. Score must **cross into target regime's zone** (not neutral band)
2. Score must **persist for 2 consecutive qualifying snapshots**
3. Neutral band scores **do not independently trigger transitions**
4. **Boundary equality**: 40 → STABLE, 60 → STABLE, 80 → STRONG, 20 → WEAK

### Anti-Oscillation

- **Hysteresis**: 10-point gaps between zones (neutral bands)
- **Persistence**: 2 consecutive qualifying snapshots required
- **Direction lock**: TRANSITIONING state prevents new transitions until current resolves
- **Revert**: Non-qualifying snapshot during TRANSITIONING reverts to previous state

### Quality Handling (PD-04C-04, PD-04C-05)

| Quality Status | Effect on Regime |
|---|---|
| VALID | Qualifies for transition |
| INVALID | Excluded, pauses persistence |
| MISSING | Excluded, pauses persistence |
| UNKNOWN | Included, counts toward persistence |

### Temporal Gap Tolerance (PD-04C-06, PD-04C-07)

- ≤ 3 consecutive missing daily snapshots: **tolerated** (persistence paused)
- > 3 consecutive missing: **INSUFFICIENT_DATA**
- No synthetic observations or interpolation

### INSUFFICIENT_DATA (PD-04B-11)

- Initial state for entities with no history
- 3 consecutive missing snapshots → INSUFFICIENT_DATA
- Transitions to UNKNOWN when first qualifying snapshot arrives

### Confidence (PD-04B-12)

```
confidence = min(100, consecutive_qualifying_count / min_persistence × 100)
```

Integer (floor). Clamped to 0–100.

## Provenance Chain

```
Regime → Snapshot → Feature → Observation
```

Full provenance persisted as JSONB including:
- Input snapshot IDs with health scores
- Transition from/to
- Quality/freshness summaries
- Version tuple
- Calculation time

## Coin + Narrative

Same state machine model for both entity types. Narrative health is an aggregation input from P6-03, not re-aggregated in P6-04.

## P4/P5 Compatibility

- No P4/P5 code modified
- No BUY/SELL/action semantics
- P5 replay boundary untouched
- Existing consumers continue functioning

## Refresh Integration

Regime detection is available as a standalone function. Refresh integration is NOT wired into the refresh route in P6-04D (deferred to explicit P6-04 decision per contract).

## Test Coverage

| Category | Tests |
|---|---|
| Vocabulary | 4 |
| Boundary Equality | 4 |
| Neutral Zones | 2 |
| Hysteresis | 6 |
| Persistence | 4 |
| Quality Handling | 4 |
| Temporal Gaps | 3 |
| Lookback | 3 |
| Initial State | 5 |
| Confidence | 5 |
| Coin Flow | 1 |
| Narrative Flow | 1 |
| Determinism | 2 |
| Failure Boundary | 1 |
| State Machine Unit | 7 |
| **Total** | **58** |

## Regression Results

| Suite | Tests | Result |
|---|---|---|
| P6 | 448 | ✅ PASS |
| P4 | 129 | ✅ PASS |
| P5 | 273 | ✅ PASS |
| TypeScript | — | ✅ PASS |
| **Total** | **850** | ✅ PASS |

## Non-Blocking Findings

None.

## Contract Compliance

- No new QualityState
- No freshness→quality conversion
- No observation identity reuse
- No P4/P5 modification
- No BUY/SELL semantics
- No fabricated provenance
- No hidden thresholds
- P6-01/P6-02/P6-03 boundaries untouched
