# P5-PROD-02 — P5 Drizzle Schema & Migration Audit

## Executive Summary

**P5 Drizzle schema and migration already exist and are complete.**

The P5-PROD-01 audit conclusion that "P5 tables NOT IN Drizzle schema" was **incorrect**. Both the Drizzle schema definitions (`src/db/schema.ts` lines 726-843) and the migration SQL (`drizzle/migrations/0021_add_p5_historical_artifacts.sql`) were already present before this task started.

The only remaining gap is that **migration 0021 was never applied to the production database**.

---

## 1. Schema Definitions

### Location

`src/db/schema.ts` — lines 726-843

### Tables Defined

| Table | Variable | Columns | PK | Unique | Indexes |
|-------|----------|---------|----|--------|---------|
| `p5_decision_records` | `p5DecisionRecords` | 15 | `id` | `identity_key` | `narrative_id` |
| `p5_p4_snapshots` | `p5P4Snapshots` | 13 | `id` | `identity_key` | `(narrative_id, window)` |
| `p5_policies` | `p5Policies` | 8 | `id` | `identity_key` | `policy_id` |
| `p5_guardrails` | `p5Guardrails` | 8 | `id` | `identity_key` | `guardrail_id` |
| `p5_approvals` | `p5Approvals` | 11 | `id` | `identity_key` | `decision_id_ref` |
| `p5_permissions` | `p5Permissions` | 7 | `id` | `identity_key` | `ref` |
| `p5_audit_events` | `p5AuditEvents` | 15 | `id` | `identity_key` | `(decision_id_ref)`, `(event_type)` |

### Type Exports

All 7 tables have both `$inferSelect` and `$inferInsert` type exports (lines 1103-1116).

---

## 2. Migration SQL

### Location

`drizzle/migrations/0021_add_p5_historical_artifacts.sql`

### Contents

- 7 `CREATE TABLE IF NOT EXISTS` statements
- 8 `CREATE INDEX IF NOT EXISTS` statements  
- 7 `CREATE TRIGGER` immutability triggers (prevent UPDATE/DELETE on all P5 tables)
- 1 `prevent_p5_history_mutation()` PL/pgSQL function

### Key Design

- `CREATE TABLE IF NOT EXISTS` — idempotent
- Append-only by contract — triggers enforce immutability
- No FK constraints (P5 artifacts are self-contained records referenced by identity, not relational keys)

---

## 3. Schema ↔ Migration Alignment

| Table | Schema.ts Columns | SQL Columns | Match |
|-------|-------------------|-------------|-------|
| `p5_decision_records` | 15 | 15 | ✅ |
| `p5_p4_snapshots` | 13 | 13 | ✅ |
| `p5_policies` | 8 | 8 | ✅ |
| `p5_guardrails` | 8 | 8 | ✅ |
| `p5_approvals` | 11 | 11 | ✅ |
| `p5_permissions` | 7 | 7 | ✅ |
| `p5_audit_events` | 15 | 15 | ✅ |

All column names, types, nullability, defaults, unique constraints, and indexes match between Drizzle schema and SQL migration.

---

## 4. Application Compatibility

### TypeScript

```
npx tsc --noEmit
Result: PASS (exit code 0)
```

### P5 Application Code

The following files import P5 schema objects:

- `src/lib/p5/replay/pg-artifact-store.ts` — imports all 7 tables from `@/db/schema`
- `src/lib/p5/read/production.ts` — uses P5 row store
- `src/lib/p5/record/p5-artifact-recorder.ts` — writes P5 artifacts
- `src/lib/p5/integration/p5-runtime-adapter.ts` — wires P5 pipeline

All compile successfully against the schema definitions.

---

## 5. Production State

### Migration Application

| Check | Status |
|-------|--------|
| Migration 0021 file exists | ✅ |
| Drizzle meta journal tracks it | ❌ (only 0000-0001 tracked) |
| Applied to production DB | ❌ **NOT APPLIED** |
| P5 tables in production | ❌ **MISSING** |

### Root Cause

Migration 0021 was created as a manual SQL file (not via `drizzle-kit generate`) and was never applied to the production database. The Drizzle meta journal (`drizzle/meta/_journal.json`) only tracks migrations 0000 and 0001.

---

## 6. Frozen Boundary

| Check | Status |
|-------|--------|
| P5 semantics unchanged | ✅ |
| P5 decision taxonomy unchanged | ✅ |
| P5 safety semantics unchanged | ✅ |
| P5 explanation semantics unchanged | ✅ |
| P5 replay semantics unchanged | ✅ |
| P6 unaffected | ✅ |
| P4 unaffected | ✅ |
| P3 unaffected | ✅ |

---

## 7. P5-PROD-01 Correction

The P5-PROD-01 audit stated:

> "P5 Database Schema: ❌ NOT IN Drizzle schema"
> "P5 Migrations: ❌ No migration files"

**This finding was incorrect.** Both the schema definitions and migration SQL already existed in the repository. The tables and their TypeScript types compile cleanly.

The correct finding should have been:

> "P5 schema exists. P5 migration exists. Migration 0021 was never applied to production."

---

## 8. Revised Recovery Plan

The original P5-PROD-01 proposed a 4-task recovery:

| Task | Original | Revised |
|------|----------|---------|
| P5-PROD-02 | Create schema + migration | **Schema + migration already exist** → SKIP |
| P5-PROD-03 | Apply migration to production | **STILL NEEDED** |
| P5-PROD-04 | Wire P5-11 producer | **STILL NEEDED** |
| P5-PROD-05 | Production E2E verification | **STILL NEEDED** |

### Revised Plan

| Task | What | Status |
|------|------|--------|
| ~~P5-PROD-02~~ | ~~Create schema + migration~~ | **ALREADY DONE** (pre-existing) |
| P5-PROD-03 | Apply migration 0021 to production DB | **NEXT** |
| P5-PROD-04 | Wire P5-11 producer into refresh pipeline | Pending |
| P5-PROD-05 | Production E2E verification | Pending |

---

## 9. Final Verdict

```
P5_SCHEMA_MIGRATION_READY
```

P5 schema and migration already exist in the repository. No code changes needed for this step.

NEXT_TASK: `P5-PROD-03 — Apply P5 Migration to Production`

---

## 10. Git

No code changes in this task (schema/migration already existed).

```
git status: CLEAN
```
