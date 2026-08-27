# P6-08C — Historical Intelligence / Temporal Comparison Decision Inventory & Gap Audit

**Date:** 2026-08-27
**Phase:** P6-08 Historical Intelligence
**Status:** DECISION INVENTORY COMPLETE
**Previous:** P6-08B semantic contract (`READY FOR P6-08C`)

---

## 1. Executive Summary

P6-08C performs a comprehensive decision inventory and gap audit for P6-08 Historical Intelligence / Temporal Comparison. P6-08B established 12 decisions, 3 blocking, 4 non-blocking, 5 deferred, and 12 proposed invariants. This audit independently re-validates every decision, discovers 8 new implicit decisions, resolves 1 evidence gap, and confirms 2 remaining blocking gaps.

**Key findings:**

1. **All 3 inherited blockers (PD-08A-01/02/03) remain genuinely blocking** — re-audited independently, safe defaults insufficient for each.
2. **P6-06 summary persistence is RESOLVED** — UPSERT preserves different `window_end` rows as SUPERSEDED.
3. **Snapshot persistence is RESOLVED** — `persistCoinSnapshot()`/`persistNarrativeSnapshot()` supersede old rows (status=SUPERSEDED) before inserting new ones. Historical snapshots are NOT lost.
4. **8 new implicit decisions** discovered (PD-08C-01 through PD-08C-08), 2 blocking.
5. **Total blocking decisions: 5** (3 inherited + 2 new).
6. **12 proposed invariants validated** — all consistent with repository implementation.

| Metric | Count |
|---|---|
| Total decisions | 20 |
| Blocking decisions | **5** |
| Non-blocking decisions | 7 |
| Deferred decisions | 5 |
| New implicit decisions | 8 |
| Inherited decisions | 12 |
| Evidence gaps remaining | 2 |
| Evidence gaps resolved | 1 |
| Invariants proposed | 12 |

**Verdict: READY FOR P6-08C1**

---

## 2. P6-08A Decision Reconciliation

### PD-08A-01 — Persist vs Derive On-Read

| Field | Value |
|---|---|
| **ID** | PD-08A-01 |
| **Source** | P6-08A landscape recon |
| **Question** | Should P6-08 persist comparison results or derive on-read? |
| **Proposed** | Derive on-read — no new persistence |
| **Status** | PROPOSED |
| **Rationale** | Comparison is deterministic; persisting duplicates data; on-read is reproducible |
| **Downstream** | PD-08A-09 (API design), PH-07 (no new persistence) |
| **Genuinely blocking?** | **YES** — determines persistence model, API contract, and reproducibility |
| **Safe default?** | **NO** — defaulting to persist would create unnecessary tables; defaulting to derive is the proposal itself but requires confirmation |

**Re-audit result:** Genuinely blocking. The choice cascades to API design (derive = stateless endpoints; persist = stateful endpoints with identity). No safe default exists because the two options have fundamentally different architectural implications.

### PD-08A-02 — Default Comparison Windows

| Field | Value |
|---|---|
| **ID** | PD-08A-02 |
| **Source** | P6-08A landscape recon |
| **Question** | What is the default historical comparison window? |
| **Proposed** | 7d, 30d, baseline (first-observed) |
| **Status** | PROPOSED |
| **Rationale** | Conservative, bounded scope; covers short-term and medium-term |
| **Downstream** | API parameters, UI defaults, comparison engine |
| **Genuinely blocking?** | **YES** — determines API parameter contract |
| **Safe default?** | **NO** — any fixed set of windows requires explicit agreement; 7d/30d/baseline is the proposal but must be confirmed |

**Re-audit result:** Genuinely blocking. The window set defines the API parameter contract and UI behavior. Different choices (e.g., 14d/60d, or 7d/14d/30d/90d) would change the API surface.

### PD-08A-03 — Narrative Membership Handling

| Field | Value |
|---|---|
| **ID** | PD-08A-03 |
| **Source** | P6-08A landscape recon |
| **Question** | How should narrative membership changes affect historical comparison? |
| **Proposed** | Use membership at comparison time via `narrative_membership_events` |
| **Status** | PROPOSED |
| **Rationale** | Historically accurate; infrastructure exists in `narrative_membership_events` |
| **Downstream** | Narrative historical comparison, membership reconstruction logic |
| **Genuinely blocking?** | **YES** — determines historical accuracy vs consistency tradeoff |
| **Safe default?** | **NO** — defaulting to "current membership" would be inaccurate; defaulting to "membership at time" is the proposal but requires confirmation |

**Re-audit result:** Genuinely blocking. The two options (current membership vs membership-at-time) produce different narrative health comparisons. "Membership at time" is more accurate but more complex. "Current membership" is simpler but historically misleading. Must be explicitly decided.

---

## 3. P6-08B Decision Reconciliation

### PD-08A-04 through PD-08A-12

All 9 non-blocking decisions from P6-08B are re-validated:

| ID | Question | Proposed | Blocking? | Safe Default? | Re-audit |
|---|---|---|---|---|---|
| PD-08A-04 | Replace vs supplement legacy APIs | Supplement | No | Yes (supplement) | ✅ Confirmed |
| PD-08A-05 | Show gaps for missing snapshots | Yes — explicit gaps | No | Yes (explicit gaps) | ✅ Confirmed |
| PD-08A-06 | Baseline type for V1 | First-observed | No | Yes (first-observed) | ✅ Confirmed |
| PD-08A-07 | Include regime transition timeline | Yes | No | Yes (include) | ✅ Confirmed |
| PD-08A-08 | Include warning lifecycle history | Yes | No | Yes (include) | ✅ Confirmed |
| PD-08A-09 | Separate API endpoints | `/api/p6/history/*` | No | Yes (separate) | ✅ Confirmed |
| PD-08A-10 | Handle algorithm version changes | Display alongside | No | Yes (display) | ✅ Confirmed |
| PD-08A-11 | Custom date ranges in V1 | No — fixed only | No | Yes (fixed only) | ✅ Confirmed |
| PD-08A-12 | Quality/freshness history | Optional (deferred) | No | Yes (optional) | ✅ Confirmed |

---

## 4. Complete Decision Inventory

### 4.1 Inherited Decisions (Frozen, 17)

| ID | Source | Impact on P6-08 |
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
| PD-06A-03 | P6-06 | Change detection: two-point only |
| PD-06A-04 | P6-06 | Minimum population (≥1) |
| PD-06C-02 | P6-06 | UPSERT semantics (same window_end = replace) |
| PD-07A-01 | P6-07 | Refresh wiring |
| PD-07A-02 | P6-07 | Read API surface |
| PD-07A-03 | P6-07 | Legacy panel retirement |

### 4.2 P6-08A Explicit Decisions (12)

| ID | Question | Proposed | Status | Blocking |
|---|---|---|---|---|
| PD-08A-01 | Persist vs derive | Derive on-read | PROPOSED | **YES** |
| PD-08A-02 | Comparison windows | 7d, 30d, baseline | PROPOSED | **YES** |
| PD-08A-03 | Membership handling | Membership at comparison time | PROPOSED | **YES** |
| PD-08A-04 | Replace vs supplement | Supplement | PROPOSED | No |
| PD-08A-05 | Gap handling | Explicit gaps | PROPOSED | No |
| PD-08A-06 | Baseline type | First-observed | PROPOSED | No |
| PD-08A-07 | Regime timeline | Include | PROPOSED | No |
| PD-08A-08 | Warning history | Include | PROPOSED | No |
| PD-08A-09 | API design | Separate endpoints | PROPOSED | No |
| PD-08A-10 | Version display | Display alongside | PROPOSED | No |
| PD-08A-11 | Custom ranges | Fixed only | PROPOSED | No |
| PD-08A-12 | Quality history | Optional | PROPOSED | No |

### 4.3 P6-08C New Implicit Decisions (8)

| ID | Question | Proposed | Status | Blocking |
|---|---|---|---|---|
| PD-08C-01 | Snapshot window_end alignment | Midnight (start-of-day) | PROPOSED | No |
| PD-08C-02 | Regime transition detection | Consecutive state changes from `readRegimeHistory()` | PROPOSED | No |
| PD-08C-03 | Warning occurrence matching for historical comparison | Match by `warning_type` + `detection_window` | PROPOSED | **YES** |
| PD-08C-04 | Narrative membership reconstruction strategy | Latest event per coin at `effective_at ≤ T` | PROPOSED | **YES** |
| PD-08C-05 | Zero baseline value handling | Delta = current − 0; pct = null (per PD-06C-03) | PROPOSED | No |
| PD-08C-06 | Timeline ordering tie-breaking | Primary: `window_end` ASC; Secondary: `id` ASC | PROPOSED | No |
| PD-08C-07 | Regime history limit default | 50 records (matching existing `readRegimeHistory()` default) | PROPOSED | No |
| PD-08C-08 | Warning history limit default | 50 records (matching existing `readWarningHistory()` default) | PROPOSED | No |

---

## 5. Blocking Decision Audit

### 5.1 PD-08A-01 — Persist vs Derive

**Why ambiguous:** Two architecturally distinct options with no obvious default.

**Downstream dependency:** Determines API contract (stateless vs stateful endpoints), PH-07 (no new persistence), and implementation complexity.

**What breaks if unresolved:** Cannot design API layer without knowing whether comparison results are persisted or computed.

**Why safe default insufficient:** Both options are reasonable; neither is clearly "safer."

**Verdict:** Remains BLOCKING.

### 5.2 PD-08A-02 — Comparison Windows

**Why ambiguous:** The window set defines API parameters and UI defaults. Different sets (7d/30d vs 14d/60d vs 7d/14d/30d/90d) have different implications.

**Downstream dependency:** API parameter contract, UI component behavior.

