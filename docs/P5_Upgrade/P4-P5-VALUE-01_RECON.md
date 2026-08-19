# P4-P5-VALUE-01 — RECON

## Status

RECON COMPLETE — PROCEEDING TO IMPLEMENTATION

## Objective

Transform P4/P5 from "technical result display" to "user understands and can act", without changing any frozen decision semantics.

## Current State (Before This Task)

### P5ActionDecisionPanel (old)
- Rendered all fields verbatim: decisionId, candidateId, actionId, provenance JSON, audit events
- Showed safety/approval/permission as raw values
- "evaluationAt": "evaluated" literal
- Implementation disclaimers ("NOT approval", "NOT execution")
- Internal IDs visible as primary content
- No executive summary
- No plain-language explanation
- No confidence guidance for users
- No "What should I do?" section
- No decision history

### User Experience Problem
Users looking at the panel could not quickly answer:
1. What does the system think?
2. Why?
3. How confident is it?
4. What should I do next?

## Architecture Decision

### New Layer: P5DecisionPresentationModel

Created as a PURE PRESENTATION TRANSFORMATION layer:

```
P5 frozen runtime
    ↓
P5DecisionRecord (persisted)
    ↓
P5ActionDecisionReadViewModel (existing canonical read model)
    ↓
P5DecisionPresentationModel (NEW — presentation transformation)
    ↓
P5ActionDecisionPanel (rewritten)
```

Key properties:
- **No decision logic** — only transforms already-frozen data into natural language
- **Deterministic** — same input always produces same output
- **No LLM** — text derived from existing P4/P5 facts only
- **No live P4 query** — uses snapshot reference from persisted decision
- **No new evaluation** — reuses frozen P5-03/04/05 results
- **No semantic drift** — outcome, actionType, safety, approval, permission unchanged

### Anti-Semantic-Drift Verification

The presentation model does NOT:
- Change outcome
- Change actionType
- Create new scores / thresholds / rankings
- Create a second recommendation engine
- Query live P4 for historical decisions
- Modify frozen P5-03/04/05/10/11

## Files Changed

| File | Change |
|---|---|
| `src/lib/p5/read/presentation-model.ts` | NEW — presentation transformation |
| `src/components/P5ActionDecisionPanel.tsx` | REWRITTEN — uses presentation model |
| `src/lib/p5/replay/pg-artifact-store.ts` | Added `findDecisionHistoryByNarrativeId` |
| `src/components/__tests__/P5ActionDecisionPanel.test.tsx` | Updated for new panel |
| `src/lib/p5/read/__tests__/canonical-flow.test.tsx` | Updated for new panel |
| `src/lib/p5/replay/__tests__/pg-artifact-store.test.ts` | Updated G1 gate |

## Frozen Components Untouched

P5-03, P5-04, P5-05, P5-07, P5-08, P5-09, P5-10, P5-11, P4, P3 — all UNTOUCHED.
