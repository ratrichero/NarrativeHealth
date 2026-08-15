# P4-01 — Decision Support Contract & Gap Audit

**Status:** Specification / Audit only — no production code, no database
migration, no scoring, no UI, no P3 semantics change.

**Repository:** `ratrichero/NarrativeHealth` @ `main` (P3 closed, baseline)

---

## 0. Method

This audit inspected the repository directly (implementation over documentation):

- P3 kernel: `src/lib/p3/{availability,breadth,constituents,context,execution-loop,leadership,membership,orchestrator,persistence,preparation,regime,relative-strength,rotation,windows,index}.ts`
- P3 read services: `src/lib/services/p3-intelligence.service.ts`, `src/lib/services/p3-intelligence-history.service.ts`
- P3 view models: `src/lib/types/p3-intelligence.ts`, `src/lib/types/p3-intelligence-history.ts`
- P3 API: `src/app/api/narratives/[id]/route.ts`, `src/app/api/admin/p3/execute/route.ts`
- P3 UI: `src/components/P3IntelligencePanel.tsx`, `src/components/P3HistoricalTrend.tsx`, `src/app/narrative/[id]/page.tsx`
- Domain types: `src/types/index.ts`, `src/lib/types/{narrative-health,decision-signal,event-risk,alert,correlation,narrative-momentum}.ts`
- Pre-P3 services: `src/lib/services/{decision-engine,event-risk,alert,rule-engine,correlation,indicator,momentum,snapshot,health-timeline}.service.ts`
- Docs: `docs/P3_Upgrade/P3_DATA_CONTRACT.md`, `P3_BASELINE.md`, `P3_ARCHITECTURE_DECISIONS.md`, `p3.md`, `P3_10B..P3_20` deliverables, `docs/P1_2_Upgrade/p1.md`, `p2.md`, `docs/p0Upgrade/`

### Documented discrepancies (reported, not silently modified)

| # | Documentation | Implementation (operational truth) | Note |
|---|---|---|---|
| D1 | `P3_DATA_CONTRACT.md` §P3-08: "Regime is one of exactly EMERGING, STRONG, MATURE, WEAKENING, DEAD" | `src/lib/p3/regime.ts` exports `P3_REGIMES = ["EMERGING","STRONG","MATURE","WEAKENING","DEAD","NEUTRAL"]`; production artifact #1 persisted `regime=NEUTRAL` | Implementation includes **NEUTRAL**; P3-14 trend rank also includes NEUTRAL. Implementation is truth; the contract doc is stale on this point. |
| D2 | `docs/P3_Upgrade/p3.md` §44/§45 roadmap: P4 = "Catalyst & Event Intelligence", P5 = "Prediction / Backtesting" | P4-01 mission (this task) defines P4 = Decision Support (interpretation), P5 = Action/Automation | Naming/roadmap conflict between the P3 master spec and the P4 charter. The P4-01 charter governs P4 work; a product decision should reconcile the roadmap (recommended: keep "Decision Support" for this phase, treat Catalyst/Event Intelligence as candidate capabilities, see §5.10). |
| D3 | P3-14 Part D.2 trend epsilons marked "PROPOSED" | P3-18 adopted them verbatim as implementation constants (`P3_TREND_EPSILONS` in `p3-intelligence-history.service.ts`) | Adoption is documented in P3-18; treated as frozen for P4. |

---

## 5.1 Executive Summary

**P3 current capability (operational, verified against production):** P3 answers
*"what is happening?"* — per-narrative intelligence artifacts persisted
immutably (identity = narrative + window + algorithm key/version + calculation
mode) with six validated stages (Breadth, Momentum, Relative Strength,
Leadership, Regime, Rotation), a full availability taxonomy, and P3-18
historical intelligence: same-identity chronological series, per-step
consecutive deltas/transitions, per-metric and overall trend
(IMPROVING / DETERIORATING / STABLE / TRANSITION / UNKNOWN), and data
sufficiency. Production has 3 VALID artifacts for narrative AI (Aug 11/13/15).

**P4 intended capability:** P4 answers *"so what does it mean, how strong is the
evidence, and how decision-relevant is it?"* — an **interpretation layer** that
translates P3 facts and trends into decision concepts (Signal, Direction,
Opportunity, Risk, Confidence, Actionability) that are always traceable to
persisted P3 evidence, with explicit `UNKNOWN` behavior when evidence is
insufficient. P4 does not compute new market metrics; it explains existing ones.

**P5 boundary:** P5 answers *"what action should the system execute?"* — action
generation/automation (e.g., alerts-to-actions, later trade execution). P4 must
never emit an executable action; at most it emits a decision-relevant
interpretation that P5 may later consume.

**Why P4 is interpretation, not another metric layer:** P3 already owns the
numeric/analytic surface (scores, thresholds, classifications, trends). Adding a
"P4 score layer" would (a) duplicate or compete with P3 semantics, (b) require
new P3 thresholds (forbidden), and (c) risk opaque composite scores that hide
evidence. Interpretation — mapping evidence to meaning with explicit
uncertainty — is the missing layer between intelligence and action. It preserves
P3 immutability (P4 reads, never writes P3) and keeps every conclusion auditable.

## 5.2 P0 → P3 Boundary Audit