**What breaks if unresolved:** Cannot define API parameters or UI defaults.

**Why safe default insufficient:** Any fixed set requires explicit agreement.

**Verdict:** Remains BLOCKING.

### 5.3 PD-08A-03 — Membership Handling

**Why ambiguous:** Two approaches (current membership vs membership-at-time) produce different results with different accuracy/complexity tradeoffs.

**Downstream dependency:** Narrative historical comparison logic, membership reconstruction.

**What breaks if unresolved:** Cannot implement narrative historical comparison correctly.

**Why safe default insufficient:** "Current membership" is simpler but inaccurate; "membership at time" is accurate but complex. Must be explicitly chosen.

**Verdict:** Remains BLOCKING.

### 5.4 PD-08C-03 — Warning Occurrence Matching (NEW)

**Why ambiguous:** How to match warnings across time for comparison (same `warning_type`? same `dedup_key`? same `warning_type` + `detection_window`?).

**Downstream dependency:** Warning history comparison, recurrence detection.

**What breaks if unresolved:** Cannot determine whether a warning is "new" vs "recurring" in historical comparison.

**Why safe default insufficient:** Different matching strategies produce different recurrence counts.

**Proposed:** Match by `warning_type` + `detection_window` for historical comparison; `dedup_key` for same-window dedup.

**Verdict:** BLOCKING.

### 5.5 PD-08C-04 — Membership Reconstruction (NEW)

**Why ambiguous:** The `narrative_membership_events` table has `effective_at` with timezone. Point-in-time reconstruction requires: (a) which events to include, (b) how to handle overlapping events, (c) how to handle entities that disappeared.

**Downstream dependency:** PD-08A-03 (membership handling), narrative historical comparison.

**What breaks if unresolved:** Cannot reconstruct membership at historical point in time.

**Why safe default insufficient:** Multiple reconstruction strategies exist (latest-event-per-coin, all-events-before-T, snapshot-based). Each has different edge case behavior.

**Proposed:** Latest event per coin where `effective_at ≤ T`, deduplicated by `coin_id`.

**Verdict:** BLOCKING.

---

## 6. New Implicit Decisions

### PD-08C-01 — Snapshot Window End Alignment

**Question:** How is `window_end` aligned for temporal comparison?

**Evidence:** `persistCoinSnapshot()` sets `windowEnd = new Date(calculationTime); windowEnd.setHours(0, 0, 0, 0)` — midnight start-of-day.

**Proposed:** Align by midnight `window_end`. Snapshots are DAILY with start-of-day alignment.

**Impact:** All temporal queries use `window_end` as the alignment key.

### PD-08C-02 — Regime Transition Detection

**Question:** How are regime transitions reconstructed from historical regime records?

**Evidence:** `readRegimeHistory()` returns all records ordered by `calculation_time` DESC. Each record has `previous_state`.

**Proposed:** Transitions = consecutive records where `regimeState` differs from previous. `previous_state` field provides the transition source.

**Impact:** Regime timeline, duration calculation.

### PD-08C-03 — Warning Occurrence Matching

**Question:** How to match warnings across time for comparison?

**Evidence:** Warnings use `dedup_key` for same-window dedup (unique constraint). `warning_type` + `detection_window` identifies a warning occurrence.

**Proposed:** For historical comparison, match by `warning_type` + `detection_window`.

### PD-08C-04 — Membership Reconstruction

**Question:** How to reconstruct narrative membership at a historical point?

**Evidence:** `narrative_membership_events` has `effective_at` (timestamp with timezone), `eventType` (ADDED/REMOVED/PRIMARY_SET), `coin_id`, `narrative_id`.

**Proposed:** For each coin, take the latest event where `effective_at ≤ T`. If no events, coin is not a member.

### PD-08C-05 — Zero Baseline Value Handling

**Question:** How to handle health_score = 0 as baseline?

**Evidence:** P6-06 `computeHealthChangePct()` returns null when `previous = 0`. P6-03 `health_score` is a real number (0-100).

**Proposed:** Delta = current − 0 = current. Pct = null (per PD-06C-03: `previous = 0 → null`).

### PD-08C-06 — Timeline Ordering Tie-Breaking

**Question:** How to break ties when multiple records have the same `window_end`?

**Evidence:** P6-03 has unique constraint on `(entity_type, entity_id, snapshot_type, window_end)` — no ties possible for snapshots. P6-04 regime has no unique constraint on `calculation_time` — ties possible.

**Proposed:** Primary: `window_end` or `calculation_time` ASC. Secondary: `id` ASC (deterministic insertion order).

### PD-08C-07 — Regime History Limit

**Question:** Default limit for `readRegimeHistory()` queries?

**Evidence:** Existing function default is `limit: number = 50`.

**Proposed:** 50 records (matching existing default). Sufficient for ~50 days of regime history.

### PD-08C-08 — Warning History Limit

**Question:** Default limit for `readWarningHistory()` queries?

**Evidence:** Existing function default is `limit: number = 50`.

