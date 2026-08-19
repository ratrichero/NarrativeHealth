# P4-P5-COMPLETION-03 — UI VALUE MATRIX

**Date:** 2026-08-19

---

## 1. Complete Capability → UI Trace

### P4 Decision Support Panel

| P4 Capability | P4 Type Field | API Response | ViewModel | UI Component | User-Visible | Value Rating |
|---|---|---|---|---|---|---|
| Direction | `direction: P4DirectionState` | `p4DecisionSupport.direction` | `viewModel.direction` | `<DirectionChip>` — large colored badge | POSITIVE / NEGATIVE / MIXED / NEUTRAL / UNKNOWN | ⭐⭐⭐ HIGH |
| Confidence | `confidence: P4QualitativeValue` | `p4DecisionSupport.confidence` | `viewModel.confidence` | `<QualitativeBadge>` — "Confidence HIGH" | HIGH / MEDIUM / LOW / UNKNOWN | ⭐⭐⭐ HIGH |
| Actionability | `actionability: P4QualitativeValue` | `p4DecisionSupport.actionability` | `viewModel.actionability` | `<QualitativeBadge>` — "Actionability HIGH" | HIGH / MEDIUM / LOW / UNKNOWN | ⭐⭐ LOW — no "so what" |
| Opportunity | `opportunity: P4QualitativeValue` | `p4DecisionSupport.opportunity` | `viewModel.opportunity` | `<QualitativeBadge>` — "Opportunity HIGH" | HIGH / MEDIUM / LOW / UNKNOWN | ⭐⭐⭐ HIGH |
| Risk | `risk: P4QualitativeValue` | `p4DecisionSupport.risk` | `viewModel.risk` | `<QualitativeBadge>` — inverted colors | HIGH / MEDIUM / LOW / UNKNOWN | ⭐⭐⭐ HIGH |
| Signals | `signals: P4FiredSignal[]` | `p4DecisionSupport.signals` | `viewModel.signals` | Chips: label + direction + severity | "NARRATIVE_IMPROVEMENT Direction POSITIVE" | ⭐⭐ MEDIUM |
| Status badge | `status: P4ViewModelStatus` | `p4DecisionSupport.status` | `viewModel.status` | `<Badge>` — "Available" / "Partial evidence" | Status indicator | ⭐⭐ MEDIUM |
| Degradation reasons | `degradation: P4DegradationReason[]` | `p4DecisionSupport.degradation` | `viewModel.degradation` | Banner: "Partial evidence — reason" | Reason text | ⭐⭐ MEDIUM |
| Historical context | `historicalContext` | `p4DecisionSupport.historicalContext` | `viewModel.historicalContext` | Text line: "Series of N artifacts" | Metadata text | ⭐ LOW |
| Explanation items | `explanation.items` | `p4DecisionSupport.explanation.items` | `viewModel.explanation.items` | Collapsible: role badge + statement | "Primary: Direction is positive because..." | ⭐⭐ MEDIUM |
| Evidence references | `evidence` | `p4DecisionSupport.evidence` | `viewModel.evidence` | Collapsible: reference rows | Technical reference data | ⭐ LOW |
| Version info | `version` | `p4DecisionSupport.version` | `viewModel.version` | Not directly rendered | Hidden | — |

### P5 Action Decision Panel

