# P4-P5-COMPLETION-04 — RUNTIME AUDIT

## 1. P4 → P5 Runtime Trace (Source-Verified)

### Stage 1: P4 Snapshot → P5-03 Input

**File:** `src/lib/p5/integration/p5-runtime-adapter.ts` lines 160-198

```
P4ViewModel.status     → P5PolicyEvaluationInput.status        (DIRECT)
P4ViewModel.direction  → P5PolicyEvaluationInput.direction     (DIRECT)
P4ViewModel.opportunity → P5PolicyEvaluationInput.opportunity  (DIRECT)
P4ViewModel.risk       → P5PolicyEvaluationInput.risk          (DIRECT)
P4ViewModel.confidence → P5PolicyEvaluationInput.confidence    (DIRECT)
P4ViewModel.actionability → P5PolicyEvaluationInput.actionability (DIRECT)
P4ViewModel.signals[].id → P5PolicyEvaluationInput.signalIds   (DIRECT)
P4ViewModel.degradation → P5PolicyEvaluationInput.degradation  (DIRECT)
P4ViewModel.narrativeIdentity → p4SnapshotRef.narrativeIdentity (DIRECT)
P4ViewModel.asOf      → p4SnapshotRef.asOf                     (DIRECT)
P4ViewModel.version   → p4SnapshotRef.versionTuple             (DIRECT)
```

**Information loss at this stage:**
- P4 `explanation` → NOT consumed by P5-03
- P4 `evidence` → NOT consumed by P5-03
- P4 `historicalContext` → NOT consumed by P5-03
- P4 `provenance` → NOT consumed by P5-03

**Assessment:** Acceptable — P5-03 operates on the declared P4 snapshot fields. P4 explanation/evidence are P4-internal and correctly not consumed by the policy layer.

### Stage 2: P5-03 Policy Evaluation → Outcome

**Frozen:** P5-03 evaluator returns:
- `outcome`: SELECTED | NO_ACTION | BLOCKED | NOT_DETERMINED
- `selectedCandidate`: { candidateId, actionType, parameters }
- `blockerReport`: { source, ref, reason }
- `suppressed`: boolean

**Key fact:** V1 candidate is always MONITOR (hardcoded in adapter line 176: `actionType: "MONITOR"`).

### Stage 3: P5-04 Safety → Safety/Approval/Permission

**Frozen:** P5-04 evaluator returns:
- `safetyResult.aggregate`: PASS | BLOCK | NOT_DETERMINED
- `approvalState`: NOT_REQUIRED | REQUIRED | PENDING | APPROVED | DENIED
- `permissionResult`: GRANTED | NOT_GRANTED | NOT_APPLICABLE | UNAVAILABLE

**V1 behavior:** Safety=PASS, Approval=NOT_REQUIRED, Permission=NOT_APPLICABLE (advisory-only).

### Stage 4: P5-05 Explanation → Provenance/Audit

**Frozen:** P5-05 evaluator returns:
- `explanation`: { what, why, basedOn, policy, safety, approval, whatDidNotHappen }
- `provenance`: full provenance chain
- `auditEvents`: event log

### Stage 5: P5-10 Producer → P5DecisionRecord

**Frozen:** Assembles complete record from all upstream results.

### Stage 6: Read Service → ReadViewModel

**File:** `src/lib/p5/read/action-read.service.ts`

`presentView()` (line 121-135):
- Reads persisted P5DecisionRecord
- Flattens to P5DecisionSummary (1:1 mapping)
- Derives displayState via `deriveDisplayState()`
- Sets context.source = "DECISION_RECORD"

**Information preservation:** All P5-03/04/05 fields preserved in the read model.

### Stage 7: Presentation Model → UI

**File:** `src/lib/p5/read/presentation-model.ts`

**CONFIDENCE RE-DERIVATION (lines 205-240):**
```
buildConfidenceGuidance(view):
  - NOT_DETERMINED → LOW
  - NO_ACTION → MEDIUM
  - SELECTED + p4Status=OK → HIGH
  - SELECTED + p4Status=DEGRADED → MEDIUM
  - BLOCKED → HIGH
```

**The P4 confidence value (HIGH/MEDIUM/LOW/UNKNOWN) is NOT used. Confidence is re-derived from outcome + status.**

**DIRECTION NOT SURFACED:**
- `outcomeRationale()` checks `p4Status` (OK/DEGRADED) but does NOT display direction
- No badge, no label, no mention of POSITIVE/NEGATIVE/MIXED/NEUTRAL/UNKNOWN

**OPPORTUNITY/RISK/ACTIONABILITY NOT SURFACED:**
- Not referenced anywhere in presentation-model.ts

**SIGNALS NOT SURFACED:**
- Not referenced anywhere in presentation-model.ts

## 2. Semantic Boundary Verification

| Boundary | Source | Verified? |
|---|---|---|
| Outcome comes ONLY from P5-03 | adapter.ts line 104-112 | ✅ |
| Safety comes ONLY from P5-04 | adapter.ts line 119-127 | ✅ |
| Explanation comes ONLY from P5-05 | adapter.ts line 134-145 | ✅ |
| P5-11 is orchestration only | adapter.ts — no evaluation logic | ✅ |
| Presentation is pure transform | presentation-model.ts — no evaluation | ✅ |
| No live P4 query in presentation | presentation-model.ts — no imports | ✅ |
| No DB access in presentation | presentation-model.ts — no imports | ✅ |

## 3. Provenance Chain Verification

| Link | Source | Verified? |
|---|---|---|
| P4 snapshot → p4SnapshotRef | adapter.ts buildPolicyInput | ✅ |
| p4SnapshotRef → P5-03 provenance | frozen upstream | ✅ |
| P5-03 → P5-04 safety provenance | frozen upstream | ✅ |
| P5-04 → P5-05 explanation provenance | frozen upstream | ✅ |
| P5-05 → P5-10 P5DecisionRecord | frozen upstream | ✅ |
| P5-10 → P5-09 PostgreSQL | frozen upstream | ✅ |
| P5-09 → P5-06A read service | action-read.service.ts presentView | ✅ |
| P5-06A → presentation model | buildPresentationModel() | ✅ |
| Presentation → UI | P5ActionDecisionPanel | ✅ |

**No provenance break found. No live P4 re-query after decision recorded.**