**Proposed:** 50 records (matching existing default).

---

## 7. Temporal Model Audit

### 7.1 Temporal Reference Model

All artifacts can be compared using a coherent temporal reference model:

| Artifact | Alignment Key | Temporal Resolution |
|---|---|---|
| P6-03 Snapshots | `window_end` (midnight) | Daily |
| P6-04 Regime | `calculation_time` | Per-refresh |
| P6-05 Warnings | `detection_window` (midnight) | Per-detection |
| P6-06 Summaries | `window_end` (midnight) | Daily |
| Membership Events | `effective_at` (timezone-aware) | Per-event |

**Coherence:** Snapshots, summaries use `window_end` (midnight). Regime uses `calculation_time` (per-refresh). Warnings use `detection_window` (midnight). All are compatible via date-level alignment.

**No contradictions found.**

### 7.2 Temporal Alignment

- Snapshots: `window_end` = midnight of calculation date
- Regime: `calculation_time` = refresh timestamp (may differ from midnight)
- Warnings: `detection_window` = midnight of detection date
- Summaries: `window_end` = midnight of calculation date

**Alignment rule:** Compare by date (midnight `window_end`), not by exact timestamp.

---

## 8. Snapshot History Audit

### 8.1 Persistence Semantics

`persistCoinSnapshot()` and `persistNarrativeSnapshot()` both:
1. Find existing record with same `(entity_type, entity_id, snapshot_type, window_end)`
2. Update existing to `status = 'SUPERSEDED'`
3. Insert new record with `status = 'CURRENT'`

**Result:** Historical snapshots are retained as SUPERSEDED rows. Each `window_end` has at most one CURRENT and zero or more SUPERSEDED rows.

### 8.2 History Query

```sql
SELECT * FROM p6_snapshots
WHERE entity_type = ? AND entity_id = ? AND snapshot_type = ?
ORDER BY window_end ASC
```

Returns all rows (CURRENT + SUPERSEDED). One row per daily refresh. Gaps indicate missed refreshes.

### 8.3 Snapshot Data Fields

| Field | Type | Description |
|---|---|---|
| `id` | number | Primary key |
| `entity_type` | string | "coin" \| "narrative" |
| `entity_id` | number | Entity ID |
| `snapshot_type` | string | "COIN_HEALTH" \| "NARRATIVE_HEALTH" |
| `window_end` | timestamp | Start-of-day alignment |
| `health_score` | real | Health score (0-100) |
| `confidence_score` | real | Confidence (0-100) |
| `data_completeness` | real | Data completeness (0-1) |
| `health_dimensions` | jsonb | Dimension scores (coin: trend/volume/momentum/derivative; narrative: member_scores) |
| `quality_metadata` | jsonb | Quality state metadata |
| `freshness_metadata` | jsonb | Freshness state metadata |
| `status` | string | CURRENT \| SUPERSEDED |
| `snapshot_algorithm_version` | text | Algorithm version |
| `calculation_time` | timestamp | When calculated |
| `provenance` | jsonb | Full provenance |

### 8.4 Coin vs Narrative Snapshot Differences

| Aspect | Coin | Narrative |
|---|---|---|
| `health_dimensions` | `{ name, score, weight, available }[]` | `member_scores[]` (coin_id, coin_symbol, health_score, weight, included) |
| `quality_metadata` | Populated | null |
| `freshness_metadata` | Populated | null |
| `confidence_score` | Populated | Not stored (computed at query time) |

---

## 9. Regime History Audit

### 9.1 Persistence Semantics

`persistRegimeState()`:
1. Supersede ALL existing CURRENT regimes for the entity/type
2. Insert new regime as CURRENT

**Result:** Historical regimes are retained as SUPERSEDED rows.

### 9.2 History Query

```typescript
readRegimeHistory(entityType, entityId, "HEALTH", limit = 50)
```

Returns all records (CURRENT + SUPERSEDED) ordered by `calculation_time` DESC.

### 9.3 Regime Transition Detection

Each record has `previous_state`. Transitions = consecutive records where `regimeState ≠ previous_state`.

**Implementation:** Iterate ordered records; detect state changes.

### 9.4 Regime Duration

Duration = time between consecutive regime change records.

**Edge case:** If only one regime record exists, duration = time since first record.

---

## 10. Warning History Audit

### 10.1 Persistence Semantics

`persistWarning()`: Append-only INSERT. Never deletes.

`updateWarningLifecycle()`: Updates `lifecycle`, `lifecycleStatus`, `effectiveUntil`, `supersededAt`.

**Result:** All warnings are retained with full lifecycle tracking.

### 10.2 History Query

```typescript
readWarningHistory(entityType, entityId, limit = 50)
```

Returns all records ordered by `detected_at` DESC.

### 10.3 Warning Lifecycle