| P5 Capability | P5 Type Field | API Response | ViewModel | UI Component | User-Visible | Value Rating |
|---|---|---|---|---|---|---|
| Display state | `displayState: P5DisplayState` | `p5ActionDecision.displayState` | `data.displayState` | Badge: SELECTED / NO_ACTION / etc. | State classification | ⭐⭐⭐ HIGH |
| Availability | `availability: P5ReadAvailability` | `p5ActionDecision.availability` | `data.availability` | Green/red badge + message | OK / NO_DECISION_RECORD / etc. | ⭐⭐ MEDIUM |
| Decision state | `decision.decisionState` | `p5ActionDecision.decision.decisionState` | `decision.decisionState` | Chip: "decision: DECIDED" | DECIDED | ⭐ LOW — always DECIDED in V1 |
| Approval state | `decision.approvalState` | `p5ActionDecision.decision.approvalState` | `decision.approvalState` | Chip: "approval: NOT_REQUIRED" | NOT_REQUIRED | ⭐ LOW — always NOT_REQUIRED in V1 |
| Execution state | `decision.executionState` | `p5ActionDecision.decision.executionState` | `decision.executionState` | Chip: "execution: NOT_APPLICABLE" + row | NOT_APPLICABLE | ⭐ LOW — always NOT_APPLICABLE in V1 |
| Decision ID | `decision.decisionId` | `p5ActionDecision.decision.decisionId` | `decision.decisionId` | Row: "p5d-abc12345" | Internal ID | ⭐ ZERO |
| Candidate ID | `decision.candidateId` | `p5ActionDecision.decision.candidateId` | `decision.candidateId` | Row: "cand-1" | Internal ID | ⭐ ZERO |
| Action ID | `decision.actionId` | `p5ActionDecision.decision.actionId` | `decision.actionId` | Row: "— (created only if SELECTED)" | Implementation detail | ⭐ ZERO |
| Outcome | `decision.outcome` | `p5ActionDecision.decision.outcome` | `decision.outcome` | Row: "Outcome: SELECTED" | Policy outcome | ⭐⭐⭐ HIGH |
| Action type | `decision.actionType` | `p5ActionDecision.decision.actionType` | `decision.actionType` | Row: "Action type: MONITOR" | Action category | ⭐⭐⭐ HIGH |
| Parameters | `decision.parameters` | `p5ActionDecision.decision.parameters` | `decision.parameters` | Row: JSON display | Empty `{}` in V1 | ⭐ ZERO |
| Suppressed | `decision.suppressed` | `p5ActionDecision.decision.suppressed` | `decision.suppressed` | Yellow warning (if true) | Suppression notice | ⭐⭐ MEDIUM |
| Blocker report | `decision.blockerReport` | `p5ActionDecision.decision.blockerReport` | `decision.blockerReport` | Red alert (if present) | Blocker details | ⭐⭐ MEDIUM |
| Explanation (what) | `decision.explanation.what` | `p5ActionDecision.decision.explanation.what` | `decision.explanation.what` | Text: "MONITOR selected for narrative 1" | System-log quality | ⭐ LOW — too thin |
| Explanation (why) | `decision.explanation.why` | `p5ActionDecision.decision.explanation.why` | `decision.explanation.why` | Text: "Policy rule C-201: snapshot present, direction usable" | Rule reference | ⭐ LOW — not user-friendly |
| What did not happen | `decision.explanation.whatDidNotHappen` | `...explanation.whatDidNotHappen` | `decision.explanation.whatDidNotHappen` | Text list (if non-empty) | Alternative considerations | ⭐⭐ MEDIUM |
| Policy version | `decision.provenance.policy.policyVersion` | `...provenance.policy.policyVersion` | `decision.provenance.policy.policyVersion` | Row: "Policy: v1" | Version string | ⭐ LOW |
| Policy rules | `decision.provenance.policy.ruleRefs` | `...provenance.policy.ruleRefs` | `decision.provenance.policy.ruleRefs` | Text: "C-101, C-201, C-501" | Rule IDs | ⭐ LOW — technical |
| Safety aggregate | `decision.safetyResult.aggregate` | `...safetyResult.aggregate` | `decision.safetyResult.aggregate` | Row: "Safety / guardrail: PASS" | Always PASS in V1 | ⭐ ZERO |
| Guardrail results | `decision.safetyResult.guardrailResults` | `...safetyResult.guardrailResults` | `decision.safetyResult.guardrailResults` | Empty list | Always empty in V1 | ⭐ ZERO |
| Approval state | `decision.approvalState` | `...approvalState` | `decision.approvalState` | Row: "Approval: NOT_REQUIRED" | Always NOT_REQUIRED in V1 | ⭐ ZERO |
| Approval record | `decision.approvalRecord` | `...approvalRecord` | `decision.approvalRecord` | Row: approval ID (if present) | Always null in V1 | ⭐ ZERO |
| Permission result | `decision.permissionResult` | `...permissionResult` | `decision.permissionResult` | Row: "Execution permission: NOT_APPLICABLE" | Always NOT_APPLICABLE in V1 | ⭐ ZERO |
| Audit events | `decision.auditEvents` | `...auditEvents` | `decision.auditEvents` | "No audit events recorded." | Always empty in V1 | ⭐ ZERO |
| Provenance (full) | `decision.provenance` | `...provenance` | `decision.provenance` | Raw JSON blob | Developer-facing | ⭐ ZERO |
| P4 context (absent) | `context.p4SnapshotRef` | `p5ActionDecision.context.p4SnapshotRef` | `context.p4SnapshotRef` | Status + date + raw JSON | Current P4 state | ⭐⭐ MEDIUM |

