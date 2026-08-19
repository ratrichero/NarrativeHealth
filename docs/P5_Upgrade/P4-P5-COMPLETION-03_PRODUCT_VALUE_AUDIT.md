# P4-P5-COMPLETION-03 — PRODUCT VALUE AUDIT

**Date:** 2026-08-19
**Objective:** Answer the original question — what value do P4+P5 actually deliver to users, and how well is that value expressed on UI?

---

## 1. What the User Sees

When a user navigates to a Narrative Detail page, they see (top to bottom):

1. **Health Score History** chart
2. **P3 Intelligence** panel (trend analysis)
3. **P4 Decision Support** panel
4. **P5 Action Decision** panel
5. **Correlation Heatmap**
6. **Coin Ranking Table**

P4 and P5 are panels 3 and 4 in the vertical flow. The user scrolls past them to reach coin data.

## 2. P4 Decision Support — What It Actually Shows

### Visible Elements

| Element | Rendered As | User Meaning |
|---|---|---|
| Direction | Large colored badge: POSITIVE / NEGATIVE / MIXED / NEUTRAL / UNKNOWN | "The narrative is trending this way" |
| Confidence | Qualitative badge: HIGH / MEDIUM / LOW / UNKNOWN | "How sure are we about this direction" |
| Actionability | Qualitative badge: HIGH / MEDIUM / LOW / UNKNOWN | "Is there something actionable here" |
| Signals | Chips: "NARRATIVE_IMPROVEMENT Direction POSITIVE" | "What patterns triggered this assessment" |
| Opportunity | Qualitative badge: HIGH / MEDIUM / LOW / UNKNOWN | "Upside potential" |
| Risk | Qualitative badge (inverted colors): HIGH / MEDIUM / LOW / UNKNOWN | "Downside exposure" |
| Historical Context | Text: "Series of N artifacts · M steps · overall trend X · sufficient/insufficient" | "How much data backs this" |
| Why? (collapsible) | Explanation items with role badges (Primary / Conflicting / Contextual / Caveat) | "What reasoning led here" |
| Evidence (collapsible) | Reference rows with role, status, sourceType, field, window | "What data points support this" |

### What the User CAN Understand from P4

- **The narrative direction** — clear, visual, immediate
- **Confidence level** — qualitative, interpretable
- **What signals fired** — named patterns with direction
- **Opportunity vs Risk** — at a glance
- **The reasoning chain** — if they expand "Why?"

### What the User CANNOT Easily Understand from P4

- **Which specific evidence items matter most** — raw reference rows don't rank or highlight
- **How to act on this information** — no "so what" summary
- **Whether this is changing** — no trend within the P4 panel itself (external chart exists)

## 3. P5 Action Decision — What It Actually Shows

### Visible Elements (When Decision EXISTS)

| Element | Rendered As | User Meaning |
|---|---|---|
| Display State badge | SELECTED / NO_ACTION / NOT_DETERMINED / etc. | "What the system decided" |
| Availability | Green "OK" badge | "Record is readable" |
| State dimensions | 3 chips: decision / approval / execution | "Three orthogonal states" |
| Decision ID | Raw string: "p5d-abc12345" | Internal identifier |
| Candidate ID | Raw string: "cand-1" | Internal identifier |
| Action ID | "— (created only if SELECTED)" | Internal identifier |
| Outcome | Raw string: SELECTED / NO_ACTION / NOT_DETERMINED | "Policy outcome" |
| Action type | MONITOR / REVIEW / etc. | "What kind of action" |
| Parameters | Raw JSON: `{}` | Empty in V1 |
| "Why" section | Text: what + why from explanation record | "Policy rationale" |
| Policy | Version string: "v1" + rule refs: "C-101, C-201, C-501" | "Which rules applied" |
| Safety / guardrail | "PASS" + empty guardrail list | Safety status |
| Approval | "NOT_REQUIRED" | Approval status |
| Execution permission | "NOT_APPLICABLE" | Permission status |
| Execution result | "NOT_APPLICABLE" | Execution status |
| Audit history | "No audit events recorded." | Audit trail |
| Provenance | Raw JSON blob of full provenance record | Technical traceability |

