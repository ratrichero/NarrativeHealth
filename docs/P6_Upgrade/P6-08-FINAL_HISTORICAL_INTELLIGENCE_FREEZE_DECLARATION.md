# P6-08-FINAL — Historical Intelligence Freeze Declaration

**Date:** 2026-08-27
**Phase:** P6-08 Historical Intelligence / Temporal Comparison
**Status:** FROZEN
**Previous:** P6-08E hardening audit (`READY FOR PLANNER FREEZE`)

---

## 1. Executive Summary

P6-08 — Historical Intelligence / Temporal Comparison — is formally frozen.

All five Planner decisions (PD-08A-01, PD-08A-02, PD-08A-03, PD-08C-03, PD-08C-04) are verified FROZEN. All twelve presentation invariants (PH-01…PH-12) are verified PASS with zero violations. All frozen upstream contracts (P6-01…P6-07) remain untouched. P4 and P5 remain untouched. P5 replay remains untouched. Legacy contamination audit clean. No action/BUY/SELL semantics. No persistence writes. No findings.

**P6-08 IS FROZEN.**

---

## 2. P6-08 Scope

P6-08 is the **Historical Intelligence / Temporal Comparison Layer** — a read-layer extension over frozen P6-01…P6-07 artifacts that provides temporal depth.

Frozen scope covers:

1. Historical snapshot browsing via `readSnapshotHistory()`
2. Current vs N-day-ago comparison (7d, 30d)
3. Baseline comparison (first-observed snapshot)
4. Regime transition timeline from `readRegimeHistory()`
5. Warning lifecycle history from `readWarningHistory()`
6. Historical intelligence summary retrieval via `readSummaryHistory()`
7. Coin and narrative historical comparison
8. Narrative membership-aware historical comparison
9. Gap handling for missing snapshots
10. Algorithm version display alongside historical data
11. Provenance traceability for comparison results
12. Read APIs (`GET /api/p6/history/[entityType]/[id]`)

---

## 3. Frozen Planner Decisions

| Decision | Frozen Resolution |
|---|---|
| **PD-08A-01** | Derive on-read — no new persistence. Historical comparison results are derived from persisted authoritative artifacts. No `p6_historical_*` tables. No INSERT/UPDATE/DELETE in `src/lib/p6/historical/`. |
| **PD-08A-02** | V1 comparison windows: 7d (short-term), 30d (medium-term), baseline (first-observed). No additional user-configurable windows. All timestamps deterministic. |
| **PD-08A-03** | Narrative historical comparison uses membership at comparison time. Historical membership reconstructed from `narrative_membership_events` table. Current membership NOT applied retrospectively. |
| **PD-08C-03** | Warning occurrence matching: `entity_type + entity_id + warning_type + detection_window`. Within per-entity scope, `warning_type + detection_window` uniquely identifies a warning occurrence. P6-05 warning identity remains authoritative. |
| **PD-08C-04** | Membership reconstruction: latest event per coin at `effective_at ≤ T`. Deterministic event ordering: primary `effective_at DESC`, secondary `id DESC`. Filter: `eventType ≠ 'REMOVED'`. |

All five decisions are ACCEPTED and now FROZEN.

---

## 4. Frozen Architecture

```text
P6-01 → P6-02 → P6-03 → P6-04 → P6-05 → P6-06 → P6-07
                                                    ↓
                                              P6-08 (read extension)
                                                    ↓
                                    Historical comparison (derive on-read)
                                                    ↓
                                    /api/p6/history/[entityType]/[id]
                                                    ↓
                                    ComparisonResult + HealthTimeline
```

Refresh path (unchanged from P6-07):

```text
/api/refresh
    ↓
P6-03 (snapshot generation)
    ↓
P6-04 → P6-05 → P6-06 (downstream pipeline)
```

P6-08 is a read-layer extension, not a pipeline stage. It consumes the same frozen artifacts as P6-07 but provides temporal depth.

---

## 5. Frozen Read API Surface

```text
GET /api/p6/history/[entityType]/[id]?window=7d|30d|baseline
GET /api/p6/history/[entityType]/[id]?timeline=true
```

Properties:

- GET/read-only — no POST, PUT, DELETE, or PATCH
- Derive on-read — no persistence side effects
- Deterministic — same inputs → same output
- P6-native — no P3/P4/P5 data consumed
- `force-dynamic` prevents static caching
- Invalid entity type → 400
- Invalid entity ID → 400
- Entity not found → 404
- Invalid window parameter → 400

