# P6-08B — Historical Intelligence / Temporal Comparison Semantic Contract

**Date:** 2026-08-27
**Phase:** P6-08 Historical Intelligence
**Status:** SEMANTIC CONTRACT COMPLETE
**Previous:** P6-08A landscape recon (`READY FOR P6-08B`)

---

## 1. Executive Summary

P6-08B defines the semantic contract for P6-08 Historical Intelligence / Temporal Comparison. This contract establishes how historical P6-03 snapshots, P6-04 regime states, P6-05 warning occurrences, and P6-06 intelligence summaries are browsable, comparable, and explainable across time windows.

**Critical finding from implementation inspection:** P6-06 summary persistence is NOT a blocker. The `persistSummary()` UPSERT only replaces content for the same `(entity_type, entity_id, timeframe, window_end)`. Different `window_end` values cause the old row to be marked SUPERSEDED (retained, not deleted). Historical summaries ARE preserved in the database. This reclassifies P6-08A evidence gap #1 from BLOCKING to NON-BLOCKING.

**3 inherited blocking decisions** are resolved with proposed resolutions:

| ID | Resolution |
|---|---|
| PD-08A-01 | Derive on-read — no new persistence |
| PD-08A-02 | Fixed windows: 7d, 30d, baseline (first-observed) |
| PD-08A-03 | Use membership at comparison time via `narrative_membership_events` |

**New invariant proposed:** 12 P6-08 invariants (PH-01…PH-12).

**Verdict: READY FOR P6-08C**

---

## 2. P6-08 Purpose

P6-08 is the **Historical Intelligence / Temporal Comparison Layer**. It extends the frozen P6 pipeline with temporal depth:

```
P6-01 → P6-02 → P6-03 → P6-04 → P6-05 → P6-06 → P6-07
                                                    ↓
                                              P6-08 (read extension)
                                                    ↓
                                          Historical browsing + comparison
```

P6-08 is a **read-layer extension**, not a pipeline stage. It consumes the same frozen artifacts as P6-07 but provides temporal depth.

---

## 3. Scope

### In Scope

1. Health score timeline (historical P6-03 snapshots)
2. Current vs N-day-ago comparison (7d, 30d)
3. Baseline comparison (first-observed snapshot)
4. Regime transition timeline (ordered regime changes)
5. Warning lifecycle history (all warnings with temporal bounds)
6. Intelligence summary history (all summaries, current + superseded)
7. Read APIs (`/api/p6/history/*`)
8. Coin and narrative historical comparison
9. Narrative membership-aware historical comparison
10. Gap handling for missing snapshots
11. Algorithm version display alongside historical data
12. Provenance traceability for comparison results

### Out of Scope

- Rolling window analytics
- Custom date ranges (V1 fixed windows only)
- Warning severity evolution tracking
- Cross-entity historical correlation
- Historical comparison persistence (derive on-read)
- Quality/freshness history timeline (optional, deferred)
- Narrative membership change visualization
- Forecasting / prediction
- Backfill (separate future concern)

---

## 4. Non-Goals

| Non-Goal | Reason |
|---|---|
| BUY/SELL engine | P6 boundary — measurement, not execution |
| Trading signals | P6 boundary — intelligence, not action |
| Action engine | P6 boundary — observation, not decision |
| Policy engine | P5 boundary — frozen |
| P5 bridge | P5 boundary — frozen, no replay contamination |
| P4 decision support | P4 boundary — frozen |
| Forecasting/prediction | Out of scope — P6 measures, does not predict |
| Automatic recommendation | P6 boundary — explanation, not recommendation |
| Cross-entity correlation | Deferred — no frozen contract |
| Warning delivery | Product concern, not intelligence |

---

## 5. Historical Data Model

### 5.1 Source Artifacts

| Artifact | Table | Temporal Fields | History Availability |
|---|---|---|---|
| P6-03 Snapshot | `p6_snapshots` | `window_end`, `calculation_time` | ✅ Full — per-day records, unique by window_end |
| P6-04 Regime | `p6_regime_states` | `calculation_time` | ✅ Full — all records retained (CURRENT + SUPERSEDED) |
| P6-05 Warning | `p6_warnings` | `detection_window`, `detected_at`, `effective_from`, `effective_until` | ✅ Full — append-only, lifecycle tracked |
| P6-06 Summary | `p6_intelligence_summaries` | `window_end`, `calculated_at` | ✅ Full — UPSERT preserves different windows; old windows become SUPERSEDED |