### Visible Elements (When Decision is ABSENT)

| Element | Rendered As | User Meaning |
|---|---|---|
| Display State | "ABSENT" badge | "No decision exists" |
| Availability | "NO_DECISION_RECORD" | "No record found" |
| P4 context | "P4 status: OK · as of 2026-08-19" + raw JSON snapshot | Current P4 state (labeled "not a decision basis") |
| Explanatory note | "No decision record exists. This is an absence of records — not a completed NO_ACTION evaluation" | Correct disambiguation |

---

## 4. User-Value Assessment Matrix

| Capability | Has Data? | UI Shows It? | User Understands? | Actual Value |
|---|---|---|---|---|
| **P4 Direction** | ✅ Yes | ✅ Large badge | ✅ Yes — clear visual | **VALUE DELIVERED** — immediate signal about narrative trajectory |
| **P4 Confidence** | ✅ Yes | ✅ Badge | ✅ Yes — qualitative | **VALUE DELIVERED** — helps calibrate trust in the signal |
| **P4 Actionability** | ✅ Yes | ✅ Badge | ⚠️ Partial — no "so what" | **TECHNICALLY PRESENT / LOW USER VALUE** — user sees it but doesn't know what to do with it |
| **P4 Signals** | ✅ Yes | ✅ Chips with direction | ⚠️ Partial — technical labels | **TECHNICALLY PRESENT / LOW USER VALUE** — "NARRATIVE_IMPROVEMENT" is meaningful but doesn't tell user what to do |
| **P4 Opportunity / Risk** | ✅ Yes | ✅ Badges | ✅ Yes — intuitive | **VALUE DELIVERED** — helps risk assessment |
| **P4 Explanation (Why?)** | ✅ Yes | ✅ Collapsible section | ⚠️ Partial — role-labeled items | **UI PRESENT BUT WEAK** — items are explanation statements, not actionable insights |
| **P4 Evidence Traceability** | ✅ Yes | ✅ Collapsible section | ❌ No — raw references | **BACKEND ONLY** — valuable for audit, not for user decision-making |
| **P4 Historical Context** | ✅ Yes | ✅ Text line | ⚠️ Partial — metadata | **TECHNICALLY PRESENT / LOW USER VALUE** — series length doesn't drive action |
| **P5 Decision Outcome** | ✅ Yes | ✅ Display state badge | ✅ Yes — clear state | **VALUE DELIVERED** — user knows what the system decided |
| **P5 Action Type** | ✅ Yes | ✅ Row | ✅ Yes — "MONITOR" is clear | **VALUE DELIVERED** — user knows what category of action |
| **P5 "Why" (Explanation)** | ✅ Yes | ✅ Section with what/why | ⚠️ Partial — template text | **UI PRESENT BUT WEAK** — "MONITOR selected for narrative 1" is correct but thin |
| **P5 Safety** | ✅ Yes (PASS) | ✅ Card | ❌ No — always PASS in V1 | **BACKEND ONLY** — no real safety evaluation happening yet |
| **P5 Approval** | ✅ Yes (NOT_REQUIRED) | ✅ Card | ❌ No — always NOT_REQUIRED in V1 | **BACKEND ONLY** — no approval workflow yet |
| **P5 Permission** | ✅ Yes (NOT_APPLICABLE) | ✅ Row | ❌ No — always NOT_APPLICABLE in V1 | **BACKEND ONLY** — no execution permission yet |
| **P5 Audit Events** | ✅ Yes (empty) | ✅ "No audit events recorded." | ❌ No — empty in V1 | **BACKEND ONLY** — infrastructure for future |
| **P5 Provenance** | ✅ Yes | ✅ Raw JSON | ❌ No — developer-facing | **BACKEND ONLY** — valuable for debugging, not for users |
| **P5 Decision ID** | ✅ Yes | ✅ Row | ❌ No — internal ID | **BACKEND ONLY** — useful for support, not for users |
| **P5 Candidate/Action ID** | ✅ Yes | ✅ Row | ❌ No — internal ID | **BACKEND ONLY** — infrastructure identifiers |
| **NOT_DETERMINED state** | ✅ Yes | ✅ Yellow badge | ✅ Yes — clear "couldn't determine" | **VALUE DELIVERED** — honest uncertainty |
| **NO_DECISION_RECORD** | ✅ Yes | ✅ ABSENT badge + note | ✅ Yes — "absence, not action" | **VALUE DELIVERED** — correct disambiguation |
| **DEGRADED / NO_EVIDENCE** | ✅ Yes | ✅ P4 context preserved | ⚠️ Partial — raw status | **UI PRESENT BUT WEAK** — status shown but no guidance |
| **Advisory-only boundary** | ✅ Yes | ✅ Footer note | ✅ Yes — "no execution mechanism" | **VALUE DELIVERED** — manages expectations |

