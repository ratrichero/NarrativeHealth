# P4-P5-VALUE-02 — RECON

## Status

RECON COMPLETE — PROCEEDING TO FINAL AUDIT

## Source Files Audited

| File | Purpose |
|---|---|
| `src/lib/p5/read/presentation-model.ts` | Presentation transformation layer |
| `src/components/P5ActionDecisionPanel.tsx` | Decision panel UI |
| `src/lib/p4/types.ts` | P4 ViewModel types (what P4 provides) |
| `src/lib/p5/types.ts` | P5 read model types |
| `src/lib/p5/read/action-read.service.ts` | Read service (P5-06A) |
| `src/components/P4DecisionSupportPanel.tsx` | P4 panel (reference for P4 capabilities) |
| `src/app/narrative/[id]/page.tsx` | Narrative detail page |

## Key Findings

### 1. 5-Second Comprehension — PASS for all states

All 6 display states provide:
- Badge (what state)
- Headline (one sentence)
- Why (rationale)
- What should I do? (guidance)
- Confidence with meaning

### 2. P4 → P5 Information Loss — SIGNIFICANT but INTENTIONAL

P4 provides 8 capabilities; P5 presentation uses 3 directly, 5 are intentionally deferred:

- **Direction** → Used indirectly via outcome derivation (not shown as P4 badge)
- **Confidence** → Re-derived from P4 status + outcome (not passed through P4 value)
- **Opportunity/Risk** → NOT surfaced in P5 panel
- **Actionability** → NOT surfaced in P5 panel
- **Signals** → NOT surfaced in P5 panel
- **Historical context** → NOT surfaced in P5 panel
- **Explanation items** → NOT surfaced (P5 has its own explanation)
- **Evidence references** → NOT surfaced (hidden in technical details)

### 3. Recommendation Boundary — PASS

All user-facing text in presentation-model.ts traces to:
- P4 snapshot status (from persisted record)
- P5 declared outcome (from frozen P5-03)
- P5 declared actionType (from frozen P5-03)
- P5 explanation (from frozen P5-05)

No presentation inference, no hidden score, no LLM, no new business rule.

### 4. V1 MONITOR Experience — ACCEPTABLE but BASIC

MONITOR guidance: "Continue monitoring this narrative. No stronger action is recommended by the current decision system."

This is factually correct but generic. It does not tell the user:
- What specific signals to watch for
- When to expect the next evaluation
- What would trigger a stronger action

This is a product enhancement, not a completion defect.

### 5. Technical Noise — CLEAN

Primary UI contains NO:
- decisionId
- candidateId
- actionId
- raw JSON
- internal policy IDs
- audit events
- engineering disclaimers

All hidden under "Technical details" collapsed section.

### 6. Confidence Derivation — NOTABLE GAP

P4 provides `confidence: P4QualitativeValue` (HIGH/MEDIUM/LOW/UNKNOWN).

P5 presentation model RE-DERIVES confidence from:
- `p4SnapshotRef.status` (OK/DEGRADED/NO_EVIDENCE/ERROR)
- `decision.outcome` (SELECTED/NO_ACTION/NOT_DETERMINED/BLOCKED)

This means:
- P4's actual confidence assessment is LOST in the P5 UI
- The P5 panel shows a derived confidence that may differ from P4's assessment
- The original P4 confidence is available only in the P4 panel

This is an information loss but NOT a completion defect — the P5 confidence is a reasonable approximation derived from available facts.
