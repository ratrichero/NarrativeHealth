# P4-P5-COMPLETION-01 — PRODUCTION READ-BACK & UI CLOSURE AUDIT

**Date:** 2026-08-19  
**Status:** RECON COMPLETE — IMPLEMENTATION REQUIRED

---

## 1. Objective

Audit the full P5 read-back chain from persisted artifacts to UI and determine the minimal wiring required to close the GAP-P5-UI-01.

## 2. Current State Audit

### 2.1 P5 ActionDecisionPanel (UI)

**File:** `src/components/P5ActionDecisionPanel.tsx`

**Status:** ✅ COMPLETE

- Fetches from `/api/narratives/${narrativeId}/action-decision`
- Renders `P5ActionDecisionReadViewModel` with all orthogonal state dimensions
- Correctly distinguishes ABSENT / UNAVAILABLE from domain outcomes
- Does NOT re-evaluate P5 — reads only

### 2.2 Action Decision API Route

**File:** `src/app/api/narratives/[id]/action-decision/route.ts`

**Status:** ✅ COMPLETE

- GET-only, read-only
- Uses `actionReadService.getNarrativeActionReadView(narrativeId)`
- Returns `{ success, data: { p5ActionDecision } }`

### 2.3 ActionReadService (P5-06)

**File:** `src/lib/p5/read/action-read.service.ts`

**Status:** ⚠️ INCOMPLETE — uses NoP5DecisionStore

- `actionReadService` singleton uses default `NoP5DecisionStore`
- `NoP5DecisionStore.findBySubject()` always returns `null`
- **Result:** Every request returns `ABSENT` / `NO_DECISION_RECORD` even when a decision exists in PostgreSQL

### 2.4 PgHistoricalArtifactStore (P5-08)

**File:** `src/lib/p5/replay/pg-artifact-store.ts`

**Status:** ✅ COMPLETE

- `PgHistoricalArtifactStore.findDecision(decisionId)` — reads from `p5_decision_records`
- `PgHistoricalArtifactWriter` — inserts idempotently via `identity_key`
- Production wiring: `DrizzleP5RowStore` wraps real drizzle client

### 2.5 P5-09 Recorder

**File:** `src/lib/p5/record/p5-artifact-recorder.ts`

**Status:** ✅ COMPLETE

- Records `P5DecisionRecord` + all sub-artifacts
- Uses `PgHistoricalArtifactWriter` for persistence
- Idempotent via `identity_key`

### 2.6 P5-10 Producer

**File:** `src/lib/p5/producer/p5-decision-producer.ts`

**Status:** ✅ COMPLETE

- Assembles `P5DecisionRecord` from upstream results
- Commits through `P5ArtifactRecorder`

### 2.7 P5-11 Integration

**File:** `src/lib/p5/integration/p5-runtime-adapter.ts`

**Status:** ✅ COMPLETE

- Wires P5-03 → P5-04 → P5-05 → P5-10 chain
- Invoked by `GET /api/narratives/[id]`

## 3. Gap Analysis

| Component | Status | Gap |
|---|---|---|
| P5ActionDecisionPanel | ✅ | None |
| action-decision route | ✅ | None |
| ActionReadService | ⚠️ | **Uses NoP5DecisionStore** |
| PgHistoricalArtifactStore | ✅ | None |
| P5-09 Recorder | ✅ | None |
| P5-10 Producer | ✅ | None |
| P5-11 Integration | ✅ | None |

## 4. Root Cause

`ActionReadService` is wired to `NoP5DecisionStore` (always returns null).

**Fix required:** Wire `ActionReadService` to use `PgHistoricalArtifactStore` in production.

## 5. Minimal Wiring Solution

### 5.1 Changes Required

1. **Create `src/lib/p5/read/production.ts`** — production wiring that injects `PgHistoricalArtifactStore` into `ActionReadService`

2. **Update `src/lib/p5/read/action-read.service.ts`** — export `ActionReadService` class (already done) and add production singleton import

3. **Update action-decision route** — import production singleton

### 5.2 Architecture

```
GET /api/narratives/[id]/action-decision
    ↓
actionReadService.getNarrativeActionReadView(narrativeId)
    ↓
PgHistoricalArtifactStore.findBySubject({ narrativeId })
    ↓
PostgreSQL p5_decision_records
    ↓
P5ActionDecisionReadViewModel
```

### 5.3 No Frozen Contract Changes

- P5-03/04/05/07/08/09/10/11 remain UNTOUCHED
- ActionReadService contract remains UNTOUCHED
- Only production wiring changes

## 6. Identity Verification

The `P5DecisionRecord.decisionId` is the same value used by:
- P5-09 recorder (persisted as `identity_key`)
- PgHistoricalArtifactStore (queried by `identityKey`)
- ActionReadService (displayed in UI)

**Same decisionId guaranteed across write/read/UI.**

## 7. Absence Preservation

When no decision record exists:
- `ActionReadService` returns `availability: "NO_DECISION_RECORD"`
- UI renders "ABSENT" — NOT "NO_ACTION"
- `NO_DECISION_RECORD` ≠ `NO_ACTION` (preserved)

## 8. Provenance Chain

```
P4 snapshot
    ↓
P5-11 (P5-03 → P5-04 → P5-05 → P5-10)
    ↓
P5-09 (persisted to PostgreSQL)
    ↓
PgHistoricalArtifactStore (read from PostgreSQL)
    ↓
ActionReadService (presentView)
    ↓
P5ActionDecisionPanel (UI)
```

No live re-query of P4 after decision is recorded.

## 9. Acceptance Gates

| Gate | Status |
|---|---|
| Production read path uses persisted P5 artifacts | ⚠️ BLOCKED — NoP5DecisionStore |
| No NoP5DecisionStore in production read path | ❌ FAIL |
| Same decisionId write/read/UI | ✅ (once wired) |
| No second decision evaluation for UI | ✅ |
| No frozen semantic contract changed | ✅ |
| Historical snapshot preserved | ✅ |
| NO_DECISION_RECORD ≠ NO_ACTION | ✅ |
| P4/P5 provenance intact | ✅ |
| P5 regression remains green | ✅ |
| Typecheck clean | ✅ |
| Documentation reconciled | ⚠️ PENDING |

## 10. Files Changed (Recon Only)

**ZERO production code changes in this recon phase.**

## 11. Recommendation

**Proceed to implementation.** The gap is minimal:
- Create `src/lib/p5/read/production.ts` (wiring)
- Update action-decision route import
- Add integration test
- Update P5-06 documentation

No frozen contracts require modification.
