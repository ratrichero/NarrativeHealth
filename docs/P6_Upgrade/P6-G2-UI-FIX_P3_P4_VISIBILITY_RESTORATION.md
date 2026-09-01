# P6-G2-UI-FIX — P3/P4 UI Visibility Restoration

**Date:** 2026-08-31
**Author:** Buffy (Codebuff)
**Repository:** ratrichero/NarrativeHealth
**Mode:** UI wiring fix (no semantic changes)

---

## 1. Problem

P3IntelligencePanel and P4DecisionSupportPanel were correctly mounted on Narrative Detail but received hardcoded `viewModel={null}`, causing them to display "unavailable" states despite the API already returning their data.

## 2. Root Cause

When P6IntelligencePanel was added to Narrative Detail (P6-UI-06), the page was restructured. The existing P3/P4 components were re-mounted but their data wiring was lost — `viewModel={null}` was hardcoded instead of passing the API response fields.

## 3. Files Changed

| File | Change |
|------|--------|
| `src/app/narrative/[id]/page.tsx` | Wired `narrative.p4DecisionSupport`, `narrative.p3Intelligence`, and `narrative.p3IntelligenceHistory` to their respective components |

## 4. Exact Wiring Restored

### Before (broken)

```tsx
<P4DecisionSupportPanel viewModel={null} />
<P3IntelligencePanel narrativeName={narrative.name} viewModel={null} />
```

### After (fixed)

```tsx
<P4DecisionSupportPanel viewModel={narrative.p4DecisionSupport} />
<P3IntelligencePanel
  narrativeName={narrative.name}
  viewModel={narrative.p3Intelligence}
  history={narrative.p3IntelligenceHistory}
/>
```

### Data flow (verified)

```
GET /api/narratives/[id]
  → API route calls getP4DecisionSupport(narrativeId) → returns P4DecisionSupportViewModel | null
  → API route calls getLatestValidP3Intelligence(narrativeId) → returns P3IntelligenceViewModel | null
  → API route calls getP3IntelligenceHistory(narrativeId) → returns P3IntelligenceHistoryViewModel | null
  → Response includes: data.p3Intelligence, data.p3IntelligenceHistory, data.p4DecisionSupport

Page fetchNarrative(id) → narrative.p3Intelligence, narrative.p3IntelligenceHistory, narrative.p4DecisionSupport

P3IntelligencePanel receives: viewModel={narrative.p3Intelligence}  ← was null, now wired
P4DecisionSupportPanel receives: viewModel={narrative.p4DecisionSupport}  ← was null, now wired
```

### Type verification

`NarrativeDetail` interface (src/types/index.ts) already declares:
- `p3Intelligence: P3IntelligenceViewModel | null`
- `p3IntelligenceHistory: P3IntelligenceHistoryViewModel | null`
- `p4DecisionSupport: P4DecisionSupportViewModel | null`

No type changes were needed.

## 5. P3/P4/P5/P6 Coexistence Confirmation

| Layer | Status | Evidence |
|-------|--------|----------|
| P6 Intelligence | ✅ Unchanged | P6IntelligencePanel self-fetches from /api/p6/narratives/[id] |
| P5 Action Decision | ✅ Unchanged | P5ActionDecisionPanel self-fetches from /api/narratives/[id]/action-decision |
| P4 Decision Support | ✅ **WIRED** | Now receives narrative.p4DecisionSupport from API |
| P3 Intelligence | ✅ **WIRED** | Now receives narrative.p3Intelligence + history from API |

All four layers coexist on Narrative Detail. Each fails independently.

## 6. Test Results

```
TypeScript:    PASS (npx tsc --noEmit → exit 0)
P3 tests:      Pre-existing (16 P3 kernel failures — OUT OF SCOPE, not introduced by this task)
P4 tests:      Pre-existing (P4 suite green)
P5 tests:      Pre-existing (no changes)
P6 tests:      Pre-existing (no changes)
```

## 7. Frozen Boundary Verification

- ✅ P3 semantics: NOT modified
- ✅ P4 semantics: NOT modified
- ✅ P5 semantics: NOT modified
- ✅ P6 semantics: NOT modified
- ✅ P3/P4/P5/P6 APIs: NOT modified
- ✅ Database schema: NOT modified
- ✅ Persistence: NOT modified
- ✅ Calculation algorithms: NOT modified
- ✅ P6IntelligencePanel: NOT removed

## 8. Git Commit

```
fix(P6-G2-UI-FIX): restore P3 P4 visibility on narrative detail
```

## 9. Production Deployment Requirement

After deployment, next page load will fetch P3/P4 data from the API and pass it to the components. If P3/P4 backend data exists for a narrative, the panels will display it. If not, the existing graceful unavailable state will render.

## 10. Final Verdict

```
P3/P4 UI VISIBILITY RESTORED
```

- P3IntelligencePanel now receives actual P3 data from API
- P4DecisionSupportPanel now receives actual P4 data from API
- P5 remains self-fetching and unchanged
- P6 remains primary and unchanged
- No semantic contracts changed
- TypeScript passes
- Minimal 3-line change (2 prop changes + 1 history prop addition)
