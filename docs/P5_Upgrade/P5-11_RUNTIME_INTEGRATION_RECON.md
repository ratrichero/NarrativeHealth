# P5-11 — Runtime Integration Reconnaissance

**Repository:** NarrativeHealth  
**Date:** 2026-08-18  
**Status:** RECON COMPLETE

---

## 1. Objective

Determine whether a legitimate production caller exists to wire the frozen P5-03 → P5-04 → P5-05 → P5-10 → P5-09 chain into real runtime operation.

---

## 2. Selected Production Caller

**Narrative API GET route:** `src/app/api/narratives/[id]/route.ts`

### Why This Caller

1. **Already calls P4:** The route handler calls `getP4DecisionSupport(narrativeId)` and receives the full P4 snapshot.
2. **Has real narrativeId:** The narrative ID is extracted from the URL path parameter.
3. **Is the natural integration boundary:** This is the only place in the codebase where P4 decision support is consumed for a specific narrative.
4. **No execution semantics:** GET route is read-only — it returns decision support data to the client. No buy/sell/execute side effects.
5. **Provenance preservation:** The P4 snapshot obtained here is the exact snapshot that should be represented in `policyResult.provenance.p4SnapshotRef`.

---

## 3. Inputs Available from Runtime

| Input | Source | Available? |
|---|---|---|
| `narrativeId` | URL path param `[id]` | ✅ |
| P4 Decision Support snapshot | `getP4DecisionSupport(narrativeId)` | ✅ |
| P4 `view.narrativeId` | From P4 snapshot | ✅ |
| P4 `view.signals` | From P4 snapshot | ✅ |
| P4 `view.direction` | From P4 snapshot | ✅ |
| P4 `view.confidence` | From P4 snapshot | ✅ |
| P4 `view.evidence[]` | From P4 snapshot | ✅ |
| P4 `view.summary` | From P4 snapshot | ✅ |
| P4 `view.contradictions[]` | From P4 snapshot | ✅ |

---

## 4. Inputs Missing / Constructed

| Input | Resolution |
|---|---|
| P5-03 candidateId | V1 deterministic: `candidate-mon-{narrativeId}-v1` |
| P5-03 candidate.actionType | `MONITOR` (advisory, SG-010 compliant) |
| P5-03 candidate.reasoning | Derived from P4 summary (factual provenance) |
| P5-03 candidate.parameters | Empty (MONITOR requires no execution parameters) |

**These are NOT invented business values.** They are the minimum V1 advisory-only candidate required by the frozen P5-03 contract to produce a valid `P5PolicyEvaluationResult`. The candidate is deterministic per narrativeId and does not introduce selection/ranking/scoring.

---

## 5. How P4 Snapshot Is Obtained

```typescript
const p4Result = await getP4DecisionSupport(narrativeId);
if (!p4Result) return null;  // P4 ERROR/NO_EVIDENCE → return null
```

The P4 snapshot is obtained exactly once. No re-querying after evaluation.

---

## 6. How P5-03 Input Is Constructed

From the P4 snapshot:

```typescript
{
  narrativeId: p4Result.view.narrativeId,
  candidate: {
    candidateId: `candidate-mon-${narrativeId}-v1`,
    actionType: 'MONITOR',
    reasoning: p4Result.view.summary ?? '',
    parameters: {},
  },
  signals: p4Result.view.signals,
  direction: p4Result.view.direction,
  confidence: p4Result.view.confidence,
  evidence: p4Result.view.evidence,
  contradictions: p4Result.view.contradictions,
  snapshotRef: { narrativeId, evaluatedAt: new Date().toISOString() },
}
```

---

## 7. Chain Invocation

| Step | Component | Invocation |
|---|---|---|
| 1 | P5-03 | `P5PolicyEvaluator.evaluate(policyInput)` |
| 2 | P5-04 | `P5SafetyEvaluator.evaluate(policyResult)` |
| 3 | P5-05 | `P5ExplanationEvaluator.evaluate(policyResult, safetyResult)` |
| 4 | P5-10 | `producer.buildDecision({ subject, policyResult, safetyResult, explanationResult })` |
| 5 | P5-10 | `producer.commitDecision(decisionRecord)` |

Each step is a direct pass-through of the frozen evaluator. No reinterpretation.

---

## 8. Single Commit Boundary

P5-10 `commitDecision()` → `P5ArtifactRecorder.record()` is the sole persistence path.

P5-11 does NOT write to any table directly.

---

## 9. Idempotency

Same `narrativeId` → same `decisionId` (deterministic per AD-013/AD-018) → recorder idempotency.

---

## 10. Error Handling

| Condition | Behavior |
|---|---|
| P4 returns null | Return 404 to client, no P5 invocation |
| P4 ERROR | Return 500, no P5 invocation |
| P4 NO_EVIDENCE | Return P4 null, no P5 invocation |
| P4 DEGRADED | P4 still returns a view — P5 proceeds with degraded data |
| P5-03 NOT_DETERMINED | Decision recorded with NOT_DETERMINED outcome |
| Structural validation failure | Throw (caught by route handler) |
| P5-04/P5-05/P5-10 failure | Throw (caught by route handler) |
| Recorder failure | Throw — no false success |

---

## 11. STOP Condition Check

| STOP Condition | Status |
|---|---|
| A. No legitimate caller exists | ✅ Caller found |
| B. P4 input unavailable | ✅ Available from existing P4 service |
| C. Invented business values | ✅ None — V1 advisory MONITOR candidate is deterministic |
| D. Invented policy rules | ✅ None |
| E. Invented safety/approval semantics | ✅ None |
| F. Invented explanation semantics | ✅ None |
| G. Frozen component modification | ✅ None required |
| H. BUY/SELL/ORDER/TRADE | ✅ None |
| I. DB access inside evaluators | ✅ None |
| J. Decisions from re-queried data | ✅ Single snapshot |
| K. Provenance chain preservation | ✅ Verified |

**All STOP conditions clear. Proceed to implementation.**

---

## 12. Architectural Decision

**Decision:** The P5-11 integration adapter is a pure orchestration function that:
1. Takes a `narrativeId`
2. Obtains the P4 snapshot
3. Constructs P5-03 input
4. Invokes the frozen evaluators in sequence
5. Builds and commits via P5-10
6. Returns the `P5DecisionRecord`

The adapter is called from the narrative API GET route, AFTER the existing P4 response is constructed, and the P5 decision record is returned alongside the P4 view model.
