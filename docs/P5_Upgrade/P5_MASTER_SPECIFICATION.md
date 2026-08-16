# P5 MASTER SPECIFICATION

**Phase:** P5 — Action / Automation Decision Support
**Task:** P5-00 — P5 Master Specification
**Status:** MASTER FROZEN FOR IMPLEMENTATION PLANNING (P5 implementation NOT STARTED)
**Master version:** `p5-master/1` (P5_MASTER_VERSION = "1")
**Authoritative location:** `docs/P5_Upgrade/`

This document is the authoritative phase-level specification for P5. It
defines what P5 is, what it must NOT be, and the frozen boundaries between P5
and the earlier phases. Everything marked CANDIDATE or PROVISIONAL in this
document is subject to the P5 task specifications and explicit future
decisions — nothing in this document silently promotes or freezes a candidate
concept.

---

## 1. Executive Definition

P5 is the **action / automation decision-support phase**.

- P3 answers: *"What is happening?"*
- P4 answers: *"What does it mean?"*
- **P5 answers: "Given the P4 interpretation and the active policy/safety
  constraints, what action — if any — is eligible, and under what approval
  and execution conditions?"**

P5 consumes the **frozen P4 Decision Support contract** (the
`P4DecisionSupportViewModel`: Direction, Signals, Opportunity, Risk,
Confidence, Actionability, Evidence, Explanation, provenance, degradation,
version tuple). P5 determines whether an action is warranted, what class of
action may be appropriate, whether it is eligible, blocked, requires human
approval, is advisory, or is potentially executable.

**"No action" is a first-class outcome.** P5 must NOT assume every P4
interpretation produces an action.

**P5 is NOT** a mapping from P4 Direction to BUY/SELL. That semantic shortcut
is explicitly prohibited (§5, §8).

## 2. Authoritative Hierarchy

1. `docs/P5_Upgrade/P5_MASTER_SPECIFICATION.md` (this document — phase-level
   authoritative)
2. P5 task-specific frozen specifications (P5-01 … P5-09, created by their
   tasks)
3. The frozen P4 contract (`docs/P4_Upgrade/P4_MASTER_SPECIFICATION.md` +
   P4-02/03/04 specs + the implemented `src/lib/p4/**` contract types)
4. Existing P3/P2 operational contracts
5. Implementation truth where explicitly authoritative (verified repository
   state)
6. Legacy roadmap documents (README, Upgrade.md, MDD_Plan.md — informational
   only)

**Conflict rule:** if a P5 task spec conflicts with this Master, the Master
wins unless a documented amendment changes the Master. **This Master must not
silently override P4** — any conflict with the frozen P4 contract is a
contradiction handled by §30, and any change to P4 semantics requires a
separately approved P4 process, never a P5 decision.

## 3. Phase Status (verified from the repository at P5-00)

| Item | Status |
|---|---|
| P4 phase | **CLOSED** (`P4_08_CLOSURE_DECISION.md`; Master §19K) |
| P4-06 validation track | **OPEN / DATA ACCRUAL** (parallel maintenance track; revalidation trigger defined) |
| All 9 P4-03 provisional rules | **INSUFFICIENT_EVIDENCE** (NOT promoted; NOT modified by P5) |
| P5 | **NOT STARTED — MASTER FROZEN FOR IMPLEMENTATION PLANNING** |
| P5-01 | READY (candidate roadmap — see §32) |
| P4 interpretationRuleVersion | `p4-03/v1` — **unchanged by P5** (§25) |

## 4. P5 Purpose

P5 determines, for a given narrative and its P4 Decision Support snapshot:

1. whether an action is warranted at all (including NO_ACTION);
2. what **class** of action may be appropriate (taxonomy §11);
3. whether that action is **eligible** under the active policy (§13–§14);
4. whether it is **blocked** (guardrails §15, policy, missing evidence);
5. whether **human approval** is required (§16);
6. whether it is **advisory only** or **potentially executable** (§17–§18);
7. the traceable rationale for each of the above (§19, §20, §24).

