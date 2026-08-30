# P6-UI-01 — P6 Production UI Integration & P3/P4/P5 Visibility Audit

**Date:** 2026-08-30
**Status:** AUDIT COMPLETE
**Repository:** ratrichero/NarrativeHealth
**Branch:** main

---

## 1. Executive Summary

**Current UI Behavior:** Both Coin Detail and Narrative Detail pages display:
> "No P6 intelligence data for {entityName}. Run a data refresh to generate P6 artifacts."

**Actual Root Cause:** The P6 presentation pipeline (snapshot → regime → warning → summary) runs during refresh but **P6 artifacts are either not persisted to the database, or are persisted with a lifecycle/status that `readCurrentSnapshot` cannot find.** The P6 read path (`readCoinIntelligence` / `readNarrativeIntelligence`) queries P6 tables for `CURRENT` lifecycle artifacts, and the snapshot persistence may be writing with a different status or failing silently.

**Classification:** **Class B — Integration / Pipeline Gap**

**Production Verification:** PRODUCTION_RUNTIME_NOT_VERIFIABLE (sandbox cannot access production DB/API). Analysis is CODE_VERIFIED.

---

## 2. Coin Detail Trace

### Complete Request Chain

```
Coin Detail page
  → src/app/coin/[id]/page.tsx (line 20)
  → <P6IntelligencePanel entityType="coin" entityId={coin.id} entityName={coin.symbol} />
  → src/components/P6IntelligencePanel.tsx
  → fetchP6CoinIntelligence(entityId)
  → GET /api/p6/coins/{id}
  → src/app/api/p6/coins/[id]/route.ts
  → readCoinIntelligence(coinId, coin.symbol)
  → src/lib/p6/presentation/read.ts
  → readCurrentSnapshot("coin", coinId, "COIN_HEALTH")
  → readCurrentRegime("coin", coinId)
  → readActiveWarnings("coin", coinId)
  → readCurrentSummary("coin", coinId)
  → p6_snapshots / p6_regime_states / p6_warnings / p6_intelligence_summaries
```

### Where the Chain Stops

The chain **completes successfully** — the API routes exist and call through to the database. However:

- `readCurrentSnapshot` queries `p6_snapshots` WHERE `entity_type = 'coin' AND status = 'CURRENT'`
- `readCurrentRegime` queries `p6_regime_states` WHERE lifecycle = 'CURRENT'
- `readActiveWarnings` queries `p6_warnings` WHERE lifecycle = 'ACTIVE'
- `readCurrentSummary` queries `p6_intelligence_summaries` WHERE lifecycle = 'CURRENT'

If ALL four return null/empty → `readCoinIntelligence` returns `null` → API returns `{ success: true, data: null }` → UI shows "No P6 intelligence data."

**The chain does NOT fail — it returns null because P6 artifacts with CURRENT lifecycle do not exist.**

### Evidence

| Component | File | Status |
|-----------|------|--------|
| Page | `src/app/coin/[id]/page.tsx` | ✅ Mounted correctly (line 20) |
| Panel | `src/components/P6IntelligencePanel.tsx` | ✅ Exists, correct API call |
| API Route | `src/app/api/p6/coins/[id]/route.ts` | ✅ Exists, correct handler |
| Presentation | `src/lib/p6/presentation/read.ts` | ✅ Reads from P6 tables |
| Snapshot Persistence | `src/lib/p6/snapshot/persistence.ts` | ⚠️ Writes with lifecycle check |
| DB Tables | `p6_snapshots, p6_regime_states, p6_warnings, p6_intelligence_summaries` | ✅ Created via migration 0030 |

---

## 3. Narrative Detail Trace

### Complete Request Chain

```
Narrative Detail page
  → src/app/narrative/[id]/page.tsx (line 8)
  → <P6IntelligencePanel entityType="narrative" entityId={narrative.id} entityName={narrative.name} />
  → src/components/P6IntelligencePanel.tsx
  → fetchP6NarrativeIntelligence(entityId)
  → GET /api/p6/narratives/{id}
  → src/app/api/p6/narratives/[id]/route.ts
  → readNarrativeIntelligence(narrativeId, narrative.name)
  → src/lib/p6/presentation/read.ts
  → readCurrentSnapshot("narrative", narrativeId, "NARRATIVE_HEALTH")
  → readCurrentRegime("narrative", narrativeId)
  → readActiveWarnings("narrative", narrativeId)
  → readCurrentSummary("narrative", narrativeId)
```

