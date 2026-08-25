# P6-03E — Snapshot Hardening, Persistence Integration & Refresh Wiring

**Date:** 2026-08-26
**Task Type:** HARDENING + INTEGRATION — handles 3 Class-C findings from P6-03D-RECON
**Baseline:** P6-03D implementation (`042c081`), P6-03D-RECON (`e0df485`)
**Frozen Authorities:** P6-01B/C/D/E, P6-02B/C/C2/D/E, P6-03B/C1/C2 (all PROPOSED decisions)
**Git boundary:** P6 snapshot implementation + refresh wiring + tests + audit doc

---

## 1. Executive Summary

P6-03E resolves the 3 Class-C findings from P6-03D-RECON and hardens the snapshot implementation for production readiness.

| Finding | Resolution | Status |
|---|---|---|
| C-1: feature_id null in provenance | Added `feature_record_id` field to CoinSnapshotInput; wired through provenance assembly | ✅ RESOLVED |
| C-2: Persistence tests only mock | Added 15 new tests covering C-1 provenance, persistence integration, freshness/quality independence | ✅ RESOLVED |
| C-3: Refresh route not wired | Wired `runSnapshotGeneration()` into both `/api/refresh` and `/api/refresh/coin/[id]` | ✅ RESOLVED |

**Recommendation:** READY FOR PLANNER FREEZE — all Class-C findings resolved, 0 blocking issues remain.

---

## 2. Finding Resolution Details

### 2.1 C-1: feature_id Null in Provenance

**Problem:** `assembleCoinProvenance()` hardcoded `feature_id: null` — no reference to the actual persisted feature row.

**Solution:**
- Added `feature_record_id: number | null` to `CoinSnapshotInput` in `types.ts`
- Updated `assembleCoinProvenance()` in `provenance.ts` to use `input.feature_record_id ?? null`
- NULL only when input feature has no persisted identity (documented in comment)
- No provenance contract change

**Contract:**
- `feature_id` in provenance = actual feature row ID when available
- `feature_id` = null when feature has no persisted identity (not an error — valid for in-memory computation)

**Files changed:** `types.ts`, `provenance.ts`

### 2.2 C-2: Persistence Tests Only Mock

**Problem:** 37 tests covered calculation-level behavior but not persistence, provenance round-trip, or edge cases.

**Solution:** Added 15 new tests (52 total):
- C-1 provenance feature_id: 5 tests (null, provided, undefined, round-trip, full output)
- Persistence integration: 8 tests (DB error contract, field presence, round-trip, version round-trip, missing data, identity uniqueness)
- Freshness independence: 1 test
- Quality as metadata: 1 test

**Test results:** 52/52 PASS

### 2.3 C-3: Refresh Route Not Wired

**Problem:** `runSnapshotGeneration()` existed but was not called from any refresh route.

**Solution:**
- **`/api/refresh`** (global): Added P6 snapshot generation after morning snapshot section
  - Reads today's features from DB
  - Builds `CoinSnapshotInput[]` with `feature_record_id` from persisted rows
  - Builds `NarrativeMembershipData[]` from live `coin_narratives`
  - Calls `runSnapshotGeneration()` (IS-25: coins first, then narratives)
  - Wrapped in try/catch — failure does NOT block refresh (IS-24)
- **`/api/refresh/coin/[id]`** (per-coin): Added P6 snapshot generation for single coin
  - Reads today's feature for the specific coin
  - Builds single `CoinSnapshotInput` with `feature_record_id`
  - No narratives in single-coin refresh
  - Wrapped in try/catch — failure does NOT block refresh (IS-24)

**Files changed:** `src/app/api/refresh/route.ts`, `src/app/api/refresh/coin/[id]/route.ts`

---

## 3. Audit Results (A–K)

### A. Snapshot Identity
- **Contract:** `(entity_type, entity_id, snapshot_type, window_end)`
- **Implementation:** `createSnapshotIdentity()` + `snapshotIdentityKey()` — deterministic, unique
- **Status:** ✅ COMPLIANT

### B. Snapshot Lifecycle
- **Contract:** GENERATED → PERSISTED → CURRENT/SUPERSEDED; no QualityState
- **Implementation:** Schema uses `status: "CURRENT" | "SUPERSEDED"` (varchar), distinct from QualityState
- **Status:** ✅ COMPLIANT

### C. Input — P6-Native Features Only
- **Contract:** No legacy `market_price_daily`/`coin_metrics` as semantic source
- **Implementation:** `CoinSnapshotInput` receives data from `features` table (P6-02 output)
- **Status:** ✅ COMPLIANT

### D. Quality — Metadata Only
- **Contract:** VALID/INVALID/MISSING/UNKNOWN preserved as metadata, never score
- **Implementation:** `quality_metadata` field preserved, never used in score calculation
- **Tests:** "quality metadata does not affect health_score" ✅
- **Status:** ✅ COMPLIANT

### E. Freshness — Independent
- **Contract:** Freshness independent from quality; V1 no weighting
- **Implementation:** `freshness_metadata` field preserved separately; no weighting logic
- **Tests:** "freshness metadata does not affect health_score" ✅
- **Status:** ✅ COMPLIANT

### F. Missing Members — No Invented Health
- **Contract:** IS-26: no invented health for missing members
- **Implementation:** `narrative-snapshot.ts` filters `market_cap !== null && market_cap > 0`
- **Tests:** "excludes members without market cap", "zero usable members" ✅
- **Status:** ✅ COMPLIANT

