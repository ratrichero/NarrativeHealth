# P5-10 — PRODUCTION P5 DECISION PRODUCER

**Repository:** https://github.com/ratrichero/NarrativeHealth
**Phase:** P5 — What action, if any, should be executed?
**Task:** P5-10 — Production P5 Decision Producer
**Document status:** DRAFT — **BLOCKED BY UPSTREAM RUNTIME DEPENDENCY** (resolution analysis + minimum runtime-chain plan in §34; P5-10 implementation requires upstream P5-03/04/05 runtime first)
**Depends on:** P5-02 … P5-09 FROZEN / APPROVED FOR DOWNSTREAM

---

## 1. Executive Decision

P5-09 is complete and FROZEN:

```
P5DecisionRecord
      ↓
P5ArtifactRecorder        (FROZEN — P5-09)
      ↓
PgHistoricalArtifactWriter (FROZEN — P5-08)
      ↓
p5_* historical tables
      ↓
PgHistoricalArtifactStore  (FROZEN — P5-08)
      ↓
ArtifactResolver           (FROZEN — P5-07-IMPL)
      ↓
ReplayEngine               (FROZEN — P5-07-IMPL)
      ↓
P5ReplayReport
```

What is missing upstream is the **runtime producer**:

```
P4 runtime output
      ↓
      X        ← the gap P5-10 fills
P5DecisionRecord
```

P5-10 implements exactly this gap. It is a **producer / adapter / commit
boundary**, **not** a decision re-evaluation engine. It consumes facts that
already exist (P4 output + declared upstream evaluation facts), assembles a
contract-compliant `P5DecisionRecord`, and commits its historical artifacts
through the already-frozen `P5ArtifactRecorder`.

## 2. Scope

**IN SCOPE**

- A runtime `P5DecisionProducer` that assembles a contract-compliant
  `P5DecisionRecord` from declared inputs and commits it via the frozen
  recorder.
- P4 integration: consume the existing read-time P4 output
  (`P4DecisionSupportViewModel`), preserving its snapshot reference exactly.
- Commit boundary (`buildDecision` → `commitDecision`) with idempotent,
  immutable recording through `P5ArtifactRecorder`.
- Semantic test matrix, recording certification, anti-drift/mutation/
  idempotency tests, regression, documentation.

**OUT OF SCOPE (never in this task)**

| Do not implement | Reason |
|---|---|
| New decision algorithm / business intelligence | P5 produces no new intelligence |
| BUY/SELL/LONG/SHORT/ORDER/TRADE mapping | forbidden |
| Score / threshold / composite formula | forbidden |
| Trading engine / execution engine | out of scope / future |
| Approval workflow | P5-04 contract |
| Safety engine / guardrail evaluation | P5-04 contract |
| Policy engine / eligibility / selection | P5-03 contract |
| Replay engine | FROZEN — P5-07-IMPL |
| Persistence schema | FROZEN — P5-08 |
| Recorder / writer | FROZEN — P5-09/P5-08 |
| API / UI | not required for P5-10 |
| RBAC / authority implementation / emergency override | future / out of scope |
| P4-06 | independent — OPEN / DATA ACCRUAL |

## 3. Preconditions (verified repository state)

Verified directly at document time:

1. **P4 runtime exists** — `src/lib/p4/service.ts`:
   `getP4DecisionSupport(narrativeId): Promise<P4DecisionSupportViewModel | null>`
   — read-time derived, NOT persisted, no writes. Runtime call site:
   `src/app/api/narratives/[id]/route.ts` (narrative API computes P4 on
   demand). P4 output contract: `P4DecisionSupportViewModel`
   (`src/lib/p4/types.ts`).
2. **P5 producer absent** — `PgHistoricalArtifactWriter.insertDecision` and
   `P5ArtifactRecorder` are referenced only by their own modules/tests; no
   runtime code produces a `P5DecisionRecord`.
3. **P5-03/04/05 engines are contract-only** — there is no runtime policy
   evaluation, safety evaluation, approval, or audit producer. This is the
   primary upstream dependency for *full* production decisions (see §5.2,
   §26).
4. **Recorder FROZEN** — `P5ArtifactRecorder.record(batch)` where
   `batch = { decision: P5DecisionRecord, permission?: P5HistoricalPermission }`
   (`src/lib/p5/record/p5-artifact-recorder.ts`); production singleton
   `pgHistoricalArtifactRecorder` (`src/lib/p5/record/production.ts`).
5. **Store/writer FROZEN** — `PgHistoricalArtifactStore` (6 `find*`),
   `PgHistoricalArtifactWriter` (7 `insert*`, idempotent on `identity_key`),
   `P5RowStore` port, migration 0021 (immutability triggers).
6. **Types FROZEN** — `P5DecisionRecord`, `P5P4SnapshotRef`,
   `P5DecisionOutcome` (SELECTED | NO_ACTION | BLOCKED | NOT_DETERMINED),
   orthogonal state dimensions, `P5BlockerSource`
   (POLICY | SAFETY | APPROVAL), `P5PermissionResult`, audit vocabulary
   (`src/lib/p5/types.ts`).
7. **Working tree** — prior P5 tasks' files dirty/untracked (pre-existing);
   no P5-10 file existed before this document.

## 4. Core Architecture

```
                    ┌─────────────────────┐
                    │      P4 Runtime     │  getP4DecisionSupport(narrativeId)
                    │  P4DecisionSupport  │  → P4DecisionSupportViewModel
                    │  ViewModel (read)   │
                    └──────────┬──────────┘
                               │ declared P4 contract (snapshot ref, status,
                               │ direction, explanation, evidence, provenance)
                               ▼
                    ┌─────────────────────┐
                    │  P5 Decision        │  src/lib/p5/producer/
                    │  Producer           │  • buildDecision(input) — assemble only
                    │  (adapter/commit)   │  • commitDecision(record) — recorder
                    └──────────┬──────────┘
                               │ decision commit
                               ▼
                    ┌─────────────────────┐
                    │ P5ArtifactRecorder  │  FROZEN (P5-09)
                    └──────────┬──────────┘
                               ▼
                    ┌─────────────────────┐
                    │ PgHistoricalWriter  │  FROZEN (P5-08)
                    └──────────┬──────────┘
                               ▼
                         PostgreSQL p5_*
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Historical Store    │  FROZEN (P5-08)
                    └──────────┬──────────┘
                               ▼
                    ┌─────────────────────┐
                    │ Artifact Resolver   │  FROZEN (P5-07-IMPL)
                    └──────────┬──────────┘
                               ▼
                    ┌─────────────────────┐
                    │     ReplayEngine    │  FROZEN (P5-07-IMPL)
                    └──────────┬──────────┘
                               ▼
                     P5ReplayReport
```

