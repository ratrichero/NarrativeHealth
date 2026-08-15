# P4-02 — Semantic Contract Freeze & Read Path Specification

**Status:** SPECIFICATION ONLY — authoritative P4-02 contract. No production
code, no scoring formulas, no UI/API/service implementation, no database
migration, no P3 modification.

**Baseline:** P4-01 (`P4_01_DECISION_SUPPORT_CONTRACT_AND_GAP_AUDIT.md`) and
P4-01A (Semantic Decision Addendum — Q1–Q5, mandatory). P3 is CLOSED; P3
semantics are frozen.

**Read-then-write method:** every statement below was verified against the
repository during P4-01/P4-01A and re-checked for this document (P3 read
models/services, narrative API + tests, decision/event-risk types, DB schema in
both `src/db/schema.ts` and `drizzle/schema.ts`, P3 UI, P3 persistence
boundary).

---

## 1. Audit summary (verified facts used by this spec)

| Subject | Verified location | Used as |
|---|---|---|
| P3 availability states | `src/lib/p3/availability.ts` — VALID, MISSING, INVALID, STALE, INSUFFICIENT_HISTORY, NOT_APPLICABLE, AMBIGUOUS | §12 evidence states |
| P3 current read model | `src/lib/types/p3-intelligence.ts` (P3IntelligenceViewModel) + `src/lib/services/p3-intelligence.service.ts` (getLatestValidP3Intelligence) | §14 evidence mapping |
| P3 historical read model | `src/lib/types/p3-intelligence-history.ts` (P3IntelligenceHistoryViewModel, P3TrendState incl. TRANSITION) + `src/lib/services/p3-intelligence-history.service.ts` (frozen epsilons, identity grouping) | §15 history contract |
| Narrative API | `src/app/api/narratives/[id]/route.ts` — `data.p3Intelligence` / `data.p3IntelligenceHistory` degrade-to-null on read failure; 404 on missing narrative | §18 API |
| Narrative page | `src/app/narrative/[id]/page.tsx` — header → Health chart → P3IntelligencePanel → CorrelationHeatmap → Coin table | §19 UI |
| P3 UI | `src/components/P3IntelligencePanel.tsx`, `P3HistoricalTrend.tsx` | §19 UI |
| P2 Event Risk | `src/db/schema.ts` `event_risks` (coinId/narrativeId nullable, eventType, eventDate, riskLevel, riskScore, title, isActive, expiresAt); `src/lib/services/event-risk.service.ts`; `src/lib/types/event-risk.ts`; parallel def in `drizzle/schema.ts` | §9, §14 |
| P2 Decision Engine | `src/lib/services/decision-engine.service.ts` (eventRiskScore ≥80 → −25, ≥60 → −15, ≥40 → −8; correlationRisk ≥80 → −10); `src/lib/types/decision-signal.ts` | §9, §21 (excluded from P4 scoring) |
| P3 persistence boundary | `src/lib/p3/persistence.ts` `persistP3Calculation` (insert-only, immutable) | §17 (P4 read-only) |
| Narrative route tests | `src/app/api/narratives/__tests__/route-resilience.test.ts` | §18 degrade contract |
| Regime implementation | `src/lib/p3/regime.ts` `P3_REGIMES` incl. NEUTRAL | §6, §7, §23 |

---

## 2. Frozen semantic decisions (from P4-01A — binding)

- **Q1** — P4 = Decision Support. P4 Core: Signal, Direction, Opportunity,
  Risk, Confidence, Actionability, Explanation/Evidence Traceability. Legacy
  roadmap items (Token Unlock, Catalyst/Event, Narrative Discovery, Smart
  Money/On-chain) are preserved as **P4 Evidence Extensions** — optional future
  evidence providers that must not redefine P4 Core.
- **Q2** — `P3 Regime = NEUTRAL` is real and valid; `NEUTRAL → NEUTRAL` at
  regime level; P4 Direction is **not** `direct lookup(Regime)`; NEUTRAL never
  degrades to UNKNOWN/MISSING/INSUFFICIENT_HISTORY/INVALID/MIXED unless the
  independent P4 evidence interpretation produces that meaning.
- **Q3** — MIXED (current conflicting directional evidence) and TRANSITION
  (frozen P3 historical trajectory state) are orthogonal; **no 1:1 mapping**.
- **Q4** — P4 v1 qualitative buckets only: **LOW | MEDIUM | HIGH | UNKNOWN**
  for Opportunity, Risk, Confidence, Actionability. No composite numeric score,
  no weights, no probability, no ML confidence.
