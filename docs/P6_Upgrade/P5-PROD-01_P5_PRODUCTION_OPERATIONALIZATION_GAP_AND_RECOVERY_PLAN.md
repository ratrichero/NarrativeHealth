# P5-PROD-01 — P5 Production Operationalization Gap & Recovery Plan

**Date:** 2026-08-31
**Auditor:** Buffy (Codebuff)
**Repository:** ratrichero/NarrativeHealth
**Mode:** AUDIT + RECOVERY PLAN (READ-ONLY)

---

## 1. Executive Summary

**P5 is SUBSTANTIALLY IMPLEMENTED in code but NOT OPERATIONAL in production.**

The gap is specific and narrow: **database tables were never created**. The P5 application code (policy engine, safety evaluator, explanation engine, decision producer, artifact recorder, read service, API route, UI panel, replay engine, integration adapter) exists, compiles, and passes 258/258 tests. But the `p5_decision_records` table and all related P5 persistence tables were never added to the Drizzle schema or production database.

**This is NOT a "not started" situation.** The P5 Master Specification's claim of "NOT STARTED" is **contradicted** by the codebase evidence. The P5_BASELINE.md document explicitly states "IMPLEMENTATION COMPLETE / BASELINE FROZEN".

**Recovery Classification: B — COMPLETE PARTIAL IMPLEMENTATION**

The code exists. The tables need to be created and wired.

---

## 2. P5 Specification Audit

### 2.1 Status Contradiction

| Document | Claimed Status | Evidence |
|----------|---------------|----------|
| P5 Master Specification §3 | "NOT STARTED — MASTER READY FOR FREEZE" | Contradicted by codebase |
| P5_BASELINE.md §16 | "IMPLEMENTATION COMPLETE / BASELINE FROZEN" | Matches codebase evidence |
| README.md | "P5 Advisory Decision Layer — CLOSED / FROZEN" | Matches codebase evidence |
| P5-01 Contract Gap Audit | "AUDIT COMPLETE — READY FOR P5-02" | Matches |

**The P5 Master Specification §3 is stale.** The codebase shows P5-01 through P5-11 tasks were all executed with formal audit documentation.

### 2.2 Frozen Semantic Decisions

| Decision | Source | Status |
|----------|--------|--------|
| Outcome vocabulary (SELECTED, NO_ACTION, BLOCKED, NOT_DETERMINED) | P5-02 AD-004 | FROZEN |
| Action type taxonomy (MONITOR, REVIEW, INVESTIGATE, REDUCE_EXPOSURE, INCREASE_EXPOSURE, REBALANCE) | P5-02 AD-005 | PROVISIONAL |
| Three orthogonal state dimensions (decision, approval, execution) | P5-02 AD-009 | FROZEN |
| Advisory-only V1 | P5-04 SG-010 | FROZEN |
| No BUY/SELL shortcut | P5 Master §1, §5, §8 | FROZEN |
| Decision identity = deterministic hash of identity tuple | P5-02 AD-013/AD-018 | FROZEN |
| Historical-over-live boundary | P5-07 | FROZEN |
| contentHash = PROVISIONAL (always null in V1) | P5-02 AD-014 | PROVISIONAL |

### 2.3 Specification vs Code Conflict

The P5 Master Specification §3 says "NOT STARTED" but:
- P5-01 through P5-11 all have formal completion documents
- 28 implementation files exist in `src/lib/p5/`
- 258/258 P5 tests pass
- P5_BASELINE.md declares "IMPLEMENTATION COMPLETE / BASELINE FROZEN"
- README.md lists P5 as "CLOSED / FROZEN"

**Finding: The P5 Master Specification §3 needs to be updated to reflect actual state.**

---

## 3. Codebase Implementation Audit

### 3.1 Component Matrix