Do not add new endpoints during the freeze period.

---

## 6. Comparison Contract

Frozen comparison model:

```text
P6 domain artifacts (snapshots, regime, warnings, summaries)
        ↓
historical snapshot selection (deterministic, nearest-at-or-before)
        ↓
membership reconstruction (PD-08C-04, event-sourced)
        ↓
warning comparison (PD-08C-03, occurrence-based)
        ↓
delta calculation (health, confidence, regime, warnings)
        ↓
ComparisonResult (transient, not persisted)
```

The comparison layer MUST NOT:

- persist comparison results (PD-08A-01)
- recalculate P6-03/04/05/06 semantics
- create new intelligence
- introduce action/BUY/SELL semantics
- modify P4/P5

---

## 7. Comparison Windows (PD-08A-02)

| Window | Description | API Parameter |
|---|---|---|
| **7 days** | Short-term comparison | `?window=7` |
| **30 days** | Medium-term comparison | `?window=30` |
| **Baseline** | First-observed snapshot | `?window=baseline` |

Window resolution:

- Current snapshot: most recent `window_end`
- Historical snapshot: nearest snapshot at or before `current_window_end − N days`
- Baseline: first snapshot in entity history
- Insufficient history: `insufficient_history = true` with honest reporting

---

## 8. Membership Contract (PD-08A-03, PD-08C-04)

### 8.1 Historical Membership

Membership at comparison time `T`:

```sql
-- Latest event per coin at effective_at ≤ T
SELECT DISTINCT ON (coin_id)
  coin_id, event_type, is_primary, effective_at
FROM narrative_membership_events
WHERE narrative_id = ? AND effective_at <= ?
ORDER BY coin_id, effective_at DESC, id DESC
```

Filter: `eventType ≠ 'REMOVED'` → member.

### 8.2 Edge Cases

| Scenario | Handling |
|---|---|
| No events | Empty members |
| ADDED → REMOVED | Not member |
| ADDED → REMOVED → ADDED | Member (latest wins) |
| Same `effective_at` | `id DESC` breaks tie |
| Future events | Excluded by `effective_at ≤ T` |

### 8.3 Membership Stability

If `narrative_membership_events` has no entries for a narrative:

- Assume current membership applies to all history
- `membership_changed = false`

---

## 9. Warning Comparison Contract (PD-08C-03)

Matching key: `warning_type + detection_window`

| Classification | Condition |
|---|---|
| **Matched** | Same key in both current and historical |
| **New** | In current but not historical |
| **Resolved** | In historical but not current |
| **Severity changed** | Same key, different severity |

P6-05 warning identity remains authoritative. P6-08 consumes P6-05 identity without redefining it.

---

## 10. Delta Calculation

### 10.1 Health Delta

```
health_delta = current.health_score − historical.health_score
```

- Both values present: numeric delta (2 decimal places)
- Either null: delta = null

### 10.2 Health Percentage

```
health_change_pct = (current − historical) / historical × 100
```

- `historical = 0 → pct = null` (PD-06C-03)
- Rounding: 2 decimal places

### 10.3 Confidence Delta

```
confidence_delta = current.confidence_score − historical.confidence_score
```

- Both values present: numeric delta
- Either null: delta = null

### 10.4 Regime Changed

```
regime_changed = current.regime_state ≠ historical.regime_state
```

- Literal comparison
- null ↔ value transitions count as changed

---

## 11. Quality / Freshness Boundary

**Frozen distinction from P6-07:**

```
QualityState ≠ Freshness
```

P6-08 preserves this distinction in historical views:

- `quality_metadata` and `freshness_metadata` are separate fields
- No merging, no derivation
- No new QualityState creation
- No infrastructure failure → quality degradation

---

## 12. Missing / Null / UNKNOWN Semantics

| Scenario | Behavior |
|---|---|
| No snapshot | `insufficient_history = true`, `data: null` |
| Null health_score | Display as unavailable; delta = null |
| Null confidence | Display as unavailable; delta = null |
| UNKNOWN regime | Display as-is |
| INSUFFICIENT_DATA regime | Display as-is |
| No warnings | Empty array |
| No membership events | Empty members |
| Incomplete history | `insufficient_history = true` with honest reporting |

