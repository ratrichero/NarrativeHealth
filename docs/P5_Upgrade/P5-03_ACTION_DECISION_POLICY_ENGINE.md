# P5-03 ACTION DECISION / POLICY ENGINE

**Phase:** P5 — What action, if any, should be executed?
**Task:** P5-03 — Action Decision / Policy Engine (R2 — final revision / freeze check)
**Status:** FROZEN / APPROVED FOR DOWNSTREAM (P5-03 revision R2; P5-04 design may proceed after owner confirmation)
**Policy model version:** `p5-policy-model/v1` (P5_POLICY_MODEL_VERSION = "1")
**Authoritative inputs:**
1. `docs/P5_Upgrade/P5_MASTER_SPECIFICATION.md` (FROZEN)
2. `docs/P5_Upgrade/P5-01_CONTRACT_GAP_AUDIT.md` (APPROVED / COMPLETE)
3. `docs/P5_Upgrade/P5-02_SEMANTIC_CONTRACT_ACTION_MODEL.md` (APPROVED / COMPLETE)

This document defines the semantic POLICY layer: **WHEN an ActionCandidate
is eligible and when policy selects or rejects it.** It does NOT define
safety, approval, authority, automation, or execution (P5-04+). It is a
contract/semantic design — no production code, no P3/P4/P4-06
modification.

---

## 1. Executive Summary

- **Policy is a versioned set of explicit deterministic rules** consuming
  the P5-02 Action Model and the frozen P4 ViewModel, producing a policy
  outcome with full traceability (PD-001).
- **Policy outcome vocabulary is inherited from P5-02 (AD-004):**
  SELECTED / NO_ACTION / BLOCKED / NOT_DETERMINED — never collapsed
  (PD-001, PD-008, PD-009).
- **P5-03 R2 freeze:** the three-way block provenance (POLICY-BLOCKED /
  SAFETY-BLOCKED / APPROVAL-DENIED, PD-018), the suppression outcome
  (SUPPRESSED, PD-019), and the ruleId tie-break semantics (§14, PD-004)
  are explicitly resolved and frozen.
- **ELIGIBLE is a policy evaluation result, never an execution
  permission** (PD-002); CONSEQUENTIAL ≠ APPROVED ≠ EXECUTABLE ≠ SAFE
  (PD-015).
- **Precedence is layered and explicit** (applicability → eligibility →
  blocking → suppression → selection), deterministic, no "highest score
  wins" (PD-004).
- **Cooldown and duplicate suppression are policy-owned but duration/
  equivalence are OPEN/PROVISIONAL** — no invented durations (PD-005,
  PD-006).
- **UNKNOWN/DEGRADED/NULL is evaluated explicitly** — outcomes may be
  NOT_DETERMINED / BLOCKED / REVIEW / INVESTIGATE / ESCALATE; never
  NO_ACTION (PD-008). Technical failure → NOT_DETERMINED, never NO_ACTION
  (PD-009).
- **No numeric thresholds are invented.** Legacy values (90/80/65,
  25/15/8) are recorded as LEGACY and NOT reused (PD-014).
- **No BUY/SELL mapping** — Direction is never a direct action mapping
  (PD-014, §11).
- **LLM is never the authoritative policy engine** — the repository has no
  LLM in decision logic today (verified; §31).
- **Policy cannot override Safety, grant Approval, or grant Execution
  Permission** (§28-§32, invariants §38).
- P4-06 remains OPEN / DATA ACCRUAL; P5-03 has no dependency on it.

---

## 2. Authority & Inputs

| Input | Status | Used for |
|---|---|---|
| P5 Master | FROZEN | policy principles, invariants, boundaries |
| P5-01 Audit | APPROVED | legacy rule-engine evidence, numeric thresholds, reuse matrix |
| P5-02 Semantic Contract | APPROVED | ActionCandidate/Decision, outcomes (AD-004), states (AD-009), identity (AD-013), snapshot ref (AD-014), parameters (AD-015), versioning (AD-017), idempotency boundary (AD-018), UNKNOWN representation (AD-019) |
| P4 contract (`src/lib/p4/types.ts` + specs) | FROZEN | input semantics (Direction, O/R/C/A, signals, degradation) |
| P4-06 docs | OPEN / DATA ACCRUAL | independence check |

---

## 3. P5-03 Scope

**Owned by P5-03 (semantic definition only):**
- eligibility; policy evaluation; selection; policy precedence;
  deterministic conflict resolution; cooldown; duplicate suppression;
  policy-level expiry; policy versioning; decision rationale; policy
  failure semantics; determinism; replayability; policy rule structure;
  LLM boundary; rule-engine reuse assessment.

**NOT owned by P5-03 (boundary references only):**
- safety/guardrails, approval, authority, automation, execution
  permission, execution, execution result → P5-04 and later.

**Boundary (from P5-02):** P4 → P5-02 Action Model → **P5-03 Policy** →
P5-04 Safety/Approval → P5-05 Explanation/Audit → P5-06 Read/API/UI →
P5-07 Replay → P5-08 Production.

---

## 4. Policy Boundary

**Definition (PD-001):** *"A versioned set of explicit deterministic rules
that evaluates whether an ActionCandidate is eligible and, where
applicable, which candidate/outcome is selected."*

- Policy is EXPLICIT, DETERMINISTIC, TRACEABLE, VERSIONED, AUDITABLE,
  REPLAYABLE, FAIL-SAFE (§5).
- Policy is NOT hidden, probabilistic-without-declared-semantics,
  LLM-decided, BUY/SELL-derived, score-driven-without-contract,
  safety-bypassing, or approval-bypassing.
- Policy produces policy outcomes; it never produces approval, safety, or
  execution determinations.

---

## 5. Policy Principles

1. **Explicit** — every behavior is a declared rule; no undocumented
   fallback or magic number (§11).
2. **Deterministic** — same inputs ⇒ same outcome (PD-010).
3. **Versioned** — every evaluation traces to policyId/version (PD-012).
4. **Auditable** — outcome + reason + refs are preserved (P5-05).
5. **Replayable** — reconstructable from exact refs without live P4 data
   (PD-011).
6. **Fail-safe** — technical failure is NOT_DETERMINED, never NO_ACTION
   (PD-009).
7. **Qualitative-first** — rules reference P4 qualitative states as
   declared inputs; numeric thresholds require explicit source/version
   (PD-014).
8. **Boundary-respecting** — policy never overrides safety, never grants
   approval or execution permission (§28-§32).

---

## 6. Policy Input Model

Inputs policy may legitimately consume (each with semantic owner,
provenance, version, deterministic interpretation):

| Input group | Fields | Semantic owner | Notes |
|---|---|---|---|
| A. P4 decision support | Direction, Opportunity, Risk, Confidence, Actionability, Signals, degradation | P4 (frozen) | consumed as declared semantic inputs; never recalculated |
| B. Evidence metadata | freshness, completeness, provenance, validity, snapshot identity | P4 refs (`p4SnapshotRef` AD-014) | from evidence refs + status |
| C. Action candidate | ActionType, parameters, subject, candidate identity | P5-02 | candidate contract (§8 of P5-02) |
| D. Context | cooldown history, duplicate history, previous decisions, policy version, temporal context | P5-03 (policy-owned) | declared context; part of determinism inputs |
| E. System state | capability availability, action support status | P5-06/later | declared; v1 treated as static/absent unless documented |

No new P4 metrics are invented. Anything not in this table is a CONTRACT
GAP to record, not a P4 modification.

