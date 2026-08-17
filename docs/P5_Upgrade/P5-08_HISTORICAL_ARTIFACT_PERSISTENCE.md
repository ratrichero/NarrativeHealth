# P5-08 — HISTORICAL ARTIFACT STORE / PERSISTENCE

**Repository:** https://github.com/ratrichero/NarrativeHealth
**Phase:** P5 — What action, if any, should be executed?
**Task:** P5-08 — Historical Artifact Store / Persistence (implementation)
**Document status:** FROZEN / APPROVED FOR DOWNSTREAM — implementation baseline (final revision / freeze check; see §20). Historical replay availability remains dependent on P5 producers (see §20.17).
**Revision history:** R1 = implementation (this document, §1–§19). R2 = final revision / freeze check (appended §20).
**Upstream contracts:** P5-02 … P5-07 all FROZEN / APPROVED FOR DOWNSTREAM; P5-07-IMPL FROZEN (implementation baseline)
**Contract source:** `docs/P5_Upgrade/P5-07_HISTORICAL_REPLAY_VALIDATION.md` (FROZEN), `docs/P5_Upgrade/P5-07_IMPLEMENTATION.md` (FROZEN)

---

## 1. Scope

Design and implement the minimal persistence layer that lets the frozen
P5-07 replay engine read real historical artifacts through the frozen
`HistoricalArtifactStore` boundary:

```
recorded P5 artifacts
        ↓
HistoricalArtifactStore   (PgHistoricalArtifactStore — READ-ONLY)
        ↓
ArtifactResolver          (frozen, unchanged)
        ↓
ReplayEngine              (frozen, unchanged)
        ↓
P5ReplayReport
```

P5-08 does **not** build a production persistence architecture, does **not**
create decisions, does **not** run policy/safety/approval, does **not** grant
permission, does **not** execute anything, and does **not** invent semantics.
It only stores and reads historical facts/artifacts that already exist
upstream (P5-03/04/05 producers).

---

## 2. Existing Persistence Infrastructure (discovered)

The repository has a mature, suitable persistence pattern:

| Layer | Detail |
|---|---|
| ORM | `drizzle-orm` 0.45.2 + `pg` (node-postgres) |
| Client | `src/db/index.ts` — `db = drizzle(pool, { schema })`, module singleton, `export * from "./schema"` |
| Schema | `src/db/schema.ts` — single-file Drizzle schema (40+ tables) |
| Migrations | Hand-managed SQL in `drizzle/migrations/0001…0020_*.sql` (NOT drizzle-kit generate — the `drizzle/meta` snapshot is stale at 0001 and is not the active migration mechanism) |
| Established patterns | Identity-unique constraints; `jsonb` payloads; `provenance` jsonb; append-only event ledger with unique `idempotency_key` (`narrative_membership_events`); snapshot tables with identity-unique tuples (`narrative_membership_snapshots`, `p3_narrative_intelligence`); corrections-as-new-records (`p3_historical_corrections`); DB-level immutability triggers (`prevent_p3_history_mutation`) |

**Key finding — producers:** P4 is a read-time derived service (`src/lib/p4/service.ts` — "no persistence, no writes"); P5-03/04/05 are contract-only (no engine implementation writes decision/audit artifacts). Therefore **no P5 artifact has a producer yet**. The consumer (replay engine) is real and frozen. See §3 and §15 (dependency).

---

## 3. Artifact Inventory

| Artifact class | Contract type | Producer | Consumer | P5-08 treatment |
|---|---|---|---|---|
| 1. Decision record | `P5DecisionRecord` | NONE (P5-03 contract-only) | Replay, P5-06 | Table + store + writer (dormant until producer) |
| 2. P4 snapshot / snapshot ref | `P5HistoricalSnapshot` / `P5P4SnapshotRef` (AD-014) | NONE (P4 read-time derived) | Replay | Table + store + writer |
| 3. Policy reference + version + rule refs | `P5HistoricalPolicy` | NONE | Replay | Table + store + writer |
| 4. Safety / guardrail record | `P5HistoricalGuardrail` | NONE | Replay | Table + store + writer |
| 5. Approval record | `P5HistoricalApproval` | NONE | Replay | Table + store + writer |
| 6. Permission result | `P5HistoricalPermission` | NONE | Replay | Table + store + writer |
| 7. Audit events | `P5AuditEvent` | NONE | Replay (via record) + P5-05 | Table + store + writer |
| 8. Provenance / version tuple | within each artifact | NONE | Replay | Stored verbatim in payloads + version columns |
| 9. Replay-related historical references | `P5ReplayReport` artifacts | NONE | — | Not persisted (report is a projection, not an artifact) |

Every artifact stored has: stable identity (`identity_key` unique), version
identity where the contract requires it (policy/guardrail/snapshot),
recorded timestamp, provenance (verbatim payload), exact lookup capability,
and immutability (see §8).

---

## 4. Store Architecture