**No fabrication in any case.**

---

## 13. Provenance

Every comparison result exposes:

| Field | Description |
|---|---|
| `comparison_algorithm` | `"p6-comparison-v1"` |
| `calculated_at` | ISO timestamp |
| `current_snapshot_id` | P6-03 snapshot ID |
| `current_snapshot_window_end` | ISO timestamp |
| `historical_snapshot_id` | P6-03 snapshot ID |
| `historical_snapshot_window_end` | ISO timestamp |
| `membership_reconstructed` | boolean |
| `membership_event_count` | number |

Full provenance chain: `Comparison → source artifacts → source observations`.

---

## 14. Versioning

P6-08 uses its own independent version tuple:

```typescript
{
  comparison_algorithm_version: "p6-comparison-v1",
  snapshot_version: "p6-snapshot-v1",
  regime_version: "p6-regime-v1",
  warning_version: "p6-warning-v1",
}
```

Not reusing P6-06 version identifiers. Version displayed alongside historical data.

---

## 15. PH-01…PH-12 Invariant Audit

| ID | Invariant | Class | Result |
|---|---|---|---|
| **PH-01** | Deterministic comparison | B | ✅ PASS |
| **PH-02** | No fabrication | A | ✅ PASS |
| **PH-03** | No recalculation | A | ✅ PASS |
| **PH-04** | Insufficient history honest | B | ✅ PASS |
| **PH-05** | Version display | B | ✅ PASS |
| **PH-06** | Membership accuracy | A | ✅ PASS |
| **PH-07** | No new persistence | A | ✅ PASS |
| **PH-08** | Read-only | A | ✅ PASS |
| **PH-09** | P6-native only | A | ✅ PASS |
| **PH-10** | No action semantics | A | ✅ PASS |
| **PH-11** | Quality ≠ Freshness | A | ✅ PASS |
| **PH-12** | Gap explicit | B | ✅ PASS |

```
PH-01…PH-12 = 12/12 PASS
0 violations
```

---

## 16. P6-01…P6-07 Integrity

| Phase | Status |
|---|---|
| P6-01 Observation/Quality | ✅ FROZEN — untouched |
| P6-02 Derived Features | ✅ FROZEN — untouched |
| P6-03 Intelligence Snapshot | ✅ FROZEN — untouched (additive `readSnapshotHistory()` only) |
| P6-04 Trend/Regime | ✅ FROZEN — untouched |
| P6-05 Early Warning | ✅ FROZEN — untouched |
| P6-06 Intelligence Aggregation | ✅ FROZEN — untouched (additive `readSummaryHistory()` only) |
| P6-07 Intelligence Presentation | ✅ FROZEN — untouched |

No frozen P6-01…P6-07 contract is modified by P6-08.

---

## 17. P4 Boundary

| Check | Result |
|---|---|
| P4 code modified | ❌ NO |
| P4 semantics reinterpreted | ❌ NO |
| P4 data consumed by P6-08 | ❌ NO |
| P4 decision support in P6-08 | ❌ NO |
| P4 policy semantics | ❌ NO |
| P4 imports in P6-08 | ❌ NONE FOUND |

**P4 untouched.**

---

## 18. P5 Boundary

| Check | Result |
|---|---|
| P5 code modified | ❌ NO |
| P5 semantics reinterpreted | ❌ NO |
| P5 action semantics in P6-08 | ❌ NO |
| P5 bridge created | ❌ NO |
| BUY/SELL vocabulary in P6 | ❌ NOT FOUND |
| Decision semantics in P6 | ❌ NOT FOUND |
| P5 imports in P6-08 | ❌ NONE FOUND |

**P5 untouched.**

---

## 19. P5 Replay Boundary

| Check | Result |
|---|---|
| P5 replay semantics changed | ❌ NO |
| P5 replay dependency created in P6 | ❌ NO |
| Historical decision artifacts modified | ❌ NO |
| P5 bridge created | ❌ NO |

**P5 replay untouched. No replay contamination.**

---

## 20. Persistence Boundary

| Check | Result |
|---|---|
| No INSERT in P6-08 module | ✅ VERIFIED |
| No UPDATE in P6-08 module | ✅ VERIFIED |
| No DELETE in P6-08 module | ✅ VERIFIED |
| No UPSERT in P6-08 module | ✅ VERIFIED |
| No new schema tables | ✅ VERIFIED |
| No migrations | ✅ VERIFIED |
| Read-only functions only | ✅ VERIFIED |