---

## 7. Eligibility Model

Semantic distinctions (PD-002), never collapsed:

| Concept | Meaning |
|---|---|
| Candidate | "being considered" (P5-02 value object) |
| Eligible | policy determined the candidate may proceed (a result, not a state — P5-02 AD-010) |
| Selected | policy chose this candidate as the decision outcome SELECTED |
| Blocked | policy (or later P5-04 safety) determined it must not proceed; carries a blocker report (AD-011) |
| Not Determined | policy could not determine eligibility (degraded/failed input) — distinct from ineligible |

```
ActionCandidate
      ↓
Policy Evaluation
      ↓
Eligibility Result
      ↓
Selection
      ↓
ActionDecision
      ↓
P5-04 Safety / Approval
      ↓
Execution Permission
```

ELIGIBLE is NOT an execution permission. ELIGIBLE does NOT imply
EXECUTABLE (P5-04 may still reject).

---

## 8. Policy Evaluation

Policy evaluation is the deterministic application of the active policy
version's rules to the candidate + inputs (§6), producing:

- eligibility result (evaluated, eligible, policyVersionRef, reasonRef);
- selection (selected candidate ref, or none);
- policy outcome (SELECTED / NO_ACTION / BLOCKED / NOT_DETERMINED);
- policy reason (rule refs);
- policy version + evaluationAt.

Evaluation is staged by layers (§15): applicability → eligibility →
blocking → suppression → selection. Each stage's rules are explicit and
versioned. Evaluation never produces approval/safety/execution
determinations.

---

## 9. Policy Rule Structure

A conceptual policy rule (semantic fields; not every field is always
required — each is justified):

| Field | Semantic necessity |
|---|---|
| ruleId | stable identity (audit, versioning) |
| policyVersion | which policy version owns the rule |
| purpose | human-readable intent |
| scope | subject/action-type applicability |
| inputs | which §6 inputs it reads |
| condition | deterministic predicate over inputs |
| outcome | eligibility/selection/suppression effect |
| priority | explicit precedence within its layer (PD-004) |
| applicability | layer placement (§15) |
| reasonCode | machine reason for audit/explanation |
| effectiveAt / expiresAt | temporal validity (policy-level, PD-007) |
| owner | rule owner (P5-03) |
| status | FROZEN / PROVISIONAL / CANDIDATE per rule |

No runtime interfaces are created here.

---

## 10. Action Taxonomy Interaction

P5-02 v1 taxonomy is **PROVISIONAL** (AD-005/006/007):

- Advisory: MONITOR, REVIEW, INVESTIGATE
- Consequential: REDUCE_EXPOSURE, INCREASE_EXPOSURE, REBALANCE
- CANDIDATE: EXECUTE, ESCALATE
- NO_ACTION: DecisionOutcome, not an ActionType

P5-03 does NOT silently promote any of these to FROZEN.

**DEFERRED SEMANTIC DECISION (DSD-001):** final taxonomy membership is
confirmed only at P5-03 owner review (with P5-02 AD-005/006/007). Policy
rule examples in this document are illustrative (CANDIDATE) and do not
pre-judge membership.

**DEFERRED SEMANTIC DECISION (DSD-002):** ESCALATE's policy semantics
(escalation trigger/authority/recipient) remain OPEN — owned by P5-04/P5-06
per P5-02 AD-007.

---

## 11. Direction Boundary

- P5-03 may consume P4 Direction as one declared semantic input.
- **Direction is never a direct action mapping.** No rule of the form
  `Direction = POSITIVE → INCREASE_EXPOSURE` or `Direction = NEGATIVE →
  REDUCE_EXPOSURE` is defined or permitted as a policy shortcut (Master
  §8; P5-02 AD-008).
