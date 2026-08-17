# P5-04 SAFETY / GUARDRAIL / APPROVAL ENGINE
## MASTER DESIGN & SEMANTIC SPECIFICATION

**Phase:** P5 — What action, if any, should be executed?
**Task:** P5-04 — Safety / Guardrail / Approval Engine
**Status:** FROZEN / APPROVED FOR DOWNSTREAM (P5-04 revision R2 — freeze check passed; P5-05 design may proceed after owner confirmation)
**Guardrail model version:** `p5-guardrail-model/v1`
**Approval model version:** `p5-approval-model/v1`
**Authoritative inputs:**
1. `docs/P5_Upgrade/P5_MASTER_SPECIFICATION.md` (FROZEN)
2. `docs/P5_Upgrade/P5-01_CONTRACT_GAP_AUDIT.md` (APPROVED)
3. `docs/P5_Upgrade/P5-02_SEMANTIC_CONTRACT_ACTION_MODEL.md` (APPROVED)
4. `docs/P5_Upgrade/P5-03_ACTION_DECISION_POLICY_ENGINE.md` (FROZEN / APPROVED FOR DOWNSTREAM)

P5-04 determines whether a selected/eligible consequential action may
proceed under explicit safety, authority, approval, and automation
constraints. It grants **permission** — it does NOT execute. Document-only;
no production code, no P3/P4/P4-06 modification.

---

## 1. Executive Summary

- **P5-04 grants permission, never execution** (SG-011). The pipeline
  ends at `EXECUTION_PERMISSION_GRANTED`; actual execution is OUT OF
  SCOPE.
- **Safety is first-class** (SG-001, SG-019): no layer — approval,
  automation, policy, LLM, operator — may bypass mandatory safety; there is
  **no hidden override path**.
- **Fail-closed for consequential actions** (SG-002): if required safety
  evidence, guardrail state, authority, or mandatory approval cannot be
  reliably established, execution permission is NOT granted.
  NOT_DETERMINED / ERROR / UNAVAILABLE never become PERMITTED, and are
  never silently converted to NO_ACTION (P5-04 inability ≠ P5-03
  NO_ACTION).
- **Guardrail outcomes** PASS / BLOCK / NOT_DETERMINED / UNAVAILABLE /
  ERROR are distinct and never collapsed (SG-003). Blockers carry full
  provenance — no opaque `blocked = true` (SG-004).
- **Approval is an explicit authorization event** — never alert
  acknowledgement (C-001), never P2 evidence status "approved" (C-002),
  never a UI click alone (SG-005, SG-008).
- **Authority is a conceptual contract**, not an RBAC/IAM system; no
  organizational roles are invented (SG-007).
- **v1 = ADVISORY-ONLY** (Master §17, PROVISIONAL mode): execution
  permission is **NOT_GRANTED** for consequential actions in v1 (SG-010).
  ASSISTED / AUTONOMOUS remain future candidates (SG-009).
- **No numeric thresholds, no safety/approval scores** (SG-020); legacy
  90/80/65 and 25/15/8 remain LEGACY, not reused. **No BUY/SELL engine**
  (§36).- **P4-06 remains OPEN / DATA ACCRUAL** — no dependency, no promotion, no waiting (§42).
- **P5-04 R2 freeze check:** cross-document consistency (P5-00 → P5-04)
  verified (§45), freeze matrix recorded (§46), and all 16 freeze gates
  PASS (§44). Document status advanced to FROZEN / APPROVED FOR
  DOWNSTREAM.

---

## 2. Authority & Inputs

| Input | Status | Used for |
|---|---|---|
| P5 Master | FROZEN | safety-first, advisory-only default, fail-closed, HITL |
| P5-01 Audit | APPROVED | approval/automation MISSING; alert ack (C-001); P2 "approved" (C-002); legacy thresholds |
| P5-02 Semantic Contract | APPROVED | orthogonal states (AD-009), approval boundary (AD-020), consequential flag (AD-005), identity (AD-013), material change (AD-016), snapshot ref (AD-014) |
| P5-03 Policy Engine | FROZEN | policy outcomes (PD-004), POLICY-BLOCKED provenance (PD-018), SUPPRESSED (PD-019), handoff (§38) |
| P4 contract + P4-06 docs | FROZEN / OPEN | input semantics; independence check |

---

## 3. Scope

P5-04 covers: safety boundary; guardrail model; safety evaluation contract;
safety blocking semantics; authority model; approval model;
human-in-the-loop; automation modes; execution permission; permission
expiry/invalidation; material-change invalidation; approval provenance;
safety provenance; failure semantics; denial semantics; escalation
boundary; audit requirements; versioning; replayability; determinism where
applicable; fail-closed behavior for consequential actions; P5-05 handoff.

---

## 4. Non-Goals

P5-04 MUST NOT implement: broker integration, exchange integration, order
placement, trade execution, portfolio mutation, wallet mutation, real-money
side effects, autonomous trading, order routing, position management,
rebalancing execution, transaction processing.

`EXECUTION PERMISSION ≠ EXECUTION` — permission may be defined; execution
itself is not.

---

## 5. Core Architecture / Boundary

```
P5-03 Policy
   ↓  ELIGIBLE / SELECTED
P5-04
   ├── Safety
   ├── Guardrails
   ├── Authority
   ├── Approval
   ├── Automation Mode
   └── Execution Permission
   ↓
P5-05 Audit / Explanation
```

Execution mechanism remains OUT OF SCOPE.

**P5-04 receives** a P5-03 policy outcome (SELECTED with
selectedActionRef, or downstream progression of an eligible action) and
**determines** safety, authorization, approval, automation, and execution
permission. It does NOT re-run policy and does NOT re-derive P4 evidence.

---

## 6. Safety-First Invariant

Safety is first-class. Conceptually:

```
Action
  ↓
Safety Evaluation
  ↓
Authority / Approval
  ↓
Automation Permission
  ↓
Execution Permission
```

The exact ordering between safety and approval may vary with semantics
(§25) — what is invariant:

- approval → must NOT bypass safety;
- automation → must NOT bypass safety;
- policy → must NOT bypass safety;
- LLM → must NOT bypass safety;
- operator → must NOT bypass a mandatory safety constraint.

(SG-001, SG-019.)

---

## 7. Fail-Closed Semantics

For **consequential actions**, if any of the following cannot be reliably
established, execution permission is NOT granted:

```
UNKNOWN · DEGRADED · NULL · STALE · MISSING · INVALID ·
CONFLICTING · UNAVAILABLE · EVALUATION_FAILURE
```

- These MUST NOT silently become `EXECUTABLE` / `PERMITTED`.
- They MUST NOT automatically become `NO_ACTION` — the P5-04 outcome is
  recorded as NOT_DETERMINED / BLOCKED / UNAVAILABLE / ERROR as
  appropriate (SG-002, SG-003).
- **P5-04 inability to grant permission ≠ P5-03 NO_ACTION.** The P5-03
  decision (SELECTED) remains a historical fact; P5-04 adds a downstream
  progression result.

For **advisory actions**, fail-closed applies to *permission* only when
the action class requires it (see §8) — advisory actions do not carry
execution permission semantics by default.

---

## 8. Advisory vs Consequential Treatment

- Advisory candidates (MONITOR / REVIEW / INVESTIGATE — P5-02 AD-005,
  taxonomy PROVISIONAL): no execution permission required; no
  consequential safety gate by default; per-action mapping explicit.
- Consequential candidates (REDUCE_EXPOSURE / INCREASE_EXPOSURE /
  REBALANCE — PROVISIONAL): full safety → authority → approval →
  automation → permission pipeline; fail-closed (§7).
- Candidates not requiring execution permission: treated as advisory for
  permission purposes.
- Candidates requiring approval: approval required per P5-04 approval
  policy (per-action mapping explicit, §13/§15; detailed mapping is P5-04
  rule-level, deferred where not frozen).
- Taxonomy membership is NOT silently promoted (P5-02 AD-005 authority).

---

## 9. Guardrail Model

A conceptual guardrail:

| Field | Necessity |
|---|---|
| guardrailId | stable identity (audit, versioning) |
| version | which guardrail version owns it |
| purpose | human-readable intent |
| applicability | which action classes/subjects it gates |
| input requirements | which §7-quality inputs it consumes |
| evaluation result | PASS / BLOCK / NOT_DETERMINED / UNAVAILABLE / ERROR (§10) |
| blocker classification | SAFETY (with rule ref, version, evaluatedAt, reason, evidence, actor where applicable) |
| provenance | exact refs for replay (§27) |
| effectiveAt / evaluatedAt | temporal validity |
| severity | NOT invented — only if an existing contract justifies it (none currently); PROVISIONAL otherwise |
| failure semantics | how a failure of this guardrail is recorded (never permission) |

No numeric severity scales are invented.

---

## 10. Guardrail Outcomes

| Outcome | Meaning | Consequential treatment |
|---|---|---|
| PASS | guardrail satisfied | contributes to permission gate |
| BLOCK | guardrail violated | SAFETY-BLOCKED (SG-004) |
| NOT_DETERMINED | could not determine satisfaction | **no permission** (fail-closed) |
| UNAVAILABLE | required input/system unavailable | **no permission** (fail-closed) |
| ERROR | guardrail evaluation failed | **no permission** (fail-closed) |
| NOT_APPLICABLE | guardrail does not apply to this action | explicit per-guardrail semantics — NOT automatically PASS; a *mandatory* guardrail that cannot be evaluated is NOT_DETERMINED |

BLOCK / NOT_DETERMINED / ERROR are never collapsed into one result
(SG-003). NOT_APPLICABLE semantics are documented per guardrail, never
assumed equal to PASS.

---

## 11. Safety Evaluation Contract

Safety evaluation is deterministic rule evaluation over:
- P4 status/degradation (consumed, never re-derived);
- guardrail versions and results;
- action class consequentiality;
- material-change state (§21);
- staleness/expiry state (§22);
- conflicting-input resolution (§24).

Output: a safety evaluation record — `{ actionRef, guardrailResults[],
aggregate: PASS | BLOCK | NOT_DETERMINED, provenance, versions, evaluatedAt
}`. Aggregate PASS is required (with every applicable guardrail PASS)
before authority/approval/permission may be considered for consequential
actions.

---

## 12. Blocker Provenance

P5-03's distinction is preserved (P5-03 §28, PD-018):

| Blocker | Emitted by | Provenance |
|---|---|---|
| POLICY-BLOCKED | P5-03 | decisionOutcome = BLOCKED, blockerReport.source = POLICY, rule refs |
| SAFETY-BLOCKED | **P5-04** | blockerSource = SAFETY, blockerId, guardrail ref + version, evaluatedAt, reason, evidence refs |
| APPROVAL-DENIED | **P5-04** | approvalId, authority ref, decisionId/actionId ref, timestamp, reason |

Every blocker is auditable; no opaque `blocked = true` (SG-004, SG-005).

---

## 13. Approval Model

**Approval is an explicit authorization event** (SG-005, SG-008).
Approval MUST NOT mean: alert acknowledgement (C-001), UI click alone,
P2 evidence status "approved" (C-002), recommendation acceptance, or
system-generated selection.

Approval record (contract — no IAM implementation):

| Field | Necessity |
|---|---|
| approvalId | stable identity |
| decisionId / actionId ref | what is being approved |
| approvalState | §14 |
| authority / approver ref | WHO approved, under WHICH authority (§15) |
| timestamp | WHEN |
| approval policy version | WHICH rules governed |
| scope | exact approved parameters/version |
| provenance | full trace refs |
| invalidation semantics | expiry, revocation, material change (§21-§23) |

---

## 14. Approval States

P5-02 orthogonal model preserved (AD-009): decisionState, approvalState,
executionState remain separate dimensions — never collapsed.

Approval states (only those justified):

| State | Meaning | Terminal? |
|---|---|---|
| NOT_REQUIRED | approval policy says no approval needed | terminal (dimension inactive) |
| PENDING | awaiting explicit approval | no |
| APPROVED | authority granted, bound to candidate/version | yes |
| DENIED | authority refused | yes |
| EXPIRED | approval not acted on within validity (policy-defined; duration OPEN) | yes |
| REVOKED | invalidated (material change / authority revoked / safety change) | yes |

No state explosion (SG-006).

---

## 15. Authority Model

A conceptual authority contract (NOT an RBAC system; no organizational
roles invented — any role examples are ILLUSTRATIVE / PROVISIONAL):

| Field | Meaning |
|---|---|
| authorityId | stable identity |
| authority scope | what kind of authority (approval grant / permission grant) |
| action scope | which action classes it may authorize |
| subject scope | which subjects it may authorize |
| approval requirement | what it may approve |
| version | authority policy version |
| validity | effective window (durations OPEN) |
| provenance | who defined it, when, under what policy |

