# P5-03 POLICY RULESET V1 — FROZEN

**Document status: FROZEN / APPROVED FOR DOWNSTREAM** (owner-approved 2026-08-17; approval record in §21)

| Field | Value |
|---|---|
| Policy ID | `pol-p5-v1` (owner-approved, decision 1) |
| Policy Version | `v1` (owner-approved, decision 2) |
| Status | `FROZEN` |
| Depends on | P5-02 → P5-09 FROZEN; P5-03 semantic contract FROZEN; P5-03-RT_RECON / P5-03-RT_IMPLEMENTATION |
| Task scope | Definition + owner approval + freeze. **No production code. No evaluator. No frozen-contract modification.** |

This document was drafted as a **candidate** ruleset for owner review (R1/R2 —
DRAFT — OWNER REVIEW REQUIRED) and was **explicitly approved by the owner on
2026-08-17** with the 18-point baseline recorded in §21.1. Per that approval,
ODR-1…ODR-14 are resolved (approved values in §21.2) and the ruleset is promoted
to **FROZEN / APPROVED FOR DOWNSTREAM**. Historical draft content and revision
history are preserved (§16/§17 retain the pre-approval DRAFT proposals as
historical record; revision record R1/R2/R3).

---

## 1. Policy Identity

| Identity element | Value / status |
|---|---|
| policyId | `pol-p5-v1` — **FROZEN** (owner-approved 2026-08-17, decision 1) |
| policyVersion | `v1` — **FROZEN** (owner-approved 2026-08-17, decision 2) |
| effectiveAt | 2026-08-17 (owner approval date — metadata recorded per PD-012; §21.1) |
| evaluationAt | recorded per evaluation (PD-012) — metadata, excluded from semantic determinism (PD-010) |
| status | `FROZEN` |
| Rule statuses used in inventory | `CONTRACT` (direct restatement of a FROZEN contract clause) vs `FROZEN-APPROVED` (business rule explicitly approved by owner 2026-08-17 — §21.2) vs `DEFERRED` (not part of V1 — §19) |

Policy identity/version semantics: P5-03 PD-012 (FROZEN) — `policyId ·
policyVersion · effectiveAt · evaluationAt` per evaluation, separate from
action-model / P4 / algorithm versions; no silent re-attribution. Versioning is
immutable per published version (P5-03 §34.8).

---

## 2. Policy Objective

P5-03 policy determines, for a given `ActionCandidate` (P5-02) evaluated against
declared P4 interpretation/evidence inputs (P5-03 §6), **eligibility, blocking,
suppression, and selection** — producing a policy outcome from the FROZEN P5-02
AD-004 vocabulary (SELECTED / NO_ACTION / BLOCKED / NOT_DETERMINED), an
eligibility result, optional suppression layer result (PD-019), optional
POLICY-source blocker report (PD-018), and full policy provenance (PD-012).

This is **decision-support policy, not execution policy**:

- Policy produces a *policy outcome and handoff*; it never approves, never grants
  permission, never executes, never re-runs safety (P5-03 §4/§28/§29; PD-015).
- ELIGIBLE is a policy evaluation result, **not** a state and **not** an
  execution permission (PD-002; P5-02 AD-010). ELIGIBLE → P5-04 may still BLOCK.
- P5-03 output feeds P5-04 (safety/approval/permission) and P5-05
  (explanation/audit); the result is recordable via P5-09 and replayable via
  P5-07 — but P5-03 itself writes no persistence.

---

## 3. Input Contract

Every input P5-03 v1 may consume, from P5-03 §6 Policy Input Model + §34.1,
with the runtime source verified in `P5-03-RT_RECON.md` §3.

### 3.1 Inputs from P4 runtime (`P4DecisionSupportViewModel` — `src/lib/p4/types.ts:280`)

| Input | Source (runtime) | Meaning | Required/Optional | Allowed states | What P5 is NOT allowed to reinterpret |
|---|---|---|---|---|---|
| `narrativeIdentity` (`narrativeId`, window, algorithmKey/Version, calculationMode) | P4 VM | subject/context identity | REQUIRED (scope gate) | as produced | not re-derived; identity only |
| `status` | P4 VM | interpretation quality | REQUIRED | `OK \| DEGRADED \| NO_EVIDENCE \| ERROR` | never mapped to NO_ACTION (PD-008); routed per §7 |
| `asOf` / `version` (algorithm/semantic/signal-catalog) | P4 VM | evidence time + version tuple | REQUIRED | as produced | preserved in provenance; never "latest" |
| `direction` | P4 VM | declared directional state | REQUIRED | `POSITIVE \| NEGATIVE \| MIXED \| NEUTRAL \| UNKNOWN` | **never a direct action mapping** (§11, PD-014); consumed only in rules whose semantic role is explicit |
| `signals` (8 ids incl. `EVIDENCE_CONFLICT`, `REGIME_CHANGE`, …) | P4 VM | fired signals | OPTIONAL (may be empty) | catalog set | context conditions only; never scores |
| `opportunity` / `risk` / `confidence` / `actionability` | P4 VM | declared qualitative values | REQUIRED | `LOW \| MEDIUM \| HIGH \| UNKNOWN` | consumed **as-is**; never combined into composite scores or weighted formulas (§12, PD-014); never converted into a P5 outcome by itself (task prohibition) |
| `explanation` (+ attribution) | P4 VM | P4 interpretation explanation | OPTIONAL | as produced | evidence for P5-05; not a policy input |
| `evidence` / `historicalContext` | P4 VM | evidence refs + sufficiency | OPTIONAL | as produced | evidence-quality context only |
| `provenance` / `degradation` | P4 VM | quality + reasons | REQUIRED when DEGRADED | as produced | preserved verbatim in provenance |

### 3.2 Inputs from P5-02 / P5-03 layers

| Input | Source | Meaning | Required/Optional | Allowed states |
|---|---|---|---|---|
| `ActionCandidate` (candidateId, actionType, parameters, subject) | P5-02 candidate contract (P5-03 §6.C) | considered action | REQUIRED | candidate vocabulary |
| `p4SnapshotRef` (AD-014) | P4 refs | snapshot identity consumed | REQUIRED | exact ref; never live/current |
| Cooldown / duplicate history | P5-03 policy-owned declared context (§6.D) | suppression inputs | DEFERRED — not in V1 (no runtime exists; §19) | declared context only |
| System/action support status | P5-06/later (§6.E) | capability availability | ABSENT — v1 treats as static/absent unless documented (contract note) | — |

### 3.3 Hard boundaries on inputs

- Anything not in P5-03 §6 is a CONTRACT GAP to record, not an invented input.
- No new P4 metrics are invented; P4 O/R/C/A is never recalculated (§12).
- `contentHash` (AD-014) remains PROVISIONAL; P5-03 does not compute hashes.
- No LLM input is authoritative for policy (PD-016).

---

## 4. Rule Inventory

Two rule classes:

- **CONTRACT rules (R-…)**: direct restatements of FROZEN clauses. No business
  judgment; they already are the contract.
- **FROZEN-APPROVED rules (C-…)**: v1 business rules explicitly approved by the
  owner (2026-08-17; §21.2), formerly CANDIDATE. Rules marked DEFERRED (§19)
  are not part of V1.

Rule field semantics per P5-03 §9 (ruleId, policyVersion, purpose, scope,
inputs, condition, outcome, priority, applicability/layer, reasonCode,
effectiveAt/expiresAt, owner, status). Precedence follows PD-004 (§6).

### 4.1 CONTRACT rules (frozen semantics restated)

| ruleId | Layer | Condition | Outcome | Reason code (approved) | Contract source |
|---|---|---|---|---|---|
| R-001 | all | policy evaluation technical failure (engine error, missing rule set) | **NOT_DETERMINED** + failure reason — never NO_ACTION | `POLICY_EVALUATION_FAILURE` | PD-009; §34.7 |
| R-002 | all | input layer unavailable / P4 context absent (status ERROR or missing VM) | **NOT_DETERMINED** + availability reason — never NO_ACTION | `POLICY_INPUT_UNAVAILABLE` | PD-008; §27; §34.7 |
| R-003 | 5 (selection) | evaluation **completed**, no candidate eligible | **NO_ACTION** + policy ref (explicit "nothing eligible" — not a shortcut, not a failure) | `NO_ELIGIBLE_ACTION` | PD-003; §34.3 |
| R-004 | 4 (suppression) | candidate suppressed (cooldown/dedup) | **SUPPRESSED** layer result, `suppressed: true` + reason; no new decision; **never NO_ACTION** (no V1 trigger — §19) | `SUPPRESSED` | PD-019; §17; §34.3 |
| R-005 | all | any UNKNOWN / DEGRADED / NULL input | **never → NO_ACTION** (hard gate); must route per §7 | — | PD-008; §13; P5-02 AD-019 |
| R-006 | all | any rule condition on Direction | **no direct action mapping** (`Direction = POSITIVE → INCREASE_EXPOSURE` forbidden) | — | §11; PD-014; P5-02 AD-008 |
| R-007 | all | any rule condition on O/R/C/A | **as-is only**; no composite score, no weighted formula, no numeric threshold | — | §12; PD-014; P5-02 AD-024 |
| R-008 | 3 (blocking) | a blocking rule fires | **BLOCKED** with `blockerReport.source = POLICY` + rule refs (POLICY-BLOCKED, never a generic BLOCKED; no V1 trigger — §21.3) | `POLICY_BLOCKED` | PD-018; §34.3; P5-02 AD-011 |

