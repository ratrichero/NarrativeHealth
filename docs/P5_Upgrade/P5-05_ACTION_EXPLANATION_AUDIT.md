# P5-05 — ACTION EXPLANATION & AUDIT
## MASTER DESIGN & SEMANTIC SPECIFICATION

**Repository:** https://github.com/ratrichero/NarrativeHealth
**Phase:** P5 — What action, if any, should be executed?
**Task:** P5-05 — Action Explanation & Audit
**Document status:** FROZEN / APPROVED FOR DOWNSTREAM (P5-05 R2 — freeze check)
**Version:** p5-explanation/v1
**Task type:** CONTRACT / SEMANTIC DESIGN — documentation only, no production code

---

## 1. Executive Summary

P5-05 defines the semantic contract for **explaining and auditing P5 action
decisions**. It answers the primary question:

> Why did the system reach this action decision, what evidence / policy /
> safety / approval context supported or prevented it, and can that decision
> be reconstructed later?

The contract is built on two frozen invariants:

1. **P5-05 explains and records decisions; it never makes new decisions.**
2. **Audit is the authoritative historical record; explanation is a derived,
   non-authoritative, human-facing interpretation of recorded facts.**

P5-05 consumes the outputs of P5-03 (Action Decision / Policy Engine) and
P5-04 (Safety / Guardrail / Approval Engine) and provides, per `decisionId`:

- **Explanation** — WHAT was decided, WHY, BASED ON WHAT, under WHICH
  policy/safety/approval context, CURRENT STATE, and WHAT DID NOT HAPPEN;
- **Provenance** — exact references (P4 snapshot, policy, guardrail, approval,
  versions, actors, timestamps) so every claim is traceable;
- **Audit** — an append-only logical event history of the decision lifecycle;
- **Lifecycle history** — events, states, outcomes, and commands kept
  semantically distinct;
- **Replayable understanding** — a historical decision can be reconstructed
  from recorded references without live mutable data.

No production code, no P3/P4/P4-06 changes, no policy/safety/approval/
execution rules, no hidden scores, no BUY/SELL semantics. Following the
owner-authorized freeze check (P5-05 R2, §40-§43), the document is
**FROZEN / APPROVED FOR DOWNSTREAM**: this freeze applies only to FROZEN
semantics; PROVISIONAL / CANDIDATE / OPEN / DEFERRED / OUT OF SCOPE items
remain unchanged.

---

## 2. Authority & Inputs

The following documents are authoritative:

| Document | Status | Role for P5-05 |
|---|---|---|
| `docs/P5_Upgrade/P5_MASTER_SPECIFICATION.md` | FROZEN | §19 evidence/provenance, §20 explanation, §22 idempotency, §23 failure/retry, §24 audit trail, §25 versioning, §30 contradiction governance, §31 auditability |
| `docs/P5_Upgrade/P5-01_CONTRACT_GAP_AUDIT.md` | APPROVED | reusable-component inventory; legacy vocabulary findings C-001/C-002/C-003; rule-engine/event-log precedents |
| `docs/P5_Upgrade/P5-02_SEMANTIC_CONTRACT_ACTION_MODEL.md` | APPROVED | AD-003/004 outcomes, AD-009 state dimensions, AD-011 BLOCKED, AD-013 identity hierarchy, AD-014 p4SnapshotRef, AD-016 material change, AD-018 idempotency, AD-019 UNKNOWN/DEGRADED, AD-023 legacy vocabulary, AD-024 no hidden score |
| `docs/P5_Upgrade/P5-03_ACTION_DECISION_POLICY_ENGINE.md` | FROZEN / APPROVED FOR DOWNSTREAM | PD-003 selection, PD-009 failure, PD-011 replay, PD-018 BLOCKED provenance, PD-019 suppression outcome |
| `docs/P5_Upgrade/P5-04_SAFETY_GUARDRAIL_APPROVAL_ENGINE.md` | FROZEN / APPROVED FOR DOWNSTREAM | SG-002/003/004 guardrail outcomes + blocker provenance, SG-005/006/008 approval, SG-011 permission, SG-016 LLM, SG-017 replay, SG-018 version separation |

These documents are **not modified** by P5-05.

**P4-06 remains OPEN / DATA ACCRUAL.** P5-05 has no dependency on P4-06
closure and promotes no P4 provisional rules (§31).

---

## 3. P5-05 Scope

**P5-05 owns:**

- the explanation contract (semantic content, levels, provenance backing);
- the provenance contract (what must be traceable, in what form);
- the audit trail contract (logical append-only event history);
- the audit event vocabulary and event contract (fields + conditionality);
- immutability, correction, revocation, and supersession semantics;
- replayability requirements (what artifacts reconstruct a decision);
- contradiction-recording semantics;
- legacy vocabulary protection for explanation/audit text;
- the idempotency *recording* boundary (what identities are recorded, not
  how commands are executed);
- versioning semantics for the explanation/audit contract itself.

**P5-05 does NOT own:**

- policy evaluation, eligibility, selection (P5-03);
- safety evaluation, guardrails, approval, authority, automation, execution
  permission (P5-04);
- execution mechanics, order placement, portfolio mutation (OUT OF SCOPE);
- audit **persistence implementation** (DB schema, storage) — PROVISIONAL,
  per Master §24/§31;
- UI presentation of explanations (P5-06 read/API/UI).

---

## 4. Hard Boundary — Explains, Never Decides

Frozen (EX-001, EX-002):

```
P3 = What is happening?
P4 = What does it mean?
P5 = What should be done?
P5-05 = Why was this P5 decision made, and can it be reconstructed?
```

P5-05 is a **read-side contract over recorded facts**. It MUST NOT:

- re-interpret P3 or P4 (no new interpretation layer over raw data);
- create policy, eligibility, safety, approval, or execution rules;
- produce a new P5 decision, or re-rank/re-select among candidates;
- change a decision outcome, approval state, or permission state;
- create BUY/SELL mapping or hidden scores.

Any component that *derives* explanation or audit content performs
**rendering/reconstruction only**; the decision, approval, and permission
records remain authoritative and unchanged.

---

## 5. Core Purpose & Primary Question

The P5-05 contract must support, deterministically and auditably, answering
from a single `decisionId`:

| Question | Answered by |
|---|---|
| What decision was made? | decision record (outcome, action type, parameters) |
| Why was it made? | policy reason refs, rule refs, selection rationale |
| What P4 evidence snapshot supported it? | `p4SnapshotRef` (identity, asOf, version tuple, status, contentHash) |
| Which policy/version produced it? | `policyId`, `policyVersion`, `effectiveAt`, `evaluationAt`, `ruleId` |
| Was it blocked by policy, safety, or approval? | blocker provenance (POLICY-BLOCKED / SAFETY-BLOCKED / APPROVAL-DENIED) |
| What approval/authority state existed? | approval record ref (state, authority, actor, timestamp, scope) |
| Was execution permission granted? | permission record ref (executionState, permission identity) |
| Was anything actually executed? | executionState (v1: NOT_APPLICABLE) — execution events are CANDIDATE |
| Can the historical state be reconstructed later? | replay contract (§26) from exact references |

The final success condition: **P5-05 explains a decision that already
exists; it never creates a new one.**

---

## 6. Explanation Model

A formal explanation contract (EX-001). Every explanation is **derived from
the decision record and audit events** — it is never a free-form statement.

Minimum semantic content an explanation must convey:

| Slot | Meaning | Backing (must reference) |
|---|---|---|
| WHAT | the decision outcome (SELECTED / NO_ACTION / BLOCKED / NOT_DETERMINED) and, if selected, the ActionType + parameters | decision record |
| WHY | the policy rationale: which rule(s) produced the outcome, selection/rejection reason | policy version refs, rule refs, reason code (P5-03) |
| BASED ON WHAT | the exact P4/evidence context consumed | `p4SnapshotRef`, P4 evidence refs |
| POLICY | policy identity + version + effective/evaluation time | policy provenance (§12) |
| SAFETY / GUARDRAIL | guardrail results that were evaluated and their aggregate | guardrail refs + versions (§13) |
| APPROVAL | approval state, and the approval record when one exists | approval ref (§14) |
| CURRENT STATE | decisionState / approvalState / executionState at explanation time | state refs |
| WHAT DID NOT HAPPEN | alternatives considered and rejected; the specific no-action case; what was not executed | candidate refs, outcome refs, permission refs |

**No orphan claims.** Every substantive clause of an explanation must map to
a recorded fact (decision field, audit event, policy rule, guardrail result,
approval record). A bare statement such as `reason: "risk is high"` with no
provenance is **not** an explanation under this contract.

Explanation is deterministic and template/policy-derived (Master §20). Two
explanations of the same recorded decision at the same state MUST render the
same semantic content.

---

## 7. Decision Explanation ≠ Recommendation

Frozen (EX-001):

- A **decision explanation** describes a decision that **already exists**.
- A **recommendation** proposes a *future* action.

P5-05 produces only decision explanations. Example: an explanation of a
POLICY-BLOCKED decision states *"candidate C was blocked by policy rule R
under policy version V"* — it does NOT continue with *"therefore SELL"* or
any other new recommendation. No explanation may end in a recommendation
that is not already the recorded decision.

---

## 8. NO_ACTION Explanation — Critical Gate

P5-02 AD-003/AD-004 and P5-03 PD-003/PD-019 define the outcome vocabulary.
P5-05 MUST explain each case **without collapsing them**:

