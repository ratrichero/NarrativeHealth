# P6-08A — Historical Intelligence / Temporal Comparison Landscape Recon

**Date:** 2026-08-27
**Phase:** P6-08
**Status:** LANDSCAPE RECON COMPLETE

---

## 1. Executive Summary

P6-07 Intelligence Presentation is now FROZEN. The complete P6 pipeline is:

```
P6-01 (Observation) → P6-02 (Features) → P6-03 (Snapshot)
  → P6-04 (Regime) → P6-05 (Warning) → P6-06 (Summary)
  → P6-07 (Presentation)
```

All phases are frozen. The pipeline produces authoritative, versioned, deterministic intelligence artifacts. However, **P6-06 change detection is limited to two-point comparison (current vs immediate previous only)** per PD-06A-03. The P6 master specification (§15 P6-08 scope) explicitly defines:

> **P6-08 — Historical Intelligence & Backfill**
> Goal: make health/trend/warning history usable without corrupting historical semantics.
> Deliverables: snapshot browsing, historical comparison, reproducible calculation metadata, controlled backfill, data-quality treatment.

**P6-08 is the temporal comparison layer** — it makes historical P6 artifacts browsable, comparable, and explainable across time windows.

| Metric | Count |
|---|---|
| Total decisions | 12 |
| Blocking decisions | 3 |
| Non-blocking decisions | 4 |
| Deferred decisions | 5 |
| Evidence gaps | 6 (3 blocking) |
| Reusable components | 11 |
| Adaptation needed | 3 |
| Rejected | 4 |
| Deferred | 5 |

**Verdict: READY FOR P6-08B**

---

## 2. Current P6 Pipeline State

| Phase | Artifact | Status | Persistence | History? |
|---|---|---|---|---|
| P6-01 | Observations, QualityState, FreshnessState | FROZEN | `p6_observation_quality` | Append-only |
| P6-02 | Derived Features | FROZEN | `features` | Per-day records |
| P6-03 | Intelligence Snapshots | FROZEN | `p6_snapshots` | Per-day, CURRENT/SUPERSEDED |
| P6-04 | Regime States | FROZEN | `p6_regime_states` | CURRENT/SUPERSEDED |
| P6-05 | Warning Occurrences | FROZEN | `p6_warnings` | Append-only, lifecycle tracking |
| P6-06 | Intelligence Summaries | FROZEN | `p6_intelligence_summaries` | Latest-only |
| P6-07 | Presentation DTOs | FROZEN | None (read-only) | Current only |

**Critical observation:** P6-03 snapshots and P6-05 warnings persist historical records. P6-04 regime persists CURRENT/SUPERSEDED but has `readRegimeHistory()`. P6-06 summaries persist latest-only but have `window_end` identity. Historical data exists in the database — it just has no consumer yet.

---

## 3. P6-08 Purpose

### What P6-08 IS

P6-08 is the **Historical Intelligence / Temporal Comparison Layer**. Its purpose is to:

1. Make historical P6-03 snapshots browsable (health score over time)
2. Enable multi-point comparison (not just current-vs-previous)
3. Expose regime transition history and duration
4. Show warning lifecycle history (appeared, persisted, resolved)
5. Provide deterministic historical views using versioned algorithms
6. Enable reproducible calculation from stored inputs
7. Support controlled backfill with data-quality treatment

### What P6-08 IS NOT

- NOT a new intelligence calculation engine
- NOT a forecasting/prediction engine
- NOT a BUY/SELL engine or trading signal
- NOT an action engine or policy engine
- NOT a P5 bridge or decision support layer
- NOT an automatic recommendation engine
- NOT cross-entity correlation (deferred)
- NOT warning delivery/push notifications

P6-08 **explains what happened**, not what to do about it.

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

## 5. Architecture Recon

```
P6-01 → P6-02 → P6-03 → P6-04 → P6-05 → P6-06 → P6-07
  ↓        ↓        ↓        ↓        ↓        ↓        ↓
Obs.    Features  Snapshots Regime  Warnings  Summary  Presentation
  ↓        ↓        ↓        ↓        ↓        ↓        ↓
  └────────┴────────┴────────┴────────┴────────┴────────┘
                         ↓
                   Historical queries (P6-08)
                         ↓
                   Temporal comparison
                         ↓
                   Historical presentation
```

P6-08 sits as a **read-layer extension** over existing frozen artifacts. It does NOT create a new pipeline stage. It consumes the same artifacts as P6-07 but provides temporal depth.

---

## 6. Upstream Artifact Inventory

### 6.1 P6-03 Snapshots

