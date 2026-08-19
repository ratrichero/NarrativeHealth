# P6 Execution Plan

**Project:** NarrativeHealth  
**Phase:** P6 — Narrative & Coin Health Intelligence  
**Document:** P6-00 — Master Execution Plan  
**Status:** APPROVED EXECUTION MAP  
**Baseline:** P4-P5 frozen  
**Master specification:** `docs/P6_Upgrade/P6_MASTER_SPECIFICATION.md`  
**Authoritative handoff:** `docs/P5_Upgrade/P4-P5_HANDOFF.md`

---

## 1. Purpose

This document converts the approved P6 Master Specification into the phase-level execution map used by the Central Planning / Agent Execution model.

ChatGPT is the planning, architecture, contract, acceptance-gate and audit authority for P6. Agents are execution workers. An Agent MUST NOT independently change P6 semantics, introduce new business rules, alter frozen P4/P5 semantics, or expand scope.

This document is a roadmap and dependency map. Individual Agent prompts are issued separately for each executable task after the preceding task has been audited.

---

## 2. Operating Model

```text
USER / OWNER
    │
    │ product decisions
    ▼
CHATGPT — CENTRAL PLANNER / ARCHITECT / REVIEWER
    │
    │ exact task specification + Agent prompt
    ▼
AGENT — EXECUTOR
    │
    │ recon → implement → test → verify → report
    ▼
CHATGPT — AUDIT / FREEZE DECISION
    │
    ├── BLOCKING semantic issue → stop → owner decision
    ├── NON-BLOCKING issue → planner decides next task
    └── PASS → next task
```

### Agent authority boundary

Agent may:

- inspect the repository;
- identify implementation facts;
- implement an explicitly approved solution;
- add/update tests required by the task;
- update task documentation within the assigned scope;
- report implementation gaps and semantic ambiguities.

Agent may NOT:

- redefine a metric;
- invent a threshold;
- change a state vocabulary;
- silently reinterpret an existing P4/P5 field;
- change a frozen P4/P5 contract;
- introduce trading/execution semantics;
- add an external data source or service without explicit approval;
- turn a provisional observation into a frozen business rule;
- broaden a task because an adjacent improvement appears useful.

If the intended solution cannot be implemented without a semantic decision, the Agent reports the blocker instead of deciding it.

---

## 3. Mandatory Pre-Task Audit

Before every P6 task that can affect the P4/P5 boundary, the planner and Agent must use:

1. `docs/P5_Upgrade/P4-P5_HANDOFF.md`
2. relevant P5 task specification(s)
3. relevant P4 specification(s)
4. current implementation truth in the repository
5. the latest accepted P6 task reports/freeze documents

The handoff is the frozen semantic boundary. It explicitly requires preservation of outcome/safety/approval/permission/execution independence, historical integrity, identity separation, presentation purity, and advisory-only P5 semantics.

No task is considered valid if it depends on an undocumented reinterpretation of those contracts.

---

## 4. Current Repository Recon Baseline

The P6 Master Specification is present at `docs/P6_Upgrade/P6_MASTER_SPECIFICATION.md`. The P6 upgrade directory currently contains that master specification and no implementation task pack yet.

The repository currently contains both the existing application/data stack and the frozen P4/P5 implementation. The root README describes a Next.js primary API/frontend, FastAPI backup API, PostgreSQL persistence, collectors and feature calculation layers. The current source tree includes `src/app`, `src/components`, `src/db`, `src/lib`, `src/services`, and `src/types`, while the backend includes API, database, collector and audit/migration code.

The latest commits show that P4-P5 baseline closure was completed immediately before P6 planning, including the final P4-P5 handoff and 481/481 test evidence. The P6 master specification was then added as a document-only change.

**Important:** the README is legacy/informational. Current implementation truth and frozen P4/P5 contracts take precedence over legacy architecture descriptions.

---

## 5. Phase Dependency Graph