| Case | Meaning | Explanation MUST state | NEVER rendered as |
|---|---|---|---|
| NO_ACTION | policy evaluation **completed**; no action was selected; nothing unresolved | completed evaluation + policy ref + no eligible/selected candidate | BLOCKED / NOT_DETERMINED / SUPPRESSED |
| POLICY-BLOCKED | a candidate existed but a policy rule prevents selection | candidate ref + blocking rule refs + blockerReport.source = POLICY | NO_ACTION |
| NOT_DETERMINED | the system could not reliably determine the outcome | the unresolved cause (unusable input, failure, dependency) + failure/degradation refs | NO_ACTION |
| SUPPRESSED | cooldown/duplicate suppression applied; **no decision was produced** | suppression reason (cooldown/duplicate equivalence refs) — distinguishable in the audit trail (P5-03 PD-019 requires this) | NO_ACTION |
| SAFETY-BLOCKED | otherwise eligible/selected action rejected by safety | guardrail ref + version + result + reason (§13) | NO_ACTION |
| APPROVAL-DENIED | required authority refused | approval record (actor, time, decision ref) (§14) | NO_ACTION |
| ABSENT / UNAVAILABLE | **no decision record was produced** (e.g., P4 returned null / identity rejected / evaluation never ran — P5-02 §18) | "no decision record exists" + the absence cause refs; the read path has no action decision | NO_ACTION (never a completed no-action evaluation) |

The four "no action" cases of P5-02 (completed NO_ACTION / blocked /
not-determined / absent) plus the P5-03 SUPPRESSED layer result and the
P5-04 SAFETY-BLOCKED / APPROVAL-DENIED results are **eight distinct
semantic situations** (including absence: no decision record produced) and
MUST remain distinguishable in explanation and audit (§33, Explanation
Matrix; §34, Cross-Document Consistency Matrix).

---

## 9. UNKNOWN / DEGRADED / NULL Explanation

Frozen Master invariant (Master §21, P5-02 AD-019, P5-03 PD-008, P5-04
SG-002): **UNKNOWN / DEGRADED / NULL must never silently become NO_ACTION —
and P5-05 must never explain them as such.**

Explanation requirements when the source context is unusable:

1. **Preserve the cause.** If the P4 context was UNKNOWN, DEGRADED, NULL,
   STALE, or LOW-CONFIDENCE (per P4 status/degradation semantics), the
   explanation MUST carry that cause with its refs. The degradation reason
   is preserved and surfaced (Master §21: "degradation codes surfaced").
2. **No inferred action.** UNKNOWN/DEGRADED is never rendered as "nothing to
   do" (NO_ACTION), "monitor", or any other action — unless an explicit
   policy evaluation genuinely produced that outcome, in which case the
   explanation shows the policy rule, not an inference from the degraded
   state.
3. **Explain the limit.** Where the outcome is NOT_DETERMINED or a
   consequential action is blocked, the explanation states *why a stronger
   conclusion was not possible* (which input was unusable, which guardrail
   could not be evaluated).
4. **Technical failure ≠ completed no-action evaluation.** A failure that
   prevented evaluation is explained as NOT_DETERMINED/ERROR with failure
   refs — never as a completed NO_ACTION evaluation (§20).

---

## 10. Provenance Model

Provenance contract (EX-003, EX-006..EX-008). Every explanation and audit
event carries the references required to reconstruct the fact it records.
Field necessity is **classified**, not uniform:

| Class | Meaning |
|---|---|
| MANDATORY | required for every record/event of the class |
| CONDITIONAL | required when the semantic condition holds (e.g., approval ref only for approval events) |
| OPTIONAL | permitted when available; absence must not change semantics |
| UNAVAILABLE | recorded explicitly as unavailable (never silently omitted) when a mandatory/conditional field cannot be produced |

Core provenance references (from P5-04 §27, consumed unchanged):

| Reference | Class | Notes |
|---|---|---|
| decisionId | MANDATORY (decision-scoped) | identity of the decision (P5-02 AD-013) |
| candidateId | CONDITIONAL | candidates considered; required for blocked/suppressed explanations |
| actionId | CONDITIONAL | exists iff SELECTED (P5-02 AD-013) |
| p4SnapshotRef | MANDATORY (decision-scoped) | §11 |
| policyId / policyVersion | MANDATORY (policy-origin) | P5-03 |
| ruleId / rule outcome | CONDITIONAL | which rule(s) fired |
| guardrailId / guardrailVersion | CONDITIONAL (safety-origin) | P5-04 |
| approvalId / approvalState | CONDITIONAL (approval-origin) | P5-04 |
| authority reference | CONDITIONAL (approval/permission) | P5-04 |
| automation mode | CONDITIONAL (permission context) | P5-04 (v1: ADVISORY) |
| timestamps | MANDATORY | evaluatedAt / recordedAt / event time |
| actor / source | CONDITIONAL | who/what caused the event |
| material-change state | CONDITIONAL | when relevant to validity |
| explanation/audit contract version | MANDATORY | which P5-05 contract version produced this content |

Provenance is **referenced, not duplicated** (Master §19): P4 evidence is
never copied into the explanation; it is identified by reference.

---

## 11. P4 Snapshot Reference

Preserved verbatim from P5-02 AD-014:

```
p4SnapshotRef = {
  narrativeIdentity,      // narrativeId, window, algorithmKey, algorithmVersion, calculationMode
  asOf,                   // latest artifact window end
  versionTuple,           // algorithmVersion, semanticVersion, signalCatalogVersion, interpretationRuleVersion
  status,                 // OK | DEGRADED | NO_EVIDENCE | ERROR
  contentHash             // PROVISIONAL: hash of canonical semantic payload, excluding generatedAt
}
```

P5-05 requirements (EX-010, EX-005):

- Every decision explanation MUST state which `p4SnapshotRef` it was built
  on.
- The anti-drift rule (FROZEN, P5-02 AD-014) is enforced at the explanation
  level: an explanation MUST NOT silently substitute the **current live**
  ViewModel when the decision references an older snapshot. If the live P4
  context differs from the referenced snapshot, that difference is either
  (a) irrelevant to the recorded decision, or (b) a material change that
  would require a **new decision** — never a silent re-interpretation of the
  old one.
- `contentHash` verification is a P5-05/06 implementation concern
  (PROVISIONAL); the identity + version + asOf tuple is the FROZEN minimum
  reference for explanation/replay.

---

## 12. Policy Provenance

Explanation must trace policy origin (EX-006):

| Field | Purpose |
|---|---|
| policyId | which policy |
| policyVersion | which version governed (P5-03 PD-012) |
| effectiveAt / evaluationAt | when it was applicable / when evaluated |
| ruleId(s) | which rule(s) produced the outcome |
| rule outcome | what each rule contributed (eligible / blocked / suppressed / selected) |

Boundary rules:

- **ruleId is a technical reference, not a priority statement** (P5-03
  PD-004): the explanation never implies `R001 > R002` or that a lower
  ruleId means higher business priority.
- **Machine audit vs human-readable**: the audit record carries the full
  rule references; the human-readable explanation may summarize, but every
  summary claim must remain derivable from the audit record. Internal
  implementation details not required by the contract are not exposed in
  human text.
- Policy **values/rules are not defined here**; P5-05 only references them.

---

## 13. Safety / Guardrail Explanation

When a selected/eligible action is rejected by safety (EX-007):

- The explanation MUST state **SAFETY-BLOCKED** (never re-labeled
  NO_ACTION, POLICY-BLOCKED, or APPROVAL-DENIED).
- Provenance MUST trace (P5-04 SG-004, §12):
  - `blockerSource = SAFETY`, `blockerId`;
  - guardrail reference + guardrail version;
  - guardrail result (PASS / BLOCK / NOT_DETERMINED / UNAVAILABLE / ERROR /
    NOT_APPLICABLE — P5-04 §10);
  - `evaluatedAt`, reason, evidence refs, actor where applicable.
- When the guardrail outcome is NOT_DETERMINED / UNAVAILABLE / ERROR, the
  explanation distinguishes **"safety could not be established"** (inability)
  from **"safety was violated"** (BLOCK) — both are explained distinctly and
  neither is explained as NO_ACTION.

---

## 14. Approval Explanation

When approval is denied, expired, or revoked (EX-008):

- The explanation MUST state **APPROVAL-DENIED** (or the actual approval
  state), distinct from SAFETY-BLOCKED and POLICY-BLOCKED.
- Provenance MUST trace: `approvalId`, `approvalState`, authority reference,
  actor, timestamp, scope (exact approved parameters/version), decision/
  action reference, approval policy version, and invalidation semantics
  (P5-04 §13, §31).
- **Acknowledgement ≠ approval** (C-001) and **P2 evidence "approved" ≠ P5
  approval** (C-002): an explanation MUST never present an alert
  acknowledgement or a P2 evidence status as approval (§28).
- If approval was NOT_REQUIRED, the explanation states that the approval
  dimension was inactive under the governing approval policy — not that
  approval was granted.
- The mere existence of a candidate or decision NEVER implies that approval
  was granted or that execution permission existed — consideration,
  approval, and permission are separate recorded facts (G4).

---

## 15. Execution Permission Explanation

- `EXECUTION_PERMISSION_GRANTED` is an **authorization result**, never
  "executed" (P5-04 SG-011).
- An explanation MUST NOT claim execution happened merely because permission
  was granted. In v1 (ADVISORY-ONLY), execution permission for consequential
  actions is **NOT_GRANTED** (P5-04 SG-010); the explanation renders the
  permission state with its record ref.
- Execution outcome events (EXECUTION_ATTEMPTED / SUCCEEDED / FAILED) are
  **CANDIDATE** — the execution layer is out of scope; the audit contract
  reserves their identities but defines no execution semantics (§17).

---

## 16. Audit Trail

The audit trail is the **authoritative, logically append-only historical
record** of decision lifecycle facts (EX-002, EX-009). P5-05 owns the audit
**contract**; persistence design is PROVISIONAL (Master §24/§31).

The audit trail records **events** — facts that occurred — and references
**states** and **outcomes** held by the decision/approval/permission
records. It never rewrites the past (§18).