```
src/db/schema.ts (p5_* tables)  ← drizzle table objects
        ↓
P5RowStore adapter (port)
   ├─ DrizzleP5RowStore   — production, wraps `db` from @/db
   └─ FakeRowStore        — tests, in-memory (no live DB)
        ↓
PgHistoricalArtifactStore  — READ-ONLY, implements frozen HistoricalArtifactStore
PgHistoricalArtifactWriter — INSERT-ONLY, persistence contract for producers
        ↓
production.ts — pgHistoricalArtifactResolver (wired to @/db)
        ↓
ReplayEngine (frozen — consumed via ArtifactResolver)
```

- `src/lib/p5/replay/pg-artifact-store.ts` — adapter port (`P5RowStore`),
  production adapter (`DrizzleP5RowStore`), read store
  (`PgHistoricalArtifactStore`), insert-only writer
  (`PgHistoricalArtifactWriter`), identity-key helpers.
- `src/lib/p5/replay/production.ts` — wires `db` → store → resolver.
- The frozen `HistoricalArtifactStore` interface and `ReplayEngine` are
  **unchanged**; `NoHistoricalArtifactStore` remains the safe fallback
  singleton in `artifact-resolver.ts` for environments without persistence.

---

## 5. Schema Decisions

7 new tables in `src/db/schema.ts` + hand migration
`drizzle/migrations/0021_add_p5_historical_artifacts.sql` (repo convention —
hand-managed SQL; drizzle-kit generate is NOT used because its meta snapshot
is stale at 0001 and the active migration mechanism is `drizzle/migrations/`).

| Table | Identity (unique `identity_key`) | Key columns | Payload |
|---|---|---|---|
| `p5_decision_records` | `decisionId` | decision_id, narrative_id, outcome, suppressed, blocker_source/ref, action_type, decision_state, approval_state, execution_state, permission_result, decision_at | full `P5DecisionRecord` verbatim |
| `p5_p4_snapshots` | full identity + versionTuple + asOf (AD-014) | narrative_id, window, algorithm_key/version, calculation_mode, semantic_version, as_of, status, content_hash (PROVISIONAL) | `P5HistoricalSnapshot` verbatim |
| `p5_policies` | policyId @ policyVersion | policy_id, policy_version, effective_at, evaluation_at | `P5HistoricalPolicy` verbatim |
| `p5_guardrails` | guardrailId @ version | guardrail_id, version, outcome, evaluated_at | `P5HistoricalGuardrail` verbatim |
| `p5_approvals` | approvalId | approval_id, decision_id_ref, state, authority_ref, actor, approved_at, approval_policy_version | `P5HistoricalApproval` verbatim |
| `p5_permissions` | ref | ref, result, evaluated_at | `P5HistoricalPermission` verbatim |
| `p5_audit_events` | eventId | event_id, decision_id_ref, event_type, event_at, actor, previous/new_state, reason, refs | `P5AuditEvent` verbatim |

Decisions:

- **Verbatim jsonb payloads + identity columns.** The full artifact is stored
  so replay reconstructs exactly what was recorded; identity/version columns
  enable exact SQL lookup and readable queries. No semantic reinterpretation
  at rest.
- **`identity_key` is the canonical exact-identity key** (storage mechanic,
  deterministic, collision-free) — the store resolves FOUND only on an exact
  key; the frozen resolver re-verifies identity/version (defense in depth).
- **No new semantics:** no scores, thresholds, BUY/SELL, execution, approval,
  RBAC or event-sourcing machinery.

---

## 6. Exact Identity / Version Resolution

Per P5-07 §5 (RP-003) — never "latest/current/active", never fuzzy:

- `findDecision(decisionId)` — exact `identity_key` (the decisionId).
- `findApproval(approvalId)` / `findPermission(ref)` — exact id/ref.
- `findPolicy(policyId, policyVersion)` — exact `policyId@policyVersion`
  first; if absent, a **candidate** at another version is returned so the
  resolver classifies `VERSION_MISMATCH` — never a silent resolution.
- `findGuardrail(guardrailId, version)` — same exact-then-candidate rule.
- `findP4Snapshot(ref)` — exact full identity+version+asOf key first; if
  absent, a candidate sharing the identity subset is returned so the resolver
  classifies `SNAPSHOT_VERSION_MISMATCH`.
- Missing everywhere → `null` → resolver `MISSING` / `ARTIFACT_MISSING`.

No requested artifact is ever replaced by a different version, and no
missing artifact is ever turned into a decision outcome.

---

## 7. Snapshot Handling (Anti-Drift)

- Stored verbatim as `P5HistoricalSnapshot`; the resolver checks
  identity+version+asOf (`SNAPSHOT_MATCH` only on exact alignment).
- States reachable through the persisted store: `SNAPSHOT_MATCH`,
  `SNAPSHOT_MISSING`, `SNAPSHOT_VERSION_MISMATCH` (candidate),
  `SNAPSHOT_HASH_MISMATCH` (recorded hash ≠ stored hash),
  `SNAPSHOT_UNAVAILABLE` (recorded hash, no stored hash — never assumed
  to match).
- `contentHash` remains **PROVISIONAL** (P5-02 AD-014): stored as recorded,
  never computed, never assumed.
