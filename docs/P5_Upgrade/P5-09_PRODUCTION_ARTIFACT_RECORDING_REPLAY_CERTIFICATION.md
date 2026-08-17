# P5-09 — PRODUCTION ARTIFACT RECORDING & REPLAY CERTIFICATION

**Repository:** https://github.com/ratrichero/NarrativeHealth
**Phase:** P5 — What action, if any, should be executed?
**Task:** P5-09 — Production Artifact Recording & Replay Certification
**Document status:** FROZEN / APPROVED FOR DOWNSTREAM — artifact-recording & replay-certification infrastructure (final revision / freeze check; see §28). The P5 producer engine remains NOT AVAILABLE (see §28.6).
**Revision history:** R1 = implementation (this document, §1–§27). R2 = final revision / freeze check (appended §28).
**Upstream contracts:** P5-02 … P5-07 FROZEN; P5-07-IMPL FROZEN (implementation baseline); P5-08 FROZEN (storage baseline)

---

## 1. Scope

Connect a runtime P5 decision to the FROZEN P5-08 historical artifact
persistence and P5-07 replay infrastructure, and certify the full path:

```
production decision
        ↓
recorded historical artifacts   (P5ArtifactRecorder → PgHistoricalArtifactWriter)
        ↓
HistoricalArtifactStore          (PgHistoricalArtifactStore — read-only)
        ↓
ArtifactResolver                 (frozen — exact identity + version)
        ↓
ReplayEngine                     (frozen — RECONSTRUCT / VALIDATE / COMPARE)
        ↓
deterministic historical reconstruction (P5ReplayReport)
```

P5-09 does **not** create a decision engine, does **not** re-run policy,
safety, approval or permission, does **not** execute anything, and does
**not** reinterpret frozen P5 semantics. It records facts that already exist
in the runtime decision record and proves they replay deterministically.

## 2. Repository Baseline

Verified directly at implementation time:

- `src/lib/p5/` — P5-06 read service (`read/`), P5-07-IMPL replay
  (`replay/`: `artifact-resolver.ts`, `replay-engine.ts`, `types.ts`,
  `pg-artifact-store.ts`, `production.ts`), shared `types.ts` (P5-02/03/04/05
  vocabulary).
- `src/db/schema.ts` — 7 `p5_*` tables (P5-08) + `P5*Row` type exports.
- `drizzle/migrations/0021_add_p5_historical_artifacts.sql` — additive
  migration with immutability triggers on all 7 tables.
- `src/lib/p4/` — read-time derived service; no persistence, no writes.
- **No P5 producer/runtime exists** — P5-03/04/05 engines are contract-only
  (verified: `PgHistoricalArtifactWriter.insertDecision` is referenced only
  by store/tests, never by production code).

## 3. Existing Infrastructure

| Layer | Status |
|---|---|
| Drizzle 0.45 + pg, `src/db/index.ts` client | Existing (P5-08) |
| `PgHistoricalArtifactWriter` (insert-only, idempotent) | Existing, FROZEN (P5-08) |
| `PgHistoricalArtifactStore` (read-only, 6 `find*`) | Existing, FROZEN (P5-08) |
| `P5RowStore` port + `DrizzleP5RowStore` | Existing, FROZEN (P5-08) |
| `ArtifactResolver` / `ReplayEngine` | Existing, FROZEN (P5-07-IMPL) |
| Migration 0021 | Existing, FROZEN (P5-08) — applied at deployment |

## 4. Producer Discovery

**Finding:** the repository has no usable P5 producer yet. P5-03 (policy
engine), P5-04 (safety/approval engine) and P5-05 (audit recording) are
contract-only; nothing produces a `P5DecisionRecord` at runtime today.

**Per P5-09 §25** — do not invent a decision engine casually. Instead:

- **Missing producer boundary identified:** the P5-03/04/05 engine
  implementation that produces a `P5DecisionRecord` (+ optional permission
  artifact) and commits it to the historical store.
- **Smallest correct integration implemented:** the producer-side recording
  service (`P5ArtifactRecorder`) that a future producer calls at the point a
  decision becomes recorded — it derives and persists every historical
  artifact from the decision record through the frozen writer.
- **Proven in this task:** the complete certification path (decision →
  recording → store → resolver → engine → report) with a realistic runtime
  decision record, through the production store/writer code paths.
