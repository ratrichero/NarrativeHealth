# P4-P5-COMPLETION-02 — IMPLEMENTATION

**Date:** 2026-08-19
**Status:** IMPLEMENTATION COMPLETE

---

## 1. Changes Made

### 1.1 NarrativeDetail Type (`src/types/index.ts`)

Added two new fields to `NarrativeDetail`:

```typescript
/** P5 Decision Record from the frozen pipeline, or null when unavailable. */
p5Decision: P5DecisionRecord | null;
/** P5 Action Decision read model (derived from persisted artifact), or null. */
p5ActionDecision: P5ActionDecisionReadViewModel | null;
```

Also added re-exports: `P5DecisionRecord`, `P5ActionDecisionReadViewModel`.

### 1.2 Narrative API Route (`src/app/api/narratives/[id]/route.ts`)

Added import: `productionActionReadService`

Added read model fetch (additive, read-only):
```typescript
let p5ActionRead: P5ActionDecisionReadViewModel | null = null;
try {
  p5ActionRead = await productionActionReadService.getNarrativeActionReadView(narrativeId);
} catch (error) {
  console.error("P5 Action Read failed:", error);
}
```

Added to response: `p5ActionDecision: p5ActionRead ?? null`

### 1.3 P5ActionDecisionPanel (`src/components/P5ActionDecisionPanel.tsx`)

Added optional `initialData` prop:
```typescript
function P5ActionDecisionPanel({
  narrativeId,
  initialData,
}: {
  narrativeId: number | string;
  initialData?: P5ActionDecisionReadViewModel | null;
})
```

Behavior:
- When `initialData` is provided → uses it directly (no fetch)
- When `initialData` is `undefined` → falls back to fetch from `/action-decision`
- When `initialData` is `null` → uses null (ABSENT state)

### 1.4 Narrative Detail Page (`src/app/narrative/[id]/page.tsx`)

Updated panel to use canonical data:
```typescript
<P5ActionDecisionPanel narrativeId={id} initialData={narrative.p5ActionDecision ?? null} />
```

### 1.5 Stale JSDoc (`src/lib/p5/read/action-read.service.ts`)

Updated `ActionReadService` class JSDoc:
- Removed: "the repository has no P5 decision persistence yet"
- Added: "production uses `productionActionReadService` which wires PgHistoricalArtifactStore"

Updated `NoP5DecisionStore` JSDoc:
- Removed: "no P5 decision persistence exists"
- Added: "test-only absence adapter... Production uses PgP5DecisionStoreAdapter"

Updated `actionReadService` singleton JSDoc:
- Changed: "absence store" → "test-only absence store"

### 1.6 Tests (`src/lib/p5/read/__tests__/canonical-flow.test.tsx`)

15 new tests covering:

| Test | What it verifies |
|---|---|
| Panel renders from initialData | Canonical data flow works |
| Displays provenance | Policy version + rule refs visible |
| NO_ACTION rendered correctly | Only for recorded NO_ACTION outcome |
| NO_DECISION_RECORD is absence | Not an action outcome |
| NO_DECISION_RECORD ≠ NO_ACTION | Never same state |
| NOT_DETERMINED preserved | Badge + explanation visible |
| decisionId consistency | Same ID in decision + provenance |
| Panel is read-only | No buttons, "Advisory-only" badge |
| Context is decision-sourced | "Decision record present and readable" |
| P4 context labeled when absent | "live — not a decision basis" |
| ActionReadService PRESENT | Record found → PRESENT view |
| ActionReadService ABSENT no P4 | No record + no P4 → P4_CONTEXT_UNAVAILABLE |
| ActionReadService ABSENT with P4 | No record + P4 exists → NO_DECISION_RECORD |
| NO_ACTION record → PRESENT | Not mapped to ABSENT |
| NOT_DETERMINED record → PRESENT | Outcome preserved |

## 2. Architecture (After)

```
GET /api/narratives/[id]
    ↓
    ├── P3 Intelligence (read)
    ├── P4 Decision Support (read)
    ├── P5-11 Pipeline (write → P5-09 → PostgreSQL)
    └── P5-06 Read Service (read → PostgreSQL) ← NEW in this route
    ↓
NarrativeDetail {
  p3Intelligence,
  p4DecisionSupport,
  p5Decision,          ← NEW (raw P5DecisionRecord)
  p5ActionDecision,    ← NEW (P5ActionDecisionReadViewModel)
}
    ↓
Narrative Detail Page
    ↓
P5ActionDecisionPanel(initialData={narrative.p5ActionDecision})
    ↓ (when initialData provided: no fetch)
    ↓ (when initialData undefined: fetch from /action-decision)
```

## 3. Backward Compatibility

- `p5Decision` is nullable — existing consumers that don't use it are unaffected
- `p5ActionDecision` is nullable — existing consumers that don't use it are unaffected
- Panel still works without `initialData` (falls back to fetch)
- `/action-decision` endpoint remains available for direct access
- No frozen contracts modified

## 4. No New Evaluation Path

- The narrative route reads the persisted artifact via `productionActionReadService`
- This is a READ operation — no P5-03/04/05 re-evaluation
- The P5-11 pipeline still writes via the existing path
- Single evaluation per request (P5-11 in narrative route), single read (P5-06 in same route)

## 5. Files Changed

| File | Change |
|---|---|
| `src/types/index.ts` | Added `p5Decision`, `p5ActionDecision` to `NarrativeDetail` |
| `src/app/api/narratives/[id]/route.ts` | Wired `productionActionReadService` |
| `src/components/P5ActionDecisionPanel.tsx` | Added `initialData` prop |
| `src/app/narrative/[id]/page.tsx` | Pass `p5ActionDecision` to panel |
| `src/lib/p5/read/action-read.service.ts` | Fixed stale JSDoc |
| `src/lib/p5/read/__tests__/canonical-flow.test.tsx` | **NEW** — 15 tests |
| `docs/P5_Upgrade/P4-P5-COMPLETION-02_RECON.md` | **NEW** |
| `docs/P5_Upgrade/P4-P5-COMPLETION-02_IMPLEMENTATION.md` | THIS FILE |

## 6. Git Boundary

**Production source files modified:** 4 (types.ts, route.ts, panel.tsx, page.tsx)
**JSDoc only:** 1 (action-read.service.ts)
**Test files created:** 1 (canonical-flow.test.tsx)
**Documentation created:** 3 (recon + implementation + final audit)
**Frozen P5-03/04/05/07/09/10/11:** UNTOUCHED
**P4/P3:** UNTOUCHED
**No new DB schema:** UNTOUCHED
