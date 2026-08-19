# P5 — Intelligence → Decision Support

## Baseline

**Project:** NarrativeHealth  
**Phase:** P5 — Intelligence → Decision Support  
**Status:** IMPLEMENTATION COMPLETE / BASELINE FROZEN  
**Date:** 2026-08-19  
**Real E2E Verification:** PENDING (environment blocker)

---

## 1. Architecture

```
P3 Intelligence
    ↓
P4 Decision Support
    ↓
P5-03 Policy Evaluation Runtime
    ↓
P5-04 Safety / Approval / Permission Runtime
    ↓
P5-05 Explanation / Audit Runtime
    ↓
P5-10 Decision Producer (assembly/composition)
    ↓
P5-09 Artifact Recorder
    ↓
PostgreSQL p5_* artifacts
    ↓
P5-08 Historical Artifact Store (read-only)
    ↓
P5-07 Replay
```

**Production caller:** `GET /api/narratives/[id]` via P5-11 Runtime Integration Adapter.

**Component responsibilities:**

- **P3 Intelligence** — Computes raw intelligence metrics (health scores, features, recommendations) for narratives and coins from market data.
- **P4 Decision Support** — Derives a decision-support ViewModel from P3 artifacts: direction, opportunity, risk, confidence, actionability, signals, explanation, and evidence references.
- **P5-03 Policy Evaluation** — Evaluates the P4 snapshot against the frozen V1 policy ruleset and produces a policy outcome (SELECTED / NO_ACTION / NOT_DETERMINED) with suppression and blocker information.
- **P5-04 Safety / Approval / Permission** — Independently evaluates safety (guardrails), approval state, and permission state orthogonal to the policy outcome. V1 produces: safety=PASS, approval=NOT_REQUIRED, permission=NOT_APPLICABLE for advisory actions.
- **P5-05 Explanation / Audit** — Constructs explanation records and audit events from upstream evaluation facts. Never creates decisions — only explains already-decided facts with full provenance.
- **P5-10 Decision Producer** — Assembly/composition boundary. Consumes P5-03/04/05 results and composes the immutable P5DecisionRecord. **Is NOT a decision engine.** Contains zero evaluation logic.
- **P5-09 Artifact Recorder** — Derives P5-07 historical artifacts from the decision record and persists them through the frozen writer boundary. Single commit point for all P5 persistence.
- **P5-08 Historical Artifact Store** — Read-only PostgreSQL-backed store implementing the P5-07 HistoricalArtifactStore interface. Insert-only writer stores artifacts idempotently via identity_key + onConflictDoNothing.
- **P5-07 Replay** — Resolves historical artifacts from the store and replays decisions without depending on live P4 state. Enforces historical-over-live boundary.
- **P5-11 Runtime Integration** — Orchestration adapter wiring P4 → P5-03 → P5-04 → P5-05 → P5-10 → P5-09 into a single pipeline invocation. **Is NOT a decision engine.** Contains zero evaluation logic.

---

## 2. Frozen Component Matrix

| Component | Source Path | Responsibility | Status | Contract Document |
|---|---|---|---|---|
| P5-03 | `src/lib/p5/policy/` | Policy evaluation (outcome) | FROZEN | P5-03_POLICY_RULESET_V1_CANDIDATE.md, P5-03-RT_IMPLEMENTATION.md |
| P5-04 | `src/lib/p5/safety/` | Safety / approval / permission | FROZEN | P5-04_SAFETY_GUARDRAIL_APPROVAL_ENGINE.md, P5-04-RT_IMPLEMENTATION.md |
| P5-05 | `src/lib/p5/explanation/` | Explanation / audit generation | FROZEN | P5-05_ACTION_EXPLANATION_AUDIT.md, P5-05-RT_IMPLEMENTATION.md |
| P5-07 | `src/lib/p5/replay/` | Historical replay / artifact resolution | FROZEN | P5-07_IMPLEMENTATION.md, P5-07_HISTORICAL_REPLAY_VALIDATION.md |
| P5-08 | `src/lib/p5/replay/pg-artifact-store.ts` | PostgreSQL artifact persistence | FROZEN | P5-08_HISTORICAL_ARTIFACT_PERSISTENCE.md |
| P5-09 | `src/lib/p5/record/` | Artifact recording (single commit) | FROZEN | P5-09_PRODUCTION_ARTIFACT_RECORDING_REPLAY_CERTIFICATION.md |
| P5-10 | `src/lib/p5/producer/` | Decision record assembly | FROZEN | P5-10_PRODUCTION_DECISION_PRODUCER.md |
| P5-11 | `src/lib/p5/integration/` | Runtime integration (orchestration) | FROZEN | P5-11_RUNTIME_INTEGRATION.md |
| P4 | `src/lib/p4/` | Decision Support ViewModel | FROZEN | P4-02, P4-03, P4-04 contracts |
| P3 | `src/lib/p3/` | Intelligence calculation | FROZEN | P3 contracts |