- **Remaining gap classified precisely:** wiring the recorder into a real
  production P5 engine. This is a downstream implementation dependency, not
  a defect of P5-09 (see §24, §27).

## 5. Artifact Recording Architecture

```
P5 producer (runtime P5DecisionRecord + optional permission artifact)
        ↓
P5ArtifactRecorder            (src/lib/p5/record/p5-artifact-recorder.ts)
   • derive-only: snapshot/policy/guardrail/approval/audit 1:1 from the record
   • permission: NEVER derived — producer-supplied only (P5-08 §10 gap)
   • never consults live P4 / policy / guardrail / approval state
        ↓
HistoricalArtifactWriter      (frozen — insert-only, idempotent, onConflictDoNothing)
        ↓
PostgreSQL p5_* tables        (migration 0021, immutability triggers)
```

Production wiring: `src/lib/p5/record/production.ts` exports
`pgHistoricalArtifactRecorder` bound to the real Postgres writer (imports
`@/db`, kept out of the unit-test import graph).

Recording order (dependency order): auxiliary artifacts → decision row
(replay anchor) → audit events. Rationale: a mid-batch failure never leaves
a decision row silently missing its referenced artifacts — replay classifies
any partial state explicitly.

## 6. Artifact Mapping

Every artifact is derived 1:1 from fields already present in the runtime
decision record. **Nothing is fabricated.**

| Artifact | Source in the runtime record | Identity | Version | Exact lookup key |
|---|---|---|---|---|
| Decision | the `P5DecisionRecord` itself | `decisionId` | — | `identity_key = decisionId` |
| P4 snapshot | `provenance.p4SnapshotRef` (never live P4) | narrative identity | full versionTuple + asOf | `snapshotIdentityKey(...)` |
| Policy | `provenance.policy` | `policyId` | `policyVersion` | `policyId@policyVersion` |
| Guardrails | `safetyResult.guardrailResults` (never re-evaluated) | `guardrailId` | `version` | `guardrailId@version` |
| Approval | `approvalRecord` (explicit authorization event only) | `approvalId` | `approvalPolicyVersion` (in payload) | `identity_key = approvalId` |
| Permission | **producer-supplied only** — the record model has no permission ref (P5-08 §10); never derived | `ref` | — | `identity_key = ref` |
| Audit events | `auditEvents` (verbatim, append-only) | `eventId` | — | `identity_key = eventId` |
| Provenance/version tuple | stored verbatim inside each payload + version columns | — | — | — |
| Replay report | NOT persisted — a projection/result, not a historical artifact (P5-07 RP-016) | — | — | — |

Timestamp/provenance: each artifact's recorded timestamps and provenance
payload are the record's own values; the writer adds only `recorded_at`
(insert timestamp). contentHash stays **PROVISIONAL** (P5-02 AD-014) —
recorded as `null`, never computed, never assumed.

## 7. Transaction Boundary

- The frozen `P5RowStore` port exposes per-row idempotent insert only; there
  is **no multi-artifact transaction** on the frozen boundary.
- `P5ArtifactRecorder.record()` therefore performs a best-effort batch in
  dependency order and returns a per-artifact summary
  (`P5RecordingResult` — items with `RECORDED | NOT_RECORDED` + `complete`).
- **Partial recording is never silent:** if a batch fails mid-way, replay of
  the decisionId reports `REPLAY_UNAVAILABLE` with explicit artifact-level
  classification (verified: M1/M2 certification tests). The system never
  produces a misleading "complete" historical record.
- **Full multi-artifact atomicity is documented as a limitation**, not
  invented: it would require a transaction-capable store port (a future
  P5-08 amendment, owner-decided).

## 8. Idempotency

- The writer is idempotent per artifact: unique `identity_key` +
  `onConflictDoNothing` — a duplicate exact write is ignored, the first
  recorded artifact remains authoritative, and nothing is ever rewritten.
- Repeated producer invocation with the same decision is safe (verified:
  R6 — second record leaves rows byte-identical; original `actionType`
  preserved).
- No update/delete path exists anywhere (writer prototype surface has only
  `insert*`; store only `find*` — asserted by P5-08 tests).

## 9. Historical Immutability

- App layer: recorder has no mutation methods; writer insert-only; store
  read-only.
- DB layer: `prevent_p5_history_mutation()` triggers reject UPDATE/DELETE on
  all 7 `p5_*` tables (migration 0021).