### 4.2 V1 business rules (FROZEN-APPROVED per owner approval R3; previously CANDIDATE)

The v1 business rules adopt the P5-03 §34.2 illustrative eligibility matrix
(now owner-approved) plus the owner's 18-point baseline (§21.1). Each rule below
is **FROZEN-APPROVED** except those explicitly marked DEFERRED (§19). Where an
owner decision overrides an earlier CANDIDATE proposal, the approved outcome is
shown with the decision reference.

> **V1 note:** no rule in V1 triggers **POLICY-BLOCKED** — every former blocking
> condition resolves to **NOT_DETERMINED** (owner decisions 7, 8, 10, 11). The
> POLICY-BLOCKED classification (R-008, PD-018) remains part of the frozen
> outcome vocabulary for future rules; it is simply not triggered by V1. Layer 4
> (suppression) also has no V1 trigger (C-401/C-402 deferred).

**Layer 1 — Applicability**

| ruleId | Priority | Condition | Outcome | Required inputs | Rationale | Downstream effect |
|---|---|---|---|---|---|---|
| C-101 | 1 | candidate `actionType` ∈ approved v1 scope AND subject resolves (narrativeId present) | proceed to Layer 2 | narrativeIdentity, actionType | scope gate (PD-004 step 1) | — |
| C-102 | 1 | candidate `actionType` ∉ approved v1 scope | **NOT_DETERMINED** — out-of-scope evaluation (owner decision 8; supersedes the earlier NO_ACTION proposal) | actionType | §15 layer 1; owner decision 8 | P5-05 audit |

**Layer 2 — Eligibility (FROZEN-APPROVED; sourced from §34.2 illustrative matrix)**

| ruleId | Priority | Condition | Outcome | Required inputs | Downstream effect |
|---|---|---|---|---|---|
| C-201 | 2 | type MONITOR; P4 snapshot present; Direction ≠ UNKNOWN | ELIGIBLE (FROZEN-APPROVED) | status, direction | → Layer 5 |
| C-202 | 2 | type REVIEW; P4 snapshot present | ELIGIBLE (FROZEN-APPROVED) | status | → Layer 5 |
| C-203 | 2 | type INVESTIGATE; target ref resolves (signal or degradation exists) | ELIGIBLE (FROZEN-APPROVED) | signals, degradation | → Layer 5 |
| C-204 | 2 | type REDUCE_EXPOSURE; snapshot usable (status OK, or DEGRADED with required inputs still usable per C-602); parameters complete | ELIGIBLE (FROZEN-APPROVED) | status, parameters | → Layer 5 |
| C-205 | 2 | type INCREASE_EXPOSURE; same preconditions as C-204 | ELIGIBLE (FROZEN-APPROVED) | status, parameters | → Layer 5 |
| C-206 | 2 | type REBALANCE; same as C-204 + subject set valid | ELIGIBLE (FROZEN-APPROVED) | status, parameters, subject | → Layer 5 |
| C-210 | 2 | any type; a required parameter (per AD-015) is unavailable | **NOT_DETERMINED** — required input unavailable (owner decision 7; supersedes the earlier INELIGIBLE/BLOCKED proposal) | parameters | §22; AD-015; owner decision 7 | P5-05 |

**Layer 3 — Blocking**

| ruleId | Priority | Condition | Outcome | Required inputs | Downstream effect |
|---|---|---|---|---|---|
| C-301 | 3 | consequential candidate; P4 snapshot status DEGRADED or NO_EVIDENCE and required policy inputs unusable | **NOT_DETERMINED** — insufficient/unusable evidence (owner decisions 10–11; supersedes the earlier POLICY-BLOCKED proposal; status-based only, no temporal expiry — ODR-8 deferred) | status, degradation | P5-05 |
| C-302 | 3 | unsupported action type or parameter violation (unresolvable candidate input) | **NOT_DETERMINED** — out-of-scope / required input unavailable (owner decisions 7–8; supersedes the earlier POLICY-BLOCKED proposal) | actionType, parameters | P5-05 |

**Layer 4 — Suppression (DEFERRED from V1 — §19)**

| ruleId | Priority | Condition | Outcome | Required inputs | Downstream effect |
|---|---|---|---|---|---|
| C-401 | 4 | equivalent ACTIVE decision exists: subject + actionType + p4SnapshotRef + policyVersion + active decisionState (PD-006 equivalence) | SUPPRESSED (layer result, no new decision) — **DEFERRED from V1** | decision history (runtime missing — dependency) | P5-05 |
| C-402 | 4 | cooldown: SELECTED decision of class subject × actionType within period | SUPPRESSED (layer result) — **DEFERRED from V1** (no durations; PD-005) | decision history + owner-supplied duration | P5-05 |

**Layer 5 — Selection**

| ruleId | Priority | Condition | Outcome | Required inputs | Downstream effect |
|---|---|---|---|---|---|
| C-501 | 5 | exactly one eligible, non-suppressed candidate | **SELECTED** with `selectedActionRef` = candidate (FROZEN-APPROVED; decision 12) | eligibility results | P5-04 receives SELECTED + selectedActionRef (P5-04 §2) |
| C-502 | 5 | multiple eligible, non-suppressed candidates | **DEFERRED — not in V1** (decision 12: predicate-based selection only; V1 uses C-501 single-candidate; business-precedence property not needed) | eligibility results | P5-04 |

**Cross-layer — UNKNOWN / DEGRADED routing (per PD-008, §13)**

| ruleId | Priority | Condition | Outcome | Required inputs | Downstream effect |
|---|---|---|---|---|---|
| C-601 | 3 | P4 status NO_EVIDENCE (required evidence unavailable) | **NOT_DETERMINED** (owner decision 11; REVIEW/INVESTIGATE routing deferred — §19) | status | P5-05 |
| C-602 | 3 | P4 status DEGRADED and required policy inputs unusable | **NOT_DETERMINED** (owner decision 10); if required inputs remain usable, evaluation proceeds normally | status, degradation | P5-05 |

---

## 5. Outcome Mapping

Only outcomes permitted by the frozen P5-03 contract (P5-02 AD-004 vocabulary +
P5-03 layer results) are used. **No new outcome is introduced.**

| P5-03 layer result / outcome | Meaning (contract) | Produced by | Becomes in `P5DecisionRecord` (`src/lib/p5/types.ts`) |
|---|---|---|---|
| SELECTED | evaluation completed, candidate selected (PD-003) | Layer 5 (C-501) | `outcome = "SELECTED"`, `actionId` created (AD-013) |
| NO_ACTION | evaluation completed, nothing eligible — explicit, with policy ref (PD-003) | Layer 5 (post-eligibility) | `outcome = "NO_ACTION"` |
| POLICY-BLOCKED | blocking rule fired; `blockerReport.source = POLICY` (PD-018) | Layer 3 — **no V1 trigger** (classification retained for future rules) | `outcome = "BLOCKED"` + `blockerReport.source = "POLICY"` |
| NOT_DETERMINED | could not determine eligibility (degraded/unusable/technical failure/out-of-scope/no evidence) (PD-008/009; decisions 7/8/10/11) | Layers 2–3 / engine | `outcome = "NOT_DETERMINED"` |
| SUPPRESSED | layer-level suppression result; no new decision; never NO_ACTION (PD-019) | Layer 4 — **no V1 trigger** (C-401/C-402 deferred) | `suppressed = true`; **NOT** a P5-02 outcome |
| ELIGIBLE | policy result: candidate may proceed — not a state, not permission (PD-002) | Layer 2 | eligibility result (recorded fact) |
| INELIGIBLE | policy result: does not proceed | Layer 2 | feeds NO_ACTION (completed eval) |