```text
P6-01A Recon / Data Landscape
        │
        ▼
P6-01B Observation Contract
        │
        ├──────────────► P6-01C Source Registry
        │                       │
        └──────────────► P6-01D Freshness + Data Quality Contract
                                │
                                ▼
                         P6-01E Persistence
                                │
                                ▼
                         P6-01F Normalization Boundary
                                │
                                ▼
                         P6-01G Tests / Regression
                                │
                                ▼
                         P6-01-FINAL Audit + Freeze
                                │
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                  ▼
           P6-02             P6-03              P6-04
       Narrative Health     Coin Health       Trend/Regime
              │                 │                  │
              └─────────────────┼──────────────────┘
                                ▼
                             P6-05
                       Early Warning Engine
                                │
                                ▼
                             P6-06
                 Intelligence Aggregation /
                       Explainability
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
                 P6-07                   P6-08
              UI / Dashboard       Historical / Backfill
                    │                       │
                    └───────────┬───────────┘
                                ▼
                             P6-09
                 System Verification /
                   Product Value Audit
                                │
                                ▼
                           P6-FINAL
                    Baseline / Handoff
```

### Dependency rule

P6-02, P6-03 and P6-04 may proceed in parallel only after P6-01 is frozen and their respective input contracts are explicit. P6-05 depends on the state/metric contracts from P6-02–04. P6-06 depends on the complete intelligence artifacts. P6-07 and P6-08 depend on stable presentation/historical contracts from P6-06 and the underlying frozen artifacts. P6-09 is the integration gate. P6-FINAL cannot start before P6-09 passes.

---

## 6. Task Decomposition

### P6-01 — Data Foundation & Contract

**Primary objective:** establish the canonical observation/data-quality foundation before any intelligence algorithm is frozen.

#### P6-01A — Current Data Landscape Recon

Agent must inventory:

- existing Narrative/Coin/membership persistence;
- existing market observations and feature data;
- collector/source implementations;
- timestamps and timezone handling;
- existing freshness assumptions;
- existing quality/degradation semantics;
- database migrations/schema conventions;
- test conventions;
- existing P3/P4/P5 provenance structures relevant to P6;
- candidate reuse vs new P6 storage boundaries.

Output: source-level recon report only. No semantic implementation decisions.

#### P6-01B — Observation Contract

Planner freezes the canonical P6 observation shape, identity, timestamp semantics, source reference, value representation, units, nullability, window semantics and provenance requirements based on P6-01A.

#### P6-01C — Source Registry

Define and implement the source registry boundary: source identity, source type, reliability metadata, supported metrics, expected cadence and source-specific limitations.

#### P6-01D — Freshness / Data Quality Contract

Freeze the independent data-quality model: `FRESH`, `AGING`, `STALE`, `INSUFFICIENT`, `DEGRADED`, including deterministic classification inputs and versioning requirements.

#### P6-01E — Observation Persistence

Implement storage for canonical observations and source/quality metadata without embedding intelligence calculations into persistence.

#### P6-01F — Normalization Boundary

Implement normalization from raw source payloads into canonical observations. Raw/source provenance must remain recoverable.

#### P6-01G — Tests + Regression

Run targeted unit/integration tests, typecheck, relevant existing regression and semantic scans. Verify deterministic persistence/normalization and quality-state behavior.

#### P6-01-FINAL — Audit + Freeze

Planner performs source-level audit and freezes the P6 data foundation contract. A failed audit blocks downstream engine work.

---

### P6-02 — Narrative Health Engine

**Dependency:** P6-01-FINAL.

#### P6-02A — Metric Contract Recon
Inventory available canonical observations against the six required health dimensions:

- momentum;
- breadth;
- relative strength;
- participation;
- stability;
- persistence.

#### P6-02B — Health Dimension Definitions
Freeze precise definitions, windows, benchmark rules, missing-data behavior and output semantics. No hidden score.

#### P6-02C — Aggregation / Composite Contract
Define how component dimensions form the decomposable V1 narrative state. Composite output is presentation convenience, not opaque truth.

#### P6-02D — Algorithm V1 + Parameters
Freeze `algorithmVersion` and parameter/threshold versioning. All numeric thresholds must be explicit configuration.

#### P6-02E — Snapshot Persistence
Implement deterministic narrative health snapshots with provenance, confidence and data quality.

