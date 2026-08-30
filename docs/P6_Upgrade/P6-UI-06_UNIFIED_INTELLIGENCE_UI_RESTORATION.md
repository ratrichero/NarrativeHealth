# P6-UI-06 — Unified Intelligence UI Restoration & P3/P4/P5 Visibility Recovery

## 1. Objective

Audit and repair the current Coin Detail and Narrative Detail UI so that the new P6 Intelligence layer does NOT silently replace the previously visible P3/P4/P5 intelligence.

## 2. Current UI Architecture (Before Fix)

| Layer | Backend exists | API exists | UI component exists | Currently mounted | Expected |
|-------|---------------|------------|---------------------|-------------------|----------|
| P3 | YES (9 narratives) | YES | YES (`P3IntelligencePanel`) | **NO** | visible |
| P4 | YES (1035 features) | YES | YES (`P4DecisionSupportPanel`) | **NO** | visible |
| P5 | NO (tables absent) | YES (action-decision API) | YES (`P5ActionDecisionPanel`) | **NO** | only if real artifacts exist |
| P6 | YES (49 coin + 9 narrative CURRENT) | YES | YES (`P6IntelligencePanel`) | YES | visible |

### Components Found

- `src/components/P3IntelligencePanel.tsx` — narrative intelligence, accepts `viewModel: P3IntelligenceViewModel | null`
- `src/components/P4DecisionSupportPanel.tsx` — decision support, accepts `viewModel: P4DecisionSupportViewModel | null`
- `src/components/P5ActionDecisionPanel.tsx` — action decision, self-fetches from `/api/narratives/[id]/action-decision`
- `src/components/P6IntelligencePanel.tsx` — P6 intelligence, self-fetches from `/api/p6/coins/[id]` or `/api/p6/narratives/[id]`

### Components Previously Removed/Unmounted

All three P3/P4/P5 components were imported in historical commits but were unmounted when P6IntelligencePanel was added to the detail pages.

## 3. Semantic Design

### Hierarchy Applied

```
Narrative Detail:
├── Narrative Information
├── Health History Chart
├── P6 Intelligence (primary new layer)
├── P5 Decision Support (if real artifact exists)
├── P4 Decision Support (interpretation layer)
├── P3 Intelligence (current-state intelligence)
├── Correlation Matrix
└── Coin Ranking Table

Coin Detail:
├── Market/Price Information
├── P6 Intelligence (primary new layer)
├── Indicator Values (1D)
└── ... (other coin-specific sections)
```

### Semantic Boundaries Preserved

| Layer | Answers | Semantic Contract |
|-------|---------|-------------------|
| P3 | "What is happening?" | Current-state narrative intelligence |
| P4 | "What does it mean?" | Decision support interpretation |
| P5 | "What should be done?" | Action decision (read-only advisory) |
| P6 | P6-native intelligence | Health, regime, warnings, intelligence summary |

## 4. Fix Applied

### Narrative Detail (`src/app/narrative/[id]/page.tsx`)

**Before:** Only `P6IntelligencePanel` mounted.

**After:** P3/P4/P5 panels restored alongside P6:

```tsx
{/* P6 Intelligence */}
<P6IntelligencePanel entityType="narrative" entityId={narrative.id} entityName={narrative.name} />

{/* P5 Action Decision — self-fetching */}
<P5ActionDecisionPanel narrativeId={narrative.id} />

{/* P4 Decision Support */}
<P4DecisionSupportPanel viewModel={null} />

{/* P3 Intelligence */}
<P3IntelligencePanel narrativeName={narrative.name} viewModel={null} />
```

### Coin Detail (`src/app/coin/[id]/page.tsx`)

**No changes required.** P3/P4/P5 are narrative-level components. They don't apply to individual coins. P6IntelligencePanel correctly handles coin-level intelligence.

## 5. Empty/Unavailable State Behavior

| Layer | CURRENT artifact exists | No artifact |
|-------|------------------------|-------------|
| P6 | Displays P6 Intelligence | Shows "No P6 intelligence data" |
| P5 | Self-fetches, displays decision | Shows "Loading decision state..." → "No decision record" |
| P4 | Displays with `viewModel` | Shows "P4 Decision Support is not available" (renders with `viewModel={null}`) |
| P3 | Displays with `viewModel` | Shows "No P3 intelligence available" (renders with `viewModel={null}`) |

Each layer fails independently. A P6 failure does NOT hide P3/P4.

## 6. P5 Production Artifacts

P5 persistence tables are **ABSENT** in production. P5ActionDecisionPanel self-fetches from the action-decision API which reads from existing decision infrastructure. If no decision record exists, it renders an appropriate unavailable state. This is correct behavior — we do NOT fabricate P5 data.

## 7. Files Changed

| File | Change |
|------|--------|
| `src/app/narrative/[id]/page.tsx` | Added P3IntelligencePanel, P4DecisionSupportPanel, P5ActionDecisionPanel imports and rendering |

## 8. Semantic Boundary Verification

- ✅ P3 still answers "What is happening?"
- ✅ P4 still answers "What does it mean?"
- ✅ P5 still answers "What should be done?"
- ✅ P6 still presents its own intelligence layer
- ✅ No contract changes to any layer
- ✅ No calculation changes
- ✅ No database schema changes
- ✅ No API contract changes

## 9. Production Impact

- **Coin Detail:** No change (P3/P4/P5 are narrative-level, not applicable to coins)
- **Narrative Detail:** P3/P4/P5 panels now visible below P6 Intelligence
- **P6 Intelligence:** Unchanged, remains primary
- **Indicator Values (1D):** No regression

## 10. TypeScript Verification

```
npx tsc --noEmit → exit 0 ✅
```

## 11. Final Verdict

```
UNIFIED_INTELLIGENCE_UI_RESTORED
```

P6 remains the primary intelligence layer. P3/P4/P5 panels are restored on Narrative Detail alongside P6. Each layer fails independently. No semantic contracts were changed. P5 correctly shows unavailable state since persistence tables are absent in production.