"WHO may approve WHAT under WHICH authority" is answered by this contract;
the concrete authority registry is P5-04-IMPL (with owner confirmation)
and must never bypass safety (SG-001).

---

## 16. Human-in-the-Loop

Human approval must be explicit. NOT equivalent:
displayed recommendation ≠ acknowledged alert ≠ clicked UI button ≠
approved action ≠ authorized execution.

Approval is: explicit, traceable, scoped, version-bound, revocable where
applicable. A human must NOT bypass mandatory safety constraints merely
because approval exists (SG-008, SG-019).

---

## 17. Automation Modes

Master modes preserved (Master §17): ADVISORY, ASSISTED, AUTONOMOUS.

| Mode | Meaning | v1 permitted? | Execution permission? | Human approval? | Mandatory safety? |
|---|---|---|---|---|---|
| ADVISORY | decision/explanation for humans; nothing else | **YES (default)** | NOT_GRANTED (v1) | n/a | yes (where applicable) |
| ASSISTED | decision prepared; human confirms before anything executable | NO (future CANDIDATE) | future, only with explicit approval contract | yes | yes — never bypassed |
| AUTONOMOUS | executes without per-action human approval | NO (future CANDIDATE) | future, requires separate frozen contract | not assumed | yes — never bypassed |

- ASSISTED / AUTONOMOUS are NOT frozen as allowed modes (SG-009).
- **automation mode ≠ approval state ≠ action type ≠ execution state**
  (Master §17; P5-02 AD-009).

---

## 18. Advisory-Only v1

- v1 operational contract (SG-010): **ADVISORY-ONLY**. The mode itself
  remains PROVISIONAL per Master §17; the v1 operational consequence is
  FROZEN.
- For consequential actions in v1: **execution permission =
  NOT_GRANTED** — the permission field exists and is deterministically
  NOT_GRANTED; no execution path exists.
- `ADVISORY ≠ APPROVED`; `ADVISORY ≠ EXECUTABLE` (Master §16).
- ASSISTED / AUTONOMOUS: PROVISIONAL / FUTURE (each requires explicit
  approval + separate safety contract before any execution permission can
  be considered).
- **Interpretation guard (R2):** v1 NOT_GRANTED is a **v1 safety
  boundary** — it is NOT a statement that consequential action types are
  invalid, impossible forever, or that future automation modes are frozen.
  The action taxonomy (P5-02 AD-005) and future mode contracts remain
  separate decisions.

---

## 19. Execution Permission

**EXECUTION_PERMISSION_GRANTED is a distinct authorization result** — it
MUST NOT mean execution happened (SG-011).

```
SELECTED
   ↓
SAFETY PASS
   ↓
APPROVAL PASS
   ↓
AUTHORITY PASS
   ↓
AUTOMATION PERMITTED
   ↓
EXECUTION_PERMISSION_GRANTED
   ↓
[OUT OF SCOPE — actual execution]
```

Permission states: NOT_APPLICABLE (advisory/v1 default) · NOT_GRANTED ·
GRANTED · EXPIRED · REVOKED. In v1, consequential actions are
deterministically NOT_GRANTED; GRANTED is reachable only under a future
frozen execution-mode contract.

---

## 20. Execution Permission Conditions

Conceptual condition dimensions (no numeric thresholds; §32):

- action validity (decision DECIDED, not SUPERSEDED/EXPIRED/CANCELLED);
- policy validity (policy version still current);
- safety PASS (all applicable guardrails PASS);
- authority (authority scope covers action+subject);
- approval (APPROVED, bound to this candidate/version);
- automation mode (permitted by the frozen mode contract);
- freshness (evidence/permission not stale — durations OPEN);
- material-change status (no material change since approval — §21);
- permission expiry/revocation status (§22-§23).

If any required condition is unknown for a consequential action:
permission is NOT granted (fail-closed, §7).

---

## 21. Material-Change Invalidation

Approval and execution permission are invalidated when material inputs
change (SG-012; P5-02 AD-016).

Conceptual categories of material change:
- P4 evidence snapshot changed (p4SnapshotRef no longer current);
- action parameters changed;
- policy version changed;
- guardrail version changed;
- approval scope changed;
- subject changed;
- automation mode changed.

Exact "material" criteria are PROVISIONAL (no invented numeric
tolerances); the invalidation contract is FROZEN: any material change ⇒
approval/permission invalidated; progression requires re-evaluation and,
where required, re-approval; the historical record is preserved (no
retroactive mutation).

---

## 22. Staleness / Expiry

Separated, never collapsed (SG-014):

| Concept | Meaning | Duration |
|---|---|---|
| evidence staleness | P4 context outdated (P5-02 AD-022 STALE) | policy/guardrail-defined; OPEN |
| approval expiry | approval validity window | OPEN |
| permission expiry | permission validity window | OPEN |
| policy expiry | P5-03 policy version window | P5-03; OPEN |
| decision expiry | P5-02 decision horizon | P5-03; OPEN |

No durations invented. Any stale/expired state ⇒ no execution permission
for consequential actions (fail-closed).

---

## 23. Revocation

Explicit revocation semantics (SG-013):

Possible causes: approval revoked; authority revoked; safety condition
changed; guardrail version invalidated; action superseded; material
change; permission expired.

- Revocation **prevents further execution permission**.
- Revocation does **not** retroactively change historical facts (audit
  trail immutable).
- Revocation is an event with provenance (actor, time, reason, refs).

---

## 24. Conflicting Inputs

Behavior when safety-relevant inputs conflict (SG-015):

| Conflict | Handling |
|---|---|
| P4 evidence inconsistent | P4 EVIDENCE_CONFLICT is a declared input; treated per guardrail rules |
| P4 snapshot mismatch | identity/version mismatch ⇒ NOT_DETERMINED for consequential |
| policy version mismatch | evaluation uses the recorded version; mismatch ⇒ NOT_DETERMINED |
| guardrail version mismatch | recorded versions used; mismatch ⇒ NOT_DETERMINED |
| approval references obsolete decision | approval invalid (superseded decision) ⇒ permission not granted |
| multiple authorities disagree | unresolved ⇒ NOT_DETERMINED; no scoring; permission not granted |

For consequential actions: an **unresolved safety-relevant conflict must
NOT result in execution permission** (no scoring mechanism invented).

---

## 25. Approval + Safety Ordering

- Ordering is NOT universally fixed (Safety→Approval or Approval→Safety
  both possible depending on semantics).
