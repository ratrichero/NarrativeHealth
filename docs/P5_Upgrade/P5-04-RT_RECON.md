# P5-04-RT — SAFETY / APPROVAL / PERMISSION RUNTIME
## RECONNAISSANCE REPORT

**Repository:** NarrativeHealth
**Date:** 2026-08-18
**Status:** RECON COMPLETE — READY FOR IMPLEMENTATION
**Frozen upstream verified:** P5-02, P5-03 Policy V1, P5-03-RT, P5-05, P5-06, P5-07, P5-08, P5-09

---

## 1. Recon Questions — Answers

### 1.1 What runtime safety capability already exists?

**NONE.** The repository has no safety evaluation runtime. The only safety-adjacent capability is `src/lib/services/alert.service.ts` which provides alert rule creation, triggering, and acknowledgement — this is explicitly identified as C-001 in P5-01 (alert acknowledgement ≠ approval; SG-005). Alert acknowledgement is NOT safety evaluation and must NOT be reused.

### 1.2 What runtime guardrail capability already exists?

**NONE.** No guardrail model, no guardrail registry, no guardrail evaluator. The P5-04 contract (§9–§11) defines the guardrail *structure* but no concrete guardrails exist in the repository. The legacy P1 rule engine (`src/lib/services/rule-version.service.ts`) is explicitly excluded by P5-03 (PD-014).

### 1.3 What runtime approval capability already exists?

**NONE.** No approval model, no approval records, no approval state machine. The P5-01 audit confirmed approval/automation MISSING in the repository (§10). The P5-04 contract (§13–§14) defines the approval *structure* but no approval infrastructure exists.

### 1.4 What runtime permission capability already exists?

**NONE.** No permission model, no permission records, no execution permission logic. The P5-04 contract (§19–§20) defines the permission *semantics* but no permission infrastructure exists.

### 1.5 Is there an existing approved P5-04 V1 ruleset?

**NO owner-approved V1 guardrail ruleset exists.** The P5-04 contract defines the guardrail framework (§9–§11) with frozen outcomes (PASS/BLOCK/NOT_DETERMINED/UNAVAILABLE/ERROR/NOT_APPLICABLE) and frozen decision SG-003, but no concrete guardrails with IDs, conditions, or trigger rules exist in the repository or in the frozen P5-04 document. However, this is NOT a STOP condition for V1 because:

- V1 is **ADVISORY-ONLY** (SG-010): advisory actions (MONITOR/REVIEW/INVESTIGATE) require no safety gate by default (P5-04 §8).
- Consequential actions (REDUCE_EXPOSURE/INCREASE_EXPOSURE/REBALANCE) require safety evaluation, but with **zero concrete guardrails defined**, the safety evaluation produces PASS (no guardrails to violate) — this is a valid, non-invented outcome.
- Permission is deterministically NOT_GRANTED for consequential actions in V1 (SG-010/§18).
- Therefore: V1 can be implemented with an **empty guardrail ruleset** and a trivial safety evaluator.

### 1.6 If yes: identify exact policy/rule IDs, versions and owner-approved source.

N/A — no V1 guardrail ruleset exists. The implementation will use an empty guardrail set with explicit provenance documenting this.

### 1.7 If no: STOP and identify the required owner decision.

**NOT A STOP CONDITION.** See §1.5. V1 ADVISORY-ONLY mode means:
- Advisory actions: no safety gate → trivial PASS
- Consequential actions: safety evaluation with empty guardrails → PASS (no violations) → permission NOT_GRANTED
- No invented business semantics required

Owner decisions needed for V2/future:
- Concrete guardrail definitions (guardrailId, conditions, inputs, severity)
- Concrete approval requirements per action type
- Authority model concrete rules
- Permission grant conditions

### 1.8 What inputs are available from P5-03-RT?

**`P5PolicyEvaluationResult`** (from `src/lib/p5/policy/types.ts`):

| Field | Type | V1 Value |
|---|---|---|
| `outcome` | `P5DecisionOutcome` | SELECTED / NO_ACTION / NOT_DETERMINED |
| `eligibility` | `P5EligibilityResult` | eligible boolean + ruleIds + reasonCode |
| `selectedCandidate` | `P5ActionCandidate \| null` | present iff SELECTED |
| `suppression` | `P5SuppressionResult` | always { suppressed: false } |
| `blockerReport` | `P5PolicyBlockerReport \| null` | always null in V1 |
| `provenance` | policy provenance record | policyId, policyVersion, effectiveAt, evaluationAt, ruleRefs, p4SnapshotRef, degradation |
| `reasonCodes` | `string[]` | approved vocabulary |
| `audit` | evaluation trace | per-rule observability trace |