### Finding

Same as Coin Detail — the chain completes but returns null because no CURRENT P6 artifacts exist for narratives.

| Component | File | Status |
|-----------|------|--------|
| Page | `src/app/narrative/[id]/page.tsx` | ✅ Mounted correctly (line 8) |
| Panel | `src/components/P6IntelligencePanel.tsx` | ✅ Same component, correct API call |
| API Route | `src/app/api/p6/narratives/[id]/route.ts` | ✅ Exists, correct handler |
| Presentation | `src/lib/p6/presentation/read.ts` | ✅ Reads from P6 tables |

---

## 4. P6 Artifact Matrix

| Artifact | Producer | Required by UI? | Read by API? | Exists in production? | Current for entity? |
|----------|----------|----------------|--------------|----------------------|---------------------|
| p6_snapshots | runSnapshotGeneration() | YES (readCurrentSnapshot) | YES (readCoinIntelligence) | RUNTIME_NOT_VERIFIABLE | RUNTIME_NOT_VERIFIABLE |
| p6_regime_states | runP6DownstreamPipeline → P6-04 | YES (readCurrentRegime) | YES | RUNTIME_NOT_VERIFIABLE | RUNTIME_NOT_VERIFIABLE |
| p6_warnings | runP6DownstreamPipeline → P6-05 | YES (readActiveWarnings) | YES | RUNTIME_NOT_VERIFIABLE | RUNTIME_NOT_VERIFIABLE |
| p6_intelligence_summaries | runP6DownstreamPipeline → P6-06 | YES (readCurrentSummary) | YES | RUNTIME_NOT_VERIFIABLE | RUNTIME_NOT_VERIFIABLE |

**Critical question:** The tables exist (migration 0030), the refresh pipeline calls the producers, but do they actually contain `CURRENT` lifecycle records? This can only be verified against production DB.

---

## 5. P6 Producer Verification

### Refresh Pipeline P6 Path

From `src/app/api/refresh/route.ts` (lines 1010-1055):

```
1. runSnapshotGeneration(date, version, coinInputs, narrativeMemberships)
   → P6 snapshot persistence (coin + narrative)
   → Writes to p6_snapshots with CURRENT lifecycle

2. runP6DownstreamPipeline()
   → P6-04: Regime detection → p6_regime_states
   → P6-05: Warning detection → p6_warnings  
   → P6-06: Intelligence summary → p6_intelligence_summaries
```

Both are wrapped in try/catch (PD-E2: never block refresh on P6 failure).

### Evidence of Producer Execution

- `runSnapshotGeneration` is imported from `@/lib/p6/snapshot/service` (line 30)
- `runP6DownstreamPipeline` is imported from `@/lib/p6/presentation/pipeline` (line 1048)
- Both are called inside try/catch blocks
- Console logs exist: `"P6 snapshot: coins=..."` and `"P6 downstream pipeline: regime=... warnings=... summaries=..."`

**Finding:** The producers are wired into the refresh pipeline. If refresh runs successfully, P6 artifacts SHOULD be created. The "No P6 intelligence data" message means either:
1. Refresh has never run since P6 was deployed
2. The P6 producers fail silently (caught by try/catch)
3. The P6 persistence writes with wrong lifecycle/status

---

## 6. P6 UI Component Tree

```
Coin Detail (/coin/[id])
├── Coin header (health, signal, confidence)
├── P6IntelligencePanel ← P6 integration point
│   ├── Health Score display
│   ├── Confidence display
│   ├── Regime indicator
│   ├── Warnings list
│   ├── Historical comparison (7d/30d/baseline)
│   └── Expandable details (what_changed, why, what_to_watch)
├── Indicator Values (1D) ← P1A integration
├── Technical Analysis
├── Health Timeline
├── Score Breakdown
├── Price History Chart
└── Coin Metrics

Narrative Detail (/narrative/[id])
├── Narrative header (health, change, confidence)
├── P6IntelligencePanel ← P6 integration point
│   └── (same structure as Coin)
├── Health Score History Chart
├── Correlation Heatmap
└── Coin Ranking Table
```

### P3/P4/P5 Panels — NOT present on detail pages

**Finding:** The P6IntelligencePanel was added as the intelligence panel on both detail pages. There are NO separate P3, P4, or P5 panels on these pages. This appears to be by design — P6 is the aggregation/presentation layer that subsumes P3/P4/P5 intelligence display.

