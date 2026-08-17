# P5-03-RT — POLICY EVALUATION RUNTIME v1

**Repository:** https://github.com/ratrichero/NarrativeHealth
**Task:** P5-03-RT — Policy Evaluation Runtime v1
**Status:** **STOP — BLOCKED BY MISSING OWNER-APPROVED P5-03 POLICY RULESET** (no production code written)
**Upstream contracts:** P5-02 … P5-09 FROZEN / APPROVED FOR DOWNSTREAM

---

## 1. STOP REPORT

Per the task's absolute rule — *DO NOT INVENT THE P5 POLICY* — implementation
is stopped. The frozen P5-03 contract defines the *semantic layer* of policy
evaluation, but the **concrete business ruleset required to evaluate against
does not exist anywhere in the repository or contracts**.

### 1.1 Exactly what is missing

A **concrete, owner-approved P5-03 v1 policy ruleset**:

- `policyId` (stable identity) and `policyVersion` (e.g. v1) — per P5-03 PD-012;
- actual rules, each with a `ruleId`, applicability (policy version / subject /
  time gate), conditions over the declared P5-03 inputs (Direction, O/R/C/A,
  signals, degradation, snapshot ref, candidate, declared context), and
  outcome mapping per the P5-03 §34.3 Outcome Matrix;
- eligibility / selection / suppression (PD-019) / blocker (PD-018) rule
  content, each with source, owner, and rationale (P5-03 line ~345: rules are
  "PROVISIONAL, defined by P5-03 rule configuration with owner + rationale");
- explicit owner approval that this ruleset is part of the P5 project scope.

### 1.2 Why P5-03 cannot be implemented honestly

An evaluator without an approved ruleset would have to **invent** eligibility
formulas, selection precedence, suppression durations, and blocker conditions
from P4 qualitative fields (direction / confidence / risk / actionability).
That is precisely what the task forbids:

- mapping P4 confidence/risk/actionability into P5 outcomes — forbidden;
- reusing legacy P1 thresholds (90/80/65, STRONG_WATCH/WATCH) — excluded by
  P5-01 reuse matrix and P5-05 C-003;
- emitting NO_ACTION/NOT_DETERMINED as shortcuts — forbidden.

The P5-03 contract's own rule examples are explicitly **illustrative
(CANDIDATE)**, not approved rules; test fixtures use arbitrary ids
(`pol`/`v1`/`R1`) that are not a business ruleset (see `P5-03-RT_RECON.md`
§5).

### 1.3 What is already ready

- P5-02 / P5-03 / P5-04 / P5-05 contracts — FROZEN, internally consistent;
- P4 runtime inputs — AVAILABLE (`P4DecisionSupportViewModel`, AD-014
  snapshot ref components);
- P5 type vocabulary — AVAILABLE (`P5DecisionOutcome`, `P5BlockerReport`,
  provenance record shapes in `src/lib/p5/types.ts`);
- Frozen downstream — AVAILABLE (P5-09 recorder, P5-08 store, P5-07 replay);
- Determinism (PD-010) and identity (AD-013/AD-018) requirements — fully
  specified, no ambiguity (recon §7/§8).

### 1.4 Owner decision required

**Approve a P5-03 v1 policy ruleset** — the business content — as an explicit
P5-scope deliverable. The agent can draft a *proposed* ruleset structure for
owner review, but the **business conditions themselves are owner content** and
must be approved before any evaluator logic is written.

## 2. Unblock Criteria

P5-03-RT implementation may begin only when **all** hold:

1. A ruleset exists in the repository with an explicit `policyId` +
   `policyVersion` and is **marked owner-approved** (in the P5-03 doc, a
   dedicated ruleset document, or an approved config with provenance).
2. Rules reference only the declared P5-03 inputs (P5-03 §6) — no P4
   re-interpretation, no legacy thresholds.
3. Each rule has `ruleId`, source, owner, and rationale (PD-004/PD-012,
   P5-03 line ~345).
4. Outcome mapping conforms to the P5-03 §34.3 Outcome Matrix; SUPPRESSED /
   POLICY-BLOCKED / NOT_DETERMINED / SELECTED / NO_ACTION remain distinct.
5. Determinism inputs (policy version + evaluation input + declared context)
   are explicit (PD-010).

## 3. Proposed Implementation Boundary (once ruleset is supplied)

```
P4DecisionSupportViewModel
        ↓
P5PolicyEvaluationInput        (declared inputs per P5-03 §6)
        ↓
P5PolicyEvaluator              (pure, deterministic — PD-010)
        ↓
P5PolicyEvaluationResult       (outcome + eligibility + selection + suppression
                                + blocker + policy provenance)
        ↓
P5-04 boundary                 (downstream; consumes selected decision + parameters)
```

Evaluator hard boundaries (as specified by the task):

- **NO** DB access, replay invocation, `HistoricalArtifactStore`, P5 recorder;
- **NO** safety evaluation, approval, permission checks, explanation/audit
  generation outside its frozen responsibility, execution;
- **NO** new audit event types (no POLICY_EVALUATED / ARTIFACT_RECORDED /
  DECISION_FINALIZED — frozen P5-05 taxonomy only);
- **NO** legacy P1 reuse, scores, thresholds, BUY/SELL, new ActionType/
  DecisionOutcome;
- decisionId semantics per AD-013/AD-018 (evaluation tuple; idempotencyKey and
  contentHash separate); timestamps isolated as metadata (PD-010).

Persistence: P5-03-RT writes nothing; historical recording remains exclusively
`P5DecisionRecord → P5ArtifactRecorder` (P5-09). No production wiring until
P5-04/05 runtime exists and a legitimate P5 decision pipeline boundary exists.

## 4. Acceptance Gates (evaluated at implementation; N/A now)

| Gate | Status | Evidence |
|---|---|---|
| G1 Frozen P5-03 contract preserved | N/A (blocked) | contract verified FROZEN (recon §2) |
| G2 Owner-approved ruleset verified | **FAIL** | no ruleset exists (recon §5) |
| G3 No legacy P1 rule reuse | N/A | exclusion verified (recon §6) |
| G4 P4 boundary preserved | N/A | P4 = declared inputs only (recon §2) |
| G5–G8 Exact policy identity/version/vocabulary | N/A | requires ruleset |
| G9–G13 Eligibility/selection/suppression/determinism/identity | N/A | contract fully specified (recon §7/§8) |
| G10 No fabricated NO_ACTION | N/A | design rule |
| G14–G15 idempotencyKey/contentHash separation | N/A | AD-013/018 (recon §7) |
| G16–G21 No safety/approval/permission/execution/replay/persistence logic | N/A | design boundary (§3) |
| G22–G24 No score/threshold/BUY-SELL/new audit vocabulary | N/A | forbidden by design |
| G25–G27 No mutation; tests; typecheck | N/A | no code |
| G28–G30 P4/P5 regression; git boundary | N/A | no code |
| G31–G32 No upstream amendment; scope discipline | **PASS** | nothing modified; STOP honored |

## 5. Revision Record

| Rev | Date | Change |
|---|---|---|
| R1 | 2026-08-17 | Recon complete (`P5-03-RT_RECON.md`) → STOP: missing owner-approved policy ruleset. No production code written. |
