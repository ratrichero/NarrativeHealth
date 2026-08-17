# P5-02 SEMANTIC CONTRACT / ACTION MODEL

**Phase:** P5 — What action, if any, should be executed?
**Task:** P5-02 — Semantic Contract / Action Model
**Status:** CONTRACT DESIGN COMPLETE — READY FOR P5-03 (pending owner review)
**Action Model version:** `p5-action-model/v1` (P5_ACTION_MODEL_VERSION = "1")
**Authoritative inputs:**
1. `docs/P5_Upgrade/P5_MASTER_SPECIFICATION.md` (FROZEN)
2. `docs/P5_Upgrade/P5-01_CONTRACT_GAP_AUDIT.md` (APPROVED / COMPLETE)

This document defines **WHAT an Action Decision IS**. It does NOT decide
WHEN an action is eligible/selected (P5-03), WHETHER it is safe/authorized
(P5-04), or HOW it executes (later). It is a contract/semantic design —
no production code, no P3/P4/P4-06 modification.

---

## 1. Executive Summary

- **P5-02 owns a small, sharp semantic core:** ActionCandidate,
  ActionDecision, ActionType, the three orthogonal state dimensions
  (Decision / Approval / Execution), identity, and provenance references.
  Everything else (policy, eligibility rules, safety, approval rules,
  execution) is referenced as a boundary, owned downstream.
- **NO_ACTION is a DecisionOutcome, not an ActionType** (AD-003). The
  canonical v1 ActionTypes are the advisory set {MONITOR, REVIEW,
  INVESTIGATE} and the consequential set {REDUCE_EXPOSURE,
  INCREASE_EXPOSURE, REBALANCE} (AD-005, PROVISIONAL).
- **EXECUTE is NOT a v1 ActionType** — it is a CANDIDATE execution-layer
  concept and must never become a BUY/SELL alias (AD-006).
- **The state model is three orthogonal dimensions** — decisionState,
  approvalState, executionState — not one giant enum (AD-009). ELIGIBLE is
  an evaluation result, BLOCKED is a decision outcome with a blocker
  report; neither is a garbage state (AD-010, AD-011).
- **The four "no action" cases are kept distinct** (AD-004): no action
  selected / candidate blocked / nothing eligible / could not determine.
- **Identity hierarchy:** candidateId → decisionId → actionId, with a
  conceptual idempotency key relationship (AD-013, AD-018).
- **UNKNOWN/DEGRADED/null is represented as absence, NOT_DETERMINED, or
  BLOCKED — never as NO_ACTION** (AD-019). No hidden scores (AD-024).
- No BUY/SELL types, aliases, or Direction mappings exist or are created
  (AD-008). P4-06 remains OPEN / DATA ACCRUAL; P5-02 has no dependency on
  it.

---

## 2. Authority & Inputs

| Input | Status | Used for |
|---|---|---|
| P5 Master (P5_MASTER_SPECIFICATION.md) | FROZEN | phase boundary, taxonomy candidates, state vocabulary, invariants |
| P5-01 Contract & Gap Audit | APPROVED | evidence of existing repo capabilities, conflicts C-001/002/003, reuse matrix |
| P4 contract (`src/lib/p4/types.ts` + P4-02/03/04 specs) | FROZEN | input contract definition (`P4DecisionSupportViewModel`) |
| P4-06 docs | OPEN / DATA ACCRUAL | independence check only |

---

## 3. P5-02 Scope

**Owned by P5-02 (semantic definition only):**
- ActionCandidate semantics
- ActionDecision semantics
- ActionType taxonomy (proposal, PROVISIONAL)
- Action state dimensions (Decision / Approval / Execution)
- State / Outcome / Event / Command / Decision distinction
- Identity model (candidateId / decisionId / actionId)
- Evidence snapshot reference + provenance requirements
- Parameter semantics
- Versioning semantics
- Immutability / material-change semantics
- Idempotency boundary
- UNKNOWN / DEGRADED / null representation
- Legacy vocabulary protection (C-001/002/003)

**NOT owned by P5-02 (boundary references only):**
- Eligibility rules → P5-03
- Policy rules, priority, cooldown, duplicate suppression → P5-03
- Safety thresholds / guardrails → P5-04
- Approval rules and authority → P5-04
- Automation authority → P5-04
- Execution permission and execution mechanics → P5-04 / later

---

## 4. P4 → P5 Semantic Boundary

- P4 produces `P4DecisionSupportViewModel` (read-time derived, NOT
  persisted — `src/lib/p4/types.ts:280`; `getP4DecisionSupport` returns
  `ViewModel | null`, `src/lib/p4/service.ts:133`).
- P5-02 consumes the ViewModel **as an opaque semantic input**. P5-02 does
  not re-derive Direction, Signals, Opportunity, Risk, Confidence,
  Actionability, evidence, or degradation — it references them.
- If the Action Model needs information not present in the ViewModel, that
  is a **CONTRACT GAP** to be recorded (P5-01 found none that P5-02 needs:
  identity, versions, asOf, status, degradation, evidence refs, and
  qualitative O/R/C/A are all present).
- P4 `interpretationRuleVersion` (`p4-03/v1`) is consumed, never modified.

---

## 5. Semantic Layer Model

Layers (each with its owner):

```
Evidence                         (P3/P2 persisted — frozen)
   ↓
P4 Decision Support              (P4 — frozen)
   ↓
Action Candidate                 (P5-02 — P5-02 OWNED)
   ↓
Action Decision                  (P5-02 — P5-02 OWNED)
   ↓
Eligibility / Policy             (P5-03 — DOWNSTREAM)
   ↓
Safety                           (P5-04 — DOWNSTREAM)
   ↓
Approval                         (P5-04 — DOWNSTREAM)
   ↓
Execution Permission             (P5-04 / later — DOWNSTREAM)
   ↓
Execution                        (later — DOWNSTREAM)
   ↓
Execution Result                 (later — DOWNSTREAM)
```

P5-02 owns the decision-side layers and defines **reference boundaries**
into every downstream layer. It does not define downstream behavior.

---

## 6. Action Model Overview

The Action Model is the P5 semantic core:

- **ActionCandidate** — "this action is being considered" (value object,
  created from a decision context).
- **ActionDecision** — "the P5 decision process produced a formal decision
  concerning this candidate (or none)" (persisted record, immutable core).
- **ActionType** — the classification of the action's intent.
- **State dimensions** — decisionState, approvalState, executionState.
- **Identity** — candidateId, decisionId, actionId.
- **Provenance references** — P4 snapshot, evidence, versions.

A decision NEVER means approved, authorized, executable, or executed —
those are downstream states/layers (AD-002, AD-009).

---

## 7. Action Type Taxonomy

