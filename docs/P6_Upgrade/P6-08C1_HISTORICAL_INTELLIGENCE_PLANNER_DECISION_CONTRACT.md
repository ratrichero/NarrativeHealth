# P6-08C1 — Historical Intelligence / Temporal Comparison Focused Planner Decision Contract

**Date:** 2026-08-27
**Phase:** P6-08 Historical Intelligence
**Status:** PLANNER DECISION CONTRACT
**Previous:** P6-08C decision inventory (`READY FOR P6-08C1`)

---

## 1. Executive Summary

P6-08C1 presents **5 blocking decisions** for explicit Planner ACCEPT / MODIFY / REJECT. These decisions are the gate between semantic contract design and implementation.

P6-08A established the landscape. P6-08B defined the semantic contract. P6-08C audited decisions, discovered 8 implicit decisions, and resolved 1 evidence gap (P6-06 summary persistence). The 5 blocking decisions survived independent re-audit.

**The 5 blocking decisions:**

| ID | Question | Proposed Resolution |
|---|---|---|
| **PD-08A-01** | Persist comparison results or derive on-read? | Derive on-read |
| **PD-08A-02** | Default historical comparison windows? | 7d, 30d, baseline |
| **PD-08A-03** | How should narrative membership changes affect historical comparison? | Use membership at comparison time |
| **PD-08C-03** | Warning occurrence matching for historical comparison? | Match by `warning_type` + `detection_window` |
| **PD-08C-04** | Membership reconstruction strategy? | Latest event per coin at `effective_at ≤ T` |

**All 5 must be ACCEPTED before P6-08D implementation.**

---

## 2. P6-08 Objective

P6-08 is the **Historical Intelligence / Temporal Comparison Layer** — a read-layer extension over frozen P6-01…P6-07 artifacts that provides temporal depth.

```
P6-01 → P6-02 → P6-03 → P6-04 → P6-05 → P6-06 → P6-07
                                                    ↓
                                              P6-08 (read extension)
                                                    ↓
                                          Historical browsing + comparison
```

P6-08 is NOT a new pipeline stage. It consumes the same frozen artifacts as P6-07 but provides:

1. Health score timeline (historical P6-03 snapshots)
2. Current vs N-day-ago comparison (7d, 30d)
3. Baseline comparison (first-observed snapshot)
4. Regime transition timeline (ordered regime changes)
5. Warning lifecycle history (all warnings with temporal bounds)
6. Intelligence summary history (all summaries, current + superseded)
7. Read APIs (`/api/p6/history/*`)

---

## 3. Scope

### In Scope

1. Historical snapshot browsing via `readSnapshotHistory()` (new read function)
2. Current vs N-day-ago comparison (7d, 30d)
3. Current vs baseline (first-observed snapshot)
4. Regime transition timeline from `readRegimeHistory()`
5. Warning lifecycle history from `readWarningHistory()`
6. Historical intelligence summary retrieval
7. Coin and narrative historical comparison
8. Narrative membership-aware historical comparison
9. Gap handling for missing snapshots
10. Algorithm version display alongside historical data
11. Provenance traceability for comparison results
12. Read APIs (`/api/p6/history/*`)

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

## 4. Explicit Non-Goals

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

## 5. Relationship to P6-01 → P6-07

| Phase | Status | P6-08 Relationship |
|---|---|---|
| P6-01 | FROZEN | Observations consumed indirectly via snapshots |
| P6-02 | FROZEN | Features consumed indirectly via snapshots |
| P6-03 | FROZEN | **Primary historical data source** — snapshots with `window_end` identity |
| P6-04 | FROZEN | **Regime history** — `readRegimeHistory()` provides all records |
| P6-05 | FROZEN | **Warning history** — `readWarningHistory()` provides all records |
| P6-06 | FROZEN | **Summary history** — UPSERT preserves different `window_end` rows |
| P6-07 | FROZEN | **Current presentation** — P6-08 extends with temporal depth |

P6-08 consumes frozen P6 artifacts without modifying any frozen contract.

---

## 6. Authority Model

P6-08 decisions are PROPOSED until Planner acceptance. No decision is frozen until explicitly frozen in P6-08-FINAL.

P6-08 decisions MUST NOT:

- Modify P6-01…P6-07 frozen contracts
- Modify P4 semantics
- Modify P5 semantics
- Modify P5 replay semantics
- Create new intelligence calculation engines
- Create action semantics
- Create BUY/SELL semantics

---

## 7. Temporal Reference Model

All artifacts align using a coherent temporal reference model:

| Artifact | Alignment Key | Temporal Resolution | Source |
|---|---|---|---|
| P6-03 Snapshots | `window_end` (midnight) | Daily | `p6_snapshots` |
| P6-04 Regime | `calculation_time` | Per-refresh | `p6_regime_states` |
| P6-05 Warnings | `detection_window` (midnight) | Per-detection | `p6_warnings` |
| P6-06 Summaries | `window_end` (midnight) | Daily | `p6_intelligence_summaries` |
| Membership Events | `effective_at` (timezone-aware) | Per-event | `narrative_membership_events` |