- Corrections remain new artifacts/events (P5-05 §17, P5-07 RP-012); the
  recorder never rewrites the past.

## 10. Provenance

- Each stored payload is the record's own provenance-bearing artifact
  (verbatim jsonb), so every replay finding can trace back to exact recorded
  refs — decisionId, p4SnapshotRef, policyId/version, guardrail refs,
  approvalId, permission ref, audit eventIds.
- The recorder never fabricates provenance: a missing `p4SnapshotRef`,
  `approvalRecord`, policy identity or permission ref simply results in no
  row (absence preserved) — never a guessed value, never a live substitute.

## 11. Snapshot Handling

- The snapshot artifact is derived from `provenance.p4SnapshotRef` — the
  exact snapshot the decision used — never the current P4 view.
- contentHash remains PROVISIONAL (AD-014): stored as `null`, never
  computed; the engine checks hashes only when recorded (P5-07 RP-009).
- Replay resolves the snapshot by exact identity + versionTuple + asOf;
  missing → `SNAPSHOT_MISSING`; different version → `SNAPSHOT_VERSION_MISMATCH`
  (verified: H2, D-suite of P5-08).

## 12. Audit Recording

- `record.auditEvents` are recorded verbatim into `p5_audit_events`
  (append-only, unique `eventId`); duplicates ignored (R6/R9).
- The frozen audit-event vocabulary (P5-05 §16.1 core events:
  DECISION_CREATED, DECISION_SELECTED, DECISION_BLOCKED,
  DECISION_SUPPRESSED, APPROVAL_REQUESTED/GRANTED/DENIED,
  PERMISSION_GRANTED/REVOKED, DECISION_EXPIRED/CANCELLED/SUPERSEDED,
  CANDIDATE_CREATED, EXECUTION_ATTEMPTED) is reused verbatim — **not
  extended, not promoted**; events outside that vocabulary remain
  PROVISIONAL/CANDIDATE upstream (P5-05 §16.1).
- The audit layer creates no decision; it only records events that exist in
  the record.

## 13. Failure Semantics

| Situation | Behavior |
|---|---|
| Missing fact in record (no p4 ref / no approval / no policy identity) | No row written; absence preserved; replay classifies explicitly |
| Partial identity (e.g. policyId without policyVersion) | `NOT_RECORDED` with reason; `complete=false`; no throw (R7) |
| Duplicate exact write | Ignored (idempotent); first record authoritative (R6) |
| Mid-batch failure | Partial state detectable; replay → `REPLAY_UNAVAILABLE` with artifact classification (M1/M2) |
| Missing artifacts at replay | `REPLAY_UNAVAILABLE` + `ARTIFACT_MISSING` — never `NO_ACTION` / `NOT_DETERMINED` (M1/M2, N1) |

Missing information is never converted into `NO_ACTION`, `DENIED`,
`NOT_GRANTED`, `FAILED` or `EXECUTED`.

## 14. Replay Certification

**C1 (end-to-end):** a realistic SELECTED decision → `P5ArtifactRecorder` →
persisted `p5_*` artifacts → `PgHistoricalArtifactStore` →
`ArtifactResolver` → `ReplayEngine.reconstruct("dec-1")` yields:

- `result = REPLAY_COMPLETE`, `equivalence = EXACT`, `sideEffects = NONE`;
- snapshot `SNAPSHOT_MATCH`, policy `FOUND` (v1), guardrail `FOUND`;
- orthogonal states preserved (`DECIDED / NOT_REQUIRED / NOT_APPLICABLE`);
- audit events reconstructed (2/2).

The certification runs the **real production code paths** (recorder, Pg
store, Pg writer, resolver, engine) through the `P5RowStore` port
(in-memory fake implementing the exact port `DrizzleP5RowStore` uses), so it
is deterministic and requires no live database. Applying migration 0021 and
a live-DB smoke run is the deployment-time step (consistent with P5-08).

## 15. Historical-vs-Live Validation

- **H1:** historical snapshot V1 persisted + a live inspector reporting "V2
  exists" → replay uses V1 (`SNAPSHOT_MATCH`, asOf/versionTuple of V1), and
  the live inspector is **never consulted** (no `LIVE_CONTEXT` finding).
- **H2:** historical snapshot missing + live snapshot exists → replay stays
  `REPLAY_UNAVAILABLE` with `SNAPSHOT_MISSING`; the live view appears only
  as a labeled `LIVE_CONTEXT` diagnostic — never reconstructed truth; the
  recorded outcome is preserved.

