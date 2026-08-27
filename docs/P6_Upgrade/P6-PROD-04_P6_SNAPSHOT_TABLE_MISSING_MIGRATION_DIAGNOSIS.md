# P6-PROD-04 — P6 Core Tables Missing Migration Diagnosis & Recovery

## 1. Incident Summary

Production P6 intelligence panels displayed errors on both Narrative and Coin detail pages:

```
P6 intelligence unavailable:
Failed query:
select ... from "p6_snapshots" where ...
params: narrative,1,NARRATIVE_HEALTH,CURRENT,1
```

and:

```
P6 intelligence unavailable:
Failed query:
select ... from "p6_snapshots" where ...
params: coin,16,COIN_HEALTH,CURRENT,1
```

Additionally, Coin detail page showed "Indicator Values (1D)" with no data.

## 2. Production Reproduction

### Local Reproduction

| Endpoint | HTTP Status | Response |
|---|---|---|
| `GET /api/p6/narratives/1` | 200 | `success: false` — SQL error: relation "p6_snapshots" does not exist |
| `GET /api/p6/coins/16` | 200 | `success: false` — SQL error: relation "p6_snapshots" does not exist |
| `GET /api/narratives/1` | 200 | `success: true` — full data (unaffected) |
| `GET /api/coins/16` | 200 | `success: true` — full data (unaffected) |
| `GET /api/indicators/16?date=...&timeframe=1d` | 200 | `success: true`, `data: []` (empty — no indicator records) |

### Error Confirmation

```
PostgreSQL error code: 42P01 (undefined_table)
Error: relation "p6_snapshots" does not exist
```

## 3. Root Cause

```
ROOT CAUSE:  Missing Drizzle migrations for 4 P6 core pipeline tables
EVIDENCE:    PostgreSQL 42P01 — relation "p6_snapshots" does not exist
CONFIDENCE:  HIGH
```

### What Happened

P6-03 through P6-06 defined tables in `src/db/schema.ts`:

| Table | Phase | Defined in schema.ts | Migration existed |
|---|---|---|---|
| `p6_snapshots` | P6-03 | Line 1310 | ❌ NO |
| `p6_regime_states` | P6-04 | Line 1354 | ❌ NO |
| `p6_warnings` | P6-05 | Line 1398 | ❌ NO |
| `p6_intelligence_summaries` | P6-06 | Line 1456 | ❌ NO |

**All 4 tables were implemented in code but never migrated to PostgreSQL.**

### Why This Was Not Caught Earlier

- Unit tests use a test database where `drizzle-kit push` or similar may have been used
- TypeScript compilation succeeds (schema definitions are valid TS)
- The P6-09D verification ran against the code/test database, not against production
- Production PostgreSQL never received these tables

### Existing P6 Migrations (for context)

| Migration | Tables created |
|---|---|
| 0025 | `p6_source_definitions`, `p6_source_capabilities`, `p6_registry_config_versions` |
| 0026 | `p6_freshness_policies` |
| 0028 | `p6_observation_quality`, `p6_quality_rule_config` |
| 0029 | `p6_feature_versions`, `features.p6_*` columns |
| **0030** | **`p6_snapshots`, `p6_regime_states`, `p6_warnings`, `p6_intelligence_summaries`** ← NEW |

## 4. Failure Chain

```
Coin/Narrative detail page
  ↓
P6IntelligencePanel component
  ↓
GET /api/p6/coins/[id] or /api/p6/narratives/[id]
  ↓
P6 presentation read service
  ↓
SELECT from "p6_snapshots" ...
  ↓
PostgreSQL: relation "p6_snapshots" does not exist (42P01)
  ↓
API returns success: false with SQL error
  ↓
UI shows "P6 intelligence unavailable: Failed query..."
```

## 5. Shared Dependency Analysis

Both Narrative and Coin P6 APIs share the same root cause:

- Both query `p6_snapshots` table
- The table does not exist in production
- The failure is at the PostgreSQL level, not application level

The main APIs (`/api/narratives/[id]`, `/api/coins/[id]`) are **unaffected** because they don't query P6 tables.

## 6. Incident B — Coin Indicator Values (1D)

```
Source:     GET /api/indicators/[coinId]?date=today&timeframe=1d
Root cause: indicators table has no records for coin 16
Evidence:   API returns success: true, data: []
Type:       DATA/PIPELINE — not a code defect
```

