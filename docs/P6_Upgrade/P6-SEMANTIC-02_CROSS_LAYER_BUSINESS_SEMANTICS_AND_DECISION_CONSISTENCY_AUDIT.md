# P6-SEMANTIC-02 — Cross-Layer Business Semantics & Decision Consistency Audit

**Date:** 2026-09-01
**Auditor:** Buffy (Codebuff)
**Scope:** P3 → P4 → P5 → P6 semantic chain production verification
**Method:** Source code trace + live production API evidence
**Data:** 9 active narratives, 5 with full P3/P4/P5 data

---

## 1. Executive Summary

**The cross-layer chain is architecturally sound but has two significant semantic tensions:**

1. **P6 health score = 50 (neutral) for ALL narratives** because coin-level features are missing, causing every narrative to receive the SNAPSHOT_NEUTRAL_SCORE. This makes P6's STABLE regime universally true regardless of what P3/P4/P5 are actually reporting — a significant semantic gap.

2. **P5 is forced to NO_ACTION for 4/5 narratives** not because the action is genuinely "no action needed," but because P4 direction = UNKNOWN (insufficient P3 history), which makes MONITOR ineligible per the P5 policy contract. P5 correctly implements its frozen contract — but the upstream data gap cascades into a default state that could be misinterpreted.

**No frozen contracts were violated.** All observed behavior is consistent with the codebase design. The tensions are upstream data coverage issues, not logic errors.

---

## 2. Architecture / Semantic Chain

### 2.1 Intended Chain

```text
Raw market data
    ↓
Indicators (trend, momentum, volume, derivative)
    ↓
P3 — "What is happening?"
  • Regime (STRENGTHENING / NEUTRAL / WEAKENING / DETERIORATING)
  • Rotation (INFLOW / STABLE / OUTFLOW / ACCELERATING / DECELERATING)
  • Momentum (1d, 3d, 7d, 14d + acceleration)
  • Breadth (0–1 ratio)
  • Relative Strength vs BTC
    ↓
P4 — "What does it mean?"
  • Direction (POSITIVE / NEGATIVE / UNKNOWN)
  • Confidence (HIGH / MEDIUM / LOW / UNKNOWN)
  • Actionability (HIGH / MEDIUM / LOW / UNKNOWN)
  • Opportunity / Risk assessment
  • Evidence signals
  • Explanation
    ↓
P5 — "What should be done?"
  • DecisionOutcome (SELECTED / NO_ACTION / BLOCKED / NOT_DETERMINED)
  • ActionType (MONITOR / REVIEW / CONSEQUENTIAL / REBALANCE)
  • Policy evaluation (C-101, C-201, C-201, C-501)
  • Safety / Guardrail / Approval
    ↓
P6 — "Intelligence aggregation / higher-level view"
  • Health score (market-cap weighted)
  • Regime state (STRONG / STABLE / WEAK)
  • Warnings
  • Intelligence summaries
```

### 2.2 Actual Chain (Verified)

```text
Indicators → P3 → P4 → P5 (correct chain)
Indicators → P6 (independent coin health → narrative health aggregation)
```

P6 does NOT consume P3/P4/P5. P6 independently computes health from coin-level features.
P3/P4/P5 form an independent decision chain.

---

## 3. P3 Semantics Audit

### 3.1 P3 Produced States (Production Evidence)

| Narrative | Regime | Rotation | Rotation Score | Breadth | Momentum 1d | RelStrength 1d |
|-----------|--------|----------|----------------|---------|-------------|----------------|
| 1 (AI) | NEUTRAL | INFLOW | 67.03 | 0.000 | +12.90 | -0.145 |
| 2 (DEFI) | NEUTRAL | ACCELERATING | 70.22 | 1.000 | +16.53 | — |
| 3 (FAVORITE) | WEAKENING | STABLE | 46.34 | 0.167 | -3.97 | — |
| 4 (LAYER2) | WEAKENING | DECELERATING | 41.71 | 0.500 | -10.21 | — |
| 6 (RESTAKING) | WEAKENING | STABLE | 51.93 | 0.000 | -1.81 | — |
| 7–10 | N/A | N/A | — | — | — | — |

### 3.2 P3 Semantic Accuracy