## 16. Version Mismatch Validation

- **V1:** record references policy v1; store has only v2 → `VERSION_MISMATCH`
  (requestedVersion v1, candidate v2 exposed but never used), finding
  `ARTIFACT_VERSION_MISMATCH`, result `REPLAY_UNAVAILABLE`. No
  latest/current/best-available resolution, no fuzzy matching.

## 17. Missing Artifact Validation

- **M1:** guardrail artifact omitted (partial batch) → `REPLAY_UNAVAILABLE`
  with `ARTIFACT_MISSING` (guardrail); never `NO_ACTION`/`NOT_DETERMINED`.
- **M2:** snapshot artifact omitted → `SNAPSHOT_MISSING` classification;
  decision outcome preserved (`SELECTED`).

## 18. Contradiction Validation

- **X1:** decision `approvalState = APPROVED` + audit event `APPROVAL_DENIED`
  → `CONTRADICTION` with `ARTIFACT_CONTRADICTION` finding (ref = the denied
  event). Both recorded facts preserved verbatim — no latest-wins, no silent
  correction, no scoring, no LLM resolution (P5-07 §12).

## 19. Determinism Validation

- **D1:** the same decisionId + same artifacts + same `replayContractVersion`
  (`p5-replay/v1`) ⇒ byte-identical reports across repeated runs of the same
  mode, and identical result/reconstruction across all three modes. No
  `Date.now()`, no randomness, no live state, no implicit latest lookup.

## 20. Side-Effect Validation

- **S1:** after `reconstruct` + `validate` + `compare` (+ a failed lookup),
  every `p5_*` table is byte-identical. Replay creates no decision, approves
  nothing, executes nothing, retries nothing, and never mutates P4, policy,
  safety, or audit history.

## 21. Test Results

| Suite | Result |
|---|---|
| `p5-artifact-recorder.test.ts` (10) | PASS |
| `p5-09-certification.test.ts` (12) | PASS |
| **P5-09 total** | **22/22 PASS** |
| All P5 + replay + API + components | **162/162 PASS** |
| P4 | **129/129 PASS** |
| `npx tsc --noEmit` | **clean** |

## 22. Regression

- No new failure introduced. P4 129/129, P5 162/162, typecheck clean.
- P3: the same 7 suites fail as pre-existing (`db.select is not a function`
  mock/assertion drift; 16 tests). `git diff` shows zero changes under
  `src/lib/p3` and `src/lib/p4` — untouched by P5-09 (verified, not assumed).

## 23. P4-06 Status

**OPEN / DATA ACCRUAL.** P5-09 does not depend on, promote, modify, or wait
for P4-06. No P4-06 provisional rule is consumed.

## 24. Remaining Provisional / Open

- **Downstream dependency (not a defect):** a production P5 producer
  (P5-03/04/05 engine implementation) that produces a `P5DecisionRecord`
  and invokes `pgHistoricalArtifactRecorder.record()` at decision-commit
  time. Until then, production replay reports `REPLAY_UNAVAILABLE`
  (correct absence behavior).
- **PROVISIONAL:** contentHash computation (P5-02 AD-014); audit persistence
  model details (P5-05 §16); permission-artifact reference on the decision
  record model (P5-08 §10 — recorder accepts a producer-supplied permission
  artifact, never derives one).
- **OPEN:** expiry/staleness durations; authority contract; material-change
  criteria; retention; RBAC; P4-06.
- **CANDIDATE / FUTURE:** ASSISTED / AUTONOMOUS / ESCALATE / EXECUTE;
  additional replay modes; replay API/UI; execution events vocabulary.
- **Documented limitation:** multi-artifact transaction on the `P5RowStore`
  port is not available on the frozen boundary (see §7).

## 25. Git Boundary

| Change | Files |
|---|---|
| This task (implementation) | `src/lib/p5/record/p5-artifact-recorder.ts` (new), `src/lib/p5/record/production.ts` (new), `src/lib/p5/record/__tests__/p5-artifact-recorder.test.ts` (new), `src/lib/p5/record/__tests__/p5-09-certification.test.ts` (new), this document (new) |
| Frozen P5-02 … P5-08 | NONE — no upstream contract, store, writer, resolver or replay code modified |
| P3 / P4 / P4-06 | NONE |
| Pre-existing dirty (untouched) | `P5_MASTER_SPECIFICATION.md`, `package-lock.json`, `tsconfig.tsbuildinfo`, `src/app/narrative/[id]/page.tsx` (P5-06), `src/db/schema.ts` + migration 0021 + P5-08/07 sources (prior tasks), untracked P5 docs |