### 7.1 Evaluation of the candidate vocabulary

Each Master candidate (Master §11) evaluated:

| Candidate | Semantic meaning | Side effects | Advisory/Consequential | Parameters? | Approval? | Recommendation vs execution | Redundant? | Verdict |
|---|---|---|---|---|---|---|---|---|
| NO_ACTION | absence of a selected action | none | n/a (outcome, not type) | no | no | recommendation | n/a | **DecisionOutcome (AD-003)** |
| MONITOR | observe over next window(s) | none | advisory | window concept | no | recommendation | no | **ACCEPT — v1 advisory type** |
| REVIEW | human reviews the interpretation | none | advisory | scope concept | no | recommendation | no | **ACCEPT — v1 advisory type** |
| INVESTIGATE | human investigates a flagged condition | none | advisory | target concept | no | recommendation | no | **ACCEPT — v1 advisory type** |
| REDUCE_EXPOSURE | reduce exposure class (mechanism-neutral) | potential (downstream) | consequential | scope + magnitude concept | per P5-04 | recommendation | no | **ACCEPT — v1 consequential type** |
| INCREASE_EXPOSURE | increase exposure class (mechanism-neutral) | potential (downstream) | consequential | scope + magnitude concept | per P5-04 | recommendation | no | **ACCEPT — v1 consequential type** |
| REBALANCE | adjust allocation between subjects | potential (downstream) | consequential | subject set + target allocation concept | per P5-04 | recommendation | no | **ACCEPT — v1 consequential type** |
| ESCALATE | elevate decision authority | none (workflow) | advisory-workflow | authority concept | n/a | recommendation | overlaps approval routing | **CANDIDATE (AD-007)** |
| EXECUTE | initiate execution | would (downstream) | execution-layer | execution instruction | per P5-04 | execution request | duplicates execution layer | **CANDIDATE (AD-006)** |

### 7.2 Canonical v1 taxonomy (PROPOSED — PROVISIONAL)

```
ActionType (v1, PROVISIONAL):
  advisory:      MONITOR | REVIEW | INVESTIGATE
  consequential: REDUCE_EXPOSURE | INCREASE_EXPOSURE | REBALANCE
```

- **consequential** is a semantic property of the type (a boolean flag
  meaning "may lead to a downstream side effect"), NOT a score and NOT an
  approval rule. Per-action approval mapping stays deferred to P5-04.
- NO_ACTION is NOT in this set (it is a DecisionOutcome — §8, AD-003).
- EXECUTE and ESCALATE remain CANDIDATE (AD-006, AD-007).

---

## 8. Action Candidate

**Definition:** *"A proposed possible action derived from an evaluated
decision context, before eligibility, safety, approval, or execution
authorization."*

Candidate contract (semantic fields — every field justified):

| Field | Justification |
|---|---|
| candidateId | stable identity for traceability/audit |
| candidateVersion | material changes to a candidate create a new version (AD-016) |
| actionType | what is being considered |
| subject | narrative/entity the action concerns |
| decisionContextRef | the evaluated context (P4 snapshot ref §13) |
| p4ViewModelRef | the exact P4 ViewModel consumed |
| parameters | typed concept parameters (§14), may be empty |
| createdAt | creation timestamp |
| rationaleRef | pointer to the candidate-generation rationale (P5-03 fills) |
| provenance | source refs (§15) |
| semanticVersion | action-model version under which the candidate was shaped |

The candidate is a **value object** — immutable once created; its "fate"
is expressed by the decision that references it, not by a candidate state
machine (avoids state explosion; AD-010).

---

## 9. Action Decision

**Definition:** *"The formal output of the P5 decision process concerning a
candidate (or the explicit decision that no action is selected / that the
process could not determine an action)."*

An ActionDecision MUST NOT mean approved, authorized, executable, or
executed (AD-002, AD-009).

Decision contract (semantic fields):

| Field | Justification |
|---|---|
| decisionId | stable identity (§12) |
| decisionOutcome | SELECTED / NO_ACTION / BLOCKED / NOT_DETERMINED (AD-004) |
| selectedActionRef | candidateId + candidateVersion — present iff SELECTED |
| consideredCandidates | candidate refs evaluated (audit; may be empty) |
| blockerReport | layer + reason refs — present iff BLOCKED (AD-011) |
| rationaleRef | decision rationale (P5-05 defines explanation) |
| policyVersionRef | policy/algorithm version applied (reference only; value owned by P5-03) |
| p4SnapshotRef | exact P4/evidence context (§13) |
| decisionState | DECIDED / CANCELLED / SUPERSEDED / EXPIRED (§10) |
| decidedAt | decision timestamp |
| semanticVersion | action-model version |

---

## 10. Action State Model

### 10.1 Three orthogonal dimensions (AD-009)

A single enum (CANDIDATE → ELIGIBLE → APPROVED → EXECUTABLE → EXECUTED)
was analyzed and **rejected**: it forces invalid combinations (e.g., a
DECIDED advisory action that must never be "EXECUTED"; an APPROVED action
that is still awaiting decision-level expiry). The model uses **three
orthogonal state dimensions**, each with its own lifecycle and owner:

| Dimension | States | Owner | Terminal? |
|---|---|---|---|
| decisionState | DECIDED · CANCELLED · SUPERSEDED · EXPIRED | P5-02/05 | DECIDED is normal terminal; CANCELLED/SUPERSEDED/EXPIRED are terminal |
| approvalState | NOT_REQUIRED · REQUIRED · PENDING · APPROVED · DENIED · EXPIRED · REVOKED | P5-04 | APPROVED / DENIED / EXPIRED / REVOKED terminal |
| executionState | NOT_APPLICABLE (v1 default) · PERMITTED · EXECUTED · FAILED · CANCELLED | P5-04 / later | v1: only NOT_APPLICABLE reachable; others boundary-modeled |

- A decision being DECIDED with outcome SELECTED does **not** imply
  approval; APPROVED does not imply execution (Master §12/§16 preserved).
- ELIGIBLE is **not** a state dimension — it is an evaluation result on the
  decision: `eligibility: { evaluated, eligible, policyVersionRef,
  reasonRef }` (AD-010). BLOCKED is **not** a garbage state — it is a
  decision outcome carrying a structured blocker report (AD-011).

### 10.2 Transitions (semantic only — not implemented)