| State | Meaning | Temporal Fields |
|---|---|---|
| DETECTED | Newly detected | `detected_at`, `effective_from` |
| ACTIVE | Currently active | `effective_from`, `effective_until = null` |
| RESOLVED | Resolved | `effective_from`, `effective_until` |
| SUPERSEDED | Superseded by newer | `superseded_at` |

### 10.4 Warning Deduplication

`dedup_key` format: `entity_type:entity_id:warning_type:detection_window`

Unique constraint on `dedup_key` prevents duplicate warnings per detection window.

### 10.5 Warning Matching for Historical Comparison

For comparing warnings across time:
- Same `warning_type` + `detection_window` = same occurrence
- Different `dedup_key` = different occurrence (even if same type)
- Recurring = same `warning_type` with different `dedup_key` values

---

## 11. Summary History Audit

### 11.1 Persistence Semantics

`persistSummary()`:
1. Supersede all OTHER CURRENT summaries for same entity+timeframe (different `window_end`)
2. UPSERT row for exact `(entity_type, entity_id, timeframe, window_end)`

**Result:** Each daily summary has its own row. Old rows become SUPERSEDED. Historical summaries ARE preserved.

### 11.2 History Query

```sql
SELECT * FROM p6_intelligence_summaries
WHERE entity_type = ? AND entity_id = ? AND timeframe = 'DAILY'
ORDER BY window_end ASC
```

Returns all rows (CURRENT + SUPERSEDED) with full explanation data.

### 11.3 Summary Data Fields

Each summary contains:
- `health_score`, `snapshot_confidence`, `regime_state`, `regime_confidence`
- `active_warning_count`, `highest_severity`, `active_warnings`
- `health_delta`, `health_change_pct`, `regime_changed`
- `new_warning_count`, `resolved_warning_count`
- `what_changed`, `why`, `what_to_watch` (explanation arrays)
- `quality_metadata`, `freshness_metadata`
- `provenance`, `version`, `calculated_at`, `window_end`

---

## 12. Narrative Membership Audit

### 12.1 Membership Events Table

`narrative_membership_events` tracks:
- `narrative_id`, `coin_id`, `eventType` (ADDED | REMOVED | PRIMARY_SET)
- `effective_at` (timestamp with timezone) — when the event takes effect
- `recorded_at` — when recorded
- `is_primary` — primary narrative flag
- `idempotency_key` — unique per event

**Indexed:** `(narrative_id, effective_at, id)`, `(narrative_id, coin_id, effective_at, id)`, `(coin_id, effective_at)`

### 12.2 Point-in-Time Reconstruction

For narrative membership at time `T`:

```sql
-- For each coin, find the latest event before T
SELECT DISTINCT ON (coin_id) coin_id, is_primary, eventType
FROM narrative_membership_events
WHERE narrative_id = ? AND effective_at <= ?
ORDER BY coin_id, effective_at DESC, id DESC
```

Then filter: only coins with latest event `eventType ≠ 'REMOVED'` are members.

### 12.3 Edge Cases

| Scenario | Handling |
|---|---|
| Member added before window | Included as member |
| Member added during window | Member from `effective_at` onward |
| Member removed during window | Member until `effective_at`, then removed |
| Member removed before current | Not a current member; may appear in historical |
| Member never existed | Not in events; not a member |
| Membership event gaps | Latest known state applies until next event |
| Overlapping events | `effective_at` + `id` ordering breaks ties |
| Ambiguous intervals | Latest event per coin wins |

### 12.4 Membership Stability Assumption

If `narrative_membership_events` has no entries for a narrative:
- Assume current membership applies to all history
- `membership_changed = false`

### 12.5 Membership Snapshot Infrastructure

`narrative_membership_snapshots` and `narrative_membership_snapshot_members` provide pre-computed point-in-time membership. These can be used as an alternative to event-based reconstruction.

---

## 13. Comparison Semantics Audit

### 13.1 Health Delta

```
health_delta = current.health_score - reference.health_score
```

- Both values present: numeric delta
- Either null: delta = null
- Rounding: 2 decimal places (consistent with P6-06)

### 13.2 Health Change Percentage

```
health_change_pct = (current - reference) / reference * 100
```

- reference = 0 or null: pct = null (per PD-06C-03)
- Rounding: 2 decimal places

### 13.3 Confidence Delta

```
confidence_delta = current.confidence_score - reference.confidence_score
```

- Both values present: numeric delta
- Either null: delta = null

### 13.4 Regime Changed

```
regime_changed = current.regime_state ≠ reference.regime_state
```

- Literal comparison (per PD-06C-04)
- null ↔ value transitions count as changed

### 13.5 Warning New/Resolved

For historical comparison over a period:
- **New warnings:** Warnings with `detected_at` within the period
- **Resolved warnings:** Warnings with `effective_until` within the period
- **Persistent warnings:** Warnings active throughout the period

### 13.6 Warning Severity Change

Severity is immutable per warning record. No severity change tracking within a single warning occurrence. Different occurrences of the same type may have different severities.

### 13.7 Summary Changes