#### P6-02F — Tests / Historical Determinism
Verify edge cases, insufficient data, degraded data, component decomposition and reproducibility.

#### P6-02-FINAL — Audit + Freeze
Freeze the narrative health engine only after semantic and deterministic audit passes.

---

### P6-03 — Coin Health & Narrative Participation

**Dependency:** P6-01-FINAL and P6-02B where shared dimension definitions are involved.

#### P6-03A — Membership / Weighting Recon
Audit current narrative membership and decide only through explicit contract whether membership is equal-weighted, configured-weighted or another approved model.

#### P6-03B — Coin Health Contract
Freeze coin-level dimensions, narrative-relative behavior and missing-data semantics.

#### P6-03C — Breadth / Participation Contribution
Implement explainable contribution metrics and ensure isolated outperformance is distinguishable from broad participation.

#### P6-03D — Coin Snapshot
Persist deterministic coin health snapshots with algorithm/version, data quality and provenance.

#### P6-03E — Tests / Regression
Cover leaders, laggards, improving participants, deteriorating participants, sparse membership and insufficient evidence.

#### P6-03-FINAL — Audit + Freeze
Freeze coin health and participation semantics.

---

### P6-04 — Trend / Regime Detection

**Dependency:** P6-02-FINAL and P6-03-FINAL where coin participation transitions are required.

#### P6-04A — State Transition Contract
Freeze current state, previous state, direction of change, persistence and transition semantics.

#### P6-04B — Acceleration / Deceleration Contract
Define exactly what constitutes acceleration/deceleration for each supported metric. No implicit mathematical convention may be introduced by the Agent.

#### P6-04C — Regime Model
Freeze regime vocabulary and transition rules.

#### P6-04D — Historical Comparison
Implement comparison against persisted historical snapshots, never silently re-evaluating historical state from current live data.

#### P6-04E — Tests
Cover stable state, transitions, repeated transitions, insufficient history, stale data and deterministic replay.

#### P6-04-FINAL — Audit + Freeze
Freeze transition/regime semantics.

---

### P6-05 — Early Warning Engine

**Dependency:** P6-02-FINAL, P6-03-FINAL, P6-04-FINAL.

#### P6-05A — Warning Contract
Freeze `EarlyWarning`, severity, trigger evidence, timestamps, state and provenance.

#### P6-05B — Severity Rules
Define explicit versioned rules for `INFO`, `WATCH`, `WARNING`, `CRITICAL`. Thresholds remain configuration, not code literals.

#### P6-05C — Deduplication / Cooldown
Define stable warning identity, duplicate detection, cooldown/suppression and reactivation/state-transition behavior.

#### P6-05D — Confidence / Data Quality Qualification
Ensure warnings carry independent data-quality and confidence qualification.

#### P6-05E — Tests / Noise Control
Verify duplicate suppression, recovery, escalation, stale evidence, missing evidence and warning stability.

#### P6-05-FINAL — Audit + Freeze
Freeze early-warning semantics.

---

### P6-06 — Intelligence Aggregation & Explainability

**Dependency:** P6-05-FINAL plus all preceding intelligence freezes.

#### P6-06A — Intelligence Read Model
Define the stable user-oriented aggregate response contract.

#### P6-06B — Explainability Contract
Define `headline`, `why`, `evidence`, `whatChanged`, `whatToWatch`, confidence and data-quality language.

#### P6-06C — Provenance Assembly
Implement the complete trace from observation through derived metric, algorithm/version, intelligence result and presentation model.

#### P6-06D — Semantic Safety Scan
Verify that no presentation text or aggregate label introduces BUY/SELL/LONG/SHORT/ORDER/EXECUTE semantics.

#### P6-06E — Tests
Contract, provenance, degradation, explainability and deterministic output tests.

#### P6-06-FINAL — Audit + Freeze
Freeze the intelligence aggregation/presentation contract.

---

### P6-07 — UI / Dashboard

**Dependency:** P6-06-FINAL.

#### P6-07A — UI Recon + Route Mapping
Map current dashboard/narrative/coin routes and identify exact integration points.

#### P6-07B — Narrative Dashboard
Implement health, trend, warning, confidence/data quality, improving/weakening coins and recent changes.

