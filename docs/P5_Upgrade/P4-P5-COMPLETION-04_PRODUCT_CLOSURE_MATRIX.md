# P4-P5-COMPLETION-04 — PRODUCT CLOSURE MATRIX

## 1. Product Value Assessment (Source-Evidenced)

| Capability | Source Fact | Semantic Meaning | Presentation | User Interpretation | Potential User Action | Classification |
|---|---|---|---|---|---|---|
| **Decision outcome** | P5-03 outcome field | System's policy determination | Badge (SELECTED/NO_ACTION/NOT_DETERMINED/BLOCKED) | "System decided X" | Check if decision aligns with intuition | **CORE VALUE** |
| **Action type** | P5-03 actionType field | What action is recommended | "MONITOR" bold label | "System recommends monitoring" | Continue monitoring or investigate further | **CORE VALUE** |
| **Why this decision** | P5-05 explanation.why | Policy rationale | "Why?" section with rationale text | "System decided because..." | Evaluate if rationale is sound | **CORE VALUE** |
| **Confidence** | Re-derived from outcome+status | How sure the system is | Badge (HIGH/MEDIUM/LOW) + meaning | "System is fairly confident" | Calibrate trust level | **CORE VALUE** |
| **What should I do** | Derived from outcome+actionType | Recommended user posture | "What should I do?" section | "I should monitor this" | Take or defer action | **CORE VALUE** |
| **Safety status** | P5-04 safetyResult.aggregate | Whether safety constraints passed | "Safety: Safety checks passed" (in facts) | "No safety concerns" | Trust the recommendation | **SUPPORTING VALUE** |
| **Approval status** | P5-04 approvalState | Whether authorization required | "No approval required (advisory mode)" | "This is advisory, not binding" | Understand system authority | **SUPPORTING VALUE** |
| **Decision history** | Persisted previous decisions | Decision stability/change | Current/Previous with dates | "Decision has been stable" | Identify trend | **SUPPORTING VALUE** |
| **NO_DECISION_RECORD vs NO_ACTION** | read service availability field | Absence vs evaluated-nothing | Explicit availability messaging | "Not evaluated yet" vs "Evaluated, nothing to do" | Wait for evaluation vs confirm no action needed | **SUPPORTING VALUE** |
| **Read-only / Advisory badges** | Panel header | System authority boundary | "Read-only" + "Advisory" badges | "This system advises, doesn't act" | Understand limitation | **SUPPORTING VALUE** |
| **P4 direction** | P4ViewModel.direction | Market direction | **NOT SHOWN in P5 panel** | N/A | Must check P4 panel separately | **MISSING** |
| **P4 confidence** | P4ViewModel.confidence | P4's own confidence | **RE-DERIVED, not passed through** | May differ from P4's assessment | May get different confidence in P4 vs P5 | **MISSING** |
| **P4 opportunity** | P4ViewModel.opportunity | Opportunity assessment | **NOT SHOWN in P5 panel** | N/A | Must check P4 panel | **MISSING** |
| **P4 risk** | P4ViewModel.risk | Risk assessment | **NOT SHOWN in P5 panel** | N/A | Must check P4 panel | **MISSING** |
| **P4 signals** | P4ViewModel.signals | Fired market signals | **NOT SHOWN in P5 panel** | N/A | Must check P4 panel | **MISSING** |
| **P4 explanation items** | P4ViewModel.explanation.items | P4's human-readable explanation | **NOT SHOWN** (P5 has simpler explanation) | N/A | Must check P4 panel | **MISSING** |
| **P4 historical context** | P4ViewModel.historicalContext | Series/trend metadata | **NOT SHOWN** | N/A | Must check P4 panel | **MISSING** |
| **decisionId** | P5DecisionRecord.decisionId | Unique decision identifier | Hidden in technical details | N/A | N/A | **TECHNICAL ONLY** |
| **candidateId** | P5DecisionRecord.candidateId | Policy candidate identifier | Hidden in technical details | N/A | N/A | **TECHNICAL ONLY** |
| **provenance JSON** | P5DecisionRecord.provenance | Full provenance chain | Hidden in technical details | N/A | N/A | **TECHNICAL ONLY** |
| **audit events** | P5DecisionRecord.auditEvents | System audit trail | Hidden in technical details | N/A | N/A | **TECHNICAL ONLY** |

## 2. "What Should I Do?" Guidance Audit

### Guidance per outcome (from source):

| Outcome | Guidance Text | Based on P4/P5 facts? | Differentiated? | Too generic? |
|---|---|---|---|---|
| SELECTED/MONITOR | "Continue monitoring this narrative. No stronger action is recommended by the current decision system." | ✅ outcome=SELECTED + actionType=MONITOR | ⚠️ Same text for all MONITOR regardless of direction/confidence | Partially |
| SELECTED/REVIEW | "Review the available evidence for this narrative. The system has identified patterns that warrant closer examination." | ✅ | ✅ Distinct from MONITOR | No |
| SELECTED/INVESTIGATE | "Investigate this narrative further. The system has detected signals that require deeper analysis." | ✅ | ✅ | No |
| NO_ACTION | "No action is needed at this time. The system will re-evaluate on the next data refresh." | ✅ | ✅ | No |
| NOT_DETERMINED | "The system cannot make a recommendation right now. Wait for more data or check data source availability." | ✅ | ✅ | No |
| BLOCKED | "A policy rule prevents action. Review the policy configuration if you believe this is incorrect." | ✅ | ✅ | No |
| ABSENT | "Wait for the system to process this narrative, or check that data sources are available." | ✅ | ✅ | No |