| Phase | Responsibility | Output consumed by next phase |
|---|---|---|
| P0 | Foundation & data reliability: collectors (Binance Spot/Futures, CoinGecko), market price/volume/OI/metrics ingestion, narrative/coin/membership entities, rule & feature versioning, health timelines | Raw market + entity data; version infrastructure |
| P1 | Feature / Health engine: indicators table, feature provenance, multi-condition rule engine, snapshot normalization | Coin features + health scores + recommendations + normalized snapshots |
| P2 | Market context / decision overlay: decision engine (event-risk-adjusted score), event risk framework, correlation, narrative momentum, alert system | Risk-adjusted scores/signals, event records, alerts, narrative momentum |
| P3 | **Intelligence** (closed): narrative Breadth/Momentum/RS/Leadership/Regime/Rotation + persistence + execution loop/scheduler + historical trend (P3-18) | Immutable intelligence artifacts + same-identity historical series & trend |
| P4 | **Decision Support** (this phase): interpret P3 evidence into Signal / Direction / Opportunity / Risk / Confidence / Actionability with full traceability and explicit UNKNOWN | Decision-relevant interpretation view model consumed by P5 (and UI) |
| P5 | **Action / Automation** (future): turn P4 interpretations into candidate actions, alerts-to-action, later execution automation | Executable action candidates (never auto-executed without approval) |

**What P4 is NOT allowed to own:**
- P3 calculation semantics, thresholds, regime/rotation contract, artifact
  identity, availability semantics, or trend semantics (all frozen).
- New market metrics or new P3-stage-like scores.
- Price prediction, probability-of-loss claims, or any forecast contract.
- Execution: no buy/sell orders, no portfolio management, no trading
  automation (that is P5).
- Mutation of persisted P3 artifacts or any P0-P3 table.
- Numeric scoring formulas (deferred to post-contract-approval, see §5.11).

## 5.3 P3 → P4 Input Contract

P4 may consume exactly the P3 read-model objects below (via the existing read
services — P4 must not import `src/lib/p3/*` kernel or re-calculate).

Legend — Availability handling: all P3 fields carry one of
`VALID | MISSING | INVALID | STALE | INSUFFICIENT_HISTORY | NOT_APPLICABLE | AMBIGUOUS`
(from `src/lib/p3/availability.ts`). "Invalid/missing behavior": a non-VALID
stage is never treated as zero or bearish; it downgrades coverage and may force
the P4 output to `UNKNOWN` (see §5.6). "Historical comparison allowed": yes only
within the same identity (narrativeId + window + algorithmKey + algorithmVersion
+ calculationMode) per P3-14 Part C.

### A. Per-artifact fields (`P3IntelligenceViewModel`)

| # | Field | Source | Semantic meaning | Immutable vs derived | Valid / invalid / missing | Historical cmp | Directly supports a P4 conclusion |
|---|---|---|---|---|---|---|---|
| A1 | narrativeId | persisted artifact | Entity identity | Immutable (P3 write-time) | Required; absent → no artifact | N/A | Identity scoping only |
| A2 | artifactId | persisted artifact | Immutable row id | Immutable | Required | N/A | Traceability anchor (Why?) |
| A3 | window (1D/3D/7D/14D) | persisted provenance/period | Calculation window | Immutable | Required | N/A | Scoping: only same-window comparisons are valid |
| A4 | windowEnd | persisted artifact | UTC evaluation boundary | Immutable | Required; future → INVALID | N/A | Staleness basis; "current" is max windowEnd |
| A5 | windowEndLabel | derived (UTC) | Human display | Derived (display) | N/A | N/A | Display only |
| A6 | calculationMode (observed/projected) | persisted artifact | Mode identity | Immutable | Required | N/A | Identity isolation |
| A7 | algorithmKey / algorithmVersion | persisted artifact | Calculation identity | Immutable | Required | N/A | Identity isolation |
| A8 | availabilityState (artifact) | persisted artifact | Artifact-level validity | Immutable | VALID required for P4 consumption of this artifact | N/A | Gate: non-VALID artifact is not consumable |
| A9 | regime (classification, state) | P3-08 output | Narrative lifecycle class | Immutable persisted value | Non-VALID → unavailable (never WEAK/DEAD default) | Yes (ranked per P3-14) | **Yes** — regime + regime trend is a primary Signal/Risk input |
| A10 | rotation (classification, score, state) | P3-09 output | Capital-flow direction + 0-100 score | Immutable persisted value | Non-VALID → unavailable (never STABLE default) | Yes (score delta + state rank) | **Yes** — rotation + rotationScore delta is a primary Direction/Opportunity input |
| A11 | breadth (value, state) | P3-04 output | Share of healthy constituents (0-1) | Immutable persisted value | Non-VALID → unavailable | Yes (epsilon 0.05) | Yes — breadth delta corroborates direction |
| A12 | momentum (value, state) | P3-05 output (window-matched) | Narrative health change (signed pts) | Immutable persisted value | Non-VALID → unavailable | Yes (epsilon 1.0) | Yes — momentum delta is a Direction input |
| A13 | relativeStrength (value, state) | P3-06 output | Narrative return vs BTC (signed spread) | Immutable persisted value | Non-VALID → unavailable (BTC missing ⇒ unavailable) | Yes (epsilon 0.01) | Yes — RS trend corroborates quality of direction |
| A14 | leadership (coinId, symbol, score, state) | P3-07 output | Narrative leader + leader score | Immutable persisted value | Non-VALID → unavailable | Yes (identity change = TRANSITION; score epsilon 5.0) | Yes — leadership change is a Signal (rotation of leadership) |
| A15 | constituents (count, state) | captured snapshot | Member count of the artifact | Immutable persisted value | Non-VALID → unavailable | Yes (set diff; count) | Yes — membership change corroborates breadth/leadership |

### B. Historical fields (`P3IntelligenceHistoryViewModel`)

