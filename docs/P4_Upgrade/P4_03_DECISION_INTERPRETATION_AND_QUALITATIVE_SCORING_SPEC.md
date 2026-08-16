# P4-03 — Decision Interpretation & Qualitative Scoring Specification

**Status:** SPECIFICATION ONLY — authoritative P4-03 interpretation rules.
No production code, no P3/P2 modification, no service/API/UI implementation, no
database change, no numeric composite scoring.

**Baseline (frozen, mandatory):**
- `docs/P4_Upgrade/P4_01_DECISION_SUPPORT_CONTRACT_AND_GAP_AUDIT.md`
- `docs/P4_Upgrade/P4_02_SEMANTIC_CONTRACT_AND_READ_PATH_SPEC.md`
- P4-01A Q1–Q5 (embedded in P4-01)
- P3 implementation as operational truth (incl. `NEUTRAL` in
  `P3_REGIMES`, `src/lib/p3/regime.ts`; frozen trend constants in
  `src/lib/services/p3-intelligence-history.service.ts`).

**Critical principle:** P4 interprets persisted P3 states; it never
recalculates a P3 metric, never applies a new numeric cutoff that P3 did not
freeze, and never invents a hidden heuristic. Everything below is
deterministic: identical input ⇒ identical output. No LLM, no ML, no
probabilistic model.

---

## 1. Verified frozen constants used by these rules

| Constant | Value | Source |
|---|---|---|
| Trend epsilons | momentum 1.0 · rotationScore 5.0 · breadth 0.05 · relativeStrength 0.01 · leaderScore 5.0 | `P3_TREND_EPSILONS` (P3-18, from frozen P3-14 D.2) |
| Regime rank | DEAD 0 · WEAKENING 1 · NEUTRAL 2 · MATURE 3 · EMERGING 4 · STRONG 5 | `REGIME_RANK` (P3-18, from P3-14 D.1 + P3-08) |
| Rotation rank | OUTFLOW 0 · DECELERATING 1 · STABLE 2 · INFLOW 3 · ACCELERATING 4 | `ROTATION_RANK` (P3-18, from P3-09 ordering) |
| Trend states | IMPROVING / DETERIORATING / STABLE / TRANSITION / UNKNOWN | `P3TrendState` (P3-14 D.1) |
| Availability | VALID / MISSING / INVALID / STALE / INSUFFICIENT_HISTORY / NOT_APPLICABLE / AMBIGUOUS | `src/lib/p3/availability.ts` |
| Direction-core composition | regime + rotation + momentum (mirrors frozen P3-14 D.1 overall trend) | P3-14 D.1 |
| Signal identity | `(signalId, narrativeId, windowEnd)` | P4-02 §3.1 |

---

## 2. Evidence normalization layer

Raw P3 read-model stages → semantic evidence states.

### 2.1 Mapping (per stage: Regime, Rotation(+score), Breadth, Momentum, RS, Leadership, Constituents)

| P3 read state | Semantic evidence state | Usability in P4 |
|---|---|---|
| VALID | VALID | Full use |
| MISSING | UNAVAILABLE | Not usable; load-bearing ⇒ UNKNOWN |
| INVALID | INVALID | Not usable; load-bearing ⇒ UNKNOWN; reason recorded |
| STALE | STALE | Usable for current-state interpretation only; Confidence capped at MEDIUM; never trend-confirmation at full strength |
| INSUFFICIENT_HISTORY | INSUFFICIENT_HISTORY | Delta/trend-dependent conclusions ⇒ UNKNOWN |
| NOT_APPLICABLE | NOT_APPLICABLE | Not usable as value; never treated as STABLE or NEUTRAL (P3 rule) |
| AMBIGUOUS | AMBIGUOUS | Not usable until resolved; ⇒ UNKNOWN for dependent conclusion |
| (artifact VALID but member detail missing, e.g. leader symbol null while score present) | PARTIAL | Usable for the present part; coverage reduced |

### 2.2 Precedence when multiple states could apply

Evaluation order (first match wins):

```text
INVALID  >  AMBIGUOUS  >  NOT_APPLICABLE  >  INSUFFICIENT_HISTORY
      >  STALE  >  UNAVAILABLE(MISSING)  >  PARTIAL  >  VALID
```

Rationale: a value that exists but violates the contract (INVALID) is the
worst case; a value that is merely old (STALE) is still evidence but never
"as fresh as VALID"; a present-but-incomplete value (PARTIAL) is weakest but
usable. STALE never simultaneously behaves as fully VALID (P4-02 §12; Q4-01A
Q4 caps).

### 2.3 Derived semantic moves (over the latest step, frozen P3-18 deltas)

For each metric define `move ∈ {POSITIVE, NEUTRAL, NEGATIVE, UNKNOWN}`:

| Move | Definition (frozen) |
|---|---|
| regimeMove | rank(current) − rank(previous): >0 POSITIVE, <0 NEGATIVE, =0 NEUTRAL; either unavailable ⇒ UNKNOWN |
| rotationScoreMove | step.rotationScore.delta vs ε 5.0 (frozen): >+5 POSITIVE, <−5 NEGATIVE, else NEUTRAL; delta null ⇒ UNKNOWN |
| momentumMove | step.momentum.delta vs ε 1.0 (frozen) |
| breadthMove | step.breadth.delta vs ε 0.05 (frozen) |
| rsMove | step.relativeStrength.delta vs ε 0.01 (frozen) |
| leadershipMove | step.leadership.changed ⇒ TRANSITION-like (MIXED-class); else leaderScore.delta vs ε 5.0 → POSITIVE/NEUTRAL/NEGATIVE; unavailable ⇒ UNKNOWN |

No new numeric cutoffs are introduced anywhere; only frozen ε and ranks are
used.

---

## 3. Signal specification

### 3.1 Formal template (per signal)

Each signal follows: Signal ID · Purpose · Minimum evidence · Primary
evidence · Secondary evidence · Required evidence state · Firing condition ·
Suppression condition · UNKNOWN condition · Conflicting-evidence behavior ·
Historical requirement · Output direction · Evidence references · Explanation
text contract.

### 3.2 `NARRATIVE_IMPROVEMENT`

- **Purpose:** overall narrative trajectory is improving with corroboration.
- **Minimum evidence:** current artifact VALID; latest step available
  (same-identity series ≥ 2); overall trend VALID (not UNKNOWN).