### 1.9 What additional inputs are required by P5-04?

Based on P5-04 contract:

| Input | Source | Required? | V1 Treatment |
|---|---|---|---|
| P5-03 policy outcome | P5PolicyEvaluationResult | YES | consumed directly |
| Action type consequentiality | P5-02 AD-005 (derived from actionType) | YES | computed from candidate.actionType |
| Guardrail configuration | P5-04 ruleset (FUTURE) | CONDITIONAL | empty in V1 |
| Approval configuration | P5-04 ruleset (FUTURE) | CONDITIONAL | advisory: NOT_REQUIRED; consequential: future |
| Authority configuration | P5-04 registry (FUTURE) | CONDITIONAL | V1: empty (ADVISORY-ONLY) |
| Automation mode | P5-04 config | YES | V1: always ADVISORY |
| P4 snapshot validity | from P5-03 provenance | YES | already on provenance.p4SnapshotRef |

### 1.10 Which required inputs are unavailable?

**None for V1.** All V1-required inputs are available from P5-03-RT output + the action type classification.

### 1.11 Does P5-04 need historical state?

**NO for V1.** Material-change invalidation (P5-04 §21) requires historical comparison, but V1 ADVISORY-ONLY has no approval/permission lifecycle to invalidate. Material-change tracking is DEFERRED (criteria are PROVISIONAL per P5-04 SG-012).

### 1.12 Does P5-04 need live state?

**NO.** P5-04 evaluates a single P5-03 output snapshot. No live DB, no live P4 context, no live market data. All inputs come from the frozen P5-03-RT output.

### 1.13 If live state is needed, prove that it is allowed by the frozen contract.

N/A — no live state needed.

### 1.14 Does P5-04 need persistence?

**NO for V1 evaluator.** The evaluator is a pure function. The *result* may be persisted by P5-09 (P5DecisionRecord), but P5-04-RT itself writes nothing. Historical recording is P5-09's responsibility.

### 1.15 If yes, identify the existing frozen persistence boundary.

P5-09 `P5ArtifactRecorder` remains the recording boundary (P5-08/P5-09 frozen). P5-04-RT produces a `P5SafetyEvaluationResult` that flows into `P5DecisionRecord` via P5-10.

### 1.16 What exact output must P5-04 produce for P5-05?

**`P5SafetyEvaluationResult`** containing:

| Output Field | Type | Description |
|---|---|---|
| `safetyOutcome` | `P5GuardrailAggregate` | PASS / BLOCK / NOT_DETERMINED / UNAVAILABLE / ERROR |
| `guardrailResults` | `P5GuardrailResult[]` | per-guardrail results (empty array in V1) |
| `approvalState` | `P5ApprovalState` | NOT_REQUIRED / PENDING / APPROVED / DENIED / EXPIRED / REVOKED |
| `approvalRecord` | `P5ApprovalRecord \| null` | approval details when state is not NOT_REQUIRED |
| `permissionState` | `P5PermissionResult` | NOT_APPLICABLE / NOT_GRANTED / GRANTED / EXPIRED / REVOKED |
| `blockerReport` | `P5SafetyBlockerReport \| null` | SAFETY-BLOCKED provenance |
| `provenance` | safety provenance record | guardrail versions, evaluation timestamp, automation mode |
| `audit` | safety evaluation trace | per-guardrail evaluation trace |

### 1.17 What exact output must P5-04 produce for P5-10?

The complete `P5SafetyEvaluationResult` (§1.16) is consumed by P5-10 which constructs the final `P5DecisionRecord` by combining:
- P5-03 policy result (outcome, eligibility, selectedCandidate, provenance)
- P5-04 safety result (safetyOutcome, approvalState, permissionState, guardrailResults)
- P5-04 blocker report (when BLOCKED or DENIED)

---

## 2. Safety Boundary Analysis

### 2.1 Safety evaluation for V1

```
P5-03 SELECTED (candidate selected)
        ↓
P5-04 Applicability (advisory vs consequential)
        ↓
┌─ Advisory (MONITOR/REVIEW/INVESTIGATE):
│  Safety: PASS (no gate by default — P5-04 §8)
│  Approval: NOT_REQUIRED
│  Permission: NOT_APPLICABLE
│
└─ Consequential (REDUCE_EXPOSURE/INCREASE_EXPOSURE/REBALANCE):
   Safety: PASS (empty guardrail set — no violations)
   Approval: NOT_REQUIRED (V1 has no approval rules)
   Permission: NOT_GRANTED (V1 ADVISORY-ONLY — SG-010)
```