- Mandatory invariants:
  - NO approval may bypass mandatory safety;
  - NO automation may bypass mandatory safety;
  - NO execution permission may exist while mandatory safety requirements
    are unresolved;
  - checks that are independent may run in parallel (implementation
    decision);
  - any failure that invalidates a safety requirement invalidates
    downstream approval/permission.

(SG-001, SG-002, SG-019.)

---

## 26. LLM Boundary

- LLM MUST NOT be authoritative for: safety decision, guardrail override,
  approval, authority, execution permission (SG-016).
- LLM may assist with: explanation, summarization, human-facing rationale
  — with defined provenance; deterministic/system-controlled contracts
  remain authoritative.
- Current repository has no LLM in decision paths (verified P5-03 §31);
  this contract keeps it that way.

---

## 27. Audit / Provenance Requirements

Every consequential safety/approval/permission decision must be
reconstructable. Conceptual references (provenance contract only — P5-05
implements):

- decisionId; actionId; p4SnapshotRef;
- policyId/version; guardrailId/version; approval policy version;
- approvalId; authority reference; automation mode;
- evaluation timestamp; actor where applicable; result; blocker/reason;
- material-change state.

---

## 28. Replayability

A historical safety/approval/permission outcome must be reconstructable
from exact refs and versions without live systems (SG-017):

- P4 snapshot ref (identity + version + contentHash — AD-014);
- policy version; guardrail versions; approval policy version; authority
  version; automation configuration version;
- guardrail results; approval record; permission record;
- evaluation timestamps.

Replay never requires current P4 data, current policy, or current
approval configuration.

---

## 29. Idempotency

Distinct layers (never one universal key):

- decision idempotency → P5-03 (AD-018);
- approval idempotency → approvalId (P5-04 contract);
- execution-permission idempotency → permission identity (P5-04 contract);
- actual execution idempotency → OUT OF SCOPE (execution layer).

P5-04 defines approval/permission identities only; it does not implement
execution idempotency.

---

## 30. Failure Semantics

Distinct outcomes, never collapsed (SG-002/003/004):

| Failure | Outcome | Consequential treatment |
|---|---|---|
| safety evaluation failure | ERROR / NOT_DETERMINED | no permission |
| guardrail unavailable | UNAVAILABLE | no permission |
| approval unavailable | NOT_DETERMINED | no permission |
| authority resolution failure | NOT_DETERMINED | no permission |
| permission evaluation failure | ERROR / NOT_DETERMINED | no permission |
| system error | ERROR | no permission |

Failure is NEVER silently permission-granted and NEVER automatically
converted to NO_ACTION. Denial semantics: explicit DENIED (approval) and
BLOCK (safety) are distinct from NOT_DETERMINED — all preserved with
provenance for P5-05.

---

## 31. Denial Semantics

- **APPROVAL-DENIED**: explicit authority refusal — terminal approval
  state with approvalId, authority ref, timestamp, reason.
- **SAFETY-BLOCKED**: guardrail violation — terminal for this progression
  (re-evaluation possible only when the violating condition clears).
- **NOT_DETERMINED / ERROR / UNAVAILABLE**: not a denial — an inability to
  establish; also blocks permission for consequential actions.
- Denial ≠ P5-03 NO_ACTION; denial ≠ suppression (P5-03 SUPPRESSED).

---

## 32. Escalation Boundary

- ESCALATE remains CANDIDATE (P5-02 AD-007); P5-03 deferred details
  (DSD-002).
- P5-04 defines only the safety/authority boundary: an escalation cannot
  bypass mandatory safety; escalation is a workflow/authority concept, not
  an execution permission.
- Full ESCALATE semantics (authority, recipient, notification, severity)
  are NOT frozen here — they belong to P5-04 approval-policy refinement /
  P5-06.

---

## 33. Versioning

Separate versions, never one universal number (SG-018):

P4 version tuple (consumed) · algorithm version (P4) · action-model
version (P5-02) · policy version (P5-03) · guardrail version (P5-04) ·
approval policy version (P5-04) · authority version (P5-04) · automation
configuration version (P5-04).

All consequential permission decisions identify every version required to
reconstruct them (§27-§28).

---

## 34. Safety Override

- **No hidden override path** (SG-019).
- Forbidden: admin override bypasses safety; human approval bypasses
  mandatory safety; LLM override; automation override; policy override.
- Emergency override concept: **OUT OF SCOPE / PROVISIONAL** — not
  designed here.

---

## 35. Numeric Threshold Ban

No invented: risk limits, confidence thresholds, exposure thresholds,
loss limits, position limits, cooldown durations, expiry durations,
approval scores, safety scores (SG-020).

Legacy values 90/80/65 and 25/15/8 remain LEGACY — no reuse.

---

## 36. BUY / SELL Ban

P5-04 is NOT a trading engine. BUY / SELL / LONG / SHORT / ORDER / TRADE
appear here only as prohibitions/boundary statements. No action semantics
of those words are defined. REDUCE_EXPOSURE / INCREASE_EXPOSURE /
REBALANCE remain mechanism-neutral types (P5-02 AD-008).

---

## 37. Decision Records

### SG-001 — Safety is First-Class
Status: **FROZEN**
Decision: safety evaluation precedes/coexists with authority/approval/
permission; no layer may bypass mandatory safety.
Rationale: Master §15/§21; P5-04 §6.
Alternatives: safety as a policy sub-check — rejected (P5-03 PD-015 keeps
safety outside policy).
Downstream: all P5-04-IMPL, P5-05.

### SG-002 — Fail-Closed for Consequential Actions
Status: **FROZEN**
Decision: if any required safety/authority/approval input cannot be
reliably established, execution permission is NOT granted; results are
NOT_DETERMINED/BLOCKED/UNAVAILABLE/ERROR — never PERMITTED, never silent
NO_ACTION.
Rationale: Master §15/§21; P5-04 §7.
Alternatives: best-effort permission — rejected (unsafe).
Downstream: permission engine, P5-05.

### SG-003 — Guardrail Result Semantics
Status: **FROZEN**
Decision: PASS / BLOCK / NOT_DETERMINED / UNAVAILABLE / ERROR distinct;
NOT_APPLICABLE has explicit per-guardrail semantics, never assumed PASS.
Rationale: §10; audit truth.
Alternatives: PASS/FAIL binary — rejected (loses failure semantics).
Downstream: P5-04-IMPL.