**Replay path never calls back into the producer.** The producer imports no
store, no resolver, no engine, no DB.

## 5. Input Contract

### 5.1 Declared inputs (producer consumes, never derives)

The producer accepts one input bundle with two parts:

```
P5ProducerInput {
  p4: P4DecisionSupportViewModel | null          // the P4 output actually consumed
  policyEvaluation: P5PolicyEvaluationResult | null  // P5-03 runtime output — ONLY source of outcome
  safety:           P5SafetyResult | null             // P5-04 runtime output
  approval:         P5ApprovalRecord | null           // P5-04 runtime output
  permission:       P5HistoricalPermission | null     // P5-04 runtime output (P5-08 §10)
  audit:            P5AuditEvent[]                    // P5-05 runtime output
}
```

The caller is the **runtime P5 decision pipeline** — P5-03 policy
evaluation → P5-04 safety/approval/permission → P5-05 explanation/audit →
P5-10 producer (owner decisions Q1/Q5, §33.7).

Rules:

- **The producer never derives a P5 outcome from P4.** P4 provides
  interpretation (direction, opportunity, risk, confidence, actionability,
  explanation) — none of it maps to SELECTED / NO_ACTION / BLOCKED /
  NOT_DETERMINED. Any such mapping would be a hidden decision engine
  (forbidden, §2).
- **P5-10 only consumes `P5PolicyEvaluationResult`; it never manufactures
  it** (owner Q3). Without a policy evaluation result the producer cannot
  construct a complete decision and must refuse/fail recording — it never
  auto-selects an outcome (§14).
- **`NOT_DETERMINED` appears only when the P5-03 evaluation itself returned
  it with a reason** (P5-03: technical failure / unusable inputs ⇒
  NOT_DETERMINED + failure reason — a P5-03 engine output, never a
  producer choice).
- **P4 snapshot reference is taken from the consumed P4 output**, never
  re-queried later (anti-drift, §9).

### 5.2 The primary dependency (honest classification)

P5-03/04/05 runtime engines are contract-only. Therefore:

- **The producer consumes the runtime P5 pipeline outputs when they exist**
  (P5-03 → P5-04 → P5-05 → P5-10). With a complete input set the
  certification path reaches `REPLAY_COMPLETE`.
- **Without a `P5PolicyEvaluationResult`, the producer cannot construct a
  complete decision and refuses to record** — it never invents an outcome.
  This is a **downstream dependency**, not a P5-10 defect.
- **No production caller is wired until the upstream chain exists** (owner
  Q5): wiring P5-10 into the P4 narrative API now would force the producer
  to resolve things that do not exist yet — scope creep. The semantic test
  matrix (§19) exercises the producer with fixtures of the *frozen
  contract shapes* (proving the producer preserves semantics); a real
  runtime caller is added only after P5-03/04/05 runtime exists.
- At implementation, if P4 does not provide the needed output for the
  intended integration point, apply **STOP-01** and report the dependency
  instead of fabricating an adapter.

## 6. Producer Responsibilities (P10-R1 … R7)

| # | Responsibility | Implementation rule |
|---|---|---|
| P10-R1 | Consume P4 output | Accept the existing `P4DecisionSupportViewModel`; never re-query live P4 when the snapshot was provided |
| P10-R2 | Construct `P5DecisionRecord` | Assemble per the frozen contract (§10); no new semantic fields |
| P10-R3 | Preserve orthogonal states | decisionState / approvalState / executionState stay separate; ELIGIBLE ≠ SAFE ≠ APPROVED ≠ EXECUTION_PERMISSION_GRANTED ≠ EXECUTED |
| P10-R4 | Preserve blockers | POLICY-BLOCKED / SAFETY-BLOCKED / APPROVAL-DENIED stay distinct with their blockerReport provenance |
| P10-R5 | Capture provenance | decisionId → p4SnapshotRef → policy ref/version → guardrail ref → approval ref → audit refs, all from recorded inputs |
| P10-R6 | Record historical artifacts | `commitDecision` calls `P5ArtifactRecorder.record(record)` exactly once per commit |
| P10-R7 | No execution | never execute / place order / retry / approve / revoke / mutate policy / re-run safety / re-evaluate live P4 |

## 7. Critical Design Principle — Producer ≠ Decision Engine

```
Allowed:
  P4 output + declared upstream facts
        ↓ map (normalize/assemble)
        ↓ P5 contract
  P5DecisionRecord

Forbidden:
  P4 output → calculate new score → apply threshold → decide action
  P4 output → re-run policy → re-run safety → change decision
```

The producer has **zero** evaluation logic: no eligibility, no selection, no
suppression computation, no safety, no approval, no permission decision. It
normalizes declared facts into the frozen record shape and commits.

## 8. Decision Identity (follows FROZEN P5-02 AD-013 / AD-018)

The frozen contract governs identity semantics; P5-10 does not invent a
scheme (owner decision Q2, recorded in §33.7).

- `decisionId` = **identity of one decision evaluation** (P5-02 §12.1
  AD-013): one decision, decision lifetime, used by audit, approval binding
  and replay.
- **Uniqueness / determinism (P5-02 §12.2, AD-018 — FROZEN):** a decision
  is unique over *subject identity + decision context (p4 snapshot ref) +
  policy version + action model version*. Re-evaluating the **same** tuple
  ⇒ the **same** decision. Two distinct decision events therefore
  necessarily have distinct tuples (a new policy version, a new snapshot /
  asOf, or a different decision context) — the producer derives identity
  from the tuple the P5-03 evaluation actually used, so distinct events
  stay distinct and identical evaluations stay identical.
- **Three-way separation (frozen):** decision identity ≠ idempotency key ≠
  content hash.
  - `idempotencyKey` is a separate conceptual command-layer identity
    (P5-02 §12.1, §17 AD-018) — duplicate suppression for commands, owned
    by the P5-03/05 command layer, **not** by the producer.
  - A composite hash for decision identity is explicitly **not defined**
    (P5-02 §12.2); `contentHash` applies to the P4 snapshot payload only
    (AD-014, PROVISIONAL).
- `decisionId` is generated once at `buildDecision` from the frozen tuple,
  preserved unchanged through recorder → store → replay, and never derived
  from *current* narrative or *current* P4 state.