- Live P4 state is never consulted by the store; live data can appear only
  as labeled `LIVE_CONTEXT` diagnostics from the engine (P5-07 §11.3).

---

## 8. Immutability

- **App layer:** the read store has only `find*` methods; the writer has only
  `insert*` methods. There is no update/delete/rewrite surface anywhere in
  P5-08. Duplicate exact writes are ignored (`onConflictDoNothing` on the
  unique `identity_key`) — the first recorded artifact is never rewritten
  (verified by test).
- **DB layer:** migration 0021 adds `prevent_p5_history_mutation()` triggers
  on all 7 tables rejecting `UPDATE`/`DELETE`, mirroring the P3 convention.
- Corrections are new artifacts/events, never in-place rewrites
  (P5-05 §17, P5-07 RP-012).

---

## 9. Audit Persistence

- `p5_audit_events` is append-only with unique `event_id` (`identity_key`)
  and a `decision_id_ref` index; chronology is preserved (duplicate events
  ignored).
- The replay engine reads audit events from the decision record payload
  (frozen behavior); the standalone audit table is the P5-05 audit-history
  surface for future consumers and is written through
  `insertAuditEvent` (idempotent).

---

## 10. Permission Artifact Handling

- Persisted exactly as recorded (`P5HistoricalPermission` by `ref`).
- The **known gap** (P5-07-IMPL §11): the decision record model has no
  permission artifact reference, so a `GRANTED` permission still yields an
  explicit `ARTIFACT_UNAVAILABLE` finding from the engine — now backed by a
  real table the future producer can write to.
- A missing permission artifact is never fabricated and never becomes
  `DENIED`/`NOT_GRANTED` (verified by test).

---

## 11. Failure Semantics

| Situation | Store behavior | Replay outcome |
|---|---|---|
| No row for exact key | `null` | resolver `MISSING` → `ARTIFACT_MISSING` |
| Identity exists, version differs | candidate returned | `VERSION_MISMATCH` → `ARTIFACT_VERSION_MISMATCH` |
| Exact row exists, hash differs | artifact returned | `SNAPSHOT_HASH_MISMATCH` → `ARTIFACT_HASH_MISMATCH` |
| Row/DB unavailable | adapter error propagates | engine failure → `REPLAY_UNAVAILABLE` (not a decision outcome) |

Never: missing/infrastructure → `NO_ACTION`, `NOT_DETERMINED`, or any
decision outcome (RP-015/016).

---

## 12. Replay Integration

- `ReplayEngine` + `ArtifactResolver` are **unchanged**; the Pg store is a
  drop-in `HistoricalArtifactStore` implementation.
- Production wiring: `pgHistoricalArtifactResolver` (production.ts) for
  consumers that want persisted artifacts; the frozen
  `historicalArtifactResolver` singleton stays on the absence adapter as the
  safe fallback.
- Existing P5-07 tests (36) still pass unchanged; new integration tests
  prove persisted artifacts → `REPLAY_COMPLETE` / `EXACT` and missing
  artifacts → `REPLAY_UNAVAILABLE`.

---

## 13. Security / Safety Boundary

- Replay is read-only through the store; the store cannot execute, approve,
  grant permission, or mutate history.
- No RBAC, no authority hierarchy, no admin bypass, no emergency override —
  authority remains the P5-04 conceptual contract.
- No live/current state is ever read by the persistence layer.

---

## 14. Test Matrix

| Suite | Covers |
|---|---|
| `pg-artifact-store.test.ts` (17) | A. exact identity (+wrong version → candidate/VERSION_MISMATCH, missing → MISSING); B. historical precedence; C. immutability/idempotency (duplicate write ignored, frozen record round-trip); D. snapshot FOUND/MISSING/VERSION_MISMATCH/HASH_MISMATCH/UNAVAILABLE/MATCH; E. missing artifacts; F. permission available/missing, no fabrication; G. read-only + insert-only prototype surfaces |
| `pg-replay-integration.test.ts` (7) | G. engine over persisted store (REPLAY_COMPLETE/EXACT, all 3 modes); E. missing → REPLAY_UNAVAILABLE ≠ NO_ACTION; B. historical v1 wins over live v2 (LIVE_CONTEXT only when missing); version mismatch through store; H. mutation protection (rows byte-identical after all modes); P. permission gap → ARTIFACT_UNAVAILABLE, never executed |

Totals: replay suites **60/60** (36 pre-existing + 24 new); full P5 + API +
components **140/140**; P4 **129/129**; `tsc --noEmit` clean.

---

## 15. Known Limitations

- **No producers yet — the concrete dependency.** P5-03/04/05 engines are
  contract-only, so no artifact is written in production today; production
  replay still reports `REPLAY_UNAVAILABLE` until a producer persists
  artifacts via `PgHistoricalArtifactWriter`. The persistence layer,
  schema, store and replay path are implemented and tested; the missing
  producer is the blocker for certified reconstruction, not a defect.