### 5.2 Historical Snapshot Query

All historical snapshots for an entity:

```sql
SELECT * FROM p6_snapshots
WHERE entity_type = ? AND entity_id = ? AND snapshot_type = ?
ORDER BY window_end ASC
```

Returns one row per daily refresh. Gaps indicate missed refreshes.

### 5.3 Historical Regime Query

All regime states for an entity (via existing `readRegimeHistory()`):

```sql
SELECT * FROM p6_regime_states
WHERE entity_type = ? AND entity_id = ? AND regime_type = 'HEALTH'
ORDER BY calculation_time ASC
```

Returns all records including CURRENT and SUPERSEDED. Each record has `previous_state` enabling transition reconstruction.

### 5.4 Historical Warning Query

All warnings for an entity (via existing `readWarningHistory()`):

```sql
SELECT * FROM p6_warnings
WHERE entity_type = ? AND entity_id = ?
ORDER BY detected_at ASC
```

Returns all warnings with full lifecycle (DETECTED → ACTIVE → RESOLVED | SUPERSEDED).

### 5.5 Historical Summary Query

All summaries for an entity:

```sql
SELECT * FROM p6_intelligence_summaries
WHERE entity_type = ? AND entity_id = ? AND timeframe = 'DAILY'
ORDER BY window_end ASC
```

Returns all rows including CURRENT and SUPERSEDED. Each row has full explanation data.

**Key finding:** P6-06 UPSERT semantics (`persistSummary()`) only replace content for the same `(entity_type, entity_id, timeframe, window_end)`. When a new day's summary is created, the previous day's row is marked SUPERSEDED but retained. Historical summaries are NOT lost.

---

## 6. Temporal Model

### 6.1 Comparison Types

| Type | Description | V1? |
|---|---|---|
| **Health Timeline** | All historical snapshots ordered by window_end | ✅ REQUIRED |
| **Current vs N-day-ago** | Compare current snapshot to snapshot N days prior | ✅ REQUIRED |
| **Current vs Baseline** | Compare current to first-observed snapshot | ✅ REQUIRED |
| **Regime Transition Timeline** | Ordered list of regime state changes | ✅ REQUIRED |
| **Warning Lifecycle History** | All warnings with temporal bounds | ✅ REQUIRED |
| Specific day A vs Specific day B | Arbitrary two-point comparison | DEFERRED |
| Rolling window analytics | Statistical analysis over windows | DEFERRED |
| Custom date ranges | User-specified date range | DEFERRED |

### 6.2 Comparison Semantics

A historical comparison is a **derived read result**, not a persisted artifact. It is a deterministic function of persisted P6 artifacts:

```
comparison(current_snapshot, reference_snapshot, [regime_history], [warning_history])
    ↓
ComparisonResult (transient, not persisted)
```

The comparison is:
- **Deterministic**: same inputs → same result
- **Idempotent**: read-only, no side effects
- **Reproducible**: source artifacts are versioned and immutable
- **Not an artifact**: not stored in any table

### 6.3 Timeline Semantics

A timeline is an ordered sequence of historical data points:

```
Timeline(entity_type, entity_id, dimension)
    ↓
[DataPoint(window_end, value, metadata)] ordered by window_end ASC
```

Each DataPoint may be:
- **Present**: artifact exists for this window_end
- **Gap**: no artifact for this window_end (explicit null)
- **Never**: before the entity's first observation

---

## 7. Comparison Identity

### 7.1 Comparison Result Identity

For V1, comparison results are derived on-read and not persisted. However, the comparison request is identified by:

| Field | Type | Description |
|---|---|---|
| `entity_type` | `"coin" \| "narrative"` | Entity type |
| `entity_id` | `number` | Entity ID |
| `comparison_type` | `"vs_n_day_ago" \| "baseline" \| "timeline"` | Comparison method |
| `reference_window_end` | `Date \| null` | The reference date (null for timeline) |
| `current_window_end` | `Date` | The current date being compared |
| `window_days` | `number \| null` | N for vs_n_day_ago (7, 30) |

### 7.2 Baseline Identity

| Field | Type | Description |
|---|---|---|
| `entity_type` | `"coin" \| "narrative"` | Entity type |
| `entity_id` | `number` | Entity ID |
| `baseline_type` | `"first_observed"` | V1 only |
| `baseline_window_end` | `Date` | The snapshot date used as baseline |

### 7.3 Deterministic Uniqueness

Comparison results are deterministic functions of:
- Source snapshot IDs and versions
- Algorithm (subtraction, literal comparison)
- Window parameters (7d, 30d)