### 16.1 Audit event vocabulary (reconciled with P5-02 §10.2 / §11)

P5-02's transition table already names the events P5-02 requires
(DecisionProduced, DecisionSuperseded, DecisionExpired, DecisionCancelled,
ApprovalRequired, ApprovalGranted, ApprovalDenied, ApprovalRevoked,
ApprovalExpired, ExecutionCompleted, ExecutionFailed). P5-05 adopts that
vocabulary as canonical and adds the events the P5-03/04 contracts require.
Classification discipline is applied — **the full taxonomy is not frozen**:

| Event (canonical) | Trigger | Status | Notes |
|---|---|---|---|
| CandidateCreated | candidate considered | PROVISIONAL | P5-03 layer; record candidate ref |
| DecisionProduced | decision evaluation completed | **FROZEN** | carries decisionOutcome: SELECTED / NO_ACTION / BLOCKED / NOT_DETERMINED + policy refs |
| DecisionSuppressed | cooldown/duplicate suppression applied | **FROZEN** | P5-03 PD-019: NO decision record exists; MUST be distinguishable from NO_ACTION in the audit trail |
| DecisionSuperseded | material change; new decision issued | **FROZEN** | P5-02 §10.2 |
| DecisionExpired | validity horizon passed | **FROZEN** | horizon defined by P5-03 policy (OPEN) |
| DecisionCancelled | withdrawn by authority | **FROZEN** | P5-02 §10.2 |
| ApprovalRequired | approval requirement determined | **FROZEN** | P5-02 §10.2 |
| ApprovalGranted | human grant | **FROZEN** | P5-02 §10.2 |
| ApprovalDenied | human denial | **FROZEN** | P5-02 §10.2 |
| ApprovalExpired | approval deadline passed | **FROZEN** | duration OPEN |
| ApprovalRevoked | material change / authority or safety revocation | **FROZEN** | P5-02 §10.2 |
| PermissionGranted | execution permission granted | **FROZEN** | P5-04 (v1 consequential: never fires — NOT_GRANTED) |
| PermissionRevoked | permission invalidated | **FROZEN** | P5-04 §23 |
| PermissionExpired | permission validity passed | PROVISIONAL | duration OPEN |
| ExecutionAttempted | execution attempt begins | CANDIDATE | execution layer out of scope |
| ExecutionSucceeded | execution completed | CANDIDATE | execution layer out of scope |
| ExecutionFailed | execution failed | CANDIDATE | execution layer out of scope |

The task's SCREAMING_SNAKE vocabulary (CANDIDATE_CREATED, DECISION_CREATED,
DECISION_SELECTED, DECISION_BLOCKED, DECISION_SUPPRESSED, APPROVAL_REQUESTED,
APPROVAL_GRANTED, APPROVAL_DENIED, PERMISSION_GRANTED, PERMISSION_REVOKED,
DECISION_EXPIRED, DECISION_CANCELLED, DECISION_SUPERSEDED,
EXECUTION_ATTEMPTED, EXECUTION_SUCCEEDED, EXECUTION_FAILED) is reconciled as
follows: DECISION_SELECTED/BLOCKED/NOT_DETERMINED/NO_ACTION are carried as
the **decisionOutcome field** of DecisionProduced (the outcome is a property
of the decision record, not a separate event — P5-02 §11 outcome/event
separation); DECISION_CREATED ≡ DecisionProduced; APPROVAL_REQUESTED ≡
ApprovalRequired. This avoids event explosion while preserving every
distinction the task requires (BLOCKED provenance, SUPPRESSED vs NO_ACTION,
approval vs safety vs policy).

---

## 17. Audit Event Contract

Each audit event (EX-011) has fields with explicit conditionality:

| Field | Class | Notes |
|---|---|---|
| eventId | MANDATORY | stable identity of the event (idempotent recording key) |
| eventType | MANDATORY | from §16.1 vocabulary |
| timestamp | MANDATORY | when the fact occurred (recorded time) |
| actor / source | MANDATORY (non-system) / CONDITIONAL | who/what caused the event; SYSTEM for deterministic evaluation events |
| decisionId | MANDATORY (decision events) | absent only for DecisionSuppressed / CandidateCreated |
| candidateId | CONDITIONAL | candidate ref (blocked/suppressed/selected explanations) |
| actionId | CONDITIONAL | exists iff SELECTED |
| previous state | CONDITIONAL | transition events only |
| new state / outcome | CONDITIONAL | transition events only; DecisionProduced carries decisionOutcome |
| reason | CONDITIONAL | blocker/failure/suppression reason refs |
| policy version | CONDITIONAL (policy-origin) | P5-03 |
| safety/guardrail reference | CONDITIONAL (safety-origin) | P5-04 |
| approval reference | CONDITIONAL (approval-origin) | P5-04 |
| provenance | MANDATORY | the refs required to reconstruct the event (§10) |
| correlation / idempotency reference | CONDITIONAL | links events of one lifecycle; idempotency-recorded, not command-executed (§19) |

Conditionality is a contract property, not a suggestion: an event missing a
MANDATORY field is malformed and must be recorded as an audit defect (a
recorded event — never silently dropped, never retroactively filled).

---

## 18. Audit Immutability

Frozen (EX-009):

1. **Append-only logical history.** Events are only ever added; the past is
   never rewritten, deleted, or edited.
2. **Correction by compensating event.** A mistaken record is corrected by
   a new event (e.g., `ApprovalRevoked` following an erroneous
   `ApprovalGranted`), never by editing the original.
3. **Revocation does not delete approval history.** `APPROVED → REVOKED`
   leaves the APPROVED event intact; revocation is a new fact.
4. **Supersession does not rewrite the previous decision.**
   `DECIDED → SUPERSEDED` leaves the original decision record and its
   events intact; the new decision is a separate record.
5. **Explanation never rewrites audit.** If a later explanation differs from
   recorded facts, the recorded facts win; the discrepancy is a defect or a
   new event — never a rewrite (EX-002/003).

---

## 19. Idempotency & Duplication

P5-05 **records** idempotency information; it does not become a command
engine (EX-014, Master §22, P5-02 AD-018, P5-04 §29).

Scope separation — never one universal key:

| Identity | Scope | Owned by | P5-05 role |
|---|---|---|---|
| decisionId | one decision evaluation | P5-02/03 | recorded on events |
| actionId | one action instance (iff SELECTED) | P5-02 | recorded on events |
| eventId | one audit event | **P5-05** | stable identity; recording must be idempotent (same event not double-recorded) |
| idempotencyKey | duplicate suppression for commands | P5-03/04/later (implementation) | recorded as reference only |
| executionId | one execution attempt (future) | execution layer | OUT OF SCOPE; reserved identity only |

Distinction preserved: **same decision ≠ same execution attempt** (P5-02
AD-018). P5-05 may use decisionId + eventId to detect duplicate *event
recording*, but it does not define or implement duplicate suppression for
decisions (P5-03), approvals/permissions (P5-04), or execution (future).

---

## 20. Failure Semantics

Every failure class is recorded distinctly and explained distinctly
(EX-015, P5-03 PD-009, P5-04 §30). **No failure is collapsed into
NO_ACTION.**

| Failure | Recorded outcome | Explanation states | Permission implication |
|---|---|---|---|
| policy evaluation failure | NOT_DETERMINED + failure reason | why evaluation could not complete | n/a (no decision) |
| safety evaluation failure | ERROR / NOT_DETERMINED | why safety could not be established | no permission (consequential) |
| guardrail unavailable | UNAVAILABLE | which input/system was unavailable | no permission (consequential) |
| approval unavailable | NOT_DETERMINED | approval could not be obtained/verified | no permission (consequential) |
| authority resolution failure | NOT_DETERMINED | authority could not be resolved | no permission (consequential) |
| permission evaluation failure | ERROR / NOT_DETERMINED | why permission could not be evaluated | no permission (consequential) |
| system error | ERROR | system-level failure recorded | no permission (consequential) |

The explanation contract requires: **for every failure, say why the system
could not reach a stronger conclusion** — never silently substitute
NO_ACTION, and never render failure as a completed no-action evaluation
(§8, §9).

DECISION FAILURE vs EXECUTION FAILURE (Master §23) remain distinct:
execution-failure semantics are modeled as CANDIDATE events only.

---

## 21. Versioning

No universal version (EX-018, P5-04 SG-018). The version dimensions already
frozen upstream are consumed as references:

P4 version tuple · algorithm version (P4) · action-model version (P5-02) ·
policy version (P5-03) · guardrail version (P5-04) · approval policy version
(P5-04) · authority version (P5-04) · automation configuration version
(P5-04).

P5-05 adds only the versions of its own contract:

| Version | Meaning | Status |
|---|---|---|
| explanation contract version (`p5-explanation/v1`) | semantics of this document | FROZEN (P5-05 R2) |
| audit event schema version | vocabulary + field contract (§16-§17) | PROVISIONAL (persistence deferred) |

Each event/explanation carries **only the versions relevant to it**
(conditional, §10). A decision produced under policy version X is never
explained or audited as if evaluated under policy version Y (P5-03 PD-012).

---

## 22. Human-Readable Explanation

Explanation **levels** are semantic content levels, not UI design (EX-012):

| Level | Semantic content | Owner |
|---|---|---|
| SUMMARY | outcome + one-line why + snapshot ref | semantic content contract |
| DETAILED | full §6 slots with all refs | semantic content contract |
| AUDIT | the authoritative record view (events + records) | audit contract |

- The level is a property of the *content requested*, not of the rendering
  technology. UI/presentation design belongs to P5-06 and is NOT frozen
  here (Master §20, §31).
- SUMMARY/DETAILED content must be **derivable from** the AUDIT view; they
  may not contain facts absent from the audit record.