- **Primary evidence:** `history.trend.overall = IMPROVING`.
- **Secondary evidence (≥1 required):** `rotationScoreMove = POSITIVE` OR
  `momentumMove = POSITIVE` OR `regimeMove = POSITIVE`.
- **Required evidence state:** all primary/secondary evidence VALID.
- **Firing condition:** `trend.overall = IMPROVING` AND `regimeMove ≠ NEGATIVE`
  AND at least one of {rotationScoreMove, momentumMove, regimeMove} =
  POSITIVE.
- **Suppression:** `regimeMove = NEGATIVE`; or any primary/secondary evidence
  INVALID/AMBIGUOUS/NOT_APPLICABLE; or a **material** EVIDENCE_CONFLICT
  (defined §9) involving the direction core.
- **UNKNOWN condition:** evidence states insufficient ⇒ signal is NOT emitted
  (never emitted as UNKNOWN).
- **Conflicting-evidence behavior:** a single opposing corroborator (e.g.,
  RS NEGATIVE) does not suppress; it is recorded as conflicting evidence and
  reduces Confidence by one level (§7).
- **Historical requirement:** overall trend must be from the frozen P3-18
  history view model (never recomputed).
- **Output direction:** POSITIVE.
- **Evidence references:** `history.identity`, current artifact id, latest
  step, trend.overall.
- **Explanation contract:** "Overall trend is IMPROVING with corroborating
  {metrics} while regime did not deteriorate."

### 3.3 `NARRATIVE_DETERIORATION`

- **Purpose:** overall narrative trajectory is deteriorating with
  corroboration.
- **Minimum evidence:** current artifact VALID; latest step available; trend
  overall VALID.
- **Primary evidence:** `history.trend.overall = DETERIORATING`.
- **Secondary evidence (≥1 required):** `regimeMove = NEGATIVE` OR
  `rotationScoreMove = NEGATIVE` OR `momentumMove = NEGATIVE`.
- **Required evidence state:** VALID.
- **Firing condition:** `trend.overall = DETERIORATING` AND
  `regimeMove ≠ POSITIVE` AND at least one of {regimeMove, rotationScoreMove,
  momentumMove} = NEGATIVE.
- **Suppression:** `regimeMove = POSITIVE`; material core conflict;
  unavailable evidence.
- **UNKNOWN condition:** not emitted.
- **Conflicting-evidence behavior:** one opposing corroborator recorded as
  conflict; Confidence −1.
- **Historical requirement:** frozen trend model only.
- **Output direction:** NEGATIVE.
- **Explanation:** "Overall trend is DETERIORATING with corroborating
  {metrics} while regime did not improve."

### 3.4 `BROADENING`

- **Purpose:** participation widening (breadth increasing beyond frozen ε).
- **Minimum evidence:** breadth VALID current + previous (delta available).
- **Primary evidence:** `breadthMove = POSITIVE`.
- **Secondary:** none.
- **Required evidence state:** VALID.
- **Firing condition:** `breadthMove = POSITIVE`.
- **Suppression:** breadth UNKNOWN; N/A.
- **UNKNOWN:** not emitted.
- **Conflicting-evidence:** any opposing metric recorded; this signal alone
  never determines Direction (single-evidence, see §4).
- **Historical requirement:** latest step delta (frozen ε).
- **Output direction:** POSITIVE.
- **Explanation:** "Breadth increased beyond the frozen tolerance."

### 3.5 `NARROWING`

- Mirror of BROADENING: fires when `breadthMove = NEGATIVE`; direction
  NEGATIVE; single-evidence (never alone sets Direction).

### 3.6 `LEADERSHIP_CHANGE`

- **Purpose:** the narrative leader identity changed.
- **Minimum evidence:** latest step leadership available on both sides.
- **Primary evidence:** `step.leadership.changed = true`.
- **Firing condition:** `changed = true`.
- **Suppression:** either side UNKNOWN.
- **Output direction:** MIXED (cross-coin score comparison is not defined by
  contract).
- **Historical requirement:** latest step only.
- **Explanation:** "Narrative leader changed from {prev.symbol} to
  {curr.symbol}."

### 3.7 `REGIME_CHANGE`

- **Purpose:** regime classification moved across the frozen rank.
- **Firing condition:** `step.regime.state ≠ STABLE` (rank movement).
- **Output direction:** POSITIVE if regimeMove = POSITIVE, NEGATIVE if
  NEGATIVE, MIXED if rank table cannot classify (unranked value ⇒ not fired;
  see UNKNOWN condition).
- **UNKNOWN condition:** unranked regime value ⇒ signal not emitted
  (never guessed).
- **Explanation:** "Regime moved {previous} → {current}."

### 3.8 `ROTATION_CHANGE`

- **Purpose:** rotation classification or score moved.
- **Firing condition:** `step.rotation.state ≠ STABLE` OR
  `rotationScoreMove ≠ NEUTRAL` (score beyond ε 5.0).
- **Output direction:** POSITIVE if rotationScoreMove POSITIVE or rotation
  rank improved; NEGATIVE otherwise.
- **UNKNOWN condition:** unranked rotation value ⇒ not emitted.
- **Explanation:** "Rotation moved {previous} → {current}
  (score {delta})."

### 3.9 `EVIDENCE_CONFLICT`

- **Purpose:** formal detection of materially conflicting directional
  evidence (see §9 for the full contract).
- **Firing condition:** within the latest step, at least one metric move in
  {regimeMove, rotationScoreMove, momentumMove, breadthMove, rsMove} =
  POSITIVE AND at least one (different) metric in the same set = NEGATIVE,
  both VALID.
- **Severity:** material vs minor per §9.2.
- **Output direction:** MIXED (informational; contributes to Direction
  aggregation per §5).
- **Explanation:** "Conflicting evidence: {metric A} improving while
  {metric B} deteriorating."

### 3.10 Design constraints (balance)

- **Multi-evidence signals:** NARRATIVE_IMPROVEMENT / NARRATIVE_DETERIORATION
  require trend + ≥1 corroborator (they may set Direction).
- **Single-evidence signals:** BROADENING / NARROWING / LEADERSHIP_CHANGE /
  REGIME_CHANGE / ROTATION_CHANGE are single-observation signals: they may
  contribute to Direction only as corroborators or as the *sole* driver when
  they are the only available directional evidence **and** all other core
  evidence is NEUTRAL (not UNKNOWN). They never single-handedly override a
  dominant core lean.