- The exact generation mechanism is chosen at implementation and must
  satisfy AD-013/AD-018. The deterministic-per-input question is resolved
  **by the contract** (same tuple ⇒ same decision), not by a
  producer-chosen hash; the earlier `{…}:{seq}` proposal (DR-P5-10-01) is
  superseded — a per-commit sequence would break AD-018 determinism.

## 9. P4 Snapshot Rule (anti-drift)

- If P4 provided `p4SnapshotRef`-equivalent fields, the producer records
  **exactly that reference** — identity, `asOf`, version tuple, status.
- **Never** `P4 V1 → producer queries P4 → gets V2 → stores V2`.
- Rule: *P5 records what the producer actually consumed, not what P4 happens
  to say now.*
- Actual P4 vocabulary (repo): status ∈ `OK | DEGRADED | NO_EVIDENCE | ERROR`;
  direction may be `UNKNOWN`; degradation reasons are carried in
  `provenance.degradation`. The producer preserves these verbatim. (`STALE`
  / `NULL` are not emitted by the current P4 view model; if a future P4 emits
  them, they are preserved the same way — never collapsed.)

## 10. P5DecisionRecord Construction (field mapping)

Field names below are the **actual frozen repo names** (`src/lib/p5/types.ts`);
the producer maps 1:1 and adds no new fields.

| Record field | Source (input contract) | Rule |
|---|---|---|
| `decisionId` | generated once (§8) | stable, unique |
| `candidateId` | declared candidate identity (P5-03) | null when none |
| `actionId` | declared action identity | non-null iff outcome SELECTED (P5-02 AD-013) |
| `subject.narrativeId` | `p4.narrativeIdentity.narrativeId` | 1:1 |
| `outcome` | declared policy outcome ONLY | never derived from P4 |
| `suppressed` | declared suppression fact (P5-03 PD-019) | never computed |
| `blockerReport` | declared blocker (source POLICY/SAFETY/APPROVAL + ref/version/at/reason) | 3-way distinct |
| `actionType` | declared ActionType (P5-02 AD-005 taxonomy) | null unless declared |
| `parameters` | declared parameters | null unless declared |
| `decisionState` | declared | orthogonal (DECIDED/CANCELLED/SUPERSEDED/EXPIRED) |
| `approvalState` | declared approval record state | absent ≠ DENIED; ack ≠ approval |
| `executionState` | declared execution evidence | NOT_APPLICABLE unless real evidence |
| `approvalRecord` | declared approval record | absent when no evidence |
| `safetyResult` | declared safety result (guardrail results verbatim) | never re-evaluated |
| `permissionResult` | declared permission result | GRANTED only on real record; permission ≠ executed |
| `explanation` | derived from the assembled record's recorded facts (what/why/basedOn/policy/safety/approval/currentState/whatDidNotHappen) | explanation ≠ decision; LLM may render only |
| `provenance` | p4SnapshotRef (from consumed P4), policy ref/version, guardrail ref, approval ref, automationMode ADVISORY, versions, timestamps | all from recorded inputs |
| `auditEvents` | declared audit events + producer lifecycle events (§16) | append-only |

## 11. Commit Boundary

```
const decision = producer.buildDecision(input);   // assemble ONLY — no recording
await producer.commitDecision(decision);           // → P5ArtifactRecorder.record({ decision, permission? })
```

- `buildDecision` never records; `commitDecision` is the single commit point.
- No partial recording during build; the recorder's per-artifact summary
  (`P5RecordingResult`) is returned from `commitDecision` and surfaces
  partial/failed states (§17).
- The producer core imports **no** drizzle, pg, schema, store, resolver, or
  engine (§13).

## 12. Recorder Integration

- `commitDecision(record)` → `P5ArtifactRecorder.record({ decision, permission? })`.
- Production wiring: a `production.ts` in `src/lib/p5/producer/` binds the
  producer to `pgHistoricalArtifactRecorder` (itself bound to the frozen
  writer). Unit tests inject an in-memory row store via the frozen
  store/writer pair (P5-08/09 pattern).
- The recorder is idempotent (unique `identity_key` + `onConflictDoNothing`):
  the same decisionId can never create a second historical decision.

## 13. Producer Dependency Boundary (imports)

Allowed imports: P5 types, P4 types, the frozen recorder interface/module.
**Forbidden imports in producer core:** `drizzle-orm`, `pg`, `@/db/schema`,
`HistoricalArtifactStore`, `ArtifactResolver`, `ReplayEngine`, `@/db`.
(Verified by test: producer module graph contains none of these.)

## 14. Missing Data, UNKNOWN / DEGRADED

| Situation | Producer behavior |
|---|---|
| No approval evidence | `approvalRecord` absent; `approvalState` = NOT_REQUIRED/REQUIRED per declared facts — never `DENIED` |
| No permission evidence | no permission artifact; `permissionResult` = NOT_APPLICABLE/UNAVAILABLE per declared facts — never fabricated GRANTED/DENIED |
| P4 status DEGRADED / NO_EVIDENCE / ERROR, direction UNKNOWN | preserved verbatim in snapshot ref/status — never converted to NO_ACTION/FAILED |
| No policy evaluation result | producer cannot construct a complete decision → **refuse/fail recording** (never auto-NO_ACTION, never auto-NOT_DETERMINED — NOT_DETERMINED only from a P5-03 evaluation that returned it with a reason) |
| No execution evidence | `executionState = NOT_APPLICABLE`; no fake execution events |

Forbidden collapses (semantic matrix, §19): UNKNOWN → NO_ACTION, DEGRADED →
NO_ACTION, SAFETY-BLOCKED → NO_ACTION, APPROVAL-DENIED → NO_ACTION,
POLICY-BLOCKED → NO_ACTION, ABSENT → NO_ACTION.

## 15. Approval / Permission / Execution Boundaries

- `acknowledged ≠ approved` — the producer never promotes an acknowledgement
  into `APPROVED`.
- `APPROVED ≠ EXECUTION_PERMISSION_GRANTED ≠ EXECUTED` — three separate
  layers; the producer preserves each only from real evidence.
- Execution: only `executionState`/`executionResult` from real evidence;
  expected v1 production behavior `executionState = NOT_APPLICABLE`.

## 16. Explanation & Audit Boundaries

- Explanation slots are populated from the assembled record's recorded facts
  (P5-05 contract). LLM, if used, renders only — structured data stays
  authoritative; the LLM never decides outcome.
- Audit events come from actual producer lifecycle: e.g. `DECISION_CREATED`
  (build), `DECISION_SELECTED`/`DECISION_BLOCKED`/`DECISION_SUPPRESSED`
  (outcome finalized), plus the P5-05 runtime events (approval/permission).
  The frozen P5-05 §16.1 core vocabulary is reused verbatim; the taxonomy is
  **not extended** (owner Q4).