| Property | Value |
|---|---|
| **Authoritative source** | `p6_snapshots` table |
| **Identity** | `(entity_type, entity_id, snapshot_type, window_end)` |
| **Persistence** | Per-day records, CURRENT/SUPERSEDED lifecycle |
| **Version** | `SnapshotVersionTuple` (algorithm_version, parameter_version, schema_version, config_hash) |
| **Provenance** | Full `SnapshotProvenance` with input features, observation counts |
| **Quality** | `quality_metadata` (JSONB) — independent from health |
| **Freshness** | `freshness_metadata` (JSONB) — independent from quality |
| **Lifecycle** | CURRENT \| SUPERSEDED |
| **Temporal fields** | `window_end`, `calculation_time`, `createdAt` |
| **Read service** | `readCurrentSnapshot()`, `readCurrentCoinSnapshots()` |
| **History read** | `readCurrentCoinSnapshots()` returns all CURRENT; no windowed history query exists |
| **Limitation** | No `readSnapshotHistory()` function; unique constraint on `(entity_type, entity_id, snapshot_type, window_end)` means each window has exactly one record |

**P6-08 relevance:** Snapshots are the primary temporal data source. Each daily refresh produces a new snapshot. History = all snapshot records for an entity ordered by `window_end`.

### 6.2 P6-04 Regime States

| Property | Value |
|---|---|
| **Authoritative source** | `p6_regime_states` table |
| **Identity** | `(entity_type, entity_id, regime_type, status)` |
| **Persistence** | Latest-only (CURRENT/SUPERSEDED) |
| **Version** | `RegimeVersionTuple` |
| **Provenance** | Full `RegimeProvenance` with input snapshot IDs, lookback window |
| **Lifecycle** | CURRENT \| SUPERSEDED |
| **Temporal fields** | `calculation_time`, `createdAt` |
| **Read service** | `readCurrentRegime()`, `readRegimeHistory()` |
| **History read** | `readRegimeHistory()` returns all records (CURRENT + SUPERSEDED) ordered by calculation_time |
| **Limitation** | Latest-only persistence means only the current regime is reliably available; historical regimes may be SUPERSEDED but are retained |

**P6-08 relevance:** Regime transitions are key historical events. The `previous_state` field on each record provides the transition source. Regime duration = time between consecutive regime changes.

### 6.3 P6-05 Warning Occurrences

| Property | Value |
|---|---|
| **Authoritative source** | `p6_warnings` table |
| **Identity** | `(entity_type, entity_id, warning_type, detection_window)` with `dedup_key` unique |
| **Persistence** | Append-only (never DELETE) |
| **Version** | `WarningVersionTuple` |
| **Provenance** | Full `WarningProvenance` with snapshot identity, regime state |
| **Lifecycle** | DETECTED → ACTIVE → RESOLVED \| SUPERSEDED |
| **Temporal fields** | `detection_window`, `detected_at`, `effective_from`, `effective_until`, `superseded_at` |
| **Read service** | `readActiveWarnings()`, `readWarningHistory()` |
| **History read** | `readWarningHistory()` returns all records ordered by detected_at |
| **Limitation** | Full lifecycle tracking; warnings that were RESOLVED or SUPERSEDED are retained |

**P6-08 relevance:** Warning history is rich — each warning has a complete lifecycle with temporal bounds. Historical comparison can show warning frequency, recurrence, severity evolution.

### 6.4 P6-06 Intelligence Summaries

| Property | Value |
|---|---|
| **Authoritative source** | `p6_intelligence_summaries` table |
| **Identity** | `(entity_type, entity_id, timeframe, window_end)` |
| **Persistence** | Latest-only with UPSERT semantics |
| **Version** | `SummaryVersionTuple` |
| **Provenance** | Full `SummaryProvenance` with source snapshot, regime, warning IDs |
| **Lifecycle** | CURRENT \| SUPERSEDED |
| **Temporal fields** | `window_end`, `calculated_at` |
| **Read service** | `readCurrentSummary()` — returns only latest |
| **History read** | No `readSummaryHistory()` exists; UPSERT means historical summaries may be overwritten |
| **Limitation** | PD-06C-02: idempotent re-run replaces same-window content; different windows are superseded |

**P6-08 relevance:** Summaries contain the richest explanation data (what_changed, why, what_to_watch). However, latest-only persistence means historical summaries may be lost if not specifically preserved.

### 6.5 P6-07 Presentation

| Property | Value |
|---|---|
| **Authoritative source** | `src/lib/p6/presentation/` (read-only) |
| **Identity** | Derived from upstream artifacts |
| **Persistence** | None (DTOs, not persisted) |
| **History** | Current only |

**P6-08 relevance:** P6-07 is current-only. P6-08 must provide the temporal extension that P6-07 lacks.

---

## 7. Temporal Model Candidates

### 7.1 Point-in-Time Comparison

Compare a specific historical snapshot to another specific historical snapshot.