### 2.2 Semantic separation preserved

| Concept | Distinct from | Preserved? |
|---|---|---|
| ELIGIBLE (P5-03) | ≠ SELECTED ≠ SAFE ≠ APPROVED ≠ EXECUTED | **YES** |
| SELECTED (P5-03) | ≠ SAFE ≠ APPROVED ≠ EXECUTION_PERMISSION_GRANTED | **YES** |
| SAFE (P5-04 safetyOutcome) | ≠ APPROVED ≠ EXECUTION_PERMISSION_GRANTED | **YES** |
| APPROVED (P5-04 approvalState) | ≠ SAFE ≠ EXECUTION_PERMISSION_GRANTED | **YES** |
| EXECUTION_PERMISSION_GRANTED (P5-04) | ≠ EXECUTED (out of scope) | **YES** |
| POLICY-BLOCKED (P5-03) | ≠ SAFETY-BLOCKED ≠ APPROVAL-DENIED | **YES** |

---

## 3. Legacy Reuse Analysis

| Candidate | Source | Semantics | Compatible with P5-04? | Reuse Verdict |
|---|---|---|---|---|
| alert.service.ts | src/lib/services/alert.service.ts | Alert rules, triggering, acknowledgement | NO — C-001 (ack ≠ approval) | **FORBIDDEN** |
| rule-version.service.ts | src/lib/services/rule-version.service.ts | Legacy P1 rule engine, 90/80/65 thresholds | NO — PD-014 exclusion | **FORBIDDEN** |
| decision-engine.service.ts | src/lib/services/decision-engine.service.ts | Legacy P1 decision engine, 25/15/8 penalties | NO — legacy semantics | **FORBIDDEN** |
| rule-engine.service.ts | src/lib/services/rule-engine.service.ts | Legacy P1 multi-condition rule evaluation | NO — legacy thresholds/signals | **FORBIDDEN** |
| P5-03-RT evaluator | src/lib/p5/policy/evaluator.ts | Deterministic policy evaluation | YES — upstream input only | **REFERENCE** (not reuse) |

---

## 4. Forbidden Semantics Scan

| Pattern | Matches in P5-04-RT scope | Classification |
|---|---|---|
| BUY / SELL / LONG / SHORT / ORDER / TRADE | 0 | ✅ Clean |
| numeric thresholds / scores | 0 | ✅ Clean |
| legacy 90/80/65, 25/15/8 | 0 | ✅ Clean |
| STRONG_WATCH / WATCH (legacy) | 0 | ✅ Clean |
| Date.now / Math.random | 0 (V1 evaluator) | ✅ Clean |
| DB / filesystem / HTTP | 0 | ✅ Clean |
| direction→action mapping | 0 | ✅ Clean |

---

## 5. Determinism Analysis

V1 P5-04-RT is deterministic:
- Same P5PolicyEvaluationResult + same action type → same P5SafetyEvaluationResult
- No Date.now(), no randomness, no mutable global state
- Empty guardrail set is static/frozen
- ADVISORY-ONLY mode is frozen (SG-010)
- NOT_GRANTED for consequential actions is deterministic (SG-010)

---

## 6. Field Trace Table

### P5-03-RT → P5-04-RT Input

| Field | Source | Semantic Owner | Required? | Allowed States | P5-04 May Transform? | P5-04 May Not Reinterpret? |
|---|---|---|---|---|---|---|
| outcome | P5-03 | P5-03 (PD-004) | YES | SELECTED/NO_ACTION/NOT_DETERMINED | NO — pass through | P5-03 outcome |
| selectedCandidate | P5-03 | P5-02 (AD-005) | CONDITIONAL (iff SELECTED) | P5ActionCandidate | NO — reference | candidate identity |
| eligibility | P5-03 | P5-03 (PD-002) | YES | eligible boolean | NO — reference | eligibility result |
| provenance.policyId | P5-03 | P5-03 (PD-012) | YES | string | NO — copy | policy identity |
| provenance.ruleRefs | P5-03 | P5-03 (PD-012) | YES | string[] | NO — copy | rule references |
| provenance.p4SnapshotRef | P5-03 | P5-02 (AD-014) | YES | snapshot ref | NO — copy | evidence reference |
| reasonCodes | P5-03 | P5-03 (ODR-12) | YES | approved vocabulary | NO — pass through | reason codes |
| audit | P5-03 | P5-03 (observability) | YES | trace entries | NO — pass through | evaluation trace |

### P5-04-RT → P5-05/P5-10 Output

