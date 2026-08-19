# P6 Master Specification

**Project:** NarrativeHealth  
**Phase:** P6 — Narrative & Coin Health Intelligence  
**Status:** MASTER SPECIFICATION — APPROVED FOR IMPLEMENTATION  
**Baseline:** P4-P5 frozen product baseline  
**Scope:** Intelligence, early warning, trend detection, aggregated narrative + coin health measurement  
**Explicit non-goal:** Auto-trading, bot trading, order execution, portfolio execution

---

## 1. Purpose

P6 is the next product phase after the frozen P4-P5 baseline. Its purpose is to transform the existing decision-support infrastructure into a useful **measurement and early-warning intelligence system for crypto narratives and the coins within them**.

P6 must answer four user questions:

1. **How healthy is this narrative?**
2. **Is its health improving or deteriorating?**
3. **What changed recently and how early is the warning?**
4. **Which coins are strengthening or weakening within the narrative, and why?**

P6 is an intelligence/measurement system, not a trading system.

---

## 2. Product Boundary

### In scope

- Narrative health measurement
- Coin health measurement within a narrative
- Multi-dimensional health indicators
- Trend and regime detection
- Early-warning signals
- Narrative ↔ coin aggregation
- Historical comparison and change detection
- Explainable user-facing alerts
- Confidence and data-quality qualification
- Dashboard and narrative detail visualisation

### Explicitly out of scope

- Automatic trading
- Buy/sell execution
- Order creation or routing
- Portfolio management
- Trading bots
- Autonomous financial actions
- Broker/exchange execution integration
- Optimisation for trading PnL

The product may surface **risk, opportunity, deterioration, strengthening, rotation or warning states**, but these are intelligence outputs and must not become execution instructions.

---

## 3. Frozen P4-P5 Foundation

P6 is downstream of the P4-P5 frozen baseline. It MUST NOT silently modify frozen P4/P5 semantics.

Authoritative handoff: `docs/P5_Upgrade/P4-P5_HANDOFF.md`.

### Required invariants

- P4 remains the upstream decision-support snapshot/source.
- P5 outcome remains distinct from safety, approval, permission and execution.
- `SELECTED` never means executed.
- Permission never means execution.
- `NO_ACTION` is distinct from `NO_DECISION_RECORD`.
- `NOT_DETERMINED` must remain an honest uncertainty state.
- Historical artifacts are preferred over live re-evaluation for historical views/replay.
- Decision identity, idempotency identity and content identity remain separate.
- Provenance must remain traceable.
- P5 remains advisory-only.
- P6 must not introduce hidden trading semantics into P5.

Any requirement that conflicts with the handoff is a change request against the frozen baseline, not an implicit P6 implementation detail.

---

## 4. P6 Architecture

```text
                         ┌──────────────────────┐
                         │ External / Market     │
                         │ Data Sources          │
                         └──────────┬───────────┘
                                    │
                           ingestion / normalization
                                    │
                         ┌──────────▼───────────┐
                         │ P6 Data Foundation    │
                         │ quality + snapshots   │
                         └──────────┬───────────┘
                                    │
                 ┌──────────────────┼──────────────────┐
                 │                  │                  │
        ┌────────▼────────┐ ┌──────▼────────┐ ┌──────▼─────────┐
        │ Narrative       │ │ Coin Health   │ │ Trend / Regime │
        │ Health Engine   │ │ Engine        │ │ Engine         │
        └────────┬────────┘ └──────┬────────┘ └──────┬─────────┘
                 │                  │                  │
                 └──────────────────┼──────────────────┘
                                    │
                         ┌──────────▼───────────┐
                         │ P6 Intelligence      │
                         │ Aggregation + Alerts │
                         └──────────┬───────────┘
                                    │
                         ┌──────────▼───────────┐
                         │ Presentation / UI    │
                         │ Dashboard + Detail   │
                         └───────────────────────┘

P4/P5 remains a downstream-compatible decision-support layer and is not converted into an execution engine.
```

### Architectural principles