| Variant | Description | Required? |
|---|---|---|
| Current vs Immediate Previous | PD-06A-03 — already implemented in P6-06 | ✅ EXISTS |
| Current vs N days ago | Compare today to a specific past day | **REQUIRED** |
| Current vs Baseline | Compare to first-observed or configurable baseline | **REQUIRED** |
| Specific day A vs Specific day B | Arbitrary two-point comparison | OPTIONAL |
| Window comparison | Compare 7-day, 30-day, 90-day windows | DEFERRED |

### 7.2 Multi-Point Trend Analysis

Examine health/warning/regime over a time series.

| Variant | Description | Required? |
|---|---|---|
| Health score timeline | Plot health_score over time | **REQUIRED** |
| Regime transition timeline | Plot regime state changes over time | **REQUIRED** |
| Warning frequency timeline | Count warnings per time period | OPTIONAL |
| Severity distribution over time | Severity histogram across windows | DEFERRED |

### 7.3 Rolling Windows

| Variant | Description | Required? |
|---|---|---|
| Rolling average | Average health over N-day window | DEFERRED |
| Rolling min/max | Extremes over N-day window | DEFERRED |
| Percentile ranges | Statistical distribution | DEFERRED |

### 7.4 Event-Based Windows

| Variant | Description | Required? |
|---|---|---|
| Since regime change | Compare current to pre-transition state | OPTIONAL |
| Since warning appeared | Track since a specific warning | DEFERRED |
| Since membership change | Compare before/after narrative membership | DEFERRED |

### 7.5 Calendar Windows

| Variant | Description | Required? |
|---|---|---|
| Last 7 days | Standard short window | **REQUIRED** |
| Last 30 days | Standard medium window | **REQUIRED** |
| Last 90 days | Standard long window | OPTIONAL |
| Custom range | User-specified date range | DEFERRED |

### 7.6 Temporal Model Decision

**V1 Recommendation: Current vs N-day-ago + Health Timeline + Regime Timeline**

Core V1 uses:
1. Health score timeline (all historical snapshots for an entity)
2. Current vs N-day-ago comparison (7d, 30d configurable)
3. Regime transition timeline (all regime state changes)
4. Warning lifecycle history (all warnings for an entity)

This is conservative, deterministic, and requires no new persistence.

---

## 8. Comparison Dimensions

### 8.1 Health

| Dimension | Description | V1? |
|---|---|---|
| Health score delta | `current - previous` | ✅ (exists in P6-06) |
| Absolute delta | Same as above | ✅ |
| Percentage delta | `(current - previous) / previous * 100` | ✅ (exists in P6-06) |
| Baseline comparison | `current - first_observed` | **REQUIRED** |
| Min/Max over window | Extremes over N days | OPTIONAL |
| Trend direction | Improving / Deteriorating / Stable | **REQUIRED** |
| Rate of change | Delta per day | OPTIONAL |

### 8.2 Confidence

| Dimension | Description | V1? |
|---|---|---|
| Confidence delta | `current - previous` | OPTIONAL |
| Confidence deterioration | Significant confidence drop | OPTIONAL |
| Confidence history | Plot over time | DEFERRED |

### 8.3 Regime

| Dimension | Description | V1? |
|---|---|---|
| Regime changes | Count of transitions in period | **REQUIRED** |
| Regime duration | Time in current regime | **REQUIRED** |
| Transition sequence | Ordered list of state changes | **REQUIRED** |
| UNKNOWN handling | How to present UNKNOWN regime in history | **REQUIRED** |

### 8.4 Warnings

| Dimension | Description | V1? |
|---|---|---|
| Newly appeared | Warnings detected in period | ✅ (exists in P6-06) |
| Resolved | Warnings resolved in period | ✅ (exists in P6-06) |
| Recurring | Same warning type reappearing | OPTIONAL |
| Persistent | Warnings active for > N days | OPTIONAL |
| Severity evolution | Severity changes over time | DEFERRED |
| Occurrence frequency | Count per time bucket | OPTIONAL |

### 8.5 Quality

| Dimension | Description | V1? |
|---|---|---|
| Quality history | Quality state over time | OPTIONAL |
| Degradation/recovery | Quality state transitions | OPTIONAL |
| Quality propagation | How quality affects other metrics | DEFERRED |

### 8.6 Freshness

| Dimension | Description | V1? |
|---|---|---|
| Freshness history | Freshness state over time | OPTIONAL |
| Stale periods | Duration of stale state | OPTIONAL |
| Recovery | Fresh → Stale → Fresh transitions | OPTIONAL |

---

## 9. Coin Historical Semantics

### 9.1 Coin Snapshot History

Each coin has one snapshot per daily refresh. History is:

```
SELECT * FROM p6_snapshots
WHERE entity_type = 'coin' AND entity_id = ? AND snapshot_type = 'COIN_HEALTH'
ORDER BY window_end ASC
```

This is straightforward — one row per day, ordered by time.

### 9.2 Coin Regime History

Regime states are persisted as CURRENT/SUPERSEDED. Historical regimes can be read via `readRegimeHistory()` which returns all records. Each record has `previous_state` enabling transition reconstruction.

### 9.3 Coin Warning History

Warnings are append-only with lifecycle tracking. `readWarningHistory()` returns all warnings for a coin, ordered by detected_at. Each warning has `effective_from` and `effective_until` enabling temporal analysis.

### 9.4 Coin Health Timeline API

**Already exists:** `GET /api/coins/[id]/health-timeline` using `healthTimelineService`. This reads from the legacy `health_scores` table (P0/P1), NOT from P6-03 snapshots.

**P6-08 must:** Either replace this with P6-03 snapshot data or provide a P6-native alternative.

---

## 10. Narrative Historical Semantics

### 10.1 Narrative Snapshot History

Each narrative has one snapshot per daily refresh. Same structure as coin — one row per day.

### 10.2 Narrative Membership Changes

**Critical semantic issue.** Narrative membership can change over time:

- Coins can be added to narratives
- Coins can be removed from narratives
- Primary narrative assignments can change

**The `narrative_membership_events` table** tracks membership changes with effective timestamps. `narrative_membership_snapshots` captures point-in-time membership.

**P6-08 must decide:** When comparing historical narrative health:
- Use the membership at comparison time? (historically accurate)
- Use current membership applied retrospectively? (consistent but misleading)

**Recommendation:** Use membership at comparison time for accuracy. The infrastructure exists (`narrative_membership_events`).

### 10.3 Narrative Regime/Warning History

Same as coin — regime history and warning history are available via existing read functions.

### 10.4 Narrative Health Timeline API

**Already exists:** `GET /api/narratives/[id]/health-timeline`. Reads from legacy `narrative_health` table.

**P6-08 must:** Provide P6-native alternative using P6-03 snapshots.

---

## 11. Temporal Alignment

### 11.1 Snapshot Timestamps

P6-03 snapshots have:
- `window_end`: Date (start-of-day, midnight)
- `calculation_time`: Timestamp (when calculated)
- `createdAt`: Timestamp (when persisted)

**Alignment rule:** Compare by `window_end` (date-level granularity). Snapshots are DAILY.

### 11.2 Missing Snapshots

If a daily refresh fails or is skipped, no snapshot is produced for that day.

**P6-08 must handle:** Gaps in the timeline. Options:
- Show gaps explicitly (null points in timeline)
- Interpolate (risky — may fabricate)
- Skip gaps (misleading continuity)

**Recommendation:** Show gaps explicitly. Never interpolate.

### 11.3 Asynchronous Artifacts

Regime, warning, and summary may be calculated at different times than the snapshot.

**Alignment rule:** Use `window_end` for alignment, not `calculation_time`.

### 11.4 Timezone

All dates use `Asia/Ho_Chi_Minh` business timezone (per refresh route). Snapshots use midnight `window_end`.

**P6-08 must:** Preserve timezone consistency.

### 11.5 Duplicate Timestamps

Unique constraints prevent duplicate snapshots per entity/window. No duplicate risk.

---

## 12. Missing/Invalid/UNKNOWN Handling

### 12.1 Missing Historical Snapshot

| Scenario | Behavior |
|---|---|
| Day has no snapshot | Show gap in timeline; do not interpolate |
| Entity has no history | Return empty history array |
| Partial history | Show available data; mark gaps |

### 12.2 Missing Regime

| Scenario | Behavior |
|---|---|
| No regime record for day | Regime timeline shows gap |
| UNKNOWN regime state | Display as "Unknown" — do not fabricate |
| INSUFFICIENT_DATA | Display as "Insufficient Data" — honest uncertainty |

### 12.3 Missing Warning History

| Scenario | Behavior |
|---|---|
| No warnings ever | Empty warning history |
| Warnings existed but resolved | Show full lifecycle including resolved period |

### 12.4 Invalid Artifact

| Scenario | Behavior |
|---|---|
| Corrupted JSONB metadata | Skip that metadata field; show available data |
| Null health_score | Display as "N/A" in timeline |
| Null confidence | Display as "N/A" |

### 12.5 Empty History

| Scenario | Behavior |
|---|---|
| No P6 snapshots for entity | Return empty history with explanatory message |
| Insufficient history for comparison | Return available data; note insufficient history |

### 12.6 Stale History

| Scenario | Behavior |
|---|---|
| Last snapshot > 24h ago | Indicate staleness in metadata |
| No recent data | Show "Data may be stale" indicator |