---

## 3. Decision Semantics Baseline

| Semantic Dimension | Authoritative Source | Frozen Vocabulary |
|---|---|---|
| **Outcome** | P5-03 ONLY | SELECTED, NO_ACTION, NOT_DETERMINED |
| **Safety** | P5-04 ONLY | PASS, BLOCK, NOT_DETERMINED |
| **Approval** | P5-04 ONLY | NOT_REQUIRED, REQUIRED, PENDING, APPROVED, DENIED, EXPIRED, REVOKED |
| **Permission** | P5-04 ONLY | GRANTED, NOT_GRANTED, NOT_APPLICABLE, UNAVAILABLE |
| **Explanation** | P5-05 ONLY | what, why, basedOn, policy, safety, approval, currentState, whatDidNotHappen |
| **Audit** | P5-05 ONLY | Frozen core vocabulary (P5-05 §16.1) |
| **Persistence** | P5-09 ONLY | Single commit boundary through P5ArtifactRecorder |
| **Replay** | P5-07 ONLY | Historical-over-live boundary enforced |
| **Orchestration** | P5-11 ONLY | P4 → P5-03 → P5-04 → P5-05 → P5-10 → P5-09 chain |

**P5-10 is assembly/composition infrastructure, NOT a decision engine.**  
It accepts already-evaluated upstream results, validates structural completeness, composes P5DecisionRecord, and commits through P5-09. Zero evaluation logic.

**P5-11 is orchestration, NOT a decision engine.**  
It wires frozen upstream components into a single pipeline. Zero evaluation logic.

---

## 4. Frozen V1 Outcome Surface

| Outcome | Source | V1 Behavior |
|---|---|---|
| SELECTED | P5-03 policy evaluation | Produced when policy rules select an action |
| NO_ACTION | P5-03 policy evaluation | Produced when no action is selected |
| NOT_DETERMINED | P5-03 policy evaluation | Produced when policy evaluation cannot determine outcome |

**V1 remains advisory-only under SG-010.**

Advisory actions (MONITOR, REVIEW, INVESTIGATE) always produce:
- safety = PASS
- approval = NOT_REQUIRED
- permission = NOT_APPLICABLE

Consequential actions (REDUCE_EXPOSURE, INCREASE_EXPOSURE, REBALANCE) produce:
- safety = PASS
- approval = NOT_REQUIRED
- permission = NOT_GRANTED (V1 has no concrete permission rules)

---

## 5. Identity Baseline

**decisionId** is deterministic according to AD-013 / AD-018:

```
decisionId = deterministic hash of identity tuple
           ≠ idempotencyKey
           ≠ contentHash
```

| Concept | Definition | Status |
|---|---|---|
| `decisionId` | Identifies a decision event; derived from identity tuple (AD-013/AD-018) | FROZEN |
| `idempotencyKey` | Stored as `identityKey` on all p5_* tables; same decisionId = same key | FROZEN |
| `contentHash` | Content hash of the P4 snapshot | **PROVISIONAL** (always null in V1) |

**contentHash is NOT part of decision identity in V1.** It is explicitly nullable and always recorded as null.

---

## 6. Provenance Baseline

Complete provenance chain:

```
P4 snapshot (narrativeIdentity + asOf + versionTuple)
    ↓
p4SnapshotRef (P5-02 AD-014)
    ↓
P5-03 policy provenance (policyId + policyVersion + effectiveAt + ruleRefs)
    ↓
P5-04 safety provenance (guardrailVersion)
    ↓
P5-05 explanation / provenance / audit (P5ProvenanceRecord)
    ↓
P5-10 P5DecisionRecord.provenance (composites all upstream)
    ↓
P5-09 artifact (persisted verbatim through PgHistoricalArtifactWriter)
```

**Historical decisions must be reconstructable from persisted artifacts without silently replacing historical facts with current live state.** This is enforced by the historical-over-live boundary in P5-07 Replay.

---

## 7. Safety / Approval / Permission Baseline

**Orthogonality preserved:**

| Separation | Meaning |
|---|---|
| Safety ≠ Approval | A safe action may still require approval |
| Approval ≠ Execution | Approved does not mean executed |
| Permission ≠ Execution | Permitted does not mean executed |
| Eligibility ≠ Selection | Eligible does not mean selected |
| SAFE ≠ APPROVED | Different orthogonal dimensions |
| SELECTED ≠ SAFE | Policy outcome independent of safety |