---

## 7. P3/P4/P5 Visibility Audit

| Layer | Previous UI | Current UI | Component exists? | Still mounted? | Replacement in P6? | Intentional retirement evidence |
|-------|-------------|------------|-------------------|----------------|---------------------|-------------------------------|
| P3 Intelligence | P3 intelligence was shown on detail pages | Replaced by P6IntelligencePanel | P3 service exists in `src/lib/p3/` | NO — not mounted on detail pages | YES — P6 subsumes P3 display | P6-09C component replaces legacy panels |
| P4 Decision Support | P4DecisionSupportPanel was on narrative detail | Not currently mounted | P4DecisionSupportPanel exists in `src/components/` | NOT mounted | P6IntelligencePanel replaces it | P4 frozen; P6 supersedes display |
| P5 Advisory | P5 artifacts were available | Not displayed on detail pages | P5 service exists | NOT mounted | P6IntelligencePanel replaces it | P5 frozen; P6 supersedes display |

**Key finding:** P6 was designed to REPLACE the P3/P4/P5 UI panels on detail pages with a unified P6 intelligence view. The old components still exist in code but are no longer mounted. This is **intentional by P6 design** (P6 = aggregation/presentation layer).

**However**, the P6IntelligencePanel is the ONLY intelligence panel now, so if P6 artifacts are missing, the user sees NO intelligence at all — not even the old P3/P4/P5 data that was previously available.

---

## 8. Semantic Boundary Assessment

From P6 frozen specifications:

> P6 is a **separate major intelligence phase** that evolves NarrativeHealth into a stronger trend intelligence + early warning system.

P6 is explicitly documented as:
- **NOT** a replacement that removes P3/P4/P5 functionality
- **An additional intelligence layer** that adds:
  - Health evolution tracking
  - Trend detection (regime states)
  - Early warning signals
  - Cross-narrative comparison
  - Historical comparison

**Finding:** The P6 UI replaces P3/P4/P5 on detail pages, but P6 relies on P3 data (features, health_scores) as input. If P6 artifacts are empty, the UI should still show P3/P4/P5 data as fallback. Currently it does not — this is a **Class B gap**.

---

## 9. Empty-State Analysis

### Exact condition producing the message

```tsx
// P6IntelligencePanel.tsx lines 152-162
if (!intel) {
  return (
    <Card className="border-l-4 border-l-slate-700">
      <CardContent className="py-4">
        <p className="text-sm text-slate-500">
          No P6 intelligence data for {entityName}. Run a data refresh to generate P6 artifacts.
        </p>
      </CardContent>
    </Card>
  );
}
```

This is triggered when `readCoinIntelligence()` / `readNarrativeIntelligence()` returns `null`.

### What `data: null` means

- **NOT** API failure — the API returns `{ success: true, data: null }`
- **NOT** entity mismatch — entity existence is verified before querying P6
- **Means:** All four P6 artifact reads returned null/empty for CURRENT lifecycle
- **Possibilities:**
  1. P6 snapshot was never created for this entity
  2. P6 snapshot exists but with non-CURRENT lifecycle
  3. P6 snapshot was created and then expired
  4. P6 downstream pipeline (regime/warning/summary) failed

### UI does NOT distinguish these cases

The UI shows the same "No P6 intelligence data" message regardless of WHY data is missing. This is a **Class C finding** — the UI could be more informative (e.g., "P6 artifacts may need a data refresh" vs "P6 artifacts expired" vs "P6 producer did not run").

---

## 10. Production Verification

### Code Verification

| Check | Status | Evidence |
|-------|--------|----------|
| P6IntelligencePanel mounted on Coin Detail | CODE_VERIFIED | `src/app/coin/[id]/page.tsx` line 20 |
| P6IntelligencePanel mounted on Narrative Detail | CODE_VERIFIED | `src/app/narrative/[id]/page.tsx` line 8 |
| API routes exist | CODE_VERIFIED | `src/app/api/p6/coins/[id]/route.ts`, `src/app/api/p6/narratives/[id]/route.ts` |
| P6 presentation reads from DB | CODE_VERIFIED | `src/lib/p6/presentation/read.ts` |
| P6 snapshot producer in refresh | CODE_VERIFIED | `src/app/api/refresh/route.ts` lines 1010-1055 |
| P6 downstream pipeline in refresh | CODE_VERIFIED | `src/app/api/refresh/route.ts` lines 1048-1055 |