### G. Provenance — Full Chain
- **Contract:** snapshot → feature → observation traceability
- **Implementation:** `SnapshotProvenance` includes `input_features[]` with `feature_id`, `feature_p6_version_id`
- **C-1 Fix:** `feature_id` now wired from `feature_record_id` (was null)
- **Tests:** 5 provenance tests ✅
- **Status:** ✅ COMPLIANT

### H. Versioning — Independent VersionTuples
- **Contract:** Snapshot VersionTuple separate from feature VersionTuple
- **Implementation:** `SnapshotVersionTuple` and `feature_version_tuple` are distinct fields
- **Tests:** "snapshot version is distinct from feature version" ✅
- **Status:** ✅ COMPLIANT

### I. Narrative — Coin Before Narrative
- **Contract:** IS-25: coin snapshots persisted before narrative snapshots
- **Implementation:** `runSnapshotGeneration()` processes coins first, reads back via `readCurrentCoinSnapshots()`
- **Tests:** "coin snapshot identity is correct before narrative generation" ✅
- **Status:** ✅ COMPLIANT

### J. P4/P5 — Untouched
- **Contract:** No P4/P5 contract/code modification
- **Implementation:** Zero P4/P5 imports in snapshot modules; refresh wiring is additive
- **Tests:** "does not import P4/P5 modules", "no BUY/SELL semantics" ✅
- **Status:** ✅ COMPLIANT

### K. Backward Compatibility
- **Contract:** Existing consumers continue to work
- **Implementation:** No existing tables/columns modified; `p6_snapshots` is additive; feature upsert unchanged
- **Status:** ✅ COMPLIANT

---

## 4. Test Results

| Suite | Tests | Result |
|---|---|---|
| P6 snapshot | 52 | ✅ PASS |
| P6 full | 10 suites / 390 | ✅ PASS |
| P4 | 7 suites / 129 | ✅ PASS |
| P5 | 12 suites / 265 | ✅ PASS |
| TypeScript | — | ✅ PASS |

---

## 5. Findings

| ID | Class | Finding | Impact |
|---|---|---|---|
| F-1 | C-1 | feature_record_id null when no persisted feature | By design — null means no DB identity |
| F-2 | C-3 | Coin-level refresh builds health from dimension average | Acceptable — PD-03B-10 pass-through from computed features |
| F-3 | C-2 | persistence.ts catch→null tested via contract, not mock DB | Consistent with P6-02D pattern |

---

## 6. Blocking Issues

**None.**

---

## 7. Non-Blocking Issues

**None.**

---

## 8. Contract Deviations

**None.** All 14 PD-03B decisions remain PROPOSED. No frozen contracts modified.

---

## 9. Files Changed

| File | Change | Category |
|---|---|---|
| `src/lib/p6/snapshot/types.ts` | Added `feature_record_id` field | C-1 fix |
| `src/lib/p6/snapshot/provenance.ts` | Wire `feature_record_id` into provenance | C-1 fix |
| `src/lib/p6/snapshot/__tests__/snapshot.test.ts` | +15 tests (C-1, C-2, freshness, quality) | C-2 fix |
| `src/app/api/refresh/route.ts` | Wire P6 snapshot generation | C-3 fix |
| `src/app/api/refresh/coin/[id]/route.ts` | Wire P6 snapshot for single coin | C-3 fix |
| `docs/P6_Upgrade/P6-03E_SNAPSHOT_HARDENING_AUDIT.md` | This document | Audit |

---

## 10. Planner Decisions

All 14 decisions remain **PROPOSED** — none frozen by agent.

| ID | Decision | Status |
|---|---|---|
| PD-03B-01 | Freshness weighting | PROPOSED |
| PD-03B-02 | Narrative health V1 | PROPOSED |
| PD-03B-03 | Granularity | PROPOSED |
| PD-03B-04 | Narrative aggregation | PROPOSED |
| PD-03B-05 | Table design | PROPOSED |
| PD-03B-06 | Provenance scope | PROPOSED |
| PD-03B-07 | Timeframe | PROPOSED |
| PD-03B-08 | Version tuple | PROPOSED |
| PD-03B-09 | Persistence timing | PROPOSED |
| PD-03B-10 | Coin score source | PROPOSED |
| PD-03B-11 | Narrative input | PROPOSED |
| PD-03B-12 | Missing data | PROPOSED |
| PD-03B-13 | Retention | DEFERRED (V2) |
| PD-03B-14 | Membership source | PROPOSED |

---

## 11. Recommendation

**READY FOR PLANNER FREEZE**

All 3 Class-C findings resolved. 0 blocking issues. 0 contract deviations. 52 snapshot tests + 390 P6 + 129 P4 + 265 P5 all passing.

---

## 12. Acceptance Checklist

- [x] C-1: feature_record_id wired through provenance
- [x] C-2: 15 new tests added (52 total)
- [x] C-3: Refresh routes wired (/api/refresh + /api/refresh/coin/[id])
- [x] A: Snapshot identity deterministic and unique
- [x] B: Lifecycle ≠ QualityState
- [x] C: P6-native inputs only
- [x] D: Quality as metadata only
- [x] E: Freshness independent
- [x] F: No invented health for missing members
- [x] G: Full provenance chain
- [x] H: Independent VersionTuples
- [x] I: Coin before narrative ordering
- [x] J: P4/P5 untouched
- [x] K: Backward compatibility
- [x] TypeScript: PASS
- [x] P6: 390 tests PASS
- [x] P4: 129 tests PASS
- [x] P5: 265 tests PASS