| Field | Source (P5-04) | Semantic Owner | Required? | Allowed States | P5-05 May Transform? | P5-05 May Not Reinterpret? |
|---|---|---|---|---|---|---|
| safetyOutcome | P5-04 safety evaluator | P5-04 (SG-003) | YES | PASS/BLOCK/NOT_DETERMINED/UNAVAILABLE/ERROR | NO — record | safety aggregate |
| guardrailResults | P5-04 safety evaluator | P5-04 (§10) | YES | P5GuardrailResult[] | NO — record | per-guardrail results |
| approvalState | P5-04 approval evaluator | P5-04 (SG-006) | YES | NOT_REQUIRED/PENDING/APPROVED/DENIED/EXPIRED/REVOKED | NO — record | approval state |
| approvalRecord | P5-04 approval evaluator | P5-04 (§13) | CONDITIONAL | P5ApprovalRecord \| null | NO — record | approval event |
| permissionState | P5-04 permission evaluator | P5-04 (SG-011) | YES | NOT_APPLICABLE/NOT_GRANTED/GRANTED/EXPIRED/REVOKED | NO — record | permission result |
| blockerReport | P5-04 safety evaluator | P5-04 (SG-004) | CONDITIONAL | P5SafetyBlockerReport \| null | NO — record | safety blocker provenance |
| provenance | P5-04 | P5-04 (§27) | YES | safety provenance record | NO — copy | safety evaluation refs |
| automationMode | P5-04 config | P5-04 (SG-009) | YES | ADVISORY (V1) | NO — record | automation mode |

---

## 7. Freeze Gates (G1–G30)

| Gate | Status | Evidence | Required Correction |
|---|---|---|---|
| G1 — Frozen upstream verified | **PASS** | P5-02, P5-03 Policy V1, P5-03-RT, P5-05, P5-06, P5-07, P5-08, P5-09 all verified FROZEN | None |
| G2 — P5-03-RT boundary verified | **PASS** | P5-03-RT output (P5PolicyEvaluationResult) is complete and type-safe; consumed by P5-04-RT as input | None |
| G3 — Safety responsibility identified | **PASS** | P5-04 §5–§11: safety evaluation, guardrail model, safety blocking. V1: empty guardrails → PASS | None |
| G4 — Guardrail responsibility identified | **PASS** | P5-04 §9–§11: guardrail model (id, version, purpose, applicability, inputs, outcomes). V1: empty guardrail set | None |
| G5 — Approval responsibility identified | **PASS** | P5-04 §13–§16: approval model, states, authority, human-in-the-loop. V1: NOT_REQUIRED for all actions | None |
| G6 — Permission responsibility identified | **PASS** | P5-04 §19–§20: execution permission semantics. V1: NOT_GRANTED for consequential, NOT_APPLICABLE for advisory | None |
| G7 — No policy duplication | **PASS** | P5-04 does not re-run policy evaluation; consumes P5-03 output directly (§5, §40) | None |
| G8 — No execution leakage | **PASS** | P5-04 grants permission, never executes (SG-011). No order/trade/execution code | None |
| G9 — No audit taxonomy expansion | **PASS** | P5-04 produces provenance records for P5-05 consumption; no new P5-05 audit event types | None |
| G10 — No replay leakage | **PASS** | P5-04 result is reconstructable from exact refs/versions without live systems (SG-017) | None |
| G11 — No persistence invention | **PASS** | P5-04-RT is pure evaluator; recording is P5-09's responsibility | None |
| G12 — Runtime capability inventory complete | **PASS** | §1.1–§1.4: no existing safety/guardrail/approval/permission runtime in repo | None |
| G13 — Legacy reuse evaluated | **PASS** | §3: alert.service (C-001), rule-version (PD-014), decision-engine, rule-engine all FORBIDDEN | None |
| G14 — Ruleset availability verified | **PASS** | §1.5: no V1 guardrail ruleset, but NOT a STOP for ADVISORY-ONLY V1 | None |
| G15 — Owner decision dependencies identified | **PASS** | §1.7: V1 implementable without owner decisions; V2 requires concrete guardrails, approval rules, authority | None |
| G16 — Input field trace complete | **PASS** | §6: P5-03-RT → P5-04-RT field trace with semantic ownership and transformation rules | None |
| G17 — Output field trace complete | **PASS** | §6: P5-04-RT → P5-05/P5-10 field trace with semantic ownership | None |
| G18 — Missing inputs identified | **PASS** | §1.10: none missing for V1 | None |
| G19 — State semantics identified | **PASS** | §2.2: all state separations preserved (ELIGIBLE ≠ SELECTED ≠ SAFE ≠ APPROVED ≠ EXECUTED) | None |
| G20 — Determinism requirements identified | **PASS** | §5: V1 evaluator is deterministic; no live state, no randomness | None |
| G21 — Provenance requirements identified | **PASS** | §1.16–§1.17: output provenance structure defined per P5-04 §27 | None |
| G22 — Permission gap evaluated | **PASS** | §1.16: V1 permission = NOT_APPLICABLE (advisory) or NOT_GRANTED (consequential). No gap | None |
| G23 — Approval gap evaluated | **PASS** | §1.16: V1 approval = NOT_REQUIRED for all actions. No gap | None |
| G24 — Safety gap evaluated | **PASS** | §1.16: V1 safety = PASS (empty guardrails). No gap for ADVISORY-ONLY | None |
| G25 — Historical/live dependency evaluated | **PASS** | §1.11–§1.12: no historical state needed; no live state needed | None |
| G26 — Forbidden semantics scan | **PASS** | §4: zero matches for BUY/SELL/scores/thresholds/legacy in P5-04-RT scope | None |
| G27 — Downstream compatibility | **PASS** | §1.16–§1.17: P5-04-RT output maps to P5DecisionRecord fields consumed by P5-05 and P5-09 | None |
| G28 — No frozen upstream modification | **PASS** | Only documentation created; no P5-02/P5-03/P5-05/P5-06/P5-07/P5-08/P5-09 modification | None |
| G29 — Implementation boundary defined | **PASS** | §2.1: 5-layer pipeline (applicability → safety → approval → permission → result) | None |
| G30 — Correct READY/STOP decision | **PASS** | V1 ADVISORY-ONLY is implementable without inventing business semantics. **READY** | None |