| Component | Spec | Code | Status | Evidence |
|-----------|------|------|--------|----------|
| P5-02 Action Model / Types | P5-02 | `src/lib/p5/types.ts` (299 lines) | **IMPLEMENTED** | Frozen vocabulary, state dimensions, record types |
| P5-03 Policy Evaluator | P5-03-RT | `src/lib/p5/policy/evaluator.ts` | **IMPLEMENTED** | 49 tests, 5-layer pipeline, frozen V1 rules |
| P5-03 Policy Rules | P5-03 | `src/lib/p5/policy/rules.ts` | **IMPLEMENTED** | R-001..R-008, C-* rules |
| P5-03 Policy Types | P5-03 | `src/lib/p5/policy/types.ts` | **IMPLEMENTED** | P5PolicyEvaluationInput/Result |
| P5-04 Safety Evaluator | P5-04-RT | `src/lib/p5/safety/evaluator.ts` | **IMPLEMENTED** | 30 tests, V1 PASS/NOT_REQUIRED/NOT_APPLICABLE |
| P5-04 Safety Types | P5-04 | `src/lib/p5/safety/types.ts` | **IMPLEMENTED** | P5SafetyEvaluationResult |
| P5-05 Explanation Evaluator | P5-05-RT | `src/lib/p5/explanation/evaluator.ts` | **IMPLEMENTED** | P5-05 §6 frozen |
| P5-05 Explanation Types | P5-05 | `src/lib/p5/explanation/types.ts` | **IMPLEMENTED** | P5ExplanationResult |
| P5-06A Read Service | P5-06 | `src/lib/p5/read/action-read.service.ts` | **IMPLEMENTED** | P5DecisionStore boundary, failureView |
| P5-06A Display State | P5-06 | `src/lib/p5/read/display-state.ts` | **IMPLEMENTED** | Presentation classification |
| P5-06A Production Wiring | P5-06 | `src/lib/p5/read/production.ts` | **IMPLEMENTED** | PgP5DecisionStoreAdapter |
| P5-07 Replay Engine | P5-07 | `src/lib/p5/replay/replay-engine.ts` | **IMPLEMENTED** | RECONSTRUCT/VALIDATE/COMPARE |
| P5-07 Artifact Resolver | P5-07 | `src/lib/p5/replay/artifact-resolver.ts` | **IMPLEMENTED** | Exact identity+version resolution |
| P5-07 PG Artifact Store | P5-08 | `src/lib/p5/replay/pg-artifact-store.ts` | **IMPLEMENTED** | PgHistoricalArtifactStore/Writer |
| P5-07 Types | P5-07 | `src/lib/p5/replay/types.ts` | **IMPLEMENTED** | Historical artifacts |
| P5-08 Production Wiring | P5-08 | `src/lib/p5/replay/production.ts` | **IMPLEMENTED** | DrizzleP5RowStore |
| P5-09 Artifact Recorder | P5-09 | `src/lib/p5/record/p5-artifact-recorder.ts` | **IMPLEMENTED** | Single commit boundary |
| P5-09 Production Wiring | P5-09 | `src/lib/p5/record/production.ts` | **IMPLEMENTED** | PgHistoricalArtifactWriter |
| P5-10 Decision Producer | P5-10 | `src/lib/p5/producer/p5-decision-producer.ts` | **IMPLEMENTED** | Pure assembly, zero evaluation logic |
| P5-10 Producer Types | P5-10 | `src/lib/p5/producer/types.ts` | **IMPLEMENTED** | P5ProducerInput/Options |
| P5-10 Production Wiring | P5-10 | `src/lib/p5/producer/production.ts` | **IMPLEMENTED** | ProductionDecisionProducer |
| P5-11 Runtime Adapter | P5-11 | `src/lib/p5/integration/p5-runtime-adapter.ts` | **IMPLEMENTED** | P4→P5-03→P5-04→P5-05→P5-10→P5-09 chain |
| P5-11 Production Wiring | P5-11 | `src/lib/p5/integration/index.ts` | **IMPLEMENTED** | Barrel export |
| P5 API Route | P5-06B | `src/app/api/narratives/[id]/action-decision/route.ts` | **IMPLEMENTED** | GET, read-only, additive |
| P5 UI Component | P5-06C | `src/components/P5ActionDecisionPanel.tsx` | **IMPLEMENTED** | Self-fetching panel |

