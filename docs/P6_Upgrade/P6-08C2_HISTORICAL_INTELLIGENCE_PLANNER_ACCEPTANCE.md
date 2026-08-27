# P6-08C2 — Historical Intelligence / Temporal Comparison Planner Acceptance

**Date:** 2026-08-27
**Phase:** P6-08 Historical Intelligence
**Status:** PLANNER ACCEPTANCE COMPLETE
**Previous:** P6-08C1 decision contract (`READY FOR PLANNER ACCEPTANCE`)

---

## 1. Executive Summary

P6-08C2 performs the formal Planner acceptance gate for the five blocking P6-08 decisions. Each decision has been independently verified against:

- P6-01…P6-07 frozen contracts
- Existing schema semantics
- Deterministic behavior
- Historical reproducibility
- No hidden assumptions
- Downstream implementation impact
- Safety checks (no BUY/SELL, no P4/P5 modification, no replay contamination)

**All 5 decisions are ACCEPTED.**

```
ACCEPT PD-08A-01    (persist vs derive: derive on-read)
ACCEPT PD-08A-02    (comparison windows: 7d, 30d, baseline)
ACCEPT PD-08A-03    (membership: at comparison time)
ACCEPT PD-08C-03    (warning matching: warning_type + detection_window)
ACCEPT PD-08C-04    (membership reconstruction: latest event per coin at effective_at ≤ T)
```

**No hidden blocking decisions discovered.**

**FINAL VERDICT: READY FOR P6-08D**

---

## 2. Decision Evaluation

### 2.1 PD-08A-01 — Persistence Model

**Question:** Persist historical comparison results or derive on-read?

**Proposed:** Derive on-read — no new persistence.

**Evaluation:**

| Criterion | Result |
|---|---|
| Consistency with P6-01…P6-07 | ✅ No comparison tables exist in schema; no persistence contract violated |
| Schema semantics | ✅ No `p6_historical_comparisons` or similar table exists; derive-on-read is schema-neutral |
| Deterministic behavior | ✅ V1 comparison is trivial subtraction/literal comparison; same inputs → same output |
| Historical reproducibility | ✅ Source artifacts are immutable once persisted (CURRENT/SUPERSEDED lifecycle); versioned |
| Hidden assumptions | ✅ None discovered; comparison is a pure function of persisted data |
| Downstream impact | ✅ Stateless GET endpoints; no cache invalidation; simpler implementation |

**Evidence:**

- `src/db/schema.ts`: No comparison-related tables exist
- `src/lib/p6/snapshot/persistence.ts`: Snapshots persist with `window_end` identity; historical rows retained as SUPERSEDED
- `src/lib/p6/aggregation/persistence.ts`: Summaries persist with UPSERT; different `window_end` rows retained as SUPERSEDED
- TypeScript compilation: PASS (0 errors)

**Safety check:**

| Check | Result |
|---|---|
| BUY/SELL semantics | ❌ Not present |
| Trading signals | ❌ Not present |
| Action semantics | ❌ Not present |
| P4 modification | ❌ None |
| P5 modification | ❌ None |
| P5 replay dependency | ❌ None |
| QualityState reinterpretation | ❌ None |
| Freshness → Quality reinterpretation | ❌ None |
| P6-01…P6-07 mutation | ❌ None |
| Legacy P3 intelligence | ❌ None |

**RESULT: ACCEPT PD-08A-01**

---

### 2.2 PD-08A-02 — Comparison Windows

**Question:** What are the default historical comparison windows?

**Proposed:** 7d, 30d, baseline (first-observed snapshot).

**Evaluation:**

| Criterion | Result |
|---|---|
| Consistency with P6-01…P6-07 | ✅ Window selection is a parameter, not a semantic change to frozen contracts |
| Schema semantics | ✅ No schema impact; windows are query parameters |
| Deterministic behavior | ✅ Fixed windows produce deterministic reference points |
| Historical reproducibility | ✅ Same window → same reference snapshot selection |
| Hidden assumptions | ✅ None; baseline = first-observed snapshot (PD-08A-06 safe default) |
| Downstream impact | ✅ API parameter contract: `?window=7`, `?window=30`, `?window=baseline` |