**PD-08A-01: Derive on-read — FROZEN.**

---

## 21. Legacy Contamination Audit

| Legacy Component | Consumed by P6-08 |
|---|---|
| `p3NarrativeIntelligence` | ❌ No |
| `morning_snapshots` | ❌ No |
| `decisionSignals` | ❌ No |
| `narrativeMomentum` | ❌ No |
| `healthTimelineService` | ❌ No |
| P3 intelligence | ❌ No |
| P4 decision support | ❌ No |
| P5 action history | ❌ No |

**No legacy contamination.**

---

## 22. Forbidden Semantics Audit

| Forbidden Term | Found in P6-08 Production Code |
|---|---|
| BUY | ❌ No |
| SELL | ❌ No |
| EXECUTE | ❌ No |
| APPROVE | ❌ No |
| POLICY | ❌ No |
| TRADE | ❌ No |
| POSITION | ❌ No |
| ORDER | ❌ No |

**No action semantics. No trading semantics.**

---

## 23. Regression Results

| Suite | Tests | Result |
|---|---|---|
| P6-08 | **121** | ✅ PASS |
| P6 (full) | **903** | ✅ PASS |
| P4 | **150** | ✅ PASS |
| P5 | **287** | ✅ PASS |
| TypeScript | — | ✅ PASS |
| **Total** | **1461** | **PASS** |

---

## 24. Findings

| Class | Count |
|---|---|
| **Class A — BLOCKING** | **0** |
| **Class B — CONTRACT VIOLATION** | **0** |
| **Class C — NON-BLOCKING** | **0** |
| **Class D — DEFERRED** | **0** |

---

## 25. Freeze Conditions

| Condition | Status |
|---|---|
| PD-08A-01 frozen | ✅ |
| PD-08A-02 frozen | ✅ |
| PD-08A-03 frozen | ✅ |
| PD-08C-03 frozen | ✅ |
| PD-08C-04 frozen | ✅ |
| PH-01…PH-12 = 12/12 PASS | ✅ |
| 0 PH violations | ✅ |
| P6-01…P6-07 untouched | ✅ |
| P4 untouched | ✅ |
| P5 untouched | ✅ |
| P5 replay untouched | ✅ |
| No action semantics | ✅ |
| No BUY/SELL vocabulary | ✅ |
| No persistence writes | ✅ |
| Regression tests pass | ✅ |
| Git boundary clean | ✅ |
| Freeze declaration committed | ✅ |

---

## 26. Git Boundary

| Check | Result |
|---|---|
| Only P6-08 files changed | ✅ PASS |
| No frozen P6-01…P6-07 contract modifications | ✅ PASS |
| No P4/P5 modifications | ✅ PASS |
| No new persistence tables | ✅ PASS |
| No schema migrations | ✅ PASS |
| Additive read functions only | ✅ PASS |
| Working tree clean after commit | ✅ PASS |

---

## 27. P6 Pipeline Final State

```
P6-01 Observation / Quality       FROZEN
P6-02 Derived Features            FROZEN
P6-03 Intelligence Snapshot       FROZEN
P6-04 Trend / Regime              FROZEN
P6-05 Early Warning               FROZEN
P6-06 Intelligence Aggregation    FROZEN
P6-07 Intelligence Presentation   FROZEN
P6-08 Historical Intelligence     FROZEN
```

---

## 28. Final Freeze Declaration

```
P6-08 IS FROZEN
```

Frozen decisions:

```
PD-08A-01  Derive on-read           FROZEN
PD-08A-02  Comparison windows       FROZEN
PD-08A-03  Membership at time       FROZEN
PD-08C-03  Warning matching         FROZEN
PD-08C-04  Membership reconstruction FROZEN
```

Invariant state:

```
PH-01…PH-12 = 12/12 PASS
0 violations
```

Pipeline status:

```
P6-01 → P6-02 → P6-03 → P6-04 → P6-05 → P6-06 → P6-07 → P6-08
  ✅       ✅       ✅       ✅       ✅       ✅       ✅       ✅
```

All P6 phases through P6-08 are now frozen. The P6 intelligence pipeline is complete from observation through historical comparison.