**No fabrication in any case.**

---

## 13. Historical Identity

### 13.1 Comparison Identity

A historical comparison is identified by:

| Field | Type | Description |
|---|---|---|
| `entity_type` | `"coin" \| "narrative"` | Entity type |
| `entity_id` | `number` | Entity ID |
| `comparison_type` | `string` | Comparison method (e.g., `"vs_previous"`, `"vs_n_day_ago"`, `"baseline"`) |
| `reference_date` | `Date` | The date being compared against |
| `window_end` | `Date` | The current date being compared |

### 13.2 Baseline Identity

A baseline is identified by:

| Field | Type | Description |
|---|---|---|
| `entity_type` | `"coin" \| "narrative"` | Entity type |
| `entity_id` | `number` | Entity ID |
| `baseline_type` | `string` | `"first_observed"` or `"configured"` |
| `baseline_window_end` | `Date` | The snapshot date used as baseline |

### 13.3 Deterministic Uniqueness

For V1, comparisons can be computed on-read from persisted snapshots. No new persistence needed for comparison identity.

If comparison results are persisted in future, identity would be:

```
(entity_type, entity_id, comparison_type, reference_date, window_end)
```

### 13.4 Version Tuple

Historical comparison inherits the version of the source artifacts:

- Snapshot version from `p6_snapshots.snapshot_algorithm_version`
- Regime version from `p6_regime_states.algorithm_version`
- Warning version from `p6_warnings.algorithm_version`

No new version dimension needed for V1 comparison.

---

## 14. Coin vs Narrative Semantics

### 14.1 Coin Historical

Coin history is straightforward:
- One snapshot per day
- One regime state per calculation
- Multiple warnings over time
- Membership in narrative is stable (or changes via `narrative_membership_events`)

### 14.2 Narrative Historical

Narrative history has an additional complexity:
- **Membership changes over time** — coins join/leave narratives
- Historical narrative health was calculated using the membership at that time
- P6-03 snapshots capture the member scores used in aggregation

**P6-08 must decide:** When showing narrative history:
- Use the membership snapshot at each historical point (accurate)
- Or use current membership (inconsistent)

**Recommendation:** Use membership at comparison time. The `narrative_snapshot_provenance` includes `member_coin_snapshots` with the membership used.

### 14.3 Temporal Model Differences

| Aspect | Coin | Narrative |
|---|---|---|
| Snapshot frequency | Daily | Daily |
| Membership changes | N/A | Tracked via events |
| Regime transitions | Same | Same |
| Warning history | Same | Same |
| Baseline | First observed snapshot | First observed snapshot |
| Population stability | Fixed entity | May change |

**Recommendation:** Same temporal model for both, but narrative comparison must note membership changes.

---

## 15. Provenance

### 15.1 Minimum Provenance Chain

```
Historical comparison
    ↓
current snapshot (P6-03)
reference snapshot (P6-03)
    ↓
regime artifacts (P6-04) — if regime comparison
warning occurrences (P6-05) — if warning comparison
aggregation summary (P6-06) — if explanation comparison
```

### 15.2 What Must Be Traceable

| Artifact | Traceable To |
|---|---|
| Health comparison | Source snapshot IDs, versions, algorithm parameters |
| Regime comparison | Source regime records, input snapshot IDs |
| Warning comparison | Source warning records, detection windows |
| Baseline comparison | Baseline snapshot ID, first-observed date |

### 15.3 Provenance Exposure

V1 may expose provenance in collapsed "technical details" section, consistent with P6-07 pattern.

---

## 16. Versioning

### 16.1 Comparison Algorithm Version

V1 comparison is trivial (subtraction, literal comparison). No separate algorithm version needed.

If V2+ adds rolling averages, trend regression, or statistical methods, a `comparison_algorithm_version` would be needed.

### 16.2 Source Artifact Versions

Each historical comparison inherits the version of its source artifacts. The version tuple is:

```
{
  snapshot_version: SnapshotVersionTuple,
  regime_version: RegimeVersionTuple,
  warning_version: WarningVersionTuple
}
```

### 16.3 Timeframe

V1 uses DAILY timeframe only. If 4H/1H timeframes are added later, a `comparison_timeframe` field would be needed.

### 16.4 Parameter Version

V1 comparison has no configurable parameters beyond the comparison window (7d, 30d). These are UI configuration, not algorithm parameters.

---

## 17. Persistence

### 17.1 Current Persistence Sufficiency

| Table | Records Historical? | Sufficient for P6-08? |
|---|---|---|
| `p6_snapshots` | ✅ Yes (per-day, unique by window_end) | ✅ Sufficient |
| `p6_regime_states` | ✅ Yes (append with status) | ✅ Sufficient |
| `p6_warnings` | ✅ Yes (append-only) | ✅ Sufficient |
| `p6_intelligence_summaries` | ⚠️ Latest-only (UPSERT) | ❌ Historical summaries may be lost |