- **Permission artifact ref gap** (upstream record model): GRANTED permission
  still yields explicit `ARTIFACT_UNAVAILABLE` — unchanged, documented.
- **contentHash** stays PROVISIONAL (P5-02 AD-014); hash checks only when a
  hash is recorded.
- **No API/UI** for replay (P5-07 §15); not part of this task.
- **Migration not applied** in this task: applying requires a database
  (repo `drizzle/migrations/` + `execute-migrations.js` convention) and an
  owner-approved deployment moment.

---

## 16. Provisional / Open / Candidate Items

- **PROVISIONAL:** contentHash computation (P5-02 AD-014); audit persistence
  model details (P5-05 §16).
- **OPEN / NOT AVAILABLE:** historical artifact producers (P5-03/04/05 engine
  implementation); permission artifact reference in the record model.
- **OPEN:** expiry/staleness durations; P4-06 (DATA ACCRUAL).
- **CANDIDATE / FUTURE:** additional replay modes; execution events
  vocabulary; replay API/UI; retention/archival policy.
- **OUT OF SCOPE:** event-sourcing platform, generic workflow engine, RBAC,
  execution ledger, trading database, distributed event bus.

---

## 17. Git Boundary

| Change | Files |
|---|---|
| This task (implementation) | `src/db/schema.ts` (additive: 7 `p5_*` tables + type exports), `drizzle/migrations/0021_add_p5_historical_artifacts.sql` (new), `src/lib/p5/replay/pg-artifact-store.ts` (new), `src/lib/p5/replay/production.ts` (new), 2 test files (new), this document |
| Frozen P5-02 … P5-07 semantics | NONE — no upstream contract or replay code modified |
| P3 / P4 / P4-06 | NONE |
| Pre-existing dirty (untouched) | `P5_MASTER_SPECIFICATION.md`, `package-lock.json`, `tsconfig.tsbuildinfo`, `src/app/narrative/[id]/page.tsx` (P5-06), untracked P5 docs + P5-06 sources |

No commit was made (not requested).

---

## 18. Acceptance Audit (20 gates)

| Gate | Result | Evidence | Required correction |
|---|---|---|---|
| G1 — P5-02 compatibility | **PASS** | Outcome/identity-chain/AD-014 vocabulary stored verbatim; no reinterpretation | none |
| G2 — P5-03 compatibility | **PASS** | Policy artifacts stored as recorded; no policy logic in persistence | none |
| G3 — P5-04 compatibility | **PASS** | Guardrail/approval/permission stored as recorded states; no decision logic | none |
| G4 — P5-05 compatibility | **PASS** | Audit events append-only, idempotent; immutability triggers; no rewrite | none |
| G5 — P5-06 compatibility | **PASS** | P5-06 read/presentation untouched; store is a new provider, not a new surface | none |
| G6 — P5-07 compatibility | **PASS** | Frozen `HistoricalArtifactStore` implemented; engine/resolver unchanged; 36 pre-existing tests green | none |
| G7 — Historical-over-live | **PASS** | Store reads persisted rows only; integration tests: persisted v1 wins, live v2 only `LIVE_CONTEXT` when missing | none |
| G8 — Exact identity | **PASS** | `identity_key` unique; FOUND only on exact key; tests A1/A3 | none |
| G9 — Exact version | **PASS** | exact key first; candidate → resolver `VERSION_MISMATCH`; never silent (A2, integration) | none |
| G10 — Snapshot anti-drift | **PASS** | 5 states reachable; no live substitution (D1–D4) | none |
| G11 — Hash semantics | **PASS** | PROVISIONAL preserved; never computed/assumed; HASH_MISMATCH/UNAVAILABLE tested (D4) | none |
| G12 — Missing artifact semantics | **PASS** | `null` → `ARTIFACT_MISSING`; never NO_ACTION (E1, integration E1) | none |
| G13 — Replay-unavailable semantics | **PASS** | Missing → `REPLAY_UNAVAILABLE` ≠ NO_ACTION/NOT_DETERMINED (integration E1) | none |
| G14 — Immutability | **PASS** | No update/delete surface; idempotent writes; DB triggers; tests C1–C3, H1 | none |
| G15 — Audit chronology | **PASS** | Append-only, unique eventId, decision ref index; duplicate ignored (C3) | none |
| G16 — Permission artifact boundary | **PASS** | Persisted exactly; gap explicit `ARTIFACT_UNAVAILABLE`; never fabricated (F1, P1) | none |
| G17 — No semantic reinterpretation | **PASS** | Persistence stores/retrieves only; zero decision/eligibility/safety/approval logic | none |
| G18 — No hidden score/threshold | **PASS** | No score/threshold/weight anywhere in P5-08 sources; legacy 90/80/65, 25/15/8 not referenced | none |
| G19 — No BUY/SELL/execution semantics | **PASS** | No BUY/SELL/LONG/SHORT/ORDER/TRADE/execution vocabulary in P5-08 | none |
| G20 — Regression + implementation discipline | **PASS** | tsc clean; replay 60/60; P5+API+UI 140/140; P4 129/129; P3 failures pre-existing (`db.select` mock drift, untouched); no scope creep (no persistence architecture beyond 7 tables + store/writer) | none |