**Rationale for window set:**

- **7d**: Covers short-term changes (weekly view); practical for daily refresh cadence
- **30d**: Covers medium-term trends (monthly view); sufficient for regime transition analysis
- **Baseline**: Provides all-time perspective; first-observed snapshot as reference
- **No 14d**: Overlaps with 7d; adds complexity without clear value
- **No 90d**: May exceed available history for new entities; 30d is more practical
- **No custom ranges**: Deferred to future; requires additional UI/API complexity

**Safety check:** All safety checks PASS (same as PD-08A-01).

**RESULT: ACCEPT PD-08A-02**

---

### 2.3 PD-08A-03 — Historical Membership Semantics

**Question:** How should narrative membership changes affect historical comparison?

**Proposed:** Use membership at the comparison timestamp.

**Evaluation:**

| Criterion | Result |
|---|---|
| Consistency with P6-01…P6-07 | ✅ P6-03 snapshots capture member scores at calculation time; historical membership reconstruction is consistent with snapshot semantics |
| Schema semantics | ✅ `narrative_membership_events` table has `effective_at` (timestamp with timezone) enabling point-in-time queries; indexes support `(narrative_id, effective_at, id)` pattern |
| Deterministic behavior | ✅ Same membership events → same membership at time T; latest-event-per-coin is deterministic |
| Historical reproducibility | ✅ Membership events are immutable once recorded; `effective_at` is authoritative |
| Hidden assumptions | ✅ Edge case handled: no events → fall back to current membership (safe default) |
| Downstream impact | ✅ Narrative historical comparison uses reconstructed membership; coin historical comparison is unaffected |

**Evidence:**

- `src/db/schema.ts`: `narrative_membership_events` has `effective_at` (timezone-aware), `eventType` (ADDED/REMOVED/PRIMARY_SET), indexed on `(narrative_id, effective_at, id)`
- `src/lib/p6/snapshot/persistence.ts`: `persistNarrativeSnapshot()` uses current membership at calculation time; historical snapshots reflect membership at that time

**Why not current membership:**

Using current membership applied retrospectively would:

- Misrepresent historical narrative composition
- Include coins that were not members at the historical point
- Exclude coins that were members but have since been removed
- Make historical health scores incomparable to what was actually calculated

**Safety check:** All safety checks PASS (same as PD-08A-01).

**RESULT: ACCEPT PD-08A-03**

---

### 2.4 PD-08C-03 — Warning Occurrence Matching

**Question:** How are warning occurrences matched between comparison points?

**Proposed:** Match by `warning_type` + `detection_window`.

**Evaluation:**

| Criterion | Result |
|---|---|
| Consistency with P6-01…P6-07 | ✅ P6-05 frozen identity: `dedup_key = entity_type:entity_id:warning_type:detection_window`; within per-entity scope, `warning_type + detection_window` is equivalent |
| Schema semantics | ✅ `p6_warnings` has `warningType`, `detectionWindow`, `dedupKey` (unique); indexes support query pattern |
| Deterministic behavior | ✅ Same `warning_type` + `detection_window` → same occurrence; no ambiguity |
| Historical reproducibility | ✅ Warning records are immutable once persisted; `detectionWindow` is authoritative |
| Hidden assumptions | ✅ None; matching strategy is semantically equivalent to P6-05 identity within entity scope |
| Downstream impact | ✅ Warning comparison uses occurrence matching; recurring warning detection enabled |

**Evidence:**

- `src/lib/p6/warning/identity.ts`: `computeDedupKey()` joins `entity_type:entity_id:warning_type:detection_window`; unique constraint prevents duplicates
- `src/lib/p6/warning/persistence.ts`: `readWarningHistory()` returns all records ordered by `detected_at`

**Why not `dedup_key`:**

`dedup_key` includes `entity_type` and `entity_id`, which are redundant in a per-entity query. Matching by `warning_type` + `detection_window` is semantically equivalent within a single entity scope.

**Why not `warning_type` only:**

Too broad — would conflate different occurrences (same type on different days).

