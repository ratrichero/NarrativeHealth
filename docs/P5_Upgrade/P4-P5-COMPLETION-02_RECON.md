# P4-P5-COMPLETION-02 — RECON

**Date:** 2026-08-19
**Status:** RECON COMPLETE

---

## 1. Remaining Gaps Identified

| Gap | Source | Classification |
|---|---|---|
| `NarrativeDetail` type missing `p5Decision` field | `src/types/index.ts` | TYPE GAP |
| Narrative API returns `p5Decision` but type doesn't declare it | `src/app/api/narratives/[id]/route.ts` | TYPE GAP |
| P5ActionDecisionPanel fetches separately from canonical flow | `src/components/P5ActionDecisionPanel.tsx` | UI GAP |
| Stale JSDoc in `action-read.service.ts` | `src/lib/p5/read/action-read.service.ts` | DOC GAP |
| Permission artifact gap | P5-08 §10 | OPEN (V1 by-design) |
| contentHash | P5-02 AD-014 | PROVISIONAL |
| Real PostgreSQL E2E | Environment | ENVIRONMENT BLOCKER |

## 2. Canonical Data Flow Analysis

### Current State (Before)

```
GET /api/narratives/[id]
    ↓ returns p5Decision: P5DecisionRecord | null (raw record)
    ↓ (NarrativeDetail type does NOT declare this field)

GET /api/narratives/[id]/action-decision    ← SEPARATE ENDPOINT
    ↓ returns p5ActionDecision: P5ActionDecisionReadViewModel
    ↓ (with displayState, availability, context)

P5ActionDecisionPanel
    ↓ fetches from /action-decision independently
    ↓ (separate HTTP call, separate data source)
```

**Problems:**
1. `NarrativeDetail` type doesn't include `p5Decision` — TypeScript consumers can't access it
2. Panel makes a separate fetch instead of consuming canonical data
3. Two separate API calls for the same narrative's P5 data

### Target State (After)

```
GET /api/narratives/[id]
    ↓ returns p5Decision: P5DecisionRecord | null (raw record)
    ↓ returns p5ActionDecision: P5ActionDecisionReadViewModel | null (read model)
    ↓ (both declared in NarrativeDetail type)

P5ActionDecisionPanel
    ↓ accepts initialData prop from parent
    ↓ (uses canonical data when available, falls back to fetch)
```

## 3. No Frozen Contract Changes Required

- P5-03/04/05/07/09/10/11: UNTOUCHED
- P5-06 ActionReadService: JSDoc update only
- P5-08 PgHistoricalArtifactStore: UNTOUCHED
- New `findDecisionByNarrativeId`: additive read method (not in frozen interface)

## 4. Implementation Plan

1. Add `p5Decision` and `p5ActionDecision` to `NarrativeDetail` type
2. Wire `productionActionReadService` into narrative API route
3. Update `P5ActionDecisionPanel` to accept `initialData` prop
4. Update narrative page to pass canonical data to panel
5. Fix stale JSDoc
6. Write tests