### Does guidance differentiate by confidence?

**NO.** The guidance text is the same regardless of HIGH/MEDIUM/LOW confidence. The confidence badge + meaning text provides context, but the "What should I do?" section does not adapt.

### Does guidance differentiate by direction?

**NO.** MONITOR guidance is identical whether direction is POSITIVE, NEGATIVE, or MIXED.

### Does guidance differentiate by opportunity/risk?

**NO.** Not surfaced in guidance.

### Does guidance overstate system capability?

**NO.** All guidance uses appropriate hedging ("No stronger action is recommended", "The system cannot make a recommendation", "consider" for consequential actions).

## 3. UI Information Hierarchy Audit

### 5-second comprehension

| Layer | Content | Assessment |
|---|---|---|
| Badge | Display state (SELECTED/NO_ACTION/etc.) | ✅ Clear |
| Posture | Action type (MONITOR) | ✅ Clear |
| Headline | One-sentence decision | ✅ Clear |
| "Why?" | Rationale | ✅ Visible |
| Confidence | Badge + meaning | ✅ Visible |
| "What should I do?" | Guidance | ✅ Visible |

**5-second: PASS.** User can answer: What did the system decide? Why? What should I do?

### 30-second comprehension

| Layer | Content | Assessment |
|---|---|---|
| "How the system decided" | Structured facts | ✅ Visible |
| Decision history | Current/Previous | ✅ Visible (if available) |
| Availability messaging | Absence context | ✅ Visible (when no decision) |

**30-second: PASS.** User can understand the reasoning chain and history.

### Deep technical inspection

| Layer | Content | Assessment |
|---|---|---|
| Technical details (collapsed) | decisionId, outcome, actionType, safety, approval, permission, execution, policy version, rules, audit events, provenance JSON | ✅ Available on demand |

**Deep inspection: PASS.** Full audit trail accessible.

### Information Hierarchy Issues

| Issue | Severity | Classification |
|---|---|---|
| P4 direction not shown | Medium | **B — Product enhancement** |
| P4 confidence re-derived | Medium | **B — Product enhancement** |
| P4 signals not shown | Low | **C — Future/P6** |
| P4 opportunity/risk not shown | Low | **C — Future/P6** |
| P4 historical context not shown | Low | **D — Noise (V1)** |
| P4 explanation items not shown | Low | **D — Noise (V1)** |

## 4. Duplication Audit

| Concern | P4 Panel | P5 Panel | Duplication? |
|---|---|---|---|
| Direction | Shows POSITIVE/NEGATIVE badge | NOT shown | No duplication — P4 only |
| Confidence | Shows P4 confidence badge | Shows re-derived confidence | **Potential confusion** — different values |
| Opportunity/Risk | Shows qualitative badges | NOT shown | No duplication |
| Signals | Shows signal chips | NOT shown | No duplication |
| Explanation | Shows P4 explanation items | Shows P5 explanation (simpler) | **Different content** — not duplication |
| Evidence | Shows evidence traceability | NOT shown | No duplication |
| Decision outcome | NOT in P4 | Shows in P5 | No duplication — P5 only |

**The P4 panel and P5 panel show complementary information.** The main concern is that P4 confidence and P5 confidence may show different values for the same narrative, which could confuse users.

## 5. Remaining Gap Classification

### A — Completion Blocker (must fix before closing)

**NONE.** No class A gaps found.

### B — Product Enhancement (worth fixing in P4-P5)

| Gap | Description | Impact |
|---|---|---|
| B1 | P4 confidence re-derived, not passed through | User may see different confidence in P4 vs P5 panel |
| B2 | P4 direction not surfaced in P5 panel | User must check two panels for complete picture |
| B3 | MONITOR guidance doesn't differentiate by direction/confidence | All MONITOR states look the same |

### C — Future/P6

| Gap | Description |
|---|---|
| C1 | P4 signals not surfaced in P5 panel |
| C2 | P4 opportunity/risk not surfaced in P5 panel |
| C3 | Trend/rotation intelligence in decision history |

### D — Not Needed / Noise

| Gap | Description |
|---|---|
| D1 | P4 historical context in P5 panel |
| D2 | P4 explanation items in P5 panel |
| D3 | P4 evidence traceability in P5 panel |

## 6. Frozen Items Audit

| Item | Current Status | Classification | Can freeze? |
|---|---|---|---|
| contentHash | PROVISIONAL (always null) | **D — Not needed for V1** | ✅ Yes — decisionId unaffected |
| Permission artifact gap | OPEN (V1 by-design) | **D — V1 advisory** | ✅ Yes — V1 has no execution |
| Real PostgreSQL E2E | ENVIRONMENT BLOCKER | **B — Worth verifying** | ⚠️ Can freeze with caveat |
| P4 confidence pass-through | Not implemented | **B — Product enhancement** | ⚠️ Can defer to enhancement task |