No commit was made (not requested).

## 26. Acceptance Audit

**A–Y pass:** decision identifiable by decisionId (C1/C2); required artifacts
recorded (R1); existing `PgHistoricalArtifactWriter` used — no new
persistence model (architecture §5); immutable (R6, S1, DB triggers §9);
idempotent (R6); exact identity/version (R1, V1); P4 snapshot preserved
exactly (R2, H1); no live-data substitution (H1/H2); missing artifact
unavailable (M1/M2); version mismatch explicit (V1); contradiction explicit
(X1); audit chronology preserved (A1); provenance preserved (§10); replay
uses decisionId (C2); deterministic (D1); zero side effects (S1); replay
creates no decision (S1, N1); replay executes nothing (N1, S1); no frozen P5
semantics changed (§6); no P4/P4-06 changes (§23); no hidden score/threshold
(source scan clean); no BUY/SELL semantics (source scan clean); P5/P4
regression passes (§22); typecheck passes (§21).

**Z:** end-to-end historical replay certification **passes** through the
production store/writer/resolver/engine code paths with a realistic runtime
decision record. The one genuine dependency — a runtime P5 producer invoking
the recorder — is proven absent, precisely classified (§4, §24), and **not
fabricated into a workaround**.

## 27. Final Implementation Status

**IMPLEMENTATION COMPLETE — READY FOR OWNER REVIEW.**

Per the project freeze discipline (P5-07, P5-08 pattern), this
implementation task does not self-declare frozen. The final revision /
freeze gate (separate task, owner-approved) will run the 28-gate audit below;
all gates currently PASS with the evidence cited in this document.

**Freeze audit (28 gates, all PASS at implementation time):**

| Gate | Result | Evidence |
|---|---|---|
| G1 P5-02 compatibility | PASS | Outcome/identity-chain/AD-014 vocabulary derived verbatim (§6) |
| G2 P5-03 compatibility | PASS | Policy recorded as produced; zero policy logic (R1, R7) |
| G3 P5-04 compatibility | PASS | Guardrail/approval/permission recorded as produced; no evaluation (R4, R9) |
| G4 P5-05 compatibility | PASS | Audit verbatim + append-only; explanation/provenance preserved (§10, §12) |
| G5 P5-06 compatibility | PASS | Read/presentation untouched |
| G6 P5-07 compatibility | PASS | Replay contract honored end-to-end (C1–D1) |
| G7 P5-08 compatibility | PASS | Uses frozen writer/store only; no new persistence model (§5) |
| G8 Producer correctness | PASS | Derive-only recorder; zero fabrication (R1–R5) |
| G9 Artifact completeness | PASS | All derivable classes recorded; gaps explicit (R3, R4) |
| G10 Transaction integrity | PASS | Partial state detectable; never misleading (M1/M2, §7) |
| G11 Idempotency | PASS | R6, R9; writer onConflictDoNothing |
| G12 Exact resolution | PASS | C1, V1; identity_key exact |
| G13 Snapshot anti-drift | PASS | R2, H1, H2 |
| G14 Provenance | PASS | Verbatim payloads; exact refs (§10) |
| G15 Audit chronology | PASS | A1; order preserved, duplicates/order detected |
| G16 Missing artifacts | PASS | M1/M2 → REPLAY_UNAVAILABLE + ARTIFACT_MISSING |
| G17 Version mismatch | PASS | V1 → VERSION_MISMATCH, no fallback |
| G18 Contradiction | PASS | X1 → CONTRADICTION, evidence preserved |
| G19 Deterministic replay | PASS | D1; fixed replayContractVersion |
| G20 Replay namespace isolation | PASS | N1; REPLAY_* never DecisionOutcome |
| G21 Replay ≠ execution | PASS | S1, N1; zero side effects |
| G22 Zero side effects | PASS | S1 byte-identical rows |
| G23 No hidden decision engine | PASS | Recorder records only; no policy/safety/approval logic (§5) |
| G24 No score/threshold | PASS | Source scan clean |
| G25 No BUY/SELL | PASS | Source scan clean |
| G26 P4-06 independence | PASS | §23; no dependency |
| G27 Regression | PASS | P5 162/162, P4 129/129, tsc clean; P3 failures pre-existing (§22) |
| G28 Implementation discipline | PASS | Smallest correct integration; producer gap classified, not fabricated (§4, §24) |