- **Rationale for the chosen balance:** trend + corroborator avoids the
  too-sensitive extreme (one noisy metric cannot fire NARRATIVE_*); the
  single-evidence signals remain available so the too-conservative extreme is
  avoided (a clean rotation reversal is still surfaced). No metric is
  required for every signal.

### 3.11 Priority, coexistence, deduplication

- **Identity:** `(signalId, narrativeId, windowEnd)` — preserved; one
  occurrence per identity; no duplicates; no persistence (derived at read
  time).
- **Coexistence:** any subset of the 8 signals may fire together.
- **Mutually exclusive:** NARRATIVE_IMPROVEMENT ↔ NARRATIVE_DETERIORATION
  (overall trend is a single frozen state); BROADENING ↔ NARROWING.
- **UI ordering priority (if needed):** NARRATIVE_* (1), REGIME_CHANGE (2),
  ROTATION_CHANGE (3), BROADENING/NARROWING (4), LEADERSHIP_CHANGE (5),
  EVIDENCE_CONFLICT (6).

---

## 4. Direction interpretation

### 4.1 Aggregation algorithm (deterministic)

```text
current directional evidence        (core moves + corroborator moves)
        +
confirmation evidence              (agreement count)
        +
conflict detection                 (EVIDENCE_CONFLICT materiality)
        +
historical context                (frozen trend; context only)
        ↓
Direction
```

**Step 1 — Gates:**
1. If current artifact `availabilityState ≠ VALID` → **UNKNOWN** (reason:
   `NO_VALID_CURRENT`).
2. If latest step unavailable (same-identity series < 2) →
   **UNKNOWN** (`INSUFFICIENT_HISTORY`).
3. Core set C = {regimeMove, rotationScoreMove, momentumMove};
   corroborator set X = {breadthMove, rsMove}.
4. If ≥2 of C are UNKNOWN → **UNKNOWN** (`CRITICAL_EVIDENCE_MISSING`).

**Step 2 — Core lean:**
- `posC = count(POSITIVE in C)`, `negC = count(NEGATIVE in C)`,
  `neuC = count(NEUTRAL in C)`.
- If `posC ≥ 2` or `negC ≥ 2` → lean = that sign (**dominant**).
- Else if `posC == 1` and `negC == 1` → base = **MIXED**.
- Else if `posC == 1` or `negC == 1` → base = that sign (**tentative**).
- Else (all NEUTRAL/UNKNOWN) → base = **NEUTRAL**.

**Step 3 — Corroborator reconciliation (only VALID non-UNKNOWN corroborators
count):**
- Dominant lean: opposing corroborators do **not** flip the lean; each emits
  EVIDENCE_CONFLICT (minor unless it is the direction core — see §9) and
  Confidence −1. Direction = lean.
- Tentative base: if ≥1 opposing corroborator → **MIXED**; else base.
- Base MIXED: stays MIXED.
- Base NEUTRAL: if any corroborator POSITIVE and any corroborator NEGATIVE →
  **MIXED**; else **NEUTRAL**.

**Step 4 — Historical context (frozen, context-only):**
- Historical Trend never overrides the current Direction (§11).
- If trend opposes Direction and both are well-evidenced: record the
  divergence in explanation and Confidence −1 (consistency). Direction
  unchanged. (Current POSITIVE + historical DETERIORATING is representable;
  likewise current NEGATIVE + historical IMPROVING.)

**Step 5 — Output:** Direction + confidenceAdjustments + conflict list +
reasons.

### 4.2 Precedence

```text
UNKNOWN (gates) > MIXED (genuine split) > POSITIVE/NEGATIVE (dominant > tentative) > NEUTRAL (default)
```

Direction is never Regime lookup (Q2); Regime contributes only `regimeMove`.

### 4.3 Direction decision table (required scenarios)

| regimeMove | rotationScoreMove | momentumMove | breadthMove | rsMove | Direction | Notes |
|---|---|---|---|---|---|---|
| NEUTRAL | UNKNOWN | POSITIVE | POSITIVE | NEGATIVE | **MIXED** | tentative POS + opposing corroborator (RS) |
| NEGATIVE | UNKNOWN | NEGATIVE | UNKNOWN | POSITIVE | **NEGATIVE** | dominant NEG; RS conflict noted (minor), Confidence −1 |
| NEUTRAL | NEUTRAL | NEUTRAL | NEUTRAL | NEUTRAL | **NEUTRAL** | valid evidence, no direction dominates |
| UNKNOWN | UNKNOWN | UNKNOWN | POSITIVE | POSITIVE | **UNKNOWN** | ≥2 core UNKNOWN (CRITICAL_EVIDENCE_MISSING) |
| POSITIVE | POSITIVE | NEUTRAL | NEUTRAL | NEGATIVE | **POSITIVE** | dominant POS; RS opposing → conflict, Confidence −1 |
| NEGATIVE | NEGATIVE | NEUTRAL | POSITIVE | UNKNOWN | **NEGATIVE** | dominant NEG; breadth opposes (minor), Confidence −1 |
| POSITIVE | NEGATIVE | NEUTRAL | UNKNOWN | UNKNOWN | **MIXED** | core split 1-1 |
| NEUTRAL | NEUTRAL | UNKNOWN | POSITIVE | NEGATIVE | **MIXED** | NEUTRAL base + corroborator split |
| NEGATIVE | UNKNOWN | UNKNOWN | UNKNOWN | POSITIVE | **UNKNOWN** | ≥2 core UNKNOWN |

---

## 5. MIXED vs NEUTRAL vs UNKNOWN (semantic separation)

| State | Meaning | Evidence precondition |
|---|---|---|
| NEUTRAL | valid evidence, no directional conclusion | All core evidence VALID and NEUTRAL, corroborators not split |
| MIXED | sufficiently valid evidence with materially conflicting direction | Valid core split (1-1), or tentative base opposed by corroborator, or NEUTRAL base with split corroborators |
| UNKNOWN | insufficient evidence to support an interpretation | Gates fail: no valid current, <2 artifacts, ≥2 core UNKNOWN, INVALID/AMBIGUOUS load-bearing |

Test scenarios (S1–S8):