### 17.2 New Persistence for P6-08?

**V1 recommendation:** No new persistence tables.

P6-08 reads from existing P6 tables:
- `p6_snapshots` for health history
- `p6_regime_states` for regime history
- `p6_warnings` for warning history
- `narrative_membership_events` for narrative membership history

Comparison results are computed on-read (deterministic from persisted artifacts).

### 17.3 Future Persistence Consideration

If P6-08 needs to persist comparison results (e.g., for API caching or reproducibility guarantees), a `p6_historical_comparisons` table could be added in P6-08B/C.

**Not required for V1.**

---

## 18. Lifecycle

### 18.1 Historical Data Lifecycle

| Artifact | Lifecycle | Implication for P6-08 |
|---|---|---|
| P6-03 Snapshots | CURRENT/SUPERSEDED | SUPERSEDED snapshots are historical data — retain |
| P6-04 Regime | CURRENT/SUPERSEDED | SUPERSEDED regimes are transition records — retain |
| P6-05 Warnings | DETECTED/ACTIVE/RESOLVED/SUPERSEDED | Full lifecycle — retain all |
| P6-06 Summaries | CURRENT/SUPERSEDED | Latest-only — historical may be overwritten |

### 18.2 No New Lifecycle States

P6-08 does not create new lifecycle states. It reads existing lifecycle states to reconstruct history.

---

## 19. Latest vs Historical Semantics

### 19.1 Distinct Concepts

| Concept | Meaning | Source |
|---|---|---|
| **CURRENT** | The most recent artifact for this entity | P6-03/04/05/06 with status=CURRENT |
| **HISTORICAL** | Any past artifact | P6-03/04/05 with status=SUPERSEDED, or older CURRENT |
| **COMPARISON** | A derived view comparing two points in time | Computed on-read from HISTORICAL + CURRENT |
| **BASELINE** | A reference point for comparison | First observed or configured snapshot |

### 19.2 Persist vs Derive

**V1: Derive on-read.** Comparison results are not persisted. They are deterministic functions of persisted artifacts.

**Future:** If comparison results need to be persisted (for reproducibility, API contracts, or performance), they can be added in a later phase.

### 19.3 Reproducibility

Since V1 comparison is derived on-read from persisted artifacts with version tuples, it is reproducible: same artifacts + same algorithm → same comparison.

### 19.4 Idempotency

Read-only comparison queries are idempotent. No side effects.

### 19.5 Historical Immutability

P6-03 snapshots are immutable once persisted (append-only with UPSERT for same window). P6-05 warnings are append-only. Historical data is not modified by future refreshes.

---

## 20. Legacy Reuse Audit

| Component | Classification | Reason |
|---|---|---|
| `healthTimelineService` | **ADAPT** | Reads from legacy `health_scores`/`narrative_health` tables; P6-08 should provide P6-native alternative using `p6_snapshots` |
| `HealthTimeline` component | **ADAPT** | UI component for timeline display; can be reused with P6 data source |
| `morning_snapshots` tables | **DO NOT USE** | Legacy snapshot format, not P6-native |
| `p3NarrativeIntelligence` | **DO NOT USE** | P3 legacy intelligence, not P6-native |
| `p3ConstituentSnapshots` | **DO NOT USE** | P3 legacy constituent data |
| `p3LeadershipMembers` | **DO NOT USE** | P3 legacy leadership data |
| `narrativeMomentum` | **DO NOT USE** | P2 legacy momentum, not P6-native |
| `decisionSignals` | **DO NOT USE** | P2 legacy decision signals |
| `readRegimeHistory()` | **REUSE** | Already reads historical regime states from P6-04 |
| `readWarningHistory()` | **REUSE** | Already reads historical warning records from P6-05 |
| `narrativeMembershipEvents` | **REUSE** | Authoritative membership history for narrative comparison |
| Legacy `health_scores` / `narrative_health` tables | **DEFER** | May provide supplementary historical data before P6 existed; P6-08 should prefer P6-native data |

---

## 21. P4 Boundary Audit

| Check | Result |
|---|---|
| P4 code modified | ❌ NO |
| P4 semantics reinterpreted | ❌ NO |
| P4 data consumed by P6-08 | ❌ NO |
| P4 decision support in P6-08 | ❌ NO |
| P4 policy semantics | ❌ NO |
| P4 decision model | ❌ NO |

**P4 untouched.** P6-08 reads P6-native artifacts only. It does not consume P4 data.

---

## 22. P5 Boundary / Replay Audit