- **Recorder persistence is NOT a domain lifecycle event:**
  `P5ArtifactRecorder.record() → persist artifacts` is a persistence-level
  fact. No `ARTIFACT_RECORDED` (or similar) event is added — the frozen
  taxonomy stays unchanged.

## 17. Idempotency & Atomicity

- **Idempotent:** same decisionId + same artifact identity ⇒ recorder
  ignores duplicates; the original historical artifact stays authoritative;
  no UPDATE of history; corrections are new artifacts/events.
- **Atomicity (inherited limitation):** the frozen `P5RowStore` has no
  multi-artifact transaction. The producer therefore never claims atomicity —
  `commitDecision` returns the recorder's per-artifact summary
  (complete / partial / failed). This is **recording infrastructure status**,
  never a DecisionOutcome.

## 18. Error Handling

| Failure | Producer behavior |
|---|---|
| `buildDecision` input invalid (missing narrative identity / malformed declared facts) | throw typed validation error; nothing recorded |
| `commitDecision` partial failure | returns partial summary; replay classifies missing artifacts → `REPLAY_UNAVAILABLE` |
| Recorder/writer failure | error propagates to caller; no partial "complete" record claim |
| P4 unavailable at the integration point | apply STOP-01: report dependency; do not fabricate a snapshot |

## 19. Semantic Matrix (required test cases)

| Input semantic (declared) | P5 output | Allowed |
|---|---|---|
| NO_ACTION | NO_ACTION | YES |
| POLICY_BLOCKED | POLICY_BLOCKED | YES |
| SAFETY_BLOCKED | SAFETY_BLOCKED | YES |
| APPROVAL_DENIED | APPROVAL_DENIED | YES |
| NOT_DETERMINED | NOT_DETERMINED | YES |
| SUPPRESSED | SUPPRESSED | YES |
| SELECTED | SELECTED | YES |
| ELIGIBLE | ELIGIBLE (orthogonal) | YES |
| APPROVED | APPROVED (approvalState) | YES |
| SAFE | SAFE (safetyResult) | YES |
| EXECUTION_PERMISSION_GRANTED | EXECUTION_PERMISSION_GRANTED (permissionResult) | YES |
| EXECUTED | EXECUTED | only with actual evidence |
| FAILED | FAILED | only with actual evidence |
| UNKNOWN (P4 direction) | UNKNOWN (preserved) | YES |
| DEGRADED / NO_EVIDENCE (P4 status) | DEGRADED / NO_EVIDENCE (preserved) | YES |
| ABSENT (no evidence) | ABSENT / absence preserved | YES |

Forbidden: UNKNOWN → NO_ACTION; DEGRADED → NO_ACTION; SAFETY_BLOCKED →
NO_ACTION; APPROVAL_DENIED → NO_ACTION; POLICY_BLOCKED → NO_ACTION;
ABSENT → NO_ACTION.

## 20. Test Matrix (P5-10.05)

| Case | Expected |
|---|---|
| SELECTED | record.outcome = SELECTED; actionId present (AD-013) |
| NO_ACTION | outcome = NO_ACTION; actionId null |
| POLICY_BLOCKED | outcome BLOCKED + blockerReport.source = POLICY + rule ref |
| SAFETY_BLOCKED | outcome BLOCKED + blockerReport.source = SAFETY + guardrail ref |
| APPROVAL_DENIED | outcome BLOCKED + blockerReport.source = APPROVAL + approval ref |
| NOT_DETERMINED | outcome NOT_DETERMINED; reason preserved |
| SUPPRESSED | suppressed = true; never NO_ACTION |
| ELIGIBLE / APPROVED / SAFE | orthogonal fields preserved, never collapsed |
| permission granted | permissionResult preserved; executionState stays NOT_APPLICABLE unless evidence |
| execution | NOT_APPLICABLE unless real execution evidence |

## 21. Certification Flow (P5-10.06)

Test with a complete fixture:

```
P4 fixture (P4DecisionSupportViewModel)
  ↓ P5 producer (declared inputs supplied)
  P5DecisionRecord
  ↓ P5ArtifactRecorder
  persisted p5_* artifacts (row-store port)
  ↓ PgHistoricalArtifactStore
  ↓ ArtifactResolver
  ↓ ReplayEngine
  P5ReplayReport
```

Expected with a complete fixture: `REPLAY_COMPLETE`, `EXACT`, snapshot
`SNAPSHOT_MATCH`, policy `FOUND`, zero side effects.

## 22. Anti-Drift / Mutation / Idempotency Tests (P5-10.07)

- **A. Live P4 changes after decision** — replay returns the recorded
  snapshot (V1), not the new live V2; live data only as labeled
  `LIVE_CONTEXT`.
- **B. Duplicate producer call** — no duplicate artifacts; first record
  authoritative (byte-identical rows).
- **C. Historical mutation** — UPDATE/DELETE blocked (store surface has no
  update/delete; DB triggers reject).
- **D. Wrong version** — replay reports `VERSION_MISMATCH`, never
  latest/current.
- **E. Missing artifact** — replay reports `REPLAY_UNAVAILABLE` with
  artifact classification, never `NO_ACTION` / `NOT_DETERMINED`.

## 23. Regression

Run: all P5 tests (incl. replay + P5-09 recorder + certification), P4 tests,
API/UI tests, `npx tsc --noEmit`. P3 failures (7 suites / 16 tests,
`db.select is not a function` mock drift) are pre-existing and untouched.
No new failure is acceptable.

## 24. Proposed File Structure

Repo has no producer yet; following the P5-09/record pattern:

```
src/lib/p5/producer/
├── types.ts                        // P5ProducerInput + P5ProducerOptions
├── p5-decision-producer.ts         // P5DecisionProducer (build/commit)
├── production.ts                   // binds to pgHistoricalArtifactRecorder
└── __tests__/
    ├── producer.test.ts            // build/commit contract
    ├── semantics.test.ts           // §19 semantic matrix
    ├── recording.test.ts           // recorder integration, idempotency, partial visibility
    └── certification.test.ts       // §21 + §22 (anti-drift, mutation, version, missing)
```

Exact names may follow repo convention; the structure above is the intent.

## 25. Task Breakdown (single P5-10 document)

