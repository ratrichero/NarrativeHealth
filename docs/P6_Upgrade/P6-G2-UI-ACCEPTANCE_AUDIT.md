# P6-G2-UI-ACCEPTANCE — Production Intelligence Visibility & Layer Continuity Audit

**Date:** 2026-08-31
**Auditor:** Buffy (Codebuff)
**Repository:** ratrichero/NarrativeHealth
**Mode:** READ-ONLY (no code changes)

---

## 1. Executive Summary

P6 is **NOT** intended to replace P3/P4/P5. All four layers are **intended to coexist** on Narrative Detail.

**Critical finding:** P3 and P4 components are correctly mounted on Narrative Detail, and the API already returns their data, but the page **hardcodes `viewModel={null}`** instead of passing the fetched data. This is a UI wiring defect — not a design decision.

**Architectural verdict: C — P6 COEXISTS WITH P3/P4/P5 — UI VISIBILITY GAP**

---

## 2. Authoritative Contract Evidence

### P6 Master Spec (§3 — Frozen P4-P5 Foundation)

> "P6 is downstream of the P4-P5 frozen baseline. It MUST NOT silently modify frozen P4/P5 semantics."
> "P4/P5 remains a downstream-compatible decision-support layer and is not converted into an execution engine."

**Citation:** `docs/P6_Upgrade/P6_MASTER_SPECIFICATION.md` §3

### P4 Master Spec (§2 — Master executive definition)

> "P4 transforms validated P3 intelligence and approved secondary evidence into explainable, traceable and deterministic Decision Support."
> "P3 answers: 'What is happening?'"
> "P4 answers: 'What does it mean, how strong is the evidence, and why does it matter?'"
> "P5 answers: 'What action, if any, should be executed?'"

**Citation:** `docs/P4_Upgrade/P4_MASTER_SPECIFICATION.md` §2

### P4 Master Spec (§15 — UI placement, frozen)

> "Narrative Header → P3IntelligencePanel → P4 Decision Support → Correlation / other context"

**Citation:** `docs/P4_Upgrade/P4_MASTER_SPECIFICATION.md` §15

### P4 Master Spec (§19D — P4-05C checkpoint)

> "New P4DecisionSupportPanel.tsx renders data.p4DecisionSupport on /narrative/[id], placed between P3IntelligencePanel and CorrelationHeatmap"

**Citation:** `docs/P4_Upgrade/P4_MASTER_SPECIFICATION.md` §19D

### P5 Master Spec

P5 is explicitly advisory-only. P5ActionDecisionPanel self-fetches from `/api/narratives/[id]/action-decision`.

**Citation:** `docs/P5_Upgrade/P5_MASTER_SPECIFICATION.md`

### Key Conclusion

**P6 is explicitly additive.** It adds health measurement, regime detection, warnings, and intelligence summary. It does NOT replace P3/P4/P5 UI panels. The spec mandates coexistence.

---

## 3. P3/P4/P5/P6 Intended UI Model

| Layer | Semantic Contract | Intended UI Presence |
|-------|-------------------|---------------------|
| P3 | "What is happening?" — current-state narrative intelligence | Narrative Detail |
| P4 | "What does it mean?" — decision support interpretation | Narrative Detail |
| P5 | "What should be done?" — action decision (advisory) | Narrative Detail |
| P6 | Health measurement, regime, warnings, intelligence summary | Coin Detail + Narrative Detail |

**All four layers are intended to coexist on Narrative Detail.**

---

## 4. Coin Detail UI Matrix

| Layer | Backend | API | Component | Mounted | Receives Data |
|-------|---------|-----|-----------|---------|---------------|
| P3 | N/A (narrative-level) | N/A | P3IntelligencePanel | N/A | N/A |
| P4 | N/A (narrative-level) | N/A | P4DecisionSupportPanel | N/A | N/A |
| P5 | N/A (narrative-level) | N/A | P5ActionDecisionPanel | N/A | N/A |
| P6 | ✅ 49 CURRENT | ✅ /api/p6/coins/[id] | P6IntelligencePanel | ✅ | ✅ Self-fetching |
| Indicators | ✅ 49 coins | ✅ /api/indicators/[id] | Inline rendering | ✅ | ✅ |
| TA Engine | ✅ | ✅ /api/coins/[id]/technical-analysis | Inline rendering | ✅ | ✅ |

**Coin Detail: No issue.** P3/P4/P5 are narrative-level and correctly not mounted.

---

## 5. Narrative Detail UI Matrix