| Metric | Semantic Definition | Evidence | Accurate? |
|--------|-------------------|----------|-----------|
| NEUTRAL | Between strengthening/weakening thresholds | N1 momentum +12.9 but breadth 0 → mixed signals | ✅ Correct |
| WEAKENING | Negative momentum + declining breadth | N3-N6 all have negative momentum + low breadth | ✅ Correct |
| INFLOW | Rotation score 55–70 | N1 score 67.03 → INFLOW | ✅ Correct |
| ACCELERATING | Rotation score ≥ 70 | N2 score 70.22 → ACCELERATING | ✅ Correct |
| STABLE | Rotation score 45–55 | N3=46.34, N6=51.93 → STABLE | ✅ Correct |
| DECELERATING | Rotation score < 45 | N4=41.71 → DECELERATING | ✅ Correct |

### 3.3 P3 Semantic Verdict

**P3 classifications are semantically consistent with their frozen definitions.** No rule violations.

---

## 4. P4 Semantics Audit

### 4.1 P4 Produced States

| Narrative | Direction | Confidence | Actionability | P3 Input |
|-----------|-----------|------------|---------------|----------|
| 1 (AI) | POSITIVE | MEDIUM | MEDIUM | NEUTRAL+INFLOW → improving |
| 2 (DEFI) | UNKNOWN | LOW | UNKNOWN | NEUTRAL+ACCELERATING → insufficient history |
| 3 (FAVORITE) | UNKNOWN | LOW | UNKNOWN | WEAKENING+STABLE → insufficient history |
| 4 (LAYER2) | UNKNOWN | LOW | UNKNOWN | WEAKENING+DECELERATING → insufficient history |
| 6 (RESTAKING) | UNKNOWN | LOW | UNKNOWN | WEAKENING+STABLE → insufficient history |

### 4.2 P4 Semantic Analysis

**N1: POSITIVE/MEDIUM** — P3 regime moved from WEAKENING → NEUTRAL (positive change), rotation INFLOW (positive), but momentum is mixed (+12.9 but breadth=0). P4 correctly identifies the improving trend but caps confidence at MEDIUM due to breadth gap.

**N2–N6: UNKNOWN** — P4's `interpretP4()` requires sufficient P3 historical context (multiple prior snapshots to establish trend). When the P3 history series is too short or has insufficient steps, the assembly returns `status: "DEGRADED"` with `direction: "UNKNOWN"`. This is correct per P4-02 §9/§10 failure isolation.

### 4.3 P4 Semantic Verdict

**P4 UNKNOWN is a correct fallback for insufficient data, not a semantic error.** The issue is upstream: these narratives have limited P3 history.

---

## 5. P6 Semantics Audit

### 5.1 P6 Produced States

| Narrative | P6 Health | P6 Regime | P6 Confidence | P6 Warnings |
|-----------|-----------|-----------|---------------|-------------|
| 1 (AI) | 50 | STABLE | — | [] |
| 2 (DEFI) | 50 | STABLE | — | [] |
| 3 (FAVORITE) | 50 | STABLE | — | [] |
| 4 (LAYER2) | 50 | STABLE | — | [] |
| 6 (RESTAKING) | 50 | STABLE | — | [] |

### 5.2 Root Cause: P6 Health = 50 for ALL

The code trace reveals:

```typescript
// src/lib/p6/snapshot/types.ts
export const SNAPSHOT_NEUTRAL_SCORE = 50;

// src/lib/p6/snapshot/coin-snapshot.ts
const healthDimensions = [
  { name: "TREND", score: input.trend_score ?? SNAPSHOT_NEUTRAL_SCORE, ... },
  { name: "MOMENTUM", score: input.momentum_score ?? SNAPSHOT_NEUTRAL_SCORE, ... },
  { name: "VOLUME", score: input.volume_score ?? SNAPSHOT_NEUTRAL_SCORE, ... },
  { name: "DERIVATIVE", score: input.derivative_score ?? SNAPSHOT_NEUTRAL_SCORE, ... },
];
```

When coin-level feature scores (trend, momentum, volume, derivative) are NULL — which occurs because the feature computation pipeline does not produce these normalized scores for most coins — each dimension defaults to 50 (neutral).

The weighted average of four 50s = 50. Every coin gets health = 50. Every narrative gets health = 50.

### 5.3 P6 Regime State Machine

```typescript
// src/lib/p6/regime/state-machine.ts
if (score >= BOUNDARY_STABLE_LOWER && score <= BOUNDARY_STABLE_UPPER) return "STABLE";
// BOUNDARY_STABLE_LOWER = 40, BOUNDARY_STABLE_UPPER = 60
```