- Human text is deterministic and template-derived; banned-phrase policy
  applies (§28).

---

## 23. Machine-Readable Explanation

- A structured explanation separates **semantic fields** (outcome, refs,
  versions, states — §6, §10) from **presentation fields** (layout, labels,
  copy). Only semantic fields are part of the P5-05 contract.
- No frontend format is hard-coded. P5-06 decides the wire format; P5-05
  guarantees the semantic content is complete and self-describing.
- Structured explanation is authoritative over any rendering of it: a
  rendering (human text, LLM text) is a projection of the structured
  content, never an independent source (§24, §25).

---

## 24. LLM Boundary

Frozen (EX-013, P5-04 SG-016, P5-03 PD-016, Master §20):

- **LLM is not the source of truth** for explanation or audit.
- LLM MAY assist **natural-language rendering** of explanation content ONLY
  when the contract permits and the structured decision/audit data remains
  authoritative.
- LLM MUST NOT:
  - change a decision, policy result, safety result, approval, or audit
    history;
  - invent evidence, reasons, or provenance;
  - fill missing fields;
  - decide explanation level semantics.
- Any LLM-rendered text is a derived projection; discrepancies with the
  structured record are resolved in favor of the structured record, and the
  discrepancy is recorded (defect or new event — §18).

(Repository note: the current codebase has **no LLM in any decision or
explanation path** — P4 interpretation/explanation are template-based
(`src/lib/p4/interpretation.ts`, `src/lib/p4/explanation/templates.ts`).
P5-05 inherits that discipline.)

---

## 25. Audit vs Explanation

Frozen (EX-002, EX-003):

| | Explanation | Audit |
|---|---|---|
| Nature | derived, human-facing interpretation of recorded facts | authoritative historical record |
| Source of truth? | NO | YES (with the decision/approval/permission records) |
| Mutable? | regenerable from records | logically append-only (§18) |
| Rewritten by the other? | never | never |

- Explanation is never the source of truth for a later audit.
- Audit is never rewritten to match an explanation.
- Both derive from the same recorded facts; disagreement is a defect, not a
  license to edit history.

---

## 26. Replayability

Frozen (EX-010, P5-03 PD-011, P5-04 SG-017, Master §24):

From a `decisionId`, a historical decision must be reconstructable using
recorded artifacts — **never current live mutable data**:

| Artifact | Required? |
|---|---|
| decision record (outcome, action type, parameters, decisionState) | MANDATORY |
| p4SnapshotRef (identity + version + asOf + contentHash) | MANDATORY |
| evidence refs (P4 `EvidenceReference[]`) | MANDATORY |
| policyId / policyVersion / effectiveAt / evaluationAt / rule refs | MANDATORY |
| guardrailId / guardrailVersion / guardrail results | CONDITIONAL (safety-origin) |
| approval record (approvalId, state, authority, actor, timestamp, scope) | CONDITIONAL (approval-origin) |
| authority reference / automation mode | CONDITIONAL (permission context) |
| permission record (executionState, permission identity) | CONDITIONAL |
| audit events for the lifecycle | MANDATORY |

Replay MUST NOT depend on the current P4 ViewModel, current policy version,
current guardrail version, or current approval configuration (P5-04 §28).
If the referenced snapshot is unavailable, replay reports
`UNAVAILABLE` with the missing reference — it does not substitute live data.

---

## 27. Contradiction Governance

When explanation/audit sources conflict (EX-016, Master §30, P5-04 §24):

- **Record, do not resolve silently.** Contradictions are recorded as
  `CONTRADICTION` / `UNRESOLVED` (or the semantic already defined by the
  upstream contract) in the audit context.
- **No scoring.** Contradictions are never resolved by score, majority vote,
  or "highest confidence".
- **No silent latest-wins.** "Latest version wins" is only used where an
  explicit policy defines version precedence (P5-03 PD-004); otherwise both
  sides are preserved and the contradiction is recorded.
- For consequential actions, unresolved safety-relevant conflicts mean
  **no execution permission** (P5-04 SG-015) — and the explanation states
  that the conflict prevented a stronger conclusion (§20).

Contradiction classes recorded: P4 evidence conflict, policy conflict,
guardrail conflict, approval conflict, version mismatch, stale evidence.

---

## 28. Legacy Vocabulary Protection

Frozen (EX-017, P5-02 AD-023, P5-01 C-001/C-002/C-003):

| Legacy term | P5 meaning | Allowed usage |
|---|---|---|
| `acknowledged` / `acknowledged_at` (alert) | post-hoc awareness, **NOT approval** (C-001) | never rendered as approval; only as the legacy fact if quoted with qualification |
| P2 evidence status `approved` | event-risk evidence status, **NOT P5 approval** (C-002) | never rendered as approval; qualified if referenced |
| bullish language ("Strong bullish signals...") | legacy directional tier text (C-003) | **banned** in P5 explanation text — banned-phrase policy mirroring P4's `BANNED_PHRASES` (`src/lib/p4/explanation/templates.ts:243-253`) |
| recommendation (STRONG_WATCH/WATCH/OBSERVE...) | legacy P3-era signal | never rendered as a P5 action decision; recommendation ≠ execution |

No legacy semantics are migrated; legacy systems are not modified.

---

## 29. No Hidden Score / Threshold

Frozen (EX-019, P5-02 AD-024, P5-04 SG-020):

- No explanation score, audit confidence score, risk score, action score, or
  priority score is introduced.
- No numeric thresholds, cutoffs, or weights are introduced for explanation
  or audit content selection.
- Legacy numeric values (90 / 80 / 65; 25 / 15 / 8) are **LEGACY / NOT
  REUSED** — they appear in this document only as prohibition references.
- Explanation levels (§22) are semantic classes, not scores.

---

## 30. BUY / SELL Firewall

The words BUY / SELL / LONG / SHORT / ORDER / TRADE appear in this document
**only** as:

- explicit prohibition (this section, §7);
- legacy vocabulary protection (§28, C-003);
- out-of-scope statements (execution layer).

There is no mapping `Direction → BUY`, `Direction → SELL`,
`INCREASE_EXPOSURE → BUY`, or `REDUCE_EXPOSURE → SELL` anywhere in this
document, and no explanation may render an action as a buy/sell/order/trade
instruction. P5-05 explains recorded decisions; it does not create trading
semantics.

---

## 31. P4-06 Independence

- **P4-06 remains OPEN / DATA ACCRUAL.**
- The 9 provisional P4 rules remain INSUFFICIENT_EVIDENCE; P5-05 does not
  promote, modify, close, import, or wait for them.
- P5-05 consumes only the **frozen P4 contract** (ViewModel + version tuple
  + degradation codes) as references.
- **No P5-05 dependency on P4-06 closure.**

---

## 32. Decision Records

### EX-001 — Explanation ≠ Decision
Status: **FROZEN**
Decision: P5-05 explains and records decisions produced by P5-03/P5-04; it
never produces new decisions, re-ranks candidates, or recommends new actions.
Rationale: Master §20 ("explains... does not decide"); P5-05 is a read-side
contract (§4).
Alternatives: (a) explanation generating recommendations — rejected (creates
a second decision layer); (b) explanation influencing future decisions —
rejected (breaks determinism).
Impact: every P5-05 artifact is derived from recorded facts.
Downstream Owner: P5-06 (read/API/UI), P5-07 (replay validation).
Evidence: Master §20; P5-02 §6.

### EX-002 — Audit ≠ Explanation
Status: **FROZEN**
Decision: Audit is the authoritative, logically append-only historical
record; explanation is a derived, non-authoritative, human-facing
interpretation. Neither rewrites the other.
Rationale: auditability principle (Master §31); Master §24 (minimum audit
information); task §24.
Alternatives: explanation as source of truth — rejected (loses audit
integrity).
Impact: replay and audit reconstruction rely on records, not explanations.
Downstream Owner: P5-05-IMPL, P5-06.
Evidence: Master §24, §31.

### EX-003 — Provenance Authority
Status: **FROZEN**
Decision: Structured decision/audit data is the authority for any
explanation; every explanation claim must map to a recorded fact (no orphan
claims, §6).
Rationale: traceability requirement (Master §19/§20; P5-04 §27).
Alternatives: provenance-free prose — rejected.
Impact: explanation templates require ref backing.
Downstream Owner: P5-05-IMPL.
Evidence: Master §19, §20.

### EX-004 — NO_ACTION Explanation Semantics
Status: **FROZEN**
Decision: NO_ACTION is explained only as *completed evaluation, nothing
selected*; BLOCKED / NOT_DETERMINED / SUPPRESSED / SAFETY-BLOCKED /
APPROVAL-DENIED are never rendered as NO_ACTION (§8).
Rationale: P5-02 AD-003/004; P5-03 PD-003/019.
Alternatives: collapsing no-action cases — rejected (task §7 critical gate).
Impact: explanation matrix (§33) is case-exact.
Downstream Owner: P5-05-IMPL, P5-06.
Evidence: P5-02 §18, AD-003/004; P5-03 PD-019.

### EX-005 — UNKNOWN / DEGRADED Explanation
Status: **FROZEN**
Decision: The cause of unusable context (UNKNOWN / DEGRADED / NULL / STALE /
LOW CONFIDENCE per P4 semantics) is preserved in the explanation with refs;
no action is inferred from it; failure is never explained as completed
no-action evaluation (§9).
Rationale: Master §21 frozen invariant; P5-02 AD-019; P5-03 PD-008; P5-04
SG-002.
Alternatives: mapping degraded → "monitor"/"nothing to do" — rejected.
Impact: explanation states why a stronger conclusion was impossible.
Downstream Owner: P5-05-IMPL, P5-06.
Evidence: Master §21; P5-02 AD-019.