| Layer | Backend | API | Component | Mounted | Receives Data |
|-------|---------|-----|-----------|---------|---------------|
| P3 | ✅ 9 narratives | ✅ API returns `p3Intelligence` | P3IntelligencePanel | ✅ | ❌ **HARDCODED null** |
| P4 | ✅ 1035 features | ✅ API returns `p4DecisionSupport` | P4DecisionSupportPanel | ✅ | ❌ **HARDCODED null** |
| P5 | ❌ No persistence | ✅ Self-fetching API | P5ActionDecisionPanel | ✅ | ✅ Self-fetching |
| P6 | ✅ 9 narrative CURRENT | ✅ /api/p6/narratives/[id] | P6IntelligencePanel | ✅ | ✅ Self-fetching |

### THE DEFECT

**P3 and P4 API data exists and is returned by the API, but the page ignores it:**

```tsx
// src/app/narrative/[id]/page.tsx — CURRENT (broken)
<P4DecisionSupportPanel viewModel={null} />
<P3IntelligencePanel narrativeName={narrative.name} viewModel={null} />
```

**The API route already fetches this data:**
```typescript
// src/app/api/narratives/[id]/route.ts
p3Intelligence = await getLatestValidP3Intelligence(narrativeId);
p4DecisionSupport = await getP4DecisionSupport(narrativeId);
// Returns: { p3Intelligence, p4DecisionSupport, ... }
```

**But the page fetches the response as `narrative` and never passes these fields to the components.**

---

## 6. Current Component Tree

### Narrative Detail (src/app/narrative/[id]/page.tsx)

```
Narrative Detail
├── Header (name, description, health badge)
├── Health History Chart
├── P6IntelligencePanel          ← self-fetching, WORKING
├── P5ActionDecisionPanel        ← self-fetching, WORKING
├── P4DecisionSupportPanel       ← MOUNTED but viewModel={null}
├── P3IntelligencePanel          ← MOUNTED but viewModel={null}
├── CorrelationHeatmap
└── CoinRankingTable
```

### Coin Detail (src/app/coin/[id]/page.tsx)

```
Coin Detail
├── Header (symbol, name, narratives, badges)
├── Recommendation
├── P6IntelligencePanel          ← self-fetching, WORKING
├── Metrics Cards (price, market cap, FDV, OI, funding)
├── Feature Details (trend, derivative)
├── Realtime Technical Analysis
├── Score Breakdown + Health Timeline
├── Health History Chart
├── Price History Chart
├── Data Sources
└── Indicator Values (1D)        ← WORKING
```

---

## 7. API/Data Flow

### P3 Flow

```
GET /api/narratives/[id]
  → getLatestValidP3Intelligence(narrativeId)
  → returns P3IntelligenceViewModel | null
  → data.p3Intelligence in response
  → Page fetches as narrative.p3Intelligence
  → ❌ Page ignores it, passes null to P3IntelligencePanel
```

### P4 Flow

```
GET /api/narratives/[id]
  → getP4DecisionSupport(narrativeId)
  → returns P4DecisionSupportViewModel | null
  → data.p4DecisionSupport in response
  → Page fetches as narrative.p4DecisionSupport
  → ❌ Page ignores it, passes null to P4DecisionSupportPanel
```

### P5 Flow

```
P5ActionDecisionPanel
  → self-fetches GET /api/narratives/[id]/action-decision
  → productionActionReadService.getNarrativeActionReadView(narrativeId)
  → ✅ WORKING (independent fetch, no null hardcoding)
```

### P6 Flow

```
P6IntelligencePanel
  → self-fetches GET /api/p6/narratives/[id]
  → ✅ WORKING (independent fetch, no null hardcoding)
```

---

## 8. Production Data Evidence

### P3 Data

| Table | Records | Status |
|-------|---------|--------|
| p3_narrative_intelligence | 9 | ✅ PRESENT |
| p3_constituent_snapshots | 9 | ✅ PRESENT |
| p3_leadership_members | 0 | ⚠️ Empty |

P3 data EXISTS in production. The `getLatestValidP3Intelligence()` service reads from these tables.

### P4 Data

| Table | Records | Status |
|-------|---------|--------|
| features | 1,035 | ✅ PRESENT |
| health_scores | Active | ✅ PRESENT |
| narrative_health | Active | ✅ PRESENT |

P4 data EXISTS in production. The `getP4DecisionSupport()` service derives P4 results at read time from P3 read models (no P4 persistence in v1).

### P5 Data