### 3.2 Dead Code / Unused: **NONE**

All 28 files are structurally complete and import-linked. No orphaned modules.

### 3.3 Summary

| Category | Count |
|----------|-------|
| IMPLEMENTED | **28 components** |
| PARTIALLY_IMPLEMENTED | **0** |
| DOCUMENTATION_ONLY | **0** |
| MISSING | **0** |
| DEAD_CODE | **0** |

---

## 4. Database / Migration Audit

### 4.1 Schema Definition

| Check | Result | Evidence |
|-------|--------|----------|
| `p5_decision_records` in `src/db/schema.ts` | **MISSING** | Not found in search |
| `p5Policies` in schema | **MISSING** | Not found |
| `p5Guardrails` in schema | **MISSING** | Not found |
| `p5Approvals` in schema | **MISSING** | Not found |
| `p5Permissions` in schema | **MISSING** | Not found |
| `p5P4Snapshots` in schema | **MISSING** | Not found |
| `p5AuditEvents` in schema | **MISSING** | Not found |

### 4.2 Migration Files

| Check | Result | Evidence |
|-------|--------|----------|
| `drizzle/migrations/*p5*` | **NONE** | glob returned 0 files |
| `CREATE TABLE.*p5` in any SQL | **NONE** | No P5 table creation SQL found |

### 4.3 Production DB

| Check | Result | Evidence |
|-------|--------|----------|
| `p5_decision_records` table | **MISSING** | API returns "Failed query" error |
| `p5_policies` table | **MISSING** | P5-08 §3 documents absence |
| `p5_guardrails` table | **MISSING** | P5-08 §3 documents absence |
| `p5_approvals` table | **MISSING** | P5-08 §3 documents absence |
| `p5_permissions` table | **MISSING** | P5-08 §3 documents absence |
| `p5_p4_snapshots` table | **MISSING** | P5-08 §3 documents absence |
| `p5_audit_events` table | **MISSING** | P5-08 §3 documents absence |

### 4.4 Critical Finding

**The P5-08 documentation itself acknowledges this gap:**

> "Every artifact stored has... Every artifact class... Producer: NONE (P5-03 contract-only)"

The P5-08 doc describes the store architecture but explicitly notes that no P5 producer exists yet (meaning the decision pipeline never materializes records into the DB).

### 4.5 Root Cause

The P5 code implementation was done in a "contract-only" mode:
- The drizzle `schema.ts` imports `p5DecisionRecords` etc. from `@/db/schema`
- But these table objects were **never added to `src/db/schema.ts`**
- No migration SQL was ever created or applied
- The code compiles because it only references the types, not the schema objects at import time
- At runtime, the PostgreSQL query fails because the table doesn't exist

---

## 5. P5 API Audit

### 5.1 Action Decision Route

| Check | Result |
|-------|--------|
| Route exists | ✅ `src/app/api/narratives/[id]/action-decision/route.ts` |
| Service exists | ✅ `productionActionReadService` |
| Method | GET (read-only) |
| Response contract | `{ success, data: { p5ActionDecision: P5ActionDecisionReadViewModel } }` |

### 5.2 Runtime Behavior

```
GET /api/narratives/1/action-decision
→ 200 OK
→ { success: true, data: { p5ActionDecision: {
    decisionPresence: "ABSENT",
    availability: "SERVICE_ERROR",
    displayState: "UNAVAILABLE",
    error: { code: "SERVICE_ERROR", message: "Failed query: ... p5_decision_records ..." }
}}}
```

### 5.3 Failure Chain