| Dimension | Source → Destination | Reason | Owner | Automatic/Event | Reversible | Audit event |
|---|---|---|---|---|---|---|
| decision | (created) → DECIDED | decision produced | P5-03 | automatic (deterministic) | no | DecisionProduced |
| decision | DECIDED → SUPERSEDED | material change; new decision issued | P5-05 | event | no | DecisionSuperseded |
| decision | DECIDED → EXPIRED | validity horizon passed (P5-03 policy defines horizon) | P5-05 | event | no | DecisionExpired |
| decision | (any) → CANCELLED | withdrawn by authority | P5-05 | event | no | DecisionCancelled |
| approval | REQUIRED → PENDING | approval required determined | P5-04 | automatic | no | ApprovalRequired |
| approval | PENDING → APPROVED | human grant | P5-04 | event | no (revoke is separate) | ApprovalGranted |
| approval | PENDING → DENIED | human denial | P5-04 | event | no | ApprovalDenied |
| approval | APPROVED → REVOKED | material param change without re-approval | P5-04 | event | no | ApprovalRevoked |
| approval | PENDING/REQUIRED → EXPIRED | approval deadline (policy) | P5-04 | event | no | ApprovalExpired |
| execution | PERMITTED → EXECUTED | execution performed | later | event | no | ExecutionCompleted |
| execution | PERMITTED → FAILED | execution failure | later | event | no | ExecutionFailed |

---

## 11. State / Outcome / Event / Command / Decision

Explicit separation (essential for audit, retry, idempotency, replay):

| Concept | Category | Meaning | Owner |
|---|---|---|---|
| DECIDED / APPROVED / EXECUTED | STATE | persistent condition of a dimension | P5-02/P5-04/later |
| SELECTED / NO_ACTION / BLOCKED / NOT_DETERMINED | OUTCOME | result of the decision evaluation | P5-02 |
| DecisionProduced / ApprovalGranted / ExecutionCompleted | EVENT | facts that occurred (audit, replay) | P5-05 |
| DecideAction / ApproveAction / ExecuteAction | COMMAND | requested operation (idempotency subject) | P5-03/04/later |
| ActionDecision | DECISION | the persisted decision record | P5-02 |

These are never collapsed: APPROVED (state) ≠ ApprovalGranted (event) ≠
ApproveAction (command) ≠ ActionDecision (decision).

---

## 12. Identity Model

### 12.1 Identity hierarchy (AD-013)

| Identity | Purpose | Scope | Lifetime | Used By |
|---|---|---|---|---|
| candidateId | identity of a considered action | one candidate (versioned) | candidate lifetime | audit, decision refs |
| decisionId | identity of one decision evaluation | one decision | decision lifetime | audit, approval binding, replay |
| actionId | identity of the action instance proceeding downstream (created iff SELECTED) | one action | action lifetime | approval binding, execution binding, idempotency |
| idempotencyKey (conceptual) | duplicate suppression for commands | one logical command | command scope | P5-03/05 implementation |

Relationships: one decision references 0..n candidates and (if SELECTED)
creates exactly one action; one action binds exactly one decision. These
are **separate identifiers** (not aliases), arranged parent→child
(candidate → decision → action), enabling traceability and replay.

### 12.2 Decision uniqueness (AD-013, AD-018)

A decision is unique over: subject identity + decision context (P4
snapshot ref) + policy version + action model version. Re-evaluating the
**same** tuple must produce the **same** decision (determinism, Master
§14/§22). A composite hash is NOT defined here — if a content hash is
needed for drift detection it applies to the P4 snapshot payload (AD-014),
not to decision identity.

---

## 13. Evidence & Provenance

### 13.1 Evidence snapshot reference (AD-014)

Because the P4 ViewModel is read-time derived and NOT persisted, a decision
cannot reference a persisted P4 row. The snapshot reference is a
**combination**:

```
p4SnapshotRef = {
  narrativeIdentity,      // narrativeId, window, algorithmKey, algorithmVersion, calculationMode
  asOf,                   // latest artifact window end
  versionTuple,           // algorithmVersion, semanticVersion, signalCatalogVersion, interpretationRuleVersion
  status,                 // OK | DEGRADED | NO_EVIDENCE | ERROR
  contentHash             // PROVISIONAL: hash of canonical semantic payload, excluding generatedAt
}
```

- **Anti-drift rule (FROZEN):** an ActionDecision must reference the exact
  P4 context it was based on; it must NOT silently drift to a later P4
  state. If the P4 context changes materially, a **new decision** is
  required (re-evaluation), and the old decision is SUPERSEDED.
- The contentHash mechanism is PROVISIONAL (implementation in P5-05/06);
  the identity+version+asOf tuple is FROZEN as the minimum reference.

### 13.2 Provenance requirements (AD-002)

Traceable from an ActionDecision:
- P4 source (ViewModel ref, version tuple);
- evidence refs (P4 `EvidenceReference[]` — referenced, not duplicated);
- decision identity; action identity;
- action-model semantic version;
- policy version reference (P5-03); guardrail/safety version reference
  (P5-04).

No audit storage is defined here (P5-05).

---

## 14. Parameter Model

Parameters are allowed per type as **typed concepts**, with semantic
constraints only:

| Action Type | Parameter Concept | Required? | Semantic Constraint |
|---|---|---|---|
| MONITOR | window concept (observation duration) | no | must be a positive duration concept; validated by P5-03 policy |
| REVIEW | scope concept (which interpretation/evidence) | yes | must reference a P4 snapshot scope |
| INVESTIGATE | target concept (what to investigate) | yes | must reference a signal/degradation/evidence target |
| REDUCE_EXPOSURE | subject scope + magnitude concept | yes | magnitude = concept only (percentage/target idea), NO numeric limits here |
| INCREASE_EXPOSURE | subject scope + magnitude concept | yes | same |
| REBALANCE | subject set + target allocation concept | yes | target allocation = concept only |

**Semantic rules (FROZEN, AD-015):**
1. Parameters are explicit and conceptually typed.
2. Versioned where material (material parameter change = new candidate
   version → new decision, AD-016).
3. Immutable after approval unless re-approved.
4. Auditable (recorded with the candidate/decision).
5. Validated by downstream layers (P5-03 policy, P5-04 safety/approval) —
   P5-02 defines no validation rules and no numeric limits.
6. NO trading/order schemas (no quantity, price, order type — AD-017).

---

## 15. Immutability & Material Change

**Immutability rules (FROZEN, AD-016):**

| Event | Becomes immutable |
|---|---|
| after DECIDED | decisionId, outcome, selectedActionRef, p4SnapshotRef, policyVersionRef, rationaleRef, decidedAt |
| after APPROVED | candidate/action parameters (unless re-approved) |
| after execution permission | action instance identity + bound parameters |

**Material change** to: action type, subject, parameters, evidence context
(snapshot ref), policy version, or safety context ⇒ the existing decision
**must not silently mutate** — a new decision/version is required, and the
old decision transitions to SUPERSEDED. This is a semantic requirement,
not an implementation.

---

## 16. Versioning

Separate dimensions (AD-017):