Forbidden mappings (all contract-mandated): UNKNOWN→NO_ACTION, DEGRADED→NO_ACTION,
NULL→NO_ACTION, ABSENT→NO_ACTION, suppressed→NO_ACTION, technical failure→NO_ACTION,
policy-unavailable→NO_ACTION, NOT_DETERMINED-as-generic-error. NO_ACTION is only
the completed-evaluation "nothing eligible" case (R-003, decision 9).

---

## 6. Precedence

Frozen PD-004 six-step precedence, applied deterministically; **no ambiguity, no
"latest wins", no implicit priority, no numeric priority scores**:

1. **Applicability** (C-101/C-102) — policy version / subject / time gate.
2. **Eligibility** (C-201…C-210) — candidate preconditions.
3. **Explicit blocking** (C-301/C-302) — blocking beats selection (V1: both
   rules resolve to NOT_DETERMINED; no POLICY-BLOCKED result).
4. **Explicit suppression** (C-401/C-402) — **deferred from V1**; no layer-4
   trigger exists in V1.
5. **Explicit business precedence** — only if the policy defines a versioned
   business-precedence property; **v1: absent → skip** (decision 12; C-502
   deferred).
6. **Deterministic final tie-break** — `ruleId` as a purely technical ordering
   key among otherwise-equivalent rules. `ruleId` implies NO business priority
   (R-001 > R-002 is false; lower ruleId ≠ higher priority).

Safety (P5-04) sits **outside** policy precedence; policy can never override
safety (PD-015, §34.4). Conflict between a blocking rule and a selection rule →
blocking wins; between suppression and selection → suppression wins.

---

## 7. Absence / Unknown / Degraded

Frozen hard gate PD-008 + §13. No absence/unknown/degraded state may silently
become NO_ACTION.

| Condition | Policy behavior | Contract status | Owner decision needed? |
|---|---|---|---|
| P4 context missing entirely (VM absent / status ERROR) | NOT_DETERMINED + availability reason (R-002) | CONTRACT (FROZEN) | no |
| P4 status NO_EVIDENCE | **NOT_DETERMINED** when required evidence unavailable (C-601) | PD-008; owner decision 11 | no — FROZEN |
| P4 status DEGRADED | **evaluate only if required policy inputs remain usable; otherwise NOT_DETERMINED** (C-602) | PD-008; §13; owner decision 10 | no — FROZEN |
| Direction UNKNOWN | MONITOR eligibility: "snapshot present AND Direction ≠ UNKNOWN" (C-201; FROZEN-APPROVED) | §11; ODR-14 (decision 13) | no — FROZEN |
| O/R/C/A = UNKNOWN | consumed as-is; no score; routing per rule condition | as-is FROZEN (§12); per-rule use rule-level | per rule |
| Missing required evidence | **NOT_DETERMINED** when required evidence unavailable (C-301) | §13; owner decisions 7/11 | no — FROZEN |
| Missing required parameter | **NOT_DETERMINED** (C-210, decision 7) | §22; AD-015 | no — FROZEN |
| Unknown/unrecognized input value | treated as unusable input → NOT_DETERMINED path (R-002) | PD-008 | no |

Distinction preserved always: **"no eligible action"** (completed evaluation →
NO_ACTION, R-003) ≠ **"could not determine eligibility"** (→ NOT_DETERMINED).

---

## 8. Eligibility vs Selection

Frozen PD-002/PD-003 semantics, restated as ruleset invariants:

- **ELIGIBLE ≠ SELECTED.** Eligibility (Layer 2) is per-candidate; selection
  (Layer 5) is the deterministic choice among eligible, non-suppressed
  candidates. A candidate may be ELIGIBLE and still not selected (multi-candidate
  case, deferred) or still BLOCKED downstream at P5-04.
- Eligibility rules (C-201…C-210) and selection rules (C-501/C-502) are stated
  **independently**; no eligibility rule implies selection, and no selection rule
  confers eligibility.
- ELIGIBLE is never an execution permission (PD-002; P5-02 AD-010; decision 5).

---

## 9. Suppression

Policy-level suppression only (Layer 4). Never mixed with safety blocking or
approval denial (P5-04 semantics).

- **Outcome:** SUPPRESSED layer result, `suppressed: true`, suppression reason,
  no new decision; existing decision stands; **never NO_ACTION** (PD-019,
  R-004).
- **V1 status: DEFERRED** — duplicate suppression (C-401) and cooldown (C-402)
  are **not part of V1** (owner decisions 4/15; §19/§21.4). R-004 remains part
  of the frozen vocabulary for future rules; V1 has no layer-4 trigger.
- **Dependency (future):** when C-401 is adopted in a later version, it requires
  a decision-history runtime (does not exist today; P5-03 §6.D). Until then,
  suppression never fires — never a fabricated SUPPRESSED.

---

## 10. Policy Block

Policy-level blockers only (Layer 3). No safety/approval semantics.

- **Outcome:** BLOCKED with `blockerReport.source = POLICY` + rule refs —
  POLICY-BLOCKED (PD-018, R-008). P5-02 AD-004 BLOCKED vocabulary preserved;
  P5-04's SAFETY-BLOCKED / APPROVAL-DENIED never collapse into it.
- **V1 status:** **no V1 rule triggers POLICY-BLOCKED** — the former blocking
  candidates (C-301/C-302) resolve to NOT_DETERMINED (owner decisions 7/8/10/11).
  The POLICY-BLOCKED classification (R-008, PD-018) remains part of the frozen
  vocabulary for future rules.
- A POLICY-BLOCKED result (future) passes to P5-05 as a recorded fact; P5-03
  does not decide "retry" or any execution semantics.

---

## 11. Determinism

Frozen PD-010 (FROZEN):

> same (p4SnapshotRef + candidate + policyVersion + declared context) ⇒ same outcome.

Ruleset-level guarantees:

1. Identical `policyId`, `policyVersion`, evaluation input (P4 VM fields
   consumed + candidate + declared context) ⇒ identical structured policy
   result.
2. No `Date.now()`, `Math.random()`, mutable global state, unordered iteration
   that can change output, or live mutable state outside the declared input set
   may affect policy semantics.
3. Timestamps (`evaluationAt`, `effectiveAt`) are **metadata/provenance**; they
   are recorded (PD-012) but cannot alter rule outcomes. **V1 has no
   time-dependent rules** (temporal semantics deferred — decision 15); any
   future time-dependent rule must consume an explicit declared
   temporal-context input, not a wall clock.
4. Precedence is the frozen six-step PD-004 order; ruleId tie-break is purely
   technical (step 6 of §6).
5. Rule iteration order is fixed by (layer, priority, ruleId) — a declared,
   stable ordering.

---

## 12. Provenance

Every evaluation result must preserve (PD-012, P5-03 §32/§34.8; decision 17):

- `policyId`, `policyVersion`, `effectiveAt`, `evaluationAt`;
- `ruleId`/`ruleIds` that fired (eligibility, selection; blocking/suppression
  when such rules exist in a future version);
- input provenance: `p4SnapshotRef` (AD-014) + P4 version tuple
  (algorithm/semantic/signal-catalog versions) + degradation refs when DEGRADED;
- reasonCode for audit/explanation (approved vocabulary, ODR-12: `POLICY_EVALUATION_FAILURE`,
  `POLICY_INPUT_UNAVAILABLE`, `NO_ELIGIBLE_ACTION`, `SUPPRESSED`,
  `POLICY_BLOCKED`, `NOT_ELIGIBLE`, `SELECTED` — §21.2);
- no "latest"/implicit substitution; provenance is exact-reference only.

Provenance flows unchanged into `P5DecisionRecord.provenance` (P5-09 recorder),
P5-05 explanation/audit, and P5-07 replay (historical-over-live).

---

## 13. Identity

Frozen P5-02 AD-013 / AD-018, restated — **not redefined**:

| Identity | Purpose | Source |
|---|---|---|
| `decisionId` | identity of **one decision evaluation**; unique over subject identity + decision context (p4 snapshot ref) + policy version + action model version; re-evaluating the same tuple ⇒ same decision | P5-02 §12.1/§12.2 (AD-013/AD-018) |
| `idempotencyKey` | duplicate suppression for **commands** (DecideAction/ApproveAction/ExecuteAction); command-layer identity, deferred to P5-03/05 implementation | P5-02 §12.1/§17 (AD-018) |
| `contentHash` | drift detection for the **P4 snapshot payload only**; composite hash NOT defined; **PROVISIONAL** | P5-02 §12.2 (AD-013/AD-018); AD-014 |

- `decisionId ≠ idempotencyKey ≠ contentHash` — separate identifiers, never
  aliases (candidateId → decisionId → actionId parent→child).
- P5-03 v1 does **not** compute contentHash, does **not** assign decisionId at
  policy time (decision identity belongs to the decision evaluation, P5-10
  boundary), and introduces no sequence numbers.

---

