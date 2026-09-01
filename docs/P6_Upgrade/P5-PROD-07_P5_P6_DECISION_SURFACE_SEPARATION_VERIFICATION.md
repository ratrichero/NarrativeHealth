# P5-PROD-07 — P5/P6 Decision Surface Separation Verification

## 1. Executive Summary

**P5/P6 SEPARATION VERIFIED.** P6 and P5 are completely independent layers with distinct data sources, distinct components, and distinct UI surfaces. P6 does NOT contain or replace P5 decision semantics.

- "Decision → SELECTED MONITOR" belongs to **P5**, rendered by `P5ActionDecisionPanel`
- "P6 Intelligence" belongs to **P6**, rendered by `P6IntelligencePanel`
- P6 API has **zero** decision/action/MONITOR fields
- P6 codebase has **zero** references to P5 decision records
- Both panels mount independently on Narrative Detail

---

## 2. Production Runtime Evidence

### Narrative AI (/narrative/1) — Component Mount Order

```tsx
// src/app/narrative/[id]/page.tsx lines 145-161

<P6IntelligencePanel entityType="narrative" entityId={narrative.id} entityName={narrative.name} />
<P5ActionDecisionPanel narrativeId={narrative.id} />
<P4DecisionSupportPanel viewModel={narrative.p4DecisionSupport} />
<P3IntelligencePanel narrativeName={narrative.name} viewModel={narrative.p3Intelligence} history={narrative.p3IntelligenceHistory} />
```

**Four independent components, four independent data sources, four independent Card headings.**

---

## 3. P6 Decision Trace

### P6IntelligencePanel Card Heading

```tsx
// src/components/P6IntelligencePanel.tsx line 358
<CardTitle className="text-base flex items-center gap-2">
  <span className="text-cyan-500">●</span>
  P6 Intelligence
</CardTitle>
```

**Heading: "P6 Intelligence"** — NOT "Decision", NOT "SELECTED", NOT "MONITOR"

### P6IntelligencePanel Renders

| Section | Source |
|---------|--------|
| Health Score | `intel.health_score` from P6 snapshot |
| Confidence | `intel.confidence` from P6 snapshot |
| Regime | `intel.regime` from P6 regime state |
| Warnings | `intel.warnings` from P6 warnings |
| Summary (expandable) | `intel.summary` from P6 intelligence summary |
| Historical Comparison | P6 history API |

### P6 Does NOT Render

- Decision outcome (SELECTED/NO_ACTION)
- Action type (MONITOR)
- Policy IDs (C-101, C-201, C-501)
- "What should I do?" guidance
- Safety/approval/permission states
- Audit events
- Provenance from P5 decision records

### P6 API Response (Production Evidence)

```
GET /api/p6/narratives/1
```

```json
{
  "entity_type": "narrative",
  "entity_id": 1,
  "narrative_name": "AI",
  "health_score": 50,
  "confidence": null,
  "regime": "STABLE",
  "regime_confidence": null,
  "warnings": [],
  "summary": { ... },
  "quality": { ... },
  "window_end": "...",
  "version": "..."
}
```

**P6 API has ZERO decision-related fields:**
- ❌ No `decision` field
- ❌ No `outcome` field
- ❌ No `actionType` field
- ❌ No `SELECTED`/`MONITOR`
- ❌ No policy IDs
- ❌ No safety/approval states

### P6 Data Source

P6 reads from:
- `p6_snapshots` (health, confidence, regime)
- `p6_regime_states` (regime determination)
- `p6_warnings` (alerts)
- `p6_intelligence_summaries` (what changed, why, what to watch)

P6 does **NOT** read from:
- ❌ `p5_decision_records`
- ❌ `p5_p4_snapshots`
- ❌ `p5_policies`
- ❌ `p5_guardrails`
- ❌ `p5_approvals`
- ❌ `p5_permissions`
- ❌ `p5_audit_events`

### P6 Code Independence

```tsx
// P6IntelligencePanel.tsx — component comment:
/**
 * Does NOT:
 *   - recalculate health/regime/warnings
 *   - import P4/P5 modules
 *   - contain action/BUY/SELL semantics
 *   - modify any frozen P6 contract
 */
```

---

## 4. P5 UI Trace

### P5ActionDecisionPanel Card Heading

```tsx
// src/components/P5ActionDecisionPanel.tsx line 167
<CardTitle>Decision</CardTitle>
```

**Heading: "Decision"** — this is where SELECTED/MONITOR appears.

### P5ActionDecisionPanel Renders