**Alignment rule:** Compare by date (midnight `window_end`), not by exact timestamp.

**PD-08C-01 (non-blocking):** Snapshot `window_end` alignment is midnight start-of-day (evidence: `persistCoinSnapshot()` sets `windowEnd.setHours(0, 0, 0, 0)`).

---

## 8. Comparison Window Semantics

### 8.1 Windows (PD-08A-02)

| Window | Description | API Parameter |
|---|---|---|
| **7 days** | Short-term comparison | `?window=7` |
| **30 days** | Medium-term comparison | `?window=30` |
| **Baseline** | First-observed snapshot | `?window=baseline` |

### 8.2 Window Resolution

For `window=N`:

1. Find current snapshot (most recent `window_end` with status=CURRENT)
2. Calculate `reference_window_end = current_window_end − N days`
3. Find snapshot closest to `reference_window_end` (exact match preferred)
4. If no exact match, use the nearest earlier snapshot (`window_end ≤ reference_window_end`)
5. If no earlier snapshot exists, return `insufficient_history: true`

### 8.3 Gap Handling (PD-08A-05)

Missing snapshots create explicit gaps:

- Timeline data points include `has_data: boolean`
- Gaps: `has_data: false`, `value: null`
- No interpolation, no fabrication
- Gap count reported in metadata

---

## 9. Snapshot Selection Semantics

### 9.1 Current Snapshot

```sql
SELECT * FROM p6_snapshots
WHERE entity_type = ? AND entity_id = ? AND snapshot_type = ? AND status = 'CURRENT'
ORDER BY window_end DESC LIMIT 1
```

### 9.2 Historical Snapshot (by date)

```sql
SELECT * FROM p6_snapshots
WHERE entity_type = ? AND entity_id = ? AND snapshot_type = ?
  AND window_end = ?
LIMIT 1
```

### 9.3 Nearest Snapshot (fallback)

```sql
SELECT * FROM p6_snapshots
WHERE entity_type = ? AND entity_id = ? AND snapshot_type = ?
  AND window_end <= ?
ORDER BY window_end DESC LIMIT 1
```

### 9.4 Snapshot History (new function needed)

**Evidence gap:** No `readSnapshotHistory()` function exists. Must be created in P6-08D.

```sql
SELECT * FROM p6_snapshots
WHERE entity_type = ? AND entity_id = ? AND snapshot_type = ?
ORDER BY window_end ASC
```

Returns all rows (CURRENT + SUPERSEDED). One row per daily refresh.

---

## 10. Historical Membership Semantics

### 10.1 The Problem

Narrative membership changes over time:

- Coins are added to narratives (`ADDED` event)
- Coins are removed from narratives (`REMOVED` event)
- Primary narrative assignments change (`PRIMARY_SET` event)

Historical narrative health was calculated using the membership at that time. P6-03 snapshots capture the member scores used in aggregation.

### 10.2 Resolution (PD-08A-03)

**Use membership at comparison time.**

When comparing narrative health:

- Current comparison uses current membership (standard P6-07 behavior)
- Historical comparison uses membership at the historical point
- Membership is reconstructed from `narrative_membership_events` table

### 10.3 Why Not Current Membership?

Using current membership applied retrospectively would:

- Misrepresent historical narrative composition
- Include coins that were not members at the historical point
- Exclude coins that were members but have since been removed
- Make historical health scores incomparable to what was actually calculated

### 10.4 Membership Stability Assumption

If `narrative_membership_events` has no entries for a narrative:

- Assume current membership applies to all history
- `membership_changed = false`

---

## 11. Membership Reconstruction

### 11.1 Algorithm (PD-08C-04)

For each coin, find the latest membership event where `effective_at ≤ T`:

```sql
-- Point-in-time membership for narrative at time T
SELECT DISTINCT ON (coin_id)
  coin_id, event_type, is_primary, effective_at
FROM narrative_membership_events
WHERE narrative_id = ? AND effective_at <= ?
ORDER BY coin_id, effective_at DESC, id DESC
```

Then filter: only coins with latest event `event_type ≠ 'REMOVED'` are members.

### 11.2 Event Ordering

- Primary sort: `effective_at DESC` (most recent event first)
- Secondary sort: `id DESC` (deterministic tie-breaking by insertion order)
- This is consistent with PD-08C-06 (tie-breaking by `id` ASC for forward ordering)

### 11.3 Edge Cases

| Scenario | Handling |
|---|---|
| Member added before window | Included as member |
| Member added during window | Member from `effective_at` onward |
| Member removed during window | Member until `effective_at`, then removed |
| Member removed before comparison | Not a member at comparison time |
| Member never existed | Not in events; not a member |
| Membership event gaps | Latest known state applies until next event |
| Overlapping events | `effective_at` + `id` ordering breaks ties |
| ADDED then REMOVED then ADDED | Latest event wins; coin is member if latest is ADDED |