1. S1 — regime NEUTRAL→NEUTRAL, rotation STABLE→STABLE, momentum 0Δ, breadth 0Δ, RS 0Δ → NEUTRAL.
2. S2 — regime NEUTRAL→NEUTRAL, momentum +0.5Δ, breadth +0.04Δ, rotation
   score +2Δ → NEUTRAL (no move beyond ε; valid, no conclusion).
   [CORRECTED by P4-05A SEMANTIC RESOLUTION §21/C5 — the previous draft's
   deltas (momentum +5Δ, breadth +0.1Δ) exceed the frozen ε (momentum 1.0,
   breadth 0.05) and would produce POSITIVE moves, making the stated NEUTRAL
   outcome unreachable under the frozen rules.]
3. S3 — regime WEAKENING→WEAKENING, momentum −2Δ, rotation −6Δ, breadth −0.1Δ → NEGATIVE (dominant core).
4. S4 — regime EMERGING→STRONG, momentum +3Δ, breadth +0.2Δ, rotation +8Δ, RS −0.02Δ → POSITIVE (dominant; RS conflict minor).
5. S5 — regime NEUTRAL, momentum +4Δ, rotation score −7Δ, breadth UNKNOWN, RS +0.03Δ → MIXED (core split 1-1).
6. S6 — regime NEUTRAL, momentum +2Δ, breadth −0.12Δ, rotation score +3Δ, RS +0.01Δ → MIXED (tentative POS + opposing breadth).
7. S7 — 1 artifact only, current VALID → UNKNOWN (INSUFFICIENT_HISTORY).
8. S8 — current artifact VALID, regime/rotation/momentum all MISSING (non-VALID), breadth VALID → UNKNOWN (CRITICAL_EVIDENCE_MISSING).

---

## 6. Historical Trend interaction

- **Confirmation role:** if `trend.overall` agrees with Direction AND ≥2
  steps confirm, Historical Support = HIGH (Confidence input, §7).
- **Contradiction role:** trend opposing current Direction is representable;
  recorded in explanation as conflicting historical context; Confidence −1.
- **Context-only role:** when Direction is NEUTRAL/UNKNOWN, trend is
  displayed as context and never used to force a Direction.
- Historical Trend is frozen P3-18 output; P4 never recomputes it and never
  lets it mechanically override current evidence.

---

## 7. Confidence classification

**Dimensions (qualitative):**

| Dimension | HIGH | MEDIUM | LOW |
|---|---|---|---|
| Coverage | all core + both corroborators VALID | 1 missing corroborator | any core missing |
| Consistency | no conflict | minor conflict only | material conflict |
| Historical support | ≥2 confirming steps | 1 step | 0 steps |
| Provenance integrity | identity clean | — | mixed identity (⇒ UNKNOWN for that conclusion) |