| # | Field | Source | Semantic meaning | Immutable vs derived | Valid / invalid / missing | Historical cmp | Directly supports a P4 conclusion |
|---|---|---|---|---|---|---|---|
| B1 | identity | derived from latest artifact | Comparison identity | Derived (from immutable) | Required | N/A | Enforces isolation |
| B2 | series | read service (same identity, ASC) | Chronological evidence chain | Derived (from immutable rows) | Empty → null (no history) | N/A | Evidence listing (Why?) |
| B3 | current | latest series element | Most recent consumable artifact | Derived | Null with no artifact | N/A | Basis of all P4 outputs |
| B4 | previous | same identity, prior windowEnd | Comparison baseline | Derived | Null with <2 artifacts → insufficient history | N/A | Basis of deltas |
| B5 | steps (consecutive pairs) | read service | Per-pair regime/rotation/metric deltas + states | Derived (frozen P3-14 semantics) | Any UNKNOWN propagates | N/A | **Yes** — delta/transition evidence for Direction & Confidence |
| B6 | trend (per-metric + overall) | read service | Aggregated trend states | Derived (frozen semantics) | UNKNOWN when any step UNKNOWN | N/A | **Yes** — core Direction input |
| B7 | dataSufficiency | read service | comparableArtifacts / requiredMinimum(2) / sufficient | Derived | — | N/A | Confidence input |

**Rule:** P4 conclusions must be traceable to a concrete subset of A1-A15/B1-B7.
Any conclusion with zero traceable evidence is forbidden.

## 5.4 P4 Semantic Model

Formal definitions (contract vocabulary; no numeric thresholds yet):

- **Signal** — a named, meaningful event/state derived from one or more P3 facts
  or trends (e.g., `NARRATIVE_DETERIORATION`, `LEADERSHIP_TRANSITION`,
  `ROTATION_REVERSAL`). A Signal is the smallest interpretable unit P4 emits.
  Every Signal carries: name, evidence set (artifact ids + fields), and a
  Direction. A Signal is never a price prediction.
- **Direction** — normalized interpretation of movement:
  `POSITIVE | NEGATIVE | MIXED | NEUTRAL | UNKNOWN`.
  - POSITIVE = aligned improving evidence (e.g., improving trend with positive
    momentum/RS deltas).
  - NEGATIVE = aligned deteriorating evidence.
  - MIXED = simultaneous improving and deteriorating evidence across the
    metrics P4 is evaluating (cannot be resolved to one side).
  - NEUTRAL = no meaningful movement (all compared metrics within stability
    tolerance of the frozen P3-14 deltas).
  - UNKNOWN = evidence insufficient (missing/invalid stage, insufficient
    history, or conflicting ambiguity that cannot be classified as MIXED).
  Numeric thresholds for "meaningful movement" are deferred (§5.11) — Direction
  is defined on the frozen P3-14 trend states first.
- **Opportunity** — a potentially favorable decision context indicated by P3
  evidence (e.g., improving regime + inflow/accelerating rotation + positive
  breadth/momentum deltas). It is NOT a price prediction and NOT a guaranteed
  return; it is a statement about evidence alignment.
- **Risk** — a potentially unfavorable deterioration/exposure context indicated
  by P3 evidence (e.g., deteriorating regime/trend, outflows, breadth collapse).
  It is NOT a probability of loss unless a later validated methodology
  explicitly supports a probability claim.
- **Confidence** — strength of evidence supporting a P4 interpretation.
  Determined ONLY by evidence quality, coverage, consistency, and data
  sufficiency: artifact availability states (A8-A15), series length and
  sufficiency (B7), absence of UNKNOWN steps (B6), and consistency of
  corroborating metrics. It is not a subjective feeling; it is a function of
  observable evidence properties (formula deferred, §5.11).
- **Actionability** — how useful the interpretation is for decision support
  given the evidence available. Actionability is NOT the same as Confidence:
  - high confidence + low actionability (e.g., stable, well-evidenced, but no
    decision-relevant change);
  - moderate confidence + high actionability (e.g., clear deterioration signal
    with partial coverage — worth attention despite lower evidence strength).
  Actionability taxonomy (candidate, contract in P4-02): e.g.,
  `ACTIONABLE / WATCH / INFORMATIONAL / NONE`.

## 5.5 Evidence Hierarchy

```text
P3 persisted fact                      (A1-A15 — immutable, highest authority)
    >
P3 historical transition              (B5/B6 — derived from facts, frozen semantics)
    >
P4 derived interpretation             (Signal + Direction + Opportunity/Risk)
    >
P4 recommendation                     (interpretation-level guidance, e.g., "review exposure")
    >
P5 executable action                   (future phase — execution, automation)
```

Invariants:
1. P4 never overwrites or mutates P3 facts (P3 immutability + triggers).
2. Every P4 output must reference the artifact ids and fields it derives from
   (traceability: output → steps → artifacts).
3. P4 never bypasses P3 read services to reach the DB directly; it consumes the
   read models in §5.3.
4. P4 never re-runs P3 calculation (no `src/lib/p3/*` kernel import).

## 5.6 Evidence Sufficiency Rules

| Condition | P4 behavior |
|---|---|
| No VALID artifact (A8 non-VALID / null) | All P4 outputs `UNKNOWN`; report `NO_EVIDENCE` |
| Current artifact VALID but series < 2 (B4 null) | Current-state signals allowed (e.g., regime classification); **Direction = UNKNOWN** (no delta basis); Opportunity/Risk from current state only with `insufficient_history` flag |
| Any required stage non-VALID for current artifact | Stage excluded from evidence; if the stage is load-bearing for the signal → Signal/Direction = UNKNOWN for that signal |
| Stale data (windowEnd older than configured freshness) | `STALE` flag; downgrade Confidence; do not fabricate freshness |
| Invalid stage values | Excluded, reason recorded; never zero/bearish imputation (P3 availability contract) |
| Insufficient history (series < 2 for deltas, < minimum for multi-window) | Delta-based outputs UNKNOWN; keep state-based outputs with reduced Confidence |
| Conflicting signals (improving + deteriorating across metrics) | Direction = MIXED (when both sides are real) or UNKNOWN (when a load-bearing metric is unavailable) |
| Mixed directional evidence within one step | Step state per frozen P3-14 semantics; overall = TRANSITION; P4 Direction = MIXED |
| Single-metric evidence | Allowed as a Signal only when the metric is VALID and window-matched; Confidence = LOW; never promotes single-metric evidence to multi-metric confirmation |
| Multi-metric confirmation (≥2 corroborating VALID metrics agree) | Confidence raised (formula later); evidence set recorded |
| Any required input UNKNOWN/AMBIGUOUS/NOT_APPLICABLE | **UNKNOWN** — never force a conclusion; NOT_APPLICABLE is not STABLE (P3-14 rule) |

