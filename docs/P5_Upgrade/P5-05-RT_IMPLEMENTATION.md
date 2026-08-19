# P5-05-RT — Explanation / Audit Runtime v1 — Implementation Record

**Repository:** NarrativeHealth
**Document status:** IMPLEMENTATION COMPLETE — READY FOR OWNER REVIEW
**Created:** 2026-08-18
**Frozen upstream:** P5-05 contract (FROZEN / APPROVED FOR DOWNSTREAM)

---

## 1. Status

**COMPLETE** — All 37 acceptance gates (G1–G37) PASS.

Zero production code changes to frozen upstream (P5-03-RT, P5-04-RT, P5-02, P5-03, P5-04, P5-05 contract, P5-06, P5-07, P5-08, P5-09).

---

## 2. Files Created

| File | Purpose |
|---|---|
| `src/lib/p5/explanation/types.ts` | P5-05-RT types: explanation slots, audit events, provenance, input/output |
| `src/lib/p5/explanation/evaluator.ts` | Pure deterministic explanation/audit evaluator |
| `src/lib/p5/explanation/index.ts` | Barrel export |
| `src/lib/p5/explanation/__tests__/evaluator.test.ts` | 34 comprehensive tests (E01–E32 + source scans) |
| `docs/P5_Upgrade/P5-05-RT_IMPLEMENTATION.md` | This document |

---

## 3. Architecture

```
P4 Decision Support (input)
    ↓
P5-03 PolicyEvaluator (policy result)
    ↓
P5-04 SafetyEvaluator (safety result)
    ↓
P5-05 ExplanationEvaluator ← THIS MODULE
    ↓
P5-10 DecisionProducer (future)
    ↓
P5-09 ArtifactRecorder
    ↓
P5-08 Persistence
```

---

## 4. Input / Output Contract

### Input: `P5ExplanationInput`

| Field | Type | Source |
|---|---|---|
| `decisionId` | `string` | P5-02 AD-013 |
| `candidateId` | `string \| null` | P5-02 AD-013 |
| `actionId` | `string \| null` | P5-02 AD-013 (iff SELECTED) |
| `subject` | `{ narrativeId: number }` | P5-02 |
| `policyResult` | `P5PolicyEvaluationResult` | P5-03-RT |
| `safetyResult` | `P5SafetyEvaluationResult` | P5-04-RT |
| `decisionState` | `P5DecisionState` | P5-02 AD-022 |

### Output: `P5ExplanationResult`

| Field | Type | Contract |
|---|---|---|
| `explanation` | `P5ExplanationRecord` | P5-05 §6 explanation slots |
| `provenance` | `P5ProvenanceRecord` | P5-05 §10 provenance model |
| `auditEvents` | `P5ExplanationAuditEvent[]` | P5-05 §16-§17 audit events |
| `audit` | trace entries | Observability (not contract) |

---

## 5. V1 Explanation Behavior

### Explanation Slots (§6)

| Slot | Construction | Source |
|---|---|---|
| WHAT | `Decision outcome is {outcome} with action type {type}` | policyResult.outcome |
| WHY | Rule refs + reason codes from P5-03 | policyResult.provenance |
| BASED ON | P4 snapshot ref (narrativeId, asOf, status) | policyResult.provenance.p4SnapshotRef |
| POLICY | `Policy {id}@{version}` | policyResult.provenance |
| SAFETY | `Safety: {aggregate} ({count} guardrails)` | safetyResult |
| APPROVAL | `Approval: {state}` | safetyResult.approvalState |
| CURRENT STATE | `Decision: {state}, Approval: {state}, Permission: {state}` | all upstream |
| WHAT DID NOT HAPPEN | Outcome-dependent alternatives | policyResult.outcome |

### No Orphan Claims

Every explanation clause maps to a recorded fact. No inference, no fabrication, no LLM.

---

## 6. V1 Audit Events

### Frozen Vocabulary (§16.1)

V1 produces only:

| Event | When | V1 fires? |
|---|---|---|
| `DecisionProduced` | Every completed evaluation | YES |
| `DecisionSuppressed` | Suppression applied | YES (if suppressed) |
| `DecisionSuperseded` | Material change | NO (deferred) |
| `DecisionExpired` | Horizon passed | NO (deferred) |
| `DecisionCancelled` | Authority withdrawal | NO (deferred) |
| `ApprovalRequired` | Approval determined | NO (V1 NOT_REQUIRED) |
| `ApprovalGranted/Denied/Expired/Revoked` | Approval lifecycle | NO (V1 NOT_REQUIRED) |
| `PermissionGranted/Revoked/Expired` | Permission lifecycle | NO (V1 NOT_GRANTED/NOT_APPLICABLE) |

### Event Identity

Deterministic: `{decisionId}:{eventType}` (no random IDs, §17 idempotency).

---

## 7. Provenance Model (§10)

All upstream provenance preserved verbatim:

| Reference | Source | Class |
|---|---|---|
| `decisionId` | Input | MANDATORY |
| `candidateId` | Input | CONDITIONAL |
| `actionId` | Input | CONDITIONAL |
| `p4SnapshotRef` | policyResult.provenance | MANDATORY |
| `policy.*` | policyResult.provenance | MANDATORY |
| `safety.*` | safetyResult.provenance | CONDITIONAL |
| `approval.*` | safetyResult | CONDITIONAL |
| `automationMode` | safetyResult.provenance | CONDITIONAL |
| `versions.*` | Derived from upstream | MANDATORY |
| `timestamps.*` | Derived from upstream | MANDATORY |

---

## 8. Outcome Preservation

P5-05 preserves all upstream outcomes without mutation:

| Input Outcome | Explanation WHAT | Audit newState |
|---|---|---|
| SELECTED | "SELECTED with action type {type}" | SELECTED |
| NO_ACTION | "NO_ACTION — evaluation completed, nothing selected" | NO_ACTION |
| BLOCKED | "BLOCKED" | BLOCKED |
| NOT_DETERMINED | "NOT_DETERMINED — could not reliably determine" | NOT_DETERMINED |

SUPPRESSED is a layer result (not a P5-02 outcome) — carried via `DecisionSuppressed` audit event.

---

## 9. Blocker Provenance

Three-way source distinction preserved:

| Source | Explanation |
|---|---|
| POLICY | `Blocked by POLICY — rule {ruleId}` |
| SAFETY | Preserved from safetyResult.blockerReport |
| APPROVAL | Preserved from safetyResult.approvalRecord |

Never rewritten by P5-05.

---

## 10. Determinism

- Same input → identical output (byte-for-byte JSON equal).
- No `Date.now()`, no `Math.random()`, no mutable global state.
- Event IDs are deterministic: `{decisionId}:{eventType}`.
- Explanation text is template-derived from upstream facts.

---

## 11. Input Immutability

- Input objects are never mutated.
- New output structures are returned.
- Spreads create shallow copies where needed.

---

## 12. Missing / Unavailable Input Handling

- `candidateId = null` → preserved as null in provenance (not fabricated).
- `actionId = null` → preserved as null (not inferred).
- NOT_DETERMINED → explanation states "could not reliably determine" (never mapped to NO_ACTION).
- BLOCKED → explanation states "BLOCKED" (never mapped to NO_ACTION).
- Missing evidence → explanation states the unresolved cause.

---

## 13. Non-Responsibilities (Boundary)

P5-05 does NOT:

- Evaluate policy (P5-03)
- Evaluate safety (P5-04)
- Select actions
- Change outcomes
- Grant approval
- Grant permission
- Execute anything
- Access DB / PostgreSQL / Drizzle
- Access HistoricalArtifactStore / ReplayEngine
- Call P5ArtifactRecorder
- Perform persistence
- Use LLM
- Create API / UI
- Introduce new audit event taxonomy
- Create BUY/SELL/LONG/SHORT/ORDER/TRADE semantics
- Create scores / thresholds / ranking

---

## 14. Tests

| Suite | Count | Result |
|---|---|---|
| P5-05-RT explanation tests | 34 | ALL PASS |
| P5 regression (all P5) | 216 | ALL PASS (10 suites) |

### Test Coverage

- E01–E04: Outcome preservation (SELECTED, NO_ACTION, NOT_DETERMINED, BLOCKED)
- E05: POLICY-BLOCKED provenance
- E06–E08: Upstream provenance preservation (P4, P5-03, P5-04)
- E09–E10: Permission/approval state preservation
- E11: Explanation cannot change outcome
- E12: Audit vocabulary frozen
- E13: Audit chronology deterministic
- E14–E15: Missing data honest (not fabricated)
- E16: Input immutability
- E17: Deterministic repeatability
- E18–E21: No DB / persistence / live-data / LLM dependency
- E22–E23: Required fields present
- E24: DecisionProduced event correct
- E25–E26: Outcome distinction preserved
- E27: Suppression event generated
- E28–E29: Advisory/consequential permission matrix
- E30: No execution permission granted
- E31: Guardrail results preserved
- E32: Pure function (no side effects)
- Source scans: No forbidden business semantics

---

## 15. Typecheck

```
npx tsc --noEmit → CLEAN (exit 0)
```

---

## 16. Regression

| Layer | Tests | Result |
|---|---|---|
| P5-05-RT | 34 | PASS |
| P5-03-RT | 49 | PASS (unchanged) |
| P5-04-RT | 30 | PASS (unchanged) |
| P5 total | 216 | PASS (10 suites) |

---

## 17. Source Scans

Scanned `src/lib/p5/explanation/**` for forbidden terms:

| Pattern | Matches in evaluator.ts | Matches in types.ts |
|---|---|---|
| BUY / SELL / LONG / SHORT / ORDER / TRADE | 0 | 0 |
| score / ranking / threshold | 0 | 0 |
| 90 / 80 / 65 / 25 / 15 | 0 | 0 |
| STRONG_WATCH / WATCH | 0 | 0 |
| rule-version.service | 0 | 0 |
| Date.now() | 0 | 0 |
| Math.random() | 0 | 0 |
| Drizzle / pg / postgres / prisma | 0 | 0 |
| openai / anthropic / llm / gpt / claude | 0 | 0 |

