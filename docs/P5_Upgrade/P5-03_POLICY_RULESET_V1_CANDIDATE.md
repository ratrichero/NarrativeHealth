# P5-03 POLICY RULESET V1 — CANDIDATE

**Document status: DRAFT — OWNER REVIEW REQUIRED** (NOT FROZEN)

| Field | Value |
|---|---|
| Policy ID | `pol-p5-v1` **(PROPOSED — OWNER DECISION REQUIRED; final value assigned by owner)** |
| Policy Version | `v1` **(PROPOSED — OWNER DECISION REQUIRED)** |
| Status | `OWNER_REVIEW` (per P5-03-RT STOP report: ruleset is the sole remaining blocker) |
| Depends on | P5-02 → P5-09 FROZEN; P5-03 semantic contract FROZEN; P5-03-RT_RECON / P5-03-RT_IMPLEMENTATION |
| Task scope | Definition only. **No production code. No evaluator. No frozen-contract modification.** |

This document is a **candidate** ruleset prepared for owner review. Every business
rule that cannot be derived from the frozen contracts is explicitly labeled
**OWNER DECISION REQUIRED (ODR)** and enumerated in §16. Nothing in this document
becomes effective until the owner approves it.

---

## 1. Policy Identity

| Identity element | Value / status |
|---|---|
| policyId | `pol-p5-v1` — **PROPOSED** (final assignment is an owner decision; the P5-03 ABSOLUTE RULE forbids the agent from silently choosing policy IDs) |
| policyVersion | `v1` — **PROPOSED** |
| effectiveAt | **ODR** — owner supplies the effective timestamp; no value invented (PD-012) |
| evaluationAt | recorded per evaluation (PD-012) — metadata, excluded from semantic determinism (PD-010) |
| status | `OWNER_REVIEW` |
| Rule statuses used in inventory | `CONTRACT` (rule is a direct restatement of a FROZEN contract clause — no business judgment) vs `CANDIDATE` (proposed business rule — requires owner approval) |

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
| Cooldown / duplicate history | P5-03 policy-owned declared context (§6.D) | suppression inputs | OPTIONAL — **runtime does not exist yet** (dependency; see §9/§16-ODR-7) | declared context only |
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
  judgment; not subject to owner approval (they already are the contract).
- **CANDIDATE rules (C-…)**: proposed v1 business rules. Each is **OWNER
  DECISION REQUIRED** until approved; alternatives are listed where the contract
  permits more than one outcome.

Rule field semantics per P5-03 §9 (ruleId, policyVersion, purpose, scope,
inputs, condition, outcome, priority, applicability/layer, reasonCode,
effectiveAt/expiresAt, owner, status). Precedence follows PD-004 (§6).

### 4.1 CONTRACT rules (frozen semantics restated — not approvable business content)

| ruleId | Layer | Condition | Outcome | Reason code (proposed) | Contract source |
|---|---|---|---|---|---|
| R-001 | all | policy evaluation technical failure (engine error, missing rule set) | **NOT_DETERMINED** + failure reason — never NO_ACTION | `POLICY_EVALUATION_FAILURE` | PD-009; §34.7 |
| R-002 | all | input layer unavailable / P4 context absent (status ERROR or missing VM) | **NOT_DETERMINED** + availability reason — never NO_ACTION | `POLICY_INPUT_UNAVAILABLE` | PD-008; §27; §34.7 |
| R-003 | 5 (selection) | evaluation **completed**, no candidate eligible | **NO_ACTION** + policy ref (explicit "nothing eligible" — not a shortcut, not a failure) | `NO_ELIGIBLE_ACTION` | PD-003; §34.3 |
| R-004 | 4 (suppression) | candidate suppressed (cooldown/dedup) | **SUPPRESSED** layer result, `suppressed: true` + reason; no new decision; **never NO_ACTION** | `SUPPRESSED` | PD-019; §17; §34.3 |
| R-005 | all | any UNKNOWN / DEGRADED / NULL input | **never → NO_ACTION** (hard gate); must route per §7 | — | PD-008; §13; P5-02 AD-019 |
| R-006 | all | any rule condition on Direction | **no direct action mapping** (`Direction = POSITIVE → INCREASE_EXPOSURE` forbidden) | — | §11; PD-014; P5-02 AD-008 |
| R-007 | all | any rule condition on O/R/C/A | **as-is only**; no composite score, no weighted formula, no numeric threshold | — | §12; PD-014; P5-02 AD-024 |
| R-008 | 3 (blocking) | a blocking rule fires | **BLOCKED** with `blockerReport.source = POLICY` + rule refs (POLICY-BLOCKED, never a generic BLOCKED) | `POLICY_BLOCKED` | PD-018; §34.3; P5-02 AD-011 |

### 4.2 CANDIDATE rules (v1 business content — OWNER DECISION REQUIRED)