### EX-006 — Policy Provenance
Status: **FROZEN**
Decision: policyId / policyVersion / effectiveAt / evaluationAt / ruleId(s)
/ rule outcomes are traceable per policy-origin event; ruleId is a technical
reference, never a priority claim; machine audit vs human text separation
applies (§12).
Rationale: P5-03 PD-004/PD-012; replay (P5-03 PD-011).
Alternatives: free-form policy reasons — rejected.
Impact: every policy-origin explanation references its rule(s).
Downstream Owner: P5-05-IMPL.
Evidence: P5-03 §14, §23, §26.

### EX-007 — Safety Provenance
Status: **FROZEN**
Decision: SAFETY-BLOCKED explanations trace guardrail ref + version +
result + reason + evaluatedAt + evidence refs; inability (NOT_DETERMINED /
UNAVAILABLE / ERROR) is distinguished from violation (BLOCK) (§13).
Rationale: P5-04 SG-003/004; §10, §27.
Alternatives: opaque "blocked = true" — rejected (P5-03 PD-018).
Impact: safety blocker reports are self-describing.
Downstream Owner: P5-05-IMPL.
Evidence: P5-04 §10, §12, §27.

### EX-008 — Approval Provenance
Status: **FROZEN**
Decision: APPROVAL-DENIED (and all approval states) are explained with
approvalId, state, authority, actor, timestamp, scope, decision ref, version,
invalidation; acknowledgement / P2 "approved" are never approval (§14).
Rationale: P5-04 SG-005/006/008; P5-02 AD-020/023.
Alternatives: UI click or ack as approval — rejected (C-001/C-002).
Impact: approval explanations are unambiguous vs safety/policy blocks.
Downstream Owner: P5-05-IMPL.
Evidence: P5-04 §13, §14, §31.

### EX-009 — Audit Immutability
Status: **FROZEN**
Decision: logically append-only; correction via compensating event;
revocation/supersession never delete or rewrite history (§18).
Rationale: Master §24 (minimum audit information); auditability (Master
§31); task §17.
Alternatives: editable audit log — rejected.
Impact: audit persistence (P5-05-IMPL, PROVISIONAL) must honor append-only.
Downstream Owner: P5-05-IMPL.
Evidence: Master §24, §31.

### EX-010 — Replayability
Status: **FROZEN**
Decision: from decisionId, a historical decision is reconstructable from
recorded artifacts (§26) without live mutable data; missing artifacts are
reported UNAVAILABLE, never substituted.
Rationale: P5-03 PD-011; P5-04 SG-017; task §25.
Alternatives: replay from current live state — rejected (drift).
Impact: audit/replay artifact list is contract (§26).
Downstream Owner: P5-05-IMPL, P5-07.
Evidence: P5-03 §26; P5-04 §28.

### EX-011 — Audit Event Taxonomy
Status: **PROVISIONAL** (core events FROZEN as required by upstream;
execution events CANDIDATE)
Decision: event vocabulary reconciled with P5-02 §10.2 (§16.1): core
decision/approval/permission events FROZEN; execution events CANDIDATE;
outcomes are fields of DecisionProduced, not separate events; no event
explosion.
Rationale: P5-02 §11 state/outcome/event/command separation; task §15-§16.
Alternatives: (a) full SCREAMING_SNAKE taxonomy frozen wholesale — rejected
(task: "không tự động freeze toàn bộ event taxonomy"); (b) one mega enum —
rejected (P5-02 AD-009).
Impact: audit contract vocabulary is stable for FROZEN events.
Downstream Owner: P5-05-IMPL, P5-06.
Evidence: P5-02 §10, §11.

### EX-012 — Explanation Levels
Status: **PROVISIONAL**
Decision: SUMMARY / DETAILED / AUDIT are semantic content levels; UI
presentation is not part of the contract (§22).
Rationale: task §21; Master §20 (semantic content, not design).
Alternatives: freezing UI formats — rejected (P5-06 owns read/UI).
Impact: P5-06 may choose presentation; semantic content is fixed.
Downstream Owner: P5-06.
Evidence: Master §20.

### EX-013 — LLM Boundary
Status: **FROZEN**
Decision: LLM renders only; structured decision/audit data is authoritative;
LLM never changes decisions, invents evidence/reason/provenance, or edits
audit history (§24).
Rationale: P5-04 SG-016; P5-03 PD-016; Master §20/§31.
Alternatives: LLM-generated explanations as records — rejected.
Impact: any LLM rendering is a derived projection.
Downstream Owner: P5-05-IMPL, P5-06.
Evidence: P5-03 §31; P5-04 §26.

### EX-014 — Idempotency Recording
Status: **FROZEN**
Decision: P5-05 records decisionId/actionId/eventId/idempotencyKey
references with distinct scopes; it does not implement command-level
duplicate suppression (§19).
Rationale: Master §22; P5-02 AD-018; P5-04 §29.
Alternatives: one universal idempotency key — rejected.
Impact: event recording is idempotent (eventId); nothing else is claimed.
Downstream Owner: P5-05-IMPL.
Evidence: Master §22; P5-04 §29.

### EX-015 — Failure Explanation
Status: **FROZEN**
Decision: all failure classes are recorded and explained distinctly; never
collapsed into NO_ACTION; explanations state why a stronger conclusion was
impossible (§20).
Rationale: P5-03 PD-009; P5-04 §30/§31; Master §23.
Alternatives: failure → "nothing to do" — rejected.
Impact: failure matrix (§33) is enforced in audit + explanation.
Downstream Owner: P5-05-IMPL.
Evidence: P5-03 §27; P5-04 §30.

### EX-016 — Contradiction Recording
Status: **FROZEN**
Decision: contradictions are recorded as CONTRADICTION / UNRESOLVED; no
scoring, no silent latest-wins; both sides preserved (§27).
Rationale: Master §30; P5-04 SG-015.
Alternatives: score/majority resolution — rejected.
Impact: unresolved safety-relevant conflicts never yield permission; the
explanation records the conflict.
Downstream Owner: P5-05-IMPL.
Evidence: Master §30; P5-04 §24.

### EX-017 — Legacy Vocabulary Protection
Status: **FROZEN**
Decision: banned-phrase policy for explanation text (C-003); ack ≠ approval
(C-001); P2 "approved" ≠ P5 approval (C-002); recommendation ≠ execution
(§28).
Rationale: P5-01 C-001/C-002/C-003; P5-02 AD-023.
Alternatives: silent reuse of legacy terms — rejected.
Impact: explanation templates enforce vocabulary rules.
Downstream Owner: P5-05-IMPL, P5-06.
Evidence: P5-02 §24; `src/lib/p4/explanation/templates.ts:243-253`.

### EX-018 — Versioning Separation
Status: **FROZEN**
Decision: no universal version; upstream version dimensions consumed as
references; P5-05 adds only its own contract versions (§21).
Rationale: P5-04 SG-018; Master §25.
Alternatives: universal version number — rejected.
Impact: each event/explanation carries only relevant versions.
Downstream Owner: P5-05-IMPL, P5-07.
Evidence: P5-04 §33.

### EX-019 — No Hidden Score / Threshold
Status: **FROZEN**
Decision: no explanation/audit scores or numeric thresholds; legacy 90/80/65
and 25/15/8 remain LEGACY / NOT REUSED (§29).
Rationale: P5-02 AD-024; P5-04 SG-020; Master §31.
Alternatives: explanation confidence scores — rejected.
Impact: explanation levels are semantic classes, not scores.
Downstream Owner: P5-05-IMPL.
Evidence: P5-02 AD-024; P5-04 §35.

### EX-020 — P4-06 Independence
Status: **FROZEN**
Decision: P5-05 has no dependency on P4-06 closure and consumes only the
frozen P4 contract (§31).
Rationale: task §30; Master §34 (parallel track).
Alternatives: waiting on P4-06 — rejected (blocking dependency forbidden).
Impact: P5-05 proceeds on frozen P4 contract.
Downstream Owner: all P5.
Evidence: Master §34.

---

## 33. Contract Matrices

### 33.1 Explanation Matrix

| Decision/Outcome | Explanation | Required provenance |
|---|---|---|
| SELECTED | what action, why selected (rules), based on which snapshot | decisionId, actionId, p4SnapshotRef, policy refs, rule refs |
| NO_ACTION | completed evaluation, nothing selected | decisionId, p4SnapshotRef, policy refs |
| POLICY-BLOCKED | candidate + blocking rule(s) | candidateId, decisionId, blockerReport.source=POLICY, rule refs |
| NOT_DETERMINED | unresolved cause (unusable input / failure) | decisionId, failure/degradation refs |
| SUPPRESSED | suppression rule (cooldown/duplicate) applied; no decision produced | candidateId, suppression reason refs (no decisionId) |
| SAFETY-BLOCKED | guardrail violation | decisionId/actionId, guardrail ref + version, result, evaluatedAt, reason, evidence refs |
| APPROVAL-DENIED | authority refusal | decisionId/actionId, approvalId, state, authority, actor, timestamp, scope, version |
| PERMISSION (granted / not-granted) | permission state; ≠ executed | decisionId/actionId, permission record, executionState, automation mode |

### 33.2 Audit Event Matrix

