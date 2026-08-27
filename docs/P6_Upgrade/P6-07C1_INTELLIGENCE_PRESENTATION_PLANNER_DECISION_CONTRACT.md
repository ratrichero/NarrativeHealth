# P6-07C1 — Intelligence Presentation Focused Planner Decision Contract

**Date:** 2026-08-27
**Phase:** P6-07 Intelligence Presentation
**Status:** PLANNER ACCEPTANCE GATE
**Previous:** P6-07C decision inventory (`8ee4b47`)

---

## 1. Executive Summary

P6-07C has identified exactly **3 blocking decisions** that require explicit Planner ACCEPT/MODIFY/REJECT before P6-07D implementation can proceed. This contract presents each decision with its proposed resolution, downstream dependencies, modification impacts, and invariant compatibility.

**All 3 decisions remain PROPOSED.** The Planner must explicitly decide on each.

**Verdict: READY FOR PLANNER ACCEPTANCE**

---

## 2. Why Planner Decision Is Required

P6-07 is the first P6 phase that touches **production UI and API routes**. Unlike P6-01…P6-06 which produced isolated intelligence modules, P6-07 must:

1. Wire new engines into the existing refresh pipeline
2. Create new HTTP endpoints
3. Modify existing page components

These are **integration decisions** with visible user impact. The Planner must confirm the exact approach before implementation begins.

---

## 3. Decision Inventory Summary

| Category | Count |
|---|---|
| **Blocking decisions (this contract)** | **3** |
| Non-blocking (resolved by safe defaults) | 15 |
| Deferred (P6-08, future) | 3 |
| **Total P6-07 decisions** | **21** |

---

## 4. PD-07A-01 — Refresh Wiring

### Question

Should P6-07 wire P6-04 regime detection, P6-05 warning detection, and P6-06 aggregation into the `/api/refresh` pipeline after P6-03 snapshot generation?

### Proposed Resolution

**YES.** After P6-03 snapshot generation completes in `/api/refresh/route.ts`, sequentially execute:

```
P6-04 regime detection (detectRegime)
  ↓
P6-05 warning detection (detectWarnings)
  ↓
P6-06 aggregation (aggregateIntelligence)
```

### Current State

The refresh pipeline currently runs:

```
P6-01 observation → P6-03 snapshot
```

P6-04, P6-05, P6-06 are **NOT wired**. The pipeline produces snapshots but never generates regime states, warnings, or summaries.

### Why This Is Blocking

Without this wiring:

- No regime states are ever produced
- No warnings are ever generated
- No intelligence summaries are ever created
- P6-07 presentation has nothing to display
- The entire P6 pipeline (P6-04→P6-05→P6-06) is dead code

### Dependencies

| Downstream Decision | Impact |
|---|---|
| PD-07A-02 (Read APIs) | APIs return null if no data exists |
| PD-07B-01 (Read DTOs) | DTOs have no P6 data to transform |
| PD-07A-03 (Legacy retirement) | Cannot retire legacy panels if P6 has no data |
| All P6-07 UI | All presentation components show empty state |

### If Planner MODIFIES

| Modification | Impact |
|---|---|
| Change wiring order (e.g., P6-05 before P6-04) | P6-06 may miss regime input; contract violation |
| Make wiring optional | Stale data risk (reclassified from PD-07B-08) |
| Wire only P6-04 (skip P6-05/06) | Partial pipeline; warnings/summaries missing |
| Wire only for specific entity types | Inconsistent intelligence coverage |

### Invariant Compatibility

| Invariant | Compatible? |
|---|---|
| PV-15 (Refresh preserves ordering) | ✅ If wiring order preserved |
| PV-16 (Partial failure does not block refresh) | ✅ If each layer is try/catch wrapped |
| PV-01 (P6-07 consumes only P6-native artifacts) | ✅ No legacy contamination |

### Rationale

P6-04/05/06 are frozen engines that consume P6-03 snapshots. They exist but are never called. Wiring them into refresh is the minimal integration required to make the P6 pipeline produce output. The insertion point is clear (after line ~1106 in `/api/refresh/route.ts`). Failure isolation follows the existing PD-E2 pattern (never block refresh on P6 failure).

---