| Step | Deliverable |
|---|---|
| P5-10.01 Reconnaissance | verify contracts + sources; this document exists from the start |
| P5-10.02 P4 integration point | identify P4 input/output/snapshot/provenance; STOP if incompatible |
| P5-10.03 Producer contract adapter | `src/lib/p5/producer/` — no DB/replay/API access |
| P5-10.04 Commit + recorder integration | `commitDecision` → `P5ArtifactRecorder.record`; production wiring |
| P5-10.05 Semantic test matrix | §19/§20 |
| P5-10.06 Historical recording certification | §21 |
| P5-10.07 Anti-drift / mutation / idempotency | §22 |
| P5-10.08 Full regression + audit + doc | §23 + scans (BUY/SELL/score/threshold/ORDER/TRADE/EXECUTE/RETRY) |

## 26. Known Limitations & Dependencies

1. **P5-03/04/05 runtime engines are contract-only** — the producer consumes
   `P5PolicyEvaluationResult` + P5-04/05 outputs **only**; without a policy
   evaluation result it refuses to record. No production caller is wired
   until the upstream P5-03 → P5-04 → P5-05 runtime chain exists (owner
   Q1/Q5). This is a downstream dependency, not a P5-10 defect.
2. **No multi-artifact transaction** on the frozen `P5RowStore` port —
   partial recording is visible via the recorder summary (§17).
3. **Permission artifact ref gap** (P5-08 §10) — permission is
   producer-supplied only, never derived.
4. **contentHash** stays PROVISIONAL (P5-02 AD-014) — recorded as null.
5. **Audit taxonomy** — only the frozen P5-05 §16.1 core events are used;
   no extension without upstream freeze.
6. **No API/UI** — not required for P5-10.

## 27. Acceptance Criteria (AC-01 … AC-30)

| # | Criterion |
|---|---|
| AC-01 | Real runtime producer exists (`P5DecisionProducer`) |
| AC-02 | Produces `P5DecisionRecord` per the frozen contract |
| AC-03 | Consumes real P4 output shape (no fake data) |
| AC-04 | `decisionId` stable + unique, generated once |
| AC-05 | P4 snapshot provenance preserved |
| AC-06 | Policy provenance preserved |
| AC-07 | Safety/guardrail provenance preserved |
| AC-08 | Approval state never inferred |
| AC-09 | Permission state never inferred |
| AC-10 | Execution state never inferred |
| AC-11 | Audit evidence preserved |
| AC-12 | Recorder called at commit boundary only |
| AC-13 | No DB access from producer core |
| AC-14 | No new decision engine |
| AC-15 | No score |
| AC-16 | No threshold |
| AC-17 | No BUY/SELL |
| AC-18 | No execution |
| AC-19 | No replay invocation in producer |
| AC-20 | Duplicate recording idempotent |
| AC-21 | Historical artifacts immutable |
| AC-22 | Full end-to-end replay = REPLAY_COMPLETE with complete fixture |
| AC-23 | Missing artifact → REPLAY_UNAVAILABLE |
| AC-24 | Wrong version → VERSION_MISMATCH |
| AC-25 | Historical snapshot beats live snapshot |
| AC-26 | No semantic collapse |
| AC-27 | P4 regression zero |
| AC-28 | P5 regression zero |
| AC-29 | TypeScript clean |
| AC-30 | P5-10 doc complete with implementation + evidence |

## 28. Freeze Audit (30 gates — run at implementation end; final promotion is a separate gate task)

| # | Gate |
|---|---|
| G1 | P4 boundary preserved |
| G2 | P5-02 compatibility |
| G3 | P5-03 compatibility |
| G4 | P5-04 compatibility |
| G5 | P5-05 compatibility |
| G6 | Real P4 integration |
| G7 | Real P5 producer exists |
| G8 | P5DecisionRecord exact contract |
| G9 | Stable decisionId |
| G10 | Single commit boundary |
| G11 | NO_ACTION semantics |
| G12 | BLOCKED three-way distinction |
| G13 | UNKNOWN/DEGRADED preservation |
| G14 | ELIGIBLE/SAFE/APPROVED separation |
| G15 | Permission ≠ execution |
| G16 | Ack ≠ approval |
| G17 | P4 snapshot provenance |
| G18 | Policy provenance |
| G19 | Safety/guardrail provenance |
| G20 | Approval provenance |
| G21 | Audit provenance |
| G22 | Recorder integration |
| G23 | Idempotency |
| G24 | Immutability |
| G25 | Partial-recording visibility |
| G26 | REPLAY_COMPLETE certification |
| G27 | Anti-drift / historical-over-live |
| G28 | Version/missing artifact behavior |
| G29 | No hidden decision/execution engine |
| G30 | Regression + implementation discipline |

## 29. STOP Conditions (strictest rule)

STOP — do not self-fix upstream — and report to the owner with the exact
contradiction, affected contract, and evidence, if implementation discovers:

- **STOP-01** — P4 does not provide the output needed for the integration
  point.
- **STOP-02** — `P5DecisionRecord` contract contradicts P5-03/04/05.
- **STOP-03** — need to invent a new semantic to make implementation work.
- **STOP-04** — need to modify P5-02 … P5-09 to bypass a contract.
- **STOP-05** — need to add score/threshold.
- **STOP-06** — need to create BUY/SELL mapping.
- **STOP-07** — need to re-run policy/safety inside the producer.
- **STOP-08** — need to use live P4 instead of the historical snapshot.
- **STOP-09** — need to modify a historical artifact.
- **STOP-10** — need to create an execution side effect.

Never "fix it to make it run" by violating a frozen contract.

## 30. Git Boundary

- **This document (draft):** `docs/P5_Upgrade/P5-10_PRODUCTION_DECISION_PRODUCER.md` — new.
- **Implementation task (future):** `src/lib/p5/producer/**` + this document
  updated with evidence (§27/§28).
- **Pre-existing dirty (untouched):** `P5_MASTER_SPECIFICATION.md`,
  `package-lock.json`, `tsconfig.tsbuildinfo`, `src/app/narrative/[id]/page.tsx`,
  `src/db/schema.ts`, migration 0021, P5-01…P5-09 docs + P5 sources.
- No commit unless explicitly requested.

## 31. Freeze Rules & Final Freeze Statement

- The implementation task ends **IMPLEMENTATION COMPLETE — READY FOR OWNER
  REVIEW**. It does **not** self-declare FROZEN.
- A separate **P5-10 Final Revision / Freeze** task promotes to
  **FROZEN / APPROVED FOR DOWNSTREAM** (unless the owner explicitly asks for
  implementation + freeze in one task).
- Freeze statement (to be finalized at that gate): *P5-10 freezes the
  runtime decision-producer/commit infrastructure. It does not implement the
  P5-03/04 runtime engines; full production decisions remain dependent on
  declared upstream evaluations (downstream dependency).* Nothing
  PROVISIONAL / OPEN / CANDIDATE is promoted.