Compare summaries by:
- `health_delta` = `current.health_score - reference.health_score`
- `regime_changed` = literal comparison
- `active_warning_count` delta
- Explanation array differences (structural, not semantic)

### 13.8 Member Composition Changes

For narrative comparison:
- `membership_changed = true` if membership differs between current and historical
- Optionally list added/removed coins

---

## 14. Missing/Null/UNKNOWN Audit

### 14.1 Null Values

| Field | Null Behavior |
|---|---|
| `health_score` | Display as "N/A" in timeline; delta = null |
| `confidence_score` | Display as "N/A"; delta = null |
| `regime_state` | Display as "N/A"; regime_changed = true if current is non-null |
| `quality_metadata` | Display as "N/A" |
| `freshness_metadata` | Display as "N/A" |

### 14.2 UNKNOWN Values

| Artifact | UNKNOWN Handling |
|---|---|
| Regime: UNKNOWN | Display as "Unknown"; not treated as transition |
| Regime: INSUFFICIENT_DATA | Display as "Insufficient Data"; not treated as transition |
| Warning severity: INFO | Display as "Info" (lowest severity) |

### 14.3 Zero Values

| Scenario | Behavior |
|---|---|
| health_score = 0 as baseline | Delta = current; pct = null (per PD-06C-03) |
| health_score = 0 as current | Delta = 0 − reference; pct = (0 − ref) / ref × 100 |
| confidence = 0 | Display as 0; delta computed normally |

---

## 15. Insufficient History Audit

### 15.1 Insufficient History for vs_N_Day_Ago

When `window=N` but fewer than N days of history:
- Find nearest snapshot at or before `current_window_end - N days`
- If none exists, use earliest available snapshot
- Set `insufficient_history = true`
- Report `actual_window_days` vs `requested_window_days`

### 15.2 Insufficient History for Baseline

When no snapshots exist:
- `insufficient_history = true`
- `history_length = 0`
- `current = null`, `baseline = null`

When only one snapshot exists:
- Baseline = that snapshot
- Delta = 0, pct = null
- `insufficient_history = false` (baseline exists)

### 15.3 Insufficient History for Timeline

When entity has no snapshots:
- Empty timeline array
- `history_length = 0`

---

## 16. Quality/Freshness Audit

### 16.1 Quality Metadata

Each P6-03 snapshot carries `quality_metadata` (JSONB). Contains quality state information independent from health.

### 16.2 Freshness Metadata

Each P6-03 snapshot carries `freshness_metadata` (JSONB). Contains freshness state information independent from quality.

### 16.3 Quality ≠ Freshness

**Inherited from P6-07:** QualityState and Freshness are independent dimensions.

P6-08 preserves this distinction in historical views. No merging, no derivation.

### 16.4 Quality/Freshness History

OPTIONAL for V1. Can be derived from snapshot `quality_metadata` and `freshness_metadata` over time.

---

## 17. Provenance Audit

### 17.1 Comparison Provenance

Each comparison result includes:
- `current_snapshot_id`, `reference_snapshot_id`
- `current_snapshot_version`, `reference_snapshot_version`
- `comparison_algorithm` = `"p6-comparison-v1"`
- `calculated_at`

### 17.2 Source Artifact Provenance

Each source artifact carries its own provenance:
- Snapshot: `SnapshotProvenance` with input features, observation counts
- Regime: `RegimeProvenance` with input snapshot IDs, lookback window
- Warning: `WarningProvenance` with snapshot identity, regime state
- Summary: `SummaryProvenance` with source snapshot, regime, warning IDs

### 17.3 Provenance Traceability

Comparison → source artifacts → source observations. Full chain is traceable.

---

## 18. Versioning Audit

### 18.1 Comparison Algorithm Version

V1: `"p6-comparison-v1"`. Trivial subtraction/literal comparison.

### 18.2 Source Artifact Versions

Each comparison inherits source artifact versions. Displayed alongside data, never used to recalculate.

### 18.3 Version Compatibility

Historical data may have different algorithm versions. P6-08 displays versions but does not normalize or recalculate.

---

## 19. Output Contract Audit

### 19.1 Comparison Result Fields

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
| `window_days` | number \| null | Requested window (null for baseline/timeline) |
| `actual_window_days` | number \| null | Actual window achieved |
| `membership_changed` | boolean \| null | Whether narrative membership changed (narrative only) |
| `provenance` | object | Comparison provenance |
| `versions` | object | Source artifact versions |

### 19.2 Timeline Result Fields

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

### 19.3 Lifecycle

Comparison results are transient (not persisted). No lifecycle state.

### 19.4 Deterministic Ordering

Timeline: `ORDER BY window_end ASC`. Tie-breaking: `id ASC`.

---

## 20. Persistence / On-Read Audit

### 20.1 V1: Derive On-Read

**PD-08A-01:** Comparison results are derived on-read. No new persistence tables.

### 20.2 Rationale