## 5. Summary Count

| Classification | Count | Capabilities |
|---|---|---|
| **VALUE DELIVERED** | 8 | Direction, Confidence, Opportunity/Risk, Decision Outcome, Action Type, NOT_DETERMINED, NO_DECISION_RECORD, Advisory boundary |
| **TECHNICALLY PRESENT / LOW USER VALUE** | 4 | Actionability, Signals, Historical Context, Explanation (thin) |
| **UI PRESENT BUT WEAK** | 3 | Explanation items, DEGRADED/NO_EVIDENCE, P4 Explanation "Why?" |
| **BACKEND ONLY** | 8 | Safety (V1 empty), Approval (V1 empty), Permission (V1 empty), Audit (V1 empty), Provenance JSON, Decision ID, Candidate/Action ID, Evidence references |

---

## 6. UX Quality Assessment

### 6.1 What Users CAN Understand

A user reading the P4+P5 panels can answer:

1. ✅ "Is this narrative improving or declining?" → Direction badge
2. ✅ "How confident is the system?" → Confidence badge
3. ✅ "What's the opportunity vs risk?" → Opportunity/Risk badges
4. ✅ "What did the policy decide?" → Display state badge
5. ✅ "What kind of action?" → Action type (MONITOR)
6. ✅ "Is this a recommendation or an execution?" → "Advisory-only" badge + footer
7. ✅ "Is the system uncertain?" → NOT_DETERMINED badge
8. ✅ "Is there a decision at all?" → ABSENT vs PRESENT

### 6.2 What Users CANNOT Easily Answer

1. ❌ "What should I DO about this narrative?" → No executive summary / action recommendation
2. ❌ "Why did the system choose MONITOR over INVESTIGATE?" → Explanation is template-level ("snapshot present, direction usable"), not comparative
3. ❌ "What evidence matters MOST?" → Evidence list is flat, no ranking or highlighting
4. ❌ "Is the safety/approval/permission system working?" → Always shows PASS/NOT_REQUIRED/NOT_APPLICABLE — user can't tell if these are real evaluations or placeholders
5. ❌ "Has this decision changed over time?" → No decision history / timeline
6. ❌ "What happens if I ignore this?" → No consequence framing
7. ❌ "How does this compare to other narratives?" → Panel is narrative-scoped only

### 6.3 Raw Technical Data Problem

The P5 panel shows significant amounts of developer-facing data that create noise for end users:

| Shown to User | User Value | Classification |
|---|---|---|
| `Decision ID: p5d-abc12345` | Zero — internal only | Noise |
| `Candidate ID: cand-1` | Zero — internal only | Noise |
| `Action ID: — (created only if SELECTED)` | Zero — implementation detail | Noise |
| `State dimensions (orthogonal — not one status)` | Negative — confusing label | Anti-pattern |
| `Acknowledging an alert or a P2 evidence status is NOT approval.` | Negative — defensive engineering note | Anti-pattern |
| `Permission is an authorization result — it is not execution.` | Negative — defensive engineering note | Anti-pattern |
| Full provenance JSON blob | Zero for users | Noise |
| `"evaluationAt": "evaluated"` (literal string) | Negative — confusing | Bug-level |
| Empty audit events section | Zero — always empty in V1 | Noise |