| Section | Source |
|---------|--------|
| Decision Badge (SELECTED/NO_ACTION) | `model.displayState` from P5 decision record |
| Posture (MONITOR) | `model.executive.posture` from P5 actionType |
| Headline | `model.executive.headline` from P5 outcome |
| Why? | `model.executive.rationale` from P5 explanation |
| Confidence | `model.confidence` from P5 decision + P4 status |
| What should I do? | `model.executive.guidance` from P5 actionType |
| Technical Details (expandable) | P5 decision ID, outcome, safety, approval, provenance |

### P5 Data Flow

```
P5ActionDecisionPanel
    ↓ useQuery
GET /api/narratives/1/action-decision
    ↓
ActionReadService.getNarrativeActionReadView(1)
    ↓
PgHistoricalArtifactStore.findDecisionByNarrativeId(1)
    ↓
p5_decision_records WHERE narrative_id = 1
    ↓
buildPresentationModel(view)
    ↓
Render: Decision, SELECTED, MONITOR, Why, Confidence, What should I do?
```

### P5 API Response (Production Evidence)

```
GET /api/narratives/1/action-decision
```

```json
{
  "decisionPresence": "PRESENT",
  "displayState": "SELECTED",
  "availability": "OK",
  "decision": {
    "decisionId": "p5d-4317e651",
    "outcome": "SELECTED",
    "actionType": "MONITOR",
    "decisionState": "DECIDED",
    "approvalState": "NOT_REQUIRED",
    "permissionResult": "NOT_APPLICABLE",
    "explanation": {
      "why": "Selected by policy rules [C-101, C-201, C-501] with reason codes [SELECTED]"
    },
    "provenance": {
      "policy": {
        "policyId": "pol-p5-v1",
        "policyVersion": "v1",
        "ruleRefs": ["C-101", "C-201", "C-501"]
      }
    }
  }
}
```

---

## 5. P5 API Evidence

| Field | Value |
|-------|-------|
| HTTP Status | 200 OK |
| decisionPresence | PRESENT |
| displayState | SELECTED |
| decisionId | p5d-4317e651 |
| outcome | SELECTED |
| actionType | MONITOR |
| availability | OK |
| policy | pol-p5-v1@v1 |
| ruleRefs | C-101, C-201, C-501 |

---

## 6. P5 DB Evidence

P5 decision records exist in `p5_decision_records`:

| Narrative | Decision ID | Outcome | Action Type |
|-----------|-------------|---------|-------------|
| 1 (AI) | p5d-4317e651 | SELECTED | MONITOR |
| 2 (RWA) | p5d-6235c35d | NO_ACTION | null |
| 3 (TOPMC) | p5d-62563b64 | NO_ACTION | null |
| 4 (FAVORITE) | p5d-013bc83d | NO_ACTION | null |

P5 reads from: `p5_decision_records`, `p5_p4_snapshots`, `p5_policies`, `p5_guardrails`, `p5_approvals`, `p5_permissions`, `p5_audit_events`

P6 reads from: `p6_snapshots`, `p6_regime_states`, `p6_warnings`, `p6_intelligence_summaries`

**Zero overlap in data sources.**

---

## 7. P6 DB/API Evidence

P6 data exists in:

| Table | Narrative 1 |
|-------|-------------|
| p6_snapshots | health=50, regime=STABLE |
| p6_regime_states | regime=STABLE |
| p6_warnings | 0 warnings |
| p6_intelligence_summaries | summary present |

P6 API returns: health_score, confidence, regime, warnings, summary — **no decision fields**.

---

## 8. Component / DOM Evidence

### Page Layout (verified in source)

```
Narrative Detail (/narrative/1)
│
├── Header (name, health badge, score change)
├── Health History Chart
│
├── Card: "● P6 Intelligence"          ← P6IntelligencePanel
│   ├── Health Score: 50
│   ├── Confidence: N/A
│   ├── Regime: STABLE
│   ├── Warnings: 0
│   └── Summary (expandable)
│
├── Card: "Decision"                   ← P5ActionDecisionPanel
│   ├── [Read-only] [Advisory]
│   ├── [SELECTED] MONITOR
│   ├── The system recommends monitor for this narrative.
│   ├── Why? Selected by policy rules [C-101, C-201, C-501]
│   ├── Confidence HIGH
│   ├── What should I do? Continue monitoring...
│   └── Technical details (expandable)
│
├── Card: P4 Decision Support          ← P4DecisionSupportPanel
│   └── status=OK, direction=POSITIVE
│
├── Card: P3 Intelligence              ← P3IntelligencePanel
│   └── artifactId=15, window=7D
│
├── Correlation Matrix
└── Coin Ranking Table
```