Proposed starting point: adopt the P5-03 §34.2 illustrative eligibility matrix
as the v1 eligibility basis (it is the contract's own CANDIDATE proposal),
plus §13's degraded-context direction. Each row below is a separate owner
decision.

**Layer 1 — Applicability**

| ruleId | Priority | Condition | Outcome | Required inputs | Rationale | Downstream effect |
|---|---|---|---|---|---|---|
| C-101 | 1 | candidate `actionType` ∈ approved v1 scope AND subject resolves (narrativeId present) | proceed to Layer 2 | narrativeIdentity, actionType | scope gate (PD-004 step 1) | — |
| C-102 | 1 | candidate `actionType` ∉ approved v1 scope | **ODR** — contract does not fix this case; candidates: (a) NO_ACTION (nothing eligible), (b) NOT_DETERMINED (policy cannot determine), (c) POLICY-BLOCKED (unsupported type). Proposal: (a) | actionType | §15 layer 1; no frozen default | P5-05 audit |

**Layer 2 — Eligibility (from §34.2 illustrative matrix, CANDIDATE)**

| ruleId | Priority | Condition | Outcome | Required inputs | Downstream effect |
|---|---|---|---|---|---|
| C-201 | 2 | type MONITOR; P4 snapshot present; Direction ≠ UNKNOWN | ELIGIBLE (proposed) | status, direction | → Layer 5 |
| C-202 | 2 | type REVIEW; P4 snapshot present | ELIGIBLE (proposed) | status | → Layer 5 (degraded context may route here, §13) |
| C-203 | 2 | type INVESTIGATE; target ref resolves (signal or degradation exists) | ELIGIBLE (proposed) | signals, degradation | → Layer 5 |
| C-204 | 2 | type REDUCE_EXPOSURE; snapshot usable (status ≠ DEGRADED/NULL); parameters complete; no active equivalent decision | ELIGIBLE (proposed) | status, parameters, dedup state | → Layer 3/5 |
| C-205 | 2 | type INCREASE_EXPOSURE; same preconditions as C-204 | ELIGIBLE (proposed) | status, parameters, dedup state | → Layer 3/5 |
| C-206 | 2 | type REBALANCE; same as C-204 + subject set valid | ELIGIBLE (proposed) | status, parameters, subject | → Layer 3/5 |
| C-210 | 2 | any consequential type; required parameter (per AD-015 parameter matrix for the type) missing | **ODR**: INELIGIBLE (→ NO_ACTION after completed eval) vs POLICY-BLOCKED — contract §22 permits "INELIGIBLE / BLOCKED". Proposal: POLICY-BLOCKED for consequential, INELIGIBLE otherwise | parameters | §22; P5-05 |

**Layer 3 — Blocking**

| ruleId | Priority | Condition | Outcome | Required inputs | Downstream effect |
|---|---|---|---|---|---|
| C-301 | 3 | consequential candidate; P4 snapshot status DEGRADED or NO_EVIDENCE (evidence unusable — **status-based only in v1; temporal expiry deferred, see ODR-8**) | POLICY-BLOCKED (proposed per §13: "consequential candidates are ineligible/blocked") | status, degradation | blockerReport.source=POLICY → P5-05 |
| C-302 | 3 | unsupported action type or parameter violation on a consequential candidate | POLICY-BLOCKED (proposed; ODR on exact violations list) | actionType, parameters | P5-05 |

**Layer 4 — Suppression (both PROVISIONAL in contract — inclusion in v1 is ODR)**

| ruleId | Priority | Condition | Outcome | Required inputs | Downstream effect |
|---|---|---|---|---|---|
| C-401 | 4 | equivalent ACTIVE decision exists: subject + actionType + p4SnapshotRef + policyVersion + active decisionState (PD-006 equivalence) | SUPPRESSED (layer result, no new decision) | decision history (**runtime missing — dependency**) | P5-05 |
| C-402 | 4 | cooldown: SELECTED decision of class subject × actionType within period (**duration OPEN — none invented, PD-005**) | SUPPRESSED (layer result) | decision history + owner-supplied duration | P5-05 |

**Layer 5 — Selection**

| ruleId | Priority | Condition | Outcome | Required inputs | Downstream effect |
|---|---|---|---|---|---|
| C-501 | 5 | exactly one eligible, non-suppressed candidate | **SELECTED** with `selectedActionRef` = candidate | eligibility + suppression results | P5-04 receives SELECTED + selectedActionRef (P5-04 §2) |
| C-502 | 5 | multiple eligible, non-suppressed candidates | **ODR**: needs an explicit versioned business-precedence property (PD-004 step 5) or ruleId tie-break. Proposal for v1: **single-candidate model — multi-candidate deferred** | eligibility results | P5-04 |

**Cross-layer — UNKNOWN / DEGRADED routing (per PD-008, §13)**

| ruleId | Priority | Condition | Outcome | Required inputs | Downstream effect |
|---|---|---|---|---|---|
| C-601 | 3 | P4 status NO_EVIDENCE | consequential: NOT_DETERMINED (proposal); advisory (REVIEW/INVESTIGATE): routing is **ODR** (NOT_DETERMINED vs REVIEW vs INVESTIGATE per type) | status | P5-05 |
| C-602 | 3 | P4 status DEGRADED | consequential: **ODR** — POLICY-BLOCKED (proposal per §13) vs NOT_DETERMINED; advisory review paths may remain eligible (§13) | status, degradation | P5-05 |

---

## 5. Outcome Mapping

Only outcomes permitted by the frozen P5-03 contract (P5-02 AD-004 vocabulary +
P5-03 layer results) are used. **No new outcome is introduced.**

| P5-03 layer result / outcome | Meaning (contract) | Produced by | Becomes in `P5DecisionRecord` (`src/lib/p5/types.ts`) |
|---|---|---|---|
| SELECTED | evaluation completed, candidate selected (PD-003) | Layer 5 | `outcome = "SELECTED"`, `actionId` created (AD-013) |
| NO_ACTION | evaluation completed, nothing eligible — explicit, with policy ref (PD-003) | Layer 5 (post-eligibility) | `outcome = "NO_ACTION"` |
| POLICY-BLOCKED | blocking rule fired; `blockerReport.source = POLICY` (PD-018) | Layer 3 | `outcome = "BLOCKED"` + `blockerReport.source = "POLICY"` |
| NOT_DETERMINED | could not determine eligibility (degraded/unusable/technical failure) (PD-008/009) | Layers 2–3 / engine | `outcome = "NOT_DETERMINED"` |
| SUPPRESSED | layer-level suppression result; no new decision; never NO_ACTION (PD-019) | Layer 4 | `suppressed = true`; **NOT** a P5-02 outcome |
| ELIGIBLE | policy result: candidate may proceed — not a state, not permission (PD-002) | Layer 2 | eligibility result (recorded fact) |
| INELIGIBLE | policy result: does not proceed | Layer 2 | feeds NO_ACTION (completed eval) or BLOCKED per rule |

Forbidden mappings (all contract-mandated): UNKNOWN→NO_ACTION, DEGRADED→NO_ACTION,
NULL→NO_ACTION, ABSENT→NO_ACTION, suppressed→NO_ACTION, technical failure→NO_ACTION,
policy-unavailable→NO_ACTION, NOT_DETERMINED-as-generic-error. NO_ACTION is only
the completed-evaluation "nothing eligible" case (R-003).

---

## 6. Precedence

Frozen PD-004 six-step precedence, applied deterministically; **no ambiguity, no
"latest wins", no implicit priority, no numeric priority scores**:

1. **Applicability** (C-101/C-102) — policy version / subject / time gate.
2. **Eligibility** (C-201…C-210) — candidate preconditions.
3. **Explicit blocking** (C-301/C-302) — blocking beats selection.
4. **Explicit suppression** (C-401/C-402, if approved) — suppression beats
   selection; suppressed candidates never reach Layer 5.
5. **Explicit business precedence** — only if the policy defines a versioned
   business-precedence property; **v1 proposal: absent → skip** (ODR if
   multi-candidate is adopted).
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
| P4 status NO_EVIDENCE | consequential → NOT_DETERMINED (proposal); advisory routing per type (C-601) | outcome set FROZEN (PD-008); per-type routing rule-level | **yes (C-601)** |
| P4 status DEGRADED | consequential → POLICY-BLOCKED (proposal) vs NOT_DETERMINED (C-602); advisory review paths may remain eligible (§13) | direction FROZEN (§13); exact rules rule-level | **yes (C-602)** |
| Direction UNKNOWN | MONITOR eligibility: "snapshot present AND Direction ≠ UNKNOWN" (C-201 proposal) | illustrative only (§34.2 CANDIDATE) | **yes** |
| O/R/C/A = UNKNOWN | consumed as-is; no score; routing per rule condition | as-is FROZEN (§12); per-rule use rule-level | per rule |
| Missing required evidence | consequential → blocked/ineligible (C-301); advisory may remain eligible | §13 direction FROZEN; horizons ODR | **yes (C-301 horizon)** |
| Unknown/unrecognized input value | treated as unusable input → NOT_DETERMINED path (R-002) | PD-008 | no |

Distinction preserved always: **"no eligible action"** (completed evaluation →
NO_ACTION, R-003) ≠ **"could not determine eligibility"** (→ NOT_DETERMINED).

---

## 8. Eligibility vs Selection

Frozen PD-002/PD-003 semantics, restated as ruleset invariants:

- **ELIGIBLE ≠ SELECTED.** Eligibility (Layer 2) is per-candidate; selection
  (Layer 5) is the deterministic choice among eligible, non-suppressed
  candidates. A candidate may be ELIGIBLE and still not selected (multi-candidate
  case) or still BLOCKED downstream at P5-04.
- Eligibility rules (C-201…C-210) and selection rules (C-501/C-502) are stated
  **independently**; no eligibility rule implies selection, and no selection rule
  confers eligibility.
- ELIGIBLE is never an execution permission (PD-002; P5-02 AD-010).

---

## 9. Suppression

Policy-level suppression only (Layer 4). Never mixed with safety blocking or
approval denial (P5-04 semantics).

- **Outcome:** SUPPRESSED layer result, `suppressed: true`, suppression reason,
  no new decision; existing decision stands; **never NO_ACTION** (PD-019,
  R-004).
- **v1 proposal:** duplicate suppression (C-401, PD-006 equivalence: subject +
  actionType + p4SnapshotRef + policyVersion + active decisionState). Cooldown
  (C-402, PD-005) excluded from v1 unless the owner supplies explicit durations
  (none invented).
- **Dependency:** both suppression inputs require a **decision-history runtime
  that does not exist today** (P5-03 §6.D context). If the owner approves
  C-401 for v1, the decision-history availability is a downstream dependency to
  resolve at P5-03-RT implementation; if not available, suppression reports
  input-unavailable per R-002 semantics — never a fabricated SUPPRESSED.

---

## 10. Policy Block

Policy-level blockers only (Layer 3). No safety/approval semantics.

- **Outcome:** BLOCKED with `blockerReport.source = POLICY` + rule refs —
  POLICY-BLOCKED (PD-018, R-008). P5-02 AD-004 BLOCKED vocabulary preserved;
  P5-04's SAFETY-BLOCKED / APPROVAL-DENIED never collapse into it.
- **v1 proposal:** consequential candidates on stale/invalid/degraded evidence
  (C-301) and unsupported types / parameter violations on consequential
  candidates (C-302). Exact trigger conditions and the staleness horizon are
  owner decisions.
- A POLICY-BLOCKED result passes to P5-05 as a recorded fact; P5-03 does not
  decide "retry" or any execution semantics.

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
   are recorded (PD-012) but cannot alter rule outcomes. Any rule that depends
   on time must consume an explicit declared temporal-context input (e.g.,
   evidence age for C-301), not a wall clock.
4. Precedence is the frozen six-step PD-004 order; ruleId tie-break is purely
   technical (R-006 in §6).
5. Rule iteration order is fixed by (layer, priority, ruleId) — a declared,
   stable ordering.

---

## 12. Provenance

Every evaluation result must preserve (PD-012, P5-03 §32/§34.8):

- `policyId`, `policyVersion`, `effectiveAt`, `evaluationAt`;
- `ruleId`/`ruleIds` that fired (eligibility, blocking, suppression, selection);
- input provenance: `p4SnapshotRef` (AD-014) + P4 version tuple
  (algorithm/semantic/signal-catalog versions) + degradation refs when DEGRADED;
- reasonCode for audit/explanation (proposed vocabulary: `POLICY_EVALUATION_FAILURE`,
  `POLICY_INPUT_UNAVAILABLE`, `NO_ELIGIBLE_ACTION`, `SUPPRESSED`,
  `POLICY_BLOCKED`, `NOT_ELIGIBLE`, `SELECTED` — **vocabulary approval is ODR**);
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
is deterministic given its inputs (PD-010).

**Example 1 — SELECTED (single eligible candidate, C-501)**
Input: P4 VM status `OK`, direction `MIXED`, O/R/C/A `MEDIUM/HIGH/MEDIUM/MEDIUM`,
signals `[]`, snapshot usable; candidate `REDUCE_EXPOSURE` with complete
parameters; no active equivalent decision.
Layers: applicability OK → eligibility OK (C-204) → no blocking → no suppression
→ exactly one eligible → **SELECTED**, `selectedActionRef` = candidate. Downstream:
P5-04 receives SELECTED + actionRef. (Direction `MIXED` is *not* the trigger; the
trigger is input usability + candidate preconditions — no direction mapping.)

**Example 2 — NO_ACTION (completed evaluation, nothing eligible, R-003)**
Input: candidate `REDUCE_EXPOSURE` with a required parameter missing (per the
approved AD-015 matrix for the type, e.g. absent target identity).
Layer 2 → INELIGIBLE; evaluation completes with zero eligible candidates →
**NO_ACTION** + policy ref, reason `NO_ELIGIBLE_ACTION`. This is the *only*
NO_ACTION path in v1.

**Example 3 — NOT_DETERMINED (unusable input, R-002)**
Input: P4 VM absent / status `ERROR` for the subject.
Policy cannot determine eligibility → **NOT_DETERMINED** + `POLICY_INPUT_UNAVAILABLE`.
Never NO_ACTION.

**Example 4 — NOT_DETERMINED (no evidence, C-601 consequential proposal)**
Input: P4 VM status `NO_EVIDENCE`; consequential candidate `INCREASE_EXPOSURE`.
→ **NOT_DETERMINED** (proposal under C-601; routing is ODR). Advisory
`REVIEW`/`INVESTIGATE` may remain eligible per §13 (C-202/C-203).

**Example 5 — POLICY-BLOCKED (degraded consequential, C-301 proposal)**
Input: P4 VM status `DEGRADED` (degradation `EVIDENCE_CONFLICT`); candidate
`REBALANCE`.
→ **BLOCKED** with `blockerReport.source = POLICY`, rule ref C-301, reason
`POLICY_BLOCKED`. (If owner instead approves NOT_DETERMINED for this case, the
same input yields NOT_DETERMINED — the two are never conflated.)

**Example 6 — SUPPRESSED (duplicate, C-401 proposal)**
Input: an equivalent ACTIVE decision exists (subject + actionType +
p4SnapshotRef + policyVersion + active decisionState).
→ **SUPPRESSED** layer result, `suppressed: true`, no new decision; the existing
decision stands. Never NO_ACTION (R-004).

**Example 7 — Determinism (PD-010)**
The exact input set of Example 1 evaluated twice with the same policyId/version
and declared context yields byte-identical structured results, including ruleIds
fired and reasonCodes. Changing only `evaluationAt` (metadata) does not change
the result.

**Example 8 — No direction mapping (R-006)**
`direction = POSITIVE` alone never yields a selection; `direction = NEGATIVE`
alone never yields REDUCE_EXPOSURE. Direction participates only in explicit
semantic-role rules (e.g., C-201's "Direction ≠ UNKNOWN" precondition).

---

## 16. Owner Decisions Required

Every business decision that cannot be derived from the frozen contracts.
**No value below is chosen by the agent; each awaits owner approval.**

| # | Decision | Options / proposal | Blocked by |
|---|---|---|---|
| ODR-1 | `policyId` / `policyVersion` final values (+ `effectiveAt`) | proposal `pol-p5-v1` / `v1`; owner assigns final | PD-012 |
| ODR-2 | v1 action-type scope (P5-02 taxonomy is PROVISIONAL; DSD-001 membership confirmed at P5-03 owner review) | which of MONITOR/REVIEW/INVESTIGATE/REDUCE_EXPOSURE/INCREASE_EXPOSURE/REBALANCE are in v1; EXECUTE/ESCALATE are not v1 types (AD-006/AD-007) | P5-03 §10 DSD-001 |
| ODR-3 | Per-type eligibility preconditions (adopt C-201…C-206 from §34.2, amend, or replace) | adopt as proposed | §34.2 (illustrative) |
| ODR-4 | Out-of-scope action type outcome (C-102) | (a) NO_ACTION, (b) NOT_DETERMINED, (c) POLICY-BLOCKED — proposal (a) | §15 layer 1 |
| ODR-5 | Missing-required-parameter handling (C-210) | INELIGIBLE vs POLICY-BLOCKED — proposal: POLICY-BLOCKED for consequential, INELIGIBLE otherwise | P5-03 §22 ("INELIGIBLE / BLOCKED") |
| ODR-6 | DEGRADED consequential routing (C-602) | POLICY-BLOCKED vs NOT_DETERMINED — proposal: POLICY-BLOCKED | §13 ("consequential candidates are ineligible/blocked") |
| ODR-7 | NO_EVIDENCE advisory routing (C-601) | NOT_DETERMINED vs REVIEW vs INVESTIGATE per type | PD-008 ("or REVIEW/INVESTIGATE per rules") |
| ODR-8 | Staleness/expiry horizon values (C-301; PD-007 PROVISIONAL) | concrete horizon(s) for consequential evidence | PD-007 ("horizon values OPEN") |
| ODR-9 | Duplicate suppression in v1 (C-401; PD-006 PROVISIONAL) + decision-history runtime dependency | include/exclude; dependency: no decision-history runtime exists today | PD-006 |
| ODR-10 | Cooldown in v1 (C-402; PD-005 PROVISIONAL) | exclude (no durations) vs owner-supplied durations | PD-005 ("no default durations invented") |
| ODR-11 | Selection model (C-502) | v1 single-candidate (proposal) vs multi-candidate + versioned business-precedence property | PD-004 step 5 |
| ODR-12 | Reason-code vocabulary (proposed set in §4.1/§12) | approve proposed set or amend | P5-03 §9 reasonCode |
| ODR-13 | Parameter matrix per type (AD-015) referenced by C-204…C-206/C-210 | owner confirms the required-parameter set per v1 type | P5-02 AD-015 |
| ODR-14 | Direction participation in eligibility (C-201 "Direction ≠ UNKNOWN") | keep / drop / restate | P5-03 §11 ("illustrative, CANDIDATE") |

---

## 17. Owner Decision Matrix

Detailed form of §16. Each decision lists: topic, current proposal, contract
basis, alternatives, implementation consequence, risk if incorrectly chosen,
status. **No item below is FROZEN.** Status vocabulary: `OWNER APPROVAL
REQUIRED` / `PROPOSED` / `OPEN / DEFERRED`.

### ODR-1 — Policy identity (policyId / policyVersion / effectiveAt)

| Field | Value |
|---|---|
| Decision topic | final policy identity values for v1 |
| Current proposal | `pol-p5-v1` / `v1`; `effectiveAt` supplied by owner |
| Contract basis | PD-012 (policyId·policyVersion·effectiveAt·evaluationAt); §34.8 version matrix |
| Alternatives | any owner-assigned id/version scheme |
| Impl. consequence | constant identity stamped into every evaluation result + provenance; immutable per published version |
| Risk if wrong | identity collisions or silent re-attribution; breaks audit (P5-05) and replay (P5-07) traceability |
| Status | **OWNER APPROVAL REQUIRED** |

### ODR-2 — v1 action-type scope

| Field | Value |
|---|---|
| Decision topic | which ActionTypes v1 policy covers |
| Current proposal | advisory MONITOR/REVIEW/INVESTIGATE + consequential REDUCE_EXPOSURE/INCREASE_EXPOSURE/REBALANCE candidate for v1; EXECUTE/ESCALATE excluded (AD-006/007) |
| Contract basis | P5-03 §10 (taxonomy PROVISIONAL; DSD-001 membership confirmed at P5-03 owner review); P5-02 AD-005/006/007 |
| Alternatives | smaller subset (e.g., advisory-only v1); specific type list chosen by owner |
| Impl. consequence | eligibility rules C-201…C-206 instantiated only for approved types; unsupported types → C-102 path |
| Risk if wrong | policy applied to types without approved semantics (scope creep), or required coverage missing |
| Status | **OWNER APPROVAL REQUIRED** |

### ODR-3 — Per-type eligibility preconditions

| Field | Value |
|---|---|
| Decision topic | exact eligibility conditions per approved v1 type |
| Current proposal | adopt C-201…C-206 from §34.2 illustrative matrix as-is |
| Contract basis | §34.2 (illustrative, CANDIDATE); PD-002 eligibility semantics |
| Alternatives | amend conditions per type; replace with different preconditions |
| Impl. consequence | evaluator implements exactly the approved condition predicates |
| Risk if wrong | eligibility does not match business intent; hard to change after v1 published (version immutability) |
| Status | **OWNER APPROVAL REQUIRED** |

### ODR-4 — Out-of-scope action type outcome (C-102)

| Field | Value |
|---|---|
| Decision topic | outcome when a candidate's actionType is outside approved v1 scope |
| Current proposal | (a) **NO_ACTION** — evaluation completed, nothing eligible under applicable policy |
| Contract basis | §15 layer 1 applicability gate; PD-003 (NO_ACTION = completed eval, nothing eligible). Contract does not fix this case explicitly |
| Alternatives | (b) NOT_DETERMINED — policy cannot determine; (c) POLICY-BLOCKED — unsupported type |
| Impl. consequence | determines which outcome an out-of-scope candidate produces |
| Risk if wrong | NO_ACTION hides a genuine scope gap; NOT_DETERMINED masks a completed determination |
| Status | **OWNER APPROVAL REQUIRED** |

### ODR-5 — Missing-required-parameter handling (C-210)

| Field | Value |
|---|---|
| Decision topic | outcome when a required parameter (AD-015) is absent |
| Current proposal | **POLICY-BLOCKED** for consequential types; **INELIGIBLE** (→ NO_ACTION after completed eval) for advisory types |
| Contract basis | P5-03 §22 parameter validation ("INELIGIBLE / BLOCKED"); P5-02 AD-015 |
| Alternatives | all INELIGIBLE; all POLICY-BLOCKED |
| Impl. consequence | two distinct result paths (blocker report vs no-eligible) |
| Risk if wrong | consequential missing-parameter collapsed into NO_ACTION loses POLICY blocker provenance (PD-018) |
| Status | **OWNER APPROVAL REQUIRED** |

### ODR-6 — DEGRADED consequential routing (C-602)

| Field | Value |
|---|---|
| Decision topic | outcome for a consequential candidate when P4 status is DEGRADED |
| Current proposal | **POLICY-BLOCKED** (per §13 "consequential candidates are ineligible/blocked") |
| Contract basis | §13 direction (FROZEN); PD-008 outcome set |
| Alternatives | NOT_DETERMINED |
| Impl. consequence | blocker vs not-determined distinction in audit and replay |
| Risk if wrong | NOT_DETERMINED shows "could not determine" instead of an explicit block — audit ambiguity |
| Status | **OWNER APPROVAL REQUIRED** |

### ODR-7 — NO_EVIDENCE routing (C-601)

| Field | Value |
|---|---|
| Decision topic | outcome when P4 status is NO_EVIDENCE, per type |
| Current proposal | consequential → **NOT_DETERMINED**; advisory per-type routing (NOT_DETERMINED vs REVIEW vs INVESTIGATE) chosen by owner |
| Contract basis | PD-008 (outcomes include NOT_DETERMINED / REVIEW / INVESTIGATE "per rules") |
| Alternatives | route NO_EVIDENCE to REVIEW/INVESTIGATE for advisory types |
| Impl. consequence | determines which outcome a no-evidence evaluation yields per type |
| Risk if wrong | routing to REVIEW without approved review semantics invents a downstream obligation |
| Status | **OWNER APPROVAL REQUIRED** |

### ODR-8 — Staleness horizon (C-301)

| Field | Value |
|---|---|
| Decision topic | whether v1 computes temporal evidence staleness, and with what horizon |
| Current proposal | **DEFER temporal staleness from V1** (V1 simplicity rule): C-301 v1 condition is status-based only (DEGRADED / NO_EVIDENCE ⇒ evidence unusable); no age computation, no horizon value |
| Contract basis | PD-007 (horizon values OPEN — PROVISIONAL); §13 stale/invalid evidence direction |
| Alternatives | owner supplies explicit horizon(s) + declared temporal-context input for v1 |
| Impl. consequence | v1 evaluator has no time-dependent staleness logic; no temporal engine needed |
| Risk if wrong | introducing unapproved durations = invented threshold (PD-014); deferring is safe (PD-007 PROVISIONAL) |
| Status | **OPEN / DEFERRED** (recommended) — owner may override |

### ODR-9 — Duplicate suppression in v1 (C-401)

| Field | Value |
|---|---|
| Decision topic | whether v1 includes duplicate suppression (PD-006 equivalence) |
| Current proposal | **DEFER from V1** — no decision-history runtime exists; PD-006 PROVISIONAL |
| Contract basis | PD-006 (PROVISIONAL); P5-03 §6.D declared-context dependency |
| Alternatives | include in v1, contingent on a decision-history runtime being provided |
| Impl. consequence | v1 evaluator needs no suppression input; layer 4 has no triggers in v1 (R-004 path dormant) |
| Risk if wrong | including without a runtime = fabricated suppression inputs; excluding is safe (PROVISIONAL) |
| Status | **OPEN / DEFERRED** (recommended) — owner may override |

### ODR-10 — Cooldown in v1 (C-402)

| Field | Value |
|---|---|
| Decision topic | whether v1 includes cooldown suppression |
| Current proposal | **DEFER from V1** — no durations (PD-005: "no default durations invented") |
| Contract basis | PD-005 (PROVISIONAL); §16 cooldown (OPEN) |
| Alternatives | owner supplies explicit durations + decision history |
| Impl. consequence | no cooldown logic in v1 at all |
| Risk if wrong | invented durations = invented threshold (PD-014) |
| Status | **OPEN / DEFERRED** (recommended) — owner may override |

### ODR-11 — Selection model (C-502)

| Field | Value |
|---|---|
| Decision topic | how selection resolves eligible candidates |
| Current proposal | **v1 single-candidate model** — exactly one eligible, non-suppressed candidate ⇒ SELECTED; multi-candidate deferred |
| Contract basis | PD-004 (step 5 business precedence only if versioned; step 6 ruleId tie-break); §8 selection |
| Alternatives | multi-candidate + versioned business-precedence property |
| Impl. consequence | v1 selection is trivially deterministic; no business-precedence property needed |
| Risk if wrong | multi-candidate without a precedence property → ambiguous selection (PD-004 violation) |
| Status | **OWNER APPROVAL REQUIRED** |

### ODR-12 — Reason-code vocabulary

| Field | Value |
|---|---|
| Decision topic | the machine reason-code vocabulary stamped into results |
| Current proposal | approve proposed set: `POLICY_EVALUATION_FAILURE`, `POLICY_INPUT_UNAVAILABLE`, `NO_ELIGIBLE_ACTION`, `SUPPRESSED`, `POLICY_BLOCKED`, `NOT_ELIGIBLE`, `SELECTED` |
| Contract basis | §9 rule-structure reasonCode field; PD-012 provenance |
| Alternatives | amend / extend vocabulary |
| Impl. consequence | stable machine vocabulary used by audit (P5-05) and replay (P5-07) |
| Risk if wrong | unstable vocabulary breaks audit/explanation consumers and replay comparisons |
| Status | **OWNER APPROVAL REQUIRED** |

### ODR-13 — Parameter matrix per type (AD-015)

| Field | Value |
|---|---|
| Decision topic | the required-parameter set per approved v1 type |
| Current proposal | owner confirms per-type required-parameter set (referenced by C-204…C-206/C-210) |
| Contract basis | P5-02 AD-015 parameter matrix; P5-03 §22 |
| Alternatives | minimal universal set (e.g., subject/target identity only) |
| Impl. consequence | evaluator validates presence of exactly the approved parameters |
| Risk if wrong | missing parameter checks → eligibility on incomplete candidates |
| Status | **OWNER APPROVAL REQUIRED** |

### ODR-14 — Direction participation (C-201)

| Field | Value |
|---|---|
| Decision topic | whether/how P4 Direction participates in v1 conditions |
| Current proposal | keep "Direction ≠ UNKNOWN" as MONITOR eligibility precondition (explicit semantic role, not a mapping) |
| Contract basis | §11 ("illustrative, CANDIDATE"); R-006 / PD-014 (no direct direction→action mapping — untouched by this decision) |
| Alternatives | drop direction from all conditions; restate differently |
| Impl. consequence | direction participates in exactly one explicit-role condition |
| Risk if wrong | using direction as a trigger drifts toward a forbidden direction→action mapping (§11) |
| Status | **OWNER APPROVAL REQUIRED** |

---

## 18. V1 Freeze Candidate

Items that **would become FROZEN only after explicit owner approval** of the
corresponding ODR. Nothing in this table is frozen today.

| Item | Would freeze | Basis | ODR |
|---|---|---|---|
| Policy identity (final values) | `pol-p5-v1` / `v1` / `effectiveAt` fixed for v1 | PD-012 | ODR-1 |
| v1 action-type scope | approved type set fixed for v1; EXECUTE/ESCALATE excluded | §10 DSD-001; AD-005/006/007 | ODR-2 |
| Eligibility preconditions | C-201…C-206 frozen in approved form | §34.2 → approved | ODR-3 |
| Out-of-scope outcome | C-102 outcome fixed (proposal: NO_ACTION) | §15; PD-003 | ODR-4 |
| Missing-parameter handling | C-210 fixed (proposal: POLICY-BLOCKED consequential / INELIGIBLE advisory) | §22; AD-015 | ODR-5 |
| DEGRADED consequential routing | C-602 fixed (proposal: POLICY-BLOCKED) | §13; PD-008 | ODR-6 |
| NO_EVIDENCE routing | C-601 fixed per approved type routing | PD-008 | ODR-7 |
| Selection model | C-501/C-502 fixed (proposal: single-candidate v1) | PD-004 | ODR-11 |
| Reason-code vocabulary | proposed set fixed | §9; PD-012 | ODR-12 |
| Parameter matrix | per-type required-parameter set fixed | AD-015; §22 | ODR-13 |
| Direction role | C-201 "Direction ≠ UNKNOWN" fixed (if kept) | §11 | ODR-14 |

Explicitly **not** in the freeze candidate (remain OPEN / DEFERRED): ODR-8
(staleness horizons), ODR-9 (duplicate suppression runtime), ODR-10 (cooldown
durations).

---

## 19. Deferred Items

Items deliberately kept out of V1 so that V1 remains the smallest policy that
honestly satisfies the frozen P5-03 contract. **None of these affect V1
semantics** (G26).

| Class | Item | Status | Reason / basis |
|---|---|---|---|
| OPEN | Staleness horizon values | OPEN | PD-007 ("horizon values OPEN"); temporal engine deferred |
| OPEN | Duplicate suppression runtime (decision history) | OPEN | PD-006 PROVISIONAL; no runtime exists |
| OPEN | Cooldown durations | OPEN | PD-005 ("no default durations invented") |
| CANDIDATE | EXECUTE / ESCALATE action types | CANDIDATE | AD-006/AD-007; DSD-001/DSD-002 |
| CANDIDATE | REVIEW / INVESTIGATE routing specifics | CANDIDATE | PD-008 "per rules"; awaiting ODR-7 |
| CANDIDATE | Multi-candidate selection + business-precedence property | CANDIDATE | PD-004 step 5 |
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

What P5-03-RT will implement **once the owner approves the V1 ruleset** (ODR-1…
ODR-7, ODR-11…ODR-14 approved; ODR-8/9/10 confirmed deferred). Per the boundary
in `P5-03-RT_IMPLEMENTATION.md` §3:

1. **Pure, deterministic evaluator** (`P5PolicyEvaluator`): input = declared P4
   VM fields (§3.1) + `ActionCandidate` (P5-02) + declared context (v1: none for
   suppression/temporal) + policy refs; output = `P5PolicyEvaluationResult`
   (eligibility result, selection, policy outcome, `blockerReport` (POLICY
   source), suppression layer result, provenance, reasonCodes, ruleIds fired).
2. **Exact rule set**: R-001…R-008 (frozen semantics, restated) + the approved
   C-* candidate rules. No other rules.
3. **Hard boundaries**: no DB access, no replay invocation, no store/recorder
   access, no safety/approval/permission/execution logic, no persistence writes
   (P5-09 recorder remains the recording boundary).
4. **Provenance**: `policyId · policyVersion · effectiveAt · evaluationAt` +
   `p4SnapshotRef` + P4 version tuple + rule refs + degradation refs (PD-012).
5. **Determinism**: PD-010 — fixed rule ordering (layer → priority → ruleId),
   no wall clock in conditions, no randomness, timestamps as metadata only.
6. **Tests**: P5-03-RT task categories (policy identity/version, determinism,
   every outcome branch, suppression/block/not-determined semantics,
   malformed input, provenance, no legacy reuse, no hidden score/threshold, no
   BUY/SELL, no mutation, no DB/replay dependency, no P5-04/P5-05 leakage) +
   forbidden-term scan + regression (P5 / P4 / tsc).
7. **Downstream handoff**: result consumable by P5-04 (SELECTED + actionRef),
   P5-10 (record construction), P5-09 recorder, P5-07 replay — with **no frozen
   contract change**. No production wiring until a legitimate P5 decision
   pipeline exists (P5-03-RT task wiring rule).

---

## Self-Audit

| Gate | Result | Evidence | Required correction |
|---|---|---|---|
| G1 No contract modification | PASS | No P5-02→P5-09 file touched; this document only | none |
| G2 No legacy rule reuse | PASS | §14 excludes 90/80/65, 25/15/8, STRONG_WATCH/WATCH, rule-version.service.ts (PD-014/P5-01 §15) | none |
| G3 No numeric threshold invention | PASS | No numeric thresholds anywhere; §16 ODR-8 leaves horizons to owner; §15 examples are semantic only | none |
| G4 No hidden score | PASS | O/R/C/A as-is only (§3.3/§12/R-007); no composite formulas | none |
| G5 No BUY/SELL | PASS | Forbidden-term scan of this document: matches are prohibition/boundary statements only (§14) | none |
| G6 P4 boundary preserved | PASS | §3 consumes only P5-03 §6 declared inputs; no P4 re-derivation; no second P4 engine | none |
| G7 Outcome vocabulary preserved | PASS | §5 uses only AD-004 (SELECTED/NO_ACTION/BLOCKED/NOT_DETERMINED) + PD-019 SUPPRESSED layer result + eligibility results | none |
| G8 NO_ACTION not used as absence fallback | PASS | R-003/R-005/R-002; §7 table; NO_ACTION only for completed-eval nothing-eligible | none |
| G9 NOT_DETERMINED semantics explicit | PASS | R-001/R-002/C-601/C-602: technical failure, unavailable inputs, no-evidence, degraded — each distinct | none |
| G10 SUPPRESSED distinct | PASS | R-004/PD-019: layer result, never NO_ACTION, never a P5-02 outcome | none |
| G11 POLICY-BLOCKED distinct | PASS | R-008/PD-018: blockerReport.source=POLICY; never generic BLOCKED | none |
| G12 ELIGIBLE distinct from SELECTED | PASS | §8: independent rules, PD-002/PD-003 | none |
| G13 Safety boundary preserved | PASS | §10: policy blockers only; safety/approval remain P5-04 (PD-015) | none |
| G14 Approval boundary preserved | PASS | No approval semantics anywhere; P5-04 only | none |
| G15 Permission boundary preserved | PASS | No permission semantics; P5-04 only; ELIGIBLE ≠ permission | none |
| G16 Execution boundary preserved | PASS | No execution semantics; P5-03 is decision-support policy only (§2) | none |
| G17 Deterministic precedence | PASS | §6 = PD-004 six-step; ruleId technical tie-break only | none |
| G18 Provenance | PASS | §12 = PD-012 exact refs; no latest/implicit substitution | none |
| G19 Identity semantics | PASS | §13 = AD-013/AD-018; decisionId ≠ idempotencyKey ≠ contentHash; no seq, no hash | none |
| G20 No production code | PASS | Documentation only; no source file modified | none |
| G21 Owner decisions explicitly identified | PASS | §16 ODR-1…ODR-14; no silent choice | none |
| G22 Documentation complete | PASS | 16 required sections + decision matrix (§17) + freeze candidate (§18) + deferred items (§19) + implementation consequence (§20) + audit; status DRAFT — OWNER REVIEW REQUIRED | none |
| G23 V1 remains minimal | PASS | V1 scope = R-001…R-008 + approved C-* rules only; ranking/scoring/cooldown/staleness engines explicitly deferred (§19); single-candidate selection proposed (ODR-11) | none |
| G24 No hidden business rule | PASS | every business rule is a labeled CANDIDATE with an ODR reference; CONTRACT rules (R-*) restate frozen clauses only | none |
| G25 No unresolved ambiguity in frozen candidate rules | PASS | no rule is both frozen and ambiguous; every CANDIDATE rule carries an explicit ODR marker — ambiguity resolution IS the owner decision (§17); R-* rules restate clauses with single outcomes | none |
| G26 Deferred items cannot affect V1 semantics | PASS | §19 items are excluded from V1 inputs/conditions by construction; V1 semantics defined solely by R-* + approved C-* rules; C-301 narrowed to status-based (no temporal input) | none |
| G27 Every implementation rule has an owner-approved source | OWNER DECISION REQUIRED | each implemented rule traces to an approved ODR + contract clause; until owner approves ODR-1…ODR-14, no rule is implementation-ready | owner approval of §17 matrix (or explicit amendments) |
| G28 P5-03 downstream boundary preserved | PASS | no safety/approval/permission/execution logic anywhere (§2/§10/§16/§20.3); P5-04 boundary documented; SELECTED hands off to P5-04 only | none |

---

## Final Status

**DRAFT — OWNER REVIEW REQUIRED**

This candidate ruleset is NOT approved and NOT frozen. It becomes effective only
when the owner:
1. reviews and approves/adjusts the §16/§17 owner decisions (ODR-1…ODR-14,
detailed in the §17 Owner Decision Matrix, including confirmation that
ODR-8/9/10 remain deferred), and
2. explicitly approves the ruleset as the P5-03 v1 policy baseline.

After approval, the next step is P5-03-RT implementation (evaluator runtime)
per the boundary in `P5-03-RT_IMPLEMENTATION.md` §3 — a separate task. This
task performs no implementation.

---

## Revision Record

| Rev | Date | Change |
|---|---|---|
| R1 | 2026-08-17 | Initial candidate ruleset for owner review (DRAFT — OWNER REVIEW REQUIRED). Sources verified directly: P5-03 contract (§6/§13/§14/§15/§22/§27/§33 PD-001…PD-019/§34), P5-02 (AD-004/AD-008/AD-013/AD-018/AD-024), P5-03-RT_RECON/IMPLEMENTATION, `src/lib/p4/types.ts:274-345`, `src/lib/p5/types.ts:25-62,201-222`. |
| R2 | 2026-08-17 | Refinement: added §17 Owner Decision Matrix (ODR-1…ODR-14 with proposal/contract-basis/alternatives/implementation-consequence/risk/status), §18 V1 Freeze Candidate, §19 Deferred Items, §20 Implementation Consequence; C-301 narrowed to status-based (temporal expiry deferred to ODR-8); self-audit extended with G23–G28. Status remains DRAFT — OWNER REVIEW REQUIRED. |