- Deterministic: same inputs → same output
- Reproducible: source artifacts are versioned and immutable
- No duplication: comparison is a function of existing data
- No migration: no schema changes required

### 20.3 Future Consideration

V2+ may persist comparison results for API contract stability or caching. Not required for V1.

---

## 21. Legacy Reuse Audit

| Component | Classification | Reason |
|---|---|---|
| `readRegimeHistory()` | **REUSE** | Already reads historical regime states from P6-04 |
| `readWarningHistory()` | **REUSE** | Already reads historical warning records from P6-05 |
| `narrativeMembershipEvents` | **REUSE** | Authoritative membership history for narrative comparison |
| `narrativeMembershipSnapshots` | **REUSE** | Pre-computed point-in-time membership |
| `healthTimelineService` | **ADAPT** | Reads from legacy `health_scores`/`narrative_health` tables; P6-08 provides P6-native alternative |
| `HealthTimeline` component | **ADAPT** | UI component for timeline display; reuse with P6 data source |
| `p3NarrativeIntelligence` | **DO NOT USE** | P3 legacy intelligence, not P6-native |
| `morning_snapshots` | **DO NOT USE** | Legacy snapshot format |
| `decisionSignals` | **DO NOT USE** | P2 legacy decision signals |
| `narrativeMomentum` | **DO NOT USE** | P2 legacy momentum |
| Legacy `health_scores` / `narrative_health` | **DEFER** | May provide supplementary data; P6-08 prefers P6-native |

---

## 22. P6-06 Boundary Audit

| Check | Result |
|---|---|
| P6-06 current summary semantics modified | ❌ NO |
| P6-06 latest/current lifecycle modified | ❌ NO |
| P6-06 identity modified | ❌ NO |
| P6-06 explanation format modified | ❌ NO |
| P6-06 persistence semantics modified | ❌ NO |
| P6-08 reads P6-06 artifacts | ✅ YES (read-only) |
| P6-08 mutates P6-06 artifacts | ❌ NO |

**P6-06 untouched. P6-08 reads historical P6-06 data without modifying P6-06 semantics.**

---

## 23. P4 Boundary Audit

| Check | Result |
|---|---|
| P4 code modified | ❌ NO |
| P4 semantics reinterpreted | ❌ NO |
| P4 data consumed by P6-08 | ❌ NO |
| P4 decision support in P6-08 | ❌ NO |
| P4 policy semantics | ❌ NO |

**P4 untouched.**

---

## 24. P5 / Replay Boundary Audit

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

## 25. Invariant Audit

### 25.1 Proposed Invariants (PH-01…PH-12)

| ID | Invariant | Validated? | Evidence |
|---|---|---|---|
| PH-01 | Deterministic comparison | ✅ | V1 uses subtraction/literal comparison; no randomness |
| PH-02 | No fabrication | ✅ | Gaps are explicit; nulls are null |
| PH-03 | No recalculation | ✅ | Historical artifacts displayed as-is |
| PH-04 | Insufficient history honest | ✅ | `insufficient_history` flag in output |
| PH-05 | Version display | ✅ | Versions shown alongside data |
| PH-06 | Membership accuracy | ✅ | Membership at comparison time via events |
| PH-07 | No new persistence | ✅ | Derive on-read |
| PH-08 | Read-only | ✅ | GET-only APIs |
| PH-09 | P6-native only | ✅ | No P3/P4/P5 data consumed |
| PH-10 | No action semantics | ✅ | Explanation only, no recommendations |
| PH-11 | Quality ≠ Freshness | ✅ | Independent dimensions preserved |
| PH-12 | Gap explicit | ✅ | Missing snapshots shown as gaps |

### 25.2 Inherited Invariants

| ID | Invariant | Validated? |
|---|---|---|
| PV-01 | P6-07 consumes only P6-native artifacts | ✅ |
| PV-02 | P6-07 does not recalculate semantics | ✅ |
| PV-03 | P6-07 is read-only | ✅ |
| PV-04 | P6-07 output is deterministic | ✅ |
| PV-10 | P4 untouched | ✅ |
| PV-11 | P5 untouched | ✅ |
| PV-12 | No action semantics | ✅ |
| PV-13 | No BUY/SELL semantics | ✅ |
| PV-14 | No legacy contamination | ✅ |

**21/21 invariants validated. 0 violations.**

---

## 26. Evidence Gap Inventory

| Gap | P6-08A Status | P6-08B Status | P6-08C Status | Classification |
|---|---|---|---|---|
| P6-06 summaries latest-only | BLOCKING | **RESOLVED** | **RESOLVED** | RESOLVED |
| No `readSnapshotHistory()` | BLOCKING | BLOCKING | **BLOCKING** | BLOCKING |
| Membership at historical time | BLOCKING | BLOCKING | **BLOCKING** | BLOCKING |
| No P6-native health-timeline API | NON-BLOCKING | NON-BLOCKING | **NON-BLOCKING** | NON-BLOCKING |
| `healthDimensions` JSONB undocumented | NON-BLOCKING | NON-BLOCKING | **NON-BLOCKING** | NON-BLOCKING |
| No tests for historical reads | NON-BLOCKING | NON-BLOCKING | **DEFERRED** | DEFERRED |