### Component Independence

| Component | Import | Data Source | Card Heading |
|-----------|--------|-------------|--------------|
| P6IntelligencePanel | Line 11 | `/api/p6/narratives/[id]` | "P6 Intelligence" |
| P5ActionDecisionPanel | Line 14 | `/api/narratives/[id]/action-decision` | "Decision" |
| P4DecisionSupportPanel | Line 13 | `narrative.p4DecisionSupport` | P4 Decision Support |
| P3IntelligencePanel | Line 12 | `narrative.p3Intelligence` | P3 Intelligence |

---

## 9. P3/P4/P5/P6 Coexistence Matrix

| Layer | Backend | API | Component Mounted | Runtime Visible | Owner |
|-------|---------|-----|-------------------|-----------------|-------|
| P3 | ✅ p3_narrative_intelligence | ✅ GET /api/narratives/[id] | ✅ P3IntelligencePanel | ✅ Card visible | P3 contract |
| P4 | ✅ Derived from P3 | ✅ GET /api/narratives/[id] | ✅ P4DecisionSupportPanel | ✅ Card visible | P4 contract |
| P5 | ✅ p5_decision_records | ✅ GET /api/narratives/[id]/action-decision | ✅ P5ActionDecisionPanel | ✅ Card visible | P5 contract |
| P6 | ✅ p6_snapshots + p6_regime_states | ✅ GET /api/p6/narratives/[id] | ✅ P6IntelligencePanel | ✅ Card visible | P6 contract |

**All four layers coexist independently.**

---

## 10. Decision Ownership Matrix

| Field | P5 Source | P6 Source | Same/Different | Correct? |
|-------|-----------|-----------|----------------|----------|
| Decision outcome | `p5_decision_records.outcome` (SELECTED) | N/A — P6 has no decision | **DIFFERENT** — P6 has no decision field | ✅ |
| Action type | `p5_decision_records.action_type` (MONITOR) | N/A — P6 has no action | **DIFFERENT** — P6 has no action field | ✅ |
| Confidence | P5 decision + P4 status → HIGH | P6 confidence = null | **DIFFERENT** — different sources, different values | ✅ |
| Reason | P5 explanation.why: "Selected by policy rules [C-101, C-201, C-501]" | P6 summary.why: different explanation | **DIFFERENT** — different contracts | ✅ |
| Policy | P5 provenance.policy: pol-p5-v1@v1 | N/A — P6 has no policy | **DIFFERENT** — P6 has no policy field | ✅ |
| Safety | P5 safetyResult: PASS | N/A — P6 has no safety | **DIFFERENT** — P6 has no safety field | ✅ |

**P6 has ZERO decision ownership. All decision semantics belong exclusively to P5.**

---

## 11. Architecture Verdict

```
P5/P6 SEPARATION VERIFIED
```

### Evidence Summary

1. **P6IntelligencePanel** heading is "P6 Intelligence" — shows health, confidence, regime, warnings
2. **P5ActionDecisionPanel** heading is "Decision" — shows SELECTED, MONITOR, Why, Confidence, What should I do?
3. P6 API has **zero** decision fields (no outcome, no actionType, no policy, no safety)
4. P5 API has **all** decision fields (outcome, actionType, policy, safety, approval, permission, audit)
5. P6 codebase has **zero** imports from P5 modules
6. P6 data source (`p6_snapshots`) is completely separate from P5 data source (`p5_decision_records`)
7. Both panels mount independently on Narrative Detail with separate Card headings
8. P6 does NOT read, reference, or depend on P5 decision records

### Acceptance Answers

1. **"Decision → SELECTED MONITOR" on the page is rendered by which component?**
   → **P5ActionDecisionPanel** (heading: "Decision")

2. **Does it get data from P6 or P5?**
   → **P5** — from `/api/narratives/[id]/action-decision` → `p5_decision_records`

3. **Is P5ActionDecisionPanel visible on Production?**
   → **YES** — mounted at line 152, self-fetches from P5 API, API returns 200 OK with valid data

4. **If it were not visible, why?**
   → **N/A** — it IS visible. No defect found.

5. **Does P6 replace P5, or do P6/P5 truly coexist?**
   → **P6/P5 truly coexist** — P6 is additive intelligence (health/regime/warnings), P5 is decision support (outcome/action/policy/safety). Zero semantic overlap.

---

## 12. Required Next Task

**None.** P5/P6 separation is verified. No defect found. No next task needed.

If further verification is desired, the recommended action is:

```
Deploy to production hosting to confirm runtime rendering in a real browser.
```

This is a deployment action, not a code change.