**Safety check:** All safety checks PASS (same as PD-08A-01).

**RESULT: ACCEPT PD-08C-03**

---

### 2.5 PD-08C-04 — Membership Reconstruction

**Question:** How is historical narrative membership reconstructed?

**Proposed:** Latest event per coin at `effective_at ≤ T`.

**Algorithm:**

```sql
SELECT DISTINCT ON (coin_id)
  coin_id, event_type, is_primary, effective_at
FROM narrative_membership_events
WHERE narrative_id = ? AND effective_at <= ?
ORDER BY coin_id, effective_at DESC, id DESC
```

Filter: only coins with latest event `event_type ≠ 'REMOVED'` are members.

**Evaluation:**

| Criterion | Result |
|---|---|
| Consistency with P6-01…P6-07 | ✅ Event-sourced model is consistent with P6-03 snapshot semantics; snapshots were calculated using membership at that time |
| Schema semantics | ✅ `narrative_membership_events` has indexes: `(narrative_id, effective_at, id)`, `(narrative_id, coin_id, effective_at, id)`, `(coin_id, effective_at)` — all support the query pattern |
| Deterministic behavior | ✅ `DISTINCT ON` + `ORDER BY coin_id, effective_at DESC, id DESC` is deterministic; tie-breaking by `id` ensures no ambiguity |
| Historical reproducibility | ✅ Events are immutable; same events → same membership at any T |
| Hidden assumptions | ✅ Edge cases documented: ADDED→REMOVED→ADDED (latest wins), no events (not member), same `effective_at` (id breaks tie) |
| Downstream impact | ✅ Membership reconstruction feeds into PD-08A-03 (membership at comparison time); narrative historical comparison depends on this |

**Edge case analysis:**

| Scenario | Handling | Correct? |
|---|---|---|
| Member added before T | Latest event is ADDED → member | ✅ |
| Member removed before T | Latest event is REMOVED → not member | ✅ |
| ADDED → REMOVED → ADDED | Latest event is ADDED → member | ✅ |
| No events for coin | Not in results → not member | ✅ |
| Events with same `effective_at` | `id DESC` breaks tie (insertion order) | ✅ |
| Member never existed | Not in events → not member | ✅ |
| Membership event gaps | Latest known state applies until next event | ✅ |

**Why not `narrative_membership_snapshots` only:**

Snapshots may not exist for all historical points; events are more granular and authoritative for point-in-time reconstruction.

**Why not snapshot + events hybrid:**

Adds complexity without clear benefit for V1. Events alone are sufficient.

**Safety check:** All safety checks PASS (same as PD-08A-01).

**RESULT: ACCEPT PD-08C-04**

---

## 3. Decision Summary

| ID | Question | Proposed | Result |
|---|---|---|---|
| **PD-08A-01** | Persist vs derive on-read? | Derive on-read | **ACCEPT** |
| **PD-08A-02** | Comparison windows? | 7d, 30d, baseline | **ACCEPT** |
| **PD-08A-03** | Membership handling? | At comparison time | **ACCEPT** |
| **PD-08C-03** | Warning matching? | `warning_type` + `detection_window` | **ACCEPT** |
| **PD-08C-04** | Membership reconstruction? | Latest event per coin at `effective_at ≤ T` | **ACCEPT** |

**5/5 ACCEPTED. 0 MODIFIED. 0 REJECTED.**

---

## 4. Hidden Blockers Discovered

**None.**

All 5 blocking decisions survived independent verification. No new blockers emerged from:

- Schema inspection
- Implementation inspection
- Test inspection
- Boundary audit
- Safety check

---

## 5. Invariant Impact

### 5.1 Invariants Satisfied by Accepted Decisions