**Mandatory UNKNOWN:** P4 must return `UNKNOWN` (with reasons) whenever the
evidence cannot determine a Direction or a Signal — missing mandatory stages,
insufficient history, or unresolvable ambiguity. P4 never guesses, never
defaults an unavailable metric to neutral, and never converts `UNKNOWN` into
`STABLE`.

## 5.7 P4 Semantic Matrix

| P4 concept | P3 evidence | Derivable now | Requires new data | Not yet justified |
|---:|---|---|---:|---:|
| Direction | A9-A13 current + B5/B6 trend/deltas (frozen states) | ✅ Yes (from frozen trend states) | No | Numeric magnitude thresholds (deferred) |
| Signal | A9/A10/A14 transitions + B6; e.g., regime deterioration, leadership change, rotation reversal | ✅ Yes (named from evidence) | No (catalog needs contract) | Event/catalyst signals (new data) |
| Risk | A9-A13 deterioration alignment + B6 overall + B7 sufficiency | ⚠️ Partially — qualitative risk from evidence alignment | No for evidence; taxonomy needs contract | Probability-of-loss |
| Opportunity | A9-A13 improvement alignment + rotation inflow/accelerating + breadth/momentum deltas | ⚠️ Partially — qualitative opportunity | No for evidence; taxonomy needs contract | Return prediction |
| Confidence | A8-A15 availability + B7 sufficiency + B6 UNKNOWN-free + multi-metric consistency | ⚠️ Partially — factors exist (coverage/sufficiency/consistency); aggregation formula deferred | No | Subjective/ML confidence |
| Actionability | Direction + Confidence + presence of decision-relevant change | ⚠️ Partially — definitional taxonomy; mapping needs contract | No | Action generation (P5) |

Purpose: prevent future agents from inventing unsupported scores. Anything
marked "needs contract" must be specified in P4-02 and approved before
implementation; anything marked "not yet justified" is out of scope until a
validated methodology exists.

## 5.8 Canonical Interpretation Examples

> These are **semantic illustrations only** — NOT proposed production scoring
> formulas, thresholds, or weights. They demonstrate how P4 vocabulary maps to
> P3 evidence. P4-02 must formalize the mapping; §5.11 defers all numerics.