Since health = 50 → always in [40, 60] → always STABLE.

### 5.4 P6 Semantic Verdict

**P6 health = 50 is NOT a bug — it correctly reflects that coin-level feature scores are uniformly neutral (missing data defaults to neutral per the snapshot contract).** However, this creates a significant user-facing semantic problem: P6 always says "STABLE" even when P3 says WEAKENING and P5 says NO_ACTION due to deteriorating conditions.

**The health score is semantically neutral but the user perception is "everything is fine."**

---

## 6. P5 Semantics Audit

### 6.1 P5 Produced States

| Narrative | Outcome | Action | Policy | Confidence |
|-----------|---------|--------|--------|------------|
| 1 (AI) | SELECTED | MONITOR | C-201 | — |
| 2 (DEFI) | NO_ACTION | — | — | — |
| 3 (FAVORITE) | NO_ACTION | — | — | — |
| 4 (LAYER2) | NO_ACTION | — | — | — |
| 6 (RESTAKING) | NO_ACTION | — | — | — |

### 6.2 P5 Policy Trace

**C-201 (MONITOR) eligibility requires:**
1. P4 snapshot present (status = OK or DEGRADED) ✅ for all
2. P4 direction ≠ UNKNOWN ❌ for N2–N6 (UNKNOWN)

**Result:**
- N1: P4 direction = POSITIVE → MONITOR eligible → SELECTED → MONITOR
- N2–N6: P4 direction = UNKNOWN → MONITOR ineligible → NO_ACTION

### 6.3 P5 Semantic Verdict

**P5 correctly implements its frozen contract.** NO_ACTION here is not a business recommendation of "no action needed" — it is the contractual fallback when upstream evidence is insufficient for a policy-eligible action.

**Critical distinction:** A user seeing "NO_ACTION" might interpret "the system recommends doing nothing." In reality, the system says "insufficient evidence to recommend any action." These are semantically different.

---

## 7. P3 ↔ P4 Consistency

| Narrative | P3 Regime | P3 Rotation | P4 Direction | Consistent? |
|-----------|-----------|-------------|--------------|-------------|
| 1 | NEUTRAL | INFLOW | POSITIVE | ✅ CONSISTENT — improving from WEAKENING |
| 2 | NEUTRAL | ACCELERATING | UNKNOWN | ✅ EXPECTED — insufficient history |
| 3 | WEAKENING | STABLE | UNKNOWN | ✅ EXPECTED — insufficient history |
| 4 | WEAKENING | DECELERATING | UNKNOWN | ✅ EXPECTED — insufficient history |
| 6 | WEAKENING | STABLE | UNKNOWN | ✅ EXPECTED — insufficient history |

**No contradictions found.** P4 UNKNOWN correctly reflects data insufficiency, not disagreement.

---

## 8. P4 ↔ P6 Consistency

| Narrative | P4 Direction | P6 Health | P6 Regime | Tension? |
|-----------|-------------|-----------|-----------|----------|
| 1 | POSITIVE | 50 | STABLE | ⚠️ POTENTIAL TENSION |
| 2 | UNKNOWN | 50 | STABLE | ⚠️ POTENTIAL TENSION |
| 3 | UNKNOWN | 50 | STABLE | ⚠️ POTENTIAL TENSION |
| 4 | UNKNOWN | 50 | STABLE | ⚠️ POTENTIAL TENSION |
| 6 | UNKNOWN | 50 | STABLE | ⚠️ POTENTIAL TENSION |

**P6 says STABLE (health=50) while P3 says WEAKENING for 3 narratives.**

This is NOT a contradiction because P3 and P6 measure different things:
- P3 measures **narrative-level momentum/rotation regime** (meta-market signals)
- P6 measures **individual coin health** (per-coin feature aggregation)

A narrative can have weakening meta-market regime while individual coins remain healthy. However, the P6 health score being uniformly 50 (all features missing/neutral) makes this comparison meaningless.

**Classification: POTENTIAL TENSION — not yet a contradiction, but the uniform 50 health masks any real signal.**

---

## 9. P6 ↔ P5 Consistency