No new persistence or uniqueness constraint needed for V1.

---

## 8. Comparison Windows

### 8.1 Fixed Windows (V1)

| Window | Description | API Parameter |
|---|---|---|
| **7 days** | Short-term comparison | `?window=7` |
| **30 days** | Medium-term comparison | `?window=30` |
| **Baseline** | First-observed snapshot | `?window=baseline` |

### 8.2 Window Resolution

For `window=N`:
1. Find current snapshot (most recent `window_end`)
2. Calculate `reference_window_end = current_window_end - N days`
3. Find snapshot closest to `reference_window_end` (exact match preferred)
4. If no exact match, use the nearest earlier snapshot
5. If no earlier snapshot exists, return `insufficient_history: true`

### 8.3 Gap Handling

Missing snapshots create explicit gaps in timelines:
- Timeline data points include a `has_data: boolean` field
- Gaps are represented as data points with `has_data: false` and `value: null`
- No interpolation, no fabrication
- Gap count is reported in metadata

---

## 9. Snapshot Selection

### 9.1 Current Snapshot Selection

The "current" snapshot is the most recent P6-03 snapshot for the entity:

```sql
SELECT * FROM p6_snapshots
WHERE entity_type = ? AND entity_id = ? AND snapshot_type = ? AND status = 'CURRENT'
ORDER BY window_end DESC LIMIT 1
```

### 9.2 Historical Snapshot Selection

For a specific date, find the snapshot with matching `window_end`:

```sql
SELECT * FROM p6_snapshots
WHERE entity_type = ? AND entity_id = ? AND snapshot_type = ?
  AND window_end = ?
LIMIT 1
```

### 9.3 Nearest Snapshot Selection

When exact `window_end` match is not available:

```sql
SELECT * FROM p6_snapshots
WHERE entity_type = ? AND entity_id = ? AND snapshot_type = ?
  AND window_end <= ?
ORDER BY window_end DESC LIMIT 1
```

### 9.4 Snapshot Data Available

Each historical snapshot provides:
- `health_score` (number)
- `confidence_score` (number)
- `data_completeness` (number)
- `health_dimensions` (JSONB array)
- `quality_metadata` (JSONB)
- `freshness_metadata` (JSONB)
- `snapshot_algorithm_version` (string)
- `window_end` (timestamp)
- `calculation_time` (timestamp)

---

## 10. Regime Comparison

### 10.1 Regime Timeline

All regime states for an entity, ordered by `calculation_time`:

```
readRegimeHistory(entity_type, entity_id, "HEALTH", limit)
    → [{ id, regimeState, confidence, healthScore, status, calculationTime }]
```

### 10.2 Regime Transition Detection

Transitions are reconstructed from consecutive regime states:

```
for each pair (previous, current) in regime history:
    if previous.regimeState ≠ current.regimeState:
        transition = {
            from: previous.regimeState,
            to: current.regimeState,
            at: current.calculationTime,
            health_score: current.healthScore
        }
```

### 10.3 Regime Duration

Duration between consecutive regime changes:

```
regime_duration = current_transition.at - previous_transition.at
```

If no previous transition, duration = time since first regime record.

### 10.4 UNKNOWN Handling

UNKNOWN and INSUFFICIENT_DATA regime states are:
- Displayed as-is (not fabricated)
- Not treated as transitions
- Counted in timeline but annotated

### 10.5 Current vs Historical Regime

| Aspect | Current (P6-07) | Historical (P6-08) |
|---|---|---|
| Data source | `readCurrentRegime()` | `readRegimeHistory()` |
| Scope | Latest only | All records |
| Transitions | Not shown | Reconstructed |
| Duration | Not shown | Calculated |

---

## 11. Warning Comparison

### 11.1 Warning Timeline

All warnings for an entity, ordered by `detected_at`:

```
readWarningHistory(entity_type, entity_id, limit)
    → WarningRecord[] with full lifecycle
```

### 11.2 Warning Lifecycle Analysis

Each warning has temporal bounds:

| Field | Meaning |
|---|---|
| `detected_at` | When the warning was first detected |
| `detection_window` | The snapshot window that triggered detection |
| `effective_from` | When the warning became effective |
| `effective_until` | When the warning ended (null if still active) |
| `superseded_at` | When superseded by a newer warning |

### 11.3 Warning Classification