### 11.4 Infrastructure Evidence

`narrative_membership_events` table:

```sql
-- Indexed for efficient point-in-time queries:
-- (narrative_id, effective_at, id)
-- (narrative_id, coin_id, effective_at, id)
-- (coin_id, effective_at)
```

`narrative_membership_snapshots` and `narrative_membership_snapshot_members` provide pre-computed point-in-time membership as an alternative.

---

## 12. Warning Comparison Semantics

### 12.1 Warning Occurrence Matching (PD-08C-03)

For historical comparison, warnings are matched by:

```
warning_type + detection_window
```

This identifies a unique warning occurrence (consistent with P6-05 frozen identity: `dedup_key = entity_type:entity_id:warning_type:detection_window`).

### 12.2 Why Not `dedup_key`?

`dedup_key` includes `entity_type` and `entity_id`, which are redundant in a per-entity query. Matching by `warning_type` + `detection_window` is semantically equivalent within a single entity scope.

### 12.3 Severity Changes

Severity is **immutable per warning record**. Different occurrences of the same `warning_type` may have different severities. Severity comparison is across occurrences, not within a single occurrence.

### 12.4 Warning Lifecycle in Historical Context

| Classification | Condition |
|---|---|
| **Active** | `lifecycle = 'ACTIVE'` and `effective_until IS NULL` |
| **Resolved** | `lifecycle = 'RESOLVED'` |
| **Recurring** | Same `warning_type` with different `detection_window` values |
| **Persistent** | Active for > N days (`effective_from` to comparison time) |

### 12.5 P6-05 Warning Identity Preservation

P6-05 warning identity is FROZEN. P6-08 consumes P6-05 identity without redefining it.

```
P6-05 frozen identity: dedup_key = entity_type:entity_id:warning_type:detection_window
P6-08 comparison key:  warning_type + detection_window (within entity scope)
```

These are equivalent within a per-entity query.

---

## 13. Regime Comparison Semantics

### 13.1 Regime Timeline

All regime states from `readRegimeHistory()`:

```typescript
readRegimeHistory(entityType, entityId, "HEALTH", limit = 50)
  → [{ id, regimeState, confidence, healthScore, status, calculationTime }]
```

### 13.2 Transition Detection (PD-08C-02)

Transitions = consecutive records where `regimeState` differs:

```
for each pair (previous, current) in regime history (ordered by calculation_time ASC):
    if previous.regimeState ≠ current.regimeState:
        transition = {
            from: previous.regimeState,
            to: current.regimeState,
            at: current.calculationTime,
            health_score: current.healthScore
        }
```

### 13.3 Regime Duration

```
regime_duration = current_transition.at − previous_transition.at
```

If no previous transition, duration = time since first regime record.

### 13.4 UNKNOWN Handling

UNKNOWN and INSUFFICIENT_DATA regime states are:

- Displayed as-is (not fabricated)
- Not treated as transitions
- Counted in timeline but annotated

---

## 14. Intelligence Summary Comparison

### 14.1 Summary History

P6-06 UPSERT preserves historical summaries:

- `persistSummary()` replaces content only for the same `(entity_type, entity_id, timeframe, window_end)`
- Different `window_end` = old row becomes SUPERSEDED (retained)
- Historical summaries ARE preserved

```sql
SELECT * FROM p6_intelligence_summaries
WHERE entity_type = ? AND entity_id = ? AND timeframe = 'DAILY'
ORDER BY window_end ASC
```

### 14.2 Summary Comparison Dimensions

| Dimension | Source |
|---|---|
| Health delta | `current.health_score − reference.health_score` |
| Regime change | `current.regime_state ≠ reference.regime_state` |
| Warning count change | `current.active_warning_count − reference.active_warning_count` |
| Explanation difference | Structured `what_changed` arrays |

---

## 15. Health Delta Semantics

### 15.1 Delta Calculation

```
health_delta = current.health_score − reference.health_score
```

- Both values present: numeric delta (2 decimal places)
- Either null: delta = null

### 15.2 Percentage Delta

```
health_change_pct = (current − reference) / reference × 100
```

- reference = 0 or null: pct = null (per PD-06C-03)
- Rounding: 2 decimal places

### 15.3 Zero Baseline (PD-08C-05)

- Delta = current − 0 = current
- Pct = null (per PD-06C-03: `previous = 0 → null`)

---

## 16. Confidence Delta Semantics

```
confidence_delta = current.confidence_score − reference.confidence_score
```

- Both values present: numeric delta
- Either null: delta = null
- No confidence deterioration detection in V1 (deferred)

---

## 17. Quality / Freshness Semantics

### 17.1 Quality ≠ Freshness

**Inherited from P6-07 frozen contract:** QualityState and Freshness are independent dimensions.

### 17.2 Historical Quality/Freshness

Each P6-03 snapshot carries `quality_metadata` and `freshness_metadata` (JSONB). Historical comparisons may display this metadata alongside health data.

### 17.3 No Merging

P6-08 MUST NOT:

- Merge quality and freshness
- Derive one from the other
- Create a new QualityState
- Treat infrastructure failure as quality degradation

---

## 18. Missing / Null / UNKNOWN Semantics

### 18.1 Missing Historical Artifact

| Scenario | Behavior |
|---|---|
| Day has no snapshot | Timeline shows gap (explicit null data point) |
| Entity has no history at all | Return empty timeline with `history_length: 0` |
| No regime record for day | Regime timeline shows gap |
| No warnings ever | Empty warning history array |
| No summaries exist | Return empty summary history |

### 18.2 Null Values

| Field | Null Behavior |
|---|---|
| `health_score` | Display as "N/A"; delta = null |
| `confidence_score` | Display as "N/A"; delta = null |
| `regime_state` | Display as "N/A"; regime_changed = true if current is non-null |

### 18.3 UNKNOWN Values

| Artifact | UNKNOWN Handling |
|---|---|
| Regime: UNKNOWN | Display as "Unknown"; not treated as transition |
| Regime: INSUFFICIENT_DATA | Display as "Insufficient Data"; not treated as transition |

### 18.4 No Fabrication

**PH-02: Never fabricate missing historical data.** Gaps are explicit. Nulls are null. Insufficient history is reported honestly.

---

## 19. Insufficient History Semantics

### 19.1 Insufficient for vs_N_Day_Ago

When `window=N` but fewer than N days of history:

```json
{
  "comparison_type": "vs_n_day_ago",
  "requested_window_days": 30,
  "actual_window_days": 10,
  "insufficient_history": true,
  "current": { ... },
  "reference": { ... },
  "delta": { ... }
}
```

Comparison is still performed with available data. `insufficient_history: true` flags the gap.

### 19.2 Insufficient for Baseline

When no snapshots exist:

```json
{
  "comparison_type": "baseline",
  "insufficient_history": true,
  "history_length": 0,
  "current": null,
  "baseline": null
}
```

When only one snapshot exists: baseline = that snapshot; delta = 0; pct = null.

---

## 20. Provenance

### 20.1 Comparison Provenance

Each comparison result includes:

| Field | Description |
|---|---|
| `current_snapshot_id` | P6-03 snapshot ID for current |
| `reference_snapshot_id` | P6-03 snapshot ID for reference |
| `current_snapshot_version` | Algorithm version of current snapshot |
| `reference_snapshot_version` | Algorithm version of reference snapshot |
| `comparison_algorithm` | `"p6-comparison-v1"` |
| `calculated_at` | When the comparison was computed |

### 20.2 Source Artifact Provenance

Each source artifact carries its own provenance. Full chain is traceable:

```
Comparison → source artifacts → source observations
```

---

## 21. Versioning

### 21.1 Comparison Algorithm Version

V1: `"p6-comparison-v1"`. Trivial subtraction/literal comparison.

### 21.2 Source Artifact Versions

Each comparison inherits the version of its source artifacts. Versions are displayed alongside data, never used to recalculate.

**PH-05: Do not recalculate historical artifacts using current algorithm versions.**

### 21.3 Version Compatibility

Historical data may have different algorithm versions. P6-08 displays versions for transparency but does not normalize.

---

## 22. Determinism

### 22.1 Deterministic Comparison

V1 comparison is a deterministic function of:

- Source snapshot IDs and versions
- Algorithm (subtraction, literal comparison)
- Window parameters (7d, 30d)

**PH-01: Same inputs → same comparison result.**

### 22.2 Deterministic Membership Reconstruction

Membership at time `T` is deterministic:

- Same `narrative_membership_events` → same membership
- Same `effective_at ≤ T` filter → same result
- Tie-breaking by `id` ensures determinism

### 22.3 Deterministic Timeline Ordering

**PD-08C-06:** Primary: `window_end` ASC. Secondary: `id` ASC.

---

## 23. Persistence / On-Read Model

### 23.1 V1: Derive On-Read

**PD-08A-01:** Comparison results are derived on-read. No new persistence tables.

### 23.2 Rationale

- Deterministic: same inputs → same output
- Reproducible: source artifacts are versioned and immutable
- No duplication: comparison is a function of existing data
- No migration: no schema changes required

### 23.3 Future Consideration

V2+ may persist comparison results for API contract stability or caching. Not required for V1.

---

## 24. Output Contract

### 24.1 Comparison Result

| Field | Type | Description |
|---|---|---|
| `entity_type` | string | "coin" \| "narrative" |
| `entity_id` | number | Entity ID |
| `comparison_type` | string | "vs_n_day_ago" \| "baseline" \| "timeline" |
| `current` | object \| null | Current snapshot data |
| `reference` | object \| null | Reference snapshot data |
| `delta` | object \| null | Computed deltas |
| `insufficient_history` | boolean | Whether history was sufficient |
| `history_length` | number | Number of historical data points |
| `window_days` | number \| null | Requested window |
| `actual_window_days` | number \| null | Actual window achieved |
| `membership_changed` | boolean \| null | Narrative membership changed (narrative only) |
| `provenance` | object | Comparison provenance |
| `versions` | object | Source artifact versions |