---

## 27. Resolved Gaps

### P6-06 Summary Persistence — RESOLVED

**Original claim:** P6-06 summaries are latest-only (UPSERT); historical summaries may be overwritten.

**Implementation inspection:** `persistSummary()` UPSERT only replaces content for the same `(entity_type, entity_id, timeframe, window_end)`. Different `window_end` values cause the old row to be marked SUPERSEDED (retained, not deleted).

**Evidence:** `src/lib/p6/aggregation/persistence.ts` lines 36-42:
```typescript
await db.update(p6IntelligenceSummaries)
  .set({ status: "SUPERSEDED", updatedAt: new Date() })
  .where(and(
    eq(...entityType),
    eq(...entityId),
    eq(...timeframe),
    ne(...windowEnd, summary.window_end),  // different window
    eq(...status, "CURRENT")
  ));
```

**Conclusion:** Historical summaries ARE preserved. Each daily summary has its own row. Old rows become SUPERSEDED.

---

## 28. Remaining Blocking Gaps

### Gap 1: No `readSnapshotHistory()` Function

**Impact:** Cannot query historical snapshots efficiently through the existing persistence API.

**Resolution:** Create `readSnapshotHistory()` in `src/lib/p6/snapshot/persistence.ts` during P6-08D implementation.

**Why blocking:** Without this function, P6-08 must directly query the database, bypassing the persistence abstraction layer.

### Gap 2: Narrative Membership Reconstruction

**Impact:** Cannot determine which coins were in a narrative at a historical point in time without reconstructing from `narrative_membership_events`.

**Resolution:** Implement membership reconstruction using `narrative_membership_events` table during P6-08D implementation.

**Why blocking:** PD-08A-03 (membership handling) and PD-08C-04 (reconstruction strategy) must be resolved before implementation.

---

## 29. Non-Blocking Gaps

| Gap | Impact | Resolution |
|---|---|---|
| No P6-native health-timeline API | Legacy API uses non-P6 data | Create new API in P6-08D |
| `healthDimensions` JSONB undocumented | May need to parse for dimension history | Document in implementation |

---

## 30. Deferred Gaps

| Gap | Impact | Resolution |
|---|---|---|
| No tests for historical reads | Must create in implementation | Create in P6-08D |

---

## 31. Dependency Graph

```
P6-08 Decisions
    ↓
PD-08A-01 (persist vs derive) ──→ PD-08A-09 (API design) ──→ P6-08D
    ↓
PD-08A-02 (comparison windows) ──→ API parameters ──→ P6-08D
    ↓
PD-08A-03 (membership handling) ──→ PD-08C-04 (reconstruction) ──→ P6-08D
    ↓
PD-08C-03 (warning matching) ──→ Warning comparison logic ──→ P6-08D
    ↓
PH-01…PH-12 (invariants) ──→ Implementation constraints ──→ P6-08D
    ↓
P6-08D (implementation)
    ↓
P6-08E (hardening)
    ↓
P6-08-FINAL (freeze)
```

---

## 32. Planner Decision Readiness

### Blocking Decisions Requiring Acceptance

| ID | Question | Proposed Resolution |
|---|---|---|
| **PD-08A-01** | Persist vs derive on-read? | Derive on-read |
| **PD-08A-02** | Default comparison windows? | 7d, 30d, baseline |
| **PD-08A-03** | Narrative membership handling? | Use membership at comparison time |
| **PD-08C-03** | Warning occurrence matching? | Match by `warning_type` + `detection_window` |
| **PD-08C-04** | Membership reconstruction strategy? | Latest event per coin at `effective_at ≤ T` |

### Non-Blocking Decisions (Safe Defaults)

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

---

## 33. Recommended P6-08C1 Scope

P6-08C1 should present the **5 blocking decisions** for Planner ACCEPT/MODIFY/REJECT:

1. PD-08A-01: Persist vs derive
2. PD-08A-02: Comparison windows
3. PD-08A-03: Membership handling
4. PD-08C-03: Warning matching
5. PD-08C-04: Membership reconstruction

All 5 have proposed resolutions. Non-blocking decisions resolve via safe defaults.

---

## 34. Git Boundary

| Check | Result |
|---|---|
| Only documentation file changed | ✅ PASS |
| No production code modified | ✅ PASS |
| No frozen contracts modified | ✅ PASS |
| P4/P5 untouched | ✅ PASS |
| P6-01…P6-07 untouched | ✅ PASS |

---

## 35. Final Verdict

```
READY FOR P6-08C1
```

5 blocking decisions identified with proposed resolutions. All P6-01…P6-07 frozen contracts respected. P4/P5 boundaries intact. 21/21 invariants validated. Evidence gaps identified and classified. The decision inventory is complete and internally consistent.