| Classification | Condition |
|---|---|
| **Active** | `lifecycleStatus = 'ACTIVE'` and `effective_until IS NULL` |
| **Resolved** | `lifecycleStatus = 'RESOLVED'` |
| **Recurring** | Same `warning_type` appeared multiple times (separate `dedup_key`) |
| **Persistent** | Active for > N days (`effective_from` to now) |

### 11.4 Current vs Historical Warnings

| Aspect | Current (P6-07) | Historical (P6-08) |
|---|---|---|
| Data source | `readActiveWarnings()` | `readWarningHistory()` |
| Scope | Active only | All (active + resolved + superseded) |
| Lifecycle | Current state only | Full lifecycle with temporal bounds |
| Frequency | Not shown | Count per period |

---

## 12. Intelligence Summary Comparison

### 12.1 Summary History Availability

**Key finding:** P6-06 UPSERT semantics preserve historical summaries.

The `persistSummary()` function:
1. Supersedes all OTHER CURRENT summaries for the same entity+timeframe (different `window_end`)
2. UPSERTs the row for the exact identity tuple `(entity_type, entity_id, timeframe, window_end)`

Result: Each daily summary has its own row. Old rows are marked SUPERSEDED but retained.

### 12.2 Summary Timeline Query

```sql
SELECT * FROM p6_intelligence_summaries
WHERE entity_type = ? AND entity_id = ? AND timeframe = 'DAILY'
ORDER BY window_end ASC
```

Returns all rows (CURRENT + SUPERSEDED) with full explanation data.

### 12.3 Summary Comparison

Comparing two summaries provides:

| Dimension | Source |
|---|---|
| Health delta | `current.health_score - reference.health_score` |
| Regime change | `current.regime_state ≠ reference.regime_state` |
| Warning count change | `current.active_warning_count - reference.active_warning_count` |
| Explanation difference | Structured `what_changed` arrays |

### 12.4 Summary Version Tracking

Each summary record carries:
- `algorithmVersion` (e.g., `"p6-summary-v1"`)
- `parameterVersion`
- `schemaVersion`
- `configHash`

Historical summaries may have been generated by different algorithm versions. Version is displayed alongside historical data but never used to recalculate.

---

## 13. Narrative Membership Semantics

### 13.1 The Problem

Narrative membership changes over time:
- Coins are added to narratives
- Coins are removed from narratives
- Primary narrative assignments change

Historical narrative health was calculated using the membership at that time. P6-03 snapshots capture the member scores used in aggregation (via `narrative_snapshot_provenance.member_coin_snapshots`).

### 13.2 Resolution: Membership at Comparison Time

**PD-08A-03 proposed resolution:** Use membership at comparison time.

When comparing narrative health:
- Current comparison uses current membership (standard P6-07 behavior)
- Historical comparison uses membership at the historical point
- Membership is reconstructed from `narrative_membership_events` table

### 13.3 Membership Reconstruction

The `narrative_membership_events` table tracks:
- `ADDED`: coin added to narrative
- `REMOVED`: coin removed from narrative
- `PRIMARY_SET`: primary narrative assignment changed

Point-in-time membership at any date `T`:

```sql
SELECT coin_id, is_primary
FROM narrative_membership_events
WHERE narrative_id = ? AND effective_at <= ?
ORDER BY effective_at DESC, id DESC
-- Deduplicate per coin_id (latest event wins)
```

### 13.4 Membership Change Impact

When narrative membership changes between current and historical comparison:
- The comparison notes that membership changed
- Coin-level contributions may differ
- The comparison includes a `membership_changed: boolean` flag
- Optionally, the diff in membership is listed

### 13.5 Membership Stability Assumption

If `narrative_membership_events` has no entries for a narrative:
- Membership is assumed stable (current membership applies to all history)
- `membership_changed: false`

---

## 14. Missing History

### 14.1 Missing Snapshot

| Scenario | Behavior |
|---|---|
| Day has no snapshot | Timeline shows gap (explicit null data point) |
| Entity has no history at all | Return empty timeline with `history_length: 0` |
| Partial history | Show available data; gaps marked explicitly |

### 14.2 Missing Regime

| Scenario | Behavior |
|---|---|
| No regime record for a day | Regime timeline shows gap |
| First regime record is recent | Timeline starts from first record |

### 14.3 Missing Warnings

| Scenario | Behavior |
|---|---|
| No warnings ever | Empty warning history array |
| All warnings resolved | Show full lifecycle including resolved period |

### 14.4 Missing Summaries

| Scenario | Behavior |
|---|---|
| No summaries exist | Return empty summary history |
| Only current summary exists | Return single-item timeline |