### SG-004 — Safety Blocker Provenance
Status: **FROZEN**
Decision: SAFETY-BLOCKED carries full provenance (source/rule ref/version/
evaluatedAt/reason/evidence/actor); no opaque blocked=true.
Rationale: §12; P5-03 PD-018 preservation.
Downstream: P5-05 audit.

### SG-005 — Approval ≠ Acknowledgement
Status: **FROZEN**
Decision: approval is an explicit authorization event; never alert
acknowledgement (C-001), P2 evidence "approved" (C-002), UI click,
recommendation acceptance, or system-generated selection.
Rationale: P5-01 C-001/C-002; Master §16.
Downstream: approval engine, P5-05 language policy.

### SG-006 — Approval State Semantics
Status: **FROZEN** (structure)
Decision: NOT_REQUIRED / PENDING / APPROVED / DENIED / EXPIRED / REVOKED —
orthogonal to decisionState and executionState (AD-009); no state
explosion.
Rationale: §14; P5-02 AD-009.
Downstream: P5-04-IMPL, P5-05.

### SG-007 — Authority Contract
Status: **PROVISIONAL**
Decision: conceptual authority contract (scope/action scope/subject scope/
approval requirement/version/validity/provenance); no RBAC; no invented
roles (examples ILLUSTRATIVE).
Rationale: §15; repository has no authz infra (P5-01 §10).
Downstream: P5-04-IMPL (authority registry), P5-06.

### SG-008 — Human Approval Semantics
Status: **FROZEN**
Decision: approval explicit/traceable/scoped/version-bound/revocable;
human cannot bypass mandatory safety.
Rationale: Master §16; §16 of this doc.
Downstream: approval engine.

### SG-009 — Automation Mode Semantics
Status: **FROZEN** (structure); mode permissions PROVISIONAL
Decision: ADVISORY (v1 default) / ASSISTED / AUTONOMOUS (future
CANDIDATE); mode ≠ approval state ≠ action type ≠ execution state;
ASSISTED/AUTONOMOUS not frozen as allowed modes.
Rationale: Master §17; §17 of this doc.
Downstream: automation config (P5-04), P5-06.

### SG-010 — Advisory-Only v1
Status: **FROZEN** (v1 operational consequence); mode PROVISIONAL (Master §17)
Decision: v1 = ADVISORY-ONLY; execution permission = NOT_GRANTED for
consequential actions in v1; ADVISORY ≠ APPROVED ≠ EXECUTABLE.
Rationale: Master §17/§18; §18 of this doc.
Downstream: permission engine, P5-06 read path.

### SG-011 — Execution Permission Semantics
Status: **FROZEN**
Decision: EXECUTION_PERMISSION_GRANTED is a distinct authorization result;
permission ≠ execution; v1 default NOT_GRANTED.
Rationale: Master §18; §19 of this doc.
Downstream: permission engine (boundary only).

### SG-012 — Material-Change Invalidation
Status: **FROZEN** (contract); criteria PROVISIONAL
Decision: material change (snapshot/parameters/policy/guardrail/scope/
subject/automation mode) invalidates approval and permission; re-evaluation
required; history preserved.
Rationale: P5-02 AD-016; §21.
Downstream: approval/permission lifecycle.

### SG-013 — Revocation
Status: **FROZEN**
Decision: explicit revocation prevents further permission; causes listed;
no retroactive mutation of history.
Rationale: §23; audit integrity.
Downstream: approval/permission engine, P5-05.

### SG-014 — Staleness / Expiry Separation
Status: **FROZEN**
Decision: evidence staleness / approval expiry / permission expiry /
policy expiry / decision expiry are separate; durations OPEN.
Rationale: §22; P5-02 AD-022.
Downstream: permission engine.

### SG-015 — Conflicting Input Handling
Status: **FROZEN**
Decision: unresolved safety-relevant conflict ⇒ no permission for
consequential actions; no scoring.
Rationale: §24; fail-closed.
Downstream: safety evaluation.

### SG-016 — LLM Non-Authority
Status: **FROZEN**
Decision: LLM never authoritative for safety/guardrail/approval/authority/
execution permission; assistive only with provenance.
Rationale: Master §8.2/§9; §26; repo audit (no LLM in decision paths).
Downstream: all.

### SG-017 — Replayability
Status: **FROZEN**
Decision: historical safety/approval/permission outcomes reconstructable
from exact refs/versions without live systems.
Rationale: §28; P4-07/P5-03 precedent.
Downstream: P5-07 replay, P5-05 audit.

### SG-018 — Version Separation
Status: **FROZEN**
Decision: P4/algorithm/action-model/policy/guardrail/approval-policy/
authority/automation versions separate; no universal version.
Rationale: §33; P5-02 AD-017.
Downstream: provenance records.

### SG-019 — No Safety Override
Status: **FROZEN**
Decision: no hidden override; admin/human/LLM/automation/policy cannot
bypass mandatory safety; emergency override OUT OF SCOPE/PROVISIONAL.
Rationale: Master §9/§15; §34.
Downstream: all.

### SG-020 — No Hidden Thresholds
Status: **FROZEN**
Decision: no invented risk/confidence/exposure/loss/position limits,
durations, or safety/approval scores; legacy 90/80/65, 25/15/8 remain
LEGACY.
Rationale: Master §8.5/§31; §35.
Downstream: all rule configs.

---

## 38. Matrices

### 38.1 Safety Outcome Matrix

| Outcome | Meaning | Consequential effect |
|---|---|---|
| PASS | all applicable guardrails satisfied | proceeds to authority/approval |
| BLOCK | guardrail violated | SAFETY-BLOCKED; no permission |
| NOT_DETERMINED | cannot establish | no permission |
| UNAVAILABLE | input/system unavailable | no permission |
| ERROR | evaluation failed | no permission |

### 38.2 Guardrail Result Matrix

| Result | Advisory action | Consequential action |
|---|---|---|
| PASS | contributes to (advisory) outcome | required for permission |
| BLOCK | advisory noted | SAFETY-BLOCKED |
| NOT_DETERMINED | advisory noted | no permission |
| UNAVAILABLE | advisory noted | no permission |
| ERROR | advisory noted | no permission |
| NOT_APPLICABLE | explicit per-guardrail semantics | explicit per-guardrail semantics; mandatory-but-unevaluable = NOT_DETERMINED |

### 38.3 Blocker Provenance Matrix