1. **Measure before recommending.**
2. **Evidence before interpretation.**
3. **Separate raw data, derived metrics and presentation language.**
4. **Every alert has a provenance path.**
5. **Data quality is first-class.**
6. **Historical calculations are reproducible.**
7. **No hidden trading semantics.**
8. **Graceful degradation when data is incomplete.**
9. **Narrative health is aggregate intelligence, not a single metric.**
10. **User comprehension is part of correctness.**

---

## 5. P6 Data Model

P6 data is divided into five layers.

### 5.1 Reference layer

- `Narrative`
- `Coin`
- `NarrativeCoinMembership`
- `DataSource`

### 5.2 Observation layer

Time-indexed observations such as:

- price/return
- relative strength
- volume/liquidity
- market share / dominance where available
- volatility
- attention / activity metrics where available
- narrative-specific external indicators

Observations MUST retain source, timestamp, freshness and quality metadata.

### 5.3 Derived metric layer

Examples:

- momentum
- breadth
- relative strength
- participation
- volatility regime
- persistence
- acceleration/deceleration
- health component scores

Derived metrics MUST record algorithm/version and source observation window.

### 5.4 Intelligence layer

Core entities:

- `NarrativeHealthSnapshot`
- `CoinHealthSnapshot`
- `TrendState`
- `EarlyWarning`
- `HealthChangeEvent`

Each intelligence artifact should include:

- subject
- as-of timestamp
- algorithm/version
- state
- components
- confidence
- data-quality state
- provenance

### 5.5 Presentation layer

UI view models must not directly expose internal persistence structures. They transform intelligence into:

- headline
- health state
- trend state
- warning severity
- why
- evidence
- confidence
- what changed
- what to watch

---

## 6. Narrative Health Model

P6 must avoid a single opaque score as the primary truth.

Initial health dimensions should include:

1. **Momentum** — direction and persistence of movement.
2. **Breadth** — how broadly coins in the narrative participate.
3. **Relative Strength** — narrative performance versus an appropriate benchmark.
4. **Participation** — evidence that activity is distributed rather than isolated.
5. **Stability** — volatility/dispersion and regime behaviour.
6. **Persistence** — whether the observed condition is sustained.

A composite health state may be produced for UI convenience, but every composite state MUST remain decomposable into its component dimensions.

Suggested V1 states:

- HEALTHY
- STRENGTHENING
- STABLE
- WEAKENING
- DETERIORATING
- INSUFFICIENT_DATA

These are measurement states, not trade signals.

---

## 7. Coin Health Model

Each coin receives health measurements in the context of its narrative membership.

Initial dimensions:

- momentum
- relative strength
- participation contribution
- volatility/stability
- persistence
- narrative-relative behaviour

The system should identify patterns such as:

- leader strengthening
- leader weakening
- broad participation
- isolated outperformance
- lagging coin
- improving participant
- deteriorating participant

No label may imply an automatic trade action.

---

## 8. Trend & Regime Intelligence

P6 must detect **change**, not merely report current state.

Required concepts:

- current state
- previous state
- direction of change
- acceleration/deceleration
- persistence
- regime transition
- confidence
- freshness

Example transitions:

`STABLE → STRENGTHENING`  
`STRENGTHENING → HEALTHY`  
`HEALTHY → WEAKENING`  
`WEAKENING → DETERIORATING`

A transition is more valuable than a static badge because it supports early warning.

---

## 9. Early Warning System

An early warning is a structured intelligence event, not a trading signal.

Each warning must answer:

- What changed?
- When did it change?
- Why is it notable?
- Which evidence supports it?
- How confident is the detection?
- Is the data fresh and sufficient?
- What should the user monitor next?

Initial severity vocabulary:

- INFO
- WATCH
- WARNING
- CRITICAL

Severity must be based on explicit, versioned rules. Thresholds are configuration, not hidden code semantics.

Warnings should support deduplication, cooldown/suppression and state transitions so the UI does not become noisy.

---

## 10. Data Quality & Confidence

Data quality is independent from market/narrative health.

Minimum states:

- FRESH
- AGING
- STALE
- INSUFFICIENT
- DEGRADED

A healthy narrative with poor data quality must not be presented as highly reliable.

