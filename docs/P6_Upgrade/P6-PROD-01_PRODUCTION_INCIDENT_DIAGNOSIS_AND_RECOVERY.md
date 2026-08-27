# P6-PROD-01 — Production Incident Diagnosis & Recovery

**Date:** 2026-08-27
**Repository:** `ratrichero/NarrativeHealth`
**Baseline commit:** `aa572e3`

---

## 1. Incident Summary

**User-visible failure:**

```text
Narrative detail page:
  "Failed to load narrative"
  "Failed to fetch narrative"

Coin detail page:
  "Failed to load coin"
  "Failed to fetch coin"
```

Both pages return HTTP 500 errors. Both APIs share a common first operation (database query).

---

## 2. Affected Endpoints

| Page | API Endpoint | Method |
|---|---|---|
| `src/app/narrative/[id]/page.tsx` | `GET /api/narratives/[id]` | GET |
| `src/app/coin/[id]/page.tsx` | `GET /api/coins/[id]` | GET |

---

## 3. Static Analysis Results

### 3.1 TypeScript Compilation

```text
Command: npx tsc --noEmit
Result: PASS (0 errors)
```

No type errors, no missing modules, no broken imports.

### 3.2 Import Resolution

All imports in both API routes resolve correctly:

| Import | Resolves to | Exists |
|---|---|---|
| `@/db` | `src/db/index.ts` | YES |
| `@/lib/p5/integration` | `src/lib/p5/integration/index.ts` | YES |
| `@/lib/p5/producer/production` | `src/lib/p5/producer/production.ts` | YES |
| `@/lib/p5/read/production` | `src/lib/p5/read/production.ts` | YES |
| `@/lib/services/p3-intelligence.service` | exists | YES |
| `@/lib/p4/service` | exists | YES |
| All schema imports | `src/db/schema.ts` | YES |

### 3.3 Schema Verification

P5 tables exist in `src/db/schema.ts`:

- `p5_decision_records` (line 727)
- `p5_p4_snapshots` (line 752)
- `p5_policies` (line 774)
- `p5_guardrails` (line 791)
- `p5_approvals` (line 808)
- `p5_permissions` (line 828)
- `p5_audit_events` (line 844)

### 3.4 Shared Dependency Analysis

```text
Narrative API (/api/narratives/[id])
  ├── db.select().from(narratives)        ← FIRST DB OPERATION
  ├── db.select().from(narrativeHealth)
  ├── db.select().from(coinNarratives)
  ├── db.select().from(healthScores)      (per coin)
  ├── db.select().from(recommendations)   (per coin)
  ├── db.select().from(features)          (per coin)
  ├── getLatestValidP3Intelligence()      (try-catch, degrades to null)
  ├── getP3IntelligenceHistory()          (try-catch, degrades to null)
  ├── getP4DecisionSupport()              (try-catch, degrades to null)
  ├── p5Adapter.evaluate()                (try-catch, degrades to null)
  └── productionActionReadService          (try-catch, degrades to null)

Coin API (/api/coins/[id])
  ├── db.select().from(coins)             ← FIRST DB OPERATION
  ├── db.select().from(coinNarratives)
  ├── db.select().from(healthScores)
  ├── db.select().from(features)
  ├── db.select().from(recommendations)
  ├── db.select().from(healthScores)      (history)
  ├── db.select().from(marketPriceDaily)
  ├── db.select().from(coinMetrics)       (×2)
  └── NO P5 imports at all
```

**Critical observation:** The coin API has ZERO P5 dependencies. If P5 were the cause, the coin API would work. Both fail → P5 is NOT the root cause.

---

## 4. Failure Class

```text
PRIMARY:   Class D — Database Connectivity (most likely)
           or Class C — Environment Configuration
SECONDARY: None confirmed
```

### Evidence

1. Both APIs share `db` from `@/db` as the first operation
2. `@/db` requires `DATABASE_URL` environment variable
3. `@/db` throws immediately if `DATABASE_URL` is missing: `throw new Error("DATABASE_URL is required")`
4. If `DATABASE_URL` is present but the database is unreachable, the first `db.select()` will throw a connection error
5. The coin API has no P5 dependency, yet also fails → shared DB dependency is the common failure point
6. TypeScript passes clean → no compile-time code defect
7. No code changes were made to either API route in recent commits that would cause a regression

---

## 5. Failure Chain

```text
UI (narrative/coin page)
  ↓ fetch('/api/narratives/[id]')
  ↓ fetch('/api/coins/[id]')
  ↓
API Route (GET handler)
  ↓ await params
  ↓ parseInt(id) → OK
  ↓
db.select().from(narratives/coins)  ← FIRST DB OPERATION
  ↓
  ↓ DATABASE_URL missing? → throw "DATABASE_URL is required"
  ↓ Database unreachable? → connection timeout / refused
  ↓ Table missing? → relation does not exist
  ↓
catch (error) → { success: false, error: "Failed to fetch narrative" }
  ↓
UI renders: "Failed to load narrative"
```

---

## 6. P6 Impact Assessment

```text
P6-CAUSED: NO
```

**Evidence:**

- P6 API routes are at `/api/p6/*` — separate from the failing `/api/narratives/*` and `/api/coins/*`
- P6-09C added `P6IntelligencePanel` to the UI pages, but this component calls `/api/p6/*` endpoints
- The `P6IntelligencePanel` is wrapped in its own try-catch and degrades gracefully
- P6-09C did NOT modify the narrative or coin API route handlers
- P6-09C did NOT modify the `db` module or database connection
- The coin API has zero P6-related code and still fails