| Narrative | P6 Regime | P5 Outcome | P5 Action | Consistent? |
|-----------|-----------|------------|-----------|-------------|
| 1 | STABLE | SELECTED | MONITOR | ✅ CONSISTENT |
| 2 | STABLE | NO_ACTION | — | ⚠️ POTENTIAL TENSION |
| 3 | STABLE | NO_ACTION | — | ⚠️ POTENTIAL TENSION |
| 4 | STABLE | NO_ACTION | — | ⚠️ POTENTIAL TENSION |
| 6 | STABLE | NO_ACTION | — | ⚠️ POTENTIAL TENSION |

P6 says "everything is fine" (STABLE), but P5 says "no action recommended" because upstream evidence is insufficient. These are semantically compatible (P5 is about action, P6 is about health), but the user might see conflicting signals.

---

## 10. P3 ↔ P6 Consistency

| Narrative | P3 Regime | P6 Regime | Semantic Alignment |
|-----------|-----------|-----------|-------------------|
| 1 | NEUTRAL | STABLE | ⚠️ TENSION — NEUTRAL ≠ STABLE |
| 2 | NEUTRAL | STABLE | ⚠️ TENSION |
| 3 | WEAKENING | STABLE | ⚠️ TENSION — WEAKENING ≠ STABLE |
| 4 | WEAKENING | STABLE | ⚠️ TENSION |
| 6 | WEAKENING | STABLE | ⚠️ TENSION |

**This is the most significant semantic tension.** P3 says WEAKENING for 3 narratives, but P6 universally says STABLE. Because P6 health is stuck at 50, the P6 regime state machine never produces anything other than STABLE.

**Root cause:** P6 health depends on coin-level feature scores which are uniformly neutral (missing data). P3 regime depends on narrative-level momentum/breadth/rotation which IS being computed.

**Classification: SEMANTIC TENSION — P6 is not wrong per its contract (health=50 → STABLE is correct), but the uniform neutral health makes P6 regime informationally useless.**

---

## 11. P4 ↔ P5 Consistency

| Narrative | P4 Direction | P5 Outcome | Consistent? |
|-----------|-------------|------------|-------------|
| 1 | POSITIVE | SELECTED | ✅ CONSISTENT — P4 positive → P5 eligible |
| 2 | UNKNOWN | NO_ACTION | ✅ CONSISTENT — P4 unknown → P5 ineligible |
| 3 | UNKNOWN | NO_ACTION | ✅ CONSISTENT |
| 4 | UNKNOWN | NO_ACTION | ✅ CONSISTENT |
| 6 | UNKNOWN | NO_ACTION | ✅ CONSISTENT |

**No contradictions.** P5 correctly propagates P4's UNKNOWN state into a policy-ineligible outcome.

---

## 12. UI Wording Audit

### 12.1 P5 Panel (P5ActionDecisionPanel)

| UI Element | Current Wording | Assessment |
|------------|----------------|------------|
| Card title | "Decision" | ✅ Accurate — generic but correct |
| Decision badge | "SELECTED" / "NO_ACTION" | ⚠️ "NO_ACTION" is technical jargon — user might think "do nothing" vs "insufficient evidence" |
| Action | "MONITOR" | ✅ Accurate for SELECTED decisions |
| "What should I do?" | "The system recommends monitor" | ⚠️ Overstates evidence — P5 recommends MONITOR because it's the only policy-eligible action, not because it's the optimal action |
| "Safety checks passed" | — | ✅ Accurate when guardrails pass |
| Explanation | P4-based explanation | ✅ Traceable to P3 evidence |

**Key UI concern:** "The system recommends monitor" is potentially misleading for Narrative 1. The system recommends MONITOR because:
1. P3 = NEUTRAL/INFLOW (modest improvement)
2. P4 = POSITIVE/MEDIUM (positive but not strong)
3. P5 policy C-201 MONITOR is the only eligible action

The word "recommends" implies a positive, deliberate choice. In reality, MONITOR is the *least aggressive* action the system can take while still being policy-eligible.

### 12.2 P6 Panel (P6IntelligencePanel)