**Combination (deterministic):** base = Coverage; then: material conflict ⇒ cap MEDIUM (never HIGH) [SUPERSEDED BY P4-05A SEMANTIC RESOLUTION §21/C2 — the previous draft's "material ⇒ LOW" is superseded; the canonical Scenario 6 articulation "material conflict ⇒ not HIGH" is authoritative]; minor conflict ⇒ −1 level; historical support HIGH and coverage HIGH ⇒ +0 (no boost beyond HIGH); stale ⇒ cap MEDIUM; insufficient history ⇒ LOW.
UNKNOWN only when coverage makes the interpretation uncomputable (UNKNOWN
Direction and no determinable evidence strength — i.e., Coverage = LOW with
load-bearing gap ⇒ Confidence = LOW, not UNKNOWN; Confidence = UNKNOWN only
when provenance integrity is broken). No percentages, no numeric confidence.

---

## 8. Actionability classification

**Logic (deterministic):**

| Direction | Confidence | Opportunity/Risk context | Actionability |
|---|---|---|---|
| UNKNOWN | any | any | UNKNOWN |
| NEUTRAL | any | any | LOW |
| MIXED | HIGH/MEDIUM | any | MEDIUM |
| MIXED | LOW | any | LOW |
| POSITIVE/NEGATIVE | HIGH | at least one of Opportunity/Risk determinable | HIGH |
| POSITIVE/NEGATIVE | MEDIUM | at least one determinable | MEDIUM |
| POSITIVE/NEGATIVE | LOW | any | LOW |
| POSITIVE/NEGATIVE | HIGH | both Opportunity and Risk UNKNOWN | LOW |

Rationale: Actionability answers "does the current evidence produce a
sufficiently clear decision context to deserve user attention?" It is NOT
confidence (example: NEUTRAL + HIGH confidence → LOW actionability); it is
NOT buy/sell/short/exit/allocate.

---

## 9. EVIDENCE_CONFLICT contract

- **Firing:** ≥1 POSITIVE and ≥1 NEGATIVE among the five moves (both VALID)
  in the latest step.
- **Materiality:** material only for an opposite-sign pair WITHIN the
  {regimeMove, rotationScoreMove, momentumMove} direction core (a core
  split); minor otherwise (core-vs-breadth, core-vs-RS,
  corroborator-vs-corroborator).
  [SUPERSEDED BY P4-05A SEMANTIC RESOLUTION §21/C1 — the previous draft's
  "OR core-vs-breadth" clause is superseded: canonical Scenarios 2 and 5
  label breadth-vs-core conflicts minor, and §9.3 severity is defined over
  core pairs (breadth-vs-core has zero core pairs).]
- **Severity:** material with ≥2 conflicting core pairs → HIGH; material with
  1 → MEDIUM; minor → LOW.
- **Impact on Direction:** per §4 (may yield MIXED or merely reduce
  confidence).
- **Impact on Opportunity:** material conflict ⇒ Opportunity cannot be HIGH.
- **Impact on Risk:** never alone ⇒ Risk HIGH; only the structural NEGATIVE
  evidence side contributes to Risk.
- **Impact on Confidence:** minor −1; material ⇒ cap MEDIUM (never HIGH). [SUPERSEDED BY P4-05A SEMANTIC RESOLUTION §21/C2 — the previous draft's "material ⇒ LOW" is superseded.]
- **Impact on Actionability:** material ⇒ never HIGH.
- Conflict is interpretation uncertainty, not automatically Risk = HIGH.

---

## 10. P2 Event Risk projection

**Scope classification (deterministic):**

| Scope | Condition (eventRisks rows, active, not expired) | Narrative-level influence |
|---|---|---|
| Coin-local | `coinId` set, `narrativeId` null, coin is a constituent | None on Risk value; recorded as secondary evidence (Confidence/context) |
| Multi-coin | ≥2 distinct constituent coins with active coin-local events in the narrative | May raise structural Risk by one tier (cap HIGH) |
| Narrative-wide | `narrativeId` = this narrative | May raise structural Risk by one tier (cap HIGH); never sole HIGH |

**Rules (frozen):**
1. Provenance: every referenced event carries `source = P2_EVENT_RISK`.
2. P2 never overwrites P3 facts; never mutates P3 stages/trends.
3. P2 never silently becomes P3 structural evidence.
4. Coin-local event ≠ narrative-level risk (Q5 rule 5).
5. Evidence conflicts stay visible (§9).
6. **P2 Decision Engine penalty thresholds (eventRiskScore ≥80→−25 etc.) are
   NOT P4 thresholds.** Only P2 qualitative semantics (riskLevel
   LOW/MEDIUM/HIGH/CRITICAL, scope, activity) are used as evidence.

## 11. Risk precedence (deterministic outcomes)

| P3 structural | P2 event risk | Narrative Risk |
|---|---|---|
| Healthy (no structural DET; Direction POSITIVE/NEUTRAL) | HIGH (coin-local) | LOW (event recorded as secondary) |
| Healthy | HIGH (narrative-wide) | MEDIUM (raised one tier; never HIGH from P2 alone) |
| Deteriorating (structural DET dominant) | LOW/none | HIGH |
| Deteriorating | HIGH (narrative-wide) | HIGH (structural already dominates) |
| Mixed (some DET, not dominant) | HIGH (narrative-wide) | HIGH (structural MEDIUM +1) |
| Mixed | HIGH (coin-local) | MEDIUM |
| UNKNOWN evidence | any | UNKNOWN |

Not "higher of the two": structural base is set first from P3 evidence; P2
adjustment is scope-based with a hard +1-tier cap and never sole HIGH.

---

## 12. Opportunity / Risk qualitative rules

### 12.1 Opportunity

Base tier from Direction:
- UNKNOWN ⇒ UNKNOWN.
- NEGATIVE/MIXED ⇒ LOW.
- NEUTRAL ⇒ LOW unless corroborators are split (then LOW) — no positive
  evidence ⇒ LOW.
- POSITIVE ⇒ start HIGH, then suppression ladder (§12.3).

### 12.2 Risk

Base tier from structural evidence:
- Direction UNKNOWN ⇒ UNKNOWN.
- Structural DET count (over {regimeMove, rotationScoreMove, momentumMove,
  breadthMove}) ≥2 OR (Direction NEGATIVE AND trend DETERIORATING) ⇒ HIGH.
- Exactly 1 structural DET ⇒ MEDIUM.
- 0 structural DET ⇒ LOW.
- Then apply P2 adjustment (§10).

### 12.3 Opportunity suppression ladder (each applies sequentially)

Cannot be HIGH when any of: breadthMove NEGATIVE; momentumMove NEGATIVE;
regimeMove NEGATIVE; rotationScoreMove NEGATIVE; material EVIDENCE_CONFLICT;
stale current artifact (cap MEDIUM); insufficient history (cap LOW);
narrative-wide HIGH P2 event risk (drop to MEDIUM). Each adverse condition
drops one tier from the unconflicted tier, floor LOW. A NEGATIVE-RS-only
condition drops HIGH → MEDIUM (not LOW) — related-but-independent dimensions;
a risk condition does not automatically zero opportunity.

## 13. Opportunity × Risk interaction matrix (explanation semantics, not a score)

| Opportunity | Risk | Interpretation / actionability note |
|---|---|---|
| HIGH | LOW | Clear favorable context; Actionability HIGH if confidence HIGH |
| HIGH | MEDIUM | Favorable but with counter-evidence; Actionability MEDIUM-HIGH |
| HIGH | HIGH | Favorable evidence AND structural deterioration — contradictory; requires evidence review; Actionability MEDIUM |
| MEDIUM | LOW | Mildly favorable; Actionability MEDIUM |
| MEDIUM | MEDIUM | Balanced; Actionability MEDIUM |
| MEDIUM | HIGH | Deterioration dominant; Actionability MEDIUM |
| LOW | LOW | No decision-relevant change; Actionability LOW |
| LOW | MEDIUM | Weak context with some deterioration; Actionability LOW-MEDIUM |
| LOW | HIGH | Adverse; Actionability HIGH when Direction NEGATIVE + Confidence ≥ MEDIUM |
| UNKNOWN | any | Direction UNKNOWN; Actionability UNKNOWN |
| any | UNKNOWN | Direction UNKNOWN (context missing); Actionability UNKNOWN |

---

## 14. UNKNOWN propagation matrix

| Condition | Direction | Opportunity | Risk | Confidence | Actionability |
|---|---|---|---|---|---|
| Missing P3 (no artifact) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Invalid P3 (load-bearing) | UNKNOWN | UNKNOWN | UNKNOWN | LOW | UNKNOWN |
| Stale P3 | determinable | capped MEDIUM | determinable | ≤MEDIUM | per table |
| Insufficient history (<2) | UNKNOWN | UNKNOWN | UNKNOWN | LOW | UNKNOWN |
| Ambiguous identity | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Missing P2 | no effect | no effect | no effect | no effect | no effect |
| Partial P2 | no effect | no effect | no effect | −0 (recorded) | no effect |
| Conflicting evidence | per §4/§9 | never HIGH | per §11 | −1/LOW | never HIGH (material) |
| No signals (but valid evidence) | per §4 | per §12 | per §12 | computable | per §8 |

Confidence remains determinable (LOW) in several UNKNOWN cases — UNKNOWN does
not blanket-propagate.

---

## 15. Explanation / evidence selection

- Every explanation: statement + supporting evidence references + optional
  conflicting evidence + interpretation role (primary/secondary/contextual/
  conflicting).
- Selection: primary items = evidence that decided the output (≤3);
  conflicting items = opposing evidence (≤2); contextual = sufficiency and
  identity (≤2).
- All text is template-derived from evidence values (artifact ids, deltas,
  states); no invented narrative, no LLM.
- Minimum 1 explanation per changed output; maximum 6 per ViewModel.

---

## 16. Canonical scenarios (12 semantic test vectors)

**Scenario 1 — Strong and broad.** P3: regime STRONG (EMERGING→STRONG Δ+1),
rotation ACCELERATING score 82 (+8Δ), breadth 0.65 (+0.2Δ), momentum +6.2
(+3.0Δ), RS +0.035 (+0.01Δ), leadership stable, trend IMPROVING, 3 artifacts,
sufficiency OK. P2: none. → Signals: NARRATIVE_IMPROVEMENT, REGIME_CHANGE,
ROTATION_CHANGE, BROADENING. Direction POSITIVE. Opportunity HIGH. Risk LOW.
Confidence HIGH. Actionability HIGH.

**Scenario 2 — Strong but concentrated.** Same as S1 but breadth 0.30
(−0.10Δ ⇒ NARROWING) and constituents count low (leadership concentrated).
→ Signals: NARRATIVE_IMPROVEMENT, NARROWING, EVIDENCE_CONFLICT (minor —
momentum POSITIVE vs breadth NEGATIVE fires §3.9). Direction POSITIVE
(dominant core; breadth opposes → minor conflict, Confidence −1).
Opportunity MEDIUM (positive direction but narrowing participation suppresses
HIGH). Risk MEDIUM (narrowing). Confidence MEDIUM. Actionability MEDIUM.
[Signal list completed by P4-05A SEMANTIC RESOLUTION §21/C4.]

**Scenario 3 — Clear deterioration.** regime WEAKENING (NEUTRAL→WEAKENING),
rotation STABLE score 49 (−11Δ), breadth 0 (−0.14Δ), momentum −2.4 (−1.4Δ),
RS +0.040 (−0.008Δ STABLE), trend DETERIORATING, 3 artifacts.
→ Signals: NARRATIVE_DETERIORATION, REGIME_CHANGE, NARROWING. Direction
NEGATIVE. Opportunity LOW. Risk HIGH. Confidence HIGH (RS STABLE is not a
§3.9 directional conflict — it has no opposing sign; the superseded
parenthetical suggesting MEDIUM is removed by P4-05A SEMANTIC RESOLUTION
§21/C3). Actionability HIGH.

**Scenario 4 — Weakening with still-positive RS.** regime WEAKENING→WEAKENING
(regimeMove NEUTRAL), momentum −2.4 (−1.4Δ), rotation −6Δ, breadth −0.1Δ, RS
+0.05 (+0.02Δ IMPROVING), trend DETERIORATING. → Signals:
NARRATIVE_DETERIORATION (trend DET + momentum DET; regimeMove not POSITIVE),
EVIDENCE_CONFLICT (RS vs core, minor), NARROWING (breadth −0.14Δ ⇒ NEGATIVE
beyond ε fires §3.5). Direction NEGATIVE (dominant core;
RS opposing → conflict, Confidence −1). Risk HIGH. Opportunity LOW.
Confidence MEDIUM. Actionability HIGH.
[Signal list completed by P4-05A SEMANTIC RESOLUTION §21/C4.]

**Scenario 5 — Neutral regime with mixed metrics.** regime NEUTRAL→NEUTRAL,
rotation score +3Δ (NEUTRAL), momentum +4Δ (POSITIVE), breadth −0.12Δ
(NEGATIVE), RS +0.01Δ (STABLE). → Signals: EVIDENCE_CONFLICT (minor),
BROADENING? no (breadth NEGATIVE) → NARROWING. Direction MIXED (tentative
POS + opposing breadth). Opportunity LOW. Risk MEDIUM (narrowing).
Confidence MEDIUM. Actionability MEDIUM.

**Scenario 6 — True MIXED.** regime NEUTRAL→NEUTRAL, rotation score −7Δ
(NEGATIVE), momentum +5Δ (POSITIVE), breadth +0.08Δ (POSITIVE), RS +0.02Δ.
→ Signals: EVIDENCE_CONFLICT (material: core split), ROTATION_CHANGE. Direction
MIXED (core split 1-1). Opportunity LOW. Risk MEDIUM. Confidence MEDIUM
(material conflict ⇒ not HIGH). Actionability MEDIUM.

**Scenario 7 — UNKNOWN due to insufficient history.** 1 artifact only.
→ Direction UNKNOWN (INSUFFICIENT_HISTORY). Opportunity UNKNOWN. Risk
UNKNOWN. Confidence LOW. Actionability UNKNOWN.

**Scenario 8 — Stale evidence.** current artifact STALE, windowEnd older than
freshness. → Direction determinable only if delta evidence still available
and STALE-cap applies; Opportunity capped MEDIUM; Risk determinable;
Confidence ≤ MEDIUM (stale cap); Actionability per table.

**Scenario 9 — High P2 event-risk on one coin.** P3 healthy (Direction
POSITIVE, structural LOW risk); one constituent has active coin-local HIGH
event. → Signals: NARRATIVE_IMPROVEMENT (P3-only). Direction POSITIVE.
Opportunity HIGH. Risk LOW (coin-local event recorded as secondary evidence,
no narrative risk change). Confidence HIGH. Actionability HIGH.

**Scenario 10 — Narrative-wide event risk.** P3 healthy; eventRisks row with
narrativeId = narrative, riskLevel HIGH, active. → Risk MEDIUM (structural
LOW +1 tier from narrative-wide P2; never HIGH from P2 alone). Opportunity
MEDIUM (suppressed from HIGH). Provenance source = P2_EVENT_RISK on the
evidence reference. Actionability MEDIUM.

**Scenario 11 — Current positive + historical deterioration.** current
direction POSITIVE (regime EMERGING, momentum +3Δ, rotation +8Δ), trend
DETERIORATING (previous steps). → Direction POSITIVE (current evidence;
historical does not override). Confidence MEDIUM (−1 for historical
contradiction). Opportunity MEDIUM (historical counter-evidence suppresses
HIGH). Risk MEDIUM (historical deterioration is structural context).
Actionability MEDIUM.

**Scenario 12 — Current negative + historical improvement.** current
NEGATIVE (regime WEAKENING, momentum −3Δ, rotation −8Δ), trend IMPROVING
(prior steps). → Direction NEGATIVE. Risk HIGH. Opportunity LOW. Confidence
MEDIUM (−1 historical contradiction). Actionability HIGH.

---

## 17. Provisional rules (require historical validation)

Marked **PROVISIONAL — REQUIRES P4 HISTORICAL VALIDATION** (business
heuristics; not derived from frozen P3 semantics):

1. Direction corroborator set X = {breadthMove, rsMove} and its
   reconciliation rules (§4 Step 3: tentative + opposing → MIXED; NEUTRAL
   base + split corroborators → MIXED).
2. Conflict materiality definition (core-vs-breadth vs corroborator-only)
   and severity mapping (§9).
   [v1 semantic content FROZEN by P4-05A SEMANTIC RESOLUTION §21/C1 — the
   PROVISIONAL marker now refers only to the future historical-validation
   review trigger, not to unresolved semantics.]
3. P2 scope tiers: multi-coin (≥2 constituents) and narrative-wide
   (+1 tier, cap HIGH, never sole HIGH) (§10, §11).
4. Opportunity base/suppression ladder (HIGH requires Direction POSITIVE +
   non-deteriorating corroborators; each adverse condition −1 tier, floor
   LOW) (§12).
5. Risk base thresholds (≥2 structural DET ⇒ HIGH; 1 ⇒ MEDIUM; 0 ⇒ LOW)
   (§12).
6. Confidence dimension combination table and caps (§7).
   [v1 semantic content FROZEN by P4-05A SEMANTIC RESOLUTION §21/C2 — the
   PROVISIONAL marker now refers only to the future historical-validation
   review trigger, not to unresolved semantics.]
7. Actionability table (§8).
8. Opportunity × Risk explanation matrix (§13).
9. Signal corroboration minimums for NARRATIVE_* (§3.10).

**Frozen (not provisional):** trend epsilons, regime/rotation ranks, trend
states, availability mapping, signal identity, UNKNOWN gates, NEUTRAL≠MIXED≠
UNKNOWN, P2 secondary-only + provenance, direction-core composition
(regime+rotation+momentum — mirrors frozen P3-14 D.1 overall trend).

---

## 18. Versioning

```text
algorithmVersion        = "p4-decision-support"
semanticVersion         = "1"
interpretationRuleVersion = "p4-03/v1"
signalCatalogVersion    = "v1"
result attribution      = provenance { algorithmVersion, semanticVersion,
                            interpretationRuleVersion, signalCatalogVersion }
```

Any future change to these interpretation rules (including numeric scoring)
bumps `interpretationRuleVersion` (and `semanticVersion` if P4 Core semantics
change). No storage implementation in P4-03.

---

## 19. Non-goals

No code, no `src/` tests, no P3/P2 change, no database tables/migrations, no
API fields, no UI change, no ML/LLM, no price prediction, no trading
execution, no numeric composite scoring, no change to frozen P4-01/P4-02
contracts.

---

## 20. Acceptance criteria

- [x] Every v1 signal has deterministic firing/suppression rules (§3).
- [x] Direction aggregation is deterministic (§4).
- [x] MIXED/NEUTRAL/UNKNOWN separated (§5, 8 scenarios).
- [x] Historical Trend interaction defined (§6).
- [x] Opportunity rules defined (§12).
- [x] Risk rules defined (§12, §11).
- [x] P2 Event Risk projection defined (§10).
- [x] Confidence rules defined (§7).
- [x] Actionability rules defined (§8).
- [x] Opportunity × Risk interaction defined (§13).
- [x] Conflict handling defined (§9).
- [x] UNKNOWN propagation defined (§14).
- [x] Explanation/evidence selection defined (§15).
- [x] ≥12 semantic test vectors (§16: 12).
- [x] Provisional rules explicitly marked (§17).
- [x] No numeric composite formula introduced.
- [x] No production code changed.
- [x] P4-04 implementation NOT started.
- [x] P4-05A semantic conflict resolution recorded (§21).

---

## 21. P4-05A Semantic Conflict Resolution

**Status:** FROZEN v1 semantic contract (P4-05A-REVIEW). Authoritative
resolution record for the five prose-vs-canonical-scenario contradictions
found by the P4-05A implementation audit. The Master specification §19B is
the phase-level authoritative record; this section is the task-level detail.

**Decision hierarchy applied (Master §1):** frozen rules > deterministic
mathematical/threshold rules inherited from P3 > detailed prose > canonical
examples. Canonical examples MUST NOT override a frozen deterministic rule —
where an example conflicted with one, the example was corrected; where the
prose was internally inconsistent or contradicted every scenario vector, the
internally-consistent reading was adopted and the prose clause superseded.

### C1 — Core-vs-breadth conflict materiality → MINOR (core split = material)

- **Issue:** §9.2 prose included "OR core-vs-breadth" in the material set;
  canonical Scenarios 2 and 5 both label breadth-vs-core conflicts "minor".
- **Conflicting statements:** §9.2 "material ... OR core-vs-breadth" vs
  Scenario 2 "breadth opposes → minor conflict" and Scenario 5
  "EVIDENCE_CONFLICT (minor)" for momentum-vs-breadth.
- **Evidence:** §9.3 defines severity over conflicting CORE pairs (≥2 pairs
  ⇒ HIGH, 1 ⇒ MEDIUM, minor ⇒ LOW); a breadth-vs-core conflict has zero core
  pairs, so its severity is undefined under the prose reading — an internal
  contradiction within §9 itself. §4 Step 3 and §3.10 design breadth/RS as
  corroborators that never flip a dominant core lean, so corroborator
  opposition is structurally minor. All canonical scenarios treat
  breadth-vs-core as minor.
- **Final decision:** material = an opposite-sign pair WITHIN the direction
  core {regimeMove, rotationScoreMove, momentumMove} (a core split).
  Core-vs-breadth, core-vs-RS and corroborator-vs-corroborator are MINOR.
- **Rationale:** internal consistency with §9.3 (severity over core pairs),
  §4 corroborator semantics and §3.10 balance; consistent with every
  canonical scenario.
- **Impact on implementation:** none — P4-05A already implements
  core-split-only materiality (`detectConflict`: `material = corePairs > 0`).
- **Required test update:** none — tests already assert minor severity for
  breadth-vs-core (Scenarios 2/5).
- **Status:** FROZEN (v1). The §17 historical-validation review trigger
  remains as a future review gate only.

### C2 — Material conflict and Confidence → cap MEDIUM (never HIGH)

- **Issue:** §7/§9 prose said "material conflict ⇒ Confidence LOW"; Scenario 6
  says "Confidence MEDIUM (material conflict ⇒ not HIGH)".
- **Conflicting statements:** §7 combination "material conflict ⇒ LOW" and
  §9 "Impact on Confidence: minor −1; material ⇒ LOW" vs Scenario 6
  "Confidence MEDIUM (material conflict ⇒ not HIGH)".
- **Evidence:** §14 records conflicting-evidence Confidence as "−1/LOW"
  (ambiguous). Scenario 6 is the only canonical vector covering
  material-conflict confidence and is explicit. Under "material ⇒ LOW", a
  full-coverage material conflict (Scenario 6: all five moves VALID) would be
  indistinguishable from a coverage-gapped interpretation — collapsing
  distinct evidence states; §9 states conflict is interpretation uncertainty,
  not missing evidence.
- **Final decision:** a material conflict CAPS Confidence at MEDIUM (never
  HIGH). A minor conflict reduces one level. Coverage floors remain: with
  coverage LOW, a material conflict stays LOW.
- **Rationale:** preserves the confidence ladder's expressiveness (HIGH =
  clean, MEDIUM = conflicted, LOW = coverage-gapped), matches the only
  canonical vector, and keeps §14's "−1/LOW" reading coherent.
- **Impact on implementation:** none — P4-05A already caps at MEDIUM
  (`interpretConfidence`: `if (conflict.material) tier = capTier(tier, MEDIUM)`).
- **Required test update:** none — Scenario 6 test asserts MEDIUM.
- **Status:** FROZEN (v1). Historical-validation review trigger remains.

### C3 — Scenario 3 Confidence → HIGH

- **Issue:** Scenario 3 stated "Confidence MEDIUM (RS stable/conflict minor)".
- **Conflicting statements:** the parenthetical vs §3.9 (conflict requires
  opposing signs) and Scenario 3's own signals list (no EVIDENCE_CONFLICT).
- **Evidence:** RS STABLE has no opposing sign, so it is NOT a directional
  conflict under §3.9; it does not fire EVIDENCE_CONFLICT (the scenario's own
  signals list confirms none fired); it does not flip or reduce Direction
  (only VALID non-UNKNOWN *opposing* corroborators count, §4 Step 3).
  Coverage is full (all five moves VALID); no opposing corroborator; no
  historical divergence ⇒ Confidence HIGH.
- **Final decision:** Scenario 3 Confidence = HIGH. The "RS stable/conflict
  minor" parenthetical is removed (it treated neutral evidence as conflict,
  contradicting §3.9).