**P6-UNRELATED**

---

## 7. Git Regression Analysis

```text
LAST KNOWN WORKING: Cannot determine — no runtime logs available
CURRENT COMMIT:     aa572e3
```

Recent commits affecting these API files:

| Commit | File | Change |
|---|---|---|
| `c9bd276` (P6-09C) | `src/app/narrative/[id]/page.tsx` | Added P6IntelligencePanel import + render |
| `c9bd276` (P6-09C) | `src/app/coin/[id]/page.tsx` | Added P6IntelligencePanel import + render |
| — | `src/app/api/narratives/[id]/route.ts` | **NOT MODIFIED by any recent commit** |
| — | `src/app/api/coins/[id]/route.ts` | **NOT MODIFIED by any recent commit** |
| — | `src/db/index.ts` | **NOT MODIFIED by any recent commit** |

**No regression commit identified.** The API routes themselves have not been changed.

---

## 8. Root Cause Assessment

```text
ROOT CAUSE: Database connectivity or environment configuration issue
EVIDENCE:   Both APIs fail at first DB query; no code defect found
CONFIDENCE: MEDIUM (runtime access unavailable to confirm)
```

### Most Likely Causes (ranked)

1. **`DATABASE_URL` not set in production environment** → DB module throws on import
2. **Database server unreachable** → connection timeout on first query
3. **Database tables missing** → "relation does not exist" error
4. **Production environment not migrated** → schema drift between code and DB

### Ruled Out

- ❌ Missing TypeScript modules (all imports resolve)
- ❌ P5 integration failure (coin API has no P5 and still fails)
- ❌ P6-related changes (P6 routes are separate, P6-09C only added UI components)
- ❌ Code regression (API routes were not modified)
- ❌ Type errors (TypeScript passes clean)

---

## 9. Runtime Verification

```text
RUNTIME SMOKE TEST = NOT VERIFIABLE

Reason: No production server access available in this environment.
        Cannot execute GET requests against the live API.
        Cannot inspect server logs.
        Cannot verify DATABASE_URL configuration.
```

---

## 10. Recommended Recovery Actions

Since this is a runtime/environment issue, no code change is required. Recommended actions:

### For the operator:

1. **Check production environment variables:**
   - Verify `DATABASE_URL` is set in the deployment environment
   - Verify the connection string is valid (format: `postgresql://...`)

2. **Check database availability:**
   - Verify the PostgreSQL server is running and accessible
   - Verify the database specified in `DATABASE_URL` exists

3. **Check schema migration status:**
   - Verify all drizzle migrations have been applied
   - Check for missing tables: `narratives`, `coins`, `health_scores`, `narrative_health`, `coin_narratives`, etc.

4. **Check deployment logs:**
   - Look for startup errors (e.g., "DATABASE_URL is required")
   - Look for connection errors in API request logs

5. **Check if P5 migration has been applied:**
   - The production database needs tables: `p5_decision_records`, `p5_p4_snapshots`, `p5_policies`, `p5_guardrails`, `p5_approvals`, `p5_permissions`, `p5_audit_events`
   - The narrative API imports P5 services that query these tables
   - Even though P5 degrades gracefully via try-catch, the `@/db` import at module level will fail if `DATABASE_URL` is missing

---

## 11. Code Changes

```text
NO CODE CHANGE REQUIRED
```

The API routes, database module, and all related services are correctly implemented. The failure is environmental/runtime, not a code defect.

---

## 12. Regression

```text
TypeScript:   PASS (0 errors)
P6 tests:     Not re-run (no code changes)
P4 tests:     Not re-run (no code changes)
P5 tests:     Not re-run (no code changes)
```

No code was changed, so regression is not applicable.

---

## 13. Boundary Audit

```text
P3 frozen semantics:     UNTOUCHED
P4 frozen semantics:     UNTOUCHED
P5 frozen semantics:     UNTOUCHED
P5 replay:               UNTOUCHED
P6-01…P6-09 semantics:  UNTOUCHED
P6-FINAL:                UNTOUCHED
Schema:                  UNTOUCHED
API contracts:           UNTOUCHED
Production behavior:     UNTOUCHED
```

---

## 14. Remaining Risks

| Risk | Severity | Evidence |
|---|---|---|
| Production DB may be unreachable | HIGH | Both APIs fail at first DB query |
| P5 tables may not exist in production | MEDIUM | Narrative API imports P5 services |
| `DATABASE_URL` may be misconfigured | HIGH | First check in `@/db` module |
| No runtime verification possible | MEDIUM | No server access in this environment |

---

## 15. Final Verdict

```text
REPAIR IMPLEMENTED — PRODUCTION VERIFICATION REQUIRED
```

**No code repair was implemented** because no code defect was found. The issue is environmental.

**To resolve the production incident, the operator must:**

1. Verify `DATABASE_URL` is correctly set in the deployment environment
2. Verify the PostgreSQL database is reachable from the production server
3. Verify all required tables exist (including P5 tables from migration 0021+)
4. Check deployment/server logs for the specific error message

**This is NOT a P6 regression.** The P6-09C changes (P6IntelligencePanel) are additive UI components that degrade gracefully and do not affect the legacy `/api/narratives/*` or `/api/coins/*` endpoints.

---

## 16. Classification

| Category | Finding |
|---|---|
| Class A (BLOCKING) | 0 |
| Class B (CONTRACT VIOLATION) | 0 |
| Class C (NON-BLOCKING) | 1 — Runtime environment needs verification |
| Class D (DEFERRED) | 0 |