P5 produces a **decision**, not a market prediction. P5 does not forecast
returns; it does not convert qualitative P4 values into numeric scores; it
does not execute anything in v1 (§18).

## 5. P4 → P5 Boundary

- P4 answers: *"What does the evidence indicate?"*
- P5 answers: *"Given that interpretation and the active policy/safety
  constraints, what action — if any — is eligible?"*
- **P5 does NOT answer:** *"What does the raw P3 evidence mean?"* (that is
  P4's job — P5 consumes the P4 ViewModel, never re-interprets P3).
- **P5 does NOT modify:** P3 thresholds/states, P4 signals, P4 Direction,
  P4 O/R/C/A, P4 degradation semantics, P4 evidence/provenance — unless a
  separately approved future phase explicitly changes them.
- **P5 does NOT duplicate P4 interpretation logic** — P5 consumes the frozen
  ViewModel as produced by `src/lib/p4/` (§19).

## 6. Scope

In scope for P5 (eventually):
- action candidate generation from the P4 ViewModel;
- eligibility and policy evaluation (deterministic rules);
- safety/guardrail layer (fail-closed);
- approval workflow definition;
- action decision + explanation + audit trail;
- read/API/UI exposure of action decisions;
- historical and production validation of the P5 layer.

Out of scope for P5 v1 unless a task spec explicitly extends it:
- autonomous execution, direct exchange/broker integration;
- automatic portfolio rebalancing;
- any financial execution;
- rewriting P4 semantics.

## 7. Non-Goals (P5 v1)

Candidate non-goals — to be confirmed by P5-01 contract audit:

1. Autonomous trading without explicit authorization.
2. Direct exchange/broker execution.
3. Automatic portfolio rebalancing.
4. Converting P4 Direction directly into BUY/SELL.
5. Bypassing human approval.
6. Bypassing guardrails.
7. Rewriting P4 semantics.
8. Modifying P3/P2 thresholds.
9. Modifying P4 interpretation rules.
10. Inventing financial return predictions.
11. Using price returns as hidden validation labels.
12. An LLM making untraceable action decisions (no untraceable decision logic).
13. Introducing hidden action/priority/execution scores (§15 of the P5 task
    instructions — see §15 of this Master).

These are CANDIDATE non-goals and are only frozen by an explicit P5 task
decision after repository/spec review.

## 8. Design Principles

1. **No BUY/SELL shortcut.** P4 Direction → BUY/SELL is prohibited. P5 uses
   the explicit decision pipeline (§9).
2. **Deterministic policy first.** Policy/eligibility/guardrail evaluation is
   deterministic rule evaluation over the P4 ViewModel — not free-form
   judgement. No LLM decision logic is assumed.
3. **Fail closed.** P4 UNKNOWN / DEGRADED / null must never be silently
   converted into an action; where execution could otherwise occur, P5 fails
   closed (§15, §21).
4. **Traceable.** Every action decision traces to its P4 snapshot, evidence,
   policy version, guardrail version, approval state (§19, §24).
5. **Qualitative stays qualitative.** No hidden numeric scoring (§15).
6. **Separation of concerns.** Action decision ≠ action execution (§12, §18).
7. **No invented thresholds.** Numeric thresholds are only added by explicit
   frozen specifications, not by this Master.
8. **Conservative automation.** P5 v1 defaults to advisory; automation modes
   are gated (§17).

## 9. Architecture

```
P4 Decision Support (frozen ViewModel)
        ↓
Action Candidate (generation — deterministic rules)
        ↓
Eligibility (policy preconditions)
        ↓
Policy Evaluation (action policy rules)
        ↓
Risk / Safety Guard (fail-closed guardrails)
        ↓
Approval Requirement (human-in-the-loop)
        ↓
Execution Permission (explicit, v1 = advisory only)
        ↓
Execution (NOT in v1 — boundary defined only)
        ↓
Audit (traceable record)
```

Terminology is refined by task specs; the separation of concerns is frozen
as the architecture. The pipeline produces an **ActionDecision** (§12, §26)
at every step; "no action" is a valid terminal decision.

## 10. Action Model

- An **ActionCandidate** is produced from the P4 ViewModel by deterministic
  generation rules (mapping P4 states to candidate action classes — never a
  direct Direction → BUY/SELL mapping).
- An **ActionDecision** is the output of the full pipeline for a candidate
  (or the explicit NO_ACTION decision).
- **Action decision and action execution are distinct** (§12). A recommended
  or eligible action is NOT an executed action.

## 11. Action Taxonomy (CANDIDATE)

Initial candidate taxonomy — **CANDIDATE, not frozen**:

| Action | Intent | Prerequisites | Evidence requirements | Safety implications | Human approval | Execution in scope (v1) | Automatable | Advisory only |
|---|---|---|---|---|---|---|---|---|
| NO_ACTION | no warranted action | P4 available or deliberately degraded | none beyond P4 snapshot | none | no | no | n/a | yes |
| MONITOR | observe over next window(s) | P4 snapshot present | direction/confidence not unknown | low | no | no | yes | yes |
| REVIEW | human reviews the interpretation | P4 snapshot | explanation + evidence refs | low | no | no | yes (trigger) | yes |
| INVESTIGATE | human investigates a flagged condition | P4 signal/conflict/degradation | signals, conflict, degradation codes | low | no | no | yes (trigger) | yes |
| REDUCE_EXPOSURE | reduce exposure class | eligibility + guardrails | direction NEGATIVE + risk HIGH (as P4 defines) | high | **yes** | no (v1) | no | yes |
| INCREASE_EXPOSURE | increase exposure class | eligibility + guardrails | direction POSITIVE + confidence/opportunity conditions | high | **yes** | no (v1) | no | yes |
| REBALANCE | rebalance between constituents | multi-coin/narrative context | breadth/rotation/leadership evidence | high | **yes** | no (v1) | no | yes |
| ESCALATE | escalate to a human decision | approval-required or blocked state | full decision trace | medium | n/a (escalation itself) | no | yes (trigger) | yes |
| EXECUTE | execute an approved action | approval + execution permission + environment | full decision + approval + guardrail record | **highest** | **yes** | **no (v1)** | no | no (v1 — blocked) |

Every candidate row above is subject to P5-02 (Action Semantic Contract) and
P5-03 (Action Decision/Policy Engine) confirmation. **EXECUTE is out of scope
for P5 v1 execution permission**; it appears only to define the boundary.

## 12. Action State Machine (CANDIDATE)

Candidate states (to be confirmed by P5-02/03):

```
CANDIDATE → ELIGIBLE → APPROVED → EXECUTABLE → EXECUTED
   │            │          │           │
   │            ↓          ↓           ↓
   └──→ BLOCKED ┘      CANCELLED    FAILED
        │
        ↓
    REQUIRES_APPROVAL
```

- **CANDIDATE** — generated, not yet evaluated.
- **ELIGIBLE** — policy preconditions met.
- **BLOCKED** — a guardrail or policy violation prevents eligibility.
- **REQUIRES_APPROVAL** — eligible but human approval required.
- **APPROVED** — human approval recorded.
- **EXECUTABLE** — approved and execution-permitted (v1: not reachable
  without a future execution boundary decision).
- **EXECUTED / FAILED / CANCELLED** — terminal execution outcomes (v1:
  modeled only).

The Master explicitly distinguishes **ACTION DECISION** (CANDIDATE → …
→ REQUIRES_APPROVAL/APPROVED/EXECUTABLE) from **ACTION EXECUTION**
(EXECUTABLE → EXECUTED/FAILED). An action being recommended/eligible MUST NOT
mean it was executed.

## 13. Eligibility

Deterministic eligibility rules evaluate whether a candidate action's
preconditions hold for the P4 snapshot:

- the P4 ViewModel is present and its status is usable (OK/DEGRADED per
  policy — never null-as-action);
- the required P4 fields for the action class are non-UNKNOWN (where the
  action class requires them);
- identity/window consistency between the snapshot and the action context;
- policy-version compatibility.

Eligibility is CANDIDATE until P5-03 defines the exact rule set.

## 14. Policy Engine

- An **ActionPolicy** is a versioned, deterministic rule set mapping
  (P4 snapshot state × action class) → eligibility/block/approval outcomes.
- Policy evaluation must be reproducible: same (P4 snapshot, policy version,
  guardrail version) ⇒ same outcome.
- Policy rules reference P4 qualitative states and signals as-is — never
  re-derived numbers.
- **No hidden priority/portfolio/action score** (§15).

## 15. Safety / Guardrails (fail-closed)

First-class guardrail categories (CANDIDATE list):

- P4 availability (ViewModel null / NO_EVIDENCE / ERROR);
- P4 UNKNOWN Direction / O/R/C/A;
- P4 DEGRADED status and degradation codes (STALE, INSUFFICIENT_HISTORY,
  INVALID, AMBIGUOUS, IDENTITY_AMBIGUOUS, CRITICAL_EVIDENCE_MISSING,
  P2_UNAVAILABLE);
- stale evidence (STALE refs);
- low confidence (P4 Confidence LOW);
- insufficient history;
- identity ambiguity/mismatch;
- conflicting evidence (EVIDENCE_CONFLICT, material/minor);
- action-specific risk (e.g. REDUCE/INCREASE/REBALANCE risk classes);
- policy violations;
- missing required evidence;
- unmet approval requirements;
- execution-environment availability (for executable actions — v1 n/a).

**CRITICAL:** P4 UNKNOWN / DEGRADED / null MUST NOT be silently converted
into an action. Where action execution could otherwise occur, P5 **fails
closed** (the default outcome is NO_ACTION or REVIEW/INVESTIGATE, not an
exposure-changing action). No numerical thresholds are invented here.

## 16. Human Approval (human-in-the-loop)

Human approval is a first-class concept. The Master distinguishes:

1. action suggested (CANDIDATE);
2. action eligible (ELIGIBLE);
3. action requires approval (REQUIRES_APPROVAL);
4. action approved (APPROVED — records who/what, when, which version);
5. action executable (EXECUTABLE);
6. action executed (EXECUTED).

These states are NOT collapsed. Exposure-changing action classes
(REDUCE_EXPOSURE, INCREASE_EXPOSURE, REBALANCE, EXECUTE) require human
approval by default; NO_ACTION/MONITOR/REVIEW/INVESTIGATE/ESCALATE do not
require approval (they are advisory/observation actions). The approval
record is part of the audit trail (§24).

## 17. Automation Modes (CANDIDATE)

Candidate modes:

- **ADVISORY** — P5 produces decisions/explanations for humans; nothing else.
- **ASSISTED** — P5 prepares a decision; a human confirms/approves before
  anything executable.
- **AUTONOMOUS** — P5 executes without per-action human approval.

**P5 v1 determination (PROVISIONAL): ADVISORY only.** ASSISTED may be
considered by a later explicitly approved task; AUTONOMOUS is NOT assumed
permitted. No evidence/specification currently justifies autonomous
execution — it remains CANDIDATE-blocked until a frozen decision says
otherwise.

## 18. Execution Boundary

- P5 v1 defines the execution boundary **conceptually only**: what an
  execution request would require (approval, permission, environment,
  idempotency, audit) — it does NOT implement or assume execution
  infrastructure.
- No exchange/broker integration exists in the repository (verified at
  P5-00); none is invented.
- An action being APPROVED/EXECUTABLE does not imply execution occurred.

## 19. Evidence & Provenance

An action decision traces to:

- the P4 decision-support snapshot (windowEnd, narrative identity,
  `generatedAt`, status);
- evidence references (the P4 `EvidenceReference[]` — identity, layer,
  sourceType, field, status, role);
- P4 interpretation rule version (`p4-03/v1`);
- P5 action policy version;
- P5 guardrail version;
- approval state (who/what, when);
- as-of timestamp;
- narrative identity.

**Distinction preserved:** SOURCE EVIDENCE (P4 refs, immutable) vs DERIVED
ACTION DECISION (P5 output referencing that evidence). P5 never duplicates P4
interpretation logic and never rewrites the evidence.

## 20. Explanation

- P5 explains: why an action was considered; why it was selected/rejected;
  which guardrail blocked it; whether approval is required; why no action was
  selected.
- **P4-04 explanation remains responsible for "what does the evidence
  mean?".** P5 explanation answers "why does this interpretation lead — or
  not lead — to this action under policy?".
- P5 explanations are deterministic and template/policy-derived. No LLM-based
  decision logic is assumed; no untraceable reasoning.

## 21. UNKNOWN / DEGRADED Handling

- P4 UNKNOWN / DEGRADED / null is a **first-class input state**, never a
  silent action trigger.
- Default outcomes for unusable P4 states: NO_ACTION, or MONITOR /
  REVIEW / INVESTIGATE with the degradation reason surfaced.
- Exposure-changing actions are **blocked** when P4 is UNKNOWN/DEGRADED/null
  (fail closed).
- The reason must be preserved and explained (degradation codes surfaced).

## 22. Idempotency (contract requirement, NOT implemented)

Because P5 may eventually introduce side effects, the contract requires:

- `actionDecisionId` — stable identity of a decision;
- `actionRequestId` — stable identity of a request;
- `executionId` — stable identity of an execution attempt (future);
- `idempotencyKey` — caller-supplied key for duplicate suppression;
- `policyVersion` / `guardrailVersion` — the exact rule versions applied;
- `evidenceSnapshotId` — identity of the P4 snapshot consumed.

Re-evaluating the same (P4 snapshot + policy + guardrail) must yield the same
decision. This is a contract/design requirement only — no implementation in
P5-00.

## 23. Failure / Retry Model

Define failure semantics for (each CANDIDATE until task specs):

- P4 unavailable → decision = NO_ACTION / blocked-with-reason; never action;
- policy evaluation failure → decision failure, recorded, no action;
- guardrail failure → fail closed, recorded;
- approval failure (denied/expired) → CANCELLED/blocked, recorded;
- execution failure → EXECUTION FAILURE (distinct from DECISION FAILURE);
- timeout / duplicate request / partial execution → recorded, idempotency
  applies;
- retry → only where semantics are idempotent; no retries implemented.

**Explicit distinction:** DECISION FAILURE (the P5 decision layer could not
produce a valid decision) vs EXECUTION FAILURE (a permitted execution attempt
failed). P5 v1 has no execution infrastructure; execution-failure semantics
are modeled only.

## 24. Audit Trail

Minimum audit information for an action lifecycle:

- what was decided (action class, state transitions);
- why (explanation, policy/guardrail references);
- based on which P4 snapshot (windowEnd, generatedAt, status);
- based on which evidence (evidence refs);
- which policy version; which guardrail version;
- who/what approved (approval actor, recorded at approval time);
- when (timestamps);
- execution status (future);
- failure reason; cancellation reason.

The persistence model is **PROVISIONAL** (no repository architecture
currently mandates a storage design for P5; DB schema must not be changed
without an approved task).

## 25. Versioning

- **P5 master version:** `p5-master/1` (this document).
- **Action policy version:** `p5-action-policy/v0` → versioned by P5-03
  (PROVISIONAL).
- **Guardrail version:** `p5-guardrail/v0` → versioned by P5-04
  (PROVISIONAL).
- **Action interpretation version:** introduced only if a task spec finds a
  genuine need (avoid unnecessary dimensions).
- **P4 `interpretationRuleVersion` (`p4-03/v1`) is NOT changed by P5.** P4
  version tuple is consumed, never modified.

## 26. Data Model (CANDIDATE — no schema changes)

Candidate domain objects, each classified:

| Object | Classification |
|---|---|
| ActionDecision | CANDIDATE (P5-03) |
| ActionCandidate | CANDIDATE (P5-03) |
| ActionPolicy | CANDIDATE (P5-03) |
| GuardrailEvaluation | CANDIDATE (P5-04) |
| Approval | CANDIDATE (P5-04) |
| ExecutionRequest | CANDIDATE — boundary only (P5-03/04) |
| ExecutionResult | CANDIDATE — boundary only |
| ActionAudit | CANDIDATE (P5-05) |

No DB schema is modified by P5-00; persistence design is a later task
decision.

## 27. Validation Strategy

P5 will follow the same documentation-first / audit-first process as P3/P4,
under `docs/P5_Upgrade/`:

1. P5 contract audit (P5-01);
2. deterministic action engine validation (P5-03 tests);
3. safety/approval validation (P5-04 tests);
4. historical/replay validation (P5-07 — replay over the P4-06 harness
   outputs where available; P5 must NOT fabricate P4 historical samples);
5. production validation (P5-08);
6. closure (P5-09).

## 28. Historical Validation (P5-07 — future)

- P5 historical validation replays the **deterministic P5 decision rules**
  over historical P4 snapshots (available from the P4-06 replay harness or
  persisted ViewModels when they exist).
- P5 MUST NOT claim P4 historical validity; P4-06 remains the owner of P4
  rule validation.
- No synthetic samples are presented as historical evidence.

## 29. Production Validation (P5-08 — future)

- Production validation verifies the P5 read path (decision + explanation +
  audit) end-to-end: failure isolation, determinism, provenance, API
  serialization, UI consumption, read-only behavior, concurrency —
  mirroring P4-07's structure.
- The same standards apply: no invented SLOs, known pre-existing failures
  reported, repository never claimed globally green while unrelated failures
  exist.

## 30. Contradiction Governance

Reuses the P4 principle (Master §21):

1. record the contradiction;
2. classify: implementation / specification / example / data;
3. identify exact source clauses;
4. assess impact;
5. resolve explicitly (documented decision, update authoritative docs);
6. update tests if semantics change.

Never silently resolve a semantic contradiction. **If implementation would
require changing P3/P4 semantics: STOP AND REPORT** — P5 does not have
authority to change P3/P4 semantics.

## 31. Frozen / Provisional / Candidate Matrix

**FROZEN (at P5-00):**
- P4 interface/boundary as actually established (ViewModel, versions,
  semantics) — consumed, not modified;
- P4-06 remains OPEN / DATA ACCRUAL (parallel track; not closed, not
  promoted);
- P4 semantics are not modified by P5;
- no hidden action score (§15);
- no autonomous execution assumption (§17);
- P4 UNKNOWN/DEGRADED/null never silently becomes an action (§15/§21);
- decision ≠ execution (§12).

**PROVISIONAL (require future validation/decision):**
- P5 v1 automation mode = ADVISORY only (may be revised by an explicit
  approved task);
- action policy/guardrail rule sets (P5-03/P5-04);
- approval model details (P5-04);
- audit persistence model (P5-05);
- version dimensions (P5-03/P5-04).

**CANDIDATE (proposed, not frozen):**
- action taxonomy (§11);
- action state machine (§12);
- eligibility rules (§13);
- policy architecture (§14);
- guardrail categories (§15);
- automation modes beyond v1 advisory (§17);
- execution model (§18);
- data model objects (§26);
- P5 roadmap tasks (§32).

**OUT OF SCOPE:**
- autonomous trading, exchange/broker integration, automatic rebalancing,
  BUY/SELL mapping, P3/P4 modification, hidden scores, price-return
  predictions, untraceable LLM decisions.

## 32. Roadmap (CANDIDATE structure)

Candidate roadmap — reconciled with the repository; each task will be
frozen by its own spec:

| Task | Purpose | Scope | Expected deliverable | Forbidden changes | Acceptance gate | Dependency |
|---|---|---|---|---|---|---|
| P5-01 | Contract & Gap Audit | audit P4 ViewModel/API/UI; define P5 contract gaps; confirm taxonomy/state candidates | `P5_01_...AUDIT.md` + semantic contract draft | P3/P4/API/UI/DB changes | audit complete; candidates classified | P5-00 |
| P5-02 | Action Semantic Contract | freeze action semantics, taxonomy, states, decision-vs-execution | `P5_02_...SPEC.md` | semantics changes to P3/P4 | contract frozen | P5-01 |
| P5-03 | Action Decision / Policy Engine | deterministic policy engine + action decision logic | `src/lib/p5/**` + tests | P3/P4 semantics; execution | engine tests green | P5-02 |
| P5-04 | Safety / Guardrail / Approval | guardrail layer, fail-closed, approval model | guardrail module + tests | bypassing guardrails; execution | safety tests green | P5-03 |
| P5-05 | Explanation & Audit | P5 explanation + audit trail contract | explanation module + audit design | LLM decisions; hidden scores | traceability verified | P5-03/04 |
| P5-06 | Read/API/UI integration | expose action decisions read-only | API + UI + tests | writing to P3/P4; execution | integration tests green | P5-03–05 |
| P5-07 | Historical Validation | replay P5 rules over historical P4 snapshots | validation harness + report | fabricating samples; P4-06 changes | validation report | P5-03 |
| P5-08 | Production Validation | runtime/operational validation | production validation report | P4-06 closure; SLO invention | report complete | P5-06 |
| P5-09 | Closure | phase closure audit + decision | `P5_09_CLOSURE...md` + Master update | closing P4-06; promoting P4 rules | closure criteria §33 | P5-01–08 |

## 33. Acceptance / Closure Criteria (P5-09)

P5 may be formally closed only when ALL hold:

- contract complete (P5-02 frozen, no gaps requiring semantic change);
- deterministic behavior (engine tests);
- safety controls (guardrail + fail-closed tests);
- provenance (decisions trace to P4 snapshot/evidence/policy/guardrail);
- explanation (deterministic, no hidden logic);
- failure isolation (P5 never breaks P4 API/UI);
- validation (contract/engine/safety/replay/production executed);
- production validation (with limitations documented);
- auditability (audit trail contract met);
- no semantic drift (P3/P4 unchanged);
- documentation complete;
- regression status explicitly recorded (pre-existing failures reported, not
  silently fixed, repository not claimed globally green);
- P4-06 remains OPEN / DATA ACCRUAL (not closed by P5).

## 34. P4-06 Parallel Track (mandatory)

- **P4-06 = parallel maintenance/validation track (OPEN / DATA ACCRUAL).**
- P5 MUST NOT: close P4-06; promote P4 rules; modify P4 provisional rules;
  create a silent dependency making P5 depend on P4-06 completion.
- P5 consumes the frozen P4 contract as it currently exists.
- When the P4-06 revalidation trigger fires, the P4-06 harness re-runs
  independently of P5.

## 35. P5 Handoff

At P5 closure:

- P5 = CLOSED (or explicitly NOT closed with a decision record);
- P4 = remains CLOSED; P4-06 = remains OPEN / DATA ACCRUAL;
- all P5 artifacts live under `docs/P5_Upgrade/`;
- the final closure decision records implementation inventory, semantic
  freeze, validation status, known limitations, and the next phase handoff;
- P5 must never close P4-06 or promote P4 rules.

---

## Verification record (P5-00)

- Repository audited: P4 Master (§19K P4 CLOSED; P4-06 OPEN / DATA ACCRUAL),
  P4 ViewModel contract (`src/lib/p4/types.ts` — Direction 5-state,
  qualitative O/R/C/A, 8-signal catalog, status, version tuple), P4 version
  constants (`p4-decision-support` / `1` / `p4-03/v1` / `1`), README stack
  (Next.js 16 + FastAPI + PostgreSQL), git state (P4 closure commit
  `a5d8633`; working tree clean apart from pre-existing tooling noise).
- Only this document was created; no `src/**`, API, UI, DB, migration, P3/P4
  implementation, or configuration changes.
- Statuses in this document reflect verified repository facts; anything not
  verifiable is marked CANDIDATE/PROVISIONAL, never assumed frozen.

*End of P5 Master Specification. P5 implementation NOT STARTED; P5-01 READY
after this Master is accepted.*