No upstream contradiction found; no STOP triggered; no frozen document
modified.

---

# P5-09 Final Revision / Freeze Report

**Revision:** R2 (final revision / freeze check) — freeze gate only. No
production code changed; the document was extended with this report and its
header status was updated.

## 28.1 Status

**FROZEN / APPROVED FOR DOWNSTREAM** — P5-09 freezes the artifact-recording
and replay-certification infrastructure. All 28 freeze gates (G1–G28) PASS;
no upstream contradiction; no regression; no scope creep.

**It does NOT freeze or implement the missing P5 producer engine.**

- Historical replay infrastructure: **FROZEN**
- Real production P5 producer: **NOT AVAILABLE / DOWNSTREAM DEPENDENCY**

## 28.2 Revision Summary

| Revision | Change |
|---|---|
| R1 (implementation) | `P5ArtifactRecorder` + `production.ts` wiring + 2 test suites (22 tests) + this document (§1–§27) |
| R2 (this task) | Independent re-verification from the repo (not the prior report); zero production code changes; header status updated; this freeze report appended |

## 28.3 Independent Verification

Verified directly (read, not assumed):

- **Core chain:** `P5DecisionRecord → P5ArtifactRecorder →
  PgHistoricalArtifactWriter → p5_* tables → PgHistoricalArtifactStore →
  ArtifactResolver → ReplayEngine → P5ReplayReport`. The recorder imports
  only types + the frozen `HistoricalArtifactWriter` interface — no `@/db`,
  no drizzle, no pg, no store access. Production wiring
  (`production.ts`) binds `pgHistoricalArtifactRecorder` to the frozen
  Postgres writer; the only `@/db` import is via `replay/production.ts`.
- **Recorder surface:** 4 static `derive*` methods + `record()` — no
  update/delete/mutation surface. Permission is never derived (producer-
  supplied only, P5-08 §10 gap); contentHash recorded as `null` (PROVISIONAL,
  AD-014); live P4/policy/guardrail/approval state never consulted.
- **Producer gap:** the recorder is referenced only by itself and
  `production.ts` — no runtime P5 producer calls it (verified by grep).
  P5-03/04/05 engines remain contract-only.
- **Git ownership:** zero changes under `src/lib/p3`, `src/lib/p4`,
  `src/lib/p5/read`, `src/lib/p5/replay` (frozen code untouched); the only
  tracked-modification in the P5 chain is `src/db/schema.ts` from P5-08
  (additive).

## 28.4 28-Gate Freeze Audit