### 14.5 Missing Baseline

| Scenario | Behavior |
|---|---|
| No snapshots exist for entity | Baseline comparison returns `insufficient_history: true` |
| Only one snapshot exists | Baseline = that snapshot; delta = 0 |

### 14.6 No Fabrication

**PH-04: Never fabricate missing historical data.** Gaps are explicit. Nulls are null. Insufficient history is reported honestly.

---

## 15. Insufficient History

### 15.1 Insufficient History for Comparison

When requesting `window=30` but only 10 days of history exist:

```json
{
  "success": true,
  "data": {
    "comparison_type": "vs_n_day_ago",
    "requested_window_days": 30,
    "actual_window_days": 10,
    "insufficient_history": true,
    "current": { ... },
    "reference": { ... },
    "delta": { ... }
  }
}
```

The comparison is still performed with available data, but `insufficient_history: true` flags that the requested window was not fully available.

### 15.2 Insufficient History for Baseline

When no snapshots exist:

```json
{
  "success": true,
  "data": {
    "comparison_type": "baseline",
    "insufficient_history": true,
    "history_length": 0,
    "current": null,
    "baseline": null
  }
}
```

---

## 16. Quality/Freshness

### 16.1 Quality Metadata in Historical Data

Each P6-03 snapshot carries `quality_metadata` (JSONB). Historical comparisons may display quality metadata alongside health data.

### 16.2 Freshness Metadata in Historical Data

Each P6-03 snapshot carries `freshness_metadata` (JSONB). Historical comparisons may display freshness metadata.

### 16.3 Quality ≠ Freshness

**Inherited from P6-07 frozen contract:** QualityState and Freshness are independent dimensions. P6-08 preserves this distinction in historical views.

### 16.4 Quality/Freshness History

Quality and freshness history can be derived from snapshot `quality_metadata` and `freshness_metadata` over time. This is OPTIONAL for V1.

---

## 17. Provenance

### 17.1 Provenance Chain

```
Historical Comparison Result
    ↓
current snapshot (P6-03 record)
reference snapshot (P6-03 record)
    ↓
regime records (P6-04) — if regime comparison
warning records (P6-05) — if warning comparison
summary records (P6-06) — if explanation comparison
```

### 17.2 Provenance Fields

Each comparison result includes:

| Field | Description |
|---|---|
| `current_snapshot_id` | P6-03 snapshot ID for current |
| `reference_snapshot_id` | P6-03 snapshot ID for reference |
| `current_snapshot_version` | Algorithm version of current snapshot |
| `reference_snapshot_version` | Algorithm version of reference snapshot |
| `comparison_algorithm` | `"p6-comparison-v1"` (trivial subtraction) |
| `calculated_at` | When the comparison was computed |

### 17.3 Provenance Exposure

V1 exposes provenance in the API response. UI may display in collapsed "Technical Details" section.

---

## 18. Versioning

### 18.1 Comparison Algorithm Version

V1 comparison is trivial (subtraction, literal comparison). Version: `"p6-comparison-v1"`.

No separate parameter version needed — comparison windows (7d, 30d) are UI configuration, not algorithm parameters.

### 18.2 Source Artifact Versions

Each comparison inherits the version of its source artifacts:
- Snapshot: `snapshot_algorithm_version`, `snapshot_parameter_version`, `snapshot_schema_version`, `snapshot_config_hash`
- Regime: `algorithm_version`, `parameter_version`, `schema_version`, `config_hash`
- Warning: `algorithm_version`, `parameter_version`, `schema_version`, `config_hash`
- Summary: `algorithm_version`, `parameter_version`, `schema_version`, `config_hash`

### 18.3 Version Display

Historical data may include artifacts from different algorithm versions. The comparison does not normalize versions — it displays them alongside the data for transparency.

**PH-05: Do not recalculate historical artifacts using current algorithm versions.**

### 18.4 Timeframe

V1 uses DAILY timeframe only. If other timeframes are added later, a `comparison_timeframe` field would be needed.

---

## 19. Persistence vs On-Read

### 19.1 V1 Decision: Derive On-Read

**PD-08A-01 proposed resolution:** Comparison results are derived on-read from persisted artifacts. No new persistence tables.

### 19.2 Rationale

- Comparison is a deterministic function of persisted data
- Persisting comparison results would duplicate data without adding value
- On-read derivation is reproducible (same inputs → same output)
- No new persistence = no migration, no schema change, no maintenance burden

