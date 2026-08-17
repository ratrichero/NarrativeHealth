# P5-03-RT — RECONNAISSANCE REPORT

**Repository:** https://github.com/ratrichero/NarrativeHealth
**Task:** P5-03-RT — Policy Evaluation Runtime v1 (reconnaissance phase)
**Status:** RECON COMPLETE → **IMPLEMENTATION DECISION: STOP** (see §10; STOP report in `P5-03-RT_IMPLEMENTATION.md`)

---

## 1. Runtime Capability Matrix

| Capability | Contract exists? | Runtime exists? | Reusable? |
|---|---|---|---|
| P3 evidence (`P3IntelligenceViewModel`) | FROZEN (P3) | YES (`src/lib/p3/**`) | feeds P4 |
| P4 interpretation (`P4DecisionSupportViewModel`) | FROZEN (P4-02) | YES (`getP4DecisionSupport`, `src/lib/p4/service.ts:133`) | feeds P5-03 |
| P5-03 policy evaluation | FROZEN (P5-03, semantic contract) | **NO** | — |
| P5-03 policy ruleset (concrete, approved) | **NO** (illustrative/CANDIDATE only) | **NO** | — |
| P5-04 safety/approval/permission | FROZEN (P5-04) | **NO** | — |
| P5-05 explanation/audit | FROZEN (P5-05) | **NO** | — |
| P5-09 recorder / P5-08 store / P5-07 replay | FROZEN | YES | downstream |

## 2. Frozen Contract Traceability (P4 → P5-03 → P5-04)

```
P4 output (P4DecisionSupportViewModel)
  → P5-03 inputs (P5-03 §6 Policy Input Model):
      Direction, O/R/C/A, signals, degradation (P4 contract, FROZEN)
      p4SnapshotRef (P5-02 AD-014)
      ActionCandidate (P5-02 candidate contract)
      declared context: cooldown/duplicate history, policy version (P5-03 §6.D)
  → Policy evaluation (P5-03):
      outcome (P5-02 AD-004: SELECTED / NO_ACTION / BLOCKED / NOT_DETERMINED)
      eligibility result (P5-03 §33; ELIGIBLE is a policy evaluation result, not a state)
      selection / suppression (PD-019)
      blocker (PD-018; POLICY source)
      policy provenance: policyId · policyVersion · effectiveAt · evaluationAt (P5-03 §32)
      deterministic tie-break by ruleId — technical only, NOT business priority (PD-004)
  → P5-03 output (PolicyEvaluationResult)
  → P5-04 input: selected decision + parameters (P5-04 consumes actionRef)
```

## 3. Available Input Matrix (runtime today)

| Input | Provided by | Status |
|---|---|---|
| narrativeIdentity, asOf, version, status | P4 runtime | AVAILABLE |
| direction, signals, O/R/C/A, explanation, evidence, degradation | P4 runtime | AVAILABLE |
| p4SnapshotRef identity components | P4 runtime (AD-014) | AVAILABLE |

## 4. Missing Input Matrix (blocking)