| Event | Trigger | Required refs | Immutable? |
|---|---|---|---|
| CandidateCreated | candidate considered | candidateId, timestamp | yes |
| DecisionProduced | evaluation completed | decisionId, outcome, policy refs | yes |
| DecisionSuppressed | cooldown/duplicate | candidateId, suppression refs | yes |
| DecisionSuperseded | material change, new decision | decisionId (old), new decisionId | yes |
| DecisionExpired | horizon passed | decisionId, policy ref | yes |
| DecisionCancelled | authority withdrawal | decisionId, actor | yes |
| ApprovalRequired | approval requirement determined | decisionId, approval policy version | yes |
| ApprovalGranted | human grant | decisionId/actionId, approvalId, actor, scope | yes |
| ApprovalDenied | human denial | decisionId/actionId, approvalId, actor, reason | yes |
| ApprovalExpired | deadline passed | decisionId/actionId, approvalId | yes |
| ApprovalRevoked | material change / revocation | decisionId/actionId, approvalId, reason | yes |
| PermissionGranted | permission granted | decisionId/actionId, permission record, versions | yes |
| PermissionRevoked | permission invalidated | decisionId/actionId, permission record, reason | yes |
| PermissionExpired | validity passed | decisionId/actionId, permission record | yes |
| ExecutionAttempted / Succeeded / Failed | execution layer (future) | reserved identity only | yes (CANDIDATE) |

### 33.3 Failure Matrix

| Failure | Recorded outcome | Explanation | Permission implication |
|---|---|---|---|
| policy evaluation failure | NOT_DETERMINED + reason | why evaluation could not complete | n/a |
| safety evaluation failure | ERROR / NOT_DETERMINED | why safety could not be established | no permission (consequential) |
| guardrail unavailable | UNAVAILABLE | which input/system unavailable | no permission (consequential) |
| approval unavailable | NOT_DETERMINED | approval could not be verified | no permission (consequential) |
| authority resolution failure | NOT_DETERMINED | authority could not be resolved | no permission (consequential) |
| permission evaluation failure | ERROR / NOT_DETERMINED | why permission could not be evaluated | no permission (consequential) |
| system error | ERROR | system-level failure | no permission (consequential) |

### 33.4 Provenance Matrix

| Source | Version | Snapshot | Required? |
|---|---|---|---|
| P4 decision support | version tuple (consumed) | p4SnapshotRef (identity + version + asOf + contentHash) | MANDATORY (decision-scoped) |
| P4 evidence | evidence refs | referenced, not duplicated | MANDATORY |
| Policy (P5-03) | policyVersion | rule refs | MANDATORY (policy-origin) |
| Guardrail (P5-04) | guardrailVersion | guardrail result | CONDITIONAL (safety-origin) |
| Approval (P5-04) | approval policy version | approval record | CONDITIONAL (approval-origin) |
| Authority (P5-04) | authority version | authority ref | CONDITIONAL (permission context) |
| Automation (P5-04) | automation config version | automation mode | CONDITIONAL (permission context) |
| P5-05 | explanation/audit contract version | event refs | MANDATORY |

### 33.5 Replay Matrix

| Scenario | Required artifacts | Replayable? |
|---|---|---|
| Why was this decision made? | decision record + p4SnapshotRef + policy/rule refs + events | yes |
| Why was it blocked? | decision record + blockerReport + rule/guardrail/approval refs | yes |
| Safety reconstruction | guardrail results + versions + p4SnapshotRef | yes |
| Approval reconstruction | approval record + authority ref + approval policy version | yes |
| Permission state | permission record + executionState + automation mode | yes |
| Full lifecycle | decision record + all audit events | yes, conditional on recorded refs |
| Snapshot unavailable | — | reported UNAVAILABLE, never live-substituted |

### 33.6 Vocabulary Matrix

| Legacy term | P5 meaning | Allowed usage |
|---|---|---|
| acknowledged (alert) | post-hoc awareness | never approval (C-001) |
| "approved" (P2 evidence) | evidence status | never P5 approval (C-002) |
| bullish language | legacy directional tier | banned in P5 text (C-003) |
| STRONG_WATCH / WATCH / OBSERVE | legacy recommendation signals | never a P5 decision; recommendation ≠ execution |
| 90 / 80 / 65; 25 / 15 / 8 | legacy numeric config | LEGACY / NOT REUSED |

### 33.7 Frozen / Provisional / Open Matrix

| Semantic | Status | Owner | Downstream |
|---|---|---|---|
| Explanation ≠ Decision | FROZEN | P5-05 | P5-06 |
| Audit ≠ Explanation | FROZEN | P5-05 | P5-05-IMPL |
| Provenance authority | FROZEN | P5-05 | P5-05-IMPL |
| NO_ACTION explanation | FROZEN | P5-05 | P5-05-IMPL, P5-06 |
| UNKNOWN/DEGRADED explanation | FROZEN | P5-05 | P5-05-IMPL |
| Blocker provenance (3-way) | FROZEN | P5-03/04/05 | P5-05-IMPL |
| Approval provenance | FROZEN | P5-04/05 | P5-05-IMPL |
| Audit immutability | FROZEN | P5-05 | P5-05-IMPL |
| Audit event core vocabulary | FROZEN (core) / CANDIDATE (execution) | P5-05 | P5-05-IMPL, P5-06 |
| Execution events | CANDIDATE | execution layer (future) | future |
| Explanation levels | PROVISIONAL | P5-05 | P5-06 |
| Audit persistence model | PROVISIONAL | P5-05-IMPL | P5-07 |
| Retention period | OPEN | P5-05-IMPL | — |
| Expiry / validity durations | OPEN | P5-03/04 | — |
| UI presentation | OUT OF SCOPE | P5-06 | — |
| Execution mechanics | OUT OF SCOPE | future | — |

---

## 34. Cross-Document Consistency Matrix

| Semantic | P5-02 | P5-03 | P5-04 | P5-05 | Status |
|---|---|---|---|---|---|
| NO_ACTION | outcome (AD-004) | completed evaluation, nothing selected (PD-003) | never produced by safety/approval | explained only as completed-evaluation-no-selection | CONSISTENT |
| POLICY-BLOCKED | BLOCKED + blocker report (AD-011) | BLOCKED, blockerReport.source = POLICY (PD-018) | downstream (not P5-04) | 3-way provenance preserved, self-describing | CONSISTENT |
| NOT_DETERMINED | outcome (AD-004) | could not determine (PD-009) | inability → no permission | explained with unresolved cause, never NO_ACTION | CONSISTENT |
| SUPPRESSED | — (not a P5-02 outcome) | layer result, no decision (PD-019) | preserved | distinguishable from NO_ACTION in audit trail | CONSISTENT |
| SELECTED | outcome (AD-004) | selection (PD-003) | downstream safety evaluation | explained with decision refs; ≠ safe/approved/executable | CONSISTENT |
| ELIGIBLE | evaluation result, not state (AD-010) | eligibility result (PD-002) | ≠ SAFE | rendered as evaluation result, never as permission | CONSISTENT |
| APPROVED | approvalState (AD-009) | policy never approves (PD-015) | approval state (SG-006) | explained via approval record; ack/P2 ≠ approval | CONSISTENT |
| SAFE | — (P5-02 boundary) | ≠ approved/executable (PD-015) | aggregate guardrail PASS (SG-003) | rendered as guardrail result, never implies approval/permission | CONSISTENT |
| EXECUTION_PERMISSION_GRANTED | executionState PERMITTED (AD-009) | — (policy grants no permission) | authorization result (SG-011) | permission ≠ executed; v1 consequential = NOT_GRANTED | CONSISTENT |
| EXECUTED | executionState (AD-009) | — | execution layer (out of scope) | CANDIDATE events only; never claimed from permission | CONSISTENT |
| FAILED | executionState (AD-009) | policy failure → NOT_DETERMINED (PD-009) | safety/permission failure → no permission (SG-002) | failure recorded distinctly, never NO_ACTION | CONSISTENT |
| CANCELLED | decisionState (AD-022) | — | — | DecisionCancelled event; history preserved | CONSISTENT |
| REVOKED | approvalState (AD-022) | — | approval revoked (SG-013) | ApprovalRevoked event; approval history not deleted | CONSISTENT |
| EXPIRED | decision/approval state (AD-022) | policy expiry (PD-007) | approval/permission expiry (SG-014) | DecisionExpired / ApprovalExpired / PermissionExpired events | CONSISTENT |
| STALE | context condition (AD-022) | stale-evidence policy (PD-008) | fail-closed for consequential (SG-002) | cause preserved; never NO_ACTION; no live substitution | CONSISTENT |
| ABSENT / UNAVAILABLE | no decision record (AD-019) | no evaluation / NOT_DETERMINED | unavailable → no permission | "no decision record exists" + cause; never a no-action evaluation | CONSISTENT |

No silent semantic override exists across the chain P5-02 → P5-03 → P5-04 →
P5-05.

---

## 35. Conceptual Flow

```
┌─────────────────────────────────────────────────────────────┐
│  P5-03 Policy          P5-04 Safety / Approval              │
│  (SELECTED / NO_ACTION /  (SAFETY-BLOCKED / APPROVAL-DENIED │
│   BLOCKED / NOT_DETERMINED,  / permission)                  │
│   SUPPRESSED layer result)                                  │
└───────────────┬──────────────────────────┬──────────────────┘
                ▼                          ▼
        Decision record            Approval / permission records
        (decisionId, outcome,      (approvalId, permission id,
         actionType, params,        states, refs, versions)
         decisionState, refs)
                └──────────────┬───────────────────┘
                               ▼
        ┌──────────────  P5-05 (this contract)  ──────────────┐
        │  EXPLANATION   PROVENANCE   AUDIT EVENTS  REPLAY     │
        │  WHAT/WHY/     p4SnapshotRef  append-only   decisionId│
        │  BASED-ON/     policy/guard-  event history  → full  │
        │  POLICY/       rail/approval  (§16-§18)      recon-  │
        │  SAFETY/       refs (§10-§14)               struction│
        │  APPROVAL/                                        │
        │  STATE/                                           │
        │  NOT-HAPPENED                                     │
        └──────────────────────┬──────────────────────────────┘
                               ▼
        P5-06 Read/API/UI (semantic content consumed; presentation owned by P5-06)
```