| Dimension | Version | Status |
|---|---|---|
| Action Model (this document) | `p5-action-model/v1` | FROZEN (this doc) |
| Action type taxonomy | `p5-action-types/v1` | PROVISIONAL (confirm P5-03 + owner) |
| Action decision schema | `p5-decision-schema/v1` | PROVISIONAL (confirm P5-05) |
| P4 contract (consumed) | `p4-03/v1` etc. | FROZEN — never changed by P5 |
| Policy (P5-03) | `p5-action-policy/v0` → P5-03 | PROVISIONAL |
| Guardrail / safety (P5-04) | `p5-guardrail/v0` → P5-04 | PROVISIONAL |

`schema version` ≠ `semantic version` ≠ `policy version` — never conflated.

---

## 17. Idempotency Boundary

- **FROZEN (AD-018):** the same (subject, decision context, policy version,
  action-model version) yields the same decision (deterministic). Same
  decision ≠ same execution attempt (a decision may be executed zero,
  once, or rejected multiple times at the command layer).
- Idempotency keys belong to the **command** layer (DecideAction /
  ApproveAction / ExecuteAction), conceptually related to decisionId /
  actionId. Implementation is deferred to P5-03 (decision commands) and
  P5-05 (audit) — P5-02 defines only the identity semantics above.

---

## 18. Unknown / Degraded / Null

Frozen Master invariant preserved (Master §15/§21): UNKNOWN / DEGRADED /
null MUST NOT inherently become NO_ACTION — and P5-02 creates no such
mapping.

Contract-level representation of unusable upstream context:

| Case | Representation |
|---|---|
| P4 returns null (no evidence / failure / identity rejection) | **no decision record produced** (absence); the read path simply has no action decision |
| evaluation ran but could not determine | **decisionOutcome = NOT_DETERMINED** + degradation reason refs (never NO_ACTION) |
| candidate created but blocked | **decisionOutcome = BLOCKED** + blocker report |
| nothing eligible after evaluation | **decisionOutcome = NO_ACTION** + policy reference (evaluation completed) |
| explicit decision to take no action | **decisionOutcome = NO_ACTION** + rationale |

The four "no action" cases (§18) are therefore distinct at the contract
level (AD-004). Whether NOT_DETERMINED vs NO_ACTION vs BLOCKED is produced
in a given situation is a P5-03/P5-04 behavior — not decided here.

---

## 19. Approval Boundary

- An ActionDecision may carry an **approval requirement reference** only:
  `approval: { required: boolean, authorityRef?, approvalStateRef? }` —
  set by policy evaluation (P5-03/P5-04), NOT decided by P5-02.
- Per-action approval mapping ("all X require approval") is explicitly
  deferred to P5-04 (Master §16 deferred this).
- The approval **record** (who/what, when, version bound) lives on the
  downstream approval object, not inside the ActionDecision payload
  (AD-020). The decision references it.

---

## 20. Policy Boundary

P5-02 defines the **contract consumed by policy evaluation** and nothing
more. No `if Direction == ... → action` rules appear anywhere in this
document. Policy version references appear on the decision as references
only; the values and rules belong to P5-03.

---

## 21. Eligibility Boundary

- Candidate = possible action object.
- Eligible = policy has determined it may proceed (a P5-03 evaluation
  result).
- P5-02 records `eligibility` as a result slot on the decision with a
  policy version reference; it defines no eligibility rules and no
  eligibility state dimension (AD-010).

---

## 22. Safety Boundary

- Safety attaches to the lifecycle at the boundary: `ActionDecision →
  safety evaluation → approval` (Master §9 pipeline).
- P5-02 defines **where** the safety result attaches (a `safetyRef` /
  guardrail version reference on the decision, populated by P5-04) — not
  any safety threshold or behavior.
- Consequential action types (AD-005) are the types whose downstream path
  must be safety-gated; the gating rules are P5-04's.

---

## 23. Cancellation / Expiration / Staleness

Evaluated to avoid state explosion:

| Semantic | Why it exists | Category | Owner |
|---|---|---|---|
| CANCELLED | a decision withdrawn by authority before full lifecycle | decisionState terminal | P5-05 |
| SUPERSEDED | material change produced a new decision | decisionState terminal | P5-05 |
| EXPIRED (decision) | validity horizon passed (P4 context advanced) | decisionState terminal | P5-05 |
| EXPIRED (approval) | approval not acted upon in time (policy) | approvalState terminal | P5-04 |
| STALE (context) | decision references outdated P4 context — MUST NOT proceed to approval/execution without re-evaluation (fail closed for consequential) | context condition on decision (via p4SnapshotRef age/horizon) | P5-03/P5-04 |
| REVOKED | approval invalidated on material change | approvalState terminal | P5-04 |

No additional states invented (no "ARCHIVED", no "PAUSED").

---

## 24. Legacy Vocabulary Protection

P5-01 findings C-001 / C-002 / C-003 require naming protection (AD-023):

- **C-001 (acknowledgement ≠ approval):** alert `acknowledged_at/
  acknowledged_by` is post-hoc acknowledgement of a triggered alert
  (`src/db/schema.ts:712-713`; `alert.service.ts:60`). P5 approval state
  names must never be satisfied or conflated with alert acknowledgement.
  Documented distinction: approval is pre-execution, bound to candidate
  version, granted by an authority actor with a recorded decision;
  acknowledgement is post-trigger awareness.
- **C-002 ("approved" P2 evidence ≠ P5 approval):** the word "approved" in
  P4 refers to P2 event-risk evidence status (`src/lib/p4/mapper.ts:612`),
  not human approval. P5-02 reserves APPROVED (and REQUIRES_APPROVAL,
  APPROVAL state names) for the approval dimension only, and requires P5
  docs/code to qualify any use of the word to avoid collision.