The panel was built by engineers for engineers. It is correct at the data level but hostile to end-user comprehension.

### 6.4 The "Why?" Gap

The most important question a user can ask is "Why?" and P5's answer is:

> "MONITOR selected for narrative 1"
> "Policy rule C-201: snapshot present, direction usable"

This is technically correct but not useful. A user wants:

> "The system recommends monitoring this narrative because the data snapshot is current and the market direction is identifiable, but the evidence isn't strong enough for a more active recommendation."

The current explanation is a system log, not a user-facing explanation.

---

## 7. Gap Classification

### A — Must Fix Now

**None identified as blocking P4/P5 completion.**

The existing panels are functionally correct and architecturally sound. No defect prevents P4/P5 from being declared complete at the implementation level.

### B — Product Enhancement (High Value, Not Blocking)

| Gap | Impact | Effort |
|---|---|---|
| **Executive summary / action recommendation** | User doesn't know what to do with the data | Medium — needs UX design |
| **Plain-language "Why?" section** | Current explanation is system-log quality | Medium — template rewrite |
| **Decision timeline / history** | User can't see how decisions evolve | Medium — needs P5-07 replay UI |
| **Uncertainty guidance** | NOT_DETERMINED / DEGRADED don't tell user what to do | Low — add guidance text |
| **Hide internal IDs from non-technical users** | Decision ID / Candidate ID / Action ID are noise | Low — conditional rendering |
| **Remove defensive engineering notes** | "NOT approval" / "NOT execution" notes confuse users | Low — move to tooltip or remove |
| **Fix "evaluationAt: evaluated" literal** | Confusing metadata string | Low — use actual timestamp |

### C — Future / P6

| Gap | Why Future |
|---|---|
| Cross-narrative comparison | Requires dashboard-level aggregation |
| Execution workflow | Requires P6 execution semantics |
| Real safety evaluation | Requires guardrails to be implemented |
| Approval workflow | Requires approval engine |
| Permission enforcement | Requires execution permission model |

### D — Not Needed

| Item | Why Not Needed |
|---|---|
| Evidence reference ranking | Current flat list is acceptable for V1 |
| Provenance JSON in UI | Valuable for debugging, acceptable as-is |
| Audit event timeline | Empty in V1, infrastructure ready for future |

---

## 8. Final Conclusion

**P4-P5 IMPLEMENTATION CLOSED BUT PRODUCT VALUE GAPS REMAIN**

The P4+P5 implementation is architecturally complete and technically correct. All frozen contracts are honored, all capabilities are wired end-to-end, and the UI renders all data without semantic corruption.

However, the **product value delivered to end users is concentrated in a narrow band**: Direction, Confidence, Opportunity/Risk (from P4), and Decision Outcome + Action Type (from P5). These are genuinely valuable — they answer "what's happening?" and "what did the system decide?"

The remaining capabilities — Explanation, Safety, Approval, Permission, Provenance, Audit, Evidence — exist in the UI but deliver **low or zero user value** in their current form. They are either V1 placeholders (Safety/Approval/Permission always show PASS/NOT_REQUIRED/NOT_APPLICABLE), raw technical data (provenance JSON, decision IDs), or defensively engineered notes that confuse rather than inform.

The most impactful gap is the **absence of an executive summary** — a plain-language "here's what this means for you" section that translates the system's technical decision into actionable guidance. Without this, users see data but don't know what to do with it.

**This does not block P4/P5 closure.** The implementation delivers real value (direction, confidence, decision outcome) and the remaining gaps are product enhancement opportunities, not completion defects.