| Check | Result |
|---|---|
| P5 code modified | ❌ NO |
| P5 semantics reinterpreted | ❌ NO |
| P5 replay dependency created | ❌ NO |
| P5 action semantics in P6-08 | ❌ NO |
| P5 bridge created | ❌ NO |
| BUY/SELL vocabulary | ❌ NOT FOUND |
| Decision semantics | ❌ NOT FOUND |

**P5 untouched.** No replay contamination. P6-08 explains historical changes, but must not tell the system what action to take.

---

## 23. Explicit Decision Inventory

Decisions inherited from frozen P6 contracts:

| Decision | Source | P6-08 Impact |
|---|---|---|
| PD-03B-03 | P6-03 | Snapshot latest-only operational semantics |
| PD-03B-08 | P6-03 | Snapshot version tuple |
| PD-03B-09 | P6-03 | Synchronous persistence |
| PD-04B-01 | P6-04 | Regime vocabulary (6 states) |
| PD-04B-04 | P6-04 | Transition threshold (10 points) |
| PD-04B-05 | P6-04 | Min persistence (2 snapshots) |
| PD-05B-01 | P6-05 | Warning vocabulary (7 types) |
| PD-05B-02 | P6-05 | Severity vocabulary (5 levels) |
| PD-05B-10 | P6-05 | Warning lifecycle (4 states) |
| PD-05C-01 | P6-05 | Warning occurrence-based identity |
| PD-06A-01 | P6-06 | Summary scope |
| PD-06A-02 | P6-06 | Explanation format (structured arrays) |
| PD-06A-03 | P6-06 | **Change detection: two-point only (current vs immediate previous)** |
| PD-06A-04 | P6-06 | Minimum population (≥1) |
| PD-07A-01 | P6-07 | Refresh wiring |
| PD-07A-02 | P6-07 | Read API surface |
| PD-07A-03 | P6-07 | Legacy panel retirement |

**PD-06A-03 is the key constraint:** P6-06 change detection is two-point only. P6-08 extends this to multi-point historical comparison without modifying P6-06.

---

## 24. New Decision Inventory

| ID | Question | Proposed | Status | Blocking |
|---|---|---|---|---|
| **PD-08A-01** | Should P6-08 persist comparison results or derive on-read? | Derive on-read (deterministic, no new persistence) | PROPOSED | **YES** |
| **PD-08A-02** | What is the default historical comparison window? | 7 days and 30 days (configurable) | PROPOSED | **YES** |
| **PD-08A-03** | How should narrative membership changes affect historical comparison? | Use membership at comparison time (historically accurate) | PROPOSED | **YES** |
| **PD-08A-04** | Should P6-08 replace or supplement legacy health-timeline APIs? | Supplement — new `/api/p6/history/*` endpoints | PROPOSED | No |
| **PD-08A-05** | Should P6-08 show gaps for missing snapshots? | Yes — explicit gaps, never interpolate | PROPOSED | No |
| **PD-08A-06** | What baseline type should V1 support? | First-observed snapshot as baseline | PROPOSED | No |
| **PD-08A-07** | Should P6-08 include regime transition timeline? | Yes — ordered list of regime changes with timestamps | PROPOSED | No |
| **PD-08A-08** | Should P6-08 include warning lifecycle history? | Yes — full lifecycle with temporal bounds | PROPOSED | No |
| **PD-08A-09** | Should P6-08 expose historical comparison via P6-07 presentation layer or separate API? | Separate `/api/p6/history/*` endpoints | PROPOSED | No |
| **PD-08A-10** | How should P6-08 handle algorithm version changes in historical data? | Display version alongside historical data; do not recalculate | PROPOSED | No |
| **PD-08A-11** | Should P6-08 support custom date ranges in V1? | No — fixed windows only (7d, 30d); custom ranges deferred | PROPOSED | No |
| **PD-08A-12** | Should P6-08 include quality/freshness history? | Optional — quality/freshness metadata available in snapshots | PROPOSED | No |

---

## 25. Blocking Decisions

| ID | Question | Why Blocking |
|---|---|---|
| PD-08A-01 | Persist vs derive on-read | Determines persistence model, API design, and reproducibility contract |
| PD-08A-02 | Default comparison window | Determines API parameters and UI defaults |
| PD-08A-03 | Narrative membership handling | Determines historical accuracy vs consistency tradeoff |

---

## 26. Non-Blocking Decisions

| ID | Question | Default |
|---|---|---|
| PD-08A-04 | Replace vs supplement legacy APIs | Supplement (safe default) |
| PD-08A-05 | Gap handling | Explicit gaps (safe default) |
| PD-08A-06 | Baseline type | First-observed (safe default) |
| PD-08A-07 | Regime transition timeline | Include (safe default) |
| PD-08A-08 | Warning lifecycle history | Include (safe default) |
| PD-08A-09 | API layer separation | Separate endpoints (safe default) |
| PD-08A-10 | Algorithm version display | Display alongside (safe default) |
| PD-08A-11 | Custom date ranges | Fixed windows only (safe default) |
| PD-08A-12 | Quality/freshness history | Optional (safe default) |