| Blocker | Source | Emitted by | Key provenance |
|---|---|---|---|
| POLICY-BLOCKED | POLICY | P5-03 | rule refs, policy version |
| SAFETY-BLOCKED | SAFETY | P5-04 | guardrail ref+version, evaluatedAt, reason, evidence |
| APPROVAL-DENIED | APPROVAL | P5-04 | approvalId, authority ref, timestamp, reason |

### 38.4 Approval State Matrix

| State | Meaning | Terminal? |
|---|---|---|
| NOT_REQUIRED | policy: no approval | terminal (inactive) |
| PENDING | awaiting approval | no |
| APPROVED | granted, version-bound | yes |
| DENIED | refused | yes |
| EXPIRED | validity passed | yes |
| REVOKED | invalidated | yes |

### 38.5 Authority Matrix

| Field | Meaning | Status |
|---|---|---|
| authorityId | stable identity | FROZEN |
| authority scope | grant type | FROZEN |
| action scope | action classes covered | PROVISIONAL |
| subject scope | subjects covered | PROVISIONAL |
| approval requirement | what may be approved | PROVISIONAL |
| version / validity | authority policy version + window | FROZEN / OPEN duration |
| provenance | definition trace | FROZEN |

### 38.6 Automation Matrix

| Mode | v1? | Execution permission | Human approval | Safety |
|---|---|---|---|---|
| ADVISORY | YES (default) | NOT_GRANTED | n/a | mandatory (where applicable) |
| ASSISTED | NO (future CANDIDATE) | future only | yes | never bypassed |
| AUTONOMOUS | NO (future CANDIDATE) | future only, separate contract | not assumed | never bypassed |

### 38.7 Execution Permission Matrix

| State | Meaning | v1 |
|---|---|---|
| NOT_APPLICABLE | advisory / no execution in scope | default |
| NOT_GRANTED | not permitted | default for consequential |
| GRANTED | EXECUTION_PERMISSION_GRANTED | not reachable (future contract) |
| EXPIRED / REVOKED | invalidated | modeled only |

### 38.8 Failure Matrix

| Failure | Outcome | Permission |
|---|---|---|
| safety evaluation failure | ERROR / NOT_DETERMINED | no |
| guardrail unavailable | UNAVAILABLE | no |
| approval unavailable | NOT_DETERMINED | no |
| authority resolution failure | NOT_DETERMINED | no |
| permission evaluation failure | ERROR / NOT_DETERMINED | no |
| system error | ERROR | no |

### 38.9 Material Change Matrix

| Change category | Invalidation | Re-approval? |
|---|---|---|
| P4 snapshot changed | approval + permission invalidated | yes (if approval-bound) |
| action parameters changed | invalidated | yes |
| policy version changed | invalidated | per approval policy |
| guardrail version changed | invalidated | yes (safety re-run) |
| approval scope changed | invalidated | yes |
| subject changed | invalidated | yes |
| automation mode changed | invalidated | yes (separate contract) |

### 38.10 Version / Provenance Matrix

| Version | Source | Reconstructable? |
|---|---|---|
| P4 version tuple | P4 (consumed) | yes |
| action-model version | P5-02 | yes |
| policy version | P5-03 | yes |
| guardrail version | P5-04 | yes |
| approval policy version | P5-04 | yes |
| authority version | P5-04 | yes |
| automation config version | P5-04 | yes |

### 38.11 P5-03 → P5-04 Handoff Matrix

| P5-03 outcome | P5-04 treatment |
|---|---|
| SELECTED | proceeds to safety/authority/approval/permission pipeline |
| POLICY-BLOCKED | preserved; P5-04 not engaged for progression |
| NO_ACTION | no action to progress |
| NOT_DETERMINED | no progression (P5-03 outcome preserved) |
| SUPPRESSED | no new decision; nothing to progress |

### 38.12 Frozen / Provisional / Open Matrix

| Area | Status |
|---|---|
| Safety first-class | FROZEN |
| Fail-closed | FROZEN |
| Guardrail outcomes | FROZEN |
| Safety blocker provenance | FROZEN |
| Approval ≠ acknowledgement | FROZEN |
| Approval states | FROZEN (structure) |
| Authority contract | PROVISIONAL |
| Human-in-the-loop | FROZEN |
| Automation modes | FROZEN (structure); permissions PROVISIONAL |
| Advisory-only v1 | FROZEN (v1 consequence); mode PROVISIONAL |
| Execution permission semantics | FROZEN |
| Material-change criteria | PROVISIONAL |
| Revocation | FROZEN |
| Staleness/expiry durations | OPEN |
| Conflicting inputs | FROZEN |
| LLM non-authority | FROZEN |
| Replayability | FROZEN |
| Version separation | FROZEN |
| No safety override | FROZEN |
| No hidden thresholds | FROZEN |
| ESCALATE semantics | DEFERRED |
| Emergency override | OUT OF SCOPE / PROVISIONAL |
| Execution mechanics | OUT OF SCOPE |

---

## 39. Core Flow

```
P5-03
  │
  ▼
Action Decision (SELECTED)
  │
  ▼
P5-04 Applicability
  │
  ▼
Safety / Guardrails
  │
  ├── BLOCKED ─────────────► SAFETY-BLOCKED (provenance)
  ├── NOT_DETERMINED ──────► no permission (fail-closed)
  └── PASS
           │
           ▼
Authority
           │
           ▼
Approval
           │
           ├── DENIED ──────► APPROVAL-DENIED (provenance)
           ├── PENDING ─────► awaiting
           └── APPROVED
                    │
                    ▼
             Automation Policy (v1 = ADVISORY-ONLY)
                    │
                    ▼
          Execution Permission (v1 = NOT_GRANTED)
                    │
                    ▼
               OUT OF SCOPE (execution)
```

Conceptual only — not implementation architecture.

---

## 40. P5-03 Handoff (preserved)

P5-03 outcomes preserved verbatim: POLICY-BLOCKED · NO_ACTION ·
NOT_DETERMINED · SUPPRESSED · SELECTED. P5-04 adds its own downstream
results — SAFETY-BLOCKED · APPROVAL-DENIED · EXECUTION-PERMISSION — and
never overwrites P5-03 historical semantics (§38.11).

---

## 41. P5-05 Handoff

P5-04 exposes sufficient information for: action explanation, audit
trail, decision reconstruction, approval reconstruction, safety
reconstruction (§27). P5-05 owns detailed explanation, audit presentation,
and audit persistence design. P5-04 defines the provenance contract only.

---

## 42. P4-06 Independence