- **Q5** — P2 Event Risk may be consumed only as secondary evidence with
  provenance `source = P2_EVENT_RISK`; cannot overwrite/mutate P3; cannot
  silently become P3 structural evidence; coin-level risk ≠ narrative risk;
  conflicts stay visible; **P2 Decision Engine thresholds are NOT P4
  thresholds**.

---

## 3. P4 semantic contract

### 3.1 Signal

**Purpose:** the smallest named, interpretable event/state derived from one or
more P3 facts or trends (optionally corroborated by P2 secondary evidence).
Signals make P4 conclusions auditable: each signal names the evidence it is
built from.

**Identity:** a signal occurrence is identified by the tuple
`(signalId, narrativeId, windowEnd)` — one occurrence per signal per narrative
window (no duplicates; repeated windows collapse into one occurrence whose
evidence list grows).

**Stable identifier:** catalog id, e.g. `p4:signal:NARRATIVE_DETERIORATION:v1`.
The catalog is versioned (§25); identifiers must not change meaning across
semantic versions without a new id.

**Title/label:** human display title (e.g., "Narrative deterioration").

**Severity (if applicable):** qualitative only (`LOW | MEDIUM | HIGH`),
derived from the same evidence as the signal; never a standalone numeric.

**Direction relation:** each signal declares its directional lean
(POSITIVE / NEGATIVE / MIXED / NEUTRAL / UNKNOWN) which contributes to the
aggregate Direction (§7).

**Evidence requirements:** every signal requires the frozen evidence fields it
is defined over to be VALID for the current artifact (and, for trend-based
signals, for the latest step). A signal whose required evidence is unavailable
is **not emitted**; it is never emitted as UNKNOWN.

**Provenance requirements:** each signal carries the evidence references
(§13) that produced it — artifact ids, steps, and (if used) `P2_EVENT_RISK`
items.

**Lifecycle:** signals are **derived at read time** over the latest P3
artifact + history view model for a narrative; they are not persisted (see
§16 persistence decision). A signal exists for a narrative window and is
recomputed whenever the read path runs.

**Duplicate handling:** one occurrence per `(signalId, narrativeId, windowEnd)`.
If the same signal fires across multiple consecutive windows, it remains one
occurrence whose evidence list spans the windows (the interpretation can note
persistence).

**UNKNOWN behavior:** UNKNOWN is not a signal value. When evidence cannot
justify a signal, the signal is absent from `signals[]`, and the ViewModel's
`direction`/`confidence` fields carry the UNKNOWN semantics instead.

**Minimum viable catalog (v1)** — each entry is justified by persisted
evidence (P3 read model + P3-18 history); none is included "because it sounds
useful":

| Signal | Evidence (frozen) | Direction relation | Justification in repo |
|---|---|---|---|
| `NARRATIVE_IMPROVEMENT` | regime rank up (A9 + B5) AND overall trend = IMPROVING (B6) AND rotation score delta improving (A10/B5) | POSITIVE | P3-14 trend semantics; regime rank table |
| `NARRATIVE_DETERIORATION` | regime rank down (A9/B5) AND overall trend = DETERIORATING (B6) AND momentum delta deteriorating (A12/B5) | NEGATIVE | Production chain NEUTRAL→WEAKENING→WEAKENING, trend DETERIORATING |
| `BROADENING` | breadth delta improving beyond frozen ε (A11/B5) | POSITIVE | Breadth stage + breadth epsilon (0.05) |
| `NARROWING` | breadth delta deteriorating beyond frozen ε (A11/B5) | NEGATIVE | Same evidence |
| `LEADERSHIP_CHANGE` | leadership.changed = true in latest step (A14/B5) | MIXED (identity change; direction not defined across coins) | Production BLUAI→TRUTH→PROMPT |
| `REGIME_CHANGE` | regime transition ≠ STABLE in latest step (A9/B5) | IMPROVING/DETERIORATING by rank | Production NEUTRAL→WEAKENING |
| `ROTATION_CHANGE` | rotation transition ≠ STABLE in latest step (A10/B5) | IMPROVING/DETERIORATING by rank | Production ACCELERATING→INFLOW→STABLE |
| `EVIDENCE_CONFLICT` | any latest step contains both an IMPROVING and a DETERIORATING metric state (B5) | MIXED | Production step 11→13: momentum DET + RS IMPROVING |