- **Impact on implementation:** none — P4-05A already produces HIGH.
- **Required test update:** none — the S3 test asserts HIGH.
- **Status:** FROZEN (scenario corrected).

### C4 — Missing signals in canonical scenarios → scenarios completed

- **Issue:** Scenario 2 omits EVIDENCE_CONFLICT although momentum POSITIVE vs
  breadth NEGATIVE satisfies the §3.9 firing rule (both VALID, opposing
  signs); Scenario 4 omits NARROWING although breadth −0.14Δ is NEGATIVE
  beyond the frozen ε 0.05 (fires §3.5).
- **Conflicting statements:** the scenario signal lists vs the deterministic
  §3 signal rules.
- **Evidence:** the §3 rules are unambiguous and are not weakened by this
  resolution; the scenarios' parentheticals reference the very conflicts they
  omit from the signal lists.
- **Final decision:** the deterministic signal rules stand; the scenarios are
  incomplete. Scenario 2 signals = NARRATIVE_IMPROVEMENT, NARROWING,
  EVIDENCE_CONFLICT (minor). Scenario 4 signals = NARRATIVE_DETERIORATION,
  EVIDENCE_CONFLICT (minor), NARROWING.
- **Rationale:** per P4-05A-REVIEW — do not weaken signal rules to preserve
  scenario text; scenario completeness follows deterministic signal rules.