- **C-003 (legacy bullish language):** P5 reason/explanation vocabulary
  must not inherit legacy directional tier language ("Strong bullish
  signals...", `src/lib/features/engine.ts:186-197`). P5-05 explanation
  design must adopt a banned-phrase policy mirroring P4's
  `BANNED_PHRASES` (`src/lib/p4/explanation/templates.ts:243-253`) —
  requirement recorded here, implementation in P5-05.

The legacy systems are NOT modified.

---

## 25. Decision Records

### AD-001 — P4 Boundary
Status: **FROZEN** (required by P5 Master §5)
Decision: P5-02 consumes `P4DecisionSupportViewModel` as an opaque
semantic input; no reinterpretation, no recalculation, no second P4 layer.
Rationale: Master §5 forbids P5 reinterpreting P4; P5-01 verified the
contract is complete for P5-02's needs.
Alternatives: (a) P5-side re-derivation of signals — rejected (violates
Master); (b) copying evidence into P5 — rejected (Master §19: reference,
don't duplicate).
Impact: P5-03/04 operate only on ViewModel + refs.
Downstream Owner: all P5 tasks.
Evidence: `src/lib/p4/types.ts:280`; Master §5.

### AD-002 — Layer Ownership
Status: **FROZEN**
Decision: P5-02 owns Candidate/Decision/Type/State-dimensions/Identity/
Provenance refs; policy/safety/approval/execution are reference-only
boundaries.
Rationale: Master §9 pipeline + §31; prevents P5-02 from drifting into
implementation.
Impact: contract boundary for P5-03/P5-04.
Downstream Owner: P5-03, P5-04.

### AD-003 — NO_ACTION is a DecisionOutcome, not an ActionType
Status: **FROZEN**
Decision: NO_ACTION is not an ActionType. It is the `decisionOutcome`
value meaning "the decision process selected no action." MONITOR / REVIEW /
INVESTIGATE are actual ActionTypes.
Rationale: NO_ACTION has no intent, no parameters, no subject, no approval
path, no execution path — it is the absence of selection, not a class of
action. Treating it as a type forces artificial parameter/approval columns.
Alternatives: (a) NO_ACTION as ActionType — rejected (empty semantics);
(b) NO_ACTION as separate category "decision" only — adopted (outcome).
Impact: Decision contract carries outcome; taxonomy excludes NO_ACTION.
Downstream Owner: P5-03 (outcome production), P5-05 (explanation of
NO_ACTION).
Evidence: P5-02 task §8 analysis; Master §1 "No action is a first-class
outcome."

### AD-004 — Four Distinct No-Action Cases
Status: **FROZEN**
Decision: decisionOutcome ∈ { SELECTED, NO_ACTION, BLOCKED,
NOT_DETERMINED }; each represents one distinct case and they never
collapse (§18).
Rationale: audit and safety require distinguishing "declined" from
"blocked" from "nothing eligible" from "could not determine".
Impact: decision schema + P5-03 production semantics + P5-05 explanation.
Downstream Owner: P5-03, P5-05.

### AD-005 — Canonical v1 ActionTypes
Status: **PROVISIONAL**
Decision: v1 ActionTypes = advisory {MONITOR, REVIEW, INVESTIGATE} +
consequential {REDUCE_EXPOSURE, INCREASE_EXPOSURE, REBALANCE};
`consequential` is a type-level semantic flag (may lead to downstream side
effects), NOT an approval rule and NOT a score.
Rationale: each candidate type has distinct intent and parameter needs;
consequentiality flag supports safety/approval policy without inventing
scores (Master §23).
Alternatives: (a) include ESCALATE/EXECUTE in v1 — deferred (AD-006/007);
(b) drop the advisory set — rejected (they are the v1 actionable output
under ADVISORY-ONLY default).
Impact: taxonomy frozen only at P5-03 + owner approval.
Downstream Owner: P5-03, P5-04.

### AD-006 — EXECUTE is NOT a v1 ActionType
Status: **CANDIDATE**
Decision: EXECUTE is not in the v1 ActionType set. It is a candidate
execution-layer concept (an execution request derived from an approved
decision) and must NEVER become a BUY/SELL alias.
Rationale: "EXECUTE" without an execution mechanism is empty; it is
redundant with the execution layer of the Master pipeline. v1 is
ADVISORY-ONLY — no execution semantics exist (Master §17/§18).
Alternatives: (a) EXECUTE as v1 type with execution semantics — rejected
(v1 has no execution); (b) EXECUTE as generic "proceed" intent — rejected
(ambiguous, overlaps execution layer).
Impact: taxonomy clean; execution layer owns execution-request semantics
later.
Downstream Owner: later execution-scope task; P5-04 (permission boundary).
Evidence: P5-02 task §5 trap guidance; Master §18.

### AD-007 — ESCALATE is CANDIDATE
Status: **CANDIDATE**
Decision: ESCALATE remains a candidate, not in v1. Its semantics intersect
the approval/authority dimension (elevate decision authority), owned by
P5-04.
Rationale: escalation is workflow/authority behavior; freezing it in P5-02
would pre-judge the approval model.
Impact: approval model (P5-04) decides whether ESCALATE is a type, a
workflow mechanism, or both.
Downstream Owner: P5-04.

### AD-008 — BUY/SELL Boundary
Status: **FROZEN** (Master-required)
Decision: No BUY or SELL ActionType, alias, or Direction mapping exists or
is created. REDUCE_EXPOSURE ≠ SELL; INCREASE_EXPOSURE ≠ BUY; EXECUTE ≠
BUY/SELL. Exposure direction, if ever needed, is an explicit parameter
concept on the consequential types — not a trade instruction.
Rationale: Master §5/§8; P5-01 found no violation in the current repo.
Impact: taxonomy + parameter naming rules for all P5 tasks.
Downstream Owner: P5-03 (policy must not introduce mappings), P5-05
(language policy).

### AD-009 — Three Orthogonal State Dimensions
Status: **PROVISIONAL**
Decision: State model = decisionState × approvalState × executionState
(§10). The single-enum Master candidate vocabulary (CANDIDATE → ELIGIBLE →
APPROVED → EXECUTABLE → EXECUTED) is analyzed and rejected as a single
enum.
Rationale: single enum forces invalid combinations (advisory actions must
never reach EXECUTED; APPROVED ≠ EXECUTABLE; DECIDED ≠ APPROVED).
Orthogonal dimensions preserve Master §12/§16 invariants without padding.
Alternatives: (a) single enum — rejected; (b) two dimensions (decision +
execution) — rejected (approval must be independently traceable, P5-04);
(c) per-action state machines — rejected (complexity).
Impact: contract for P5-03/04/05 state handling.
Downstream Owner: P5-04 (approval/execution dimensions), P5-05
(persistence).

### AD-010 — Eligibility is a Result, not a State
Status: **PROVISIONAL**
Decision: ELIGIBLE is an evaluation result recorded on the decision
(`eligibility { evaluated, eligible, policyVersionRef, reasonRef }`), not
a state dimension.
Rationale: eligibility is a deterministic policy determination (P5-03);
modeling it as a state invites a redundant state machine.
Impact: decision schema; P5-03 writes the result.
Downstream Owner: P5-03.

### AD-011 — BLOCKED is an Outcome with a Blocker Report
Status: **FROZEN**
Decision: BLOCKED is a decisionOutcome carrying a structured blockerReport
(layer: policy|safety; reason refs). It is not a generic garbage state and
never collapses into NO_ACTION.
Rationale: AD-004 + Master §4 "blocked" is a distinct determination.
Impact: decision schema + explanation (P5-05).
Downstream Owner: P5-03/04 produce blockers; P5-05 explains them.

### AD-012 — Candidate vs Decision
Status: **FROZEN**
Decision: Candidate = "being considered" (value object). Decision = "formal
result concerning the candidate" (persisted record). Distinct identities;
decision references candidate(s).
Rationale: P5-02 task §7; audit/approval binding need both.
Impact: identity + schema.
Downstream Owner: P5-03 (creates decisions from candidates).

### AD-013 — Identity Hierarchy
Status: **PROVISIONAL**
Decision: candidateId → decisionId → actionId (created iff SELECTED);
separate identifiers, parent→child; idempotencyKey is a command-layer
concept (§12).
Rationale: traceability, audit, approval binding, execution binding,
replay, idempotency all need distinct stable identities.
Impact: all downstream persistence/API (P5-05/06).
Downstream Owner: P5-05 (storage), P5-06 (API).

### AD-014 — Evidence Snapshot Reference
Status: **PROVISIONAL** (tuple FROZEN; contentHash PROVISIONAL)
Decision: p4SnapshotRef = narrativeIdentity + asOf + versionTuple + status
+ contentHash (canonical semantic payload, excluding generatedAt).
Anti-drift rule FROZEN.
Rationale: P4 ViewModel is read-time derived and not persisted — a pure
row reference is impossible; drift prevention requires payload identity.
Impact: P5-05/06 implement hash + re-evaluation trigger.
Downstream Owner: P5-05.

### AD-015 — Parameter Semantics
Status: **FROZEN** (rules); parameter membership **PROVISIONAL**
Decision: parameters are typed concepts per type (§14); six semantic rules
(explicit, typed, versioned-when-material, immutable-after-approval,
auditable, downstream-validated); no numeric limits; no order schemas.
Rationale: Master §16; avoids P5-02 inventing thresholds.
Impact: candidate/decision schema; P5-03/04 validation contracts.
Downstream Owner: P5-03, P5-04.

### AD-016 — Immutability & Material Change
Status: **FROZEN**
Decision: immutable cores per §15; material change ⇒ new decision +
SUPERSEDED; no silent mutation.
Rationale: Master §25; audit integrity.
Impact: decision lifecycle; P5-05 storage rules.
Downstream Owner: P5-05.

### AD-017 — Versioning Separation
Status: **FROZEN**
Decision: action-model / taxonomy / decision-schema / semantic versions are
separate from policy (P5-03) and guardrail (P5-04) versions; P4 version
tuple consumed unchanged.
Rationale: Master §25; avoids conflation.
Impact: version fields on decision.
Downstream Owner: P5-03, P5-04.

### AD-018 — Idempotency Boundary
Status: **FROZEN** (boundary); implementation deferred
Decision: same (subject, decision context, policy version, action-model
version) ⇒ same decision; same decision ≠ same execution attempt;
idempotency keys are command-layer concepts.
Rationale: Master §22; determinism.
Impact: P5-03 (decision commands), P5-05 (audit).
Downstream Owner: P5-03, P5-05.

### AD-019 — UNKNOWN / DEGRADED Representation
Status: **FROZEN**
Decision: unusable context is represented as absence (no decision), or
outcome NOT_DETERMINED, or outcome BLOCKED (§18). Never NO_ACTION.
UNKNOWN → NO_ACTION mapping is prohibited.
Rationale: Master §15/§21 invariant.
Impact: decision outcomes + read path (P5-06).
Downstream Owner: P5-03, P5-06.

### AD-020 — Approval Boundary
Status: **FROZEN** (boundary)
Decision: decision carries only an approval requirement reference;
approval record lives downstream; per-action approval mapping deferred to
P5-04.
Rationale: Master §16 deferred per-action mapping; P5-02 task §18.
Impact: approval object schema (P5-04), audit (P5-05).
Downstream Owner: P5-04.

### AD-021 — Policy/Eligibility/Safety Boundaries
Status: **FROZEN**
Decision: no policy, eligibility, or safety rules in P5-02 — reference
slots only (policyVersionRef, eligibility result, safetyRef).
Rationale: task §19-21; Master §13/14/15.
Impact: contract shape for P5-03/04.
Downstream Owner: P5-03, P5-04.

### AD-022 — Cancellation / Expiration / Staleness
Status: **PROVISIONAL**
Decision: CANCELLED / SUPERSEDED / EXPIRED decision states; EXPIRED /
REVOKED approval states; STALE as a context condition (fail closed for
consequential actions); no additional states.
Rationale: task §27; avoids state explosion while covering audit truth.
Impact: state machine (P5-05 persistence), policy (P5-03 horizon).
Downstream Owner: P5-03, P5-04, P5-05.

### AD-023 — Legacy Vocabulary Protection
Status: **FROZEN** (naming rules); mechanics PROVISIONAL
Decision: P5 approval vocabulary reserved and qualified; alert
acknowledgement and P2 "approved" status are never conflated; P5
explanation language policy (mirroring P4 BANNED_PHRASES) required.
Rationale: P5-01 C-001/C-002/C-003.
Impact: naming conventions for all P5 code/docs.
Downstream Owner: P5-04 (approval), P5-05 (language policy).

### AD-024 — No Hidden Score
Status: **FROZEN**
Decision: no action/risk/priority/confidence score fields; `priority` is
not introduced as a numeric field (ordering, if ever needed, is a P5-03
policy outcome, not a score).
Rationale: Master §8.5/§31; P5-01 §15.
Impact: decision schema stays qualitative.
Downstream Owner: P5-03 (must not invent scores).

---

## 26. Contract Matrices

### 26.1 Action Type Matrix

| Action Type | Status | Meaning | Consequential? | Parameters? | Notes |
|---|---|---|---|---|---|
| MONITOR | PROVISIONAL (v1) | observe over next window(s) | no | window concept (optional) | advisory |
| REVIEW | PROVISIONAL (v1) | human reviews the interpretation | no | scope concept (required) | advisory |
| INVESTIGATE | PROVISIONAL (v1) | human investigates a flagged condition | no | target concept (required) | advisory |
| REDUCE_EXPOSURE | PROVISIONAL (v1) | reduce exposure class, mechanism-neutral | yes | subject scope + magnitude concept | ≠ SELL (AD-008) |
| INCREASE_EXPOSURE | PROVISIONAL (v1) | increase exposure class, mechanism-neutral | yes | subject scope + magnitude concept | ≠ BUY (AD-008) |
| REBALANCE | PROVISIONAL (v1) | adjust allocation between subjects | yes | subject set + target allocation concept | ≠ portfolio engine |
| ESCALATE | CANDIDATE | elevate decision authority | no (workflow) | authority concept | P5-04 decides |
| EXECUTE | CANDIDATE | execution-layer concept | would (downstream) | n/a in v1 | NOT a v1 type (AD-006) |
| NO_ACTION | — (DecisionOutcome) | no action selected | n/a | n/a | not a type (AD-003) |

### 26.2 Action State Matrix

| State | Status | Meaning | Owner Layer | Terminal? |
|---|---|---|---|---|
| DECIDED | PROVISIONAL | decision produced | decision | normal terminal |
| CANCELLED | PROVISIONAL | decision withdrawn | decision | yes |
| SUPERSEDED | PROVISIONAL | replaced by new decision | decision | yes |
| EXPIRED | PROVISIONAL | validity horizon passed | decision | yes |
| NOT_REQUIRED | PROVISIONAL | no approval needed (policy) | approval | terminal (dimension inactive) |
| REQUIRED | PROVISIONAL | approval required (policy) | approval | no |
| PENDING | PROVISIONAL | awaiting approval | approval | no |
| APPROVED | PROVISIONAL | granted by authority | approval | yes |
| DENIED | PROVISIONAL | refused by authority | approval | yes |
| EXPIRED (approval) | PROVISIONAL | not acted on in time | approval | yes |
| REVOKED | PROVISIONAL | invalidated on material change | approval | yes |
| NOT_APPLICABLE | FROZEN (v1) | no execution in v1 | execution | v1 default |
| PERMITTED | PROVISIONAL | permission granted | execution | no |
| EXECUTED | PROVISIONAL | performed | execution | yes |
| FAILED | PROVISIONAL | failed | execution | yes |
| CANCELLED (execution) | PROVISIONAL | aborted | execution | yes |

### 26.3 Candidate vs Decision Matrix

| Concept | Meaning | Created When | Immutable Fields | Downstream |
|---|---|---|---|---|
| ActionCandidate | "being considered" | decision context evaluated | candidateId, version, type, subject, p4SnapshotRef, parameters, createdAt | referenced by decision |
| ActionDecision | "formal result" | decision process completed | decisionId, outcome, selectedActionRef, p4SnapshotRef, policyVersionRef, rationaleRef, decidedAt | approval/execution binding |

### 26.4 State / Outcome / Event / Command Matrix

| Concept | Category | Meaning | Owner |
|---|---|---|---|
| DECIDED / APPROVED / EXECUTED | STATE | persistent condition | P5-02/P5-04/later |
| SELECTED / NO_ACTION / BLOCKED / NOT_DETERMINED | OUTCOME | decision result | P5-02 |
| DecisionProduced / DecisionSuperseded / ApprovalGranted / ExecutionCompleted | EVENT | occurred facts | P5-05 |
| DecideAction / ApproveAction / ExecuteAction | COMMAND | requested operations (idempotency subjects) | P5-03/04/later |
| ActionDecision | DECISION | persisted record | P5-02 |

### 26.5 Identity Matrix

| Identity | Purpose | Scope | Lifetime | Used By |
|---|---|---|---|---|
| candidateId | considered-action identity | candidate | candidate lifetime | audit, decision refs |
| decisionId | decision identity | decision | decision lifetime | audit, approval binding, replay |
| actionId | proceeding action instance (iff SELECTED) | action | action lifetime | approval/execution binding |
| idempotencyKey (conceptual) | command duplicate suppression | command | command scope | P5-03/05 |

### 26.6 Provenance Matrix

| Field/Reference | Source | Required? | Immutable? |
|---|---|---|---|
| p4SnapshotRef | P4 ViewModel identity + versions + asOf + contentHash | yes | yes (after DECIDED) |
| evidence refs | P4 `EvidenceReference[]` (referenced, not duplicated) | yes | yes |
| policyVersionRef | P5-03 | yes (after evaluation) | yes |
| safety/guardrail version ref | P5-04 | when evaluated | yes |
| decisionId / actionId | P5-02 identity model | yes | yes |
| action-model semanticVersion | this document | yes | yes |
| P4 interpretationRuleVersion | P4 (consumed) | yes | yes |

### 26.7 Parameter Matrix

| Action Type | Parameter Concept | Required? | Semantic Constraint | Owner |
|---|---|---|---|---|
| MONITOR | window concept | no | positive duration concept | P5-03 validation |
| REVIEW | scope concept | yes | references P4 scope | P5-03 |
| INVESTIGATE | target concept | yes | references signal/degradation target | P5-03 |
| REDUCE_EXPOSURE | subject scope + magnitude concept | yes | concept only; no numeric limits | P5-03/04 |
| INCREASE_EXPOSURE | subject scope + magnitude concept | yes | concept only; no numeric limits | P5-03/04 |
| REBALANCE | subject set + target allocation concept | yes | concept only | P5-03/04 |

---

## 27. Conceptual Flow

```
P4DecisionSupport  ────────────────►  (consumed as opaque input; AD-001)
        ↓
ActionCandidate                      [P5-02 OWNED — value object, AD-012]
        ↓
ActionDecision                       [P5-02 OWNED — outcomes AD-003/004;
                                       states AD-009; identity AD-013]
        ↓
Eligibility / Policy                 [P5-03 — DOWNSTREAM (result slot AD-010)]
        ↓
Safety                               [P5-04 — DOWNSTREAM (ref slot AD-021)]
        ↓
Approval                             [P5-04 — DOWNSTREAM (approvalState)]
        ↓
Execution Permission                 [P5-04 / later — DOWNSTREAM]
        ↓
Execution                            [later — DOWNSTREAM]
        ↓
Execution Result                     [later — DOWNSTREAM]
```

Conceptual only — not production architecture.

---

## 28. Open Semantic Questions

| # | Question | Evaluation at P5-02 | Status |
|---|---|---|---|
| 1 | Is NO_ACTION an ActionType or DecisionOutcome? | DecisionOutcome (AD-003) — type semantics empty | DECIDED |
| 2 | Is EXECUTE a valid v1 ActionType? | Not in v1; CANDIDATE execution-layer concept (AD-006) | DECIDED (CANDIDATE) |
| 3 | One state machine or multiple orthogonal? | Three orthogonal dimensions (AD-009) | DECIDED (PROVISIONAL) |
| 4 | Candidate ↔ Decision relationship? | Candidate value object → decision result, referenced (AD-012) | DECIDED |
| 5 | candidateId/actionId/decisionId boundary? | Separate identifiers, parent→child, actionId iff SELECTED (AD-013) | DECIDED (PROVISIONAL) |
| 6 | Which fields immutable after decision? | decision core §15 (AD-016) | DECIDED |
| 7 | How does supersession work? | New decision + SUPERSEDED terminal (AD-022) | DECIDED (PROVISIONAL) |
| 8 | How is stale P4 context represented? | STALE context condition; fail closed; NOT_DETERMINED where evaluation impossible (AD-019/022) | DECIDED (PROVISIONAL) |
| 9 | Approval ref on decision or downstream object? | Reference on decision; record downstream (AD-020) | DECIDED |
| 10 | How is consequential vs non-consequential represented? | Type-level `consequential` flag (AD-005) | DECIDED (PROVISIONAL) |
| 11 | Should taxonomy membership be owner-confirmed before P5-03? | Yes — AD-005/006/007 require P5-03 + owner confirmation | OPEN (owner review) |
| 12 | Content-hash mechanism for snapshot drift? | Required semantically; mechanism PROVISIONAL | OPEN (P5-05) |

---

## 29. Downstream P5-03 / P5-04 Handoff

### P5-02 → P5-03 contract boundary

P5-03 consumes: ActionType (v1 proposal §7.2), ActionCandidate contract
(§8), ActionDecision contract (§9), outcome semantics (AD-004),
eligibility result slot (AD-010), identity semantics (AD-013), evidence/
provenance refs (AD-014/§15), idempotency boundary (AD-018).

P5-03 defines: eligibility rules; policy evaluation; selection; priority;
cooldown; duplicate suppression; decision-command idempotency; horizon for
decision EXPIRY. P5-03 must NOT invent scores (AD-024) and must not map
Direction → action (AD-008).

### P5-02 → P5-04 contract boundary

P5-04 consumes: ActionType consequentiality flag (AD-005), state
dimensions approvalState/executionState (AD-009), blocker report shape
(AD-011), approval reference boundary (AD-020), safety reference slot
(AD-021), UNKNOWN/DEGRADED representation (AD-019).

P5-04 defines: safety/guardrail rules; approval rules + authority; per-
action approval mapping (deferred by Master §16); automation authority
(ADVISORY-only v1 default); execution permission boundary; resolution of
ESCALATE (AD-007). P5-04 must not define execution mechanics (v1).

---

## 30. Acceptance Criteria

P5-02 exit criteria — all met:

- [x] Action Model semantics documented (§6-§9)
- [x] Action taxonomy formally evaluated (§7, AD-005/006/007)
- [x] Candidate vs Decision defined (§8/§9, AD-012)
- [x] Action state semantics defined (§10, AD-009)
- [x] State/outcome/event/command distinction documented (§11)
- [x] Identity model defined (§12, AD-013)
- [x] Evidence/provenance model defined (§13, AD-014)
- [x] Parameter semantics defined (§14, AD-015)
- [x] Versioning semantics defined (§16, AD-017)
- [x] Immutability/material-change semantics defined (§15, AD-016)
- [x] Idempotency boundary documented (§17, AD-018)
- [x] UNKNOWN/DEGRADED semantics preserved (§18, AD-019)
- [x] Approval boundary documented (§19, AD-020)
- [x] Policy boundary documented (§20, AD-021)
- [x] Eligibility boundary documented (§21, AD-010)
- [x] Safety boundary documented (§22, AD-021)
- [x] Legacy vocabulary collisions addressed (§24, AD-023)
- [x] Decision records included (§25)
- [x] Contract matrices included (§26)
- [x] Conceptual model included (§27)
- [x] Open questions documented (§28)
- [x] P5-03 handoff defined (§29)
- [x] P5-04 handoff defined (§29)
- [x] No production code changed
- [x] No P4/P4-06 changes
- [x] Exactly one document created

---

## Appendix A — Repository Evidence Used

- `src/lib/p4/types.ts:280` — `P4DecisionSupportViewModel` (input contract)
- `src/lib/p4/service.ts:133` — `getP4DecisionSupport` → ViewModel | null
- `src/app/api/narratives/[id]/route.ts:150-152,180` — additive route field
- `src/lib/p4/explanation/templates.ts:243-253` — `BANNED_PHRASES` (P5-05 language policy precedent)
- `src/db/schema.ts:687-724` — alert rules/history (C-001)
- `src/lib/services/alert.service.ts:60` — acknowledgement (C-001)
- `src/lib/p4/mapper.ts:612` — "approved" P2 evidence status (C-002)
- `src/lib/features/engine.ts:186-197` — legacy bullish language (C-003)
- P5-01 audit §5 (P4 input contract EXISTS), §17 (reuse matrix), §19 (conflict register)

## Appendix B — P5-01 Findings Consumed

- P4 input contract: EXISTS, complete → P5-02 defines consumption boundary only
- No BUY/SELL mapping found → AD-008 records the invariant as preserved
- No approval/automation infra → AD-009/AD-020 design approval as a new dimension
- Reuse matrix → AD-014 (no persisted P4 row to reference), AD-023 (legacy vocabulary)
- P4-06: no blocking dependency → §2 independence

## Appendix C — Rejected Alternatives

1. NO_ACTION as an ActionType — rejected (AD-003): empty semantics.
2. Single-enum state machine (CANDIDATE → ELIGIBLE → APPROVED → EXECUTABLE → EXECUTED) — rejected (AD-009): invalid combinations.
3. Two state dimensions (decision + execution) — rejected (AD-009): approval not independently traceable.
4. EXECUTE as v1 ActionType with execution semantics — rejected (AD-006): v1 is ADVISORY-ONLY.
5. Copying P4 evidence into the P5 decision — rejected (AD-001): Master §19 reference-don't-duplicate.
6. Composite hash as decision identity — rejected (AD-013): hash applies to snapshot payload, not decision identity.
7. Per-action state machines — rejected (AD-009): complexity without benefit.

## Appendix D — Terminology Glossary

| Term | Definition |
|---|---|
| ActionCandidate | "this action is being considered" — value object (§8) |
| ActionDecision | "the P5 process produced a formal decision" — persisted record (§9) |
| ActionType | classification of action intent (§7) |
| DecisionOutcome | SELECTED / NO_ACTION / BLOCKED / NOT_DETERMINED (AD-004) |
| decisionState | DECIDED / CANCELLED / SUPERSEDED / EXPIRED (§10) |
| approvalState | NOT_REQUIRED … REVOKED (§10) |
| executionState | NOT_APPLICABLE … CANCELLED (§10) |
| p4SnapshotRef | identity+version+asOf+contentHash reference (AD-014) |
| consequential | type-level flag: may lead to downstream side effects (AD-005) |
| material change | change to type/subject/parameters/context/policy requiring a new decision (AD-016) |
| STALE (context) | decision references outdated P4 context; fail closed (AD-022) |
| idempotencyKey | conceptual command-layer duplicate-suppression key (AD-018) |

---

*End of P5-02 Semantic Contract / Action Model. Contract/semantic design
only — no implementation. P5-03 may begin only after owner review and
approval of this document.*