**Do NOT invent** other signals in v1 (no unlock/catalyst/on-chain signals —
those are P4 Evidence Extensions, not P4 Core, and require new data).

### 3.2 Direction contract

**Allowed values (frozen):** `POSITIVE | NEGATIVE | MIXED | NEUTRAL | UNKNOWN`.

- **POSITIVE** — current evidence (signals + metric deltas) is materially
  aligned toward improvement.
- **NEGATIVE** — current evidence is materially aligned toward deterioration.
- **MIXED** — current evidence contains materially conflicting directional
  signals (Q3: independent of historical TRANSITION).
- **NEUTRAL** — valid, sufficient evidence with no directional conclusion
  (all compared metrics within frozen stability tolerances).
- **UNKNOWN** — insufficient evidence to determine direction (see §12).

**Minimum evidence expectations:** a current artifact with
`availabilityState = VALID`; for any delta-based judgment, at least the latest
step (previous artifact available, `dataSufficiency.comparableArtifacts >= 2`);
for trend-based judgments, the frozen B6 states.

**Relationship with P3 Regime:** not a lookup. Regime contributes one piece of
evidence; Direction is the aggregate interpretation of all valid evidence
(Q2). `Regime = NEUTRAL` alone ⇒ `Direction = NEUTRAL` only when the remaining
evidence is also non-directional; conflicting valid evidence ⇒ MIXED;
unavailable load-bearing evidence ⇒ UNKNOWN.

**Relationship with P3 historical trend:** orthogonal axis (Q3). Direction
describes the *current* interpretation; Historical Trend describes
change/trajectory across artifacts. Both are reported; neither derives the
other by formula.

**Relationship with signal:** Direction is the aggregate of emitted signals'
direction relations, with weightless evidence reconciliation: if any
load-bearing evidence for direction is unavailable → UNKNOWN; if the emitted
signals are purely conflicting → MIXED; if they agree → their shared lean.

**What Direction is NOT:** not P3 Regime, not P3 Historical Trend, not a
prediction, not a recommendation, not an action.

**When Direction must become UNKNOWN:** no VALID current artifact; no
comparable previous artifact and the intended conclusion is delta-based;
load-bearing stage unavailable (e.g., rotation MISSING and rotation is
required for the conclusion); unresolvable ambiguity (AMBIGUOUS evidence); any
frozen rule produces UNKNOWN (P4-01 §5.6). Direction must never be forced.

### 3.3 Opportunity contract

**Meaning:** potentially favorable decision context indicated by evidence
alignment (e.g., improving regime/trend, inflow/accelerating rotation,
broadening breadth, positive momentum deltas).

**Scope:** narrative-level, current-window interpretation. Not a price target,
expected return, guaranteed upside, buy recommendation, or trading signal.

**Evidence expectations:** ≥1 POSITIVE signal or ≥2 corroborating improving
deltas (rotation score, breadth, momentum, RS) from the latest step, with the
current artifact VALID. Insufficient or conflicting evidence ⇒ UNKNOWN.

**Allowed values:** `LOW | MEDIUM | HIGH | UNKNOWN` (Q4).

**UNKNOWN behavior:** no/insufficient evidence, or load-bearing evidence
unavailable ⇒ UNKNOWN (never LOW by default).

**Non-goals:** no numeric formula, no weights, no probabilities, no expected
return, no buy/trade semantics (P5).

### 3.4 Risk contract

**Meaning:** potentially unfavorable deterioration/exposure context indicated
by evidence (weakening regime/trend, narrowing breadth, negative momentum,
leadership churn, outflow rotation, plus — as secondary evidence only —
active P2 event risks).

**Scope:** narrative-level interpretation of current deterioration/exposure.
Not automatically: probability of loss, probability of crash, sell signal, or
short signal.

**Evidence expectations:** ≥1 NEGATIVE signal or ≥2 corroborating
deteriorating deltas from the latest step; current artifact VALID.

**Allowed values:** `LOW | MEDIUM | HIGH | UNKNOWN`.

**UNKNOWN behavior:** insufficient evidence ⇒ UNKNOWN.

**Three-way distinction (mandatory):**
- **P3 structural risk evidence** — persisted P3 stages/trends
  (regime/rotation/breadth/momentum/RS/leadership deterioration). Primary.
- **P2 event-specific evidence** — `event_risks` rows (riskLevel/riskScore,
  coin- or narrative-scoped). Secondary only; provenance
  `source = P2_EVENT_RISK`; coin-level events never automatically become
  narrative-level risk (Q5 rule 5).