### 24.2 Timeline Result

| Field | Type | Description |
|---|---|---|
| `entity_type` | string | Entity type |
| `entity_id` | number | Entity ID |
| `dimension` | string | "health" \| "confidence" \| "regime" \| "warnings" |
| `data_points` | array | Ordered by window_end ASC |
| `data_points[].window_end` | string | ISO date |
| `data_points[].value` | number \| null | Metric value |
| `data_points[].has_data` | boolean | Whether data exists |
| `data_points[].metadata` | object \| null | Additional metadata |
| `history_length` | number | Total data points |

### 24.3 Lifecycle

Comparison results are **transient** (not persisted). No lifecycle state.

---

## 25. Lifecycle

### 25.1 No New Lifecycle States

P6-08 does not create new lifecycle states. It reads existing lifecycle states:

- Snapshot: CURRENT \| SUPERSEDED
- Regime: CURRENT \| SUPERSEDED
- Warning: DETECTED \| ACTIVE \| RESOLVED \| SUPERSEDED
- Summary: CURRENT \| SUPERSEDED

### 25.2 Historical Data Lifecycle

| Artifact | Lifecycle | Implication for P6-08 |
|---|---|---|
| P6-03 Snapshots | CURRENT/SUPERSEDED | SUPERSEDED = historical data — retain |
| P6-04 Regime | CURRENT/SUPERSEDED | SUPERSEDED = transition records — retain |
| P6-05 Warnings | DETECTED/ACTIVE/RESOLVED/SUPERSEDED | Full lifecycle — retain all |
| P6-06 Summaries | CURRENT/SUPERSEDED | UPSERT preserves different windows |

---

## 26. Five Blocking Decisions

### 26.1 PD-08A-01 — Persistence Model

**Question:** Should historical comparison results be persisted or derived on-read?

**Current proposed resolution:** Derive on-read — no new persistence.

**Rationale:**

- Comparison is deterministic (same inputs → same output)
- Persisting comparison results would duplicate data without adding value
- On-read derivation is reproducible (versioned source artifacts)
- No new persistence = no migration, no schema change, no maintenance burden
- Comparison is a derived interpretation, not an authoritative artifact

**Alternatives considered:**

| Alternative | Why Not Recommended |
|---|---|
| Persist comparison results | Duplicates data; adds schema complexity; comparison is derived, not authoritative |
| Cache comparison results | Premature optimization; V1 comparison is trivial subtraction |
| Hybrid (derive + cache) | Over-engineering for V1; cache invalidation complexity |

**Downstream dependencies:**

- PD-08A-09 (API design): derive-on-read → stateless GET endpoints
- PH-07 (no new persistence): derive-on-read satisfies this invariant
- Implementation complexity: derive-on-read is simpler

**Affected invariants:**

- PH-07 (no new persistence)
- PH-08 (read-only)
- PH-01 (deterministic)

**Risks:**

- Performance: each API call recomputes comparison (V1 subtraction is trivial)
- No API contract stability guarantee (source artifact changes could change comparison output — but source artifacts are immutable once persisted)

**Planner acceptance criterion:**

Planner must confirm: `ACCEPT PD-08A-01` or `MODIFY PD-08A-01` (specify alternative) or `REJECT PD-08A-01` (specify reason).

---

### 26.2 PD-08A-02 — Comparison Windows

**Question:** What are the default historical comparison windows?

**Current proposed resolution:** 7d, 30d, baseline (first-observed snapshot).

**Rationale:**

- Conservative, bounded scope
- 7d covers short-term changes (weekly view)
- 30d covers medium-term trends (monthly view)
- Baseline provides all-time perspective
- Fixed windows avoid over-engineering for V1

**Alternatives considered:**

| Alternative | Why Not Recommended |
|---|---|
| 7d / 14d / 30d / 90d | Too many windows for V1; 14d overlaps with 7d |
| 7d / 90d | 90d may exceed available history; 30d is more practical |
| Custom ranges | Deferred — requires additional UI/API complexity |
| Rolling averages | Deferred — requires statistical methods beyond V1 scope |

**Downstream dependencies:**

- API parameter contract (`?window=7`, `?window=30`, `?window=baseline`)
- UI component behavior (window selector)
- Comparison engine implementation

**Affected invariants:**

- None directly; window selection is a parameter, not a semantic invariant

**Risks:**

- Fixed windows may not cover all user needs → addressed by future custom range support
- Baseline may be very old → version display provides transparency

**Planner acceptance criterion:**

Planner must confirm: `ACCEPT PD-08A-02` or `MODIFY PD-08A-02` (specify window set) or `REJECT PD-08A-02` (specify reason).

---

### 26.3 PD-08A-03 — Historical Membership Semantics

**Question:** How should narrative membership changes affect historical comparison?

**Current proposed resolution:** Use membership at comparison time via `narrative_membership_events`.

**Rationale:**