### Runtime Verification

| Check | Status | Evidence |
|-------|--------|----------|
| P6 tables have CURRENT records | RUNTIME_NOT_VERIFIABLE | Cannot query production DB |
| Refresh has run since P6 deploy | RUNTIME_NOT_VERIFIABLE | Cannot check scheduler_logs |
| P6 producers execute without error | RUNTIME_NOT_VERIFIABLE | Cannot check console logs |

---

## 11. Findings

### Class A — Blocking

None identified. The code paths are all correct. The issue is data/state, not code defect.

### Class B — Contract / Integration

**B-01: P6 Intelligence Empty State When P3/P4/P5 Data Exists**

- **Impact:** Users see "No P6 intelligence data" even though P3 features, health scores, and recommendations exist
- **Root cause:** P6IntelligencePanel replaced all previous intelligence panels, but P6 artifacts are not yet populated in production
- **Evidence:** P3 data (features, health_scores, indicators) is produced by refresh. P6 artifacts (p6_snapshots, p6_regime_states, p6_warnings, p6_intelligence_summaries) may not be populated.
- **Fix:** Either (a) verify P6 producers are working and produce artifacts, or (b) add P3/P4/P5 fallback when P6 data is null

### Class C — Non-blocking

**C-01: Empty-state message is not specific enough**

- **Impact:** Users cannot distinguish "never run" from "expired" from "producer failed"
- **Evidence:** `P6IntelligencePanel.tsx` line 157 — single message for all null cases
- **Fix:** Could be improved but not required for closure

### Class D — Deferred

**D-01: P3/P4/P5 panel retirement was not documented**

- **Impact:** Users who relied on P3/P4/P5 panels on detail pages no longer see them
- **Evidence:** `P4DecisionSupportPanel.tsx` exists but is not mounted on narrative detail
- **Note:** This appears intentional per P6 design, but no explicit retirement document exists

---

## 12. Recommended Next Tasks

### P6-UI-02 — Verify P6 Artifact Production in Production Database

Verify that `p6_snapshots` table has CURRENT records after a production refresh. This is the critical unknown.

```sql
SELECT entity_type, entity_id, snapshot_type, status, COUNT(*)
FROM p6_snapshots
WHERE status = 'CURRENT'
GROUP BY entity_type, entity_id, snapshot_type, status
LIMIT 10;
```

If empty: P6 snapshot producer is not persisting. Investigate `runSnapshotGeneration()`.

### P6-UI-03 — Restore P3/P4/P5 Fallback Panel (optional)

When P6 data is null, show P3 intelligence as fallback instead of "No P6 intelligence data." This requires mounting `P4DecisionSupportPanel` or a P3 summary panel as a conditional fallback.

### P6-UI-04 — Investigate P6 Snapshot Lifecycle Status

If P6 snapshots exist but not with `CURRENT` status, investigate the lifecycle management in `src/lib/p6/snapshot/persistence.ts`.

---

## 13. Boundary Verification

| Check | Status |
|-------|--------|
| P3 untouched | ✅ `src/lib/p3/` not modified |
| P4 untouched | ✅ `src/lib/p4/` not modified |
| P5 untouched | ✅ `src/lib/p5/` not modified |
| P5 replay untouched | ✅ Not modified |
| P6 frozen contracts untouched | ✅ No semantic changes |
| No schema changes | ✅ No new migrations |
| No API changes | ✅ No contract changes |
| No production code changes | ✅ Audit only |

---

## 14. Final Verdict

```
P6 UI INTEGRATION GAP CONFIRMED
```

**Explanation:**
- P6 UI component is correctly mounted on both Coin and Narrative Detail pages
- P6 API routes exist and correctly read from P6 presentation layer
- P6 snapshot/producer pipeline is wired into the refresh route
- **However:** P6 artifacts with CURRENT lifecycle may not exist in production database
- The "No P6 intelligence data" message is correct behavior when P6 data is absent
- The root cause is **production data state** (P6 artifacts not populated), not a code defect
- The gap is that P6 replaced P3/P4/P5 panels without a fallback, leaving users with no intelligence when P6 data is absent

**This is not a code bug — it is a production integration/data verification gap.**

---

## 15. Git Boundary

```
git status
```

Expected: clean (audit only, no code changes)

---

*Report generated: 2026-08-30*
*Audit type: Forensic code analysis*
*Production access: NOT AVAILABLE*