**P5-05 OWNED:** explanation contract, provenance contract, audit event
contract, immutability, replay requirements.
**DOWNSTREAM:** P5-06 (read/API/UI), P5-07 (replay validation), P5-05-IMPL
(audit persistence design — PROVISIONAL).

---

## 36. Open Semantic Questions

Recorded for owner/downstream resolution — **no forced answers**:

1. Should SUMMARY content ever omit provenance refs (semantic vs
   presentation trimming), or must SUMMARY always carry full refs?
2. Should `DecisionSuppressed` carry a pseudo-reference when no decision
   exists, or is `candidateId` + suppression reason sufficient?
3. Which audit events are exposed at which explanation level (SUMMARY /
   DETAILED / AUDIT) — a P5-06 read-contract decision?
4. Is the AUDIT level the full event history, or only events relevant to
   the explanation question?
5. Should explanation render the P4 status (OK/DEGRADED/...) verbatim at
   SUMMARY level, or only at DETAILED?
6. How should permission-expiry events interact with decision expiry when
   durations are OPEN?
7. Should the audit contract version be part of every event, or only of the
   explanation payload?
8. Retention period for audit events — OPEN (P5-05-IMPL / P5-08).
9. Whether `CandidateCreated` events are worth recording at all in v1, or
   only post-selection events (state-explosion avoidance).
10. Exact contentHash verification behavior when a snapshot's hash cannot be
    reproduced — PROVISIONAL (P5-05-IMPL).
11. Whether contradictions should be exposed in SUMMARY or only in AUDIT.
12. Whether the explanation contract needs a machine-readable schema
    document in v1 or only semantic field definitions (P5-06 decides wire
    format).

---

## 37. P5-06 Handoff

P5-05 → P5-06 contract boundary:

**P5-05 produces (semantic content only):**

- explanation contract (levels, slots, provenance backing — §6, §10, §22);
- audit event vocabulary + event contract (§16-§17);
- replay/query requirements (from `decisionId`, §26);
- provenance reference set (§10);
- vocabulary/banned-phrase constraints for rendered text (§28).

**P5-06 (Read/API/UI) will define:**

- wire format and endpoints (read-only) for decisions, explanations, and
  audit views;
- presentation/layout/UI design — explicitly NOT defined here (EX-012);
- which explanation level maps to which UI surface.