- **P4 interpreted narrative risk** — the synthesized qualitative Risk value
  derived from the above with explicit evidence references.

**Non-goals:** no probability of loss; no numeric formula; no weights; no
sell/short semantics.

### 3.5 Confidence contract

**Meaning:** strength of evidence supporting the P4 interpretation. Depends
conceptually on:
- **evidence availability** (how many required fields are VALID),
- **evidence sufficiency** (series length vs `dataSufficiency.requiredMinimum`),
- **evidence consistency** (absence of unresolvable conflicts),
- **historical support** (number of steps confirming the conclusion),
- **provenance integrity** (identity-compatible, same algorithm/mode/window).

**No numeric weights** are defined (Q4). **Allowed values:**
`LOW | MEDIUM | HIGH | UNKNOWN`.

**Cap / reduction rules (conceptual, no percentages):**
- Stale current artifact (A8/A4) ⇒ capped at MEDIUM (flagged `STALE`).
- Insufficient history for the conclusion type ⇒ capped at LOW.
- Conflicting critical evidence (EVIDENCE_CONFLICT on load-bearing fields) ⇒
  reduced one level from the unconflicted value.
- Unavailable required evidence ⇒ **UNKNOWN** (never a fabricated level).
- Provenance mismatch (mixed identity) ⇒ UNKNOWN for that conclusion.

### 3.6 Actionability contract

**Meaning:** how useful the available interpretation is for a decision at the
current evidence state. Separated from Confidence (Q4; P4-01 §5.4):

> High confidence does NOT imply high actionability. Example: a very reliable
> (high-confidence) signal with weak decision differentiation may be
> `Confidence = HIGH`, `Actionability = LOW`.

**Allowed values:** `LOW | MEDIUM | HIGH | UNKNOWN`.

**Determinants (conceptual):** presence of a decision-relevant change
(direction ≠ NEUTRAL/UNKNOWN, emitted signals), evidence freshness, and
whether the interpretation distinguishes a meaningful course of attention.

**What it is NOT:** not an instruction to buy/sell, not execution priority,
not portfolio allocation, not a recommendation (P5 territory).

**UNKNOWN behavior:** Direction UNKNOWN or required evidence unavailable ⇒
Actionability UNKNOWN.

---

## 4. Evidence Sufficiency Contract

**Lifecycle (frozen):**

```text
Observed evidence
    ↓
Evidence availability
    ↓
Evidence consistency
    ↓
Evidence sufficiency
    ↓
Interpretation
    ↓
Decision support
```

**Evidence states (map to P3 availability + P4 behavior):**

| State | Definition | P4 output behavior |
|---|---|---|
| sufficient | All required evidence VALID and identity-compatible | Interpret normally |
| partially sufficient | Some required evidence VALID, non-load-bearing gaps | Interpret with Confidence reduced (cap per §3.5); record gaps |
| insufficient | Series shorter than required for the conclusion type, or load-bearing evidence missing | That conclusion → **UNKNOWN**; reason recorded |
| invalid | Evidence exists but violates range/identity/unit/time (P3 `INVALID`) | Excluded; load-bearing ⇒ UNKNOWN |
| stale | Evidence older than freshness bound (P3 `STALE`) | Flagged; Confidence capped at MEDIUM; never treated as fresh |
| ambiguous | Multiple mappings/sources prevent selection (P3 `AMBIGUOUS`) | UNKNOWN until resolved; never silently chosen |
| unavailable | MISSING / NOT_APPLICABLE / INSUFFICIENT_HISTORY on required field | UNKNOWN for dependent conclusion (NOT_APPLICABLE ≠ STABLE) |

**Mandatory distinctions (P4-01A Q2/Q3, §12):**

```text
NEUTRAL = valid evidence, no directional conclusion
MIXED   = valid sufficient evidence, but conflicting direction
UNKNOWN = insufficient evidence to support a conclusion
```

These three are disjoint. A missing stage is UNKNOWN-generating, never NEUTRAL;
NEUTRAL requires valid, non-conflicting, non-directional evidence; MIXED
requires sufficient valid evidence that points in conflicting directions.

---

## 5. Evidence Traceability Contract

**Every P4 conclusion must be traceable.** Standard evidence reference:

| Field | Meaning | Example |
|---|---|---|
| sourceLayer | P3 / P2 / P4 | P3 |
| sourceType | artifact field / step / trend / event_risk / signal | step |
| sourceIdentifier | concrete id | artifact 10 / step 13→15 / event_risk 42 |
| artifactIdentity | (narrativeId, windowEnd, algorithmKey, algorithmVersion, calculationMode) | (1, 2026-08-15, p3-orchestrator, 1, observed) |
| narrativeIdentity | narrativeId | 1 |
| windowOrDate | windowEnd / eventDate | 2026-08-15 |
| fieldOrMetric | regime / rotation / breadth / momentum / relativeStrength / leadership / constituents / overallTrend / riskScore | momentum |
| status | P3 availability state of the referenced evidence | VALID |
| interpretationRole | primary / secondary / contextual / conflicting | primary |

**Roles:** primary = decisive for a conclusion; secondary = supporting
(non-decisive; P2 event risk is always secondary); contextual = background
(identity, sufficiency); conflicting = evidence that argues against the
conclusion and was weighed (must be shown, not hidden — Q5 rule 7).

**Multiple items:** `evidence[]` is an ordered array of evidence references;
`explanation` references them by index. **P4 may not cite itself as the only
evidence for a conclusion** (a P4 signal is an interpretation over P3
evidence; its trace must terminate at P3/P2 evidence items).

---

## 6. P3 evidence mapping

Columns: can support Signal (S), Direction (D), Opportunity (O), Risk (R),
Confidence (C), Actionability (A). `✅` = direct support; `◐` = indirect
(through an aggregate such as trend); `—` = no support.

| Evidence | Layer | S | D | O | R | C | A |
|---|---|---|---|---|---|---|---|
| Regime | P3 | ✅ | ✅ | ◐ | ✅ | ◐ | ◐ |
| Rotation (classification + score) | P3 | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ |
| Breadth | P3 | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ |
| Momentum | P3 | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ |
| Relative Strength | P3 | ✅ | ✅ | ✅ | ◐ | ◐ | ◐ |
| Leadership | P3 | ✅ | ◐ | — | ✅ | ◐ | ◐ |
| Constituents | P3 | ◐ | — | — | ◐ | ◐ | — |
| Availability | P3 | — | — | — | — | ✅ | — |
| Artifact identity | P3 | — | — | — | — | ✅ | — |
| Historical trend (B6) | P3 | ✅ | ◐ | ✅ | ✅ | ✅ | ◐ |
| Historical series/steps (B5) | P3 | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ |
| P2 Event Risk | P2 | ◐ | ◐ | — | ◐ (secondary only) | ◐ | ◐ |

No unsupported relationship is invented: e.g., Constituents alone never
determines Direction; P2 Event Risk alone never determines Opportunity.

---

## 7. Historical Evidence Contract

Rules (frozen):

1. Historical evidence must be **identity-compatible**
   (narrativeId + window + algorithmKey + algorithmVersion + calculationMode).
2. Compare only compatible identities (P3-14 Part C; implemented in
   `getP3IntelligenceHistory`).
3. Do not mix incompatible algorithm versions.
4. Do not mix incompatible windows/modes (e.g., 7D observed with 7D projected).
5. Insufficient history must not become a fake trend
   (`dataSufficiency.sufficient = false` ⇒ delta-based conclusions UNKNOWN).
6. P3 historical trend semantics remain frozen (P3-14 D.1–D.3, P3-18
   implementation).
7. P4 may *interpret* historical transition but must not redefine P3 trend.

**Current state vs historical transition vs historical confirmation:**
- **Current state** — the latest artifact's fields (A9–A15): what is true now.
- **Historical transition** — latest step / aggregated trend (B5/B6): how it
  changed.
- **Historical confirmation** — N ≥ 2 consecutive steps agreeing on the same
  direction before the current window: strengthens Confidence (conceptual;
  no numeric weight).

---

## 8. P4DecisionSupportViewModel

Read-time derived over existing persisted evidence. **Persistence decision:
NOT persisted.** Justification: P3 artifacts are immutable, deterministic
evidence; P4 interpretation is a pure function over them; the repository
imposes no constraint requiring storage; persisting would add write-path risk
and stale copies. (P5 may later persist actions separately.)