| Gate | Result | Evidence | Required correction |
|---|---|---|---|
| G1 — P5-02 compatibility | **PASS** | Outcome/identity-chain/AD-014 vocab derived verbatim (§6); no new ActionType/DecisionOutcome | none |
| G2 — P5-03 compatibility | **PASS** | Policy recorded as produced; zero policy logic (R1, R7) | none |
| G3 — P5-04 compatibility | **PASS** | Guardrail/approval/permission recorded as produced; no evaluation (R4, R9) | none |
| G4 — P5-05 compatibility | **PASS** | Audit verbatim + append-only; explanation/provenance preserved (§10, §12) | none |
| G5 — P5-06 compatibility | **PASS** | Read/API/presentation untouched | none |
| G6 — P5-07 compatibility | **PASS** | Replay contract honored end-to-end (C1–D1, X1) | none |
| G7 — P5-08 compatibility | **PASS** | Uses frozen writer/store only; no new persistence model (§5) | none |
| G8 — Producer boundary | **PASS** | Producer engine NOT AVAILABLE — classified as dependency, not defect (§28.6) | none |
| G9 — Recorder boundary | **PASS** | Type-only imports; no DB/store access; no mutation surface (§28.3) | none |
| G10 — Artifact mapping | **PASS** | Every artifact derived 1:1 from recorded runtime facts (§6, R1–R5) | none |
| G11 — Artifact completeness | **PASS** | All derivable classes recorded; gaps explicit (R3, R4) | none |
| G12 — Exact identity | **PASS** | `identity_key` exact; C1, C2, V1 | none |
| G13 — Version integrity | **PASS** | V1 → VERSION_MISMATCH, no latest/current fallback | none |
| G14 — Snapshot anti-drift | **PASS** | R2, H1, H2 — V1 wins; live only as LIVE_CONTEXT | none |
| G15 — Provenance | **PASS** | Verbatim payloads; exact refs (§10) | none |
| G16 — Audit chronology | **PASS** | A1; order preserved, duplicates/order detected | none |
| G17 — Immutability | **PASS** | Store find-only, writer insert-only, recorder no mutation; DB triggers (migration 0021); R6/S1 | none |
| G18 — Idempotency | **PASS** | R6, R9; `onConflictDoNothing`; first record authoritative | none |
| G19 — Transaction/partial-write semantics | **PASS** | Partial state detectable; replay → REPLAY_UNAVAILABLE + classification (M1/M2); limitation documented (§7) | none |
| G20 — Missing artifact | **PASS** | M1/M2 → REPLAY_UNAVAILABLE + ARTIFACT_MISSING, never NO_ACTION/NOT_DETERMINED | none |
| G21 — Permission gap | **PASS** | Never fabricated; producer-supplied only (R4, R5); ARTIFACT_UNAVAILABLE at replay (P1) | none |
| G22 — Contradiction handling | **PASS** | X1 → CONTRADICTION, evidence preserved, no latest-wins/score/LLM | none |
| G23 — Deterministic replay | **PASS** | D1; fixed `p5-replay/v1`; no Date.now/randomness/live state | none |
| G24 — Replay namespace isolation | **PASS** | N1; REPLAY_* / CONTRADICTION never DecisionOutcome | none |
| G25 — Replay ≠ execution | **PASS** | S1, N1; replay creates no decision, approves nothing, executes nothing | none |
| G26 — Zero side effects | **PASS** | S1 — all p5_* tables byte-identical after all modes | none |
| G27 — No hidden decision engine | **PASS** | Recorder records only; no policy/safety/approval/selection logic (§5) | none |
| G28 — Regression + implementation discipline | **PASS** | P5 162/162, P4 129/129, tsc clean; P3 failures pre-existing; P5-09 touches only `src/lib/p5/record/**` + doc | none |

**All 28 gates PASS.** No semantic blocker; no STOP; no frozen document
modified.

## 28.5 Test Results (re-run)

| Suite | Result |
|---|---|
| P5-09 (recorder 10 + certification 12) | **22/22 PASS** |
| All P5 + replay + API + UI | **162/162 PASS** |
| P4 | **129/129 PASS** |
| `npx tsc --noEmit` | **clean** |
| P3 | 7 suites / 16 tests pre-existing (`db.select is not a function` mock drift); zero diffs under `src/lib/p3` — not caused by P5-09 |

## 28.6 Producer Availability Statement

- **P5 producer engine (P5-03/04/05 implementation): NOT AVAILABLE.** No
  runtime code produces a `P5DecisionRecord` or calls
  `pgHistoricalArtifactRecorder.record()` today (verified by grep).
- **Production behavior remains correct:** no recorded decision → replay by
  decisionId → `REPLAY_UNAVAILABLE` (contract-faithful absence semantics,
  N1/C2).
- **Classification:** a downstream implementation dependency, **not** a
  P5-09 defect, and **not** promoted by this freeze.

## 28.7 Historical Replay Certification Statement

P5-09 certifies the full production chain — decision record → recorder →
writer → `p5_*` tables → store → resolver → engine → deterministic report —
through the real production code paths (row-store port), with a realistic
runtime decision record:

- `REPLAY_COMPLETE` / `EXACT` on a fully recorded SELECTED decision (C1);
- historical V1 beats live V2 (H1); missing + live → `LIVE_CONTEXT` only (H2);
- `VERSION_MISMATCH` (V1), `ARTIFACT_MISSING` → `REPLAY_UNAVAILABLE` (M1/M2),
  `CONTRADICTION` (X1), determinism (D1), zero side effects (S1).

Live-DB application of migration 0021 + a production smoke run remains the
deployment-time step (consistent with P5-08).

## 28.8 Cross-Document Consistency