---

## 2. Value Distribution Summary

| Stars | Count | Percentage | What It Means |
|---|---|---|---|
| ⭐⭐⭐ HIGH | 8 | 22% | User genuinely understands and benefits |
| ⭐⭐ MEDIUM | 9 | 25% | Present but not deeply useful |
| ⭐ LOW | 8 | 22% | Technical presence, minimal user value |
| ⭐ ZERO | 11 | 31% | Noise / V1 placeholder / internal ID |

**31% of rendered P5 content has zero user value.** This is primarily:
- Internal identifiers (Decision ID, Candidate ID, Action ID)
- V1 placeholder states (Safety PASS, Approval NOT_REQUIRED, Permission NOT_APPLICABLE)
- Raw technical data (provenance JSON, "evaluationAt: evaluated")
- Defensive engineering notes ("NOT approval", "NOT execution")

---

## 3. The Core Value Proposition

### What P4+P5 Actually Deliver (Honest Assessment)

**P4 delivers:** "Here's what's happening with this narrative and how confident we are."

This is genuinely valuable. Direction + Confidence + Opportunity/Risk + Signals give a trader a quick read on a narrative's trajectory. The Explanation section adds depth for those who want it.

**P5 delivers:** "Here's what our policy system decided about this narrative."

This is also valuable, but thinner than it appears. The decision is always MONITOR (V1 single candidate), so the real value is:
1. Confirming the system processed the narrative ✅
2. Showing the outcome classification ✅
3. Providing the "Why?" explanation ✅
4. Distinguishing NO_DECISION_RECORD from NO_ACTION ✅

The Safety/Approval/Permission/Audit/Provenance sections are **infrastructure for future capability**, not current user value.

### The Missing Layer

The gap between "technical capability" and "product value" is an **interpretation/summary layer** that would:

1. Translate technical state into plain-language guidance
2. Tell the user what to DO (not just what the system decided)
3. Highlight what MATTERS (not show everything)
4. Guide through uncertainty (what to do when NOT_DETERMINED / DEGRADED)

This layer does not exist in the current implementation. The panels show data; they don't interpret it for the user.

---

## 4. Priority Gaps for Product Value

| Priority | Gap | Current State | Needed | Impact |
|---|---|---|---|---|
| **P0** | Executive summary | None | "Based on current evidence, we recommend monitoring this narrative. The direction is positive with medium confidence." | Transforms data into guidance |
| **P1** | Plain-language Why? | "Policy rule C-201: snapshot present, direction usable" | "The system selected MONITOR because the data snapshot is current and the direction is identifiable, but the evidence strength doesn't justify a more active recommendation." | Makes explanation useful |
| **P1** | Hide internal IDs | Decision ID, Candidate ID always shown | Show only to admin/developer users | Reduces noise |
| **P2** | Uncertainty guidance | NOT_DETERMINED badge only | "The system couldn't determine a clear recommendation. This usually means the data is insufficient or conflicting. Consider waiting for more data." | Helps user act on uncertainty |
| **P2** | Decision history | None | Timeline of past decisions for this narrative | Shows evolution |
| **P3** | Safety/Approval meaningful display | Always PASS/NOT_REQUIRED | When real evaluations exist, show meaningful results | Future-proofing |

---

## 5. Conclusion

P4+P5 deliver **real but incomplete product value**. The foundation is architecturally sound — direction, confidence, decision outcome, and explanation are genuinely useful. But 31% of the P5 panel content is noise (internal IDs, V1 placeholders, raw JSON), and the most important question ("What should I do?") goes unanswered.

The implementation is **correct at the data layer** but **thin at the interpretation layer**. Closing this gap requires product/UX work (executive summary, plain-language explanations, noise reduction), not architectural changes.

**P4-P5 can be closed as implementation-complete.** The product value gaps are enhancement opportunities, not completion defects.