| Field | Type | Required | Nullable | Meaning | Evidence dependency | UNKNOWN behavior | Provenance | Persisted |
|---|---|---|---|---|---|---|---|---|
| status | `"OK" | "DEGRADED" | "NO_EVIDENCE" | "ERROR"` | ✅ | — | Overall availability | — | — | derived |
| version | `{ algorithmVersion: "p4-decision-support", semanticVersion: "1", signalCatalogVersion: "v1" }` | ✅ | — | Contract identity (§25) | — | — | contract | derived |
| narrativeIdentity | `{ narrativeId, window, algorithmKey, algorithmVersion, calculationMode }` | ✅ | — | P3 identity of the interpreted series | A1-A8 | — | P3 | derived |
| generatedAt / asOf | ISO UTC timestamps | ✅ | — | When derived / latest windowEnd | A4 | — | read path | derived |
| direction | `POSITIVE | NEGATIVE | MIXED | NEUTRAL | UNKNOWN` | ✅ | — | §3.2 | A9-A15 + B5/B6 | UNKNOWN with reasons | read path | derived |
| signals | `P4Signal[]` (catalog id, label, directionRelation, severity?, evidenceRefs) | ✅ | ✅ (empty array) | §3.1 | per signal | absent when unjustified | read path | derived |
| opportunity | `LOW | MEDIUM | HIGH | UNKNOWN` | ✅ | — | §3.3 | signals + deltas | UNKNOWN | read path | derived |
| risk | `LOW | MEDIUM | HIGH | UNKNOWN` | ✅ | — | §3.4 | P3 structural + P2 secondary | UNKNOWN | read path | derived |
| confidence | `LOW | MEDIUM | HIGH | UNKNOWN` | ✅ | — | §3.5 | availability/sufficiency/consistency/history/provenance | UNKNOWN | read path | derived |
| actionability | `LOW | MEDIUM | HIGH | UNKNOWN` | ✅ | — | §3.6 | direction + confidence + change presence | UNKNOWN | read path | derived |
| explanation | array of { conclusion, reason, evidenceRefs[] } | ✅ | ✅ | Human-auditable rationale | all | states UNKNOWN reasons | read path | derived |
| evidence | `EvidenceReference[]` (§5) | ✅ | ✅ | Full trace | all | — | read path | derived |
| historicalContext | `{ seriesLength, steps, overallTrend, dataSufficiency, current, previous }` | ✅ | ✅ | Frozen P3-18 view re-exposed | B2-B7 | null when no history | read path | derived |
| provenance | `{ sourceLayer: "P4", derivedFrom: [artifact ids], p2EventRisk: bool, semanticVersion }` | ✅ | — | Interpretation provenance | — | — | read path | derived |

---

## 9. Read Service Contract

**Conceptual API (NOT implemented now):**

```text
getP4DecisionSupport(narrativeId) → P4DecisionSupportViewModel | null
```

**Input:** `narrativeId`; no other request context in v1 (no user, no timezone
override — UTC only; no window override).

**Responsibilities:** retrieve evidence (via existing P3 read services, never
raw kernel); validate evidence availability; assemble evidence context; apply
the frozen interpretation contract; produce the ViewModel.

**Explicit boundary — why the service must NOT import `src/lib/p3/*`:**
P3 kernel modules are the calculation engine. Importing them into the read
path would (a) risk accidental recalculation of P3 metrics, breaking
immutability guarantees; (b) duplicate the calculation identity semantics;
(c) couple interpretation to engine internals, making P4 impossible to audit
against persisted evidence. P4 consumes **persisted read models only**
(`p3-intelligence.service.ts` / `p3-intelligence-history.service.ts`). The
service interprets P3 outputs; it never calculates/recalculates P3 metrics.

**Failure behavior:** any error in the read service yields `null` at the API
layer (see §18); the service itself may return `null` for NO_EVIDENCE.

---

## 10. API Contract

Extend `GET /api/narratives/[id]` with `data.p4DecisionSupport`.

| Scenario | `data.p4DecisionSupport` | Other data |
|---|---|---|
| Success (evidence sufficient) | full ViewModel | unchanged |
| No evidence (no VALID P3 artifact / null history) | `null` | unchanged |
| Partial evidence | ViewModel with DEGRADED status + UNKNOWN fields | unchanged |
| P4 read/interpretation failure | `null` | **unchanged** (mandatory) |
| Narrative not found | — (existing 404) | — |

**Mandatory reliability rule:** P4 failure must never fail the narrative
endpoint; the preferred pattern is `data.p4DecisionSupport = null` and P3 data
must still be returned (mirror the existing P3 try/catch degrade pattern in
`route.ts`). Backward compatibility: field is additive; existing consumers
ignore it.

---

## 11. UI Placement Contract

**Do NOT implement.** Placement on `src/app/narrative/[id]/page.tsx` (current
order: header → health chart → P3IntelligencePanel → CorrelationHeatmap →
Coin table):