**Example 1 — Deteriorating narrative (mirrors production artifact #3):**
```text
Regime      = WEAKENING
Breadth     = 0
Momentum    = -2.40
RS          = +0.040
Leadership  = 55.98
Trend       = DETERIORATING
```
```text
Signal       = NARRATIVE_DETERIORATION
Direction    = NEGATIVE
Risk         = HIGH
Opportunity  = LOW
Confidence   = MEDIUM      (3 VALID artifacts, full coverage, one mixed metric: RS improving)
Actionability= HIGH        (clear deterioration, decision-relevant)
Evidence     = artifacts {1,9,10}; steps 11→13, 13→15; regime WEAKENING→WEAKENING, rotation STABLE; score Δ −11.30
```

**Example 2 — Improving narrative:**
```text
Regime      = EMERGING
Rotation    = ACCELERATING (score 82)
Breadth     = 0.65
Momentum    = +6.20
RS          = +0.035
Trend       = IMPROVING
```
```text
Signal       = NARRATIVE_IMPROVEMENT
Direction    = POSITIVE
Risk         = LOW
Opportunity  = HIGH
Confidence   = HIGH        (multi-metric confirmation: regime, rotation, breadth, momentum, RS all improving)
Actionability= HIGH
```

**Example 3 — Mixed evidence:**
```text
Regime      = NEUTRAL
Rotation    = INFLOW (score 66)
Breadth     = 0.30   (Δ −0.20, DETERIORATING)
Momentum    = +3.10  (IMPROVING)
RS          = −0.005 (STABLE)
Trend       = TRANSITION
```
```text
Signal       = MIXED_TRANSITION
Direction    = MIXED       (breadth deteriorates while rotation/momentum improve)
Risk         = MEDIUM      (breadth collapse)
Opportunity  = MODERATE    (rotation inflow)
Confidence   = MEDIUM
Actionability= WATCH
```

**Example 4 — Insufficient history:**
```text
Series       = [artifact Aug 11]   (1 artifact, same identity)
dataSufficiency = {comparableArtifacts: 1, requiredMinimum: 2, sufficient: false}
```
```text
Signal       = (current-state only, e.g., REGIME_WEAKENING)
Direction    = UNKNOWN      (no delta basis)
Risk         = UNKNOWN      (no trend basis)
Opportunity  = UNKNOWN
Confidence   = LOW          (insufficient history)
Actionability= INFORMATIONAL
```

**Example 5 — Invalid / stale data:**
```text
Current artifact availability = STALE (windowEnd older than freshness bound)
Rotation = MISSING, Regime = VALID
```
```text
Signal       = REGIME_<value> (state-based, from VALID regime only)
Direction    = UNKNOWN        (load-bearing rotation unavailable → no direction)
Risk         = UNKNOWN
Opportunity  = UNKNOWN
Confidence   = LOW            (coverage reduced; stale flag)
Actionability= NONE           (not fresh enough for decisions)
```

**Example 6 — NEUTRAL stability:**
```text
Regime NEUTRAL → NEUTRAL, Rotation STABLE → STABLE, all deltas within frozen ε
Trend = STABLE
```
```text
Signal       = STABLE_NARRATIVE
Direction    = NEUTRAL
Risk         = LOW
Opportunity  = LOW
Confidence   = HIGH       (well-evidenced stability)
Actionability= LOW        (high confidence, low actionability — nothing to act on)
```

## 5.9 UI Placement Audit

Current P3 UI (from `P3IntelligencePanel` + `P3HistoricalTrend`, rendered on
`/narrative/[id]`): a Card titled "P3 Intelligence" with (1) Current state
(Regime/Rotation rows, Breadth/Momentum/RS tiles, Leadership row, Constituents),
(2) collapsible "Why?" provenance disclosure, (3) collapsible "Historical Trend"
(series chain, previous→current rows, trend summary, identity banner, Why?).

**Preferred P4 architecture (no P3 panel duplication):**

```text
P3 Intelligence            ← existing panel (Current state)
    ↓
P4 Decision Support        ← NEW compact section (inside or directly below panel)
    ├─ Signal(s) + Direction     (chips/badges)
    ├─ Opportunity / Risk        (dual summary cards)
    ├─ Confidence / Actionability (badges)
    └─ Why? (collapsible)        (evidence traceability → artifacts/steps)
    ↓
Historical / Evidence details   ← existing P3HistoricalTrend reused as the evidence layer
```

Placement decisions:
- **Primary decision panel location:** a new `P4DecisionSupport` section
  rendered as a sibling Card directly below `P3IntelligencePanel` on
  `/narrative/[id]` — never inside the P3 card (keeps P3 read-only purity).
- **Summary placement:** top of the P4 section (Signal + Direction chips).
- **Opportunity/Risk display:** side-by-side compact cards (desktop) /
  stacked (mobile), each with Confidence and Actionability badges.
- **Signal display:** named chip(s) with Direction color coding.
- **Confidence display:** badge (LOW/MEDIUM/HIGH — taxonomy) + one-line reason
  (coverage/sufficiency), never a bare number.
- **Explanation/why placement:** collapsible "Why?" with a bullet list of
  evidence (artifact ids, windows, deltas) linking to the P3 panel/trend.
- **Historical evidence placement:** keep the existing `P3HistoricalTrend`
  disclosure below; P4 "Why?" references it instead of duplicating it.
- **Degraded/unknown behavior:** when Direction = UNKNOWN, the P4 section
  renders "Evidence insufficient — <reason>" and hides Opportunity/Risk
  conclusions; no placeholder scores, no fabricated numbers.

## 5.10 Gap Audit

| P4 capability | Classification | Exact files / modules |
|---|---|---|
| Read P3 current artifact | **EXISTS** | `src/lib/services/p3-intelligence.service.ts` → `getLatestValidP3Intelligence` |
| Read P3 historical series + trend | **EXISTS** | `src/lib/services/p3-intelligence-history.service.ts` → `getP3IntelligenceHistory`; epsilons/ranks frozen |
| Availability taxonomy | **EXISTS** | `src/lib/p3/availability.ts` |
| Trend states (5) | **EXISTS** | `src/lib/types/p3-intelligence-history.ts`, history service |
| P3 → P4 read wiring (narrative page) | **EXISTS** (extension point) | `src/app/api/narratives/[id]/route.ts` (p3Intelligence + p3IntelligenceHistory degrade-to-null pattern) |
| P3 UI evidence layer | **EXISTS** | `src/components/P3IntelligencePanel.tsx`, `P3HistoricalTrend.tsx` |
| Signal catalog + naming | **DERIVABLE** (needs P4-02 contract) | new `src/lib/types/p4-*.ts` + `src/lib/services/p4-*.service.ts` (read-only) |
| Direction normalization | **DERIVABLE** (from frozen trend states) | same new modules |
| Qualitative Risk from P3 evidence | **DERIVABLE** (mapping contract) | same new modules |
| Qualitative Opportunity from P3 evidence | **DERIVABLE** (mapping contract) | same new modules |
| Confidence factors (coverage/sufficiency/consistency) | **DERIVABLE** (aggregation formula deferred) | same new modules |
| Actionability taxonomy | **DERIVABLE** (definitional) | same new modules |
| P4 view model + API field | **NEEDS NEW CONTRACT** (P4-02: shape + degrade contract) | `src/types/index.ts` (`NarrativeDetail`), narrative route |
| Narrative-level P4 read path (UI → service → DB) | **NEEDS NEW CONTRACT** | new service following P3-12/18 pattern |
| Event/catalyst signals (unlocks, listings, news) | **NEEDS NEW DATA** | `src/lib/services/event-risk.service.ts` exists at P2 coin level — narrative-level catalyst signal requires new data + contract; do not merge into P4-02 |
| Cross-narrative comparison / ranking | **NOT JUSTIFIED** (P3 identity is per-narrative; no contract) | — |
| Price prediction / probability of loss | **NOT JUSTIFIED** | — |
| ML-based confidence | **NOT JUSTIFIED** (deterministic layer must stabilize first; p3.md §44) | — |
| P5 action generation | **NOT JUSTIFIED** (out of P4 scope) | — |

## 5.11 Scoring Boundary (mandatory)

> **P4-01 does not define numerical scoring formulas.**

- **Candidates for later scoring work** (only after P4-02 contract approval):
  - **Opportunity** (evidence-alignment index)
  - **Risk** (deterioration-exposure index)
  - **Confidence** (aggregation of coverage, sufficiency, consistency factors)
  - **Actionability** (mapping from direction/confidence/change presence)
- **Why formula definition must wait for semantic contract approval:**
  1. Numeric thresholds/weights are semantics — they decide what "HIGH risk"
     means. Approving semantics first prevents silent threshold invention
     (the exact failure mode P3-10's chain guarded against).
  2. The frozen P3 evidence base (3 artifacts today) is too small to validate
     any weight; formulas must be validated against a growing series (P3-15
     scheduler) before production use.
  3. Traceability: a formula without an approved evidence mapping produces
     opaque scores, which P4 explicitly forbids (§5.12).
  4. P3's own precedent: thresholds were configuration/contract items, never
     hard-coded engine assumptions (P3_DATA_CONTRACT §P3-08/§P3-09). P4 follows
     the same discipline.
- Until approved, P4 emits **qualitative** interpretations
  (Signal/Direction/UNKNOWN, LOW/MEDIUM/HIGH Confidence & Actionability, LOW/
  MODERATE/HIGH Opportunity & Risk) with explicit evidence, and no numeric
  composite score.

## 5.12 P4 Non-Goals

- No modification of P3 calculation semantics (P3-04→09 frozen).
- No new P3 metrics or new P3-stage-like scores.
- No automatic trading; no buy/sell execution; no portfolio management.
- No predictive price model; no probability-of-loss claims.
- No unvalidated ML confidence (deterministic evidence only).
- No opaque score — every P4 output must carry evidence traceability.
- No recommendation without evidence traceability.
- No numeric scoring formulas until the semantic contract is approved (§5.11).
- No mutation of P3 artifacts, no backfill, no duplicate ingestion.
- No P5 action generation (P4 stops at interpretation).

## 5.13 Acceptance Criteria

P4-01 is complete when:
- [x] every P3 → P4 input is enumerated (§5.3, with source / semantics /
      immutability / availability / valid-invalid-missing / historical-cmp /
      conclusion-support);
- [x] every P4 semantic concept is defined (Signal, Direction, Opportunity,
      Risk, Confidence, Actionability — §5.4);
- [x] evidence hierarchy is explicit (§5.5);
- [x] insufficient-evidence behavior is explicit (mandatory UNKNOWN rules —
      §5.6);
- [x] UI placement is identified (§5.9);
- [x] gaps are classified (§5.10);
- [x] scoring formulas are explicitly deferred (§5.11);
- [x] P3 semantic immutability is preserved (implementation audit: only this
      document was created; see §5.14 verification);
- [x] no production code is changed.

## 5.14 Agent Safety Rules — verification

The agent MUST NOT (and did not): edit P3 implementation; edit P3 thresholds;
edit P3 database schema; add P4 database tables; add P4 services; add API
endpoints; change UI; introduce arbitrary numeric thresholds; introduce
arbitrary weights; infer trading actions; create production test fixtures that
alter existing contracts.

**Verification of this task:**
- `git status` before/after: the only change is this new document
  (`docs/P4_Upgrade/P4_01_DECISION_SUPPORT_CONTRACT_AND_GAP_AUDIT.md`);
  pre-existing worktree state (P3-20 commit + two pre-existing noise files) was
  untouched.
- No `src/`, `backend/`, `drizzle/`, or config file was modified.
- No tests were added/changed; no fixtures created.

---

## Semantic Decision Addendum — Q1–Q5

**Status:** This addendum resolves the five semantic questions raised in P4-01
(discrepancy D2 and the agent-report open questions). Resolutions are grounded
in direct repository verification; where documentation and implementation
disagree, implementation is the operational truth (per P4-01 §0). P3 semantics
remain frozen; this addendum defines P4 interpretation contracts only.

### Q1 — RESOLVED: P4 phase boundary

**Evidence verified:** `docs/P3_Upgrade/p3.md` §44 lists the older roadmap
("P4: Token Unlock Intelligence, Catalyst Engine, Event Detection, Narrative
Discovery, Smart Money / On-chain") and §45 positions P4 = "Catalyst & Event
Intelligence", P5 = "Prediction / Backtesting". P4-01's charter defines P4 =
Decision Support. These are reconciled, not deleted:

```text
P4 — Decision Support
│
├── P4 Core
│   └── Intelligence → Interpretation → Decision Support
│       (Signal, Direction, Opportunity, Risk, Confidence,
│        Actionability, Explanation / evidence traceability)
│
└── P4 Evidence Extensions (optional future evidence providers)
    ├── Catalyst / Event Intelligence
    ├── Token Unlock Intelligence
    ├── Narrative Discovery
    └── Smart Money / On-chain
```

Decisions:

1. **P4 Core** is the current phase contract: intelligence → interpretation →
   decision support. P4-02 implements the Core only.
2. Older roadmap items are **preserved** (not deleted, not moved to P5) and
   reclassified as **P4 Evidence Extensions** — they may later supply evidence
   to P4 Core but must never redefine Core semantics.
3. Nothing in this classification changes P5's boundary (action/automation).

### Q2 — RESOLVED: NEUTRAL semantics

**Evidence verified:** `src/lib/p3/regime.ts` line 8:
`P3_REGIMES = ["EMERGING", "STRONG", "MATURE", "WEAKENING", "DEAD", "NEUTRAL"]` —
NEUTRAL is a real, persistable P3 classification; production artifact #1
persisted `regime = NEUTRAL`. (P3_DATA_CONTRACT §P3-08 omits NEUTRAL — that is
discrepancy D1; implementation is truth.)

Contract:

1. `P3 Regime = NEUTRAL` does **NOT** automatically mean UNKNOWN, MISSING,
   INSUFFICIENT_HISTORY, or MIXED.
2. At the direct regime-to-direction level: `NEUTRAL → NEUTRAL`.
3. **P4 Direction is NOT a simple lookup of P3 Regime.** Direction is a P4
   interpretation of the full evidence set. Example: Regime = NEUTRAL while
   Breadth improves, Momentum weakens, RS improves and Leadership deteriorates
   → P4 may determine Direction = MIXED, provided the evidence-sufficiency
   rules (§5.6) permit interpretation.
4. Therefore: **P3 Regime ≠ P4 Direction.** Regime is a P3 classification;
   Direction is a P4 interpretation.

### Q3 — RESOLVED: MIXED vs TRANSITION

**Decision: NO — they are orthogonal concepts. There is no 1:1 mapping.**

- **MIXED** = current evidence contains materially conflicting directional
  signals (P4 interpretation of the present state).
- **TRANSITION** = historical trajectory state defined by the frozen P3
  historical trend contract (`P3_14` D.1: "a classification change occurred
  but direction is mixed / net score ≈ 0"; implemented as P3TrendState
  `TRANSITION` in `src/lib/types/p3-intelligence-history.ts` and produced by
  `aggregateTrendStates`/`overallTrend`).

Valid combinations (both are independent axes):

- **Example A:** Current: Breadth ↑, Momentum ↓, RS ↑, Leadership ↓ →
  Direction = MIXED; Historical overall trend = TRANSITION. **Valid.**
- **Example B:** Direction = NEGATIVE; Historical Trend = TRANSITION.
  **Valid.**
- **Example C:** Direction = MIXED; Historical Trend = IMPROVING. **Valid.**

Direction describes the current interpreted direction; Historical Trend
describes change/trajectory across artifacts.

### Q4 — RESOLVED: qualitative v1 buckets only

**Decision: P4 v1 uses qualitative buckets only.** Allowed for Opportunity,
Risk, Confidence, Actionability: **LOW | MEDIUM | HIGH | UNKNOWN**.

1. No composite numeric score is defined in P4-01 or P4-02.
2. Prohibited in v1: arbitrary weights, normalized 0–100 scores, weighted
   composites, probability of loss, calibrated probability, ML confidence
   scores.
3. Rationale: the current historical evidence base (3 VALID artifacts for one
   narrative) is insufficient to justify numeric calibration or weights.
4. Future versions may introduce numeric scoring only under a **versioned
   contract** after sufficient historical validation. No such formulas are
   defined now (per §5.11).

### Q5 — RESOLVED: P2 Event Risk as secondary evidence

**Decision: YES — P2 Event Risk may be consumed, but only as secondary
(supporting) evidence.** Verified: `event_risks` table (`src/db/schema.ts`
line 442; coinId + narrativeId + eventDate + riskScore), service
`src/lib/services/event-risk.service.ts`, types `src/lib/types/event-risk.ts`;
P2 decision engine thresholds live in `src/lib/services/decision-engine.service.ts`
(eventRiskScore ≥80 → −25, ≥60 → −15, ≥40 → −8; correlationRisk ≥80 → −10).

```text
P3 Intelligence
    +
P2 Event Risk
    ↓
P4 Evidence Fusion
    ↓
P4 Decision Support
```

Rules:

1. P2 Event Risk must retain explicit provenance: `source = P2_EVENT_RISK`.
2. P2 Event Risk must NOT overwrite P3 facts.
3. P2 Event Risk must NOT modify P3 Regime, Rotation, Breadth, Momentum,
   Relative Strength, Leadership or Historical Trend.
4. P2 Event Risk must NOT be silently promoted into P3 structural evidence.
5. A coin-level event risk must not automatically become narrative-wide risk
   (scope compatibility required).
6. P4 may use event-risk as supporting/secondary evidence where its scope,
   freshness and identity are compatible with the narrative interpretation.
7. Evidence conflict must be represented, not hidden (P4 reports the conflict;
   it does not resolve it silently).
8. Existing P2 Decision Engine thresholds must NOT be inherited as P4 scoring
   rules.

Distinction: **P2 Event Risk** = event-specific evidence; **P3 Intelligence** =
structural narrative intelligence; **P4** = interpretation/fusion of evidence.

### Consolidated semantic contract

| Concept | Layer | Meaning | Allowed values | Notes |
|---|---|---|---|---|
| Regime | P3 | Current narrative regime classification | P3-defined states (incl. NEUTRAL per implementation) | Immutable P3 semantic |
| Historical Trend | P3 | Historical trajectory | P3 trend states (IMPROVING/DETERIORATING/STABLE/TRANSITION/UNKNOWN) | Not a current direction |
| Direction | P4 | Current interpreted direction | POSITIVE / NEGATIVE / MIXED / NEUTRAL / UNKNOWN | Derived; not a Regime lookup |
| Signal | P4 | Meaningful interpreted state/event | Versioned catalog | Traceable to evidence |
| Opportunity | P4 | Favorable decision context | LOW / MEDIUM / HIGH / UNKNOWN | No price prediction |
| Risk | P4 | Unfavorable exposure/deterioration context | LOW / MEDIUM / HIGH / UNKNOWN | No loss probability |
| Confidence | P4 | Evidence strength | LOW / MEDIUM / HIGH / UNKNOWN | Evidence-based |
| Actionability | P4 | Decision usefulness | LOW / MEDIUM / HIGH / UNKNOWN | Not same as confidence |
| Event Risk | P2 → P4 evidence | Event-specific supporting evidence | Existing P2 semantics | Secondary, provenance required |

### Semantic independence rules

- **Rule A** — P3 classification must never be overwritten by P4 interpretation.
- **Rule B** — P4 Direction must not be implemented as a simple Regime lookup.
- **Rule C** — MIXED and TRANSITION are not equivalent (Q3).
- **Rule D** — UNKNOWN means insufficient evidence for the requested
  interpretation, not merely that the classification is neutral.
- **Rule E** — NEUTRAL is a valid classification and must not be degraded to
  UNKNOWN (Q2).
- **Rule F** — P2 Event Risk is supporting evidence, not a replacement for P3
  structural intelligence (Q5).
- **Rule G** — P4 v1 does not contain numeric composite scoring (Q4).
- **Rule H** — Every P4 conclusion must be traceable to one or more explicit
  evidence items.

---

## Final response of P4-01 (agent report)

1. **Path of created document:** `docs/P4_Upgrade/P4_01_DECISION_SUPPORT_CONTRACT_AND_GAP_AUDIT.md`
2. **Executive summary:** P3 (closed) supplies immutable per-narrative
   intelligence artifacts + same-identity historical series/trend. P4 adds an
   interpretation layer — Signal / Direction / Opportunity / Risk / Confidence /
   Actionability — fully traceable to P3 evidence, with mandatory `UNKNOWN`
   when evidence is insufficient, and no numeric scoring. P5 later turns P4
   interpretations into actions. P4 is interpretation, not another metric
   layer, because P3 already owns the numeric surface and any P4 "score layer"
   would compete with frozen P3 semantics and produce opaque composites.
3. **P3 → P4 input matrix:** §5.3 — 15 per-artifact fields (A1-A15) and 7
   historical fields (B1-B7) with source, semantics, immutability, availability
   handling, valid/invalid/missing behavior, historical-comparison allowance,
   and conclusion-support rating.
4. **Highest-impact gaps:**
   - **G1 — P4 semantic contract does not exist** (Signal catalog, Direction
     normalization, Risk/Opportunity/Confidence/Actionability taxonomies,
     UNKNOWN rules). Everything P4 builds depends on it. Classification:
     NEEDS NEW CONTRACT.
   - **G2 — No P4 read path** (view model + service + API field). The narrative
     route already has the correct degrade-to-null pattern to extend.
     Classification: NEEDS NEW CONTRACT (P4-02).
   - **G3 — Doc/implementation divergence on Regime** (D1): contract doc lists
     5 regimes; implementation and production include NEUTRAL. Must be
     reconciled in documentation before P4 defines Regime-based signals.
   - **G4 — P2 "Decision Engine" is coin-level numeric penalization**
     (`decision-engine.service.ts`), not narrative-level evidence interpretation.
     P4 must not inherit its thresholds; it should define its own evidence-based
     semantics (or explicitly reference P2 outputs as non-P3 inputs — not in
     P4-02 scope).
   - **G5 — Historical evidence base is small** (3 artifacts, one narrative).
     Confidence/validation methodology must anticipate series growth; no
     weights can be validated yet.
5. **Unresolved semantic questions (now RESOLVED — see "Semantic Decision
   Addendum — Q1–Q5" above; historical wording preserved for audit):**
   - Q1 ✅ RESOLVED: P4/P5 naming conflict (D2) — "Decision Support" vs
     p3.md's "Catalyst & Event Intelligence" roadmap → P4 Core vs P4
     Evidence Extensions (older roadmap preserved and reclassified; nothing
     moved to P5).
   - Q2 ✅ RESOLVED: Should P4 Regime-based signals treat NEUTRAL as a real
     class (per implementation) and how does NEUTRAL map to Direction? →
     NEUTRAL is real and persistable; NEUTRAL→NEUTRAL at regime level; P4
     Direction is not a Regime lookup (Rule B); NEUTRAL never degrades to
     UNKNOWN (Rule E).
   - Q3 ✅ RESOLVED: Is `MIXED` direction distinct from P3 `TRANSITION`, or a
     1:1 mapping? → Orthogonal; NO 1:1 mapping (Rule C).
   - Q4 ✅ RESOLVED: Are LOW/MEDIUM/HIGH qualitative buckets sufficient for
     P4-02, or does product require numeric ranges (which would reopen §5.11)?
     → P4 v1 uses qualitative buckets only; numeric scoring deferred to a
     versioned contract after historical validation (Rule G).
   - Q5 ✅ RESOLVED: Should P4 consume P2 event-risk data as corroborating
     (non-P3) evidence? → Yes, as secondary evidence only, with provenance
     `source = P2_EVENT_RISK`; P2 decision-engine thresholds are excluded
     from P4 (Rule F, Q5 rules 1–8).
6. **Confirmation that no production code was modified:** confirmed — the only
   change is the deliverable document; `src/`, `backend/`, schema, configs,
   tests, and P3 artifacts are untouched.
7. **Exact recommendation for P4-02:** *P4-02 — P4 Semantic Contract Freeze &
   Read Path* — (a) produce the frozen P4 semantic contract (Signal catalog,
   Direction normalization rules over frozen P3-14 trend states, Risk/
   Opportunity/Confidence/Actionability qualitative taxonomies, mandatory
   UNKNOWN rules, evidence-traceability format) resolving Q1-Q5; (b) define the
   read-only `P4DecisionSupportViewModel` + service contract (UI → service →
   DB, consuming only §5.3 inputs, never importing `src/lib/p3/*`); (c)
   specify the API extension of `GET /api/narratives/[id]` with
   `data.p4DecisionSupport` (degrade-to-null, service-failure-safe);
   (d) specify UI placement per §5.9 — WITHOUT implementing code, WITHOUT
   numeric scoring, WITHOUT touching P3.   P4-02 is a specification task exactly
   mirroring P4-01's boundary; implementation begins only after its approval.

---

## P4-01 Closure Status

P4-01 semantic questions Q1–Q5:

- Q1 ✅ RESOLVED
- Q2 ✅ RESOLVED
- Q3 ✅ RESOLVED
- Q4 ✅ RESOLVED
- Q5 ✅ RESOLVED

P4-01 remains documentation-only.

No production code changed.

P4-02 may now proceed to formal Semantic Contract Freeze & Read Path.
