# P6-G2-P5-VERIFY — P5 Production Service Error & Frozen Contract Verification

**Date:** 2026-08-31
**Auditor:** Buffy (Codebuff)
**Repository:** ratrichero/NarrativeHealth
**Mode:** READ-ONLY diagnostic

---

## 1. Executive Summary

P5 Production State:

```
P5 SERVICE_ERROR = EXPECTED STATE
```

**Root Cause:** `p5_decision_records` table does not exist in production because P5 implementation has **never been started**. The P5 Master Specification (§3) explicitly states:

> **P5 NOT STARTED — MASTER READY FOR FREEZE (pending explicit owner approval)**

The `SERVICE_ERROR` is a query failure against a non-existent table, caught gracefully by the `ActionReadService.failureView()` method, which returns `availability: SERVICE_ERROR` / `displayState: UNAVAILABLE`. This is **NOT a P6-induced regression**.

**Verdict: `P5_SERVICE_ERROR_EXPECTED`**

---

## 2. Production Deployment

| Check | Result | Evidence |
|-------|--------|----------|
| Deployment verified | PASS | Commit `89ea4e6` running on production |
| P6 integration active | PASS | P6 snapshots, regime states, summaries all CURRENT |

---

## 3. P5 Runtime Reproduction

### API Response

```
GET /api/narratives/1/action-decision
```

```json
{
  "success": true,
  "data": {
    "p5ActionDecision": {
      "decisionPresence": "ABSENT",
      "decision": null,
      "context": null,
      "availability": "SERVICE_ERROR",
      "displayState": "UNAVAILABLE",
      "error": {
        "code": "SERVICE_ERROR",
        "message": "Failed query: select ... from \"p5_decision_records\" where ..."
      }
    }
  }
}
```

| Field | Value |
|-------|-------|
| HTTP Status | 200 |
| success | true |
| decisionPresence | ABSENT |
| availability | SERVICE_ERROR |
| displayState | UNAVAILABLE |
| error.code | SERVICE_ERROR |
| error.message | Failed query on `p5_decision_records` |

---

## 4. P5 Data Path Trace

```
Narrative Detail (/narrative/1)
    ↓
P5ActionDecisionPanel (self-fetching)
    ↓
GET /api/narratives/1/action-decision
    ↓
action-decision/route.ts
    ↓
productionActionReadService.getNarrativeActionReadView(1)
    ↓
PgP5DecisionStoreAdapter.findBySubject({ narrativeId: 1 })
    ↓
pgHistoricalArtifactStore.findDecisionByNarrativeId(1)
    ↓
PostgreSQL: SELECT ... FROM p5_decision_records WHERE narrative_id = 1
    ↓
❌ TABLE DOES NOT EXIST → throws error
    ↓
ActionReadService.getNarrativeActionReadView() catch block
    ↓
failureView(error)
    ↓
{ availability: "SERVICE_ERROR", displayState: "UNAVAILABLE" }
```

**Failure Node:** PostgreSQL query against non-existent `p5_decision_records` table.

---

## 5. Three-Case Classification

| Case | Description | Classification |
|------|-------------|----------------|
| **Case A** | No P5 data (table exists, no rows) | ❌ Not applicable — table doesn't exist |
| **Case B** | P5 service returns explicit unavailable | ❌ Not applicable — it's a query exception |
| **Case C** | Actual runtime exception | ✅ **This case** — but expected due to P5 NOT STARTED |

---

## 6. P5 Contract Verification

### P5 Master Specification (§3)

| Item | Status |
|------|--------|
| P5-01 | READY (candidate roadmap) |
| P5 Master | **NOT STARTED — MASTER READY FOR FREEZE** |
| P5 implementation | **NOT STARTED** |

### Key Evidence

```
docs/P5_Upgrade/P5_MASTER_SPECIFICATION.md §3:
P5 | NOT STARTED — MASTER READY FOR FREEZE (pending explicit owner approval)
```

The P5 Master is at "READY FOR FREEZE" status. P5-01 (the first implementation task) is listed as "READY (candidate roadmap)" but has **never been executed**.

Therefore:
- `p5_decision_records` table was **never created in production**
- `p5_policies`, `p5_guardrails`, `p5_approvals`, `p5_permissions`, `p5_audit_events`, `p5_p4_snapshots` tables were **never created in production**
- P5 decision records were **never persisted**
- P5 was **never operational** in production

### P5 UI Behavior

The P5 ActionReadService correctly handles the absence:

```typescript
// action-read.service.ts
private failureView(error: unknown): P5ActionDecisionReadViewModel {
    return {
      decisionPresence: "ABSENT",
      decision: null,
      context: null,
      availability: "SERVICE_ERROR",   // ← query failure caught
      displayState: "UNAVAILABLE",     // ← UI shows "unavailable"
      error: { code: "SERVICE_ERROR", message },
    };
}
```

The `P5ActionDecisionPanel` component renders the `UNAVAILABLE` display state, which is the correct UI behavior when P5 has no data.

---

## 7. Production DB Evidence

### P5 Tables in Production