**All 20 gates PASS.** No upstream contradiction found; no STOP triggered.

---

## 19. Freeze Discipline

This is an implementation task, not a freeze task. Per the task rules:

- Status is **IMPLEMENTATION COMPLETE — READY FOR OWNER REVIEW**.
- **NOT FROZEN / APPROVED FOR DOWNSTREAM** — a freeze requires an explicit
  final-revision/freeze task with owner approval.
- The concrete dependency for certified reconstruction is recorded: P5
  producers (P5-03/04/05 engine implementation) must write artifacts through
  `PgHistoricalArtifactWriter` before production replay reports anything
  other than `REPLAY_UNAVAILABLE`.

---

# P5-08 Final Revision / Freeze Report

**Revision:** R2 (final revision / freeze check) — this task performs the
freeze gate only. No production code was changed; the document was extended
with this report and its header status was updated.

## 20.1 Status

**FROZEN / APPROVED FOR DOWNSTREAM** — P5-08 persistence/store implementation
is frozen as the historical-artifact storage baseline. All 26 freeze gates
(G1–G26) PASS; no upstream contradiction; no regression introduced; no scope
creep; read/write separation intact.

Actual certified historical replay remains **BLOCKED BY DATA AVAILABILITY**
(no P5 producer writes artifacts today) — a downstream implementation
dependency, explicitly **not** a persistence defect and **not** promoted by
this freeze.

## 20.2 Revision Summary

| Revision | Change |
|---|---|
| R1 (implementation) | 7 `p5_*` tables, migration 0021, `PgHistoricalArtifactStore` + `PgHistoricalArtifactWriter` + `P5RowStore` adapter, `production.ts` wiring, 24 tests, this document (§1–§19) |
| R2 (this task) | Independent re-verification from the repo (not the prior report); zero production code changes; header status updated; this freeze report appended |

## 20.3 Independent Verification

Verified directly (read, not assumed):

- `git status` / `git diff --stat` — `src/db/schema.ts` modified (+165/−0,
purely additive); `drizzle/migrations/0021_add_p5_historical_artifacts.sql`
untracked; all other dirty files pre-existing (P5_MASTER_SPECIFICATION.md,
package-lock.json, tsconfig.tsbuildinfo, page.tsx, untracked P5 docs).
- Read in full: migration 0021 (7 tables, 7 immutability triggers),
`pg-artifact-store.ts` (store + writer + adapter), `production.ts`,
`schema.ts` P5 section, both P5-08 test suites, the frozen
`HistoricalArtifactStore` interface (6 `find*` methods), and the P5-07
frozen contract (RP-003/006/012/015/016, §5/§6/§11).
- Re-ran all suites and typecheck (see §20.12/§20.13) and the independent
forbidden-term scan (§20.14 evidence).

## 20.4 Schema Verification (7 tables)

| Table | Identity (`identity_key` UNIQUE) | Version | Timestamp | Payload verbatim | Indexes | Immutability trigger | Exact lookup |
|---|---|---|---|---|---|---|---|
| `p5_decision_records` | decisionId | — | decision_at, recorded_at | `record` jsonb | narrative_id | ✔ | ✔ (identity_key) |
| `p5_p4_snapshots` | full identity + versionTuple + asOf (AD-014) | semantic/algorithm versions | as_of, recorded_at | `snapshot` jsonb | narrative_id+window | ✔ | ✔ |
| `p5_policies` | policyId@policyVersion | policy_version | effective/evaluation/recorded_at | `policy` jsonb | policy_id | ✔ | ✔ |
| `p5_guardrails` | guardrailId@version | version | evaluated_at, recorded_at | `guardrail` jsonb | guardrail_id | ✔ | ✔ |
| `p5_approvals` | approvalId | approval_policy_version | approved_at, recorded_at | `approval` jsonb | decision_id_ref | ✔ | ✔ |
| `p5_permissions` | ref | — | evaluated_at, recorded_at | `permission` jsonb | ref | ✔ | ✔ |
| `p5_audit_events` | eventId | policy_version_ref | event_at, recorded_at | `event` jsonb | decision_id_ref, event_type | ✔ | ✔ |

Migration 0021 is **additive only** (CREATE TABLE/INDEX IF NOT EXISTS,
CREATE OR REPLACE FUNCTION, CREATE TRIGGER; no ALTER/DROP on existing
tables) and follows the repo convention of hand-managed numbered SQL (like
0019/0020; the P3 `execute-migrations.js` runner is P3-scoped 0015–0018 —
0021 is applied at an owner-approved deployment moment, consistent with
0019/0020). `schema.ts` matches the migration column-for-column; `content_hash`
is nullable and never computed (PROVISIONAL, AD-014). No foreign keys were
added to existing tables (no cross-table coupling introduced).

## 20.5 Store Verification