- If Direction participates in a rule, the rule must state its semantic
  role explicitly (e.g., "candidate remains eligible only while the P4
  snapshot Direction is not UNKNOWN" — illustrative, CANDIDATE).
- Direction never becomes an order instruction.

---

## 12. Opportunity / Risk / Confidence

- P4 O/R/C/A values are declared semantic inputs — consumed as-is.
- They are NEVER combined into composite action/risk/priority/confidence
  scores or weighted formulas (no `Opportunity × Confidence − Risk`).
- If a policy genuinely requires a numeric threshold, it must be explicitly
  sourced, versioned, and justified (PD-014) — none are invented here.

---

## 13. UNKNOWN / DEGRADED / NULL

Hard gate (PD-008, Master §15/§21, P5-02 AD-019):

- **NO mapping `UNKNOWN → NO_ACTION`, `DEGRADED → NO_ACTION`,
  `NULL → NO_ACTION` is permitted.**
- Policy **evaluates the condition** with explicit rules. Possible
  outcomes:
  - `NOT_DETERMINED` — eligibility could not be determined;
  - `BLOCKED` — consequential action blocked on degraded/stale/invalid
    context;
  - `REVIEW` / `INVESTIGATE` — degraded context routed to human review
    (where policy selects these types);
  - `ESCALATE` — per P5-04/P5-06 (CANDIDATE).
- Policy must distinguish **"no eligible action"** (evaluation completed,
  nothing eligible → NO_ACTION with policy ref) from **"policy could not
  determine eligibility"** (→ NOT_DETERMINED with degradation refs).
- Stale/invalid evidence: consequential candidates are ineligible/blocked;
  advisory review paths may remain eligible — exact rules are rule-level
  CANDIDATE/PROVISIONAL, not frozen defaults.

---

## 14. Policy Precedence

(PD-004) Conflicts between rules are resolved by **layered, explicit
precedence** — never "highest score wins":

Conceptual precedence (1 → 6):

1. **Applicability** — policy version / subject / time gate.
2. **Eligibility** — candidate preconditions (§22).
3. **Explicit blocking** — declared blocking rules; blocking beats
   selection.
4. **Explicit suppression** — cooldown / duplicate suppression (§16-§17);
   suppression beats selection.
5. **Explicit business precedence** — only if the policy defines a
   versioned business-precedence property between otherwise-equivalent
   rules. Not required for v1; if absent, skip this step.
6. **Deterministic final tie-break** — ruleId, used ONLY as a purely
   technical ordering key among rules otherwise equivalent at steps 1-5.

**ruleId is NOT business priority.** ruleId is used only as a deterministic
final tie-break among otherwise equivalent rules. It implies NO ordering
(R001 > R002 is false) and NO priority meaning (lower ruleId ≠ higher
business priority). If business priority is ever required, it must be an
explicit, versioned policy property (a declared rule attribute — not a
numeric score; P5-02 AD-024 applies). No numeric priority scores are
introduced.

**Safety outside precedence:** P5-03 precedence never reaches P5-04;
policy cannot override safety (PD-015, §28).

---

## 15. Policy Layers

Layered policy adopted (PD-004/PD-013) — responsibilities:

| Layer | Responsibility |
|---|---|
| 1. Applicability | is this policy (version) applicable to subject/type/time? |
| 2. Eligibility | required inputs present and usable; candidate preconditions (§22) |
| 3. Blocking | explicit blocking conditions (degraded context, unsupported type, parameter violation) → BLOCKED |
| 4. Suppression | cooldown (§16), duplicate suppression (§17) → no new decision |
| 5. Selection | among eligible non-suppressed candidates, deterministic selection per precedence → SELECTED |

Layers are conceptual; they avoid a monolithic engine. Safety/approval are
NOT policy layers (P5-04).

---

## 16. Cooldown

(PD-005) Policy-level cooldown: *prevent repeated decisions/actions of the
same class within a defined period.*

- Cooldown is explicit, versioned, auditable, subject-scoped where
  appropriate, action-scoped where appropriate.
- Cooldown applies at the **decision** level (suppresses new equivalent
  decisions), not execution level.
- **No default duration is invented.** Duration values are OPEN /
  PROVISIONAL, defined by P5-03 rule configuration with owner + rationale.

| Scope | Trigger | Duration | Status | Owner |
|---|---|---|---|---|
| subject × actionType | a decision of that class produced (SELECTED) | OPEN (not invented) | PROVISIONAL | P5-03 |
| subject | any consequential decision | OPEN | OPEN | P5-03 |

---

## 17. Duplicate Suppression

(PD-006) Duplicate suppression prevents a new policy decision when an
**equivalent active decision already exists**. Equivalence is explicit:

- **Equivalence scope (proposed, PROVISIONAL):** same subject + same
  actionType + same `p4SnapshotRef` (P5-02 AD-014) + same policyVersion +
  decisionState still active (DECIDED, not SUPERSEDED/EXPIRED/CANCELLED).
- Distinct concepts never conflated: same candidate / same decision /
  same action intent / same execution command (P5-02 identity model
  AD-013). Suppression applies to *decisions*, not execution idempotency
  (which stays in later tasks).
- The exact equivalence rule is a P5-03 rule-level decision (PROVISIONAL);
  the semantic requirement is FROZEN: no unbounded duplicate decision
  production without an explicit rule.

**Suppression outcome (PD-019):** suppression is a **P5-03 layer-level
result** (`suppressed: true` + suppression reason). A suppressed candidate
does NOT produce an ActionDecision (an existing active decision stands).
The aggregate evaluation outcome is recorded as **SUPPRESSED** at the
P5-03 layer — it is NOT a P5-02 decision outcome (P5-02 AD-004 vocabulary
SELECTED / NO_ACTION / BLOCKED / NOT_DETERMINED is preserved unchanged)
and it is NEVER silently recorded as NO_ACTION. P5-05 must be able to
distinguish SUPPRESSED from NO_ACTION in the audit trail.

| Equivalence Scope | Suppress? | Rationale | Status |
|---|---|---|---|
| same subject + type + snapshot + policy + active decision | yes (proposed) | avoid duplicate decisions | PROVISIONAL |
| same intent, different snapshot | no (new context → re-evaluate) | P4 context advanced | PROVISIONAL |
| same execution command | n/a (P5-03 does not own execution) | deferred | OPEN |

---

## 18. Expiry / Staleness

(PD-007) Policy-level expiry semantics — distinguished, never collapsed:

| Concept | Meaning | Owner |
|---|---|---|
| policy expiry | a policy version's validity window (effectiveAt/expiresAt) | P5-03 |
| candidate expiry | candidate considered stale before evaluation (context advanced) | P5-03 |
| decision expiry | DECIDED decision's validity horizon (P5-02 AD-022) | P5-03 (horizon value) / P5-05 (transition) |
| evidence staleness | P4 context stale relative to decision (P5-02 AD-022 STALE) | P5-03 (policy treats as blocking for consequential) |
| execution timeout | execution attempt timeout | later (execution scope) |

Policy-owned: candidate/decision/policy expiry + staleness treatment. The
EXPIRY horizon value is OPEN (not invented) — defined by P5-03 rules with
owner + rationale, validated at P5-07 replay.

---

## 19. Consequential Actions

- Policy identifies consequential action types via the P5-02 type-level
  `consequential` flag (AD-005).
- **CONSEQUENTIAL ≠ APPROVED ≠ EXECUTABLE ≠ SAFE** (PD-015).
- Policy may declare a consequential candidate ELIGIBLE; P5-04 still
  evaluates safety/approval/authority/automation/execution permission.
- Policy never bypasses P5-04 for consequential (or any) actions.

---

## 20. Advisory Actions

- MONITOR / REVIEW / INVESTIGATE are advisory types (P5-02 AD-005) —
  policy still determines their eligibility.
- Advisory is NOT "always safe" or "always executable"; policy applies the
  same explicit layers (with lower blocking strictness as rules define).
- No automatic execution semantics attach to advisory actions.

---

## 21. ESCALATE

- ESCALATE remains CANDIDATE (P5-02 AD-007).
- P5-03 analyzes only its policy interaction: an ESCALATE-type candidate
  would flow through the same eligibility/suppression layers; escalation
  authority, recipient, approval semantics, notification channel, and
  severity thresholds are NOT frozen here — they belong to P5-04/P5-06.

---

## 22. Parameter Validation

- P5-03 validates **presence/type of required parameters** (P5-02 AD-015,
  §14 parameter matrix): missing required parameter ⇒ INELIGIBLE / BLOCKED
  with reason.
- P5-03 does NOT define execution limits, position sizes, order
  quantities, portfolio limits, or financial risk limits — those belong to
  P5-04/future execution scope.

---

## 23. Versioning

(PD-012) Every evaluation traces to:

```
policyId · policyVersion · effectiveAt · evaluationAt
```

Distinguished dimensions (P5-02 AD-017):

| Version | Meaning | Source | Immutable? |
|---|---|---|---|
| policyId / policyVersion | P5-03 rule set identity | P5-03 | yes (per published version) |
| policy effectiveAt | when the version applies | P5-03 | yes |
| action-model version | P5-02 semantic version | P5-02 | yes |
| P4 contract version tuple | consumed, never changed | P4 | yes |
| algorithm version | P4 interpretation version | P4 | yes |

A decision under policy X never silently appears evaluated under Y.

---

## 24. Material Policy Change

- New policy version → new evaluations use it; old decisions remain
  traceable under their version.
- Existing DECIDED/approved actions must NOT silently mutate on policy
  change; a material policy change affecting an active decision is handled
  via P5-02 material-change semantics (AD-016: new decision + SUPERSEDED),
  with re-approval where required (P5-04).
- Semantic requirements only — no migration design.

---

## 25. Determinism

(PD-010) Same:

```
P4 snapshot ref (AD-014) + ActionCandidate + policyVersion + declared context
```

⇒ same policy outcome.

Declared inputs that may legitimately change the outcome: cooldown/
duplicate history state (a declared temporal/contextual input), policy
version, temporal context (as-of time where rules reference it). All
variable inputs are part of the recorded evaluation inputs for replay.

---

## 26. Replayability

(PD-011) A historical evaluation is reconstructable from:

- exact P4 reference (`p4SnapshotRef` incl. contentHash — AD-014);
- evidence snapshot reference;
- candidate (id + version + parameters);
- policy version + rule versions;
- declared context (cooldown/duplicate state at evaluation time);
- rule statuses at that version.

Replay never requires current live P4 data to reproduce a historical
decision (mirrors P4-06 harness principle; P5-07 executes this).

---

## 27. Failure Semantics

(PD-009) Policy-engine failure states — preserved for P5-05 audit, never
collapsed:

| Failure/condition | Policy outcome | Notes |
|---|---|---|
| policy evaluation technical failure (engine error, missing rule set) | NOT_DETERMINED + failure reason | never NO_ACTION |
| candidate blocked by policy | BLOCKED + blocker report | distinct |
| evaluation completed, nothing eligible | NO_ACTION + policy ref | "no eligible action" |
| inputs unusable (degraded/null) | NOT_DETERMINED (or REVIEW/INVESTIGATE per rules) | never NO_ACTION |
| system unavailable (input layer down) | NOT_DETERMINED + availability reason | preserved |

Retry of policy evaluation is a P5-03-IMPL decision (deterministic
re-evaluation is safe); execution retry is out of scope.

---

## 28. Policy vs Safety

**Hard invariant (PD-015): policy cannot override safety.**

```
Candidate → Policy → Eligible → Safety → Approved → Executable
```

If policy says ELIGIBLE, P5-04 may still say BLOCKED. Safety-related
conditions are classified for P5-04, not encoded inside policy for
convenience.

**BLOCKED provenance (PD-018, FROZEN):** three distinct semantic outcomes,
each with distinguishable provenance — never conflated:

| Outcome | Meaning | Emitted by | Provenance |
|---|---|---|---|
| POLICY-BLOCKED | policy layer determined a candidate cannot be selected under the applicable policy | P5-03 | decisionOutcome = BLOCKED + blockerReport.source = POLICY + rule refs |
| SAFETY-BLOCKED | safety/guardrail layer rejected an otherwise eligible/selected action because safety constraints are not satisfied | P5-04 | downstream safety evaluation result + guardrail version refs |
| APPROVAL-DENIED | the required authority/approval was not granted | P5-04 | approval record (actor, time, decision ref) |

At the P5-03 policy layer the outcome is **BLOCKED with
blockerReport.source = POLICY**; SAFETY-BLOCKED and APPROVAL-DENIED are
P5-04-layer results that follow a DECIDED action downstream — they do NOT
replace the P5-02 decision outcome vocabulary (AD-004 preserved). Any
generic BLOCKED reference always carries a blocker classification
(POLICY / SAFETY / APPROVAL).

---

## 29. Policy vs Approval

- Policy may determine "this action is eligible/selected." It NEVER
  determines "approved."
- `eligible ≠ approved`; `policy priority ≠ approval authority`.
- Approval belongs to P5-04 (P5-02 AD-020 boundary).

---

## 30. Policy vs Automation

- Policy may select a candidate. It never decides whether the system may
  execute autonomously.
- Automation authority is P5-04 (ADVISORY-only v1 default, Master §17).
- `policy outcome ≠ automation mode ≠ approval state ≠ execution state`.

---

## 31. LLM Boundary

**Audit result (verified):** the repository has NO LLM in any decision
path. P4 interpretation and explanation are explicitly template-based —
`src/lib/p4/interpretation.ts:21` ("no LLM, no ML, no hidden heuristic"),
`src/lib/p4/explanation/templates.ts:8` ("No LLM, no hidden inference...").
No authoritative LLM action selection exists → no CONFLICT to record.

**Policy (PD-016, FROZEN):** LLM MUST NOT be the authoritative policy
engine. If an LLM is ever used as an input (explanation/summarization/
investigation assistance), its output is a non-authoritative input with
defined provenance; the final policy result remains deterministic and
auditable. No LLM-based eligibility/priority/approval/safety/execution
decision is permitted.

---

## 32. Existing Rule Engine Reuse

P5-01 findings (§8, §17): `RuleEngineService` (`src/lib/services/
rule-engine.service.ts:10-60`) — priority-ordered, AND/OR conditions,
first-match, versioned via `ruleVersions` (schema `src/db/schema.ts:265`).
Legacy numeric fields: `health|trend|derivative|volume|momentum|
confidence` with numeric values (`src/lib/types/recommendation-rule.ts:14`).

Assessment (PD-017):

- **Rule-engine mechanism (priority ordering, AND/OR condition
  evaluation, versioned rule sets): reuse potential MEDIUM** — the
  deterministic evaluation pattern is conceptually compatible with the P5
  layered policy model (§15).
- **Legacy rule definitions/thresholds (numeric conditions): reuse
  potential NONE** — P5 policy rules reference qualitative P4 states
  (PD-014); legacy semantics are not imported.

Mechanism and definitions are strictly separated. No implementation here.

---

## 33. Policy Decision Records

### PD-001 — Policy Evaluation Contract
Status: **FROZEN**
Decision: Policy = versioned set of explicit deterministic rules
evaluating an ActionCandidate against §6 inputs, producing eligibility
result + selection + policy outcome (SELECTED / NO_ACTION / BLOCKED /
NOT_DETERMINED) + reason + version refs.
Rationale: Master §14 (deterministic, versioned, reproducible); P5-02
AD-004 outcome vocabulary.
Alternatives: (a) policy as free-form guidance — rejected (non-deterministic);
(b) policy producing only SELECTED/NO_ACTION — rejected (loses BLOCKED/
NOT_DETERMINED).
Affected Action Types: all.
Inputs: §6. Outputs: §7-§8. Downstream: P5-04, P5-05, P5-07.
Evidence: Master §14; P5-02 AD-004.

### PD-002 — Eligibility Semantics
Status: **FROZEN**
Decision: ELIGIBLE is a policy evaluation result, not a state dimension
and never an execution permission. Candidate ≠ Eligible ≠ Selected ≠
Blocked ≠ Not Determined.
Rationale: P5-02 AD-010; Master §13.
Alternatives: eligibility as state — rejected (P5-02 AD-010).
Affected Action Types: all. Inputs: candidate + policy. Outputs:
eligibility result. Downstream: P5-03 selection; P5-04.
Evidence: P5-02 AD-010; Master §13.

### PD-003 — Selection Semantics
Status: **FROZEN**
Decision: Selection chooses among eligible, non-suppressed candidates
deterministically by declared precedence (PD-004). NO_ACTION is the
outcome of a **completed** evaluation with no selected candidate — it is
never a shortcut or failure. Suppressed candidates (PD-019) do not reach
selection and never collapse into NO_ACTION.
Rationale: §7/§8; P5-02 AD-004; open question 12 resolved: NO_ACTION is
produced by the decision after all candidates are processed, and also
represents the explicit "nothing eligible" case with policy ref.
Alternatives: NO_ACTION produced eagerly on first non-match — rejected
(no eligible ≠ not determined). (See Appendix D.)
Affected Action Types: all. Inputs: eligibility results. Outputs:
SELECTED / NO_ACTION.
Downstream: P5-04.
Evidence: P5-02 AD-003/AD-004.

### PD-004 — Policy Precedence
Status: **FROZEN**
Decision: Six-step precedence (§14): applicability → eligibility →
explicit blocking → explicit suppression → explicit business precedence
(only if versioned, else skipped) → deterministic final tie-break by
ruleId. **ruleId is a purely technical tie-break key, NEVER business
priority** (no R001 > R002, no lower-ruleId = higher-priority meaning, no
numeric priority scores). Blocking and suppression beat selection; safety
outside precedence.
Rationale: Master §14 (deterministic conflict resolution); no "highest
score wins" (no scores).
Alternatives: specificity-only precedence — rejected (ambiguity);
score-based precedence — rejected (hidden score).
Affected Action Types: all. Inputs: rules. Outputs: deterministic order.
Downstream: P5-03 selection; P5-07 replay.
Evidence: Master §14; P5-02 AD-024.

### PD-005 — Cooldown
Status: **PROVISIONAL**
Decision: Policy-level cooldown suppresses new equivalent decisions within
a defined period; explicit/versioned/auditable/subject+action-scoped; no
default durations invented (OPEN).
Rationale: Master §32 roadmap (cooldown in P5-03); prevent repeated
decisions.
Alternatives: no cooldown — rejected (duplicate churn); execution-level
cooldown — out of P5-03 scope.
Affected Action Types: all. Inputs: decision history. Outputs:
suppression. Downstream: P5-05 audit.
Evidence: Master §32.

### PD-006 — Duplicate Suppression
Status: **PROVISIONAL**
Decision: Suppress a new policy decision when an equivalent ACTIVE
decision exists; equivalence = subject + actionType + p4SnapshotRef +
policyVersion + active decisionState (§17). Suppressed candidates produce
a layer-level SUPPRESSED result (PD-019), not a decision, and never
NO_ACTION. Execution idempotency is out of scope.
Rationale: Master §32 (duplicate suppression); P5-02 AD-013/AD-018
identity semantics.
Alternatives: suppress by intent only — rejected (too coarse); no
suppression — rejected.
Affected Action Types: all. Inputs: decision history. Outputs:
suppression. Downstream: P5-05.
Evidence: P5-02 AD-013/AD-018.

### PD-007 — Policy Expiry
Status: **PROVISIONAL**
Decision: policy-owned expiry semantics for candidate/decision/policy
versions; horizon values OPEN (not invented); staleness of evidence blocks
consequential candidates; distinct from execution timeout.
Rationale: §18; P5-02 AD-022.
Alternatives: no expiry — rejected (stale decisions); collapsing expiry
types — rejected.
Affected Action Types: consequential especially. Inputs: context age.
Outputs: EXPIRED transition / blocking.
Downstream: P5-05; P5-07 validation.
Evidence: P5-02 AD-022.

### PD-008 — UNKNOWN / DEGRADED
Status: **FROZEN**
Decision: No UNKNOWN/DEGRADED/NULL → NO_ACTION mapping. Policy evaluates
the condition; outcomes include NOT_DETERMINED / BLOCKED / REVIEW /
INVESTIGATE / ESCALATE (per rules). "No eligible action" ≠ "could not
determine."
Rationale: Master §15/§21; P5-02 AD-019.
Alternatives: map UNKNOWN → NO_ACTION — rejected (hard gate).
Affected Action Types: all. Inputs: P4 status/degradation. Outputs:
NOT_DETERMINED / BLOCKED / REVIEW / INVESTIGATE.
Downstream: P5-04, P5-05.
Evidence: Master §15/§21; P5-02 AD-019.

### PD-009 — Policy Failure
Status: **FROZEN**
Decision: technical failure ⇒ NOT_DETERMINED with failure reason; never
NO_ACTION. Failure/block/no-eligible/not-determined/system-unavailable are
distinct (§27).
Rationale: Master §23 (decision failure ≠ execution failure); audit
integrity.
Alternatives: failure → NO_ACTION — rejected (silent).
Affected Action Types: all. Inputs: engine/input availability. Outputs:
NOT_DETERMINED. Downstream: P5-05 audit.
Evidence: Master §23; P5-02 AD-009.

### PD-010 — Determinism
Status: **FROZEN**
Decision: same (p4SnapshotRef + candidate + policyVersion + declared
context) ⇒ same outcome; declared variable inputs listed (§25).
Rationale: Master §14; replay/audit/debug (P5-07).
Alternatives: non-deterministic evaluation — rejected.
Affected Action Types: all. Inputs: §6. Outputs: reproducible outcome.
Downstream: P5-07.
Evidence: Master §14; P5-02 AD-018.

### PD-011 — Replayability
Status: **FROZEN**
Decision: historical evaluations reconstructable from exact refs without
live P4 data (§26).
Rationale: Master §28; P4-06 harness precedent (do not require live data).
Alternatives: live re-derivation — rejected (drift).
Affected Action Types: all. Inputs: persisted refs. Outputs: replay
records. Downstream: P5-07.
Evidence: Master §28; P5-02 AD-014.

### PD-012 — Versioning
Status: **FROZEN**
Decision: policyId/policyVersion/effectiveAt/evaluationAt per evaluation;
separate from action-model/P4/algorithm versions; no silent
re-attribution.
Rationale: Master §25; P5-02 AD-017.
Alternatives: single version — rejected.
Affected Action Types: all. Inputs: versions. Outputs: traceable
evaluation. Downstream: P5-05.
Evidence: Master §25; P5-02 AD-017.

### PD-013 — Layered Policy
Status: **PROVISIONAL**
Decision: five conceptual layers (§15) — applicability, eligibility,
blocking, suppression, selection; avoids a monolithic engine.
Rationale: Master §32 (deterministic action engine); §15 of this doc.
Alternatives: monolithic rule set — rejected (precedence ambiguity).
Affected Action Types: all. Inputs: rules. Outputs: staged evaluation.
Downstream: P5-03-IMPL.
Evidence: Master §32.

### PD-014 — No Invented Thresholds / No BUY-SELL
Status: **FROZEN**
Decision: no numeric thresholds invented; legacy values (90/80/65 —
`src/lib/features/engine.ts:158`; 25/15/8 — `src/lib/services/
decision-engine.service.ts:14-31`) recorded LEGACY and NOT reused; any
future threshold requires source/owner/rationale/version/validation.
Direction never maps to action types.
Rationale: Master §8.5/§31; P5-01 §15; P5-02 AD-008/AD-024.
Alternatives: reuse legacy thresholds — rejected.
Affected Action Types: all. Inputs: qualitative states only. Outputs:
rule conditions. Downstream: P5-03-IMPL, P5-07.
Evidence: P5-01 §15; P5-02 AD-008/AD-024.

### PD-015 — Consequential ≠ Approval ≠ Executable ≠ Safe
Status: **FROZEN**
Decision: policy may select consequential candidates; safety/approval/
automation/execution permission remain with P5-04; policy never bypasses
P5-04; ELIGIBLE does not mean EXECUTABLE.
Rationale: Master §9/§16/§17/§21; P5-02 AD-005.
Alternatives: policy granting approval — rejected (boundary).
Affected Action Types: consequential set. Inputs: eligibility. Outputs:
handoff to P5-04. Downstream: P5-04.
Evidence: Master §21; P5-02 AD-005/AD-020.

### PD-016 — LLM Boundary
Status: **FROZEN**
Decision: LLM is never the authoritative policy engine; LLM-as-input is
non-authoritative with provenance; final policy result deterministic.
Rationale: Master §8.2/§20; P5-03 §31 audit (no LLM in repo decision
paths).
Alternatives: LLM policy — rejected.
Affected Action Types: all. Inputs: none (policy). Outputs: n/a.
Downstream: all.
Evidence: `src/lib/p4/interpretation.ts:21`; `templates.ts:8`.

### PD-017 — Rule-Engine Reuse
Status: **PROVISIONAL**
Decision: reuse the deterministic rule-engine MECHANISM (priority,
AND/OR, versioned sets) as MEDIUM-potential precedent; reuse legacy rule
DEFINITIONS/thresholds as NONE. Mechanism ≠ semantics.
Rationale: §32; P5-01 §8/§17.
Alternatives: full reuse — rejected (numeric semantics); greenfield
without precedent — rejected (loses proven pattern).
Affected Action Types: all. Inputs: n/a. Outputs: P5-03-IMPL guidance.
Downstream: P5-03-IMPL.
Evidence: `src/lib/services/rule-engine.service.ts:10-60`;
`src/lib/types/recommendation-rule.ts:14`.

### PD-018 — BLOCKED Provenance Classification
Status: **FROZEN**
Decision: POLICY-BLOCKED (P5-03, blockerReport.source = POLICY),
SAFETY-BLOCKED (P5-04), and APPROVAL-DENIED (P5-04) are distinct semantic
outcomes with distinguishable provenance (§28). P5-02 AD-004 decision
outcome vocabulary is preserved; downstream block results never replace
it.
Rationale: three-way distinction must be readable without context (freeze
question Q1); audit integrity.
Alternatives: a single generic BLOCKED — rejected (indistinguishable
provenance).
Affected Action Types: all. Inputs: policy/safety/approval results.
Outputs: classified blockers. Downstream: P5-05 audit.
Evidence: P5-02 AD-004/AD-011; this doc §28.

### PD-019 — Suppression Outcome
Status: **PROVISIONAL**
Decision: suppression is a P5-03 layer-level result (SUPPRESSED + reason);
a suppressed candidate produces no decision; SUPPRESSED is never silently
recorded as NO_ACTION. SUPPRESSED is NOT added to the P5-02 decision
outcome vocabulary.
Rationale: freeze question Q2; preserves P5-02 AD-004 while making
suppression auditable and distinct.
Alternatives: (a) suppression → NO_ACTION — rejected (silent conflation);
(b) SUPPRESSED as a P5-02 decision outcome — deferred (would require a
P5-02 amendment, outside P5-03 authority).
Affected Action Types: all. Inputs: cooldown/dedup state. Outputs:
SUPPRESSED layer result. Downstream: P5-05.
Evidence: P5-02 AD-004; this doc §17.

---

## 34. Policy Matrices

### 34.1 Policy Input Matrix

| Input | Source | Semantic Meaning | Allowed Use | Owner |
|---|---|---|---|---|
| Direction | P4 ViewModel | declared state | eligibility conditions; never direct mapping | P4 |
| Opportunity / Risk / Confidence / Actionability | P4 ViewModel | declared qualitative values | rule conditions as-is; never scores | P4 |
| Signals | P4 ViewModel | fired signals | context conditions | P4 |
| Degradation state/codes | P4 ViewModel | input quality | blocking/not-determined/redirect | P4 |
| Evidence freshness/validity | P4 refs (AD-014) | evidence quality | staleness handling | P4/P5-03 |
| ActionType | P5-02 candidate | intent class | rule scope/applicability | P5-02 |
| Parameters | P5-02 candidate | typed concepts | presence validation only | P5-02 |
| Subject/identity | P5-02 candidate | entity scope | scoping, cooldown, dedup | P5-02 |
| Cooldown/dedup history | P5-03 | declared context | suppression layers | P5-03 |
| Policy version | P5-03 | rule identity | traceability, determinism | P5-03 |

### 34.2 Eligibility Matrix (illustrative — no invented thresholds)

| Action Type | Candidate Condition | Eligibility Result | Status | Notes |
|---|---|---|---|---|
| MONITOR | P4 snapshot present; Direction not UNKNOWN | eligible (proposed) | CANDIDATE | rule example only |
| REVIEW | P4 snapshot present | eligible (proposed) | CANDIDATE | degraded context may route here |
| INVESTIGATE | target ref resolves (signal/degradation) | eligible (proposed) | CANDIDATE | |
| REDUCE_EXPOSURE | snapshot usable (not DEGRADED/NULL); parameters complete; no active equivalent decision | eligible (proposed) | CANDIDATE | consequential; safety/approval at P5-04 |
| INCREASE_EXPOSURE | same as above | eligible (proposed) | CANDIDATE | |
| REBALANCE | same as above + subject set valid | eligible (proposed) | CANDIDATE | |
| (EXECUTE/ESCALATE) | n/a — not v1 types | — | CANDIDATE/OPEN | AD-006/AD-007 |

### 34.3 Policy Outcome Matrix

| Condition Class | Outcome | Meaning | Downstream |
|---|---|---|---|
| evaluation completed, candidate selected | SELECTED | decision produced with selectedActionRef | P5-04 |
| evaluation completed, nothing eligible | NO_ACTION | explicit no-action with policy ref | P5-05 |
| blocking rule fired | BLOCKED (POLICY-BLOCKED) | blockerReport.source = POLICY + rule refs | P5-05 |
| degraded/unusable inputs | NOT_DETERMINED (or REVIEW/INVESTIGATE per rules) | could not determine | P5-05 |
| technical failure | NOT_DETERMINED + failure reason | policy failure preserved | P5-05 |
| suppression (cooldown/dedup) | SUPPRESSED (layer result) — no new decision; existing decision stands | suppressed + reason; never NO_ACTION | P5-05 |

### 34.4 Policy Precedence Matrix

| Rule Class | Priority (layer order) | Override Allowed? | Notes |
|---|---|---|---|
| Applicability | 1 | no | version/subject/time gate |
| Eligibility | 2 | no (blocking rules override within result) | preconditions |
| Blocking | 3 | blocking beats selection | explicit conditions only |
| Suppression | 4 | suppression beats selection | cooldown/dedup |
| Selection | 5 | no override of blocking/suppression | deterministic choice |
| Safety (P5-04) | outside policy | overrides policy eligibility | never encoded in policy |

### 34.5 Cooldown Matrix

| Scope | Trigger | Duration | Status | Owner |
|---|---|---|---|---|
| subject × actionType | SELECTED decision of that class | OPEN | PROVISIONAL | P5-03 |
| subject | any consequential SELECTED | OPEN | OPEN | P5-03 |
| approval-denied | re-request same class | OPEN | OPEN | P5-03/P5-04 |

### 34.6 Duplicate Suppression Matrix

| Equivalence Scope | Suppress? | Rationale | Status |
|---|---|---|---|
| subject + type + snapshot + policy + active decision | yes (proposed) | avoid duplicate decisions | PROVISIONAL |
| same intent, new snapshot | no | new context → re-evaluate | PROVISIONAL |
| same execution command | n/a | execution idempotency deferred | OPEN |

### 34.7 Failure Matrix

| Failure | Outcome | Retry? | Owner |
|---|---|---|---|
| engine error / missing rule set | NOT_DETERMINED | safe (deterministic) — P5-03-IMPL decides | P5-03 |
| unusable inputs | NOT_DETERMINED | no (condition persists) | P5-03 |
| blocked | BLOCKED | no (block persists until context changes) | P5-03 |
| no eligible | NO_ACTION | no | P5-03 |
| execution failure | n/a | n/a — execution out of scope | later |

### 34.8 Version Matrix

| Version | Meaning | Source | Immutable? |
|---|---|---|---|
| policyId/version | P5-03 rule set | P5-03 | yes per published version |
| effectiveAt | applicability start | P5-03 | yes |
| action-model version | P5-02 semantics | P5-02 | yes |
| P4 version tuple | consumed input | P4 | yes |
| evaluationAt | evaluation timestamp | P5-03 | yes |

---

## 35. Conceptual Policy Flow

```
ActionCandidate                       [P5-02 input]
      ↓
1. Applicability                      [P5-03]
      ↓
2. Input Validation                   [P5-03 — §22 parameter presence]
      ↓
3. Policy Evaluation                  [P5-03 — §8]
      ↓
4. Eligibility                        [P5-03 — §7, result not state]
      ↓
5. Conflict / Precedence              [P5-03 — §14, layered]
      ↓
6. Cooldown / Duplicate Suppression   [P5-03 — §16/§17]
      ↓
7. Selection                          [P5-03 — §8, PD-003]
      ↓
ActionDecision                        [P5-02 record; P5-03 fills policy fields]
      ↓
P5-04 Safety / Approval               [DOWNSTREAM — may reject]
```

Everything above the ActionDecision line is **P5-03 OWNED**. Below is
DOWNSTREAM.

---

## 36. Frozen Policy Invariants

Only the invariants required by the Master are frozen:

1. Policy is explicit.
2. Policy is deterministic.
3. Policy is versioned.
4. Policy is auditable.
5. Policy is replayable.
6. Policy cannot override Safety.
7. Policy cannot grant Approval.
8. Policy cannot grant Execution Permission.
9. Policy cannot derive BUY/SELL directly from Direction.
10. Policy cannot silently convert UNKNOWN/DEGRADED into NO_ACTION.
11. Policy cannot use hidden scores.
12. Policy cannot reinterpret P4.

No additional invariants are invented.

---

## 37. Open Semantic Questions

| # | Question | P5-03 evaluation | Status |
|---|---|---|---|
| 1 | Exact eligibility semantics per v1 action | illustrated §34.2; rule-level | OPEN (P5-03-IMPL rules) |
| 2 | Final taxonomy membership | DSD-001 — deferred to owner review | OPEN |
| 3 | Is consequential classification sufficient? | yes as type-level flag (AD-005); instance-level refinement possible at P5-04 | PROVISIONAL |
| 4 | Exact policy precedence model | layered, explicit priority (PD-004) | DECIDED (structure) |
| 5 | Cooldown scope and duration | scope proposed; duration OPEN | OPEN (duration) |
| 6 | Duplicate equivalence definition | proposed (§17); confirm at P5-03-IMPL | PROVISIONAL |
| 7 | Policy expiry | semantics defined (PD-007); horizon OPEN | PROVISIONAL |
| 8 | Temporal context | declared input (§25); rules may reference as-of time | PROVISIONAL |
| 9 | Stale evidence treatment | consequential blocked; advisory may route REVIEW (PD-008) | PROVISIONAL |
| 10 | Conflicting P4 inputs | P4 EVIDENCE_CONFLICT is a declared signal; rule-level handling CANDIDATE | OPEN |
| 11 | Missing candidate parameters | INELIGIBLE/BLOCKED (§22) | DECIDED |
| 12 | NO_ACTION produced by policy or after all rejected? | produced by decision after completed evaluation (PD-003) | DECIDED |
| 13 | BLOCKED produced by policy or P5-04? | both — policy-block and safety-block with distinct reports (§28) | DECIDED |
| 14 | Policy-block vs safety-block boundary | policy = rule-based eligibility/blocking on inputs; safety = P5-04 evaluation | DECIDED (boundary) |

---

## 38. P5-04 Handoff

**P5-03 produces:** policy evaluation, eligibility result, selection,
policy outcome, policy reason, policy version, policy provenance.

**P5-04 consumes these and decides:** safety, guardrails, approval,
authority, automation, execution permission.

- P5-04 may reject a P5-03 ELIGIBLE action (safety-block, approval denial).
- **ELIGIBLE ≠ APPROVED ≠ SAFE ≠ EXECUTABLE** (final invariant). P5-04
  may reject an ELIGIBLE action (SAFETY-BLOCKED or APPROVAL-DENIED).
- Policy-blocks (P5-03) and safety-blocks (P5-04) are distinct BLOCKED
  outcomes with separate blocker reports (P5-02 AD-011).

---

## 39. Acceptance Criteria

P5-03 exit criteria — all met:

- [x] Policy semantic boundary defined (§3-§4)
- [x] Eligibility semantics defined (§7, PD-002)
- [x] Policy evaluation defined (§8)
- [x] Selection semantics defined (§8, PD-003)
- [x] Policy precedence defined (§14, PD-004)
- [x] Cooldown semantics addressed (§16, PD-005)
- [x] Duplicate suppression addressed (§17, PD-006)
- [x] Policy expiry addressed (§18, PD-007)
- [x] UNKNOWN/DEGRADED handled explicitly (§13, PD-008)
- [x] Failure semantics defined (§27, PD-009)
- [x] Determinism defined (§25, PD-010)
- [x] Replayability defined (§26, PD-011)
- [x] Versioning defined (§23, PD-012)
- [x] Policy/Safety boundary defined (§28, PD-015)
- [x] Policy/Approval boundary defined (§29)
- [x] Policy/Automation boundary defined (§30)
- [x] LLM boundary defined (§31, PD-016)
- [x] Existing rule engine audited for reuse (§32, PD-017)
- [x] No hidden score (§12, PD-014)
- [x] No invented threshold (§12, PD-014)
- [x] No BUY/SELL engine (§11, PD-014)
- [x] No P4 modification
- [x] No P4-06 modification
- [x] No production implementation
- [x] Policy decision records included (§33)
- [x] Required matrices included (§34)
- [x] P5-04 handoff defined (§38)
- [x] Ten gates PASS (§43 of task brief — see Verification record)
- [x] Exactly one document created
- [x] Freeze matrix recorded (§40)
- [x] Final semantic matrix recorded (§41)
- [x] Twelve-gate freeze audit PASS (§42)
- [x] P5-03 marked FROZEN / APPROVED FOR DOWNSTREAM

---

## 40. Freeze Matrix (P5-03 R2)

| Area | Status |
|---|---|
| Policy contract | FROZEN |
| Eligibility semantics | FROZEN |
| Selection semantics | FROZEN |
| Policy precedence | FROZEN |
| Policy blocking (POLICY-BLOCKED) | FROZEN |
| Suppression | PROVISIONAL (outcome SUPPRESSED defined; equivalence rule pending) |
| Cooldown duration | OPEN |
| Duplicate equivalence | PROVISIONAL |
| Expiry horizon | OPEN |
| UNKNOWN/DEGRADED | FROZEN |
| Failure semantics | FROZEN |
| Determinism | FROZEN |
| Replayability | FROZEN |
| Versioning | FROZEN |
| Safety boundary (SAFETY-BLOCKED) | FROZEN (boundary; rules P5-04) |
| Approval boundary (APPROVAL-DENIED) | FROZEN (boundary; rules P5-04) |
| Execution boundary | FROZEN (boundary; no execution in v1) |
| Taxonomy membership | PROVISIONAL (P5-02 AD-005; owner review) |
| ESCALATE semantics | DEFERRED (P5-04/P5-06) |
| Implementation architecture | OUT OF SCOPE |

## 41. Final Semantic Matrix (P5-03 R2)

| Situation | Semantic Meaning | Outcome | Owner |
|---|---|---|---|
| Evaluation complete, no candidate selected | No action warranted/selected | NO_ACTION | P5-03 |
| Candidate blocked by policy | Policy prevents selection | POLICY-BLOCKED (BLOCKED, source = POLICY) | P5-03 |
| Evaluation cannot determine | Insufficient/unusable result | NOT_DETERMINED | P5-03 |
| Candidate suppressed (cooldown/duplicate) | Explicit suppression rule applies | SUPPRESSED (layer result; no decision) | P5-03 |
| Candidate selected | Eligible candidate chosen | SELECTED | P5-03 |
| Safety rejects selected/eligible action | Safety constraint fails | SAFETY-BLOCKED | P5-04 |
| Required approval denied | Authority does not approve | APPROVAL-DENIED | P5-04 |

SUPPRESSED is a P5-03 layer-level result (PD-019), not a P5-02 decision
outcome; SAFETY-BLOCKED and APPROVAL-DENIED are P5-04 layer results
(PD-018). The P5-02 decision outcome vocabulary (AD-004) is unchanged.

## 42. Freeze Verification — 12-Gate Audit (P5-03 R2)

| Gate | Result | Evidence |
|---|---|---|
| 1. P4 → P5 boundary | PASS | §6/§12/PD-014: P4 consumed as declared inputs; no DirectionScore/OpportunityScore/ActionScore |
| 2. P5-02 semantic compatibility | PASS | outcomes AD-004, eligibility AD-010, blocker AD-011, taxonomy AD-005, EXECUTE AD-006, BUY/SELL AD-008, orthogonal states AD-009, UNKNOWN AD-019, no score AD-024 — all preserved |
| 3. NO_ACTION distinction | PASS | PD-003/PD-008/PD-009: NO_ACTION only after completed evaluation; ≠ NOT_DETERMINED ≠ BLOCKED ≠ SUPPRESSED |
| 4. BLOCKED provenance | PASS | PD-018/§28: POLICY-BLOCKED vs SAFETY-BLOCKED vs APPROVAL-DENIED with distinct provenance |
| 5. SUPPRESSION distinction | PASS | PD-019/§17/§41: SUPPRESSED layer result, never NO_ACTION, no decision produced |
| 6. UNKNOWN/DEGRADED/failure | PASS | §13/§27/PD-008/PD-009: no UNKNOWN/DEGRADED/NULL/FAILURE → NO_ACTION mapping |
| 7. BUY/SELL boundary | PASS | §11/PD-014: Direction never a direct mapping; no BUY/SELL/LONG/SHORT/ORDER/TRADE semantics introduced |
| 8. Hidden score / threshold | PASS | §12/PD-014: no scores; legacy 90/80/65 and 25/15/8 remain LEGACY, not reused |
| 9. ruleId vs business priority | PASS | §14/PD-004: ruleId = technical tie-break only; no R001 > R002; business precedence requires explicit versioned property |
| 10. P5-04 safety/approval/execution boundary | PASS | §28-§30/PD-015: policy cannot override safety, grant approval, or grant execution permission |
| 11. P4-06 independence | PASS | §2: no dependency, no promotion, P4-06 OPEN / DATA ACCRUAL unchanged |
| 12. Implementation discipline | PASS | §44/verification: only this document changed; no src/P3/P4/API/UI/DB/migrations |

## 43. Final Revision Record (P5-03 R2)

Changes applied at the P5-03 freeze check (document-only):

1. Status corrected: **READY FOR P5-04** → **FROZEN / APPROVED FOR
   DOWNSTREAM** (pending owner confirmation).
2. BLOCKED provenance resolved (PD-018): POLICY-BLOCKED / SAFETY-BLOCKED /
   APPROVAL-DENIED are distinct outcomes with distinct provenance; §28 +
   §34.3 + §41 updated; P5-02 AD-004 preserved.
3. Suppression outcome resolved (PD-019): SUPPRESSED layer result, never
   NO_ACTION, no decision produced; §17 + §34.3 + §41 updated.
4. ruleId semantics resolved (§14, PD-004): technical tie-break ONLY;
   explicit six-step precedence; business priority, if needed, is an
   explicit versioned property — never a score.
5. Freeze matrix (§40), final semantic matrix (§41), and 12-gate freeze
   audit (§42) added; §38 handoff invariant updated to
   ELIGIBLE ≠ APPROVED ≠ SAFE ≠ EXECUTABLE.
6. No production code; no P3/P4/P4-06/API/UI/DB/migration changes.

---

## Appendix A — Repository Evidence

- `src/lib/p4/types.ts:280` — ViewModel input (Direction, O/R/C/A, signals, degradation)
- `src/lib/p4/interpretation.ts:21` — "no LLM, no ML, no hidden heuristic"
- `src/lib/p4/explanation/templates.ts:8` — "No LLM, no hidden inference"; `:243-253` BANNED_PHRASES
- `src/lib/features/engine.ts:158` — legacy thresholds 90/80/65 (LEGACY)
- `src/lib/services/decision-engine.service.ts:14-31` — legacy penalties 25/15/8 (LEGACY)
- `src/lib/services/rule-engine.service.ts:10-60` — priority/AND-OR/first-match (mechanism precedent)
- `src/lib/types/recommendation-rule.ts:14` — numeric condition fields (legacy definitions)
- `src/db/schema.ts:265` — ruleVersions (versioning precedent)
- P5-01 §8/§15/§17 — policy/rule audit, hidden-score audit, reuse matrix
- P5-02 AD-004/008/009/010/013/014/015/017/018/019/020/022/024 — contract references

## Appendix B — P5-01 Findings Consumed

- Rule engine + versioning: EXISTS (legacy) → mechanism reuse MEDIUM, semantics NONE (PD-017)
- Numeric thresholds 90/80/65 and 25/15/8: LEGACY → not reused (PD-014)
- Approval/automation MISSING → policy never grants (PD-015, §29-§30)
- No BUY/SELL found → invariant preserved (PD-014)
- P4-06 no dependency → §2 independence

## Appendix C — P5-02 Contract References

- Outcome vocabulary SELECTED/NO_ACTION/BLOCKED/NOT_DETERMINED (AD-004)
- ELIGIBLE = result, not state (AD-010); BLOCKED = outcome + blocker report (AD-011)
- p4SnapshotRef identity+version+asOf+contentHash (AD-014)
- Parameters: presence validation only (AD-015)
- Versioning separation (AD-017); idempotency boundary (AD-018)
- UNKNOWN representation: absence/NOT_DETERMINED/BLOCKED (AD-019)
- Approval boundary reference-only (AD-020); EXPIRY horizon deferred (AD-022)
- No hidden score (AD-024); consequential flag (AD-005)

## Appendix D — Rejected / Deferred Policy Alternatives

1. Policy as free-form guidance — rejected (non-deterministic; PD-001).
2. Policy producing only SELECTED/NO_ACTION — rejected (loses BLOCKED/NOT_DETERMINED; PD-001).
3. Eligibility as a state dimension — rejected (P5-02 AD-010; PD-002).
4. NO_ACTION produced eagerly on first non-match — rejected (PD-003).
5. Score-based precedence ("highest score wins") — rejected (hidden score; PD-004).
6. Reuse of legacy numeric thresholds — rejected (PD-014).
7. LLM as policy engine — rejected (PD-016).
8. Full reuse of legacy rule engine (mechanism + definitions) — rejected (PD-017).
9. UNKNOWN → NO_ACTION mapping — rejected (hard gate; PD-008).
10. Safety encoded inside policy — deferred/classified to P5-04 (PD-015, §28).
11. ESCALATE policy details (authority/recipient/severity) — deferred to P5-04/P5-06 (DSD-002).
12. Cooldown durations / expiry horizon values — deferred (OPEN; PD-005/PD-007).

---

## Verification record (P5-03)

- Original ten-gate self-audit executed: all ten gates PASS.
- **P5-03 R2 freeze check:** twelve-gate freeze audit executed — all
  twelve PASS (§42); document status changed to FROZEN / APPROVED FOR
  DOWNSTREAM.
- Only this document was created/modified by the P5-03 tasks; git status
  shows no src/P3/P4/P4-06/DB/API/UI changes.
- Pre-existing dirty files (P5-00 R2 Master, P5-01/P5-02 docs,
  package-lock.json, tsconfig.tsbuildinfo) untouched.

*End of P5-03 Action Decision / Policy Engine (R2 — FROZEN / APPROVED FOR
DOWNSTREAM). Policy semantic design only — no implementation; no safety,
approval, or execution engine defined. P5-04 design may proceed after
owner confirmation of this freeze.*