- **P4-06 remains OPEN / DATA ACCRUAL.**
- P5-04 does NOT wait for P4-06.
- P5-04 does NOT promote any P4 provisional rules.
- **No P5-04 dependency on P4-06 closure.**

---

## 43. Acceptance Criteria

P5-04 exit criteria — all met:

- [x] Safety boundary defined (§5-§6)
- [x] Guardrail model defined (§9-§11)
- [x] Safety evaluation contract defined (§11)
- [x] Safety blocking semantics defined (§10, §12)
- [x] Authority model defined (§15)
- [x] Approval model defined (§13-§14)
- [x] Human-in-the-loop defined (§16)
- [x] Automation modes defined (§17-§18)
- [x] Execution permission defined (§19-§20)
- [x] Permission expiry/invalidation defined (§22-§23)
- [x] Material-change invalidation defined (§21)
- [x] Approval provenance defined (§13, §27)
- [x] Safety provenance defined (§12, §27)
- [x] Failure semantics defined (§30)
- [x] Denial semantics defined (§31)
- [x] Escalation boundary defined (§32)
- [x] Audit requirements defined (§27)
- [x] Versioning defined (§33)
- [x] Replayability defined (§28)
- [x] Determinism addressed (§11, SG-003/015)
- [x] Fail-closed behavior defined (§7)
- [x] P5-05 handoff defined (§41)
- [x] Decision records included (§37)
- [x] 12 matrices included (§38)
- [x] Core flow included (§39)
- [x] No production code / no P3/P4/P4-06 changes
- [x] Exactly one document created
- [x] R2: cross-document consistency matrix recorded (§45)
- [x] R2: freeze matrix recorded (§46)
- [x] R2: 16-gate freeze audit PASS (§44)
- [x] R2: P5-04 marked FROZEN / APPROVED FOR DOWNSTREAM

---

## 44. 16-Gate Freeze Audit (P5-04 R2)

| Gate | Result | Evidence | Required correction |
|---|---|---|---|
| 1. P4 → P5 boundary | **PASS** | P4 status/degradation consumed, never re-derived; no DirectionScore/OpportunityScore/ConfidenceScore (§11, SG-003) | none |
| 2. P5-03 compatibility | **PASS** | POLICY-BLOCKED / NO_ACTION / NOT_DETERMINED / SUPPRESSED / SELECTED preserved (§40); SAFETY/APPROVAL downstream (§38.11); NO_ACTION never produced by safety/approval failures (§7, §30) | none |
| 3. Safety first-class | **PASS** | SG-001/§6: no layer bypasses safety; no hidden override (SG-019/§34) | none |
| 4. Fail-closed | **PASS** | SG-002/§7: UNKNOWN/DEGRADED/NULL/STALE/MISSING/INVALID/CONFLICTING/UNAVAILABLE/FAILURE never → PERMITTED; never silent NO_ACTION | none |
| 5. Guardrail semantics | **PASS** | SG-003/§10: PASS/BLOCK/NOT_DETERMINED/UNAVAILABLE/ERROR distinct; NOT_APPLICABLE explicit, never assumed PASS | none |
| 6. Guardrail failure semantics | **PASS** | §10/§30: failures never collapse; no permission on NOT_DETERMINED/UNAVAILABLE/ERROR | none |
| 7. Approval ≠ acknowledgement | **PASS** | SG-005/§13: C-001/C-002 protected; approval = explicit authorization event, never UI click / ack / P2 status / system flag | none |
| 8. Approval provenance | **PASS** | §13: approvalId, decisionId/actionId ref, state, authority, timestamp, scope, policy/approval version, provenance, invalidation | none |
| 9. Authority boundary | **PASS** | SG-007/§15: conceptual contract; no RBAC/roles; any role examples ILLUSTRATIVE ONLY | none |
| 10. Human-in-loop | **PASS** | SG-008/§16: explicit/traceable/scoped/version-bound/revocable; human cannot bypass mandatory safety | none |
| 11. Automation boundary | **PASS** | SG-009/§17-§18: mode ≠ approval ≠ type ≠ execution; ASSISTED/AUTONOMOUS CANDIDATE/FUTURE, not frozen; ADVISORY-ONLY v1 | none |
| 12. Permission ≠ execution | **PASS** | SG-011/§19: EXECUTION_PERMISSION_GRANTED is an authorization result, ≠ EXECUTED; no order/trade description | none |
| 13. No hidden threshold/score | **PASS** | SG-020/§35: none invented; legacy 90/80/65, 25/15/8 LEGACY, not reused | none |
| 14. No BUY/SELL semantics | **PASS** | §36: words appear only as prohibitions/boundary; REDUCE/INCREASE_EXPOSURE mechanism-neutral | none |
| 15. P4-06 independence | **PASS** | §42: OPEN / DATA ACCRUAL; no dependency, no promotion, no waiting | none |
| 16. Implementation discipline | **PASS** | Only this document created; no src/P3/P4/API/UI/DB/migrations | none |

## 45. Cross-Document Consistency Matrix (P5-04 R2)

| P5-02 Semantic | P5-03 Semantic | P5-04 Treatment | Status |
|---|---|---|---|
| NO_ACTION (decision outcome, AD-003) | NO_ACTION (completed evaluation, PD-003) | preserved; never produced by safety/approval failure (§7) | CONSISTENT |
| NOT_DETERMINED (AD-004) | NOT_DETERMINED (PD-008/009) | preserved; fail-closed for consequential (§7, §30) | CONSISTENT |
| BLOCKED (AD-004/AD-011) | POLICY-BLOCKED (PD-018) | distinct; SAFETY-BLOCKED / APPROVAL-DENIED added downstream with provenance (§12, §38.3) | CONSISTENT |
| SUPPRESSED (layer result, PD-019) | SUPPRESSED (PD-019) | preserved; no decision produced; nothing to progress (§38.11) | CONSISTENT |
| SELECTED (AD-004) | SELECTED (PD-003) | downstream safety/authority/approval/permission pipeline (§5, §39) | CONSISTENT |
| ELIGIBLE (result, AD-010) | ELIGIBLE (PD-002) | ≠ SAFE; P5-04 may reject (SG-001/§40) | CONSISTENT |
| APPROVED (approvalState, AD-009) | — | approval state owned by P5-04 (§14, SG-006) | CONSISTENT |
| EXECUTABLE (executionState, AD-009) | — | permission result; v1 NOT_GRANTED (§19-§20, SG-011) | CONSISTENT |
| EXECUTED (executionState, AD-009) | — | execution layer; OUT OF SCOPE (§4, §39) | CONSISTENT |