```text
Narrative Header
    ↓
Health / context
    ↓
P3 Intelligence            ← existing P3IntelligencePanel (Current state)
    ↓
P4 Decision Support        ← NEW P4DecisionSupport card between P3 panel and CorrelationHeatmap
    ├─ Summary: Direction chip + Confidence/Actionability badges
    ├─ Signals: catalog chips (with severity/evidence)
    ├─ Opportunity / Risk: two compact cards (stack on mobile)
    ├─ "Why?" (collapsible): explanation + evidence refs
    └─ Evidence: collapsible list of EvidenceReference (links into P3 artifacts/steps)
    ↓
Historical / Evidence detail ← existing P3HistoricalTrend (reused, not duplicated)
    ↓
Correlation / Coin table (unchanged)
```

- **Primary summary:** top of P4 card; Direction is the headline.
- **Direction:** badge (POSITIVE/NEGATIVE/MIXED/NEUTRAL/UNKNOWN) with color.
- **Signals:** chips; EVIDENCE_CONFLICT is informational, not error.
- **Opportunity/Risk:** qualitative badge + one-line evidence reason.
- **Confidence/Actionability:** badges (never bare numbers).
- **Why?:** collapsible, maps conclusions → evidence indices.
- **Evidence:** expandable; shows layer, artifact ids, windows, status.
- **Degraded state:** `status = DEGRADED` renders "partial evidence" banner.
- **Unknown state:** UNKNOWN fields render "Evidence insufficient — <reason>",
  never fabricated values; Direction UNKNOWN hides Opportunity/Risk conclusions.
- Do not duplicate the P3 panel; P4 answers "So what?" after P3 answers "What
  is happening?".

---

## 12. P3 vs P4 ownership boundary

| Capability | P3 | P4 |
|---|---:|---:|
| Breadth calculation | ✅ | ❌ |
| Momentum calculation | ✅ | ❌ |
| Relative Strength calculation | ✅ | ❌ |
| Leadership calculation | ✅ | ❌ |
| Regime calculation | ✅ | ❌ |
| Rotation calculation | ✅ | ❌ |
| Historical trend calculation | ✅ | ❌ |
| Persisted artifact identity / immutability | ✅ | ❌ |
| Current direction interpretation | ❌ | ✅ |
| Signal interpretation | ❌ | ✅ |
| Opportunity classification | ❌ | ✅ |
| Risk interpretation | ❌ | ✅ |
| Confidence interpretation | ❌ | ✅ |
| Actionability interpretation | ❌ | ✅ |
| Evidence explanation | limited / raw provenance ("Why?") | ✅ synthesized interpretation + trace |
| P3 metric recomputation | ✅ (kernel only) | ❌ (read-only) |

Correction note vs the suggested table: Relative Strength and Leadership
calculation are also P3-only (verified: `relative-strength.ts`, `leadership.ts`
in kernel). P3's "Evidence explanation" is the raw provenance disclosure in the
panel; P4 adds interpreted explanation — both may coexist.

---

## 13. P4 vs P5 boundary

**P4 may output:** interpretation, contextual assessment,
decision-support classification, explainable flags, suggested attention areas.

**P4 may NOT output/do:** automatic execution, portfolio rebalance, order
placement, autonomous trading, any irreversible action.

Example sentences:
- P4 may say: *"Risk is elevated because breadth deteriorated and historical
  trend is weakening."*
- P4 may NOT say: *"Sell now."* (that is P5 action generation, and only under
  a future approved contract).

---

## 14. Semantic output examples (behavioral illustrations, NOT scoring
formulas)

**Example 1 — Strong and broad.** P3: strong regime, positive momentum, broad
breadth, positive RS, stable leadership. Expected: Direction = POSITIVE;
Opportunity = HIGH/MEDIUM per evidence; Risk = LOW/MEDIUM; Confidence = HIGH;
Actionability = HIGH. *(Qualitative behavior illustration only.)*

**Example 2 — Deterioration.** P3: weakening regime, breadth falling, momentum
negative, RS still positive, historical trend DETERIORATING. Expected:
Direction = NEGATIVE; Risk elevated; Opportunity reduced; Confidence per
evidence sufficiency (RS positive ⇒ possible EVIDENCE_CONFLICT ⇒ MIXED risk
deltas handled per §12).