- `PgHistoricalArtifactStore` implements the frozen `HistoricalArtifactStore`
  interface exactly: `findDecision`, `findP4Snapshot`, `findPolicy`,
  `findGuardrail`, `findApproval`, `findPermission` — and nothing else
  (prototype-surface test asserts exactly these six).
- The SQL surface is isolated in the `P5RowStore` port; production uses
  `DrizzleP5RowStore` over `db` from `@/db`; tests use an in-memory fake.
  `production.ts` is the only replay module that imports `@/db`, and no test
  imports `production.ts` (no DATABASE_URL required by unit tests).

## 20.6 Exact Resolution

FOUND only on exact `identity_key`; identity-exists-but-version-differs
returns the candidate for the frozen resolver to classify `VERSION_MISMATCH`;
identity absent → `null` → `ARTIFACT_MISSING`. No latest/current/active
fallback, no fuzzy match. Verified by tests A1–A3 (policy), guardrail exact +
mismatch, decision/approval exact id, snapshot D1/D3.

## 20.7 Historical Anti-Drift

- Store reads persisted rows only; live/current P4, policy, guardrail,
  approval or configuration state is never consulted.
- Integration B1: historical v1 persisted + live v2 → replay uses v1, live
  inspector never consulted (`LIVE_CONTEXT` findings absent).
- Integration B2: historical missing + live exists → `SNAPSHOT_MISSING`,
  live data only as a labeled `LIVE_CONTEXT` diagnostic — never truth.
- 5 snapshot states reachable: MATCH / MISSING / VERSION_MISMATCH /
  HASH_MISMATCH / UNAVAILABLE (tests D1–D4).

## 20.8 Immutability

- **App layer:** read store = 6 `find*` only; writer = 7 `insert*` only
  (prototype-surface tests assert both); duplicate exact writes ignored via
  unique `identity_key` + `onConflictDoNothing` — first record never
  rewritten (C1); frozen record round-trips byte-identical (C2); audit
  duplicates ignored (C3).
- **DB layer:** `prevent_p5_history_mutation()` rejects UPDATE/DELETE on all
  7 tables (7 triggers, verified in migration 0021).
- Corrections = new artifacts/events, never in-place rewrites (P5-05 §17,
  P5-07 RP-012).

## 20.9 Permission Boundary

- `p5_permissions` persists recorded `P5HistoricalPermission` by `ref`;
  missing → `null`, never `DENIED`/`NOT_GRANTED` (test F1).
- The known record-model gap (no permission-artifact ref on the decision
  record) is preserved: a `GRANTED` permission still yields an explicit
  `ARTIFACT_UNAVAILABLE` finding (integration P1) — never fabricated, never
  implied. The table exists for the future producer; **no permission
  semantics are promoted**.

## 20.10 Replay Integration

- `ReplayEngine` and `ArtifactResolver` are **unchanged** (frozen);
  `PgHistoricalArtifactStore` is a drop-in `HistoricalArtifactStore`
  implementation. `ReplayEngine`/`ArtifactResolver`/`types.ts` import no DB
  client — the boundary is intact.
- `production.ts` wires `db → PgHistoricalArtifactStore →
  pgHistoricalArtifactResolver`; the frozen `historicalArtifactResolver`
  singleton stays on the absence adapter as fallback.
- Integration: persisted artifacts → `REPLAY_COMPLETE`/`EXACT`; all three
  modes deterministic on the same core; missing → `REPLAY_UNAVAILABLE`;
  version mismatch through the store → `VERSION_MISMATCH` finding;
  mutation protection (rows byte-identical after all modes).

## 20.11 Cross-Document Consistency

P5-08 stores/retrieves recorded facts only; it adds no decision vocabulary:

| Semantic | P5-02 | P5-03 | P5-04 | P5-05 | P5-06 | P5-07/IMPL | P5-08 |
|---|---|---|---|---|---|---|---|
| NO_ACTION | DecisionOutcome | completed evaluation, nothing selected | n/a | explanation slot | read/present | replay reconstructs exactly | stored verbatim |
| POLICY-BLOCKED | distinct | distinct (PD-018) | n/a | blocked provenance | distinct display | reconstructs blocker + refs | stored verbatim |
| SAFETY-BLOCKED | distinct | n/a | distinct (SG-005) | guardrail provenance | distinct display | reconstructs guardrail | stored verbatim |
| APPROVAL-DENIED | distinct | n/a | distinct (SG-011) | approval provenance | distinct display | reconstructs approval | stored verbatim |
| NOT_DETERMINED | distinct | distinct (PD-009) | n/a | no-action case | distinct display | reason, never NO_ACTION | stored verbatim |
| SUPPRESSED | distinct | distinct (PD-019) | n/a | suppression case | distinct display | never NO_ACTION | stored verbatim |
| SELECTED | distinct | distinct | n/a | selection | distinct display | candidate/action identity | stored verbatim |
| ELIGIBLE / APPROVED / SAFE | orthogonal dims | eligibility | approval/safety | explanation | orthogonal display | orthogonal reconstruction | stored as recorded fields |
| EXECUTION_PERMISSION_GRANTED | permission ≠ execution | n/a | permission result | permission ≠ executed | distinct display | permission ≠ execution | stored verbatim; gap explicit |
| EXECUTED | n/a | n/a | execution permission ≠ executed | execution result | distinct | replay ≠ re-execution | not created by store |
| FAILED / CANCELLED / REVOKED / EXPIRED / STALE | lifecycle | — | — | audit events | display | reconstructs events | audit events append-only |
| ABSENT | — | — | — | unavailable ≠ outcome | availability distinct | REPLAY_UNAVAILABLE ≠ NO_ACTION/NOT_DETERMINED | missing → explicit classification |