## 5. PD-07A-02 — Read API Design

### Question

Should P6-07 create new `/api/p6/*` HTTP read endpoints to expose P6-03/04/05/06 artifacts to the UI?

### Proposed Resolution

**YES.** Create new read-only HTTP endpoints under `/api/p6/`:

| Endpoint | Source | Purpose |
|---|---|---|
| `GET /api/p6/[entityType]/[entityId]` | P6-03+04+05+06 | Composite intelligence view |
| `GET /api/p6/warnings/[entityType]/[entityId]` | P6-05 | Warning list (multiple per entity) |
| `GET /api/p6/summaries` | P6-06 | Summary list |

Each endpoint returns `P6ApiResponse<T>` with `success`, `data`, `error`, `meta` fields.

### Current State

P6 read functions exist but are **internal only**:

| Function | Location | HTTP? |
|---|---|---|
| `readCurrentSnapshot` | `p6/snapshot/persistence.ts` | ❌ |
| `readCurrentCoinSnapshots` | `p6/snapshot/persistence.ts` | ❌ |
| `readCurrentSummary` | `p6/aggregation/persistence.ts` | ❌ |
| `readCurrentRegime` | `p6/regime/persistence.ts` | ❌ |
| `readActiveWarnings` | `p6/warning/persistence.ts` | ❌ |

### Why This Is Blocking

Without HTTP endpoints:

- React Query (`useQuery`) cannot fetch P6 data
- UI components have no data source
- Legacy panels remain the only data source
- P6-07 cannot replace legacy presentation

### Dependencies

| Downstream Decision | Impact |
|---|---|
| PD-07B-01 (Read DTOs) | DTOs are consumed by these endpoints |
| PD-07C-01 (Auth middleware) | Endpoints need auth |
| PD-07C-02 (Endpoint structure) | Exact routes defined here |
| All P6-07 UI | All pages consume these APIs |

### If Planner MODIFIES

| Modification | Impact |
|---|---|
| Use existing legacy API routes instead | Semantic contamination — legacy routes return non-P6 data |
| Create fewer endpoints (e.g., only composite) | Warning list cannot be fetched separately |
| Create more endpoints (e.g., separate snapshot/regime) | Over-engineering for V1; can be added later |
| Require authentication changes | Out of scope; existing auth is sufficient |

### Invariant Compatibility

| Invariant | Compatible? |
|---|---|
| PV-03 (P6-07 is read-only) | ✅ GET endpoints only |
| PV-05 (Read API identity matches P6 identity) | ✅ Same entity_type + entity_id |
| PV-06 (Read APIs return only CURRENT) | ✅ Current lifecycle artifacts only |
| PV-07 (Empty P6 state returns null) | ✅ `data: null` for missing artifacts |

### Rationale

The UI uses React Query with `fetch()` calls to HTTP endpoints. P6 data is only accessible through internal TypeScript functions. New HTTP endpoints are the minimal bridge. The composite endpoint serves the primary use case (narrative/coin detail page). The warnings endpoint serves the warning list (multiple items per entity). The summaries list serves the dashboard.

---

## 6. PD-07A-03 — Legacy Panel Retirement

### Question

Should P6-07 retire the existing P3IntelligencePanel, P4DecisionSupportPanel, and P5ActionDecisionPanel from the narrative and coin pages, replacing them with P6-native presentation components?

### Proposed Resolution

**YES.** Retire the three legacy panels:

| Panel | Current Location | Action |
|---|---|---|
| `P3IntelligencePanel` | `/narrative/[id]/page.tsx` | REMOVE import, replace with P6 intelligence view |
| `P4DecisionSupportPanel` | `/narrative/[id]/page.tsx` | REMOVE import, replace with P6 regime/warning view |
| `P5ActionDecisionPanel` | `/narrative/[id]/page.tsx` | REMOVE import, no replacement needed (P6 has no action semantics) |

### Current State

The narrative detail page (`/narrative/[id]/page.tsx`) imports:

```typescript
import { P3IntelligencePanel } from "@/components/P3IntelligencePanel";
import { P4DecisionSupportPanel } from "@/components/P4DecisionSupportPanel";
import { P5ActionDecisionPanel } from "@/components/P5ActionDecisionPanel";
```