## 32. Revision Record

| Rev | Date | Change |
|---|---|---|
| R1 | 2026-08-17 | Draft created from the owner's P5-10 draft, grounded in verified repo state (P4 runtime output contract, P5-09 recorder, P5-08 store/writer, producer absence) |
| R2 | 2026-08-17 | Reconnaissance completed from source (P4 output contract, P5DecisionRecord required fields, runtime P5-03/04/05 absence, callers); **STOP triggered per §30/§29** — P4/P5 runtime lacks the required producer inputs. STOP Report appended (§33). No production code changed. |
| R3 | 2026-08-17 | Owner decisions Q1–Q5 recorded (§33.7): caller = runtime P5 pipeline; decisionId per FROZEN AD-013/AD-018 (three-way separation, no producer hash); no self-NOT_DETERMINED (refuse without `P5PolicyEvaluationResult`); no new audit events; no wiring until upstream chain exists. §5/§8/§14/§16/§26/§33.6 updated to match. No production code changed. |
| R4 | 2026-08-17 | UNBLOCK task: dependency matrix + field trace (A/B/C/D) + decision identity review (AD-013/AD-018 determine, no ambiguity) + minimum runtime-chain plan (P5-03-RT → P5-04-RT → P5-05-RT → P5-10) + recommended next task + non-actions + unblock criteria (§34). Status: BLOCKED BY UPSTREAM RUNTIME DEPENDENCY. No production code written. |

---

# §33. STOP REPORT — RECONNAISSANCE FINDINGS

**STOP per P5-10 §30 and the STOP conditions:** the current runtime does not
provide enough contract to construct a contract-compliant `P5DecisionRecord`.
Per the owner's explicit rule — *"if the Agent finds that the current P4
runtime does not have enough contract to create a P5DecisionRecord, the Agent
is NOT allowed to fabricate a producer to make tests green — STOP and report
the dependency/contradiction"* — implementation is **NOT STARTED**. No
production code was changed; nothing was fabricated.

## 33.1 What the runtime provides (verified from source)

**P4 runtime exists** (`src/lib/p4/service.ts`):
`getP4DecisionSupport(narrativeId) → P4DecisionSupportViewModel | null`
(read-time derived; callers: `src/app/api/narratives/[id]/route.ts`, P5-06
`action-read.service.ts` for LIVE_P4_CONTEXT presentation only).

`P4DecisionSupportViewModel` (`src/lib/p4/types.ts`) provides:
`status (OK|DEGRADED|NO_EVIDENCE|ERROR)`, `version` (algorithmVersion /
semanticVersion / signalCatalogVersion), `narrativeIdentity` (narrativeId /
window / algorithmKey / algorithmVersion / calculationMode), `asOf`,
`direction`, `signals`, `opportunity/risk/confidence/actionability`
(qualitative), `explanation` (+ attribution incl. `interpretationRuleVersion`),
`evidence`, `historicalContext`, `provenance` (+ `degradation`).

**This is interpretation evidence — not a P5 decision.**

## 33.2 What `P5DecisionRecord` requires (verified from source)

`P5DecisionRecord` (`src/lib/p5/types.ts`) requires, among others:

- `outcome: P5DecisionOutcome` (SELECTED | NO_ACTION | BLOCKED |
  NOT_DETERMINED) — produced **only** by a P5-03 policy evaluation;
- policy provenance (`policyId`, `policyVersion`, `effectiveAt`,
  `evaluationAt`, `ruleRefs`);
- `safetyResult` / guardrail results (P5-04);
- `approvalRecord` + `approvalState` (P5-04);
- `permissionResult` (P5-04 SG-011);
- `explanation` slots + `auditEvents` (P5-05).

## 33.3 The dependency (exact)

| Required input | Runtime source | Status |
|---|---|---|
| Policy outcome + policy provenance | P5-03 policy engine | **NOT AVAILABLE** (contract-only) |
| Safety / guardrail results | P5-04 engine | **NOT AVAILABLE** (contract-only) |
| Approval record / approval state | P5-04 engine | **NOT AVAILABLE** (contract-only) |
| Permission result | P5-04 engine | **NOT AVAILABLE** (contract-only) |
| Explanation / audit events | P5-05 engine | **NOT AVAILABLE** (contract-only) |
| P4 snapshot / interpretation evidence | `getP4DecisionSupport` | **AVAILABLE** (runtime) |

A producer that emits a complete `P5DecisionRecord` today would have to
derive the outcome from P4's `direction/confidence/opportunity/actionability`
— exactly the hidden decision engine / P4 re-interpretation forbidden by
P5-02 (AD-004 outcome ownership), P5-03 (evaluation is the sole outcome
source), P5-04 (safety/approval/permission ownership), P5-05 (no hidden
score; explanation ≠ decision), the BUY/SELL firewall and the P4-06
independence rule. The P5-06 `LIVE_P4_CONTEXT` read path is presentation-only
and explicitly not a decision basis.

## 33.4 Affected contracts

P5-02 (outcome vocabulary ownership), P5-03 (policy evaluation = sole outcome
source), P5-04 (safety/approval/permission), P5-05 (explanation/audit),
P5-10 (producer input contract). No contradiction among them — the gap is a
**missing runtime upstream**, not a contract conflict.

## 33.5 Evidence

- `src/lib/p4/types.ts` — `P4DecisionSupportViewModel` fields (§33.1).
- `src/lib/p4/service.ts:133` — `getP4DecisionSupport` (read-time derived).
- `src/lib/p5/types.ts` — `P5DecisionRecord` required fields (§33.2).
- `grep` — no runtime code constructs a `P5DecisionRecord`;
  `P5ArtifactRecorder`/writer referenced only by their own modules + tests;
  `src/lib/p5/` contains read/record/replay only (no P5-03/04/05 engine).
- `src/lib/p5/read/action-read.service.ts` — LIVE_P4_CONTEXT is presentation
  only, never a decision basis.

## 33.6 Minimal owner decision required

- **Option A (owner-confirmed via Q1/Q5):** implement the P5-03 policy
  evaluation runtime first (then P5-04/05 outputs as produced); P5-10 is
  then wired to consume the runtime chain and the production caller is added
  only after it exists. Design is ready (§5–§17).
- **Option B (rejected by owner Q3/Q5):** a producer that self-derives
  outcomes from P4 or declared synthetic inputs — a hidden decision engine;
  not allowed.