No silent override of any upstream semantic. `REPLAY_UNAVAILABLE` remains a
replay-validation result, not a DecisionOutcome (P5-07 RP-016) — P5-08 does
not add to the outcome vocabulary.

## 20.12 Test Results (re-run)

| Suite | Result |
|---|---|
| `pg-artifact-store.test.ts` | PASS (17) |
| `pg-replay-integration.test.ts` | PASS (7) |
| `replay-engine.test.ts` + `artifact-resolver.test.ts` (frozen) | PASS (36) |
| **Replay total** | **60/60 PASS** |
| All P5 + API + components | **140/140 PASS** |
| P4 | **129/129 PASS** |
| `npx tsc --noEmit` | **clean** |

## 20.13 Regression

- P4/API/component suites: all pass — P5-08 introduces no regression.
- P3: the same 7 suites fail as pre-existing (`db.select is not a function`
  mock/assertion drift); `git diff` shows zero changes under `src/lib/p3` and
  `src/lib/p4`; not caused by and not fixed in this task.
- No failure was introduced by P5-08.

## 20.14 26-Gate Freeze Audit

| Gate | Result | Evidence | Required correction |
|---|---|---|---|
| G1 — P5-02 compatibility | **PASS** | Outcome/identity/AD-014 vocab stored verbatim; no reinterpretation | none |
| G2 — P5-03 compatibility | **PASS** | Policy artifacts as recorded; zero policy logic in persistence | none |
| G3 — P5-04 compatibility | **PASS** | Guardrail/approval/permission stored as recorded states | none |
| G4 — P5-05 compatibility | **PASS** | Audit append-only, idempotent, immutable; no rewrite | none |
| G5 — P5-06 compatibility | **PASS** | P5-06 untouched; store is a provider, not a new surface | none |
| G6 — P5-07 compatibility | **PASS** | Frozen interface implemented; engine/resolver unchanged; 36 pre-existing tests green | none |
| G7 — P5-07-IMPL compatibility | **PASS** | Permission gap preserved (ARTIFACT_UNAVAILABLE); replay semantics unchanged | none |
| G8 — Historical-over-live | **PASS** | Store reads persisted rows only; B1/B2 integration tests | none |
| G9 — Exact identity | **PASS** | `identity_key` UNIQUE; FOUND only on exact key; A1/A3 | none |
| G10 — Exact version | **PASS** | Exact key first; candidate → VERSION_MISMATCH; A2 | none |
| G11 — Version mismatch classification | **PASS** | Resolver classifies; integration test through store | none |
| G12 — Missing artifact classification | **PASS** | `null` → ARTIFACT_MISSING; never NO_ACTION (E1) | none |
| G13 — Snapshot anti-drift | **PASS** | 5 states reachable; D1–D4; no live substitution | none |
| G14 — contentHash boundary | **PASS** | PROVISIONAL preserved; never computed/assumed; D4 | none |
| G15 — Immutability (app) | **PASS** | find-only store, insert-only writer, idempotent writes; C1–C3, H1 | none |
| G16 — Immutability (DB) | **PASS** | 7 triggers reject UPDATE/DELETE on all 7 tables | none |
| G17 — Audit chronology | **PASS** | Append-only, unique eventId, decision ref index; C3 | none |
| G18 — Permission artifact boundary | **PASS** | Gap explicit; never fabricated (F1, P1) | none |
| G19 — Read/write separation | **PASS** | Replay read-only; writer insert-only; replay never calls writer | none |
| G20 — Replay integration boundary | **PASS** | ReplayEngine imports no DB client; production.ts isolated from tests | none |
| G21 — No semantic reinterpretation | **PASS** | Store stores/retrieves only; zero decision/safety/approval logic | none |
| G22 — No hidden score/threshold | **PASS** | Source scan: no score/threshold/weight in P5-08 | none |
| G23 — No BUY/SELL/execution semantics | **PASS** | Scan clean; only `EXECUTE FUNCTION` trigger SQL; no order/trade/retry | none |
| G24 — Regression + implementation discipline | **PASS** | tsc clean; 60/60 replay; 140/140 P5+API+UI; 129/129 P4; P3 failures pre-existing | none |
| G25 — Migration safety (added) | **PASS** | 0021 additive-only, follows 0019/0020 convention; no destructive ops; no FK coupling | none |
| G26 — Producer dependency classification (added) | **PASS** | No producer = downstream dependency, not a defect; NOT promoted by freeze | none |

**All 26 gates PASS.** No upstream contradiction; no STOP triggered.