P5-02 → P5-08 semantics unchanged; P5-09 adds no decision vocabulary. All 18
semantics (NO_ACTION … ABSENT) preserved in the certification fixtures and
replay results. ELIGIBLE ≠ SAFE ≠ APPROVED ≠ EXECUTION_PERMISSION_GRANTED ≠
EXECUTED; ack ≠ approval; recommendation ≠ execution; explanation ≠ decision;
audit ≠ explanation — all preserved (orthogonal states asserted in C1;
permission ≠ execution in P1/N1; contradiction in X1).

## 28.9 Git Boundary

| Change | Files |
|---|---|
| This freeze-check task | `docs/P5_Upgrade/P5-09_PRODUCTION_ARTIFACT_RECORDING_REPLAY_CERTIFICATION.md` only (R2 append + header status). Zero production code changes. |
| P5-09 implementation (R1) | `src/lib/p5/record/p5-artifact-recorder.ts`, `src/lib/p5/record/production.ts`, 2 test files |
| Frozen P5-02 … P5-08 | NONE |
| P3 / P4 / P4-06 | NONE |
| Pre-existing dirty (untouched) | `P5_MASTER_SPECIFICATION.md`, `package-lock.json`, `tsconfig.tsbuildinfo`, `src/app/narrative/[id]/page.tsx`, `src/db/schema.ts` + migration 0021 + P5-07/08 sources (prior tasks), untracked P5 docs |

No commit was made (not requested).

## 28.10 Remaining Provisional / Open

Preserved without promotion: contentHash (P5-02 AD-014); permission-artifact
ref gap (P5-08 §10); authority contract; material-change criteria;
expiry/staleness durations; P4-06 (OPEN / DATA ACCRUAL); ASSISTED /
AUTONOMOUS / ESCALATE / EXECUTE (CANDIDATE/FUTURE); retention; RBAC; the
actual P5 producer engine (NOT AVAILABLE / downstream dependency).

## 28.11 Freeze Matrix

| Semantic | Owner | Status | Downstream |
|---|---|---|---|
| Artifact-recording infrastructure (recorder) | P5-09 | **FROZEN** | P5 producer engine |
| Replay-certification path | P5-09 | **FROZEN** | replay consumers |
| Exact identity/version recording | P5-09 | **FROZEN** | replay engine |
| Snapshot anti-drift | P5-07/P5-08/P5-09 | **FROZEN** | replay engine |
| Idempotent/immutable recording | P5-08/P5-09 | **FROZEN** | audit, replay |
| Permission artifact recording | P5-08 §10 | OPEN (producer-supplied only) | future producer |
| contentHash | P5-02 AD-014 | PROVISIONAL | future |
| P5 producer engine | P5-03/04/05-IMPL | NOT AVAILABLE | must call `pgHistoricalArtifactRecorder` |
| P4-06 | parallel track | OPEN / DATA ACCRUAL | unchanged |
| ASSISTED / AUTONOMOUS / ESCALATE / EXECUTE | — | CANDIDATE / FUTURE | separate frozen contract |
| Authority / RBAC / retention | — | OPEN / OUT OF SCOPE | owner decision |

Nothing PROVISIONAL / OPEN / CANDIDATE was promoted by this freeze.

## 28.12 Final Freeze Statement

**FROZEN / APPROVED FOR DOWNSTREAM.** P5-09 freezes the artifact-recording
and replay-certification infrastructure. It does **not** freeze or implement
the missing P5 producer engine — historical replay infrastructure is FROZEN;
the real production P5 producer is NOT AVAILABLE / DOWNSTREAM DEPENDENCY.
This freeze applies only to the FROZEN semantics in §28.11; PROVISIONAL /
OPEN / CANDIDATE / OUT OF SCOPE items remain unchanged. P5-02 → P5-08 frozen
contracts are not modified.

## 28.13 Verification Record

- Reviewer: agent (freeze gate) — final decision subject to owner review
  confirmation per project discipline.
- Date: 2026-08-17.
- Verification performed: independent repo read (git state, recorder
  source/imports/methods, production wiring, test files, doc), full test
  re-run (P5 162/162, P4 129/129, P5-09 22/22), tsc clean, P3 pre-existing
  confirmation, forbidden-term scan (zero source matches), producer-gap grep,
  git-ownership diff.
- Outcome: all 28 gates PASS → **FROZEN / APPROVED FOR DOWNSTREAM**
  (recording + certification infrastructure); P5 producer engine remains
  NOT AVAILABLE / downstream dependency.