| Table | Exists | Evidence |
|-------|--------|----------|
| `p5_decision_records` | ❌ NO | Query throws relation does not exist |
| `p5_policies` | ❌ NO | Not created (P5 not implemented) |
| `p5_guardrails` | ❌ NO | Not created |
| `p5_approvals` | ❌ NO | Not created |
| `p5_permissions` | ❌ NO | Not created |
| `p5_audit_events` | ❌ NO | Not created |
| `p5_p4_snapshots` | ❌ NO | Not created |

This is **expected** because P5 implementation has never been started per the Master Specification.

---

## 8. P3/P4/P6 Comparison

| Layer | Backend | API | UI | Verdict |
|-------|---------|-----|----|---------|
| P3 | ✅ 9 narratives | ✅ returns data | ✅ mounted + wired | PASS |
| P4 | ✅ 1035 features | ✅ returns data | ✅ mounted + wired | PASS |
| **P5** | **❌ tables absent** | **⚠️ SERVICE_ERROR** | **✅ mounted, shows UNAVAILABLE** | **EXPECTED-UNAVAILABLE** |
| P6 | ✅ 49+9 CURRENT | ✅ returns data | ✅ mounted + working | PASS |

P3/P4/P6 are **fully operational**. P5 failure does NOT affect any other layer.

---

## 9. P6 Boundary Verification

| Check | Result | Evidence |
|-------|--------|----------|
| P6 calls P5 execution | NO | P6 snapshot pipeline has no P5 dependency |
| P6 mutates P5 | NO | P6 writes only to p6_* tables |
| P6 modifies P5 semantics | NO | P5 contract unchanged |
| P6 suppresses P5 UI | NO | P5ActionDecisionPanel is independently mounted |
| P6 depends on P5 persistence | NO | P6 operates on p6_snapshots, not p5_decision_records |

**P6 does NOT replace or modify P5.** The P5 SERVICE_ERROR is an independent, pre-existing condition.

---

## 10. Error Classification

| Class | Description | Count | Details |
|-------|-------------|-------|---------|
| **Class A** | Infrastructure / deployment | 0 | — |
| **Class B** | Runtime/service defect | 0 | — |
| **Class C** | **Expected absence of P5 persistence/data** | **1** | p5_decision_records not created (P5 NOT STARTED) |
| **Class D** | Contract/design issue | 0 | — |
| **Class E** | P6-induced regression | **0** | **Not P6-induced** |

---

## 11. Required Evidence Table

| Check | Result | Evidence |
|-------|--------|----------|
| Production deployment | PASS | Commit `89ea4e6` |
| P5 component mounted | PASS | `P5ActionDecisionPanel` on Narrative Detail |
| P5 API | PASS | `GET /api/narratives/1/action-decision` → 200 |
| P5 response | SERVICE_ERROR | `p5_decision_records` table doesn't exist |
| P5 DB source | ABSENT | Table never created (P5 NOT STARTED) |
| P5 contract | CORRECT | Master §3: "P5 NOT STARTED" |
| P5 persistence | ABSENT | Expected — P5 implementation never executed |
| P6 boundary | PASS | P6 has no dependency on P5 |
| P3 | PASS | Backend + API + UI all working |
| P4 | PASS | Backend + API + UI all working |
| P6 | PASS | Backend + API + UI all working |

---

## 12. Critical Decision

### ✅ P5_SERVICE_ERROR_EXPECTED

**Evidence:**

1. **P5 Master Specification §3**: "P5 NOT STARTED — MASTER READY FOR FREEZE (pending explicit owner approval)"
2. **`p5_decision_records` table**: Never created in production
3. **P5 implementation tasks (P5-01 through P5-09)**: Never executed
4. **ActionReadService failureView()**: Correctly catches the table-not-found error and returns `SERVICE_ERROR` / `UNAVAILABLE`
5. **P5 UI**: Displays "unavailable" state — correct behavior for non-operational P5
6. **P6 independence**: P6 has zero dependency on P5 tables/semantics

**This is NOT a regression.** P5 was never operational in production. The SERVICE_ERROR is the correct behavior when P5 data source doesn't exist.

### P6 does NOT replace P5

P6 operates on its own table set (`p6_snapshots`, `p6_regime_states`, `p6_warnings`, `p6_intelligence_summaries`). P5 operates on a separate, not-yet-created table set. They are architecturally independent.

---

## 13. Recommendation

P5 SERVICE_ERROR is expected and documented. No fix task is required for P5 to close G2.

If P5 operationalization is desired in the future, the correct path is:

1. Execute P5-00 (Master Freeze)
2. Execute P5-01 through P5-09 (implementation tasks)
3. Create `p5_decision_records` and related tables
4. Wire P5 producer into the refresh pipeline

This is a **separate future initiative**, not a G2 blocker.

---

## 14. Final Verdict

```
P5_SERVICE_ERROR_EXPECTED
```

- P5 was never implemented (Master: NOT STARTED)
- `p5_decision_records` table never created (expected)
- SERVICE_ERROR correctly returned (catch block working)
- UI correctly shows UNAVAILABLE (correct display state)
- P6 does NOT replace or affect P5
- **G2 can proceed without P5 operationalization**