---

## 27. Deferred Decisions

| ID | Question | Reason |
|---|---|---|
| Rolling window analytics | Complex statistical analysis | Deferred to P6-09+ |
| Cross-entity historical correlation | No frozen contract | Deferred |
| Warning severity evolution tracking | Complex lifecycle analysis | Deferred |
| Custom date range support | Over-engineering for V1 | Deferred |
| Historical comparison persistence | On-read is sufficient for V1 | Deferred |

---

## 28. Evidence Gaps

| Gap | Blocking? | Impact | Resolution |
|---|---|---|---|
| P6-06 summaries are latest-only (UPSERT) — historical summaries may be overwritten | **YES** | Cannot show historical explanations if summaries are overwritten | Either: (a) change P6-06 persistence to retain history, or (b) accept that historical summaries are not available in V1 |
| No `readSnapshotHistory()` function exists | **YES** | Cannot query historical snapshots efficiently | Create read function in P6-08 implementation |
| Narrative membership at historical snapshot time is not directly queryable from `p6_snapshots` | **YES** | Cannot determine which coins were in narrative at historical point | Use `narrative_membership_events` table to reconstruct membership at any point in time |
| No P6-native health-timeline API exists | No | Legacy API uses non-P6 data | Create new API in P6-08 |
| P6-03 snapshot `healthDimensions` JSONB structure not documented for historical consumption | No | May need to parse for dimension-level history | Document in P6-08B contract |
| No tests for historical read functions | No | Must create in implementation | Create in P6-08D |

---

## 29. Dependency Graph

```
P6-08 Scope Definition
      ↓
Temporal Model (PD-08A-01, PD-08A-02, PD-08A-03)
      ↓
Comparison Identity
      ↓
Alignment Rules (gap handling, timezone)
      ↓
Missing/Invalid/UNKNOWN Handling
      ↓
Read Services (snapshot history, regime history, warning history)
      ↓
Comparison Engine (on-read computation)
      ↓
API Surface (/api/p6/history/*)
      ↓
Historical Presentation (DTOs, UI)
      ↓
Tests + Hardening
      ↓
Freeze
```

Decision dependency:

```
PD-08A-01 (persist vs derive)
    ↓ blocks
PD-08A-09 (API design)
    ↓ blocks
P6-08D (implementation)

PD-08A-02 (comparison windows)
    ↓ blocks
API parameters

PD-08A-03 (membership handling)
    ↓ blocks
Narrative historical comparison
```

---

## 30. Recommended V1 Scope

### In Scope

1. **Health score timeline** — all historical P6-03 snapshots for an entity
2. **Current vs N-day-ago comparison** — 7d and 30d windows
3. **Baseline comparison** — first observed snapshot
4. **Regime transition timeline** — ordered regime changes with timestamps
5. **Warning lifecycle history** — all warnings with temporal bounds
6. **Read APIs** — `/api/p6/history/[entityType]/[id]` endpoints
7. **Gap handling** — explicit gaps for missing snapshots
8. **Version display** — show algorithm versions alongside historical data

### Out of Scope (Deferred)

- Rolling window analytics
- Custom date ranges
- Warning severity evolution
- Cross-entity historical correlation
- Historical comparison persistence
- Quality/freshness history timeline
- Narrative membership change visualization

### Conservative Principles

- Deterministic — same inputs → same comparison
- Explainable — every comparison point has provenance
- Read-compatible — no modification to frozen P6-01…P6-07
- No LLM — no AI-generated historical narratives
- No prediction — no forecasting
- No action — no BUY/SELL/EXECUTE
- Minimal new persistence — derive on-read from existing artifacts
- Bounded scope — fixed comparison windows only

---

## 31. Recommended Execution Sequence

```
P6-08A  Landscape Recon ← YOU ARE HERE
  ↓
P6-08B  Semantic Contract
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

## 32. Readiness Verdict

```
READY FOR P6-08B
```

3 blocking decisions identified. All have clear proposed resolutions. The P6-08 scope is architecturally justified (P6-06 two-point limitation, historical data exists in DB), dependency-ready (P6-01…P6-07 all frozen), and boundary-safe (no P4/P5 risk).

---

## 33. Git Boundary

| Check | Result |
|---|---|
| Only documentation file changed | ✅ PASS |
| No production code modified | ✅ PASS |
| No frozen contracts modified | ✅ PASS |
| P4/P5 untouched | ✅ PASS |
| Working tree clean after commit | ✅ PASS |