## 20.15 Freeze Matrix

| Semantic | Owner | Status | Downstream |
|---|---|---|---|
| Persistence contract / storage boundary | P5-08 | **FROZEN** | P5 producers, replay engine |
| Exact historical artifact resolution | P5-08 | **FROZEN** | replay engine |
| Immutability semantics (app + DB) | P5-08 | **FROZEN** | audit, replay |
| Replay integration boundary | P5-07/P5-08 | **FROZEN** | replay consumers |
| Historical-over-live / anti-drift | P5-07/P5-08 | **FROZEN** | replay engine |
| Read/write separation | P5-08 | **FROZEN** | replay, producers |
| contentHash | P5-02 (AD-014) | PROVISIONAL | future |
| P5 producer implementation | P5-03/04/05-IMPL | NOT AVAILABLE | must write via `PgHistoricalArtifactWriter` |
| Permission artifact ref in record model | P5-04/P5-05 | OPEN | future producer |
| Expiry/staleness durations | — | OPEN | future |
| Replay API/UI | — | CANDIDATE / FUTURE | owner decision |
| Retention/archival policy | — | CANDIDATE / FUTURE | owner decision |
| Execution events vocabulary / automation | — | OUT OF SCOPE | separate frozen contract |
| P4-06 | parallel track | OPEN / DATA ACCRUAL | unchanged |
| Certified historical replay (production) | P5 producers | **BLOCKED BY DATA AVAILABILITY** | owner decision on producer task |

Nothing PROVISIONAL/OPEN/CANDIDATE was promoted by this freeze.

## 20.16 Remaining Provisional / Open

- **PROVISIONAL:** contentHash computation (P5-02 AD-014); audit persistence
  model details (P5-05 §16).
- **OPEN / NOT AVAILABLE:** P5 artifact producers; permission-artifact
  reference in the record model; expiry/staleness durations; P4-06
  (DATA ACCRUAL).
- **CANDIDATE / FUTURE:** additional replay modes; execution events
  vocabulary; replay API/UI; retention/archival.
- **OUT OF SCOPE:** event-sourcing platform, generic workflow engine, RBAC,
  execution ledger, trading database, distributed event bus.

## 20.17 Producer Dependency

- **P5-08 persistence implementation: FROZEN** (gates pass).
- **P5 producer implementation: NOT AVAILABLE** — P5-03/04/05 engines are
  contract-only; no artifact is written in production today.
- **Historical replay against real production artifacts: BLOCKED BY DATA
  AVAILABILITY** until producers persist artifacts via
  `PgHistoricalArtifactWriter`. This is a downstream implementation
  dependency, not a persistence defect.

## 20.18 Git Boundary

| Change | Files |
|---|---|
| This freeze-check task | `docs/P5_Upgrade/P5-08_HISTORICAL_ARTIFACT_PERSISTENCE.md` only (R2 append + header status). Zero production code changes. |
| P5-08 implementation (R1, prior task) | `src/db/schema.ts` (additive +165/−0), `drizzle/migrations/0021_add_p5_historical_artifacts.sql`, `src/lib/p5/replay/pg-artifact-store.ts`, `src/lib/p5/replay/production.ts`, 2 test files |
| Frozen P5-02 … P5-07 / P5-07-IMPL | NONE — no upstream contract or replay code modified |
| P3 / P4 / P4-06 | NONE |
| Pre-existing dirty (untouched) | `P5_MASTER_SPECIFICATION.md`, `package-lock.json`, `tsconfig.tsbuildinfo`, `src/app/narrative/[id]/page.tsx`, untracked P5 docs + P5-06 sources |

No commit was made (not requested).

## 20.19 Final Freeze Decision

**FROZEN / APPROVED FOR DOWNSTREAM** — P5-08 persistence/store implementation
is frozen as the historical artifact storage baseline. Actual certified
historical replay remains dependent on P5 producer implementations writing
recorded artifacts.

This freeze applies **only** to the FROZEN semantics in §20.15 (persistence
contract, storage boundary, exact resolution, immutability, replay
integration boundary, schema/storage behavior actually implemented).
PROVISIONAL / OPEN / NOT AVAILABLE / CANDIDATE / OUT OF SCOPE items remain
unchanged. P5-09 is not started; P5 producers are not implemented; P5-02 →
P5-07 are not modified.

## 20.20 Verification Record

- Reviewer: agent (freeze gate) — final decision subject to owner review
  confirmation per project discipline.
- Date: 2026-08-17.
- Verification performed: independent repo read (git status/diff, schema,
  migration, store, writer, production wiring, tests, frozen contracts),
  full test re-run (replay 60/60, P5+API+UI 140/140, P4 129/129), tsc
  clean, P3 pre-existing failure confirmation, forbidden-term scan, migration
  additive + trigger coverage check.
- Outcome: all 26 gates PASS → **FROZEN / APPROVED FOR DOWNSTREAM**
  (implementation baseline); actual historical replay availability remains
  BLOCKED BY DATA AVAILABILITY (producer dependency).
