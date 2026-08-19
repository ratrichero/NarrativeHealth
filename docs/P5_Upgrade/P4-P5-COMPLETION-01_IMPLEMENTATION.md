# P4-P5-COMPLETION-01 — PRODUCTION READ-BACK & UI CLOSURE

**Date:** 2026-08-19  
**Status:** IMPLEMENTATION COMPLETE

---

## 1. Objective

Wire the P5-06 ActionReadService to read persisted P5 decision artifacts from PostgreSQL, closing the GAP-P5-UI-01.

## 2. Changes Made

### 2.1 PgHistoricalArtifactStore — findByNarrativeId

**File:** `src/lib/p5/replay/pg-artifact-store.ts`

Added `findDecisionByNarrativeId(narrativeId)` method to support narrative-scoped lookup.

**Rationale:** The `ActionReadService.findBySubject()` requires lookup by `narrativeId`. The `p5_decision_records` table has a `narrative_id` column with an index, enabling efficient narrative-scoped queries.

### 2.2 Production Wiring — ActionReadService

**File:** `src/lib/p5/read/production.ts` (NEW)

Created `PgP5DecisionStoreAdapter` bridging `PgHistoricalArtifactStore` to `ActionReadService`'s `P5DecisionStore` interface.

```typescript
class PgP5DecisionStoreAdapter implements P5DecisionStore {
  async findByDecisionId(decisionId) {
    return pgHistoricalArtifactStore.findDecision(decisionId);
  }
  async findBySubject({ narrativeId }) {
    return pgHistoricalArtifactStore.findDecisionByNarrativeId(narrativeId);
  }
}

export const productionActionReadService = new ActionReadService({
  store: new PgP5DecisionStoreAdapter(),
});
```

### 2.3 Action Decision Route — Production Wiring

**File:** `src/app/api/narratives/[id]/action-decision/route.ts`

Changed import from `actionReadService` (NoP5DecisionStore) to `productionActionReadService` (PgHistoricalArtifactStore).

### 2.4 Test Update

**File:** `src/lib/p5/replay/__tests__/pg-artifact-store.test.ts`

Updated G1 gate to include `findDecisionByNarrativeId` in the expected method list.

## 3. Architecture

```
GET /api/narratives/[id]/action-decision
    ↓
productionActionReadService.getNarrativeActionReadView(narrativeId)
    ↓
PgP5DecisionStoreAdapter.findBySubject({ narrativeId })
    ↓
PgHistoricalArtifactStore.findDecisionByNarrativeId(narrativeId)
    ↓
DrizzleP5RowStore.findFirst(p5_decision_records, { narrativeId }, "id")
    ↓
PostgreSQL p5_decision_records (indexed on narrative_id)
    ↓
P5DecisionRecord (JSONB)
    ↓
P5ActionDecisionReadViewModel
    ↓
P5ActionDecisionPanel (UI)
```

## 4. Decision Identity Verification

| Stage | Value |
|---|---|
| P5-10 produces | `decisionId` |
| P5-09 persists | `identity_key = decisionId` |
| PgHistoricalArtifactStore reads | `identity_key = decisionId` |
| ActionReadService displays | `decisionId` |

**Same decisionId guaranteed across write → read → UI.**

## 5. Absence Preservation

When no decision record exists:

1. `PgP5DecisionStoreAdapter.findBySubject()` returns `null`
2. `ActionReadService.getNarrativeActionReadView()` falls through to P4 context lookup
3. Returns `availability: "NO_DECISION_RECORD"`, `displayState: "ABSENT"`
4. UI renders "ABSENT" — NOT "NO_ACTION"

**`NO_DECISION_RECORD` ≠ `NO_ACTION` preserved.**

## 6. Provenance Chain

```
P4 snapshot (live)
    ↓
P5-11 (P5-03 → P5-04 → P5-05 → P5-10)
    ↓
P5-09 (persisted to PostgreSQL with provenance)
    ↓
PgHistoricalArtifactStore (read from PostgreSQL)
    ↓
ActionReadService (presentView — uses record.provenance.p4SnapshotRef)
    ↓
P5ActionDecisionPanel (UI — displays provenance)
```

No live re-query of P4 after decision is recorded. Historical snapshot preserved in record provenance.

## 7. Frozen Contract Compliance

| Component | Modified? |
|---|---|
| P5-03 Policy | ❌ NO |
| P5-04 Safety | ❌ NO |
| P5-05 Explanation | ❌ NO |
| P5-07 Replay | ❌ NO |
| P5-08 Artifact Store | ⚠️ MINOR — added `findDecisionByNarrativeId` |
| P5-09 Recorder | ❌ NO |
| P5-10 Producer | ❌ NO |
| P5-11 Integration | ❌ NO |
| P5-06 ActionReadService | ❌ NO (contract unchanged) |

**Note:** `findDecisionByNarrativeId` is an additive read method on `PgHistoricalArtifactStore`. It does not modify the frozen `HistoricalArtifactStore` interface used by replay. It is a read-only method consistent with P5-08's read-only boundary.

## 8. Acceptance Gates

| Gate | Status |
|---|---|
| Production read path uses persisted P5 artifacts | ✅ PASS |
| No NoP5DecisionStore in production read path | ✅ PASS |
| Same decisionId write/read/UI | ✅ PASS |
| No second decision evaluation for UI | ✅ PASS |
| No frozen semantic contract changed | ✅ PASS |
| Historical snapshot preserved | ✅ PASS |
| NO_DECISION_RECORD ≠ NO_ACTION | ✅ PASS |
| P4/P5 provenance intact | ✅ PASS |
| P5 regression remains green | ✅ PASS (258/258) |
| Typecheck clean | ✅ PASS |
| Documentation reconciled | ✅ PASS |

## 9. Test Results

| Suite | Tests | Result |
|---|---|---|
| P5 full regression | 258 | **ALL PASS** |
| Typecheck | — | **CLEAN** (exit 0) |

## 10. Files Changed

| File | Change |
|---|---|
| `src/lib/p5/replay/pg-artifact-store.ts` | Added `findDecisionByNarrativeId` |
| `src/lib/p5/read/production.ts` | **NEW** — production wiring |
| `src/app/api/narratives/[id]/action-decision/route.ts` | Updated to use production wiring |
| `src/lib/p5/replay/__tests__/pg-artifact-store.test.ts` | Updated G1 gate |
| `docs/P5_Upgrade/P4-P5-COMPLETION-01_RECON.md` | **NEW** — recon document |
| `docs/P5_Upgrade/P4-P5-COMPLETION-01_IMPLEMENTATION.md` | THIS FILE |

## 11. Git Boundary

**Production source files modified:** 3 (pg-artifact-store.ts, production.ts, route.ts)  
**Test files modified:** 1 (pg-artifact-store.test.ts)  
**Documentation created:** 2 (recon + implementation)  
**Frozen P5-03/04/05/07/09/10/11:** UNTOUCHED  
**P4/P3:** UNTOUCHED

## 12. Summary

GAP-P5-UI-01 is closed. The production read path now reads persisted P5 decision artifacts from PostgreSQL:

- `GET /api/narratives/[id]/action-decision` → `productionActionReadService` → `PgHistoricalArtifactStore` → PostgreSQL
- UI displays the exact same `decisionId` that was persisted by P5-09
- Absence (`NO_DECISION_RECORD`) remains distinct from domain outcomes (`NO_ACTION`)
- Provenance chain intact: P4 → P5 → persisted → read → UI
- No frozen contracts modified
- 258/258 tests pass, typecheck clean