## 14. Forbidden Legacy Mapping

Explicit exclusions (P5-03 PD-014 FROZEN; P5-01 §15):

- Legacy numeric thresholds `90/80/65` (`src/lib/features/engine.ts:158`) and
  `25/15/8` (`src/lib/services/decision-engine.service.ts:14-31`) are recorded
  **LEGACY** and **NOT reused** in any form.
- `STRONG_WATCH` / `WATCH` signal semantics from the legacy P1 engine are NOT
  part of P5 policy.
- `src/lib/services/rule-version.service.ts` (legacy P1 rule engine) is NOT a
  P5-03 implementation source. P5-03 PD-017 (PROVISIONAL): the *deterministic
  rule-engine mechanism* (priority, AND/OR, versioned sets) may be reused as a
  pattern precedent; legacy rule **definitions/thresholds** reuse = NONE.
- No BUY / SELL / LONG / SHORT / ORDER / TRADE / EXECUTION semantics anywhere in
  the ruleset. P5-02 AD-008; P5-03 PD-014.
- No hidden scoring engine: O/R/C/A consumed as-is (§12); no `Opportunity ×
  Confidence − Risk` style formulas; no eligibility/selection "scores".

---

## 15. Worked Examples

Semantic fixture values only — **no invented numeric thresholds**. Each example
is deterministic given its inputs (PD-010). Examples reflect the **FROZEN
owner-approved V1 semantics** (§21).

**Example 1 — SELECTED (single eligible candidate, C-501)**
Input: P4 VM status `OK`, direction `MIXED`, O/R/C/A `MEDIUM/HIGH/MEDIUM/MEDIUM`,
signals `[]`, snapshot usable; candidate `REDUCE_EXPOSURE` with complete
parameters.
Layers: applicability OK → eligibility OK (C-204) → no blocking → no suppression
(no V1 trigger) → exactly one eligible → **SELECTED**, `selectedActionRef` =
candidate. Downstream: P5-04 receives SELECTED + actionRef. (Direction `MIXED`
is *not* the trigger; the trigger is input usability + candidate preconditions
— no direction mapping.)

**Example 2 — NO_ACTION (completed evaluation, nothing eligible, R-003)**
Input: candidate `MONITOR` with P4 Direction `UNKNOWN` (fails the C-201
precondition); snapshot present.
Layer 2 → not eligible; evaluation completes with zero eligible candidates →
**NO_ACTION** + policy ref, reason `NO_ELIGIBLE_ACTION`. This is the *only*
NO_ACTION path in V1 (decision 9). A missing required parameter instead yields
NOT_DETERMINED (C-210, decision 7 — Example 4).

**Example 3 — NOT_DETERMINED (unusable input, R-002)**
Input: P4 VM absent / status `ERROR` for the subject.
Policy cannot determine eligibility → **NOT_DETERMINED** + `POLICY_INPUT_UNAVAILABLE`.
Never NO_ACTION.

**Example 4 — NOT_DETERMINED (no evidence / missing required input)**
Input: P4 VM status `NO_EVIDENCE`; consequential candidate `INCREASE_EXPOSURE`.
→ **NOT_DETERMINED** (C-601, decision 11). Also: a required parameter missing →
**NOT_DETERMINED** (C-210, decision 7). Advisory `REVIEW`/`INVESTIGATE` remain
eligible per their own preconditions when evidence exists (C-202/C-203).

**Example 5 — NOT_DETERMINED (degraded unusable input, C-602/C-301)**
Input: P4 VM status `DEGRADED` (degradation `EVIDENCE_CONFLICT`); candidate
`REBALANCE`; required policy inputs unusable.
→ **NOT_DETERMINED** (C-602, decision 10). If the required inputs remain usable
under DEGRADED, evaluation proceeds normally. (POLICY-BLOCKED classification,
R-008/PD-018, is retained for future rules but is not triggered by V1.)

**Example 6 — SUPPRESSED (future; C-401/C-402 deferred from V1)**
Input (future): an equivalent ACTIVE decision exists (subject + actionType +
p4SnapshotRef + policyVersion + active decisionState).
→ **SUPPRESSED** layer result, `suppressed: true`, no new decision; the existing
decision stands. Never NO_ACTION (R-004). Not triggered in V1 (deferred, §19) —
shown for classification semantics only.

**Example 7 — Determinism (PD-010, decision 18)**
The exact input set of Example 1 evaluated twice with the same policyId/version
and declared context yields byte-identical structured results, including ruleIds
fired and reasonCodes. Changing only `evaluationAt` (metadata) does not change
the result.