#### P6-07C — Narrative Detail
Implement the approved hierarchy: headline → change → why → trend/regime → participation → warnings → evidence → history → collapsed technical provenance.

#### P6-07D — Coin Detail
Implement coin health, narrative-relative strength, trend, contribution, warnings, recent change and confidence/data quality.

#### P6-07E — Historical View
Integrate historical snapshots without live recomputation.

#### P6-07F — UI Contract / Semantic Scan
Verify forbidden execution language is absent and presentation does not introduce business rules.

#### P6-07G — Tests
UI contract, rendering, empty/degraded states and regression.

#### P6-07-FINAL — UI Audit
UI is accepted only when a user can understand the state/change/reason/evidence path without relying on technical internals.

---

### P6-08 — Historical Intelligence & Backfill

**Dependency:** P6-06-FINAL; UI may consume the contract after the historical contract is stable.

#### P6-08A — Historical Snapshot Contract
Freeze historical lookup semantics and version tuple behavior.

#### P6-08B — Historical Comparison
Implement deterministic comparison across persisted snapshots.

#### P6-08C — Backfill Policy
Define controlled backfill rules, source gaps, missing-data treatment and version semantics.

#### P6-08D — Reproducibility Verification
Verify historical results can be reconstructed from stored inputs + algorithm/configuration versions.

#### P6-08E — Tests / Data Integrity
Cover missing periods, source changes, algorithm changes and repeated backfill.

#### P6-08-FINAL — Audit + Freeze
Freeze historical/backfill semantics.

---

### P6-09 — System Verification & Product Value Audit

**Dependency:** P6-07-FINAL and P6-08-FINAL.

Verification tracks:

1. contract integrity;
2. data-source/provenance completeness;
3. observation normalization;
4. health dimension correctness;
5. coin participation correctness;
6. trend/regime transitions;
7. early-warning quality and noise;
8. confidence/data-quality independence;
9. historical reproducibility;
10. UI comprehension;
11. semantic boundary scan;
12. P4/P5 regression;
13. typecheck/build/test suite;
14. source/documentation consistency;
15. product-value audit.

P6-09 produces a blocking/non-blocking issue register. Blocking semantic issues require owner decision before closure.

---

### P6-FINAL — Product / Architecture Closure

Required outputs:

- `P6_BASELINE.md`;
- P6 capability catalog;
- P6 open-items register;
- P6 handoff document;
- final architecture/invariant audit;
- version tuple and migration notes;
- evidence of regression against frozen P4/P5 baseline.

P6 is frozen only when every required gate passes and all remaining issues are explicitly classified.

---

## 7. Cross-Phase Invariants

These invariants apply to every P6 task:

### I1 — Measurement, not execution
P6 may measure, classify, detect and warn. It does not execute trades.

### I2 — Frozen P4/P5 semantics
P6 does not redefine P4 or P5 meanings.

### I3 — Explainability
Every material intelligence output has a reason/evidence path.

### I4 — Decomposability
Composite health remains decomposable into dimensions.

### I5 — Change awareness
Trend intelligence preserves transitions, not only current state.

### I6 — Data quality independence
Health state and data quality are separate dimensions.

### I7 — Historical integrity
Historical outputs use historical inputs/snapshots and versioned semantics.

### I8 — Determinism
Same frozen inputs + same algorithm/configuration = same result.

### I9 — Provenance
Derived outputs trace to source observations.

### I10 — Graceful degradation
Insufficient/degraded evidence never silently becomes normal/healthy intelligence.

### I11 — Versioned semantics
Algorithms, thresholds and schemas are independently versioned.

### I12 — Presentation purity
Presentation transforms intelligence; it does not invent business rules.

### I13 — No hidden trading semantics
P6 vocabulary and UI must remain observational/monitoring-oriented.

### I14 — Agent execution boundary
Agent cannot resolve semantic ambiguity without explicit planner/owner decision.

---

## 8. Standard Acceptance Gate for Every Executable Task

A task can be marked PASS only if:

- [ ] recon is complete;
- [ ] affected files are identified;
- [ ] approved contract is followed;
- [ ] no unapproved semantic change exists;
- [ ] targeted tests pass;
- [ ] relevant regression passes;
- [ ] typecheck/build requirements pass where applicable;
- [ ] provenance is preserved;
- [ ] data-quality behavior is explicit;
- [ ] versioning requirements are implemented;
- [ ] documentation matches implementation;
- [ ] forbidden trading semantics scan passes;
- [ ] Agent report identifies all provisional/open items;
- [ ] Git boundary is clean and limited to the task scope.

A task is **FROZEN** only after planner audit, not merely after Agent implementation.

---

## 9. Blocking vs Non-Blocking Classification

### Blocking

Stop the roadmap and request owner decision when an Agent discovers:

- ambiguous metric semantics that materially change product meaning;
- missing data required for a required capability with no approved fallback;
- conflict with P4/P5 frozen semantics;
- incompatible schema/API contract requiring cross-phase change;
- inability to preserve historical integrity;
- inability to provide provenance/determinism;
- threshold choice that materially changes product behavior and is not already approved;
- requirement for a new external service/data source not in the approved scope.

### Non-blocking

Planner may resolve without owner escalation when the issue is:

- implementation detail with unchanged semantics;
- refactoring;
- test strengthening;
- documentation correction;
- minor UI arrangement within the frozen UI contract;
- performance improvement with identical outputs;
- internal naming cleanup.

---

## 10. Git Boundary

Default rule:

- one executable task → one Agent work boundary;
- no unrelated refactoring;
- no silent edits outside task scope;
- task documentation is part of the task only when explicitly included in the prompt;
- freeze documents are produced at freeze gates;
- downstream tasks must branch from the audited state of the preceding task.

The planner may intentionally group documentation-only changes when they are logically atomic, but implementation tasks should remain independently auditable.

---

## 11. Agent Prompt Standard

Every Agent prompt issued by the planner will contain:

1. task ID and objective;
2. authoritative source documents;
3. mandatory recon steps;
4. exact scope;
5. explicit non-scope;
6. files to inspect/create/modify;
7. data model/API/algorithm contract;
8. invariants;
9. acceptance criteria;
10. test cases;
11. source/semantic scans;
12. regression requirements;
13. Git boundary;
14. required report format;
15. explicit instruction to STOP and REPORT semantic ambiguity.

The Agent is not expected to design the solution from the prompt. The prompt is the implementation contract.

---

## 12. Freeze Protocol

For each component:

```text
IMPLEMENTED
   ↓
TARGETED TEST PASS
   ↓
REGRESSION PASS
   ↓
SOURCE / SEMANTIC AUDIT
   ↓
DOCUMENTATION CONSISTENCY
   ↓
PLANNER ACCEPTANCE
   ↓
FROZEN
```

A component that is implemented but not audited remains **IMPLEMENTED / NOT FROZEN**.

---

## 13. Execution Order

The default execution order is:

1. P6-01A → P6-01-FINAL
2. P6-02A → P6-02-FINAL
3. P6-03A → P6-03-FINAL
4. P6-04A → P6-04-FINAL
5. P6-05A → P6-05-FINAL
6. P6-06A → P6-06-FINAL
7. P6-07A → P6-07-FINAL
8. P6-08A → P6-08-FINAL
9. P6-09
10. P6-FINAL

After P6-01 freezes, P6-02 and P6-03 may be parallelized if their contracts do not conflict. P6-04 remains dependent on the finalized health/participation semantics. Parallel execution is an optimization, not a requirement; semantic audit order remains deterministic.

---

## 14. First Execution Task

**Next task to issue:** `P6-01A — Current Data Landscape Recon`.

The Agent must not implement P6-01 during this task. The sole objective is to establish implementation truth and identify the exact data/source/schema/provenance landscape needed for the planner to design P6-01B–F.

P6-01A is therefore a reconnaissance and architecture-input task, not a coding task.

---

## 15. Master Plan Status

**P6 execution map:** READY  
**P4-P5 dependency:** VERIFIED  
**P6 master specification:** PRESENT  
**P6 implementation:** NOT STARTED  
**Current next task:** P6-01A  
**Owner escalation required now:** NO