**Example 3 — NEUTRAL.** P3 regime = NEUTRAL, evidence valid, no directional
rule matches. Expected: Direction may be NEUTRAL if evidence is not materially
conflicting (Q2; never forced to UNKNOWN).

**Example 4 — MIXED.** Valid sufficient evidence with conflicting directions.
Expected: Direction = MIXED; Historical Trend may independently be
IMPROVING / TRANSITION / STABLE / DETERIORATING (Q3).

**Example 5 — UNKNOWN.** Insufficient history or critical evidence
unavailable. Expected: Direction (or the relevant decision field) = UNKNOWN;
no forced classification; reasons recorded.

**Example 6 — P2 event risk.** P3 structure healthy; P2 event-risk HIGH for one
constituent. Expected: event risk becomes **secondary evidence**
(`source = P2_EVENT_RISK`, evidence role secondary/conflicting); Narrative
Risk is NOT automatically HIGH — only if narrative-level sufficiency rules
justify it (Q5 rules 5–7).

---

## 15. Legacy documentation divergence (P3)

**Known contradiction (D1):** `docs/P3_Upgrade/P3_DATA_CONTRACT.md` §P3-08
lists Regime as exactly `EMERGING, STRONG, MATURE, WEAKENING, DEAD`; the
implementation `src/lib/p3/regime.ts` `P3_REGIMES` includes **NEUTRAL**, and
production artifact #1 persisted `regime = NEUTRAL`.

**Operational truth:** implementation + persisted production artifact.
**P4-02 does NOT modify P3 to resolve this.** P4 behavior in this spec uses the
operational contract (NEUTRAL is a valid Regime classification; Q2 semantics
apply).

---

## 16. Numeric scoring boundary (mandatory)

P4-02 defines **semantics only**. It does NOT define formulas for Opportunity,
Risk, Confidence, or Actionability. It does NOT define weights, thresholds,
normalization, calibration, or probability estimates. These belong to a future
task after this contract is approved (Q4; P4-01 §5.11).

---

## 17. Versioning

Conceptual identity (no storage implementation):

```text
algorithmVersion   = "p4-decision-support"
semanticVersion    = "1"
signalCatalogVersion = "v1"
result identity    = p4-decision-support/1 (semantic) + signalCatalog v1
```

A P4 result must be attributable to the semantic contract version that
generated it (`provenance.semanticVersion`, `provenance.algorithmVersion`).
Any future change to the interpretation rules (including eventual numeric
scoring) bumps `semanticVersion`; the catalog bumps independently.

---

## 18. Acceptance criteria

- [x] P4 Core semantic model frozen (§2, §3).
- [x] Signal contract defined (§3.1).
- [x] Direction contract defined (§3.2).
- [x] NEUTRAL vs MIXED vs UNKNOWN explicit (§4).
- [x] MIXED vs TRANSITION explicit (§3.2, P4-01A Q3).
- [x] Opportunity/Risk/Confidence/Actionability qualitative contract frozen (§3.3–§3.6).
- [x] Evidence sufficiency rules defined (§4).
- [x] Evidence traceability format defined (§5).
- [x] P2 Event Risk boundary defined (§3.4, §6, P4-01A Q5).
- [x] P3 evidence mapping complete (§6).
- [x] Historical evidence rules defined (§7).
- [x] P4DecisionSupportViewModel fully specified (§8).
- [x] Read service contract specified (§9).
- [x] API extension specified (§10).
- [x] Degrade-to-null behavior specified (§10).
- [x] UI placement specified (§11).
- [x] P3/P4 ownership boundary explicit (§12).
- [x] P4/P5 boundary explicit (§13).
- [x] Versioning specified (§17).
- [x] No numeric scoring formulas introduced.
- [x] No production code changed.
- [x] No P4-03 implementation started.

---

## 19. Explicit non-goals

P4-02 does NOT: implement P4; implement scoring; implement signals; implement
service; implement API; implement UI; add database tables; add migrations;
modify P3; modify P2; modify existing Decision Engine behavior; change P3
Regime semantics; recalculate P3 metrics; introduce ML; introduce LLM;
introduce price prediction; create trading recommendations.

---

## 20. Verification record

- Repository audited per §1 (P3 read models/services, narrative API + tests,
  decision/event-risk types + schema, P3 UI, persistence boundary).
- Document-only task: `git status` shows no change under `src/`, `backend/`,
  `drizzle/`, or config files; only `docs/P4_Upgrade/` content was added.
- P3 implementation, semantics, thresholds, artifacts: untouched.
- P4-03: NOT started.
