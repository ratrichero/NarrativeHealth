# P4-P5-COMPLETION-04 — RECON

## Status

RECON COMPLETE — PROCEEDING TO FINAL AUDIT

## Source Files Audited

| File | Layer |
|---|---|
| `src/lib/p4/types.ts` | P4 ViewModel — what P4 provides |
| `src/lib/p4/service.ts` | P4 read service |
| `src/lib/p5/integration/p5-runtime-adapter.ts` | P5-11 adapter (P4 → P5-03 mapping) |
| `src/lib/p5/policy/types.ts` | P5-03 input contract |
| `src/lib/p5/safety/types.ts` | P5-04 input/output |
| `src/lib/p5/explanation/types.ts` | P5-05 input/output |
| `src/lib/p5/producer/types.ts` | P5-10 producer input |
| `src/lib/p5/producer/p5-decision-producer.ts` | P5-10 build + commit |
| `src/lib/p5/types.ts` | P5 read model types |
| `src/lib/p5/read/action-read.service.ts` | P5-06A read service |
| `src/lib/p5/read/display-state.ts` | P5-06C display state derivation |
| `src/lib/p5/read/presentation-model.ts` | P5-06C presentation transformation |
| `src/components/P5ActionDecisionPanel.tsx` | P5-06C UI panel |
| `src/app/api/narratives/[id]/route.ts` | Production caller |
| `src/app/narrative/[id]/page.tsx` | Narrative detail page |

## P4 → P5 Information Flow (Verified from Source)

```
P4 ViewModel (status, direction, opportunity, risk, confidence, actionability, signals, explanation, evidence, historicalContext, degradation)
    ↓ (P5-11 adapter: buildPolicyInput)
P5-03 PolicyEvaluationInput (policyId, p4SnapshotRef, status, direction, opportunity, risk, confidence, actionability, signalIds, degradation, candidate=MONITOR)
    ↓ (P5-03 evaluator: frozen)
P5PolicyEvaluationResult (outcome, selectedCandidate, blockerReport, suppressed)
    ↓ (P5-04 evaluator: frozen)
P5SafetyEvaluationResult (aggregate, guardrailResults, approvalState, permissionResult)
    ↓ (P5-05 evaluator: frozen)
P5ExplanationResult (what, why, basedOn, policy, safety, approval, whatDidNotHappen, provenance, auditEvents)
    ↓ (P5-10 producer: frozen)
P5DecisionRecord (all fields assembled)
    ↓ (P5-09 recorder: frozen)
PostgreSQL (p5_* tables)
    ↓ (P5-06A read service)
P5ActionDecisionReadViewModel
    ↓ (P5-06C presentation model)
P5DecisionPresentationModel (executive, why, confidence, history, technical)
    ↓ (P5ActionDecisionPanel)
UI
```

## Key Observations from Source

### 1. P4 → P5-03 Mapping (p5-runtime-adapter.ts)

The adapter maps these P4 fields into P5-03 input:

| P4 Field | P5-03 Input Field | Mapping Type |
|---|---|---|
| `status` | `status` | Direct |
| `direction` | `direction` | Direct |
| `opportunity` | `opportunity` | Direct |
| `risk` | `risk` | Direct |
| `confidence` | `confidence` | Direct |
| `actionability` | `actionability` | Direct |
| `signals[].id` | `signalIds` | Direct |
| `degradation` | `degradation` | Direct |
| `narrativeIdentity` | `p4SnapshotRef.narrativeIdentity` | Direct |
| `asOf` | `p4SnapshotRef.asOf` | Direct |
| `version` | `p4SnapshotRef.versionTuple` | Direct |

**NOT mapped to P5-03:** `explanation`, `evidence`, `historicalContext`, `provenance` — these are P4-internal and not consumed by P5-03.

### 2. Confidence Re-derivation (presentation-model.ts)

P4 provides: `confidence: P4QualitativeValue` (HIGH/MEDIUM/LOW/UNKNOWN)

P5 presentation model `buildConfidenceGuidance()` DERIVES confidence from:
- `p4SnapshotRef.status` (OK → HIGH for SELECTED, DEGRADED → MEDIUM for SELECTED)
- `decision.outcome` (NOT_DETERMINED → LOW, NO_ACTION → MEDIUM, BLOCKED → HIGH)

**The original P4 confidence value is NOT passed through to the P5 UI.**

### 3. Direction Not Surfaced

P4 provides: `direction: P4DirectionState` (POSITIVE/NEGATIVE/MIXED/NEUTRAL/UNKNOWN)

P5 presentation model uses direction ONLY in `outcomeRationale()` to check p4Status (OK/DEGRADED), NOT to display the actual direction. The P5 panel does NOT show direction as a badge or label.

### 4. Opportunity/Risk/Actionability Not Surfaced

P4 provides: `opportunity`, `risk`, `actionability` (P4QualitativeValue)

P5 panel: NOT shown in primary UI or technical details.

### 5. Signals Not Surfaced

P4 provides: `signals: P4Signal[]` (fired signals with labels)

P5 panel: NOT shown anywhere.

### 6. Historical Context Not Surfaced

P4 provides: `historicalContext` (seriesLength, steps, overallTrend, dataSufficiency)

P5 panel: NOT surfaced.

### 7. Explanation Items Not Surfaced

P4 provides: `explanation.items[]` (template-derived human-readable statements)

P5 panel: P5 has its own explanation (from P5-05), which is simpler than P4's.