**Example 8 — No direction mapping (R-006, decision 13)**
`direction = POSITIVE` alone never yields a selection; `direction = NEGATIVE`
alone never yields REDUCE_EXPOSURE. Direction participates only in explicit
semantic-role rules (e.g., C-201's "Direction ≠ UNKNOWN" precondition).

---

## 16. Owner Decisions Required

Every business decision that cannot be derived from the frozen contracts.
**No value below was chosen by the agent; each was resolved by owner approval
2026-08-17.**

| # | Decision | Approved value (owner 2026-08-17) | Basis |
|---|---|---|---|
| ODR-1 | `policyId` / `policyVersion` / `effectiveAt` | `pol-p5-v1` / `v1`; effectiveAt = 2026-08-17 | decisions 1–2; PD-012 |
| ODR-2 | v1 action-type scope | MONITOR/REVIEW/INVESTIGATE/REDUCE_EXPOSURE/INCREASE_EXPOSURE/REBALANCE; EXECUTE/ESCALATE excluded | decision 4; §10 DSD-001 |
| ODR-3 | Per-type eligibility preconditions | C-201…C-206 as proposed (snapshot-usability conditions per decisions 10–11) | decision 3; §34.2 |
| ODR-4 | Out-of-scope action type outcome (C-102) | **NOT_DETERMINED** | decision 8 |
| ODR-5 | Missing-required-parameter handling (C-210) | **NOT_DETERMINED** (required input unavailable) | decision 7 |
| ODR-6 | DEGRADED consequential routing (C-602) | **NOT_DETERMINED** when inputs unusable; else evaluate | decision 10 |
| ODR-7 | NO_EVIDENCE routing (C-601) | **NOT_DETERMINED** when required evidence unavailable | decision 11 |
| ODR-8 | Staleness horizon (C-301) | **DEFERRED** — no temporal semantics in V1 | decision 15; PD-007 |
| ODR-9 | Duplicate suppression in v1 (C-401) | **DEFERRED** — not in V1 (no decision-history runtime) | decisions 4/15; PD-006 |
| ODR-10 | Cooldown in v1 (C-402) | **DEFERRED** — not in V1 (no durations) | decision 15; PD-005 |
| ODR-11 | Selection model (C-502) | deterministic predicate-based, single-candidate (C-501); no ranking/scoring; multi-candidate deferred | decision 12; PD-004 |
| ODR-12 | Reason-code vocabulary | approved as proposed (§4.1/§12 set) | document approval |
| ODR-13 | Parameter matrix per type (AD-015) | presence validation per AD-015 (FROZEN rules; membership PROVISIONAL); unavailable → NOT_DETERMINED (decision 7); field enumeration is implementation-contract detail, no fields invented | AD-015; decision 7 |
| ODR-14 | Direction participation (C-201) | "Direction ≠ UNKNOWN" eligibility precondition kept; never an outcome (R-006) | decision 13; §11 |

This table supersedes the DRAFT-era options (R1/R2). §21.2 is authoritative.

---

## 17. Owner Decision Matrix

Detailed form of §16. Each decision lists: topic, current proposal, contract
basis, alternatives, implementation consequence, risk if incorrectly chosen,
status. The per-ODR blocks below preserve the **R2 DRAFT record**; the final
approved values and statuses are authoritative in **§21.2** (owner approval
2026-08-17). Where a block's Status row reads `OWNER APPROVAL REQUIRED`, it is
historical — the owner approval resolves it per §21.2.

### ODR-1 — Policy identity (policyId / policyVersion / effectiveAt)

| Field | Value |
|---|---|
| Decision topic | final policy identity values for v1 |
| Current proposal | `pol-p5-v1` / `v1`; `effectiveAt` supplied by owner |
| Contract basis | PD-012 (policyId·policyVersion·effectiveAt·evaluationAt); §34.8 version matrix |
| Alternatives | any owner-assigned id/version scheme |
| Impl. consequence | constant identity stamped into every evaluation result + provenance; immutable per published version |
| Risk if wrong | identity collisions or silent re-attribution; breaks audit (P5-05) and replay (P5-07) traceability |
| Status | **FROZEN — owner-approved (2026-08-17, §21.2)** |

### ODR-2 — v1 action-type scope

| Field | Value |
|---|---|
| Decision topic | which ActionTypes v1 policy covers |
| Current proposal | advisory MONITOR/REVIEW/INVESTIGATE + consequential REDUCE_EXPOSURE/INCREASE_EXPOSURE/REBALANCE candidate for v1; EXECUTE/ESCALATE excluded (AD-006/007) |
| Contract basis | P5-03 §10 (taxonomy PROVISIONAL; DSD-001 membership confirmed at P5-03 owner review); P5-02 AD-005/006/007 |
| Alternatives | smaller subset (e.g., advisory-only v1); specific type list chosen by owner |
| Impl. consequence | eligibility rules C-201…C-206 instantiated only for approved types; unsupported types → C-102 path |
| Risk if wrong | policy applied to types without approved semantics (scope creep), or required coverage missing |
| Status | **FROZEN — owner-approved (2026-08-17, §21.2)** |

### ODR-3 — Per-type eligibility preconditions

| Field | Value |
|---|---|
| Decision topic | exact eligibility conditions per approved v1 type |
| Current proposal | adopt C-201…C-206 from §34.2 illustrative matrix as-is |
| Contract basis | §34.2 (illustrative, CANDIDATE); PD-002 eligibility semantics |
| Alternatives | amend conditions per type; replace with different preconditions |
| Impl. consequence | evaluator implements exactly the approved condition predicates |
| Risk if wrong | eligibility does not match business intent; hard to change after v1 published (version immutability) |
| Status | **FROZEN — owner-approved (2026-08-17, §21.2)** |

### ODR-4 — Out-of-scope action type outcome (C-102)

| Field | Value |
|---|---|
| Decision topic | outcome when a candidate's actionType is outside approved v1 scope |
| Current proposal | **NOT_DETERMINED** — out-of-scope evaluation (approved; supersedes the R2 NO_ACTION proposal) |
| Contract basis | §15 layer 1 applicability gate; owner decision 8 |
| Alternatives | (historical) (a) NO_ACTION; (c) POLICY-BLOCKED — both rejected by decision 8 |
| Impl. consequence | out-of-scope candidates yield NOT_DETERMINED, never NO_ACTION |
| Risk if wrong | NO_ACTION would hide a scope gap (rejected); NOT_DETERMINED is explicit |
| Status | **FROZEN — owner-approved (decision 8)** |

### ODR-5 — Missing-required-parameter handling (C-210)

| Field | Value |
|---|---|
| Decision topic | outcome when a required parameter (AD-015) is absent |
| Current proposal | **NOT_DETERMINED** — required input unavailable (approved; supersedes the R2 INELIGIBLE/BLOCKED proposal) |
| Contract basis | P5-03 §22; P5-02 AD-015; owner decision 7 |
| Alternatives | (historical) INELIGIBLE / POLICY-BLOCKED — rejected by decision 7 |
| Impl. consequence | missing required parameter yields NOT_DETERMINED, never NO_ACTION/BLOCKED |
| Risk if wrong | collapsing into NO_ACTION would violate decisions 6–7 (rejected) |
| Status | **FROZEN — owner-approved (decision 7)** |

### ODR-6 — DEGRADED consequential routing (C-602)

| Field | Value |
|---|---|
| Decision topic | outcome for a consequential candidate when P4 status is DEGRADED |
| Current proposal | **NOT_DETERMINED** when required policy inputs are unusable; otherwise evaluate normally (approved; supersedes the R2 POLICY-BLOCKED proposal) |
| Contract basis | §13 direction (FROZEN); PD-008 outcome set; owner decision 10 |
| Alternatives | (historical) POLICY-BLOCKED — rejected by decision 10 |
| Impl. consequence | degraded-unusable input yields NOT_DETERMINED; no V1 POLICY-BLOCKED trigger remains |
| Risk if wrong | explicit NOT_DETERMINED is the owner-chosen audit semantics |
| Status | **FROZEN — owner-approved (decision 10)** |

### ODR-7 — NO_EVIDENCE routing (C-601)

| Field | Value |
|---|---|
| Decision topic | outcome when P4 status is NO_EVIDENCE, per type |
| Current proposal | **NOT_DETERMINED** when required evidence is unavailable (approved; REVIEW/INVESTIGATE routing deferred — §19) |
| Contract basis | PD-008; owner decision 11 |
| Alternatives | (historical) REVIEW/INVESTIGATE routing — deferred, not in V1 |
| Impl. consequence | no-evidence evaluation yields NOT_DETERMINED |
| Risk if wrong | routing to REVIEW without approved semantics would invent an obligation (deferred) |
| Status | **FROZEN — owner-approved (decision 11)** |

### ODR-8 — Staleness horizon (C-301)

| Field | Value |
|---|---|
| Decision topic | whether v1 computes temporal evidence staleness, and with what horizon |
| Current proposal | **DEFER temporal staleness from V1** (V1 simplicity rule): C-301 v1 condition is status-based only (DEGRADED / NO_EVIDENCE ⇒ evidence unusable); no age computation, no horizon value |
| Contract basis | PD-007 (horizon values OPEN — PROVISIONAL); §13 stale/invalid evidence direction |
| Alternatives | owner supplies explicit horizon(s) + declared temporal-context input for v1 |
| Impl. consequence | v1 evaluator has no time-dependent staleness logic; no temporal engine needed |
| Risk if wrong | introducing unapproved durations = invented threshold (PD-014); deferring is safe (PD-007 PROVISIONAL) |
| Status | **DEFERRED — confirmed by owner (decision 15)** — no temporal semantics in V1 |

### ODR-9 — Duplicate suppression in v1 (C-401)

| Field | Value |
|---|---|
| Decision topic | whether v1 includes duplicate suppression (PD-006 equivalence) |
| Current proposal | **DEFER from V1** — no decision-history runtime exists; PD-006 PROVISIONAL |
| Contract basis | PD-006 (PROVISIONAL); P5-03 §6.D declared-context dependency |
| Alternatives | include in v1, contingent on a decision-history runtime being provided |
| Impl. consequence | v1 evaluator needs no suppression input; layer 4 has no triggers in v1 (R-004 path dormant) |
| Risk if wrong | including without a runtime = fabricated suppression inputs; excluding is safe (PROVISIONAL) |
| Status | **DEFERRED — confirmed by owner (decisions 4/15)** — not in V1 |

### ODR-10 — Cooldown in v1 (C-402)

| Field | Value |
|---|---|
| Decision topic | whether v1 includes cooldown suppression |
| Current proposal | **DEFER from V1** — no durations (PD-005: "no default durations invented") |
| Contract basis | PD-005 (PROVISIONAL); §16 cooldown (OPEN) |
| Alternatives | owner supplies explicit durations + decision history |
| Impl. consequence | no cooldown logic in v1 at all |
| Risk if wrong | invented durations = invented threshold (PD-014) |
| Status | **DEFERRED — confirmed by owner (decision 15)** — no temporal semantics in V1 |

### ODR-11 — Selection model (C-502)

| Field | Value |
|---|---|
| Decision topic | how selection resolves eligible candidates |
| Current proposal | **v1 single-candidate model** — exactly one eligible, non-suppressed candidate ⇒ SELECTED; multi-candidate deferred |
| Contract basis | PD-004 (step 5 business precedence only if versioned; step 6 ruleId tie-break); §8 selection |
| Alternatives | multi-candidate + versioned business-precedence property |
| Impl. consequence | v1 selection is trivially deterministic; no business-precedence property needed |
| Risk if wrong | multi-candidate without a precedence property → ambiguous selection (PD-004 violation) |
| Status | **FROZEN — owner-approved (decision 12)** |

### ODR-12 — Reason-code vocabulary

| Field | Value |
|---|---|
| Decision topic | the machine reason-code vocabulary stamped into results |
| Current proposal | approve proposed set: `POLICY_EVALUATION_FAILURE`, `POLICY_INPUT_UNAVAILABLE`, `NO_ELIGIBLE_ACTION`, `SUPPRESSED`, `POLICY_BLOCKED`, `NOT_ELIGIBLE`, `SELECTED` |
| Contract basis | §9 rule-structure reasonCode field; PD-012 provenance |
| Alternatives | amend / extend vocabulary |
| Impl. consequence | stable machine vocabulary used by audit (P5-05) and replay (P5-07) |
| Risk if wrong | unstable vocabulary breaks audit/explanation consumers and replay comparisons |
| Status | **FROZEN — owner-approved (2026-08-17, §21.2)** |

### ODR-13 — Parameter matrix per type (AD-015)

| Field | Value |
|---|---|
| Decision topic | the required-parameter set per approved v1 type |
| Current proposal | presence validation per AD-015 (FROZEN rules; membership PROVISIONAL); unavailable → NOT_DETERMINED (decision 7); field enumeration is implementation-contract detail, no fields invented |
| Contract basis | P5-02 AD-015 parameter matrix; P5-03 §22 |
| Alternatives | minimal universal set (e.g., subject/target identity only) |
| Impl. consequence | evaluator validates presence of exactly the approved parameters |
| Risk if wrong | missing parameter checks → eligibility on incomplete candidates |
| Status | **FROZEN — owner-approved (2026-08-17, §21.2)** |

### ODR-14 — Direction participation (C-201)

| Field | Value |
|---|---|
| Decision topic | whether/how P4 Direction participates in v1 conditions |
| Current proposal | keep "Direction ≠ UNKNOWN" as MONITOR eligibility precondition (explicit semantic role, not a mapping) |
| Contract basis | §11 ("illustrative, CANDIDATE"); R-006 / PD-014 (no direct direction→action mapping — untouched by this decision) |
| Alternatives | drop direction from all conditions; restate differently |
| Impl. consequence | direction participates in exactly one explicit-role condition |
| Risk if wrong | using direction as a trigger drifts toward a forbidden direction→action mapping (§11) |
| Status | **FROZEN — owner-approved (decision 13)** |

---

## 18. V1 Freeze Candidate

Items **frozen by owner approval 2026-08-17** (R3; §21.2). Each row below is
now FROZEN / APPROVED FOR DOWNSTREAM.

| Item | Frozen value | Basis | ODR |
|---|---|---|---|
| Policy identity (final values) | `pol-p5-v1` / `v1` / `effectiveAt` = 2026-08-17 fixed for v1 | PD-012 | ODR-1 |
| v1 action-type scope | MONITOR/REVIEW/INVESTIGATE/REDUCE_EXPOSURE/INCREASE_EXPOSURE/REBALANCE; EXECUTE/ESCALATE excluded | §10 DSD-001; AD-005/006/007; decision 4 | ODR-2 |
| Eligibility preconditions | C-201…C-206 frozen in approved form | §34.2 → approved | ODR-3 |
| Out-of-scope outcome | C-102 → **NOT_DETERMINED** | §15; owner decision 8 | ODR-4 |
| Missing-parameter handling | C-210 → **NOT_DETERMINED** | §22; AD-015; decision 7 | ODR-5 |
| DEGRADED consequential routing | C-602 → **NOT_DETERMINED** when inputs unusable | §13; PD-008; decision 10 | ODR-6 |
| NO_EVIDENCE routing | C-601 → **NOT_DETERMINED** | PD-008; decision 11 | ODR-7 |
| Selection model | C-501 frozen (single-candidate predicate selection); C-502 deferred | PD-004; decision 12 | ODR-11 |
| Reason-code vocabulary | proposed set frozen | §9; PD-012 | ODR-12 |
| Parameter matrix | presence validation per AD-015; membership enumerated at implementation (no invented fields) | AD-015; §22; decision 7 | ODR-13 |
| Direction role | C-201 "Direction ≠ UNKNOWN" frozen (explicit-role precondition) | §11; decision 13 | ODR-14 |

Explicitly **not** in the freeze candidate — confirmed DEFERRED by owner
2026-08-17: ODR-8 (staleness horizons), ODR-9 (duplicate suppression runtime),
ODR-10 (cooldown durations), C-502 (multi-candidate selection).

---

## 19. Deferred Items

Items deliberately kept out of V1 so that V1 remains the smallest policy that
honestly satisfies the frozen P5-03 contract. **None of these affect V1
semantics** (G26). All deferrals below were **confirmed by owner approval
2026-08-17** (decision 15; §21.4).

| Class | Item | Status | Reason / basis |
|---|---|---|---|
| OPEN | Staleness horizon values | OPEN (confirmed deferred) | PD-007; decision 15 |
| OPEN | Duplicate suppression runtime (decision history) | OPEN (confirmed deferred) | PD-006 PROVISIONAL; no runtime; decisions 4/15 |
| OPEN | Cooldown durations | OPEN (confirmed deferred) | PD-005; decision 15 |
| CANDIDATE | EXECUTE / ESCALATE action types | CANDIDATE | AD-006/AD-007; DSD-001/DSD-002 |
| FUTURE | REVIEW / INVESTIGATE routing (degraded/no-evidence to review paths) | FUTURE | V1 routes to NOT_DETERMINED (decisions 10–11) |
| FUTURE | Multi-candidate selection + business-precedence property | FUTURE | PD-004 step 5; decision 12 (predicate-only selection) |
| FUTURE | Ranking engines / scoring / weighted formulas | FUTURE | §12; PD-014 (no hidden score) |
| FUTURE | Staleness / cooldown infrastructure | FUTURE | PD-005/PD-007 PROVISIONAL |
| FUTURE | contentHash computation | FUTURE | AD-014 PROVISIONAL (never computed by P5-03) |
| FUTURE | Execution semantics | FUTURE | P5-04+; out of P5-03 scope |
| OUT OF SCOPE | Safety / approval / permission logic | OUT OF SCOPE | P5-04 boundary (PD-015) |
| OUT OF SCOPE | Audit taxonomy extension | OUT OF SCOPE | P5-05 §16.1 frozen vocabulary |
| OUT OF SCOPE | BUY / SELL / LONG / SHORT / ORDER / TRADE | OUT OF SCOPE | P5-02 AD-008; PD-014 |
| OUT OF SCOPE | RBAC, emergency override, execution engine | OUT OF SCOPE | task prohibitions |
| OUT OF SCOPE | P4-06 rule promotion | OUT OF SCOPE | P4-06 independent (OPEN / DATA ACCRUAL) |

---

## 20. Implementation Consequence

What P5-03-RT will implement **now that the owner has approved the V1 ruleset**
(2026-08-17; ODR-1…ODR-7, ODR-11…ODR-14 FROZEN; ODR-8/9/10 confirmed
deferred). Per the boundary in `P5-03-RT_IMPLEMENTATION.md` §3:

1. **Pure, deterministic evaluator** (`P5PolicyEvaluator`): input = declared P4
   VM fields (§3.1) + `ActionCandidate` (P5-02) + declared context (v1: none for
   suppression/temporal) + policy refs; output = `P5PolicyEvaluationResult`
   (eligibility result, selection, policy outcome, provenance, reasonCodes,
   ruleIds fired). `blockerReport`/suppression fields are carried only if a
   future rule produces them — V1 has no trigger.
2. **Exact rule set**: R-001…R-008 (frozen semantics, restated) + the
   owner-approved C-* rules (FROZEN per §21.2). No other rules. **V1 outcome
   surface: SELECTED / NO_ACTION / NOT_DETERMINED** — no POLICY-BLOCKED and no
   SUPPRESSED trigger in V1 (classification vocabulary retained per
   R-008/PD-018 and R-004/PD-019 for future rules).
3. **Hard boundaries**: no DB access, no replay invocation, no store/recorder
   access, no safety/approval/permission/execution logic, no persistence writes
   (P5-09 recorder remains the recording boundary).
4. **Provenance**: `policyId · policyVersion · effectiveAt · evaluationAt` +
   `p4SnapshotRef` + P4 version tuple + rule refs + degradation refs (PD-012;
   decision 17).
5. **Determinism**: PD-010 (decision 18) — fixed rule ordering (layer →
   priority → ruleId), no wall clock in conditions, no randomness, timestamps as
   metadata only.
6. **Tests**: P5-03-RT task categories (policy identity/version, determinism,
   every outcome branch, NOT_DETERMINED semantics, malformed input, provenance,
   no legacy reuse, no hidden score/threshold, no BUY/SELL, no mutation, no
   DB/replay dependency, no P5-04/P5-05 leakage) + forbidden-term scan +
   regression (P5 / P4 / tsc).
7. **Downstream handoff**: result consumable by P5-04 (SELECTED + actionRef),
   P5-10 (record construction), P5-09 recorder, P5-07 replay — with **no frozen
   contract change**. No production wiring until a legitimate P5 decision
   pipeline exists (P5-03-RT task wiring rule).

---

## 21. Owner Approval & Freeze

### 21.1 Owner approval record

The owner approved P5-03 Policy V1 on **2026-08-17** with the following
18-point baseline (recorded verbatim from the owner instruction):

1. `policyId`: `pol-p5-v1`.
2. `policyVersion`: `v1`.
3. P5-03 V1 is a deterministic POLICY EVALUATOR only.
4. P5-03 does NOT implement: safety, approval, permission, execution, replay,
   persistence, scoring, ranking, temporal staleness engine, cooldown engine,
   new execution semantics.
5. ELIGIBLE != SELECTED.
6. Missing required input does NOT become NO_ACTION.
7. Required input unavailable / insufficient evidence: NOT_DETERMINED.
8. Out-of-scope policy evaluation: NOT_DETERMINED.
9. NO_ACTION means: policy evaluation completed successfully and no action was
   selected.
10. DEGRADED: evaluate only when the required policy inputs remain usable
    according to the approved V1 rules; otherwise NOT_DETERMINED.
11. NO_EVIDENCE: NOT_DETERMINED when required evidence is unavailable.
12. Selection: deterministic predicate-based selection only; no ranking; no
    scoring.
13. Direction: preserved as input/provenance where present; Direction must NOT
    itself become a decision outcome.
14. Numeric thresholds: none in V1 unless explicitly present in the approved
    ruleset; do not invent numeric thresholds.
15. Temporal semantics: no staleness horizons, cooldown durations, expiry
    calculations, rolling windows, or time-based suppression in V1.
16. Legacy P1 engine: MUST NOT be reused.
17. P5-03 provenance: policyId + policyVersion + ruleId must be explicit.
18. Determinism: same frozen input bundle + same policy version must produce
    the same policy result.

Authority: owner instruction "P5-03-POLICY-V1 OWNER APPROVAL + FREEZE"
(2026-08-17). Task scope: promote this document from OWNER REVIEW to FROZEN;
no P5-03-RT implementation; no upstream frozen-contract modification.

### 21.2 Approved ODR-1…ODR-14

| ODR | Topic | Approved value | Owner decision | Status |
|---|---|---|---|---|
| ODR-1 | Policy identity | `pol-p5-v1` / `v1`; effectiveAt = 2026-08-17 | 1–2 | FROZEN |
| ODR-2 | v1 action-type scope | MONITOR/REVIEW/INVESTIGATE/REDUCE_EXPOSURE/INCREASE_EXPOSURE/REBALANCE; EXECUTE/ESCALATE excluded | 3–4 | FROZEN |
| ODR-3 | Per-type eligibility | C-201…C-206 as proposed (snapshot usability per decisions 10–11) | 3 | FROZEN |
| ODR-4 | Out-of-scope outcome | NOT_DETERMINED | 8 | FROZEN |
| ODR-5 | Missing required parameter | NOT_DETERMINED | 6–7 | FROZEN |
| ODR-6 | DEGRADED routing | NOT_DETERMINED when inputs unusable; else evaluate | 10 | FROZEN |
| ODR-7 | NO_EVIDENCE routing | NOT_DETERMINED | 11 | FROZEN |
| ODR-8 | Staleness horizon | deferred — no temporal semantics in V1 | 15 | DEFERRED |
| ODR-9 | Duplicate suppression in v1 | deferred — not in V1 (no runtime) | 4/15 | DEFERRED |
| ODR-10 | Cooldown | deferred — not in V1 (no durations) | 15 | DEFERRED |
| ODR-11 | Selection model | deterministic predicate-based, single-candidate (C-501); multi-candidate deferred | 12 | FROZEN |
| ODR-12 | Reason-code vocabulary | proposed set approved (§4.1/§12) | document approval | FROZEN |
| ODR-13 | Parameter matrix | presence validation per AD-015; unavailable → NOT_DETERMINED; field enumeration at implementation (no invented fields) | 7 | FROZEN |
| ODR-14 | Direction role | C-201 "Direction ≠ UNKNOWN" precondition kept; never an outcome (R-006) | 13 | FROZEN |

### 21.3 Frozen V1 semantic boundary

- V1 is a **deterministic policy evaluator** producing, per evaluation:
  eligibility result, selection (single-candidate predicate), policy outcome
  (**SELECTED / NO_ACTION / NOT_DETERMINED**), policy provenance
  (policyId · policyVersion · ruleIds · effectiveAt · evaluationAt), and
  reasonCodes. **No POLICY-BLOCKED and no SUPPRESSED trigger in V1** — the
  classifications remain part of the frozen vocabulary (R-008/PD-018,
  R-004/PD-019) for future rules.
- NOT_DETERMINED covers: technical failure (R-001), input layer unavailable
  (R-002), out-of-scope type (C-102), missing required parameter (C-210),
  degraded/unusable inputs (C-301/C-602), no evidence (C-601).
- NO_ACTION means exactly: evaluation completed successfully and nothing was
  selected (R-003, decision 9).
- Selection: predicate-based, single-candidate, deterministic (C-501,
  decision 12). No ranking, no scoring, no thresholds (R-007, decisions 12/14).
- Direction: input/provenance only; never an outcome (R-006, decision 13).
- Eligibility ≠ selection; selection ≠ approval ≠ permission ≠ execution
  (PD-002/PD-003; decisions 3–5; P5-04 boundary).
- Provenance explicit (policyId + policyVersion + ruleIds, decision 17);
  determinism per PD-010 (decision 18).

### 21.4 Deferred items (confirmed by owner)

| Item | Status | Basis |
|---|---|---|
| Staleness horizons / temporal engine | DEFERRED | decision 15; PD-007 |
| Cooldown | DEFERRED | decision 15; PD-005 |
| Duplicate suppression (needs decision-history runtime) | DEFERRED | decisions 4/15; PD-006 |
| Multi-candidate selection / business-precedence property | DEFERRED | decision 12; PD-004 |
| REVIEW / INVESTIGATE routing for degraded/no-evidence | DEFERRED | decisions 10–11 |
| EXECUTE / ESCALATE action types | DEFERRED | AD-006/AD-007; DSD-001/002 |
| contentHash computation | PROVISIONAL (unchanged) | AD-014 |
| Safety / approval / permission / execution logic | OUT OF SCOPE | P5-04; decision 4 |

### 21.5 Explicit non-decisions

The freeze does NOT decide, promote, or implement: scores, thresholds,
ranking, BUY/SELL/LONG/SHORT/ORDER/TRADE/EXECUTION, cooldown durations,
staleness horizons, expiry calculations, rolling windows, execution semantics,
safety/approval/permission rules, new audit taxonomy, RBAC, emergency
override, P4-06 rules. Each remains OPEN/CANDIDATE/FUTURE/OUT OF SCOPE (§19)
and none affects V1 evaluation (G31).

### 21.6 Cross-document compatibility

No P5-02 → P5-09 document was modified by this freeze. Compatibility verified:
- P5-02 AD-004 outcome vocabulary preserved (SELECTED/NO_ACTION/BLOCKED/
  NOT_DETERMINED); AD-013/AD-018 identity untouched; AD-015 parameter rules
  (FROZEN) referenced, membership (PROVISIONAL) not invented.
- P5-03 PD-001…PD-019 unchanged; V1 rules restate/implement them.
- P5-04 boundary: no safety/approval/permission logic in V1 (decision 4;
  PD-015); SELECTED hands off to P5-04.
- P5-05/06/07/08/09: outcome + provenance flow unchanged; recording via P5-09
  recorder; replay via P5-07 (historical-over-live) — untouched.

### 21.7 Forbidden-term verification

Source scan of this document: every match of BUY/SELL/LONG/SHORT/ORDER/TRADE/
EXECUT/90-80-65/25-15-8/STRONG_WATCH/score/threshold is a prohibition, a
boundary statement, or a contract citation (§14, §19, §21.1/§21.5, self-audit)
— zero semantic usage. No hidden score, no hidden threshold, no hidden
decision engine.

### 21.8 Git boundary

This task changed **only** `docs/P5_Upgrade/P5-03_POLICY_RULESET_V1_CANDIDATE.md`
(owner approval + freeze promotion). ZERO production source changes. No commit.

### 21.9 Final freeze statement

**FROZEN / APPROVED FOR DOWNSTREAM** — P5-03 Policy V1 (`pol-p5-v1`/`v1`) is
frozen as the historical policy baseline. Actual P5-03-RT implementation is
the next task (implementation contract), with its own acceptance gates. The
freeze does not freeze or implement the P5-03 runtime, P5-04/05 runtimes, or
any downstream producer; those remain downstream dependencies.

---

## Self-Audit

| Gate | Result | Evidence | Required correction |
|---|---|---|---|
| G1 No contract modification | PASS | No P5-02→P5-09 file touched; this document only | none |
| G2 No legacy rule reuse | PASS | §14 excludes 90/80/65, 25/15/8, STRONG_WATCH/WATCH, rule-version.service.ts (PD-014/P5-01 §15) | none |
| G3 No numeric threshold invention | PASS | No numeric thresholds anywhere; ODR-8 confirmed deferred; §15 examples are semantic only | none |
| G4 No hidden score | PASS | O/R/C/A as-is only (§3.3/§12/R-007); no composite formulas | none |
| G5 No BUY/SELL | PASS | Forbidden-term scan of this document: matches are prohibition/boundary statements only (§14) | none |
| G6 P4 boundary preserved | PASS | §3 consumes only P5-03 §6 declared inputs; no P4 re-derivation; no second P4 engine | none |
| G7 Outcome vocabulary preserved | PASS | §5 uses only AD-004 (SELECTED/NO_ACTION/BLOCKED/NOT_DETERMINED) + PD-019 SUPPRESSED layer result + eligibility results; no new outcome | none |
| G8 NO_ACTION not used as absence fallback | PASS | R-003/R-005/R-002; §7 table; NO_ACTION only for completed-eval nothing-eligible (decision 9) | none |
| G9 NOT_DETERMINED semantics explicit | PASS | R-001/R-002/C-601/C-602/C-210/C-102: technical failure, unavailable inputs, no-evidence, degraded, out-of-scope — each distinct | none |
| G10 SUPPRESSED distinct | PASS | R-004/PD-019: layer result, never NO_ACTION, never a P5-02 outcome; no V1 trigger | none |
| G11 POLICY-BLOCKED distinct | PASS | R-008/PD-018: blockerReport.source=POLICY; never generic BLOCKED; no V1 trigger | none |
| G12 ELIGIBLE distinct from SELECTED | PASS | §8: independent rules, PD-002/PD-003; decision 5 | none |
| G13 Safety boundary preserved | PASS | §10: policy scope only; safety remains P5-04 (PD-015); decision 4 | none |
| G14 Approval boundary preserved | PASS | No approval semantics anywhere; P5-04 only | none |
| G15 Permission boundary preserved | PASS | No permission semantics; P5-04 only; ELIGIBLE ≠ permission | none |
| G16 Execution boundary preserved | PASS | No execution semantics; P5-03 is decision-support policy only (§2); decision 4 | none |
| G17 Deterministic precedence | PASS | §6 = PD-004 six-step; ruleId technical tie-break only | none |
| G18 Provenance | PASS | §12 = PD-012 exact refs; no latest/implicit substitution; decision 17 | none |
| G19 Identity semantics | PASS | §13 = AD-013/AD-018; decisionId ≠ idempotencyKey ≠ contentHash; no seq, no hash | none |
| G20 No production code | PASS | Documentation only; no source file modified | none |
| G21 Owner decisions explicitly identified and resolved | PASS | §16/§17 ODR-1…ODR-14 identified; all resolved by owner approval (§21.2) — no silent choice | none |
| G22 Documentation complete | PASS | 16 required sections + decision matrix (§17) + freeze candidate (§18) + deferred items (§19) + implementation consequence (§20) + owner approval & freeze (§21) + audit; status FROZEN / APPROVED FOR DOWNSTREAM | none |
| G23 V1 remains minimal | PASS | V1 scope = R-001…R-008 + FROZEN-APPROVED C-* rules only; ranking/scoring/cooldown/staleness engines explicitly deferred (§19); single-candidate selection FROZEN (ODR-11) | none |
| G24 No hidden business rule | PASS | every business rule is either CONTRACT (frozen clause) or FROZEN-APPROVED with an ODR reference (§21.2); none hidden | none |
| G25 No unresolved ambiguity in frozen candidate rules | PASS | no rule is both frozen and ambiguous; every approved rule carries an explicit §21.2 decision; R-* rules restate clauses with single outcomes | none |
| G26 Deferred items cannot affect V1 semantics | PASS | §19 items are excluded from V1 inputs/conditions by construction; V1 semantics defined solely by R-* + FROZEN-APPROVED C-* rules; C-301 status-based only (no temporal input) | none |
| G27 Every implementation rule has an owner-approved source | PASS | each implemented rule now traces to an owner-approved ODR + contract clause (§21.2) | none |
| G28 P5-03 downstream boundary preserved | PASS | no safety/approval/permission/execution logic anywhere (§2/§10/§16/§20.3); P5-04 boundary documented; SELECTED hands off to P5-04 only | none |
| G29 Every frozen V1 business rule has explicit Owner approval | PASS | every FROZEN C-* rule maps to an approved ODR + owner baseline decision (§21.1/§21.2); no rule frozen without an explicit owner decision | none |
| G30 No CANDIDATE business rule was silently promoted | PASS | every former CANDIDATE rule is either FROZEN with an explicit §21.2 decision (overrides documented: C-102/C-210/C-301/C-302/C-601/C-602 → NOT_DETERMINED) or DEFERRED (§19) | none |
| G31 Deferred semantics cannot affect V1 evaluation | PASS | deferred items excluded from V1 inputs/conditions by construction; layer 4 has no V1 trigger; C-301 status-based only; §21.4 | none |
| G32 V1 contains no hidden score/ranking/threshold | PASS | R-007/PD-014; decisions 12/14; forbidden-term scan (§21.7); no numeric values in V1 rules | none |
| G33 Missing/unknown/degraded input cannot silently become NO_ACTION | PASS | decisions 6–7, 10–11; R-005; §7 table; NOT_DETERMINED routing verified | none |
| G34 Direction cannot become a decision outcome by implication | PASS | decision 13; R-006; C-201 explicit-role precondition only; worked example 8 | none |
| G35 Temporal semantics are excluded from V1 | PASS | decision 15; ODR-8/10 deferred; C-301 status-based only; no durations/horizons/windows | none |
| G36 Policy/Safety/Approval/Permission/Execution boundaries remain intact | PASS | decision 4; §2/§10/§16; P5-04 boundary; no leakage in any V1 rule | none |
| G37 Frozen V1 is sufficient to implement P5-03-RT without inventing business semantics | PASS | every rule has an approved outcome + contract basis (§21.2); ODR-13 bounded by AD-015 + decision 7; no POLICY-BLOCKED/SUPPRESSED trigger to implement; next task = implementation contract | none |

---

## Final Status

**FROZEN / APPROVED FOR DOWNSTREAM** (owner-approved 2026-08-17 — §21)

Historical status: DRAFT — OWNER REVIEW REQUIRED (R1/R2), promoted to FROZEN by
explicit owner approval (R3). The owner approved P5-03 Policy V1 with the
18-point baseline (§21.1); all ODR-1…ODR-14 decisions are resolved (§21.2); all
freeze gates G1–G37 PASS (Self-Audit). The ruleset is the frozen policy
baseline for P5-03-RT.

Next step (NOT this task): P5-03-RT implementation (evaluator runtime) per the
boundary in `P5-03-RT_IMPLEMENTATION.md` §3 — a separate implementation task
with its own acceptance gates. No production code was changed by this freeze.

---

## Revision Record

| Rev | Date | Change |
|---|---|---|
| R1 | 2026-08-17 | Initial candidate ruleset for owner review (DRAFT — OWNER REVIEW REQUIRED). Sources verified directly: P5-03 contract (§6/§13/§14/§15/§22/§27/§33 PD-001…PD-019/§34), P5-02 (AD-004/AD-008/AD-013/AD-018/AD-024), P5-03-RT_RECON/IMPLEMENTATION, `src/lib/p4/types.ts:274-345`, `src/lib/p5/types.ts:25-62,201-222`. |
| R2 | 2026-08-17 | Refinement: added §17 Owner Decision Matrix (ODR-1…ODR-14 with proposal/contract-basis/alternatives/implementation-consequence/risk/status), §18 V1 Freeze Candidate, §19 Deferred Items, §20 Implementation Consequence; C-301 narrowed to status-based (temporal expiry deferred to ODR-8); self-audit extended with G23–G28. Status remains DRAFT — OWNER REVIEW REQUIRED. |
| R3 | 2026-08-17 | **Owner approval + freeze**: owner approved P5-03 Policy V1 with the 18-point baseline (§21.1). All ODR-1…ODR-14 resolved (§21.2): ODR-4/5/6/7 → NOT_DETERMINED (decisions 7/8/10/11, superseding earlier NO_ACTION/POLICY-BLOCKED/INELIGIBLE proposals); ODR-8/9/10 → DEFERRED (decisions 4/15); ODR-1/2/3/11/12/13/14 → FROZEN. Rules C-102/C-210/C-301/C-302/C-601/C-602 updated to approved outcomes; C-401/C-402/C-502 marked DEFERRED; worked examples 2/4/5/6 updated to approved semantics; V1 outcome surface = SELECTED / NO_ACTION / NOT_DETERMINED (no POLICY-BLOCKED or SUPPRESSED trigger in V1); §18 freeze candidate activated; §19 deferrals confirmed; §21 added (approval record, boundary, non-decisions, compatibility, forbidden-term verification, git boundary, freeze statement); gates G29–G37 added. Status: **FROZEN / APPROVED FOR DOWNSTREAM**. No production code. |