| Invariant | Satisfied By | Status |
|---|---|---|
| PH-01 (deterministic comparison) | PD-08A-01 (derive on-read) | ✅ |
| PH-02 (no fabrication) | PD-08A-02 (fixed windows, explicit gaps) | ✅ |
| PH-03 (no recalculation) | PD-08A-01 (derive on-read) | ✅ |
| PH-04 (insufficient history honest) | PD-08A-02 (window resolution) | ✅ |
| PH-05 (version display) | PD-08A-01 (derive on-read) | ✅ |
| PH-06 (membership accuracy) | PD-08A-03 + PD-08C-04 | ✅ |
| PH-07 (no new persistence) | PD-08A-01 (derive on-read) | ✅ |
| PH-08 (read-only) | PD-08A-01 (derive on-read) | ✅ |
| PH-09 (P6-native only) | PD-08C-03 + PD-08C-04 | ✅ |
| PH-10 (no action semantics) | All decisions | ✅ |
| PH-11 (quality ≠ freshness) | All decisions | ✅ |
| PH-12 (gap explicit) | PD-08A-02 (window resolution) | ✅ |

### 5.2 Inherited Invariants Preserved

| Invariant | Status |
|---|---|
| PV-01 (P6-native only) | ✅ Preserved |
| PV-02 (no recalculation) | ✅ Preserved |
| PV-03 (read-only) | ✅ Preserved |
| PV-04 (deterministic) | ✅ Preserved |
| PV-10 (P4 untouched) | ✅ Preserved |
| PV-11 (P5 untouched) | ✅ Preserved |
| PV-12 (no action semantics) | ✅ Preserved |
| PV-13 (no BUY/SELL) | ✅ Preserved |
| PV-14 (no legacy contamination) | ✅ Preserved |

**21/21 invariants satisfied. 0 violations.**

---

## 6. P6-01 → P6-07 Boundary Result

| Phase | Status | Verification |
|---|---|---|
| P6-01 Observation/Quality | ✅ FROZEN — untouched | No code changes; P6-08 consumes indirectly via snapshots |
| P6-02 Derived Features | ✅ FROZEN — untouched | No code changes; P6-08 consumes indirectly via snapshots |
| P6-03 Intelligence Snapshot | ✅ FROZEN — untouched | No code changes; `readSnapshotHistory()` is a new read function, not a contract modification |
| P6-04 Trend/Regime | ✅ FROZEN — untouched | No code changes; `readRegimeHistory()` already exists |
| P6-05 Early Warning | ✅ FROZEN — untouched | No code changes; `readWarningHistory()` already exists |
| P6-06 Intelligence Aggregation | ✅ FROZEN — untouched | No code changes; summary history query is read-only |
| P6-07 Intelligence Presentation | ✅ FROZEN — untouched | No code changes; P6-08 extends with temporal depth |

**P6-01…P6-07 remain untouched. No frozen contract is modified.**

---

## 7. P4 Boundary Result

| Check | Result |
|---|---|
| P4 code modified | ❌ NO |
| P4 semantics reinterpreted | ❌ NO |
| P4 data consumed by P6-08 | ❌ NO |
| P4 decision support in P6-08 | ❌ NO |
| P4 policy semantics | ❌ NO |
| P4 imports in P6 code | ❌ NONE FOUND |

**P4 untouched.**

---

## 8. P5 Boundary Result

| Check | Result |
|---|---|
| P5 code modified | ❌ NO |
| P5 semantics reinterpreted | ❌ NO |
| P5 action semantics in P6-08 | ❌ NO |
| P5 bridge created | ❌ NO |
| BUY/SELL vocabulary in P6 | ❌ NOT FOUND (only negative tests asserting absence) |
| Decision semantics in P6 | ❌ NOT FOUND |
| P5 imports in P6 code | ❌ NONE FOUND |

**P5 untouched.**

---

## 9. P5 Replay Boundary Result

| Check | Result |
|---|---|
| P5 replay semantics changed | ❌ NO |
| P5 replay dependency created in P6 | ❌ NO |
| Historical decision artifacts modified | ❌ NO |
| P5 bridge created | ❌ NO |

**P5 replay untouched. No replay contamination.**

---

## 10. Git Boundary Result

| Check | Result |
|---|---|
| Working tree clean | ✅ PASS |
| No production code modified | ✅ PASS |
| No frozen contracts modified | ✅ PASS |
| P4/P5 untouched | ✅ PASS |
| P6-01…P6-07 untouched | ✅ PASS |
| No schema changes | ✅ PASS |
| No API changes | ✅ PASS |
| No test behavior changes | ✅ PASS |

