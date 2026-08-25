# P6-05A — Next Phase Landscape Recon

## 1. Executive Summary

P6-05 is the **Early Warning Engine** — the layer that turns material changes in health, regime, and intelligence into structured, deduplicated, severity-classified warnings.

This recon identifies:
- 0 blocking decisions
- 12 candidate decisions (all non-blocking with safe V1 defaults)
- 14 reusable components
- 3 components needing adaptation
- 2 missing components
- 6 evidence gaps

**P6-05 scope**: Warning generation from P6-02/P6-03/P6-04 outputs. Not a decision engine, not an action engine, not a P5 bridge.

## 2. P6 Pipeline Position

```
P6-01 (Observation/Quality)     → FROZEN
P6-02 (Derived Features)        → FROZEN
P6-03 (Intelligence Snapshots)  → FROZEN
P6-04 (Trend/Regime)            → FROZEN
P6-05 (Early Warning Engine)    ← THIS TASK
P6-06 (Intelligence Aggregation) → depends on P6-05
P6-07 (UI/Dashboard)            → depends on P6-06
P6-08 (Historical/Backfill)     → depends on P6-06
P6-09 (System Verification)     → depends on P6-07 + P6-08
```

## 3. P6-05 Scope

### What Problem Does P6-05 Solve?

The P6 pipeline produces:
- **P6-02**: Derived features (trend_score, volume_score, momentum, health_score)
- **P6-03**: Intelligence snapshots (COIN_HEALTH, NARRATIVE_HEALTH scores)
- **P6-04**: Regime states (STRONG/STABLE/WEAK/TRANSITIONING)

But none of these produce **actionable warnings** — structured notifications that say "something material changed, here's what, here's severity, here's evidence."

P6-05 fills this gap: it monitors changes across the P6 pipeline and generates warnings when material events occur.

### Pipeline Inputs

| Input | Source | What P6-05 Consumes |
|---|---|---|
| Health score | P6-03 snapshot | Current + historical scores |
| Regime state | P6-04 regime | Current + previous regime, transitions |
| Regime confidence | P6-04 confidence | Confidence in regime classification |
| Quality metadata | P6-03 snapshot | Data quality of inputs |
| Freshness metadata | P6-03 snapshot | Data staleness |
| Feature scores | P6-02 features | Trend, volume, momentum scores |
| Coin metadata | coins table | Name, symbol, market_cap |
| Narrative metadata | narratives table | Name, description |

### Pipeline Outputs

| Output | Description |
|---|---|
| Warning record | Structured warning with severity, evidence, dedup key |
| Warning history | Historical warnings for cooldown/dedup |
| Warning state | Active / suppressed / resolved |

### What P6-05 Does NOT Do