---

## 18. Acceptance Gates

| Gate | Description | Result | Evidence |
|---|---|---|---|
| G1 | Frozen P5-05 contract respected | PASS | §6, §10, §16, §17, §22 all followed |
| G2 | P5-03-RT compatibility | PASS | Consumes P5PolicyEvaluationResult directly |
| G3 | P5-04-RT compatibility | PASS | Consumes P5SafetyEvaluationResult directly |
| G4 | Pure runtime | PASS | No DB, no persistence, no side effects (E32) |
| G5 | Deterministic | PASS | Same input → identical output (E17) |
| G6 | No DB | PASS | E18 source scan |
| G7 | No persistence | PASS | E19 source scan |
| G8 | No live lookup | PASS | E20 source scan |
| G9 | No policy reinterpretation | PASS | Preserves policyResult.outcome (E11) |
| G10 | No safety reinterpretation | PASS | Preserves safetyResult (E08, E09, E10) |
| G11 | No approval reinterpretation | PASS | Preserves approvalState (E10) |
| G12 | No permission reinterpretation | PASS | Preserves permissionState (E09) |
| G13 | Outcome preservation | PASS | E01–E04, E11 |
| G14 | Blocker provenance preserved | PASS | E05 |
| G15 | Explanation slots exact | PASS | §6 slots mapped to all fields |
| G16 | Provenance preserved | PASS | E06–E08 |
| G17 | Audit taxonomy frozen | PASS | E12 |
| G18 | Audit chronology preserved | PASS | E13 |
| G19 | No invented audit events | PASS | Only DecisionProduced + DecisionSuppressed |
| G20 | No fabricated evidence | PASS | E14–E15 |
| G21 | Missing-data semantics correct | PASS | E14, E15, E26 |
| G22 | Input immutability | PASS | E16, E32 |
| G23 | Explanation/audit separation | PASS | Separate fields, separate construction |
| G24 | No LLM dependency | PASS | E21 |
| G25 | No execution | PASS | No execution logic in evaluator |
| G26 | No new business rules | PASS | Template-derived from upstream |
| G27 | No legacy P1 reuse | PASS | No rule-version.service import |
| G28 | Deterministic repeatability | PASS | E17 |
| G29 | Comprehensive tests | PASS | 34 tests, all pass |
| G30 | Typecheck clean | PASS | tsc --noEmit = 0 |
| G31 | P5 regression clean | PASS | 216/216 pass |
| G32 | P4 regression clean | PASS | P4 unchanged |
| G33 | No upstream modification | PASS | Only new files + this doc |
| G34 | Documentation complete | PASS | This document |
| G35 | Forbidden-term scan clean | PASS | 0 matches in evaluator/types |
| G36 | Scope discipline | PASS | No safety/policy/execution logic |
| G37 | Downstream compatibility | PASS | Output maps to P5DecisionRecord fields |

---

## 19. Known Limitations

1. **Audit persistence deferred** (PROVISIONAL per P5-05 §16): P5-05-RT returns in-memory audit events; persistence is P5-08/P5-09 responsibility.
2. **Explanation levels deferred** (PROVISIONAL per P5-05 §22): V1 produces DETAILED-level content only; SUMMARY/AUDIT levels are P5-06 responsibility.
3. **DecisionSuperseded/Expired/Cancelled deferred**: V1 fires only DecisionProduced; other lifecycle events require P5-02 state machine wiring.
4. **Approval/Permission lifecycle events deferred**: V1 produces no approval/permission events (NOT_REQUIRED / NOT_APPLICABLE).

---

## 20. Downstream Handoff

After P5-05-RT:

```
P4 runtime
→ P5-03 PolicyEvaluator
→ P5-04 SafetyEvaluator
→ P5-05 ExplanationEvaluator ← COMPLETE
→ P5-10 DecisionProducer (future)
```

P5-10 remains OUT OF SCOPE. Do NOT wire P5-10 yet.

The P5-05-RT output (`P5ExplanationResult`) contains all the explanation, provenance, and audit events needed to construct a complete `P5DecisionRecord` in the future P5-10 producer.

---

## 21. Git Boundary

Files created (new):

- `src/lib/p5/explanation/types.ts`
- `src/lib/p5/explanation/evaluator.ts`
- `src/lib/p5/explanation/index.ts`
- `src/lib/p5/explanation/__tests__/evaluator.test.ts`
- `docs/P5_Upgrade/P5-05-RT_IMPLEMENTATION.md`

Files modified: **NONE** (zero production code changes to frozen upstream).

---

## 22. Freeze Status

**IMPLEMENTATION COMPLETE — READY FOR OWNER REVIEW**

Do NOT self-freeze. Freeze is a separate owner-approved final-revision task.

Freeze prerequisite: owner review of this implementation document and verification of all 37 acceptance gates (G1–G37).