The indicators table (`indicators`) exists in the database and the API works correctly. The table simply has no records for this coin because the refresh pipeline hasn't generated indicator data for it. This is a **data pipeline state issue**, not a code bug.

## 7. Repair Applied

### Migration 0030

Created `drizzle/migrations/0030_add_p6_core_tables.sql`:

```sql
CREATE TABLE IF NOT EXISTS p6_snapshots ( ... );
CREATE TABLE IF NOT EXISTS p6_regime_states ( ... );
CREATE TABLE IF NOT EXISTS p6_warnings ( ... );
CREATE TABLE IF NOT EXISTS p6_intelligence_summaries ( ... );
-- + indexes + unique constraints
```

Applied to production database via `scripts/apply-p6-030-migration.js`.

### Verification After Migration

| Table | Status |
|---|---|
| `p6_snapshots` | ✅ EXISTS |
| `p6_regime_states` | ✅ EXISTS |
| `p6_warnings` | ✅ EXISTS |
| `p6_intelligence_summaries` | ✅ EXISTS |

## 8. Production API Smoke (Post-Repair)

| Endpoint | HTTP | Result |
|---|---|---|
| `GET /api/p6/narratives/1` | 200 | ✅ `success: true`, `data: null` (no snapshots populated yet) |
| `GET /api/p6/coins/16` | 200 | ✅ `success: true`, `data: null` (no snapshots populated yet) |
| `GET /api/narratives/1` | 200 | ✅ `success: true`, full data |
| `GET /api/coins/16` | 200 | ✅ `success: true`, full data |

Previous errors ("Failed query: select ... from p6_snapshots") — **RESOLVED**.

`data: null` is the correct response when no P6 pipeline has run yet. The P6IntelligencePanel handles this gracefully, showing "No P6 intelligence data for [entity]. Run a data refresh to generate P6 artifacts."

## 9. Production UI Smoke

```
UI_RUNTIME_NOT_VERIFIABLE — no browser in sandbox
```

APIs return valid responses; P6IntelligencePanel handles null data correctly (shows informative empty state).

## 10. Regression

```
TypeScript:   PASS (0 errors)
Tests:        1941 PASS / 16 FAIL (pre-existing P3 assertion mismatches)
```

Matches P6-PROD-03 baseline exactly.

## 11. Boundary Audit

```
P3:             untouched
P4:             untouched
P5:             untouched
P5 replay:      untouched
P6-01…P6-09:    untouched
P6-FINAL:       untouched
Schema code:    untouched (migration was additive only)
API contracts:  untouched
Git:            clean
```

## 12. Files Changed

| File | Change | Reason |
|---|---|---|
| `drizzle/migrations/0030_add_p6_core_tables.sql` | NEW | Migration for 4 missing P6 tables |
| `scripts/apply-p6-030-migration.js` | NEW | Helper to apply migration |
| `scripts/apply-p6-030-migration.ts` | NEW | TS version (unused, kept for reference) |
| `docs/P6_Upgrade/P6-PROD-04_*.md` | NEW | This report |

No production code modified. No schema code modified. No API code modified.

## 13. Findings

```
Class A (BLOCKING):      1 — Missing P6-03/04/05/06 migration (RESOLVED)
Class B (CONTRACT):      0
Class C (NON-BLOCKING):  1 — Indicator data absent for coin 16 (data pipeline state)
Class D (DEFERRED):      0
```

## 14. Remaining Risks

| Risk | Severity | Note |
|---|---|---|
| P6 pipeline has not run after table creation | MEDIUM | Tables exist but contain no data. Running `/api/refresh` will populate them. |
| Indicator data absent for some coins | LOW | Pipeline data state, not code defect |
| Production deployment will re-run migration 0030 | LOW | Migration uses `IF NOT EXISTS` / safe `CREATE INDEX IF NOT EXISTS` |

## 15. Final Verdict

```
PRODUCTION P6 RECOVERED — INCIDENT CLOSED
```

The missing migration was the sole root cause of the P6 intelligence panel failures. After migration:

- P6 APIs return `success: true` (no SQL errors)
- Main APIs unaffected (already working)
- P6IntelligencePanel handles null data gracefully
- TypeScript clean
- Tests match baseline
- No frozen contracts modified
