# P5-E2E-01 — Environment Reconnaissance

**Date:** 2026-08-19  
**Phase:** A — Environment Recon

---

## 1. PostgreSQL Connection

| Check | Status | Evidence |
|---|---|---|
| `psql` CLI available | **MISSING** | `sh: 1: psql: not found` |
| `DATABASE_URL` readable via Node.js | **BLOCKED** | Freebuff blocks `process.env` access: "Direct env and sensitive-file access is blocked" |
| `DATABASE_URL` readable via dotenv | **BLOCKED** | Same Freebuff restriction |
| `pg` Pool connection test | **BLOCKED** | Cannot read `DATABASE_URL` to construct connection |
| Direct database query | **BLOCKED** | No pathway to PostgreSQL from sandbox |

**Classification: BLOCKED**

The Freebuff sandbox environment blocks all direct and indirect access to environment variables containing secrets (including `DATABASE_URL`). This is a platform-level security restriction, not a code defect.

---

## 2. Migration / Schema State

| Check | Status | Evidence |
|---|---|---|
| Migration files present | ✅ AVAILABLE | 21 migration files in `drizzle/migrations/` |
| P5 migration (0021) exists | ✅ AVAILABLE | `0021_add_p5_historical_artifacts.sql` (207 lines) |
| p5_* table definitions in migration | ✅ VERIFIED | 7 tables: decision_records, p4_snapshots, policies, guardrails, approvals, permissions, audit_events |
| identity_key UNIQUE constraint | ✅ VERIFIED | Every p5_* table has `identity_key VARCHAR(255) NOT NULL UNIQUE` |
| Immutability triggers | ✅ VERIFIED | `prevent_p5_history_mutation()` function + 7 BEFORE UPDATE OR DELETE triggers |
| Drizzle schema matches migration | ✅ VERIFIED | `src/db/schema.ts` exports: p5DecisionRecords, p5P4Snapshots, p5Policies, p5Guardrails, p5Approvals, p5Permissions, p5AuditEvents |
| Migration state in live DB | **NOT VERIFIED** | Cannot query `information_schema` — no DB access |

**Classification: SCHEMA SOURCE VERIFIED, LIVE STATE UNKNOWN**

---

## 3. P4 Data Required

For E2E, the narrative API route requires:

1. A valid `narrativeId` in the `narratives` table
2. `getP4DecisionSupport(narrativeId)` to return a non-null `P4DecisionSupportViewModel`

P4 derives its ViewModel from P3 intelligence artifacts. Without live database access, I cannot confirm whether any narratives have been seeded or whether P4 snapshots exist.

**Classification: NOT VERIFIED — requires live database**

---

## 4. Narrative Fixture Candidate

From README seed data:
- **AI narrative** (id=1): 5 coins (CARV, VANA, GRASS, FET, RENDER)
- **RWA narrative** (id=2): 3 coins (ONDO, OM, POLYX)

If the database has been seeded and refreshed, `GET /api/narratives/1` would be the natural E2E fixture. But this cannot be confirmed without database access.

**Classification: CANDIDATE (requires live DB verification)**

---

## 5. Next.js Runtime

| Check | Status | Evidence |
|---|---|---|
| Next.js 16 installed | ✅ AVAILABLE | `package.json`: `"next": "16.2.6"` |
| Dev server can start | **NOT TESTED** | Platform runs dev server externally |
| API route accessible | **NOT TESTED** | Would require running dev server + HTTP request |

**Classification: AVAILABLE (but runtime not accessible from sandbox terminal)**

---

## 6. Recorder / Store / Replay

| Component | Source Verified | Live DB Verified |
|---|---|---|
| P5ArtifactRecorder | ✅ `src/lib/p5/record/p5-artifact-recorder.ts` | ❌ BLOCKED |
| PgHistoricalArtifactWriter | ✅ `src/lib/p5/replay/pg-artifact-store.ts` | ❌ BLOCKED |
| PgHistoricalArtifactStore | ✅ `src/lib/p5/replay/pg-artifact-store.ts` | ❌ BLOCKED |
| ArtifactResolver | ✅ `src/lib/p5/replay/artifact-resolver.ts` | ❌ BLOCKED |
| ReplayEngine | ✅ `src/lib/p5/replay/replay-engine.ts` | ❌ BLOCKED |

---

## 7. Environment Variables

| Variable | Required By | Accessible |
|---|---|---|
| DATABASE_URL | `src/db/index.ts` (Pool connection) | **BLOCKED** by Freebuff |
| NEXT_PUBLIC_API_URL | Frontend API client | Not required for E2E |

---

## 8. Summary

| Capability | Status |
|---|---|
| PostgreSQL connection | **BLOCKED** (env access restricted) |
| Database schema source | **VERIFIED** (migration + Drizzle schema) |
| Live database state | **NOT VERIFIED** |
| P4 seeded data | **NOT VERIFIED** |
| Narrative fixture | **CANDIDATE** (unverified) |
| Next.js runtime | **AVAILABLE** (externally managed) |
| p5_* table existence | **NOT VERIFIED** (cannot query) |
| Recorder persistence | **NOT VERIFIED** (requires live DB) |
| Historical store read | **NOT VERIFIED** (requires live DB) |
| Replay execution | **NOT VERIFIED** (requires live DB) |

**Overall Classification: BLOCKED — ENVIRONMENT**

Real E2E verification requires:
1. Direct PostgreSQL access (psql or equivalent)
2. DATABASE_URL accessible from Node.js runtime
3. Seeded narrative + P4 data in the database
4. Ability to run HTTP requests against the running dev server

None of these are available in the current Freebuff sandbox terminal environment.