No silent semantic override found across P5-02 → P5-03 → P5-04.

## 46. Freeze Matrix (P5-04 R2)

| Semantic | Status | Owner | Downstream |
|---|---|---|---|
| Safety first-class | FROZEN | P5-04 | implementation |
| Fail-closed consequential | FROZEN | P5-04 | permission |
| Guardrail outcomes (PASS/BLOCK/NOT_DETERMINED/UNAVAILABLE/ERROR/NOT_APPLICABLE) | FROZEN | P5-04 | implementation |
| Guardrail failure semantics | FROZEN | P5-04 | implementation |
| Safety blocker provenance | FROZEN | P5-04 | P5-05 |
| Approval ≠ acknowledgement (C-001/C-002) | FROZEN | P5-04 | approval |
| Approval states + provenance | FROZEN | P5-04 | approval, P5-05 |
| Human-in-the-loop | FROZEN | P5-04 | approval |
| Automation v1 boundary (ADVISORY-ONLY; permission NOT_GRANTED) | FROZEN (v1 consequence); mode PROVISIONAL (Master §17) | P5-04 | P5-06 |
| Automation modes beyond v1 (ASSISTED/AUTONOMOUS) | CANDIDATE / FUTURE | P5-04 | separate contracts |
| Authority contract | PROVISIONAL | P5-04 | implementation |
| Material-change criteria | PROVISIONAL | P5-04 | implementation |
| Approval/permission validity durations | OPEN | P5-04/P5-05 | — |
| Cooldown duration | OPEN | P5-03/P5-05 | — |
| Expiry duration | OPEN | P5-03/P5-05 | — |
| Conflicting-input resolution (no scoring) | FROZEN | P5-04 | safety evaluation |
| LLM non-authority | FROZEN | P5-04 | all |
| Replayability / version separation | FROZEN | P5-04 | P5-07 |
| No safety override / no hidden thresholds | FROZEN | P5-04 | all |
| ESCALATE semantics | DEFERRED | P5-04/P5-06 | — |
| Emergency override | OUT OF SCOPE / PROVISIONAL | — | future |
| Execution mechanics | OUT OF SCOPE | — | future |
| Taxonomy membership | PROVISIONAL (P5-02 AD-005) | P5-02 | owner review |

---

## Appendix A — Repository Evidence

- `src/lib/p4/types.ts:280` — ViewModel input (status/degradation consumed)
- `src/lib/p4/explanation/templates.ts:243-253` — BANNED_PHRASES (language policy precedent for P5-05)
- `src/db/schema.ts:687-724` — alert rules/history (C-001 acknowledgement ≠ approval)
- `src/lib/p4/mapper.ts:612` — P2 "approved" evidence status (C-002)
- `src/lib/services/alert.service.ts:60` — acknowledgement semantics (C-001)
- `src/lib/features/engine.ts:158` — legacy thresholds 90/80/65 (LEGACY)
- `src/lib/services/decision-engine.service.ts:14-31` — legacy penalties 25/15/8 (LEGACY)
- P5-01 §10 (approval/automation MISSING), §19 (C-001/C-002/C-003)
- P5-02 AD-005/009/013/014/016/020 (consequential, states, identity, snapshot, material change, approval boundary)
- P5-03 PD-004/015/018/019 (policy precedence, boundary, blocker provenance, suppression)

## Appendix B — P5-01 / P5-02 / P5-03 Findings Consumed

- Approval/automation MISSING in repo → P5-04 designs them as new layers (SG-005/009/010)
- Alert acknowledgement exists → C-001 protected (SG-005)
- P2 "approved" evidence status → C-002 protected (SG-005)
- Legacy thresholds → NOT reused (SG-020)
- P5-02 orthogonal states → approvalState dimension preserved (SG-006)
- P5-03 POLICY-BLOCKED → P5-04 adds SAFETY-BLOCKED/APPROVAL-DENIED (SG-004)

## Appendix C — Rejected / Deferred Alternatives

1. Safety as a policy sub-check — rejected (P5-03 PD-015; SG-001).
2. Best-effort permission — rejected (fail-closed; SG-002).
3. PASS/FAIL binary guardrails — rejected (failure semantics lost; SG-003).
4. Approval = UI click / acknowledgement — rejected (SG-005).
5. Full RBAC roles (ADMIN/TRADER/MANAGER) — rejected/ILLUSTRATIVE only (SG-007).
6. ASSISTED/AUTONOMOUS in v1 — deferred (SG-009/010).
7. Emergency override path — OUT OF SCOPE / PROVISIONAL (SG-019).
8. Numeric safety/approval scores — rejected (SG-020).
9. Universal version number — rejected (SG-018).
10. ESCALATE full semantics — deferred to P5-04 approval policy / P5-06 (§32).

## Appendix D — Terminology Glossary

| Term | Definition |
|---|---|
| guardrail | versioned deterministic safety check (§9) |
| SAFETY-BLOCKED | guardrail violation outcome, P5-04 (§12) |
| APPROVAL-DENIED | explicit authority refusal, P5-04 (§13, §31) |
| EXECUTION_PERMISSION_GRANTED | authorization result, ≠ execution (§19) |
| fail-closed | no permission when required state cannot be established (§7) |
| material change | change invalidating approval/permission (§21) |
| ADVISORY-ONLY | v1 automation default; permission NOT_GRANTED (§18) |
| authority contract | conceptual who-may-approve-what model (§15) |

---

## Verification record (P5-04)

- Original 15-gate self-audit executed: all gates PASS.
- **P5-04 R2 freeze check:** cross-document consistency verified
  (P5-00 → P5-04, §45), freeze matrix recorded (§46), and all 16 freeze
  gates PASS (§44). Document status advanced to FROZEN / APPROVED FOR
  DOWNSTREAM.
- Only this document was created/modified by the P5-04 tasks; git status
  shows no src/P3/P4/P4-06/DB/API/UI/migration changes.
- Pre-existing dirty files (P5-00 R2 Master, P5-01/02/03 docs,
  package-lock.json, tsconfig.tsbuildinfo) untouched.

*End of P5-04 Safety / Guardrail / Approval Engine (R2 — FROZEN /
APPROVED FOR DOWNSTREAM). Design & semantic specification only — no
implementation; no safety, approval, or execution engine built. P5-05
design may proceed after owner confirmation of this freeze.*