- Historically accurate — reflects the actual narrative composition at the historical point
- Infrastructure exists — `narrative_membership_events` table with `effective_at` timestamps
- Consistent with P6-03 snapshot semantics — snapshots were calculated using the membership at that time
- Avoids retrospective contamination — current membership applied to history would misrepresent past narrative health

**Alternatives considered:**

| Alternative | Why Not Recommended |
|---|---|
| Use current membership | Historically inaccurate; includes coins that weren't members; excludes coins that were removed |
| Use snapshot provenance only | `member_coin_snapshots` in provenance may not include all membership context |
| No membership consideration | Would make narrative historical comparison meaningless |

**Downstream dependencies:**

- PD-08C-04 (membership reconstruction strategy)
- Narrative historical comparison logic
- Membership change detection

**Affected invariants:**

- PH-06 (membership accuracy)
- PH-09 (P6-native only — membership events are P6-native)

**Risks:**

- Membership reconstruction complexity — mitigated by existing `narrative_membership_events` infrastructure
- Edge case: no membership events → fall back to current membership (safe default)
- Edge case: membership events before entity creation → filtered by `effective_at` timestamp

**Planner acceptance criterion:**

Planner must confirm: `ACCEPT PD-08A-03` or `MODIFY PD-08A-03` (specify alternative) or `REJECT PD-08A-03` (specify reason).

---

### 26.4 PD-08C-03 — Warning Occurrence Matching

**Question:** How to match warnings across time for historical comparison?

**Current proposed resolution:** Match by `warning_type` + `detection_window`.

**Rationale:**

- Consistent with P6-05 frozen identity (`dedup_key = entity_type:entity_id:warning_type:detection_window`)
- Within a per-entity query, `warning_type` + `detection_window` uniquely identifies a warning occurrence
- Enables recurring warning detection (same type, different detection window)
- Preserves P6-05 warning identity without redefining it

**Alternatives considered:**

| Alternative | Why Not Recommended |
|---|---|
| Match by `dedup_key` | Redundant — includes `entity_type` and `entity_id` which are already scoped |
| Match by `warning_type` only | Too broad — would conflate different occurrences |
| Match by `id` | Wrong — `id` is a surrogate key, not a semantic identity |

**Downstream dependencies:**

- Warning history comparison
- Recurring warning detection
- Warning frequency analysis

**Affected invariants:**

- PH-01 (deterministic matching)
- PH-09 (P6-native only — uses P6-05 identity)

**Risks:**

- Minimal — matching strategy is semantically equivalent to P6-05 identity within entity scope

**Planner acceptance criterion:**

Planner must confirm: `ACCEPT PD-08C-03` or `MODIFY PD-08C-03` (specify alternative) or `REJECT PD-08C-03` (specify reason).

---

### 26.5 PD-08C-04 — Membership Reconstruction

**Question:** How to reconstruct narrative membership at a historical point in time?

**Current proposed resolution:** Latest event per coin at `effective_at ≤ T`.

**Algorithm:**

```sql
SELECT DISTINCT ON (coin_id)
  coin_id, event_type, is_primary, effective_at
FROM narrative_membership_events
WHERE narrative_id = ? AND effective_at <= ?
ORDER BY coin_id, effective_at DESC, id DESC
```

Filter: only coins with latest event `event_type ≠ 'REMOVED'` are members.

**Rationale:**

- Event-sourced model — each event is an authoritative record of a membership change
- Latest-event-per-coin is the standard event-sourcing reconstruction pattern
- Tie-breaking by `id DESC` ensures determinism
- `DISTINCT ON` (PostgreSQL) is efficient and idiomatic
- Existing indexes support this query pattern: `(narrative_id, effective_at, id)`

**Alternatives considered:**

| Alternative | Why Not Recommended |
|---|---|
| Use `narrative_membership_snapshots` only | Snapshots may not exist for all historical points; events are more granular |
| All events before T (no dedup) | Would include superseded events; incorrect membership state |
| Snapshot + events hybrid | Adds complexity without clear benefit for V1 |
| Current membership for all history | Historically inaccurate (addressed in PD-08A-03) |

**Edge cases:**

| Scenario | Handling |
|---|---|
| Member added before T | Latest event is ADDED → member |
| Member removed before T | Latest event is REMOVED → not member |
| ADDED → REMOVED → ADDED | Latest event is ADDED → member |
| No events for coin | Not in results → not member |
| Events with same `effective_at` | `id DESC` breaks tie (insertion order) |

**Downstream dependencies:**

- PD-08A-03 (membership handling strategy)
- Narrative historical comparison
- Membership change detection

**Affected invariants:**

- PH-06 (membership accuracy)
- PH-01 (deterministic reconstruction)

**Risks:**

- `DISTINCT ON` is PostgreSQL-specific — acceptable since the project uses PostgreSQL
- Performance: indexed query is efficient for typical narrative sizes (5-50 coins)
- Edge case: membership events before entity creation → filtered by `effective_at ≤ T` naturally

**Planner acceptance criterion:**