- **Option C (dormant):** P5-10 contract adapter implemented, un-wired, no
  production caller — partial; still needs Option A for the runtime
  milestone.

Per the owner's answers (Q1–Q5, §33.7), implementation proceeds under
Option A semantics once assigned. No producer code, no tests, no frozen
contract changes were made.

## 33.7 Owner Decisions (Q1–Q5, 2026-08-17)

| # | Question | Owner decision | Contract grounding |
|---|---|---|---|
| Q1 | Who supplies the policy outcome? | No producer-declared outcomes. The caller is the **runtime P5 decision pipeline**: P5-03 policy evaluation → P5-04 safety/approval/permission → P5-05 explanation/audit → P5-10 producer. P5-10 never turns P4 direction/confidence/actionability into an outcome (absolute). | P5-02 AD-004 (outcome ownership), P5-03 (evaluation = sole outcome source), P5-04, P5-05 |
| Q2 | decisionId semantics | decisionId = **identity of one decision evaluation**; separate **decision identity ≠ idempotency key ≠ content hash**. Deterministic-per-input not self-decided; follow the frozen contract. | **P5-02 AD-013 §12.1, AD-018 §12.2 (FROZEN):** unique over (subject identity + p4 snapshot ref + policy version + action model version); same tuple ⇒ same decision; composite hash for decision identity NOT defined; contentHash applies to snapshot payload only (AD-014) |
| Q3 | No policy evaluation → NOT_DETERMINED? | **No self-mapping.** NOT_DETERMINED is a domain outcome, not a generic error. P5-10 only consumes `P5PolicyEvaluationResult`; without it the producer cannot construct a complete decision and must fail/refuse recording. | P5-03: technical failure / unusable inputs ⇒ NOT_DETERMINED + reason — a **P5-03 engine output**, never a producer choice |
| Q4 | Audit taxonomy / ARTIFACT_RECORDED? | **No new event.** Recorder persistence (`record() → persist artifacts`) is persistence-level, not a domain lifecycle event. Frozen P5-05 §16.1 taxonomy unchanged. | P5-05 §16.1 (frozen core vocabulary) |
| Q5 | Wire into P4 narrative API now? | **No.** Wiring now would force the producer to resolve nonexistent upstream outputs (scope creep). Wire the production caller only after the P5-03 → P5-04 → P5-05 runtime chain exists. | STOP-01/03 discipline; P5-03/04/05 contract-only status (§33.3) |

**Consequence for implementation (when assigned):** producer consumes
`P5ProducerInput` (P4 snapshot + `P5PolicyEvaluationResult` + P5-04/05
outputs); refuses to record without a policy evaluation result; decisionId
per AD-013/AD-018; no new audit events; no production caller wiring until
the upstream chain exists.

---

# §34. UPSTREAM RUNTIME DEPENDENCY RESOLUTION (R4)

Task: P5-10 UNBLOCK — resolve the upstream dependency in the smallest
contract-faithful way. Per the task rules, P5-10 implementation is **NOT
forced**; the contract is verified and the minimum runtime chain is planned.
**No production code was written.**

## 34.1 Exact Blocker

The frozen contracts are internally consistent, but the runtime chain that
must feed P5-10 does not exist:

```
P3 runtime (P3IntelligenceViewModel)        — EXISTS
   ↓
P4 runtime (P4DecisionSupportViewModel)     — EXISTS (read-time derived)
   ↓
P5-03 runtime (policy evaluation)           — MISSING (contract-only)
   ↓
P5-04 runtime (safety/approval/permission)  — MISSING (contract-only)
   ↓
P5-05 runtime (explanation/audit)           — MISSING (contract-only)
   ↓
P5-10 producer                              — MISSING (this task, blocked)
   ↓
P5-09 recorder / P5-08 store / P5-07 replay — FROZEN, EXISTS
```

## 34.2 Evidence (verified from source)

| Fact | Evidence |
|---|---|
| P4 runtime exists | `src/lib/p4/service.ts:133` `getP4DecisionSupport(narrativeId)`; callers: narrative API route, P5-06 read service (LIVE_P4_CONTEXT only) |
| P4 output = interpretation only | `P4DecisionSupportViewModel` (`src/lib/p4/types.ts:280`): status, narrativeIdentity, asOf, version, direction, signals, O/R/C/A, explanation, evidence, provenance — no P5 outcome |
| P5-03 output contract | P5-03: policy outcome (AD-004) + eligibility + selection + suppression + blocker; deterministic (PD-010); `ELIGIBLE` is a policy evaluation result, not a state dimension |
| P5-04 output contract | P5-04: safety record `{ actionRef, guardrailResults[], … }`, approval record (no IAM impl), permission record (SG-011; v1 NOT_GRANTED) |
| P5-05 output contract | P5-05: explanation slots (§6) derived from recorded facts; audit events (§16.1 frozen vocabulary) |
| No runtime constructs a P5DecisionRecord | grep — `P5DecisionRecord` referenced only by types/infrastructure/tests |
| No runtime P5-03/04/05 | `src/lib/p5/` contains read/record/replay only; `src/lib/p3/**` is the P3 intelligence layer (regime/leadership/rotation), not a P5 policy engine |
| Only legacy rule runtime exists — excluded | `src/lib/services/rule-version.service.ts` (P1 rule versions, `recommendationThresholds` 90/80/65, STRONG_WATCH/WATCH signals) — legacy vocabulary per P5-01 reuse matrix / P5-05 C-003; NOT reusable as P5-03 |

## 34.3 P5DecisionRecord Field Trace (A/B/C/D)

| Field (`src/lib/p5/types.ts`) | A: runtime now | B: contract requires producer | C: optional/nullable | D: impossible now |
|---|---|---|---|---|
| `decisionId` | — | generated at build per AD-013/018 | — | — |
| `candidateId` | — | P5-03 candidate | — | D (no P5-03 runtime) |
| `actionId` | — | P5-02 AD-013 (iff SELECTED) | — | D |
| `subject.narrativeId` | **A** (from P4 narrativeIdentity) | — | — | — |
| `outcome` | — | P5-03 policy outcome | — | **D** |
| `suppressed` | — | P5-03 PD-019 | — | D |
| `blockerReport` | — | P5-03/04 blocker | — | D |
| `actionType` | — | P5-02 AD-005 (selected by P5-03) | — | D |
| `decisionState` | — | P5-02 AD-009 | — | D |
| `approvalState` | — | P5-04 | — | D |
| `executionState` | — | P5-04/AD-009 | C (NOT_APPLICABLE default) | — |
| `approvalRecord` | — | P5-04 | — | D |
| `safetyResult` | — | P5-04 | — | D |
| `permissionResult` | — | P5-04 SG-011 | — | D |
| `explanation` | — | P5-05 | — | D |
| `provenance.p4SnapshotRef` | **A** (from consumed P4 output) | — | — | — |
| `provenance.policy` | — | P5-03 | — | D |
| `provenance.safety/approval` | — | P5-04 | — | D |
| `provenance.versions/timestamps` | **A** (assembled at build) | — | — | — |
| `auditEvents` | — | P5-05 | — | D |