| Table | Records | Status |
|-------|---------|--------|
| decision_signals | 0 | Expected — P5 not materialized |

P5 persistence is absent. P5ActionDecisionPanel correctly handles this with its unavailable state.

### P6 Data

| Table | Records | Status |
|-------|---------|--------|
| p6_snapshots | 49 coin + 9 narrative CURRENT | ✅ PRESENT |
| p6_regime_states | 49 coin + 9 narrative CURRENT | ✅ PRESENT |
| p6_intelligence_summaries | 49 coin + 9 narrative CURRENT | ✅ PRESENT |
| p6_warnings | 0 | ✅ Expected (no threshold triggered) |

---

## 9. Runtime UI Evidence

**UI_RUNTIME_NOT_VERIFIABLE** — Browser runtime access unavailable. Verification is based on static code inspection and production DB evidence.

---

## 10. Before/After Visibility Comparison

| Layer | Before P6 | After P6 | Intended | Status |
|-------|-----------|----------|----------|--------|
| P3 | Visible (P3IntelligencePanel mounted) | Mounted but **viewModel=null** | Visible | ❌ **UI WIRING DEFECT** |
| P4 | Visible (P4DecisionSupportPanel mounted) | Mounted but **viewModel=null** | Visible | ❌ **UI WIRING DEFECT** |
| P5 | Not mounted | Mounted + self-fetching | Visible (if data exists) | ✅ CORRECT |
| P6 | N/A | Mounted + self-fetching | Visible | ✅ CORRECT |

**Root cause classification:** P6-UI-06 correctly mounted P3/P4/P5 components but hardcoded `viewModel={null}` instead of wiring the API response data. The components were originally designed for P4-05C (before P6 existed) and received data from the narrative response. When P6 was added and the page was restructured, the data wiring was lost.

---

## 11. Root Cause Classification

**Type:** UI wiring defect (Class B — contract/integration issue)

**Severity:** Medium — P3/P4 panels exist but show "unavailable" state despite data being available in the API response

**Root cause:** The narrative detail page fetches `narrative` via `fetchNarrative(id)` which returns the full response including `p3Intelligence` and `p4DecisionSupport`. However, the page passes hardcoded `null` to both components instead of `narrative.p3Intelligence` and `narrative.p4DecisionSupport`.

**Fix required (2 lines in `src/app/narrative/[id]/page.tsx`):**
```tsx
// BEFORE:
<P4DecisionSupportPanel viewModel={null} />
<P3IntelligencePanel narrativeName={narrative.name} viewModel={null} />

// AFTER:
<P4DecisionSupportPanel viewModel={narrative.p4DecisionSupport ?? null} />
<P3IntelligencePanel narrativeName={narrative.name} viewModel={narrative.p3Intelligence ?? null} />
```

**Note:** The `NarrativeDetail` type must also include `p3Intelligence` and `p4DecisionSupport` fields if it doesn't already.

---

## 12. G2 UI Acceptance Verdict

```
C — P6 COEXISTS WITH P3/P4/P5 — UI VISIBILITY GAP
```

### Rationale

- P6 is correctly mounted and displaying on both Coin Detail and Narrative Detail ✅
- P5 is correctly mounted and self-fetching ✅
- P3 and P4 components are correctly mounted but receive null data ❌
- The API already returns P3/P4 data — it's just not wired to the components ❌
- This is a **minimal fix** (2 lines) — not a design change
- No P6 contracts are affected
- No P3/P4/P5 contracts are affected
- The fix restores intended coexistence per all specs

---

## 13. Required Follow-up Task

**Recommended:** `P6-G2-UI-FIX` — Wire P3/P4 view models to components on Narrative Detail

**Scope:**
1. Pass `narrative.p3Intelligence` to `P3IntelligencePanel`
2. Pass `narrative.p4DecisionSupport` to `P4DecisionSupportPanel`
3. Verify `NarrativeDetail` type includes these fields
4. TypeScript check
5. Commit and push

**Classification:** Class B fix — minimal, safe, no semantic changes.

---

## 14. Additional Findings (Class C — non-blocking)

| # | Finding | Impact |
|---|---------|--------|
| C-1 | P5 persistence tables absent in production | Expected — P5 not materialized |
| C-2 | P3 leadership_members = 0 | P3 data partially populated |
| C-3 | No browser runtime verification possible | Static code inspection only |

---

*Audit completed: 2026-08-31*
*Mode: READ-ONLY — no code changes, no schema changes, no data writes*