- **Impact on implementation:** none — P4-05A already fires both signals.
- **Required test update:** none — tests assert EVIDENCE_CONFLICT in S2 and
  NARROWING in S4.
- **Status:** FROZEN (scenarios completed).

### C5 — §5 Scenario S2 mathematical contradiction → scenario defect, corrected

- **Issue:** S2 specifies momentum +5Δ and breadth +0.1Δ yet concludes
  NEUTRAL "(no move beyond ε; valid, no conclusion)".
- **Conflicting statements:** the S2 deltas vs the frozen epsilons (momentum
  1.0, breadth 0.05) and §2.3/§4 deterministic rules.
- **Evidence:** +5Δ > 1.0 ⇒ momentumMove POSITIVE; +0.1Δ > 0.05 ⇒ breadthMove
  POSITIVE. A NEUTRAL outcome is mathematically unreachable under the frozen
  rules — the parenthetical is factually wrong for the stated deltas.
- **Final decision:** S2 is a canonical scenario defect. The frozen epsilons
  are NOT modified. S2 is corrected to within-ε deltas preserving the
  intended NEUTRAL outcome: regime NEUTRAL→NEUTRAL, momentum +0.5Δ, breadth
  +0.04Δ, rotation score +2Δ ⇒ all moves NEUTRAL ⇒ Direction NEUTRAL.