**V1 behavior:**

| Action Type | Safety | Approval | Permission |
|---|---|---|---|
| MONITOR (advisory) | PASS | NOT_REQUIRED | NOT_APPLICABLE |
| REVIEW (advisory) | PASS | NOT_REQUIRED | NOT_APPLICABLE |
| INVESTIGATE (advisory) | PASS | NOT_REQUIRED | NOT_APPLICABLE |
| REDUCE_EXPOSURE (consequential) | PASS | NOT_REQUIRED | NOT_GRANTED |
| INCREASE_EXPOSURE (consequential) | PASS | NOT_REQUIRED | NOT_GRANTED |
| REBALANCE (consequential) | PASS | NOT_REQUIRED | NOT_GRANTED |

**No execution semantics are frozen by P5.** V1 is advisory-only.

---

## 8. Persistence / Replay Baseline

**P5-09 Artifact Recorder:**
- Single commit boundary for all P5 artifacts
- Derives P5-07 historical artifacts from P5DecisionRecord verbatim
- No decision logic, no evaluation, no fabrication
- Persistence through PgHistoricalArtifactWriter

**P5-08 Historical Artifact Store:**
- Read-only store implementing HistoricalArtifactStore interface
- Insert-only writer: idempotent via identity_key + onConflictDoNothing
- No update/delete surface (DB triggers enforce immutability)
- Historical-over-live: reads only persisted artifacts, never live state

**P5-07 Replay:**
- Resolves artifacts from historical store
- Enforces historical-over-live boundary
- Deterministic identity preservation
- No dependency on live P4 state

---

## 9. Production Integration Baseline

**Production caller:** `GET /api/narratives/[id]`

**P5-11** is the sole integration boundary.

**Architectural characteristics:**
- The GET route materializes a deterministic, idempotent P5 decision artifact
- P5 failure degrades to null/error — never causes HTTP 500
- P5 is additive — never modifies P4 data or existing response shape
- No execution side effect exists
- No mutation API exists for P5 decisions
- Repeated GET with same inputs produces same decisionId; recorder ignores duplicates

---

## 10. Verification Baseline

| Verification | Result | Evidence |
|---|---|---|
| P5 regression | **258/258 PASS** | 12 test suites (npx jest --testPathPatterns="src/lib/p5") |
| P5-11 integration | **15/15 PASS** | adapter.test.ts |
| Typecheck | **tsc --noEmit = PASS** | Exit code 0 |
| Contract drift | **NONE** | Source-level verification vs frozen docs |
| Semantic leakage | **NONE** | Zero matches for BUY/SELL/LONG/SHORT/ORDER/TRADE/EXECUTE/score/ranking/threshold |
| Source modified during final verification | **ZERO** | Only documentation created |
| Real PostgreSQL E2E | **NOT VERIFIED** | Environment blocker — no live PostgreSQL with seeded P4 data |

**Do NOT equate source verification with real E2E.** Real E2E requires live PostgreSQL, running Next.js dev server, HTTP request with valid narrativeId, and SQL verification of p5_* artifact persistence.

---

## 11. Known Limitations

| # | Limitation | Severity | Impact on V1 |
|---|---|---|---|
| 1 | Real PostgreSQL E2E pending | MEDIUM | Cannot verify end-to-end persistence/replay |
| 2 | contentHash provisional | LOW | Always null; does not affect decision identity |
| 3 | Permission artifact gap (P5-08 §10) | LOW | No permission artifacts generated; by-design for V1 |
| 4 | V1 advisory-only | BY-DESIGN | No execution semantics in V1 scope |

---

## 12. Open / Provisional / Future

| Classification | Item | Status |
|---|---|---|
| **PROVISIONAL** | contentHash | Always null in V1; not part of decision identity |
| **OPEN** | Permission artifact gap | P5-08 §10; no concrete permission ruleset in V1 |
| **OPEN** | Real production E2E verification | Requires live PostgreSQL with seeded P4 data |
| **FUTURE** | Additional action types (EXECUTE, ESCALATE) | AD-006/AD-007 CANDIDATE; not in V1 scope |
| **FUTURE** | Execution semantics | Not frozen by P5; out of scope |
| **FUTURE** | RBAC / authority | Not in V1 scope |
| **FUTURE** | Scoring / ranking within P5 | Not in P5 scope |
| **FUTURE** | Advanced staleness / cooldown | Not in V1 scope |

**These are NOT implementation requirements for P5.** They are classified for future phase consideration only.

---

## 13. P5 Freeze Rule

**P5 frozen components must not be modified without an explicit new phase/change request.**