These panels consume legacy data sources, not P6 artifacts.

### Why This Is Blocking

Without retirement:

- Legacy panels remain on the page alongside or instead of P6 panels
- Users see legacy intelligence, not P6 intelligence
- Semantic duplication risk (two intelligence sources on same page)
- P6-07 cannot fulfill its purpose of making P6 intelligence visible

### Dependencies

| Downstream Decision | Impact |
|---|---|
| All P6-07 UI components | P6-native panels must exist before legacy panels are removed |
| PD-07A-02 (Read APIs) | P6 panels need P6 data sources |
| PD-07C-05 (Client-side rendering) | P6 panels follow existing `"use client"` pattern |

### If Planner MODIFIES

| Modification | Impact |
|---|---|
| Keep legacy panels alongside P6 | Semantic duplication; confusing UI |
| Retire only some panels | Partial migration; inconsistent presentation |
| Replace P5 panel with P6 action view | Violates P6 boundary — P6 has no action semantics |
| Defer retirement to later phase | P6-07 purpose unfulfilled; legacy remains dominant |

### Invariant Compatibility

| Invariant | Compatible? |
|---|---|
| PV-02 (No semantic reinterpretation) | ✅ P6 panels consume P6 artifacts directly |
| PV-10 (P4 untouched) | ✅ P4 code not modified; panel is retired, not changed |
| PV-11 (P5 untouched) | ✅ P5 code not modified; panel is retired, not changed |
| PV-12 (No action semantics) | ✅ P5 action panel removed, not replaced with action view |
| PV-14 (No legacy contamination) | ✅ Legacy data sources removed from UI |

### Rationale

The three legacy panels are the primary barrier between P6 intelligence and users. They consume P3/P4/P5 data that is not P6-native. Retiring them is necessary to complete the P6 presentation boundary. The visual components (HealthBadge, ScoreChange, ConfidenceBadge) are reused — only the data-consuming panels are retired.

---

## 7. Dependency Matrix

| Blocker | Resolves | Depends On |
|---|---|---|
| PD-07A-01 | Pipeline produces P6-04/05/06 data | P6-03 snapshot (frozen) |
| PD-07A-02 | UI can fetch P6 data | PD-07A-01 (data must exist) |
| PD-07A-03 | Legacy panels replaced | PD-07A-02 (P6 data must be accessible) |

### Acceptance Order

```
PD-07A-01 (Refresh wiring)
    ↓ enables
PD-07A-02 (Read APIs)
    ↓ enables
PD-07A-03 (Legacy retirement)
```

All 3 must be ACCEPTED for P6-07D to proceed. MODIFY on any one may require re-audit of downstream decisions.

---

## 8. Invariant Impact

### PV-01…PV-20 Compatibility

| Invariant | PD-07A-01 | PD-07A-02 | PD-07A-03 |
|---|---|---|---|
| PV-01 (P6-native only) | ✅ | ✅ | ✅ |
| PV-02 (No recalculation) | ✅ | ✅ | ✅ |
| PV-03 (Read-only) | ✅ | ✅ | ✅ |
| PV-04 (Deterministic) | ✅ | ✅ | ✅ |
| PV-05 (Identity match) | N/A | ✅ | N/A |
| PV-06 (CURRENT only) | N/A | ✅ | N/A |
| PV-07 (Empty → null) | N/A | ✅ | N/A |
| PV-08 (Provenance) | N/A | ✅ | N/A |
| PV-09 (Quality/Freshness) | N/A | ✅ | ✅ |
| PV-10 (P4 untouched) | ✅ | ✅ | ✅ |
| PV-11 (P5 untouched) | ✅ | ✅ | ✅ |
| PV-12 (No action) | ✅ | ✅ | ✅ |
| PV-13 (No BUY/SELL) | ✅ | ✅ | ✅ |
| PV-14 (No legacy) | ✅ | ✅ | ✅ |
| PV-15 (Ordering) | ✅ | N/A | N/A |
| PV-16 (Partial failure) | ✅ | N/A | N/A |
| PV-17 (Infra ≠ quality) | ✅ | N/A | N/A |
| PV-18 (Explanation arrays) | N/A | ✅ | N/A |
| PV-19 (DTOs not engines) | N/A | ✅ | N/A |
| PV-20 (No regime from score) | N/A | ✅ | ✅ |