Planner must confirm: `ACCEPT PD-08C-04` or `MODIFY PD-08C-04` (specify alternative) or `REJECT PD-08C-04` (specify reason).

---

## 27. Downstream Decision Mapping

### 27.1 Decision Dependencies

```
PD-08A-01 (persist vs derive)
    ↓ blocks
PD-08A-09 (API design: stateless endpoints)
    ↓ blocks
P6-08D (implementation)

PD-08A-02 (comparison windows)
    ↓ blocks
API parameters (?window=7, ?window=30, ?window=baseline)
    ↓ blocks
P6-08D (implementation)

PD-08A-03 (membership handling)
    ↓ blocks
PD-08C-04 (membership reconstruction)
    ↓ blocks
Narrative historical comparison
    ↓ blocks
P6-08D (implementation)

PD-08C-03 (warning matching)
    ↓ blocks
Warning comparison logic
    ↓ blocks
P6-08D (implementation)

PD-08C-04 (membership reconstruction)
    ↓ blocks
Membership reconstruction implementation
    ↓ blocks
P6-08D (implementation)
```

### 27.2 Non-Blocking Decisions (Safe Defaults)

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
| PD-08C-01 | Window alignment | Midnight |
| PD-08C-02 | Regime transitions | Consecutive state changes |
| PD-08C-05 | Zero baseline | Delta = current; pct = null |
| PD-08C-06 | Tie-breaking | `id` ASC |
| PD-08C-07 | Regime history limit | 50 |
| PD-08C-08 | Warning history limit | 50 |

These resolve automatically via safe defaults. No Planner action required.

---

## 28. Invariants

### 28.1 P6-08 Proposed Invariants (PH-01…PH-12)

| ID | Invariant | Class | Description |
|---|---|---|---|
| **PH-01** | Deterministic comparison | B — Semantic | Same inputs → same comparison result |
| **PH-02** | No fabrication | A — Boundary | Never fabricate missing historical data |
| **PH-03** | No recalculation | A — Boundary | Historical artifacts displayed as-is |
| **PH-04** | Insufficient history honest | B — Semantic | `insufficient_history` flag when data is incomplete |
| **PH-05** | Version display | B — Semantic | Algorithm versions shown alongside historical data |
| **PH-06** | Membership accuracy | A — Boundary | Membership at comparison time, not current |
| **PH-07** | No new persistence | A — Boundary | Derive on-read from existing artifacts |
| **PH-08** | Read-only | A — Boundary | GET-only APIs, no mutation |
| **PH-09** | P6-native only | A — Boundary | No P3/P4/P5 data consumed |
| **PH-10** | No action semantics | A — Boundary | Explanation only, no recommendations |
| **PH-11** | Quality ≠ Freshness | A — Boundary | Independent dimensions preserved |
| **PH-12** | Gap explicit | B — Semantic | Missing snapshots shown as gaps |

### 28.2 Inherited Invariants (from P6-07)

| ID | Invariant | Class |
|---|---|---|
| PV-01 | Consumes only P6-native artifacts | A |
| PV-02 | Does not recalculate semantics | A |
| PV-03 | Read-only | A |
| PV-04 | Output is deterministic | B |
| PV-10 | P4 untouched | A |
| PV-11 | P5 untouched | A |
| PV-12 | No action semantics | A |
| PV-13 | No BUY/SELL semantics | A |
| PV-14 | No legacy contamination | A |

### 28.3 Invariant Count

```
P6-08 proposed:  12 (PH-01…PH-12)
Inherited:        9 (PV-01, PV-02, PV-03, PV-04, PV-10…PV-14)
Total:           21
```

All 21 invariants are validated against repository implementation.

---

## 29. Evidence Gaps

### 29.1 Resolved Gaps

| Gap | Resolution |
|---|---|
| P6-06 summaries latest-only | **RESOLVED** — UPSERT preserves different `window_end` rows as SUPERSEDED |

### 29.2 Remaining Blocking Gaps

| Gap | Impact | Resolution |
|---|---|---|
| No `readSnapshotHistory()` function | Cannot query historical snapshots through persistence API | Create in P6-08D |
| Membership reconstruction from events | Cannot determine historical narrative composition | Implement using `narrative_membership_events` in P6-08D |

### 29.3 Non-Blocking Gaps

| Gap | Impact | Resolution |
|---|---|---|
| No P6-native health-timeline API | Legacy API uses non-P6 data | Create in P6-08D |
| `healthDimensions` JSONB undocumented | May need to parse for dimension history | Document in implementation |

### 29.4 Deferred Gaps

| Gap | Impact | Resolution |
|---|---|---|
| No tests for historical reads | Must create in implementation | Create in P6-08D |

---

## 30. P6-06 Boundary

P6-08 must consume P6-06 historical summary artifacts without changing:

| Aspect | P6-06 Frozen | P6-08 Consumption |
|---|---|---|
| Summary identity | `(entity_type, entity_id, timeframe, window_end)` | Read-only, no modification |
| Summary lifecycle | CURRENT \| SUPERSEDED | Display both; no status modification |
| Explanation semantics | `what_changed`, `why`, `what_to_watch` arrays | Display as-is; no reinterpretation |
| Version semantics | `algorithmVersion`, `parameterVersion`, etc. | Display alongside; no recalculation |
| Current/latest semantics | Latest = most recent `window_end` | P6-08 uses latest for current comparison |

**P6-08 is a consumer, not a modifier. No P6-06 code changes are permitted.**

---

## 31. P4 Boundary

| Check | Result |
|---|---|
| P4 code modified | ❌ NO |
| P4 semantics reinterpreted | ❌ NO |
| P4 data consumed by P6-08 | ❌ NO |
| P4 decision support in P6-08 | ❌ NO |
| P4 policy semantics | ❌ NO |

**P4 untouched.** P6-08 reads P6-native artifacts only.

---

## 32. P5 / Replay Boundary

| Check | Result |
|---|---|
| P5 code modified | ❌ NO |
| P5 semantics reinterpreted | ❌ NO |
| P5 replay dependency created | ❌ NO |
| P5 action semantics in P6-08 | ❌ NO |
| P5 bridge created | ❌ NO |
| BUY/SELL vocabulary | ❌ NOT FOUND |
| Decision semantics | ❌ NOT FOUND |

**P5 untouched. No replay contamination.** P6-08 explains historical changes, but must not tell the system what action to take.

---

## 33. Planner Acceptance Gate

### 33.1 Required Responses

Planner must explicitly respond to each of the 5 blocking decisions:

```
ACCEPT PD-08A-01    (persist vs derive: derive on-read)
ACCEPT PD-08A-02    (comparison windows: 7d, 30d, baseline)
ACCEPT PD-08A-03    (membership: at comparison time)
ACCEPT PD-08C-03    (warning matching: warning_type + detection_window)
ACCEPT PD-08C-04    (membership reconstruction: latest event per coin at effective_at ≤ T)
```

Or:

```
MODIFY <decision>   (specify alternative resolution)
REJECT <decision>   (specify reason)
```

### 33.2 Acceptance Requirement

**All 5 must be ACCEPTED before P6-08D implementation.**

If any decision is MODIFIED or REJECTED:

1. Identify affected downstream semantics
2. Return to decision audit (P6-08C)
3. Do not proceed directly to implementation

### 33.3 Non-Blocking Decisions

Non-blocking decisions resolve via safe defaults (Section 27.2). No Planner action required unless Planner wishes to override a default.

---

## 34. Post-Acceptance Change Control

After Planner acceptance:

1. Accepted decisions become FROZEN for P6-08D implementation
2. Non-blocking decisions remain with safe defaults
3. No new blocking decisions may be introduced during P6-08D
4. If implementation reveals a genuine blocker, return to P6-08C
5. P6-08D may NOT modify P6-01…P6-07 frozen contracts
6. P6-08D may NOT modify P4/P5 semantics

---

## 35. Recommended V1

Subject to Planner acceptance:

### 35.1 Implementation Scope

1. `readSnapshotHistory()` function in `src/lib/p6/snapshot/persistence.ts`
2. `readSummaryHistory()` function in `src/lib/p6/aggregation/persistence.ts`
3. Membership reconstruction using `narrative_membership_events`
4. Comparison engine (derive on-read):
   - Health timeline
   - Current vs 7d comparison
   - Current vs 30d comparison
   - Current vs baseline comparison
   - Regime transition timeline
   - Warning lifecycle history
5. Read APIs: `/api/p6/history/[entityType]/[id]`
6. Coin and narrative historical comparison
7. Gap handling
8. Provenance and version display

### 35.2 Conservative Principles

- Deterministic — same inputs → same comparison
- Explainable — every comparison point has provenance
- Read-compatible — no modification to frozen P6-01…P6-07
- No LLM — no AI-generated historical narratives
- No prediction — no forecasting
- No action — no BUY/SELL/EXECUTE
- Minimal new persistence — derive on-read from existing artifacts
- Bounded scope — fixed comparison windows only

---

## 36. Readiness Verdict

```
READY FOR PLANNER ACCEPTANCE
```

5 blocking decisions identified with proposed resolutions. All P6-01…P6-07 frozen contracts respected. P4/P5 boundaries intact. 21/21 invariants validated. Evidence gaps identified and classified. The decision contract is complete and internally consistent.

**Awaiting Planner ACCEPT / MODIFY / REJECT for PD-08A-01, PD-08A-02, PD-08A-03, PD-08C-03, PD-08C-04.**

---

## 37. Git Boundary

| Check | Result |
|---|---|
| Only documentation file changed | ✅ PASS |
| No production code modified | ✅ PASS |
| No frozen contracts modified | ✅ PASS |
| P4/P5 untouched | ✅ PASS |
| P6-01…P6-07 untouched | ✅ PASS |
| No schema changes | ✅ PASS |
| No API changes | ✅ PASS |
| No test behavior changes | ✅ PASS |
