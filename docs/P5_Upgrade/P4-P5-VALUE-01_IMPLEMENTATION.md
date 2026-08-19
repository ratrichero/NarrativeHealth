# P4-P5-VALUE-01 — IMPLEMENTATION

## Status

IMPLEMENTATION COMPLETE

## What Was Built

### 1. P5DecisionPresentationModel (`src/lib/p5/read/presentation-model.ts`)

Pure transformation layer that converts `P5ActionDecisionReadViewModel` into user-facing text:

**Executive Summary (`P5ExecutiveSummary`)**:
- `posture` — action type label (MONITOR / REVIEW / etc.), null when not SELECTED
- `headline` — one-sentence summary of what the system decided
- `rationale` — plain-language explanation of why
- `guidance` — "What should I do?" answer

**Plain-language Why (`P5PlainWhy`)**:
- `facts[]` — structured facts (label + value) derived from P4/P5 data
- `alternatives[]` — what did NOT happen and why (from explanation.whatDidNotHappen)

**Confidence Guidance (`P5ConfidenceGuidance`)**:
- `level` — derived from P4 status + decision outcome (HIGH/MEDIUM/LOW/null)
- `meaning` — plain-language explanation of what confidence means for the user

**Decision History (`P5DecisionHistoryEntry[]`)**:
- Rendered from previously persisted decisions (same narrativeId)
- Shows current vs previous decisions with dates

**Technical Details (collapsed)**:
- All raw/technical fields moved here (decisionId, provenance JSON, audit events, etc.)
- Collapsed by default — user sees summary first

### 2. P5ActionDecisionPanel Rewrite (`src/components/P5ActionDecisionPanel.tsx`)

**New layout** (user can answer 4 questions in seconds):

```
┌─────────────────────────────────────────────────┐
│ Decision                    Read-only  Advisory │
├─────────────────────────────────────────────────┤
│ [SELECTED/BLOCKED/etc.]  MONITOR               │
│                                                  │
│ The system recommends monitoring for this        │
│ narrative.                                       │
│                                                  │
│ Why?                                             │
│ The current data snapshot is available and       │
│ valid. Policy rule C-201: snapshot present...    │
│                                                  │
│ Confidence [MEDIUM]                              │
│ The system selected an action, but data quality  │
│ affects confidence.                              │
│                                                  │
│ ┌ What should I do? ──────────────────────────┐ │
│ │ Continue monitoring this narrative. No       │ │
│ │ stronger action is recommended.              │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ How the system decided                           │
│ • Data snapshot: Available and valid             │
│ • Decision outcome: Action selected              │
│ • Recommended action: MONITOR                    │
│ • Safety evaluation: Safety checks passed        │
│                                                  │
│ Decision history                                 │
│ Current  MONITOR  19 Aug 2026                    │
│ Previous MONITOR  18 Aug 2026                    │
│                                                  │
│ ▶ Technical details                              │
│                                                  │
│ ⚠ This is an advisory-only read surface...       │
└─────────────────────────────────────────────────┘
```

**For ABSENT/NO_DECISION_RECORD**:
```
┌─────────────────────────────────────────────────┐
│ Decision                                        │
├─────────────────────────────────────────────────┤
│ [NO DECISION]                                   │
│                                                  │
│ No decision has been made for this narrative     │
│ yet.                                            │
│                                                  │
│ Why?                                             │
│ The system has not yet evaluated this narrative. │
│                                                  │
│ Confidence — no confidence level to assess.      │
│                                                  │
│ ┌ What should I do? ──────────────────────────┐ │
│ │ Wait for the system to process this          │ │
│ │ narrative, or check data sources.            │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ This narrative has not been evaluated yet...     │
│                                                  │
│ ▶ Technical details                              │
└─────────────────────────────────────────────────┘
```

### 3. History Support

- Added `findDecisionHistoryByNarrativeId()` to `PgHistoricalArtifactStore`
- Presentation model accepts `history` array parameter
- Shows current + previous decisions when available
- Falls back to "No previous decision available" when none exist

## Verification Matrix

| User Question | Before | After |
|---|---|---|
| What does the system think? | ❌ Raw fields, no summary | ✅ Executive summary with posture |
| Why? | ❌ "Policy rule C-201" | ✅ Plain-language rationale + facts |
| How confident? | ❌ MEDIUM badge, no meaning | ✅ MEDIUM + meaning explanation |
| What should I do? | ❌ Not present | ✅ "Continue monitoring..." guidance |
| Technical noise? | ❌ decisionId, provenance JSON visible | ✅ Hidden under collapsed section |
| Decision history? | ❌ Not present | ✅ Current + previous shown |

## Test Results

| Suite | Result |
|---|---|
| P5 regression | 338/338 PASS (20 suites) |
| Typecheck | CLEAN |

## Files Changed

| File | Change |
|---|---|
| `src/lib/p5/read/presentation-model.ts` | NEW |
| `src/components/P5ActionDecisionPanel.tsx` | REWRITTEN |
| `src/lib/p5/replay/pg-artifact-store.ts` | Added findDecisionHistoryByNarrativeId |
| `src/components/__tests__/P5ActionDecisionPanel.test.tsx` | Updated |
| `src/lib/p5/read/__tests__/canonical-flow.test.tsx` | Updated |
| `src/lib/p5/replay/__tests__/pg-artifact-store.test.ts` | Updated G1 gate |
| `docs/P5_Upgrade/P4-P5-VALUE-01_RECON.md` | NEW |
| `docs/P5_Upgrade/P4-P5-VALUE-01_IMPLEMENTATION.md` | THIS FILE |