### 19.3 Future Consideration

If V2+ needs persisted comparison results (for API contract stability, caching, or reproducibility guarantees), a `p6_historical_comparisons` table could be added. Not required for V1.

---

## 20. Lifecycle

### 20.1 No New Lifecycle States

P6-08 does not create new lifecycle states. It reads existing lifecycle states:
- Snapshot: CURRENT | SUPERSEDED
- Regime: CURRENT | SUPERSEDED
- Warning: DETECTED | ACTIVE | RESOLVED | SUPERSEDED
- Summary: CURRENT | SUPERSEDED

### 20.2 Historical Data Immutability

P6-03 snapshots, P6-04 regimes, and P6-05 warnings are immutable once persisted. P6-06 summaries are replaced only for the same `window_end` (different windows are superseded, not replaced).

Historical data is not modified by future refreshes.

---

## 21. Determinism

### 21.1 Deterministic Comparison

**PH-01: Same persisted artifacts + same algorithm → same comparison result.**

V1 comparison functions:
- `computeHealthDelta(current, previous)` — subtraction
- `computeHealthChangePct(current, previous)` — percentage
- `computeRegimeChange(previous, current)` — literal comparison
- Timeline ordering — `ORDER BY window_end ASC`

All are deterministic.

### 21.2 No Randomness

No random values, no time-dependent logic (beyond reading persisted timestamps), no external calls.

### 21.3 Reproducibility

Since comparison is derived on-read from immutable, versioned artifacts, it is reproducible at any future point.

---

## 22. Explicit Decisions

### 22.1 Inherited Decisions (Frozen)

| Decision | Source | P6-08 Impact |
|---|---|---|
| PD-03B-03 | P6-03 | Snapshot latest-only operational semantics |
| PD-03B-08 | P6-03 | Snapshot version tuple |
| PD-04B-01 | P6-04 | Regime vocabulary (6 states) |
| PD-04B-04 | P6-04 | Transition threshold (10 points) |
| PD-04B-05 | P6-04 | Min persistence (2 snapshots) |
| PD-05B-01 | P6-05 | Warning vocabulary (7 types) |
| PD-05B-02 | P6-05 | Severity vocabulary (5 levels) |
| PD-05B-10 | P6-05 | Warning lifecycle (4 states) |
| PD-05C-01 | P6-05 | Warning occurrence-based identity |
| PD-06A-01 | P6-06 | Summary scope |
| PD-06A-02 | P6-06 | Explanation format (structured arrays) |
| PD-06A-03 | P6-06 | Change detection: two-point only (P6-08 extends to multi-point) |
| PD-06A-04 | P6-06 | Minimum population (≥1) |
| PD-06C-02 | P6-06 | UPSERT semantics (same window_end = replace; different = supersede) |
| PD-07A-01 | P6-07 | Refresh wiring |
| PD-07A-02 | P6-07 | Read API surface |
| PD-07A-03 | P6-07 | Legacy panel retirement |

---

## 23. New Decisions

| ID | Question | Proposed | Status | Blocking |
|---|---|---|---|---|
| **PD-08A-01** | Persist comparison results or derive on-read? | Derive on-read | PROPOSED | **YES** |
| **PD-08A-02** | Default historical comparison window? | 7d, 30d, baseline | PROPOSED | **YES** |
| **PD-08A-03** | How should narrative membership changes affect historical comparison? | Use membership at comparison time | PROPOSED | **YES** |
| PD-08A-04 | Replace or supplement legacy health-timeline APIs? | Supplement | PROPOSED | No |
| PD-08A-05 | Show gaps for missing snapshots? | Yes — explicit gaps | PROPOSED | No |
| PD-08A-06 | Baseline type for V1? | First-observed snapshot | PROPOSED | No |
| PD-08A-07 | Include regime transition timeline? | Yes | PROPOSED | No |
| PD-08A-08 | Include warning lifecycle history? | Yes | PROPOSED | No |
| PD-08A-09 | Separate API endpoints or extend P6-07? | Separate `/api/p6/history/*` | PROPOSED | No |
| PD-08A-10 | Handle algorithm version changes in historical data? | Display alongside; do not recalculate | PROPOSED | No |
| PD-08A-11 | Support custom date ranges in V1? | No — fixed windows only | PROPOSED | No |
| PD-08A-12 | Include quality/freshness history? | Optional (deferred) | PROPOSED | No |

---

## 24. Blocking Decisions