- **Rationale:** canonical examples must not override frozen deterministic
  (threshold) rules; the scenario text is corrected to match its stated
  intent.
- **Impact on implementation:** none — S2 is a test vector, not
  implementation logic.
- **Required test update:** none — no test asserted the defective vector.
- **Status:** FROZEN (scenario corrected; frozen ε untouched).

---

### Superseded-clause registry (in-place annotations above)

| Location | Superseded clause | Final rule |
|---|---|---|
| §9.2 Materiality | "material ... OR core-vs-breadth" | Material = core split only (C1) |
| §7 Combination | "material conflict ⇒ LOW" | Material ⇒ cap MEDIUM, never HIGH (C2) |
| §9 Impact on Confidence | "material ⇒ LOW" | Material ⇒ cap MEDIUM, never HIGH (C2) |
| §16 Scenario 3 | "Confidence MEDIUM (RS stable/conflict minor)" | Confidence HIGH (C3) |
| §16 Scenarios 2/4 | signal lists omitting fired signals | Lists completed per §3 rules (C4) |
| §5 Scenario S2 | deltas exceeding frozen ε | Deltas corrected within ε (C5) |

### Frozen-status summary

- Frozen epsilons, ranks, trend states, UNKNOWN gates, NEUTRAL/MIXED/UNKNOWN
  separation, Direction core composition, P2 provenance and signal identity:
  UNCHANGED (never touched by this resolution).
- Signal firing rules (§3): UNCHANGED — scenarios completed, not weakened.
- Conflict materiality (C1) and Confidence caps (C2): v1 semantic content
  FROZEN; the §17 PROVISIONAL marker now refers only to the future
  P4 historical-validation review trigger.
- P4-05A implementation status: **A. APPROVED** — the implementation already
  matches every final decision; no code change required.