```
P5 API Route
    ↓
productionActionReadService.getNarrativeActionReadView(1)
    ↓
PgP5DecisionStoreAdapter.findBySubject({ narrativeId: 1 })
    ↓
pgHistoricalArtifactStore.findDecisionByNarrativeId(1)
    ↓
PostgreSQL: SELECT FROM p5_decision_records WHERE narrative_id = 1
    ↓
❌ relation "p5_decision_records" does not exist
    ↓
ActionReadService.failureView()
    ↓
{ availability: "SERVICE_ERROR", displayState: "UNAVAILABLE" }
```

---

## 6. Production Verification

### 6.1 Current Production State

| Check | Result |
|-------|--------|
| P5 API HTTP status | 200 (graceful degradation) |
| P5 availability | SERVICE_ERROR |
| P5 displayState | UNAVAILABLE |
| P5 error code | SERVICE_ERROR |
| P5 error message | "Failed query... p5_decision_records" |
| P5 decision records in DB | 0 (table doesn't exist) |
| P5 UI mounted | ✅ P5ActionDecisionPanel |
| P5 UI state | UNAVAILABLE (correct for missing persistence) |

### 6.2 Classification

This is **Class C — Expected Absence of P5 Persistence** given the current state, BUT the P5 code implementation IS complete. The gap is specifically:

```
P5 application code: FULLY IMPLEMENTED
P5 database persistence: NOT IMPLEMENTED (missing schema + migrations)
P5 production integration: PARTIALLY (API exists but fails at persistence layer)
```

---

## 7. P3/P4/P6 Boundary Audit

| Check | Result |
|-------|--------|
| P5 depends on P3 | NO — P5 consumes P4 ViewModel, never P3 directly |
| P5 depends on P4 | YES — P5 consumes `P4DecisionSupportViewModel` (frozen input contract) |
| P5 depends on P6 | NO — P6 is additive intelligence, independent of P5 |
| P6 replaces P5 | NO — P6 has zero dependency on P5 tables/semantics |
| P5 replaces P3 | NO — P5 answers "what action?", P3 answers "what is happening?" |
| P5 replaces P4 | NO — P5 answers "what action given interpretation?", P4 answers "what does it mean?" |

**Architecture preserved:**

```
P3 (What is happening?) → P4 (What does it mean?) → P5 (What should be done?)
                                                            ↑
                                                       P6 (Intelligence layer — additive)
```

---

## 8. UI Audit

### 8.1 Narrative Detail

| Component | Mounted | Self-fetching | Data Source |
|-----------|---------|---------------|-------------|
| P6IntelligencePanel | ✅ | ✅ | P6 API |
| P5ActionDecisionPanel | ✅ | ✅ | `/api/narratives/[id]/action-decision` |
| P4DecisionSupportPanel | ✅ | ❌ (prop) | `narrative.p4DecisionSupport` |
| P3IntelligencePanel | ✅ | ❌ (prop) | `narrative.p3Intelligence` |

### 8.2 P5 UI Behavior

P5ActionDecisionPanel fetches from `/api/narratives/[id]/action-decision`. When P5 persistence is absent:
- API returns `SERVICE_ERROR`
- Component displays UNAVAILABLE state
- This is correct behavior for missing persistence

---

## 9. Recoverability Assessment

### Classification: **B — COMPLETE PARTIAL IMPLEMENTATION**

P5 code is 100% implemented. The ONLY gap is database persistence (schema + migrations + production table creation). No application code changes are needed.

### Gap Analysis

| Layer | Status | Action Required |
|-------|--------|----------------|
| P5 Types/Contracts | ✅ COMPLETE | None |
| P5 Policy Engine (P5-03) | ✅ COMPLETE | None |
| P5 Safety Evaluator (P5-04) | ✅ COMPLETE | None |
| P5 Explanation (P5-05) | ✅ COMPLETE | None |
| P5 Decision Producer (P5-10) | ✅ COMPLETE | None |
| P5 Artifact Recorder (P5-09) | ✅ COMPLETE | None |
| P5 Historical Store (P5-08) | ✅ CODE COMPLETE | None (but tables missing) |
| P5 Replay Engine (P5-07) | ✅ COMPLETE | None |
| P5 Read Service (P5-06) | ✅ COMPLETE | None |
| P5 Integration Adapter (P5-11) | ✅ CODE COMPLETE | None (but not wired into production caller) |
| P5 API Route | ✅ COMPLETE | None |
| P5 UI Component | ✅ COMPLETE | None |
| **P5 Schema (drizzle)** | ❌ **MISSING** | Add p5_* tables to schema.ts |
| **P5 Migration SQL** | ❌ **MISSING** | Create migration file |
| **P5 Production Tables** | ❌ **MISSING** | Apply migration to production DB |
| **P5 Producer Integration** | ❌ **NOT WIRED** | Wire P5-11 into refresh pipeline |

---

## 10. Gap Matrix

| P5 Requirement | Spec | Code | DB Schema | Migration | Production | API | UI | Test | Status |
|---------------|------|------|-----------|-----------|------------|-----|----|------|--------|
| Decision Record | P5-02 | ✅ | ❌ | ❌ | ❌ | ✅ (fails) | ✅ | ✅ | **BLOCKED BY DB** |
| Policy Rules | P5-03 | ✅ | N/A | N/A | N/A | N/A | N/A | ✅ | COMPLETE |
| Safety/Guardrail | P5-04 | ✅ | N/A | N/A | N/A | N/A | N/A | ✅ | COMPLETE |
| Explanation | P5-05 | ✅ | N/A | N/A | N/A | N/A | N/A | ✅ | COMPLETE |
| Read Service | P5-06 | ✅ | ❌ (depends) | ❌ | ❌ | ✅ (fails) | ✅ | ✅ | **BLOCKED BY DB** |
| Replay | P5-07 | ✅ | ❌ (depends) | ❌ | ❌ | N/A | N/A | ✅ | **BLOCKED BY DB** |
| Artifact Persistence | P5-08 | ✅ | ❌ | ❌ | ❌ | N/A | N/A | ✅ | **BLOCKED BY DB** |
| Artifact Recording | P5-09 | ✅ | ❌ (depends) | ❌ | ❌ | N/A | N/A | ✅ | **BLOCKED BY DB** |
| Decision Producer | P5-10 | ✅ | N/A | N/A | N/A | N/A | N/A | ✅ | COMPLETE |
| Runtime Integration | P5-11 | ✅ | N/A | N/A | N/A | N/A | N/A | ✅ | COMPLETE (not wired) |
| API Route | P5-06B | ✅ | N/A | N/A | N/A | ✅ (fails) | N/A | N/A | **BLOCKED BY DB** |
| UI Panel | P5-06C | ✅ | N/A | N/A | N/A | N/A | ✅ | N/A | COMPLETE (shows unavailable) |

---

## 11. Implementation Recovery Plan

### Phase 1: Schema Foundation

**Task: `P5-PROD-02` — P5 Drizzle Schema & Migration**

1. Add P5 table definitions to `src/db/schema.ts`:
   - `p5_decision_records`
   - `p5_policies`
   - `p5_guardrails`
   - `p5_approvals`
   - `p5_permissions`
   - `p5_p4_snapshots`
   - `p5_audit_events`

2. Create migration SQL: `drizzle/migrations/0031_add_p5_tables.sql`

3. Verify schema matches P5-08 §4-§8 contract (identity_key unique, immutability triggers, etc.)

4. Run `bun tsc --noEmit` — must pass

**Estimated effort:** 1 task
**Blocker:** None
**Depends on:** P5-08 implementation (already complete)

### Phase 2: Production Migration

**Task: `P5-PROD-03` — P5 Production Table Creation**

1. Apply migration to production DB

2. Verify all 7 tables exist with correct:
   - Columns
   - Indexes
   - Unique constraints
   - Foreign keys
   - Immutability triggers (if specified by P5-08)

3. Verify with production query

**Estimated effort:** 1 task
**Blocker:** P5-PROD-02
**Depends on:** P5-PROD-02

### Phase 3: Pipeline Integration

**Task: `P5-PROD-04` — P5 Producer Integration into Refresh Pipeline**

1. Wire P5-11 `p5RuntimeAdapter` into the narrative refresh pipeline
2. P5 should execute after P4 decision support is derived
3. P5 failure must be non-blocking (degrade to null/error, never HTTP 500)
4. P5 artifacts should persist through P5-09

**Estimated effort:** 1 task
**Blocker:** P5-PROD-03
**Depends on:** P5-PROD-03, P5-11 (already complete)

### Phase 4: Production Verification

**Task: `P5-PROD-05` — P5 Production E2E Verification**

1. Trigger refresh to generate P5 decision records
2. Verify `p5_decision_records` has rows
3. Verify `GET /api/narratives/1/action-decision` returns:
   - `availability: "OK"` or `"NO_DECISION_RECORD"` (not `SERVICE_ERROR`)
   - Correct decision outcome if records exist
4. Verify P5 UI shows data (or correct "no decision" state)
5. Verify P3/P4/P6 unaffected

**Estimated effort:** 1 task
**Blocker:** P5-PROD-04
**Depends on:** P5-PROD-04

### Phase 5: Closure

**Task: `P5-PROD-06` — P5 Operationalization Closure**

1. Update P5 Master Specification §3 to reflect actual state
2. Run full regression: `npx jest --testPathPatterns="src/lib/p5"`
3. TypeScript check: `npx tsc --noEmit`
4. Verify frozen boundary preserved
5. Write closure documentation
6. Commit and push

**Estimated effort:** 1 task
**Blocker:** P5-PROD-05
**Depends on:** P5-PROD-05

---

## 12. P5 Master Specification Reconciliation

The P5 Master Specification §3 currently says:

```
P5 | NOT STARTED — MASTER READY FOR FREEZE (pending explicit owner approval)
```

This must be updated to:

```
P5 | IMPLEMENTED — BASELINE FROZEN — PRODUCTION PERSISTENCE PENDING
```

The P5_BASELINE.md already correctly states:

```
P5 — IMPLEMENTATION COMPLETE / BASELINE FROZEN
REAL E2E VERIFICATION PENDING
```

**No P5 semantic contracts need to change.** Only the status claim in the Master needs correction.

---

## 13. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| P5 schema drift from P5-08 contract | MEDIUM | Schema must exactly match P5-08 §4-§8 |
| P5 producer integration breaks refresh | LOW | P5-11 already designed for graceful degradation |
| P5 persistence performance | LOW | Advisory-only V1, low volume |
| P3/P4 regression from P5 integration | LOW | P5 is additive, never modifies P3/P4 |
| P5 Master "NOT STARTED" claim blocks future work | MEDIUM | Must reconcile before P5 operationalization |

---

## 14. Final Verdict

```
P5_PARTIALLY_IMPLEMENTED_CONTINUE
```

**Rationale:**

- P5 application code: **100% implemented** (28 files, 258 tests passing)
- P5 database persistence: **0% implemented** (no schema, no migration, no production tables)
- P5 API: **Exists but fails at persistence layer**
- P5 UI: **Exists and correctly shows unavailable state**
- P5 Master Specification: **Stale (claims NOT STARTED)**

**The recovery path is clear and narrow:**
1. Add P5 tables to Drizzle schema
2. Create and apply migration
3. Wire P5 producer into refresh pipeline
4. Verify in production

No code redesign is needed. No semantic changes. No P3/P4/P6 impact.

### NEXT_TASK

```
P5-PROD-02 — P5 Drizzle Schema & Migration
```