| UI Element | Current Wording | Assessment |
|------------|----------------|------------|
| Card title | "P6 Intelligence" | ✅ Accurate |
| Health | Not displayed (P6 panel doesn't show health score directly) | N/A |
| Regime | "STABLE" | ⚠️ Accurate per contract but informationally useless — always STABLE |
| Warnings | "No warnings" | ⚠️ Accurate but misleading — there ARE weaknesses (P3 WEAKENING) that aren't captured |
| Summary | "Health score unchanged by 0 points to 50" | ⚠️ Honest but confusing — users don't know what 50 means |

### 12.3 P4 Panel (P4DecisionSupportPanel)

| UI Element | Current Wording | Assessment |
|------------|----------------|------------|
| Direction | "POSITIVE" / "UNKNOWN" | ⚠️ "UNKNOWN" is technically accurate but users may interpret as "system error" vs "insufficient data" |
| Confidence | "MEDIUM" / "LOW" | ✅ Accurate |
| Signals | Based on P3 evidence | ✅ Traceable |

### 12.4 P3 Panel (P3IntelligencePanel)

| UI Element | Current Wording | Assessment |
|------------|----------------|------------|
| Regime | "NEUTRAL" / "WEAKENING" | ✅ Accurate |
| Rotation | "INFLOW" / "STABLE" / etc. | ✅ Accurate |
| Momentum | +12.90 / -3.97 etc. | ✅ Accurate |
| Breadth | 0.000 / 0.167 etc. | ✅ Accurate |

---

## 13. Production Cross-Layer State Matrix

### 13.1 Full State Matrix (5 active narratives)

| Layer | N1 (AI) | N2 (DEFI) | N3 (FAVORITE) | N4 (LAYER2) | N6 (RESTAKING) |
|-------|---------|-----------|---------------|-------------|----------------|
| **P3 Regime** | NEUTRAL | NEUTRAL | WEAKENING | WEAKENING | WEAKENING |
| **P3 Rotation** | INFLOW | ACCELERATING | STABLE | DECELERATING | STABLE |
| **P4 Direction** | POSITIVE | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| **P4 Confidence** | MEDIUM | LOW | LOW | LOW | LOW |
| **P5 Outcome** | SELECTED | NO_ACTION | NO_ACTION | NO_ACTION | NO_ACTION |
| **P5 Action** | MONITOR | — | — | — | — |
| **P6 Health** | 50 | 50 | 50 | 50 | 50 |
| **P6 Regime** | STABLE | STABLE | STABLE | STABLE | STABLE |

### 13.2 Coverage

| Metric | Count | Percentage |
|--------|-------|------------|
| Active narratives | 9 | 100% |
| With P3 data | 5 | 56% |
| With P4 data | 5 | 56% |
| With P5 SELECTED | 1 | 11% |
| With P5 NO_ACTION | 4 | 44% |
| With P5 UNAVAILABLE | 4 | 44% |
| With P6 snapshot | 5 | 56% |
| P6 health ≠ 50 | 0 | 0% |

---

## 14. Contradiction / Tension Matrix

| Combination | Frequency | Classification | Root Cause |
|-------------|-----------|---------------|------------|
| P3 WEAKENING + P6 STABLE | 3/5 | ⚠️ SEMANTIC TENSION | P6 health stuck at 50 |
| P3 NEUTRAL + P6 STABLE | 2/5 | ⚠️ POTENTIAL TENSION | Both neutral-ish, acceptable |
| P4 UNKNOWN + P5 NO_ACTION | 4/5 | ✅ CONSISTENT | Correct propagation |
| P4 POSITIVE + P5 SELECTED | 1/5 | ✅ CONSISTENT | Correct propagation |
| P4 POSITIVE + P6 STABLE | 1/5 | ⚠️ POTENTIAL TENSION | P6 health stuck at 50 |
| P5 NO_ACTION + P6 STABLE | 4/5 | ⚠️ POTENTIAL TENSION | User sees "no action" + "stable" — seemingly OK but masks real weakness |

---

## 15. Dead / Overloaded States

| State | Frequency | Assessment |
|-------|-----------|------------|
| P6 STABLE | 100% (5/5) | ⚠️ DEAD — never varies, informationally useless |
| P6 health = 50 | 100% (5/5) | ⚠️ DEAD — uniform neutral, masks real conditions |
| P5 NO_ACTION | 80% (4/5 active) | ⚠️ OVERLOADED — means both "genuinely no action" and "insufficient evidence" |
| P4 UNKNOWN | 80% (4/5) | ⚠️ OVERLOADED — means "insufficient data" but reads as "system error" |
| P3 regime NEUTRAL/WEAKENING | 100% (5/5) | ✅ Normal — limited data window |

---

## 16. P6 Health Score Audit

### 16.1 What Does Health = 50 Mean?

Per the source code:
```typescript
export const SNAPSHOT_NEUTRAL_SCORE = 50;
```

Health = 50 means "insufficient feature data to determine health." It is the **default fallback**, not a measurement of "half-healthy."

### 16.2 Is Health 50 Meaningful?

No. It is a sentinel value that means "we don't have enough data to tell." All four feature dimensions (TREND, MOMENTUM, VOLUME, DERIVATIVE) default to 50 when their underlying score is NULL.

### 16.3 Can Health 50 Be Compared Between Narratives?

No. Two narratives both with health = 50 could have very different underlying conditions — the score is equally uninformative for both.

### 16.4 Health 50 Recommendations

This is a data pipeline issue. The P6 coin snapshot generator requires feature scores from the `features` table (`trend_score`, `momentum_score`, `volume_score`, `derivative_score`). If these are NULL, the snapshot defaults to neutral.

**Action needed:** Verify whether the feature computation pipeline produces these normalized scores. If not, P6 health will remain permanently stuck at 50.

---

## 17. P5 "SELECTED → MONITOR" Audit

### 17.1 What Does "SELECTED MONITOR" Mean?

Per the frozen contract:
- **SELECTED** = the system determined that an action is warranted (P5-02 AD-004)
- **MONITOR** = the recommended action type (P5-03 C-201)
- **C-201 eligibility**: P4 snapshot present AND P4 direction ≠ UNKNOWN

### 17.2 Is "MONITOR" a Strong Recommendation?

No. MONITOR is the **lowest-severity** policy-eligible action. Per the policy hierarchy:
```
MONITOR → REVIEW → CONSEQUENTIAL → REBALANCE
```

MONITOR means "keep watching" — it is explicitly NOT an action requiring immediate attention.

### 17.3 Is "The System Recommends Monitor" Accurate?

Partially. The system has determined that MONITOR is the only policy-eligible action given the current evidence (P3 improving, P4 POSITIVE but MEDIUM confidence). The word "recommends" is technically correct but could overstate the strength of the recommendation.

### 17.4 Should the UI Say Something Different?

A more precise wording might be: "Eligible action: MONITOR — low-confidence positive signal detected." This preserves accuracy without overstating confidence.

---

## 18. P4 → P5 Handoff Audit

### 18.1 Does P4 Provide Enough Evidence for P5?

**For SELECTED decisions:** Yes. P4 provides direction, confidence, actionability, opportunity, risk, explanation, and evidence — all consumed by P5's policy engine.

**For NO_ACTION decisions:** The P4→P5 handoff is working correctly, but the root cause is upstream: P3 insufficient history → P4 UNKNOWN → P5 ineligible.

### 18.2 Is P5 Independent of P4?

**No.** P5 is structurally dependent on P4:
- P5 policy C-201 (MONITOR) requires P4 direction ≠ UNKNOWN
- P5 policy C-101 (SELECTED) requires P4 direction ≠ UNKNOWN
- P5 NO_ACTION is the fallback when P4 provides no usable direction

This dependency is architecturally intentional (P5 consumes P4 output) and correctly implemented.

---

## 19. Max Hypothesis Cross-Check

### 19.1 Max's Recommendations vs Evidence

| Max Hypothesis | Evidence | Verdict |
|---------------|----------|---------|
| Non-zero derivative thresholds | P6 uses SNAPSHOT_NEUTRAL_SCORE=50 for missing derivatives | ✅ SUPPORTED — zero thresholds cause neutral defaults |
| Spot > Futures preference | No evidence of source preference in current data | ⚠️ INSUFFICIENT EVIDENCE — not testable with current data |
| Derivative weight decrease | Derivative defaults to 50 when missing → no discrimination | ✅ SUPPORTED — missing derivative data neutralizes its weight |
| Momentum weight increase | Momentum IS being computed (P3 momentum_1d is populated) | ⚠️ PARTIALLY SUPPORTED — momentum works at P3 level but not at P6 coin level |
| Rotation outflow state | P3 rotation uses INFLOW/STABLE/ACCELERATING/DECELERATING — no OUTFLOW | ✅ NOT SUPPORTED — rotation state vocabulary doesn't include OUTFLOW |
| Recommendation fading/euphoria | Not testable — recommendation thresholds not reached in current data | ⚠️ INSUFFICIENT EVIDENCE |

---

## 20. KEEP / TUNE / CHANGE Matrix

| Parameter | Current | Evidence | Action | Confidence |
|-----------|---------|----------|--------|------------|
| P3 regime thresholds | Working correctly | Classifications match data | KEEP | HIGH |
| P3 rotation thresholds | Working correctly | Score-to-state mapping verified | KEEP | HIGH |
| P6 health neutral score | 50 | Uniform across all narratives | TUNE — investigate feature pipeline | HIGH |
| P6 regime boundaries | 40–60 = STABLE | Correct given health=50 | KEEP (blocked by health issue) | MEDIUM |
| P5 MONITOR eligibility | Requires direction ≠ UNKNOWN | Correct per contract | KEEP | HIGH |
| P5 NO_ACTION fallback | Used when ineligible | Correct per contract | KEEP | HIGH |
| P4 UNKNOWN propagation | Cascades to P5 NO_ACTION | Correct per contract | KEEP | HIGH |
| P4 confidence cap at MEDIUM | When conflict detected | Correct per §9 scenarios | KEEP | HIGH |
| Recommendation thresholds | 65/80/90 | Not testable — no data reaches these | INSUFFICIENT EVIDENCE | LOW |
| Health weights | trend=0.35, vol=0.2, mom=0.1, deriv=0.35 | Not testable — all default to 50 | INSUFFICIENT EVIDENCE | LOW |

---

## 21. Evidence Gaps

| Gap | Impact | Priority |
|-----|--------|----------|
| P6 coin feature scores are all NULL | P6 health stuck at 50, P6 regime always STABLE | HIGH — blocks P6 semantic value |
| P3 history insufficient for 4/5 narratives | P4 = UNKNOWN, P5 = NO_ACTION for 80% of narratives | MEDIUM — natural data accumulation |
| P5 confidence never populated | Cannot assess P5 decision strength | LOW — P5 contract doesn't require confidence for all outcomes |
| No narrative health data in `narrative_health` table | Cannot cross-validate P6 with legacy health scores | LOW — P6 computes independently |
| 4 narratives (7–10) have no P3/P4/P5 data | 44% of narratives have no intelligence at all | MEDIUM — need to verify these narratives are eligible for calculation |

---

## 22. Frozen Boundary Verification

| Contract | Violated? | Evidence |
|----------|-----------|----------|
| P3 semantics (regime/rotation/momentum/breadth) | ❌ No | All classifications match frozen definitions |
| P4 semantics (direction/confidence/actionability) | ❌ No | UNKNOWN correctly propagated from insufficient data |
| P5 frozen contract (outcome vocabulary, policy hierarchy) | ❌ No | SELECTED/NO_ACTION/MONITOR all per contract |
| P5 NO_ACTION is DecisionOutcome not ActionType | ❌ No | Verified in types.ts |
| P5 safety semantics unchanged | ❌ No | Guardrails, approvals, permissions all unchanged |
| P6 snapshot contract | ❌ No | Neutral score default is per design |
| P6 does NOT read P5 records | ❌ No | Code search confirms zero P5 imports in P6 |
| P5 does NOT replace P3/P4 | ❌ No | All four panels coexist independently |
| P6 does NOT replace P5 | ❌ No | P6IntelligencePanel ≠ P5ActionDecisionPanel |

---

## 23. Recommended Next Steps

1. **INVESTIGATE P6 Feature Pipeline** — Determine why `features.trend_score`, `features.momentum_score`, `features.volume_score`, `features.derivative_score` are NULL. This is the root cause of P6 health = 50. If these scores are never populated, P6 health/regime is permanently informational null.

2. **P3 History Accumulation** — 4 narratives need more P3 snapshots before P4 can produce non-UNKNOWN direction. This is a natural data accumulation issue that resolves over time with regular refresh cycles.

3. **UI Wording Review** — Consider whether "NO_ACTION" and "UNKNOWN" are sufficiently clear for end users. These are technically correct but could be confusing.

---

## 24. Final Verdict

```
SEMANTIC TENSIONS FOUND — TARGETED REWORK REQUIRED
```

**Primary tension:** P6 health uniformly neutral (50) → P6 regime always STABLE → P6 becomes informationally useless alongside varying P3/P4/P5 states.

**Secondary tension:** P5 NO_ACTION used for both "genuinely no action needed" and "insufficient evidence" — these are semantically different states displayed identically.

**No frozen contracts violated.** All observed behavior is correct per the existing design.

**Recommended next task:** `P6-SEMANTIC-03 — P6 Feature Pipeline Health Score Investigation` to determine why coin-level feature scores are NULL and P6 health is stuck at neutral.