**20/20 invariants compatible with all 3 proposed decisions. 0 violations.**

---

## 9. P6-01…P6-06 Compatibility

| Phase | Compatible? | Evidence |
|---|---|---|
| P6-01 | ✅ | Quality/Freshness passed through as metadata |
| P6-02 | ✅ | Features consumed via P6-03 snapshots |
| P6-03 | ✅ | Snapshots read via `readCurrentSnapshot` |
| P6-04 | ✅ | Regime read via `readCurrentRegime`; wired into refresh |
| P6-05 | ✅ | Warnings read via `readActiveWarnings`; wired into refresh |
| P6-06 | ✅ | Summaries read via `readCurrentSummary`; wired into refresh |

**No frozen P6-01…P6-06 contract is modified by any proposed decision.**

---

## 10. P4 Boundary

| Check | Result |
|---|---|
| P4 code modified | ❌ NO — P4DecisionSupportPanel is retired (removed from import), not modified |
| P4 semantics reinterpreted | ❌ NO |
| P4 data substituted for P6 | ❌ NO |
| P4 decision/action leakage | ❌ NO |

**P4 untouched.**

---

## 11. P5 Boundary / Replay

| Check | Result |
|---|---|
| P5 code modified | ❌ NO — P5ActionDecisionPanel is retired, not modified |
| P5 replay changed | ❌ NO |
| P5 decisions recomputed | ❌ NO |
| P5 action semantics introduced | ❌ NO — P5 panel removed, not replaced |
| P5 bridge created | ❌ NO |
| BUY/SELL semantics | ❌ NO |

**P5 untouched. No replay contamination.**

---

## 12. Legacy Boundary

| Component | Action | Semantic Impact |
|---|---|---|
| P3IntelligencePanel | RETIRE (remove import) | Legacy P3 data source removed |
| P4DecisionSupportPanel | RETIRE (remove import) | Legacy P4 data source removed |
| P5ActionDecisionPanel | RETIRE (remove import) | Legacy P5 action source removed |
| HealthBadge | REUSE | Presentation-only, no change |
| ScoreChange | REUSE | Presentation-only, no change |
| ConfidenceBadge | REUSE | Presentation-only, no change |

**No legacy semantic contamination. Legacy panels are retired, not adapted.**

---

## 13. Planner Acceptance Gate

Planner must explicitly decide on each of the 3 blocking decisions:

| Decision | Action Required |
|---|---|
| **PD-07A-01** | ACCEPT / MODIFY / REJECT |
| **PD-07A-02** | ACCEPT / MODIFY / REJECT |
| **PD-07A-03** | ACCEPT / MODIFY / REJECT |

### Acceptance Rules

- **ACCEPT** → Decision is frozen for P6-07D implementation
- **MODIFY** → Agent records modification, identifies affected downstream decisions, returns to re-audit if necessary
- **REJECT** → Agent documents rejection, identifies blocking impact, proposes alternative

### Post-Acceptance State

```
3/3 blocking decisions accepted
  → all blocking semantic dependencies resolved
  → P6-07D implementation permitted
```

If Planner modifies any proposed resolution:

- Record the modification
- Do not implement it
- Identify affected downstream decisions
- Return the contract to recon/re-audit if necessary

---

## 14. Post-Acceptance State

After all 3 decisions are ACCEPTED:

| Item | Status |
|---|---|
| PD-07A-01 | FROZEN — Refresh wiring |
| PD-07A-02 | FROZEN — Read API design |
| PD-07A-03 | FROZEN — Legacy retirement |
| P6-07D | PERMITTED — Implementation may begin |
| P6-07E | BLOCKED — Pending P6-07D completion |
| P6-07-FINAL | BLOCKED — Pending P6-07E completion |

---

## 15. Git Boundary

| Check | Result |
|---|---|
| Only documentation file changed | ✅ PASS |
| No production code modified | ✅ PASS |
| No frozen contracts modified | ✅ PASS |
| P4/P5 untouched | ✅ PASS |
| Working tree clean after commit | ✅ PASS |