| ID | Question | Why Blocking | Proposed Resolution |
|---|---|---|---|
| **PD-08A-01** | Persist vs derive | Determines persistence model, API design, reproducibility | Derive on-read — no new persistence |
| **PD-08A-02** | Comparison windows | Determines API parameters, UI defaults | Fixed: 7d, 30d, baseline |
| **PD-08A-03** | Membership handling | Determines historical accuracy vs consistency | Use membership at comparison time |

---

## 25. Non-Blocking Decisions

| ID | Question | Default |
|---|---|---|
| PD-08A-04 | Replace vs supplement | Supplement |
| PD-08A-05 | Gap handling | Explicit gaps |
| PD-08A-06 | Baseline type | First-observed |
| PD-08A-07 | Regime timeline | Include |
| PD-08A-08 | Warning history | Include |
| PD-08A-09 | API design | Separate endpoints |
| PD-08A-10 | Version display | Display alongside |
| PD-08A-11 | Custom ranges | Fixed only |
| PD-08A-12 | Quality history | Optional |

---

## 26. Deferred Decisions

| ID | Question | Reason |
|---|---|---|
| Rolling window analytics | Statistical analysis | Deferred to P6-09+ |
| Cross-entity historical correlation | No frozen contract | Deferred |
| Warning severity evolution | Complex lifecycle | Deferred |
| Custom date ranges | Over-engineering for V1 | Deferred |
| Historical comparison persistence | On-read sufficient | Deferred |

---

## 27. Invariants

### P6-08 Proposed Invariants (PH-01…PH-12)

| ID | Invariant | Description |
|---|---|---|
| **PH-01** | Deterministic comparison | Same persisted artifacts + same algorithm → same comparison result |
| **PH-02** | No fabrication | Never invent historical data; gaps are explicit |
| **PH-03** | No recalculation | Historical artifacts are displayed as-is; never recalculated with current algorithm |
| **PH-04** | Insufficient history honest | Return available data with `insufficient_history: true` when window exceeds history |
| **PH-05** | Version display | Show algorithm versions alongside historical data; do not normalize |
| **PH-06** | Membership accuracy | Narrative historical comparison uses membership at comparison time |
| **PH-07** | No new persistence | V1 comparison is derived on-read; no new tables |
| **PH-08** | Read-only | P6-08 APIs are GET-only; no mutation |
| **PH-09** | P6-native only | P6-08 consumes only P6-01…P6-07 artifacts; no P3/P4/P5 data |
| **PH-10** | No action semantics | P6-08 explains history; does not recommend actions |
| **PH-11** | Quality ≠ Freshness | Historical quality and freshness remain independent dimensions |
| **PH-12** | Gap explicit | Missing snapshots are shown as gaps, not interpolated |

### Inherited Invariants (from P6-07)

| ID | Invariant |
|---|---|
| PV-01 | P6-07 consumes only P6-native artifacts |
| PV-02 | P6-07 does not recalculate semantics |
| PV-03 | P6-07 is read-only |
| PV-04 | P6-07 output is deterministic |
| PV-10 | P4 untouched |
| PV-11 | P5 untouched |
| PV-12 | No action semantics |
| PV-13 | No BUY/SELL semantics |
| PV-14 | No legacy contamination |

---

## 28. Evidence Gaps

| Gap | Blocking? | Impact | Resolution |
|---|---|---|---|
| ~~P6-06 summaries latest-only~~ | ~~YES~~ | ~~Historical summaries lost~~ | **RESOLVED:** UPSERT preserves different windows; old windows become SUPERSEDED (retained) |
| No `readSnapshotHistory()` function | **YES** | Cannot query historical snapshots | Create read function in P6-08 implementation |
| Narrative membership at historical time not directly queryable from `p6_snapshots` | **YES** | Cannot determine historical membership | Use `narrative_membership_events` to reconstruct |
| No P6-native health-timeline API | No | Legacy API uses non-P6 data | Create new API in P6-08 |
| P6-03 `healthDimensions` JSONB structure not documented for historical consumption | No | May need to parse for dimension history | Document in P6-08C |
| No tests for historical read functions | No | Must create in implementation | Create in P6-08D |

**Reclassification:** P6-08A evidence gap #1 (P6-06 summaries) is reclassified from BLOCKING to RESOLVED based on implementation inspection of `persistSummary()` UPSERT semantics.

---

## 29. P6-06 Boundary

### 29.1 PD-06A-03 Constraint

P6-06 change detection is two-point only (current vs immediate previous). P6-08 extends this to multi-point comparison **without modifying P6-06**.