| Input | Required by | Status |
|---|---|---|
| **Concrete v1 policy ruleset (policyId + policyVersion + rules with ruleIds + conditions)** | P5-03 §6/§32/§34.3 | **MISSING — owner approval required** |
| ActionCandidate (P5-02 candidate contract) | P5-03 §6.C | MISSING as runtime producer (P5-03's own candidate assembly is implementation content) |
| Declared context (cooldown / duplicate history) | P5-03 §6.D | MISSING (policy-owned persistence; needs P5-03 implementation + P5-05 audit events) |
| Policy identity/version | P5-03 PD-012 | MISSING (no ruleset → no policyId/version) |

## 5. Policy Ruleset Evidence

- **P5-03 document is a semantic contract, not a ruleset.** Direct quotes (verified):
  - "Policy rule examples in this document are **illustrative (CANDIDATE)** and do not [constitute approved rules]" (P5-03 line ~229–230).
  - "…`snapshot Direction is not UNKNOWN` — illustrative, CANDIDATE" (line ~248).
  - Rules/provenance "PROVISIONAL, defined by P5-03 rule configuration with **owner + rationale**" (line ~345).
  - "engine error / missing rule set | NOT_DETERMINED | … **P5-03-IMPL decides**" (line ~939) — the contract delegates the concrete ruleset to implementation-time owner content.
- **No concrete ruleset in the repository:** grep for `policyId`/`policyVersion`/`ruleId` across `src/` matches only P5 record/artifact shapes (`types.ts`, replay, recorder) and **test fixtures using arbitrary ids** (`pol`/`v1`/`R1` in `action-read.test.ts`, `replay-engine.test.ts`, `pg-artifact-store.test.ts`, `p5-artifact-recorder.test.ts`, `p5-09-certification.test.ts`) — fixtures, not an approved business ruleset.
- **No policy evaluator exists:** `src/lib/p5/` contains `read/`, `record/`, `replay/`, `types.ts` only; no `policy*`/`evaluat*` files.
- **No ruleset seeds/configs/migrations:** `p5_policies` (P5-08) is the historical *artifact* table, not a ruleset store.

## 6. Legacy-Engine Exclusion Evidence

- `src/lib/services/rule-version.service.ts` — P1 rule engine (`recommendationThresholds` 90/80/65, STRONG_WATCH/WATCH signals). **EXCLUDED**:
  - P5-01 Contract & Gap Audit: "Numeric thresholds (legacy) … 90/80/65 … 25/15/8 … **EXISTS — LEGACY numeric; P5 must not reuse as P5 thresholds**"; "Policy engine | legacy numeric rules | MISSING | deterministic policy over qualitative states | **none (legacy not reused)** | P5-03".
  - P5-05 C-003: legacy recommendation language must not become P5 action semantics.
  - P5-02 AD-008: no BUY/SELL types/aliases/Direction mappings.
- **Consequence:** the legacy engine is not a valid ruleset source for P5-03-RT.

## 7. Identity Analysis (P5-02 AD-013 / AD-018 — FROZEN, no ambiguity)

| Identity | Contract meaning | P5-03-RT consequence |
|---|---|---|
| `decisionId` | identity of **one decision evaluation**; unique over (subject identity + p4 snapshot ref + policy version + action model version); same tuple ⇒ same decision (AD-018 §12.2) | Evaluator derives/records the tuple; decisionId is generated at the producer boundary per the tuple — **not** a hash-of-input convenience, **no** sequence unless the contract requires it (it does not) |
| `idempotencyKey` | separate conceptual command-layer identity (AD-013 §12.1, §17) | Owned by P5-03/05 command layer — **not** P5-03-RT evaluation identity |
| `contentHash` | snapshot payload integrity only (AD-014, PROVISIONAL) | **Never** decision identity; stays PROVISIONAL |
| `identity_key` (P5-08) | persisted exact-identity storage key | Storage mechanic, not semantic identity |

No ambiguity → no STOP on this axis.

## 8. Determinism Analysis (PD-010, PD-004)

- FROZEN: same (policy version + evaluation input + evaluation context) ⇒ same structured policy outcome (PD-010); final tie-break by `ruleId` as a **purely technical** key (PD-004) — no priority meaning.
- Implementation requirements once a ruleset exists: pure evaluation; no `Date.now()`/`Math.random()`/mutable global state/unordered iteration affecting output; timestamps isolated as metadata; declared context is part of the determinism inputs.
- These requirements are fully specified by the contract — no ambiguity.

## 9. Dependency Graph

```
P3 evidence (runtime) → P4 interpretation (runtime)
        ↓
[P5-03-RT: P5PolicyEvaluator]   ← BLOCKED: no owner-approved ruleset
        ↓
[P5-04-RT safety/approval/permission]   (future)
        ↓
[P5-05-RT explanation/audit]            (future)
        ↓
P5-10 producer → P5-09 recorder → P5-08 store → P5-07 replay
```

## 10. Implementation Decision

**STOP — BLOCKED BY MISSING OWNER-APPROVED P5-03 POLICY RULESET.**

Per the absolute rule: no production code may be written that invents business
policy. The P5-03 contract is FROZEN and fully ready; the P4 runtime inputs
are available; the legacy engine is excluded; but the **concrete v1 ruleset**
(policyId, policyVersion, rules with ruleIds + conditions + provenance,
approved by the owner as part of P5 project scope) **does not exist**.

No production code was changed. No ruleset was manufactured. Detailed STOP
report, unblock criteria, and proposed implementation boundary: see
`docs/P5_Upgrade/P5-03-RT_IMPLEMENTATION.md`.