Any future change to P5-03/04/05/07/08/09/10/11 must be handled as:

1. A **new phase** (e.g. P5-V2, P6), OR
2. An **explicitly approved change request** with owner sign-off

Do not silently reopen P5. Do not treat closeout documentation as an opportunity to modify frozen behavior.

---

## 14. Traceability Matrix

| Concern | P5 Component | Contract / Document | Implementation Path |
|---|---|---|---|
| Outcome | P5-03 | P5-02 AD-004, P5-03 rules | `src/lib/p5/policy/evaluator.ts` |
| Eligibility | P5-03 | P5-03 policy rules | `src/lib/p5/policy/rules.ts` |
| Selection | P5-03 | P5-03 PD-018 | `src/lib/p5/policy/evaluator.ts` |
| Suppression | P5-03 | P5-03 PD-019 | `src/lib/p5/policy/evaluator.ts` |
| Safety | P5-04 | P5-04 SG-010/SG-011 | `src/lib/p5/safety/evaluator.ts` |
| Approval | P5-04 | P5-04 SG-005 | `src/lib/p5/safety/evaluator.ts` |
| Permission | P5-04 | P5-04 SG-011 | `src/lib/p5/safety/evaluator.ts` |
| Explanation | P5-05 | P5-05 §6 | `src/lib/p5/explanation/evaluator.ts` |
| Audit | P5-05 | P5-05 §16.1 | `src/lib/p5/explanation/evaluator.ts` |
| Identity | P5-10 | P5-02 AD-013/AD-018 | `src/lib/p5/producer/p5-decision-producer.ts` |
| Provenance | P5-05/10 | P5-02 AD-014, P5-05 §10 | `src/lib/p5/types.ts` (P5ProvenanceRecord) |
| Persistence | P5-09 | P5-09 §6 | `src/lib/p5/record/p5-artifact-recorder.ts` |
| Replay | P5-07 | P5-07 §3.1 | `src/lib/p5/replay/replay-engine.ts` |
| Production integration | P5-11 | P5-11 §3 | `src/lib/p5/integration/p5-runtime-adapter.ts` |

---

## 15. Final Self-Audit

| Gate | Check | Result |
|---|---|---|
| G1 | Baseline status correct | ✅ IMPLEMENTATION COMPLETE / BASELINE FROZEN |
| G2 | All frozen components listed | ✅ P5-03/04/05/07/08/09/10/11 + P4/P3 |
| G3 | No frozen component modified | ✅ Zero production source changes |
| G4 | Outcome provenance correct | ✅ P5-03 ONLY |
| G5 | Safety provenance correct | ✅ P5-04 ONLY |
| G6 | Approval provenance correct | ✅ P5-04 ONLY |
| G7 | Permission provenance correct | ✅ P5-04 ONLY |
| G8 | Explanation provenance correct | ✅ P5-05 ONLY |
| G9 | Audit provenance correct | ✅ P5-05 ONLY |
| G10 | Identity distinction correct | ✅ decisionId ≠ idempotencyKey ≠ contentHash |
| G11 | contentHash remains provisional | ✅ Always null in V1 |
| G12 | Persistence boundary correct | ✅ P5-09 single commit, P5-08 idempotent |
| G13 | Replay boundary correct | ✅ Historical-over-live enforced |
| G14 | Production caller correct | ✅ GET /api/narratives/[id] via P5-11 |
| G15 | Advisory-only V1 correctly documented | ✅ SG-010 |
| G16 | No execution semantics introduced | ✅ Zero matches |
| G17 | Test counts match verified evidence | ✅ 258/258, 15/15, typecheck clean |
| G18 | Real E2E explicitly marked pending | ✅ NOT VERIFIED — ENVIRONMENT BLOCKER |
| G19 | Known limitations complete | ✅ 4 items documented |
| G20 | No future item incorrectly promoted | ✅ All FUTURE items classified |
| G21 | Git boundary clean | ✅ Only baseline document created |
| G22 | Document is internally consistent | ✅ Verified |

**G1–G22: ALL PASS**

---

## 16. Final Decision

**P5 — IMPLEMENTATION COMPLETE / BASELINE FROZEN**

**REAL E2E VERIFICATION PENDING**

The complete P5 runtime chain (P5-03 → P5-04 → P5-05 → P5-10 → P5-09) is implemented, frozen, and wired into the production caller via P5-11. All frozen contracts are verified from source. 258/258 tests pass. Typecheck is clean. Zero semantic leakage. Zero contract drift.

Real PostgreSQL E2E verification remains pending due to environment limitations. This is an environment prerequisite, not a code defect.

P5 is closed. No further modification without explicit new phase or change request.