P6-08 reads the same persisted artifacts but queries them differently (historical queries vs current-only queries).

### 29.2 P6-06 Summary Persistence Boundary

P6-06 `persistSummary()` UPSERT semantics:
- Same `(entity_type, entity_id, timeframe, window_end)` → replace content
- Different `window_end` → old row becomes SUPERSEDED (retained)

P6-08 reads all rows (CURRENT + SUPERSEDED) for historical summary access.

### 29.3 No P6-06 Modification

P6-08 does NOT:
- Modify `persistSummary()` semantics
- Modify summary identity
- Modify explanation format
- Add new summary fields
- Change lifecycle states

---

## 30. P4 Boundary

| Check | Result |
|---|---|
| P4 code modified | ❌ NO |
| P4 semantics reinterpreted | ❌ NO |
| P4 data consumed by P6-08 | ❌ NO |
| P4 decision support in P6-08 | ❌ NO |
| P4 policy semantics | ❌ NO |

**P4 untouched.**

---

## 31. P5 / Replay Boundary

| Check | Result |
|---|---|
| P5 code modified | ❌ NO |
| P5 semantics reinterpreted | ❌ NO |
| P5 replay dependency created | ❌ NO |
| P5 action semantics in P6-08 | ❌ NO |
| P5 bridge created | ❌ NO |
| BUY/SELL vocabulary | ❌ NOT FOUND |
| Decision semantics | ❌ NOT FOUND |

**P5 untouched. No replay contamination.**

---

## 32. Planner Acceptance Gate

### 32.1 Blocking Decisions Requiring Acceptance

| ID | Question | Proposed Resolution | Accept/Modify/Reject |
|---|---|---|---|
| **PD-08A-01** | Persist vs derive on-read? | Derive on-read | ⏳ PENDING |
| **PD-08A-02** | Default comparison windows? | 7d, 30d, baseline | ⏳ PENDING |
| **PD-08A-03** | Narrative membership handling? | Use membership at comparison time | ⏳ PENDING |

### 32.2 Acceptance Rules

- **ACCEPT** → Decision is frozen for P6-08C/D implementation
- **MODIFY** → Agent records modification, identifies affected decisions, re-audits
- **REJECT** → Agent documents rejection, proposes alternative

### 32.3 Post-Acceptance State

```
3/3 blocking decisions accepted
  → all semantic dependencies resolved
  → P6-08C (decision inventory + gap audit) may proceed
```

---

## 33. Recommended V1 Scope

### In Scope

1. Health score timeline from P6-03 snapshots
2. Current vs 7d and 30d comparison
3. Baseline comparison (first-observed)
4. Regime transition timeline from P6-04
5. Warning lifecycle history from P6-05
6. Summary history from P6-06
7. Read APIs (`/api/p6/history/*`)
8. Coin and narrative comparison
9. Narrative membership-aware comparison
10. Explicit gap handling
11. Algorithm version display
12. Provenance traceability

### Out of Scope

- Rolling analytics
- Custom date ranges
- Severity evolution
- Cross-entity correlation
- Comparison persistence
- Quality/freshness timeline

### Conservative Principles

- Deterministic
- Explainable
- Read-compatible (no frozen contract modification)
- No LLM
- No prediction
- No action
- Minimal new persistence
- Bounded scope

---

## 34. Recommended Execution Sequence

```
P6-08A  Landscape Recon ← COMPLETE
  ↓
P6-08B  Semantic Contract ← YOU ARE HERE
  ↓
P6-08C  Decision Inventory + Gap Audit
  ↓
P6-08C1 Focused Planner Decision Contract
  ↓
Planner Acceptance
  ↓
P6-08D  Implementation
  ↓
P6-08E  Hardening + Freeze Audit
  ↓
P6-08-FINAL Freeze Declaration
```

---

## 35. Readiness Verdict

```
READY FOR P6-08C
```

3 blocking decisions have proposed resolutions. P6-06 summary persistence reclassified from BLOCKING to RESOLVED. All P6-01…P6-07 frozen contracts are respected. P4/P5 boundaries are intact. The semantic contract defines clear invariants, comparison semantics, and temporal model.

---

## 36. Git Boundary

| Check | Result |
|---|---|
| Only documentation file changed | ✅ PASS |
| No production code modified | ✅ PASS |
| No frozen contracts modified | ✅ PASS |
| P4/P5 untouched | ✅ PASS |
| P6-01…P6-07 untouched | ✅ PASS |