- Does NOT make BUY/SELL decisions
- Does NOT execute trades
- Does NOT modify P4/P5
- Does NOT produce intelligence summaries (that's P6-06)
- Does NOT produce UI (that's P6-07)
- Does NOT replace P4 interpretation or P5 policy

## 4. Existing Architecture Landscape

### 4.1 Components Classified

#### REUSABLE (14 components)

| Component | File | Responsibility | Why Reusable |
|---|---|---|---|
| P6-03 snapshot engine | `src/lib/p6/snapshot/` | Generates coin/narrative snapshots | P6-05 consumes snapshots as input |
| P6-04 regime engine | `src/lib/p6/regime/` | Classifies regime states | P6-05 consumes regime transitions |
| P6-02 feature engine | `src/lib/p6/feature/` | Computes derived features | P6-05 consumes health scores |
| P6-01 quality evaluator | `src/lib/p6/quality/` | Evaluates data quality | P6-05 reads quality metadata |
| P6-01 freshness evaluator | `src/lib/p6/freshness/` | Evaluates data freshness | P6-05 reads freshness metadata |
| QualityState types | `src/lib/p6/quality/types.ts` | Quality vocabulary | P6-05 preserves quality metadata |
| SnapshotVersionTuple | `src/lib/p6/snapshot/types.ts` | Version tracking | P6-05 references snapshot versions |
| RegimeVersionTuple | `src/lib/p6/regime/types.ts` | Version tracking | P6-05 references regime versions |
| Snapshot persistence | `src/lib/p6/snapshot/persistence.ts` | Read current snapshots | P6-05 reads snapshots for comparison |
| Regime persistence | `src/lib/p6/regime/persistence.ts` | Read current regimes | P6-05 reads regimes for transitions |
| Confidence formula | `src/lib/p6/regime/confidence.ts` | Confidence calculation | P6-05 may reuse for warning confidence |
| Provenance assembly | `src/lib/p6/regime/provenance.ts` | Metadata assembly | Pattern reusable for warning provenance |
| Determinism utilities | `src/lib/p6/regime/state-machine.ts` | Pure functions | Pattern for deterministic warning rules |
| Engine orchestration pattern | `src/lib/p6/regime/engine.ts` | Filter → classify → output | Pattern for warning engine |

#### NEEDS ADAPTATION (3 components)

| Component | File | Current Use | Adaptation Needed |
|---|---|---|---|
| Alert service | `src/lib/services/alert.service.ts` | Legacy P3 alert rules/history | Read for cooldown patterns; P6-05 warnings are semantically different from P3 alerts |
| Alert types | `src/lib/types/alert.ts` | P3 AlertRule/AlertHistory | Study for identity/dedup patterns; P6-05 uses P6-native warning types |
| Decision signals | `src/lib/types/decision-signal.ts` | P3 DecisionSignal | Study for event-risk patterns; P6-05 uses P6-native severity |

#### LEGACY / DO NOT USE (5 components)

| Component | File | Why Not |
|---|---|---|
| P3 execution loop | `src/lib/p3/execution-loop.ts` | P3-era orchestration; P6 has its own pipeline |
| P3 technical analysis | `src/lib/technical-analysis/` | Legacy regime/scoring; P6-04 replaces |
| P3 indicators | `src/lib/indicators/` | Legacy indicators; P6-02 replaces |
| P3 features engine | `src/lib/features/engine.ts` | Legacy features; P6-02 replaces |
| P3 morning snapshots | `src/lib/services/snapshot.service.ts` | Legacy snapshots; P6-03 replaces |

#### MISSING (2 components)

| Component | Description | Impact |
|---|---|---|
| Warning engine | P6-native warning generation logic | Core P6-05 deliverable |
| Warning persistence | p6_warnings table + CRUD | Core P6-05 deliverable |

## 5. Data Authority Trace

```
Canonical Observation (P6-01)
    ↓
Derived Feature (P6-02)
    ↓
Intelligence Snapshot (P6-03)
    ↓
Trend / Regime (P6-04)
    ↓
Early Warning (P6-05)  ← HERE
```

### P6-05 Input Sources

| Input | Authority | Legacy Contamination |
|---|---|---|
| Health score | P6-03 snapshot | ✅ Clean — P6-native |
| Regime state | P6-04 regime | ✅ Clean — P6-native |
| Regime confidence | P6-04 confidence | ✅ Clean — P6-native |
| Quality metadata | P6-03 quality_metadata | ✅ Clean — P6-native |
| Freshness metadata | P6-03 freshness_metadata | ✅ Clean — P6-native |
| Feature scores | P6-02 features | ✅ Clean — P6-native |
| Coin metadata | coins table | ⚠️ Shared with P3/P4/P5 (read-only, acceptable) |
| Narrative metadata | narratives table | ⚠️ Shared with P3/P4/P5 (read-only, acceptable) |

### Legacy Consumption Audit

No P6-05 component should read:
- `market_price_daily` as semantic source
- `coin_metrics` as semantic source
- `health_scores` (legacy) as semantic source
- `morning_snapshots` as semantic source
- `indicators` as semantic source
- `features` (without P6 columns) as semantic source

P6-05 reads ONLY from P6-03 snapshots, P6-04 regimes, P6-02 features, and shared metadata tables (coins, narratives) for display purposes.

## 6. Quality / Freshness Landscape

### Quality Interaction

| Aspect | P6-05 Behavior |
|---|---|
| Quality is metadata | ✅ Preserved in warning provenance |
| Quality is NOT a score | ✅ No quality→severity conversion |
| Quality is NOT gating | ✅ Warnings generated regardless of quality |
| Quality is NOT weighting | ✅ No quality-based severity adjustment |
| New QualityState? | ❌ NOT needed — VALID/INVALID/MISSING/UNKNOWN sufficient |

### Freshness Interaction

| Aspect | P6-05 Behavior |
|---|---|
| Freshness is metadata | ✅ Preserved in warning provenance |
| Freshness is NOT a score | ✅ No freshness→severity conversion |
| Freshness is NOT gating | ✅ Warnings generated regardless of freshness |
| Freshness weighting V1? | ❌ NOT needed — no freshness weighting |
| New FreshnessState? | ❌ NOT needed |

### Evidence Gaps

| Gap | Impact | Classification |
|---|---|---|
| Should stale data suppress warnings? | P6-05A decision | NON-BLOCKING — V1 default: no suppression |
| Should quality metadata affect warning severity? | P6-05A decision | NON-BLOCKING — V1 default: no effect |

## 7. Identity / Version / Provenance

### Candidate P6-05 Identity

| Dimension | Candidate | Status |
|---|---|---|
| Entity | (entity_type, entity_id) | KNOWN — from P6-03/P6-04 |
| Warning type | (warning_type) | CANDIDATE — needs definition |
| Calculation time | (calculation_time) | KNOWN — from P6-03/P6-04 pattern |
| Time window | (window_start, window_end) | CANDIDATE — for cooldown/dedup |
| Version | (algorithm_version, parameter_version) | CANDIDATE — standalone warning version |

### Version Tuple

P6-05 needs its own version tuple, distinct from:
- P6-01 observation version
- P6-02 feature version
- P6-03 snapshot version
- P6-04 regime version

This is consistent with the pattern: each P6 layer has its own version.

### Provenance Chain

```
Warning
  → Regime (P6-04)
    → Snapshot (P6-03)
      → Feature (P6-02)
        → Observation (P6-01)
```

P6-05 provenance must trace the full chain.

## 8. Persistence Landscape

### Candidate Schema: p6_warnings

| Column | Type | Purpose |
|---|---|---|
| id | serial PK | Primary key |
| entity_type | varchar(20) | "coin" \| "narrative" |
| entity_id | integer | Coin/narrative ID |
| warning_type | varchar(30) | Warning classification |
| severity | varchar(20) | INFO/WATCH/WARNING/CRITICAL |
| status | varchar(20) | ACTIVE/SUPPRESSED/RESOLVED |
| message | text | Human-readable warning |
| evidence | jsonb | Evidence references |
| health_score | real | Current health score |
| regime_state | varchar(30) | Current regime |
| confidence | real | Warning confidence |
| quality_metadata | jsonb | Quality snapshot |
| freshness_metadata | jsonb | Freshness snapshot |
| version | jsonb | Warning version tuple |
| provenance | jsonb | Full provenance chain |
| calculation_time | timestamp | When warning was generated |
| activated_at | timestamp | When warning became active |
| suppressed_at | timestamp | When warning was suppressed |
| resolved_at | timestamp | When warning was resolved |
| created_at | timestamp | Record creation |

### Lifecycle

```
GENERATED → ACTIVE → SUPPRESSED → RESOLVED
                     ↓
                  REACTIVATED → ACTIVE
```

## 9. P4 / P5 Boundary

| Check | Status |
|---|---|
| P6-05 does NOT produce BUY/SELL | ✅ Warnings are informational |
| P6-05 does NOT produce actions | ✅ No action semantics |
| P6-05 does NOT produce policy | ✅ No policy semantics |
| P6-05 does NOT modify P4 | ✅ P4 untouched |
| P6-05 does NOT modify P5 | ✅ P5 untouched |
| P6-05 does NOT produce P5 artifacts | ✅ Separate persistence |
| P6-05 does NOT affect P5 replay | ✅ No replay chain modification |

## 10. P6-04 Dependency

| Aspect | P6-05 Consumption |
|---|---|
| Regime state | Reads current regime (STRONG/STABLE/WEAK) |
| Regime transition | Detects regime changes (TRANSITIONING→target) |
| Regime confidence | May read for warning confidence |
| Regime provenance | References in warning provenance |
| Regime version | References in warning version |
| Historical regimes | Reads for cooldown/dedup comparison |

**No modification to P6-04 required.** P6-05 reads P6-04 outputs as-is.

## 11. Decision Inventory

### Explicit Decisions (from P6 Master Spec)

| ID | Question | Status |
|---|---|---|
| PD-05A-01 | Warning vocabulary (types) | DISCOVERED |
| PD-05A-02 | Severity levels | DISCOVERED |
| PD-05A-03 | Warning triggers | DISCOVERED |
| PD-05A-04 | Cooldown/dedup mechanism | DISCOVERED |
| PD-05A-05 | Evidence references | DISCOVERED |
| PD-05A-06 | Warning lifecycle | DISCOVERED |

### Implicit Decisions (discovered during recon)

| ID | Question | Status |
|---|---|---|
| PD-05A-07 | Warning confidence calculation | DISCOVERED |
| PD-05A-08 | Severity thresholds | DISCOVERED |
| PD-05A-09 | Warning dedup identity | DISCOVERED |
| PD-05A-10 | Reactivation rules | DISCOVERED |
| PD-05A-11 | Stale data handling | DISCOVERED |
| PD-05A-12 | Coin vs narrative parity | DISCOVERED |

### All decisions are DISCOVERED (not proposed, not accepted, not frozen).

## 12. Gap Analysis

| Gap | Classification | Impact |
|---|---|---|
| No warning vocabulary defined | BLOCKING FOR DESIGN | Must define warning types before implementation |
| No severity rules defined | BLOCKING FOR DESIGN | Must define severity levels and thresholds |
| No dedup mechanism defined | BLOCKING FOR DESIGN | Must define identity and cooldown |
| No warning persistence exists | NON-BLOCKING | New table needed |
| No warning engine exists | NON-BLOCKING | New module needed |
| Warning confidence formula unclear | NON-BLOCKING | V1 default: use regime confidence |
| Stale data suppression unclear | DEFERRED | V1 default: no suppression |
| Reactivation rules unclear | DEFERRED | V1 default: manual reactivation |
| Warning→P6-06 integration unclear | DEFERRED | P6-06 scope |
| Warning→P6-07 UI unclear | DEFERRED | P6-07 scope |

## 13. Backward Compatibility

| Consumer | Impact |
|---|---|
| `/api/coins/[id]` | P6-05 warnings may be added to response (additive) |
| `/api/narratives/[id]` | P6-05 warnings may be added to response (additive) |
| `/api/dashboard` | P6-05 warnings may be added to response (additive) |
| P4 interpretation | No change — P4 reads P3/P2, not P6-05 |
| P5 policy | No change — P5 reads P4, not P6-05 |
| Existing refresh | P6-05 generation may be wired after P6-04 |

## 14. Test Landscape

### Existing Tests Relevant to P6-05

| Test Suite | Relevance |
|---|---|
| P6 regime tests (142) | P6-05 consumes regime output |
| P6 snapshot tests (52) | P6-05 reads snapshots |
| P6 feature tests (317) | P6-05 reads features |
| P6 quality tests | P6-05 reads quality metadata |
| P4 tests (129) | Verify no P4 regression |
| P5 tests (273) | Verify no P5 regression |

### Missing Test Categories for P6-05

| Category | Description |
|---|---|
| Warning generation | Warnings produced for material changes |
| Warning dedup | Same input → no duplicate warnings |
| Warning cooldown | Cooldown period suppresses repeated warnings |
| Warning severity | Correct severity classification |
| Warning evidence | Evidence references are complete |
| Warning provenance | Full chain traceable |
| Warning determinism | Same input → same warning |
| Warning lifecycle | ACTIVE→SUPPRESSED→RESOLVED transitions |
| Coin/narrative parity | Same model for both entity types |
| Quality independence | Quality metadata doesn't affect warning generation |
| Freshness independence | Freshness metadata doesn't affect warning generation |

## 15. Dependency Graph

```
P6-01 (FROZEN)
    ↓
P6-02 (FROZEN) ──┐
    ↓              │
P6-03 (FROZEN) ──┤
    ↓              │
P6-04 (FROZEN) ──┤
    ↓              │
P6-05 (THIS)  ←──┘
    ↓
P6-06
```

## 16. Candidate Implementation Strategy

| Step | Task | Dependencies |
|---|---|---|
| P6-05A | Warning contract (vocabulary, severity, triggers) | None |
| P6-05B | Severity rules (thresholds, versioning) | P6-05A |
| P6-05C | Deduplication / cooldown | P6-05A |
| P6-05D | Confidence / data quality qualification | P6-05A, P6-05B |
| P6-05E | Tests / noise control | P6-05A–D |
| P6-05-FINAL | Audit + freeze | P6-05E |

## 17. Blocking Decisions for P6-05B/C

**None.** All decisions have safe V1 defaults:

| Decision | V1 Default |
|---|---|
| Warning vocabulary | Regime change, health threshold |
| Severity levels | INFO, WATCH, WARNING, CRITICAL |
| Cooldown | 24 hours per warning type |
| Dedup | (entity_type, entity_id, warning_type, window) |
| Evidence | Full provenance chain |
| Confidence | Reuse regime confidence |

## 18. Deferred Items

| Item | Deferral Reason |
|---|---|
| Stale data suppression | V2 — complex interaction with freshness |
| Reactivation rules | V2 — manual reactivation sufficient V1 |
| Warning→P6-06 integration | P6-06 scope |
| Warning→P6-07 UI | P6-07 scope |
| Historical warning analysis | P6-08 scope |
| Warning noise scoring | V2 — after production feedback |

## 19. Readiness Assessment

| Criterion | Status |
|---|---|
| P6-01 frozen | ✅ |
| P6-02 frozen | ✅ |
| P6-03 frozen | ✅ |
| P6-04 frozen | ✅ |
| P6-05 scope defined | ✅ |
| P6-05 inputs identified | ✅ |
| P6-05 outputs identified | ✅ |
| P6-05 decisions discovered | ✅ 12 decisions |
| P6-05 blocking decisions | ✅ 0 blocking |
| P6-05 gaps identified | ✅ |
| P6-05 backward compatible | ✅ |
| P6-05 P4/P5 boundary clean | ✅ |

**P6-05 is READY for P6-05B (Warning Contract Design).**

## 20. Git Boundary

- Only documentation changed
- No production code
- No schema changes
- No P4/P5 changes
- No P6-01/02/03/04 changes
- Working tree clean after commit