P5-06 MUST NOT change the semantic content defined here; it selects
presentation. P5-06 remains read-only (Master §32: "expose action decisions
read-only").

**P5-05 → P5-07 boundary:** P5-07 (replay validation) validates
reconstructability using the §26 artifact list; it does not change this
contract.

---

## 38. Acceptance Criteria

P5-05 exit criteria — all met by this document:

- [x] Explanation model defined (§6) — WHAT/WHY/BASED-ON/POLICY/SAFETY/
      APPROVAL/STATE/NOT-HAPPENED with provenance backing
- [x] Decision explanation ≠ recommendation (§7)
- [x] NO_ACTION explanation semantics — 7 distinct cases never collapsed (§8)
- [x] UNKNOWN/DEGRADED/NULL explanation — cause preserved, no inferred
      action, failure ≠ no-action (§9)
- [x] Provenance model with MANDATORY/CONDITIONAL/OPTIONAL/UNAVAILABLE (§10)
- [x] P4 snapshot reference preserved (identity/version/asOf/contentHash,
      anti-drift) (§11)
- [x] Policy provenance (§12), safety/guardrail explanation (§13), approval
      explanation (§14), execution permission explanation (§15)
- [x] Audit trail contract — event vocabulary reconciled with P5-02 (§16)
- [x] Audit event contract with conditionality (§17)
- [x] Audit immutability — append-only, compensating events, no rewrite (§18)
- [x] Idempotency recording boundary — scopes separated, no command engine (§19)
- [x] Failure semantics — distinct classes, never NO_ACTION (§20)
- [x] Versioning separation — no universal version (§21)
- [x] Human-readable levels (§22) and machine-readable semantic/presentation
      separation (§23)
- [x] LLM boundary (§24) — rendering only, structured data authoritative
- [x] Audit vs explanation separation (§25)
- [x] Replayability (§26)
- [x] Contradiction governance (§27) — record, no score, no silent latest-wins
- [x] Legacy vocabulary protection (§28) — C-001/C-002/C-003, banned phrases
- [x] No hidden score / threshold (§29) — legacy values NOT REUSED
- [x] BUY/SELL firewall (§30) — prohibition only
- [x] P4-06 independence (§31) — OPEN/DATA ACCRUAL, no dependency
- [x] Decision records EX-001 → EX-020 with status/rationale/alternatives/
      impact/downstream/evidence (§32)
- [x] Required matrices included (§33): Explanation, Audit Event, Failure,
      Provenance, Replay, Vocabulary + Freeze matrix + Cross-document matrix
- [x] Conceptual flow with P5-05 OWNED vs DOWNSTREAM (§35)
- [x] Open semantic questions documented (§36)
- [x] P5-06 handoff defined (§37)
- [x] No production code; no P3/P4/P4-06/API/UI/DB changes
- [x] Exactly one document created
- [x] R2: status promoted to FROZEN / APPROVED FOR DOWNSTREAM after all 20
      freeze gates PASS (§40-§43)
- [x] R2: NO_ACTION explanation covers all 7 gate cases including ABSENT (§8)
- [x] R2: consideration ≠ approval ≠ permission invariant added (§14, G4)
- [x] R2: cross-document consistency matrix covers the full G18 semantic
      list (§34)
- [x] R2: 20-gate freeze audit (§40), freeze matrix (§41), final freeze
      statement (§42), revision record (§43) recorded

---

## 39. Freeze Recommendation

**FROZEN / APPROVED FOR DOWNSTREAM** (P5-05 R2 — owner-authorized freeze
check; §40-§43).

All 20 freeze gates (§40) PASS and no semantic blocker was found in the
final cross-document audit against P5-00 → P5-04 and the frozen P4
contract. Per the task's freeze-decision rule (§4), the document is frozen
for downstream P5-06 design. P5-06 must not begin before owner confirmation
of this record.

---

## 40. Freeze Audit — 20 Gates (P5-05 R2)

| Gate | Result | Evidence | Required correction |
|---|---|---|---|
| G1 — P4 → P5 Boundary | **PASS** | §4, §11: P4 authoritative; `p4SnapshotRef` consumed as provenance; no re-interpretation of Direction/O/R/C/A/signals/degradation; no second P4 layer | none |
| G2 — P5-02 Compatibility | **PASS** | §8, §34: NO_ACTION outcome vs ActionType (AD-003), 3 orthogonal dimensions (AD-009), candidateId→decisionId→actionId (AD-013), p4SnapshotRef (AD-014), UNKNOWN/DEGRADED (AD-019), legacy vocabulary (AD-023) | none |
| G3 — P5-03 Compatibility | **PASS** | §8, §12, §34: outcomes distinct (PD-003/009/019); SUPPRESSED never NO_ACTION; policy provenance explicit; ruleId ≠ priority (PD-004); P5-05 never changes a policy outcome | none |
| G4 — P5-04 Compatibility | **PASS** | §13-§15, §34: SAFETY-BLOCKED vs POLICY-BLOCKED vs APPROVAL-DENIED; ack ≠ approval (C-001); P2 "approved" protected (C-002); permission ≠ execution (SG-011); safety first-class (SG-001); §14: consideration ≠ approval/permission | none |
| G5 — Explanation ≠ Decision | **PASS** | §4, §7, EX-001: describes recorded facts only; cannot create candidates, select actions, change policy outcome, grant approval, grant permission, or turn failure into NO_ACTION | none |
| G6 — Audit ≠ Explanation | **PASS** | §25, EX-002/003: audit authoritative; explanation derived; compensating events, never silent mutation | none |
| G7 — NO_ACTION Semantics | **PASS** | §8, EX-004: NO_ACTION / POLICY-BLOCKED / NOT_DETERMINED / SUPPRESSED / SAFETY-BLOCKED / APPROVAL-DENIED / ABSENT never collapsed; no UNKNOWN→NO_ACTION, DEGRADED→NO_ACTION, FAILURE→NO_ACTION, BLOCKED→NO_ACTION, SUPPRESSED→NO_ACTION | none |
| G8 — UNKNOWN / DEGRADED / Failure | **PASS** | §9, §11, §20, EX-005: cause + provenance preserved; no live substitution (anti-drift §11, UNAVAILABLE §26); failure ≠ successful evaluation; no invented stronger conclusions | none |
| G9 — Provenance Completeness | **PASS** | §10, §33.4: decisionId/actionId/p4SnapshotRef/policy/rule/guardrail/approval/authority/permission/event refs classified MANDATORY/CONDITIONAL/OPTIONAL/UNAVAILABLE; no orphan claims (§6) | none |
| G10 — Replayability | **PASS** | §26, EX-010: reconstructable from recorded refs; never depends on current mutable ViewModel/policy/guardrail; missing artifacts reported UNAVAILABLE | none |
| G11 — Audit Immutability | **PASS** | §18, EX-009: append-only; no history rewrite; revocation/supersession as events; compensating events; timestamps/actors/provenance traceable | none |
| G12 — Idempotency Boundary | **PASS** | §19, EX-014: records/exposes identities only; not a command executor / retry / execution-idempotency engine / dispatcher; identities distinct | none |
| G13 — LLM Boundary | **PASS** | §24, EX-013: renderer/helper only; structured records authoritative; no invented facts; cannot alter decision/policy/safety/approval/permission | none |
| G14 — Legacy Vocabulary | **PASS** | §28, EX-017: C-001/C-002/C-003 protected; recommendation ≠ execution; no migration, no silent reinterpretation | none |
| G15 — Hidden Score / Threshold | **PASS** | §29, EX-019: no action/risk/priority/confidence scores, no composite formulas, no magic numbers; legacy 90/80/65, 25/15/8 LEGACY / NOT REUSED (scan verified) | none |
| G16 — BUY / SELL Boundary | **PASS** | §30: BUY/SELL/LONG/SHORT/ORDER/TRADE only as prohibition/legacy/out-of-scope (scan verified) | none |
| G17 — P4-06 Independence | **PASS** | §31, EX-020: P4-06 OPEN / DATA ACCRUAL; 9 rules INSUFFICIENT_EVIDENCE, not consumed; no wait/promote/modify/close | none |
| G18 — Cross-document Consistency | **PASS** | §34: 16-row matrix covers NO_ACTION … STALE across P5-02/03/04/05; owners + downstream interpretations explicit; no contradictions; no silent override | none |
| G19 — Freeze Discipline | **PASS** | §41: FROZEN stay frozen; PROVISIONAL/CANDIDATE/OPEN/OUT OF SCOPE unchanged; nothing promoted to appear complete (EX-011/EX-012 remain PROVISIONAL) | none |
| G20 — Implementation Discipline | **PASS** | Only `docs/P5_Upgrade/P5-05_ACTION_EXPLANATION_AUDIT.md` changed; no production code, no P3/P4/P4-06, no API/UI/DB/migrations, no P5-06 | none |

All 20 gates PASS. Required correction: none.

---

## 41. Freeze Matrix (P5-05 R2)

| Semantic | Owner | Status | Downstream |
|---|---|---|---|
| Explanation ≠ Decision | P5-05 | FROZEN | P5-06 |
| Audit ≠ Explanation | P5-05 | FROZEN | P5-05-IMPL |
| Provenance authority | P5-05 | FROZEN | P5-05-IMPL |
| NO_ACTION explanation (7 cases + ABSENT) | P5-05 | FROZEN | P5-05-IMPL, P5-06 |
| UNKNOWN/DEGRADED explanation | P5-05 | FROZEN | P5-05-IMPL |
| Blocker provenance (3-way) | P5-03/04/05 | FROZEN | P5-05-IMPL |
| Approval provenance | P5-04/05 | FROZEN | P5-05-IMPL |
| Consideration ≠ approval ≠ permission | P5-05 | FROZEN | P5-05-IMPL |
| Audit immutability | P5-05 | FROZEN | P5-05-IMPL |
| Audit event core vocabulary | P5-05 | FROZEN | P5-05-IMPL, P5-06 |
| Execution events | execution layer (future) | CANDIDATE | future |
| Audit event taxonomy (full) | P5-05 | PROVISIONAL | P5-05-IMPL |
| Explanation levels (SUMMARY/DETAILED/AUDIT) | P5-05 | PROVISIONAL | P5-06 |
| Audit persistence model | P5-05-IMPL | PROVISIONAL | P5-07 |
| Retention period | P5-05-IMPL | OPEN | — |
| Expiry / validity durations | P5-03/04 | OPEN | — |
| contentHash verification behavior | P5-05-IMPL | OPEN | — |
| UI presentation | P5-06 | OUT OF SCOPE | — |
| Execution mechanics | future | OUT OF SCOPE | — |
| P4-06 | parallel track | OPEN / DATA ACCRUAL | unchanged |

---

## 42. Final Freeze Statement (P5-05 R2)

**"P5-05 is frozen for downstream P5-06 design.**

This freeze applies only to FROZEN semantics (EX-001 → EX-010, EX-013 →
EX-020; §41). PROVISIONAL / CANDIDATE / OPEN / DEFERRED / OUT OF SCOPE
items remain unchanged (EX-011, EX-012, execution events, audit persistence
model, retention/expiry durations, UI presentation, execution mechanics).
No production code, no P3/P4/P4-06 changes, no API/UI/DB/schema/migrations,
no P5-06 implementation, no execution infrastructure."

---

## 43. Final Revision Record (P5-05 R2)

- Task type: DOCUMENT-ONLY final semantic freeze gate.
- Status change: DRAFT / READY FOR OWNER REVIEW → **FROZEN / APPROVED FOR
  DOWNSTREAM** (header, §1, §21, §39, §42, verification record).
- §8: ABSENT / UNAVAILABLE (no decision record produced) added as an
  explicit case; the NO_ACTION explanation table now covers all 7 gate
  cases and states eight distinct situations (G7).
- §14: explicit invariant — consideration of an action never implies
  approval or execution permission (G4).
- §21: explanation contract version status updated to FROZEN (was
  "draft → freeze by owner").
- §34: Cross-Document Consistency Matrix expanded from 9 to 16 rows
  covering the full G18 semantic list (NO_ACTION … STALE).
- §40: self-audit expanded from 17 to the required 20 freeze gates
  (G1–G20), each with PASS / Evidence / Required correction.
- §41/§42/§43 added: Freeze Matrix, Final Freeze Statement, Revision
  Record.
- §38: acceptance criteria extended with R2 items.
- No upstream document (P5-00/01/02/03/04) modified; no upstream
  contradiction found; no semantic promotion beyond the freeze authorized
  by this task.

---

## Appendix A — Repository Evidence

- `src/lib/p4/types.ts` — `P4DecisionSupportViewModel` + version tuple
  (consumed as opaque input, §11).
- `src/lib/p4/explanation/templates.ts:243-253` — `BANNED_PHRASES` precedent
  mirrored by §28 (EX-017).
- `src/lib/p4/interpretation.ts` / `src/lib/p4/explanation/templates.ts` —
  "No LLM, no hidden inference" — basis for §24 (EX-013).
- P3 event-log precedent (idempotencyKey + actor + provenance, P5-01 §9) —
  basis for §17 event contract and §19 idempotency recording.
- No existing P5 action/audit/explanation infrastructure exists (P5-01 §9:
  approval, retry, P5 action audit = NONE) — hence this contract defines
  new semantic content, with persistence PROVISIONAL.

## Appendix B — Upstream References Consumed

- P5-00: §19 (evidence/provenance), §20 (explanation), §22 (idempotency),
  §23 (failure/retry), §24 (audit trail), §25 (versioning), §30
  (contradiction governance), §31 (auditability FROZEN; audit persistence
  PROVISIONAL).
- P5-02: AD-003/004 (outcomes), AD-009 (state dimensions), AD-011 (BLOCKED),
  AD-013 (identity hierarchy), AD-014 (p4SnapshotRef), AD-016 (material
  change), AD-018 (idempotency), AD-019 (UNKNOWN/DEGRADED), AD-023 (legacy
  vocabulary), AD-024 (no hidden score).
- P5-03: PD-003 (selection), PD-004 (ruleId tie-break), PD-009 (failure),
  PD-011 (replay), PD-018 (BLOCKED provenance), PD-019 (SUPPRESSED).
- P5-04: SG-002/003/004 (guardrail outcomes + blocker provenance),
  SG-005/006/008 (approval), SG-010/011 (v1 permission), SG-016 (LLM),
  SG-017 (replay), SG-018 (version separation), §27 (audit/provenance
  requirements), §30-§31 (failure/denial), §41 (P5-05 handoff).

## Appendix C — Rejected / Deferred Alternatives

| Alternative | Disposition | Reason |
|---|---|---|
| Explanation as authoritative record | REJECTED | EX-002: audit must remain authoritative |
| Editable audit log | REJECTED | EX-009: append-only invariant |
| Full SCREAMING_SNAKE event taxonomy frozen wholesale | REJECTED | task §15: no auto-freeze; outcomes are decision fields, not events |
| One mega state/event enum | REJECTED | P5-02 AD-009: orthogonal dimensions |
| LLM-generated explanations as records | REJECTED | EX-013: LLM rendering only |
| Explanation confidence scores / audit scores | REJECTED | EX-019: hidden-score ban |
| Score/majority contradiction resolution | REJECTED | EX-016: record, don't resolve silently |
| Latest-wins version resolution | DEFERRED | only where explicit policy defines precedence (P5-03 PD-004) |
| Audit persistence schema | DEFERRED | PROVISIONAL (Master §24/§31); P5-05-IMPL |
| UI presentation of explanations | DEFERRED | P5-06 owns read/API/UI |
| Retention / expiry durations | DEFERRED | OPEN — never invented |

## Appendix D — Terminology Glossary

- **Explanation** — derived, human-facing interpretation of recorded facts
  (never authoritative).
- **Audit** — authoritative, logically append-only historical record of
  decision lifecycle events.
- **Provenance** — the set of references required to reconstruct a fact.
- **p4SnapshotRef** — P5-02 AD-014 reference tuple identifying the exact P4
  context a decision was based on.
- **DecisionProduced** — the audit event carrying a completed decision
  evaluation and its outcome.
- **DecisionSuppressed** — P5-03 layer event: suppression applied, no
  decision record produced.
- **SAFETY-BLOCKED / APPROVAL-DENIED** — P5-04 blocker outcomes with
  self-describing provenance.
- **Replay** — reconstructing a historical decision from recorded artifacts
  without live mutable data.
- **Compensating event** — a new audit event that corrects a prior record
  without rewriting it.

---

## Verification record (P5-05)

- Task type: CONTRACT / SEMANTIC DESIGN — documentation only.
- Files created: exactly one — `docs/P5_Upgrade/P5-05_ACTION_EXPLANATION_AUDIT.md`.
- Production code: NONE. P3/P4/P4-06: unchanged. API/UI/DB/migrations:
  untouched. Package files: untouched.
- Pre-existing dirty files (P5-00 R2 Master, P5-01/02/03/04 docs,
  `package-lock.json`, `tsconfig.tsbuildinfo`) preserved, not reverted.
- Status: **FROZEN / APPROVED FOR DOWNSTREAM** (P5-05 R2) — all 20 freeze
  gates PASS (§40); the freeze applies to FROZEN semantics only (§42).
  P5-06 not started.