Only P4-derived fields (subject, snapshot ref, timestamps) are runtime-
available today. **All decision-semantic fields are category D** — they require
P5-03/04/05 runtime outputs that do not exist.

## 34.4 Decision Identity Review (Phase 3)

Frozen contract **fully determines** identity semantics — no ambiguity, no
STOP needed on this axis:

- `decisionId` = identity of one decision evaluation (P5-02 AD-013 §12.1).
- Uniqueness/determinism: unique over (subject identity + p4 snapshot ref +
  policy version + action model version); same tuple ⇒ same decision
  (AD-018 §12.2, FROZEN).
- `idempotencyKey` = separate conceptual command-layer identity (AD-013
  §12.1, §17) — owned by P5-03/05 command layer, not the producer.
- `identity_key` (P5-08 storage) = the persisted exact-identity key, derived
  per artifact; not a decision-semantic identity.
- `contentHash` = snapshot payload integrity only (AD-014, PROVISIONAL) —
  a composite hash for decision identity is explicitly NOT defined
  (AD-018 §12.2).
- Consequence: producer derives decisionId from the frozen tuple of the
  evaluation it consumed; distinct decision events require distinct tuples
  (recorded in §8, §33.7 Q2).

## 34.5 Minimum Runtime Chain — Implementation Units

| Unit | Exact input | Exact output | Frozen contract | Reusable code | Minimal new code | Caller | Persistence boundary | Forbidden scope |
|---|---|---|---|---|---|---|---|---|
| **P5-03-RT** policy evaluation runtime | ActionCandidate + P4 evidence (snapshot ref, Direction, O/R/C/A, signals, degradation — P5-03 §6) + policy ruleset (owner-approved, versioned) | PolicyEvaluationResult: outcome (AD-004) + eligibility + selection + suppression + blocker + policy provenance (policyId/version/ruleRefs) | P5-03 (PD-010 determinism, §34.3 outcome matrix, §33 records) | P5-02/P5-05 types (`P5DecisionOutcome`, `P5BlockerReport`); P4 view model | evaluation service + ruleset versioning (policy content is owner-approved business semantics — NOT invented here) | future P5 pipeline | writes NOTHING; P5-10 commits | legacy thresholds (P5-01 reuse matrix), scores, BUY/SELL, new ActionType |
| **P5-04-RT** safety/approval/permission runtime | selected decision + parameters | safety record `{actionRef, guardrailResults[]}` + approval record (no IAM) + permission record (SG-011) | P5-04 | `P5SafetyResult`, `P5ApprovalRecord`, `P5PermissionResult` | guardrail evaluation service (owner-approved guardrails) + approval/permission boundary | future P5 pipeline | writes NOTHING | approval inference, permission inference, execution, RBAC implementation |
| **P5-05-RT** explanation/audit runtime | decision record + P5-03/04 outputs | `P5ExplanationRecord` slots (§6) + audit events (frozen §16.1 vocabulary) | P5-05 | `P5ExplanationRecord`, `P5AuditEvent`, P4 explanation render patterns | explanation assembler (structured-facts-only; LLM render only) + audit emission | future P5 pipeline | writes NOTHING (audit persisted via P5-10 recorder) | new audit taxonomy, explanation ≠ decision |
| **P5-10** decision producer | P4 snapshot + P5-03/04/05 outputs (this doc §5–§17) | `P5DecisionRecord` → `P5ArtifactRecorder.record` | P5-02/03/04/05 + P5-09 recorder | recorder/writer/store/replay (frozen) | producer + production.ts wiring (dormant until caller exists) | P5-03/04/05 runtime chain | recorder (idempotent, immutable) | DB/drizzle access, replay invocation, outcome manufacture (§6) |

Order of implementation: **P5-03-RT → P5-04-RT → P5-05-RT → P5-10.** Each
unit ends READY FOR OWNER REVIEW; none self-freezes.

## 34.6 Recommended Next Task

**P5-03-RT — Policy Evaluation Runtime (v1).** It is the root of the chain
and unblocks everything downstream. Must include: owner-approved v1 policy
ruleset (policyId/version — business content, NOT invented by the agent),
deterministic evaluation (PD-010), versioned policy provenance, semantic
matrix tests (SELECTED/NO_ACTION/BLOCKED/NOT_DETERMINED/SUPPRESSED),
refusal semantics for missing/invalid inputs, and regression. After P5-03-RT
(+ P5-04-RT, P5-05-RT) exist, P5-10 can be implemented per §5–§17 and the
production caller wired only then (§33.7 Q5).

## 34.7 Explicit Non-Actions (this task)

- NO P5-10 producer code.
- NO fabricated P5-03/04/05 runtime outputs.
- NO adapter around the legacy P1 rule engine (excluded: legacy thresholds
  90/80/65, STRONG_WATCH/WATCH signals — P5-01 reuse matrix, P5-05 C-003).
- NO NOT_DETERMINED emission for missing upstream engines (§33.7 Q3).
- NO synthetic declared-input certification presented as production.
- NO wiring into the narrative API (§33.7 Q5).
- NO changes to P5-02 → P5-09, P4, P4-06.
- NO new types, taxonomy, scores, thresholds, or execution mechanics.

## 34.8 Acceptance Criteria for Unblocking

P5-10 implementation may begin only when:

1. P5-03-RT exists and produces a deterministic PolicyEvaluationResult
   (with policyId/version/ruleRefs) from real P4 evidence + an
   owner-approved ruleset — tested, READY FOR OWNER REVIEW.
2. P5-04-RT exists and produces safety/approval/permission records from
   real inputs — tested.
3. P5-05-RT exists and produces explanation/audit from recorded facts —
   tested.
4. Each unit has an explicit frozen-contract source and zero invented
   semantics.
5. Then P5-10 consumes the chain outputs per §6, certifies REPLAY_COMPLETE
   with a complete real input set, and only then a production caller is
   wired.

**Freeze:** not possible now — P5-10 has no implementation to freeze. The
freeze gate applies after P5-10 implementation (separate task).