Confidence should incorporate, where appropriate:

- coverage
- freshness
- consistency
- observation count
- source reliability
- agreement across components

Confidence must not be used to hide missing evidence.

---

## 11. Provenance & Reproducibility

Every P6 intelligence artifact must be traceable to:

```text
raw observation
  → normalized observation
  → derived metric
  → algorithm/version
  → intelligence result
  → presentation model
  → UI / alert
```

Historical results must remain reconstructable from stored inputs and versioned algorithms/configuration.

P6 must never silently replace historical inputs with current live values.

---

## 12. UI Contract

### 12.1 Narrative dashboard

The primary dashboard should expose:

- narrative health state
- trend direction
- early-warning status
- confidence/data quality
- top improving coins
- top weakening coins
- breadth/participation summary
- recent changes

### 12.2 Narrative detail

Recommended hierarchy:

1. **Health headline**
2. **What changed?**
3. **Why?**
4. **Trend / regime**
5. **Coin participation**
6. **Early warnings**
7. **Evidence**
8. **Historical view**
9. **Technical provenance** (collapsed)

### 12.3 Coin detail

Show:

- coin health
- narrative-relative strength
- trend
- contribution to narrative breadth
- warnings
- recent change
- confidence/data quality

### 12.4 UI safety boundary

The UI MUST NOT present P6 intelligence as:

- BUY
- SELL
- LONG
- SHORT
- ORDER
- EXECUTE

If future product copy uses action language, it must remain observational/monitoring guidance unless a separately approved phase explicitly changes the boundary.

---

## 13. API / Contract Principles

P6 APIs should separate:

- reference data
- observations
- derived metrics
- intelligence artifacts
- presentation models

Presentation contracts should be stable and user-oriented.

Every intelligence response should carry:

- `asOf`
- `algorithmVersion`
- `dataQuality`
- `confidence`
- provenance reference

Historical endpoints must request a historical snapshot/version rather than silently recalculating from current data.

---

## 14. Versioning

P6 algorithms and thresholds are versioned independently from UI presentation.

At minimum:

- `algorithmVersion`
- `thresholdVersion`
- `dataSchemaVersion`

Changing a threshold or calculation is a versioned semantic change and must not rewrite historical meaning without explicit migration policy.

---

## 15. P6 Work Breakdown / Roadmap

### P6-01 — Data Foundation & Contract

Goal: establish canonical observation, source, freshness and quality contracts.

Deliverables:

- recon
- data model
- source registry
- observation schema
- freshness/quality contract
- tests
- freeze report

### P6-02 — Narrative Health Engine

Goal: calculate explainable multi-dimensional narrative health.

Deliverables:

- health dimensions
- aggregation rules
- algorithm v1
- versioned parameters
- snapshots
- tests
- freeze report

### P6-03 — Coin Health & Narrative Participation

Goal: measure coin-level contribution and identify strengthening/weakening participants.

Deliverables:

- coin health model
- narrative membership weighting
- breadth/participation metrics
- explainable aggregation
- tests
- freeze report

### P6-04 — Trend / Regime Detection

Goal: detect transitions and acceleration/deceleration.

Deliverables:

- state machine
- transition rules
- persistence logic
- regime model
- historical comparison
- tests
- freeze report

### P6-05 — Early Warning Engine

Goal: turn material changes into structured, deduplicated warnings.

Deliverables:

- warning contract
- severity rules
- cooldown/deduplication
- evidence references
- confidence/data quality
- tests
- freeze report

### P6-06 — Intelligence Aggregation & Explainability

Goal: combine narrative, coin, trend and warning facts into a coherent intelligence view.

Deliverables:

- aggregation layer
- plain-language explanation
- what changed
- why
- what to watch
- provenance
- tests
- freeze report

### P6-07 — UI / Dashboard

Goal: make P6 understandable in seconds and useful for monitoring.

Deliverables:

- narrative health dashboard
- narrative detail
- coin health view
- trend visualisation
- warning panel
- historical view
- technical details collapsed
- UI contract tests

### P6-08 — Historical Intelligence & Backfill

Goal: make health/trend/warning history usable without corrupting historical semantics.