**Git boundary clean.**

---

## 11. Decision Dependency Verification

The accepted decisions form a coherent dependency graph:

```
PD-08A-01 (derive on-read) ✅ ACCEPTED
    ↓
comparison artifact semantics = transient, not persisted
    ↓
read-time historical engine = stateless GET endpoints
    ↓
P6-08D implementation scope defined

PD-08A-02 (7d, 30d, baseline) ✅ ACCEPTED
    ↓
temporal comparison contract = fixed windows
    ↓
API/query semantics = ?window=7, ?window=30, ?window=baseline
    ↓
P6-08D API parameters defined

PD-08A-03 (membership at comparison time) ✅ ACCEPTED
    ↓
population reconstruction = historical membership
    ↓
coin/narrative comparison semantics = accurate population
    ↓
P6-08D narrative comparison logic defined

PD-08C-03 (warning_type + detection_window) ✅ ACCEPTED
    ↓
warning comparison = occurrence-based matching
    ↓
historical change semantics = recurring/persistent detection
    ↓
P6-08D warning comparison logic defined

PD-08C-04 (latest event per coin at effective_at ≤ T) ✅ ACCEPTED
    ↓
membership reconstruction = event-sourced
    ↓
narrative population correctness = point-in-time accuracy
    ↓
P6-08D membership reconstruction defined
```

**All dependencies resolved. No circular dependencies. No orphaned decisions.**

---

## 12. Safety Check Summary

| Safety Criterion | Result |
|---|---|
| BUY/SELL semantics | ✅ NOT PRESENT |
| Trading signals | ✅ NOT PRESENT |
| Action semantics | ✅ NOT PRESENT |
| Policy semantics | ✅ NOT PRESENT (only negative tests in P6 freshness) |
| P4 modification | ✅ NONE |
| P5 modification | ✅ NONE |
| P5 replay dependency | ✅ NONE |
| QualityState reinterpretation | ✅ NONE |
| Freshness → Quality reinterpretation | ✅ NONE |
| P6-01…P6-07 mutation | ✅ NONE |
| Legacy P3 intelligence | ✅ NONE |
| P4/P5 imports in P6 | ✅ NONE FOUND |

**All safety checks PASS.**

---

## 13. Implementation Readiness

With all 5 decisions accepted, P6-08D implementation scope is defined:

### 13.1 New Functions Required

1. `readSnapshotHistory()` in `src/lib/p6/snapshot/persistence.ts`
2. `readSummaryHistory()` in `src/lib/p6/aggregation/persistence.ts`
3. Membership reconstruction using `narrative_membership_events`

### 13.2 Comparison Engine (derive on-read)

1. Health timeline (all historical snapshots)
2. Current vs 7d comparison
3. Current vs 30d comparison
4. Current vs baseline comparison
5. Regime transition timeline
6. Warning lifecycle history

### 13.3 API Surface

1. `GET /api/p6/history/[entityType]/[id]` — health timeline + comparisons
2. `GET /api/p6/history/[entityType]/[id]/regime` — regime transition timeline
3. `GET /api/p6/history/[entityType]/[id]/warnings` — warning lifecycle history

### 13.4 Constraints

- No new persistence tables (PD-08A-01)
- Fixed windows only: 7d, 30d, baseline (PD-08A-02)
- Membership at comparison time (PD-08A-03)
- Warning matching by `warning_type` + `detection_window` (PD-08C-03)
- Membership reconstruction: latest event per coin at `effective_at ≤ T` (PD-08C-04)
- No modification to P6-01…P6-07 frozen contracts
- No modification to P4/P5 semantics

---

## 14. Final Verdict

```
READY FOR P6-08D
```

All 5 blocking decisions are ACCEPTED. No hidden blockers discovered. P6-01…P6-07 remain untouched. P4/P5 remain untouched. P5 replay remains untouched. 21/21 invariants satisfied. Git boundary clean.

P6-08D implementation may proceed with the accepted decisions as the authoritative contract.

---

## 15. Git Boundary (Final)

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
| Working tree clean after commit | ✅ PASS |