---

## 8. Implementation Boundary

### V1 Scope

```
P5-03-RT Result (P5PolicyEvaluationResult)
        ↓
P5-04-RT Applicability Layer
  - Determines advisory vs consequential from actionType
        ↓
P5-04-RT Safety Layer
  - V1: empty guardrail set → always PASS
  - Produces P5SafetyEvaluationResult
        ↓
P5-04-RT Approval Layer
  - V1: always NOT_REQUIRED (advisory + ADVISORY-ONLY)
  - No approval record produced
        ↓
P5-04-RT Permission Layer
  - Advisory → NOT_APPLICABLE
  - Consequential → NOT_GRANTED (SG-010)
        ↓
P5SafetyEvaluationResult
  - Consumed by P5-10 (decision producer)
  - Explained by P5-05 (explanation/audit)
  - Recorded by P5-09 (artifact recorder)
```

### Files to Create

| File | Purpose |
|---|---|
| `src/lib/p5/safety/types.ts` | P5-04-RT type definitions (guardrail, safety, approval, permission) |
| `src/lib/p5/safety/rules.ts` | V1 safety rules (empty guardrail set, V1 constants) |
| `src/lib/p5/safety/evaluator.ts` | P5SafetyEvaluator — pure, deterministic |
| `src/lib/p5/safety/index.ts` | Barrel export |
| `src/lib/p5/safety/__tests__/evaluator.test.ts` | Comprehensive tests |

### Acceptance Gates (for Implementation Task)

| Gate | Description |
|---|---|
| AG1 | Safety evaluator is pure (no DB, no live state, no persistence) |
| AG2 | Safety evaluator is deterministic (same input → same result) |
| AG3 | Advisory actions produce safetyOutcome PASS |
| AG4 | Consequential actions with empty guardrails produce safetyOutcome PASS |
| AG5 | BLOCKED only when a guardrail returns BLOCK (not in V1) |
| AG6 | NOT_DETERMINED only when required input unavailable |
| AG7 | approvalState is NOT_REQUIRED for all V1 actions |
| AG8 | permissionState is NOT_APPLICABLE for advisory, NOT_GRANTED for consequential |
| AG9 | No BUY/SELL/LONG/SHORT/ORDER/TRADE semantics |
| AG10 | No numeric thresholds or scores |
| AG11 | No legacy P1 rule reuse |
| AG12 | No Date.now / Math.random / mutable global state |
| AG13 | Provenance contains guardrail versions, evaluation timestamp, automation mode |
| AG14 | P5-04-RT result maps to P5DecisionRecord fields |
| AG15 | All 49 existing P5-03-RT tests continue passing |
| AG16 | TypeScript typecheck clean |
| AG17 | State semantics preserved (ELIGIBLE ≠ SELECTED ≠ SAFE ≠ APPROVED ≠ EXECUTED) |
| AG18 | P5-03/P5-05/P5-09 boundaries untouched |