Deliverables:

- snapshot browsing
- historical comparison
- reproducible calculation metadata
- controlled backfill
- data-quality treatment

### P6-09 — System Verification & Product Value Audit

Goal: verify the complete P6 system and user value before freeze.

Checks:

- contract integrity
- provenance
- reproducibility
- data quality
- alert quality
- semantic boundary
- UI comprehension
- regression

### P6-FINAL — Baseline Freeze & Handoff

Deliverables:

- `P6_BASELINE.md`
- capability catalog
- open-items register
- handoff document
- final audit
- frozen architecture/invariants

---

## 16. Standard Task Execution Protocol

P6 follows the established P4/P5 execution model.

For every task:

1. Agent performs recon first.
2. Agent identifies impacted contracts and frozen boundaries.
3. Agent proposes implementation plan only within approved scope.
4. Agent implements.
5. Agent runs targeted tests.
6. Agent runs relevant regression.
7. Agent performs source/semantic scans where applicable.
8. Agent creates implementation report.
9. Agent creates final revision/freeze audit.
10. If no unresolved decision requiring owner input exists, the next task is assigned immediately.

A report that identifies a non-blocking enhancement does not automatically stop the roadmap.

---

## 17. Definition of Done

A P6 task is complete only when:

- implementation matches the approved contract
- tests pass
- typecheck passes
- no frozen P4/P5 invariant is violated
- provenance is preserved
- data quality is explicit
- documentation matches source
- open/provisional items are explicitly classified
- no hidden trading semantics are introduced
- freeze audit is complete

---

## 18. P6 Global Invariants

### I1 — Measurement, not execution
P6 measures and warns. It does not trade.

### I2 — No semantic leakage into P4/P5
P6 cannot redefine frozen P4/P5 meanings.

### I3 — Explainability
Every material intelligence output has a reason/evidence path.

### I4 — Decomposability
Composite health remains explainable through dimensions.

### I5 — Change awareness
Trend intelligence must preserve state transitions, not only current state.

### I6 — Data quality independence
Health and data quality are separate dimensions.

### I7 — Historical integrity
Historical intelligence uses historical inputs and versioned semantics.

### I8 — Determinism
Same frozen inputs + same algorithm/configuration produce the same result.

### I9 — Provenance
Every derived result traces to its source observations.

### I10 — Graceful degradation
Insufficient or degraded data must not silently become healthy/normal intelligence.

### I11 — Versioned semantics
Algorithms, thresholds and schemas are versioned.

### I12 — User-first presentation
Technical internals do not replace understandable conclusions.

### I13 — No hidden recommendation engine
P6 may say what changed and what to watch; it must not secretly become an execution/recommendation engine.

### I14 — Frozen P4-P5 handoff is authoritative
Any conflict is resolved by explicit change control.

---

## 19. Acceptance Gate Families

P6-FINAL must verify at least:

- Architecture integrity
- Data contract integrity
- Metric correctness
- Versioning
- Provenance
- Historical reproducibility
- Data quality
- Trend transitions
- Warning correctness/deduplication
- UI contract
- Product comprehension
- P4/P5 invariant preservation
- Regression/typecheck
- Semantic scan
- Git boundary

No P6 phase may be declared frozen solely because unit tests pass; product value and semantic boundaries must also be audited.

---

## 20. Explicit Non-Goals for All P6 Tasks

No P6 task may introduce, even incidentally:

- automated order execution
- trading bot loops
- exchange order APIs
- portfolio rebalancing
- PnL optimisation
- hidden BUY/SELL semantics
- autonomous financial action

If such a requirement appears during implementation, it must be raised as a separate owner decision/change request.

---

## 21. Master Freeze Statement

P6 is approved as the next phase for building **NarrativeHealth Intelligence**: a system that measures the health of narratives and their constituent coins, detects changes and early warnings, aggregates evidence, and communicates those findings clearly to the user.

P4-P5 remain the frozen foundation. P6 extends intelligence around that foundation without converting the product into an automated trading system.

**P6 roadmap is ordered P6-01 → P6-09 → P6-FINAL.**
