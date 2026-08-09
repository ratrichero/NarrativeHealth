# P3 Architecture Decisions

## Status

**APPROVED**

This document freezes the architecture and implementation boundary for P3 — Narrative Intelligence & Rotation as of **2026-08-09**. It authorizes no implementation beyond the next reviewed task, P3-01 — P3 Data Contract.

## Scope

This document defines the authoritative execution path, FastAPI boundary, Momentum and versioning strategy, Data Contract prerequisite, immutable history, BTC benchmark, timezone invariants, responsibilities, risks, and implementation boundary. It does not implement business logic, schema, migrations, APIs, UI, scheduler changes, provider changes, or bug fixes.

## Source Documents

- Master Specification: `docs/P3_Upgrade/p3.md`.
- Baseline: `docs/P3_Upgrade/P3_BASELINE.md`.
- Execution Plan: `docs/P3_Upgrade/p3_Execution_Plan.md`.

The requested `docs/P3_Upgrade/P3_MASTER_SPECIFICATION.md` does not exist. The repository's existing `docs/P3_Upgrade/p3.md` is the Master Specification used here. The mismatch is an Open Issue; no source document was renamed or modified.

## Approved Decisions

### AD-001 Authoritative Execution Path

Next.js is the sole authoritative P3 execution path.

```text
Scheduler
    ↓
Next.js Refresh
    ↓
Existing P0-P2 pipeline
    ↓
P3 Intelligence
    ↓
Versioned Immutable Persistence
```

The integration point is `src/app/api/refresh/route.ts`. P3 runs after Narrative Health inputs are available and before refresh completion. APIs and dashboards read persisted intelligence; they do not call market providers or perform authoritative P3 calculations.

### AD-002 FastAPI Boundary

FastAPI remains fallback/orchestration and legacy compatibility only.

Evidence: `backend/scheduler.py` calls Next.js `/api/refresh` first and FastAPI `/api/refresh` after primary failure; `backend/api/refresh.py` contains a parallel legacy P0-P2 implementation.

P3 boundary:

- no P3 engine, scoring, Regime, Rotation, or persistence in `backend/`;
- no independent FastAPI P3 result production;
- any FastAPI-triggered P3 refresh ultimately reaches Next.js.

The degraded behavior when FastAPI completes P0-P2 but Next.js/P3 is unavailable must be decided before scheduler integration. No scheduler behavior changes in this task.

### AD-003 Momentum Strategy

Extend the existing Momentum system; do not create a second system.

Existing components:

- `src/lib/services/momentum.service.ts`;
- `narrative_momentum` in `src/db/schema.ts`;
- `src/lib/types/narrative-momentum.ts`;
- `src/app/api/narratives/[id]/momentum/route.ts`.

Current behavior:

- reads up to seven `narrative_health` observations;
- returns score `0` and `stable` with fewer than three observations;
- computes health change and scales it as `change × 10`, clamped to `[-100, 100]`;
- estimates acceleration from the slope difference between two history halves;
- upserts by `(narrative_id, date)`;
- exposes persisted history through the existing API.

P3 requires explicit period semantics, at least seven daily observations for complete 7D Momentum, `null`/`INSUFFICIENT_HISTORY` instead of zero, separate Momentum and Acceleration values, UTC boundaries, immutable versioned persistence, and compatibility for current consumers.

Reuse the service boundary and valid historical reads. Extend formulas, result types, version identity, persistence behavior, and compatibility projections. Current `momentumType` and zero-on-missing behavior may be deprecated after a reviewed transition. No refactor occurs in this task.

### AD-004 Rule/Version Strategy

Reuse existing infrastructure:

- `feature_versions` and `features.version_id`;
- `score_configs`;
- `rule_versions`;
- `recommendation_rules`;
- `src/lib/services/rule-version.service.ts`;
- `src/lib/services/rule-engine.service.ts`;
- active-version selection and recording in `src/app/api/refresh/route.ts`.

P3 thresholds and weights remain configurable and are never hard-coded in UI. P3 creates no parallel generic version framework.

Minimum extension likely required: an immutable P3 algorithm/config identity, exact references to relevant feature/rule versions, a stable P3 config fingerprint or immutable reference, and latest/activation metadata separate from historical result identity. Exact schema is deferred.

### AD-005 Data Contract Strategy

P3-01 must approve a Data Contract before schema or engines. Each input must define source, meaning, unit, range, timestamp, history, missing/invalid behavior, fallback, confidence effect, weighting effect, and persistence eligibility.

```text
missing ≠ 0
unavailable ≠ bearish
```

Never fabricate financial values. Fallbacks must be explicit, explainable, and observable in provenance. Insufficient history must differ from neutral values. P3 engines and read APIs do not call external providers.

### AD-006 Historical Immutability

A persisted P3 result is immutable for its calculation/version identity. A new algorithm or configuration creates a new result; the old result remains.

Architectural requirements:

1. Calculation identity includes entity, UTC observation/window boundary, scope, immutable algorithm/config identity, calculation time, and traceable inputs.
2. Algorithm identity includes a P3 engine version plus exact rule/config references or fingerprint and relevant upstream versions.
3. Recalculation inserts a separate result and never overwrites the prior version.
4. APIs select an explicit version or the latest approved compatible version; they do not use an unqualified maximum row ID.
5. Reproducibility requires version references, UTC source boundaries, fallback/provenance flags, and calculation timestamp.
6. Reuse `feature_versions`, `rule_versions`, and versioned `score_configs`; add only the minimum P3 calculation-version identity.

Current date-keyed upserts, including `narrative_momentum`, are insufficient for immutable P3 history.

### AD-007 Relative Strength Benchmark

BTC is the sole official benchmark.

```text
Narrative Return - BTC Return = Relative Strength
```

Reuse `coins`, `market_price_daily`, and existing Binance/CoinGecko collectors. Do not create a separate BTC ingestion pipeline.

The default seed in `src/app/api/admin/seed/route.ts` does not include BTC. P3 therefore depends on a configured active BTC record with sufficient price history. Missing BTC history means unavailable RS / insufficient benchmark history, not zero return or another benchmark.

### AD-008 Timezone Boundary

```text
Scheduler timezone: Asia/Ho_Chi_Minh
Data timezone:      UTC
```

`Asia/Ho_Chi_Minh` is only for scheduler trigger configuration and human schedule semantics. UTC governs market, scan, collection, calculation, persistence, API, feature, Momentum, Relative Strength, and all P3 intelligence timestamps.

P3 must not convert persisted market data to scheduler-local time, derive P3 windows from scheduler time, or define P3 `BUSINESS_DATE = Asia/Ho_Chi_Minh`. Any future reporting-date concept must remain separate from UTC data identity.

## Current Architecture

```text
Asia/Ho_Chi_Minh Scheduler (`backend/scheduler.py`)
        ↓ primary
Next.js Refresh (`src/app/api/refresh/route.ts`)
        ↓
P0-P2 collection, features, health, recommendations
        ↓
Narrative Health
        ↓
Daily persistence / snapshots
        ↓
Existing APIs / dashboard

Primary failure → FastAPI legacy P0-P2 refresh
```

Next.js refresh provides a `scheduler_logs` lock, 15-minute stale-lock handling, active feature/rule/config selection, upserts, aggregation, and snapshots. The scheduler has one primary request and one fallback path; no general retry/backoff loop was found. The full Next.js refresh does not visibly invoke `MomentumService.saveMomentum`, leaving current Momentum lifecycle unclear.

## P3 Target Architecture

```text
Asia/Ho_Chi_Minh Scheduler Trigger
        ↓
Next.js Refresh — authoritative
        ↓
P0-P2 using UTC data semantics
        ↓
Coin Health / Narrative Health
        ↓
P3 Intelligence
        ├── Breadth / Strong Breadth
        ├── Extended Momentum / Acceleration
        ├── BTC Relative Strength
        ├── Leadership / Persistence
        ├── Concentration / Quality
        ├── Narrative Regime
        └── Rotation
        ↓
Versioned Immutable Persistence
        ↓
Read APIs
        ↓
Decision Dashboard
```

FastAPI may trigger/report orchestration but owns no P3 calculation or persistence.

## Component Responsibilities

| Component | Responsibility |
|---|---|
| `backend/scheduler.py` | Trigger refresh in `Asia/Ho_Chi_Minh`; never define the data day. |
| `src/app/api/refresh/route.ts` | Authoritative lock, P0-P2 execution, P3 invocation, completion status. |
| Existing collectors | Collect source data and preserve UTC/source timestamp semantics. |
| Feature engine | Produce versioned Coin features only. |
| Health pipeline | Produce Coin Health and Narrative Health inputs. |
| Extended `MomentumService` | Own P3 Momentum/Acceleration and compatibility projection. |
| P3 orchestration | Compose deterministic engines without external API calls. |
| Existing version/config services | Resolve exact approved versions/configuration. |
| P3 persistence | Append immutable results with provenance. |
| P3 APIs | Read persisted data and select explicit/current approved versions. |
| Dashboard | Render persisted results; never calculate authoritative P3 metrics. |
| FastAPI | Legacy fallback/orchestration only; no P3 engine. |

## Data Flow

```text
Existing providers → collectors → UTC observations → versioned features
→ Coin Health → Narrative Health → Data Contract validation
→ P3 components → immutable versioned persistence → API → dashboard
```

Missing or invalid inputs become explicit unavailable, insufficient-history, fallback, and confidence states. They do not become zero unless zero is a valid observation under the approved contract.

## Historical Data Flow

P3 uses persisted history where semantically valid:

- `market_price_daily` for price/volume and BTC return;
- `coin_metrics` for market cap/OI after semantic validation;
- `health_scores` and `narrative_health` for health history;
- normalized `morning_snapshot_*` tables when compatible;
- legacy `narrative_momentum` only under compatibility rules;
- `coin_narratives` for current membership.

P3 windows use explicit UTC boundaries and sufficient-history checks. APIs read persisted P3 history rather than recalculating from current state.

Narrative membership has no effective-date history. Reproducible historical breadth/leadership requires either effective-dated membership or the exact membership set captured in calculation provenance.

## Versioning Flow

```text
Feature Version + Rule Version + P3 Config/Fingerprint + P3 Algorithm Version
        ↓
Immutable calculation identity
        ↓
P3 calculation
        ↓
Append-only result with exact references
```

Activation determines new calculations; it never mutates old results. APIs support explicit version reads and a defined current-approved projection.

## Timestamp / Timezone Rules

### Timestamp and Timezone Invariants

```text
Scheduler timezone:
Asia/Ho_Chi_Minh

Data timezone:
UTC
```

| File / component | Current observation | Classification | P3 rule |
|---|---|---|---|
| `backend/scheduler.py` | APScheduler/cron use `Asia/Ho_Chi_Minh`; scheduler logs start with timezone-aware Vietnam datetimes. | `CORRECT` for triggering; `POTENTIAL ISSUE` for persisted operational time | Keep local zone only for trigger configuration; normalize persisted/API times to UTC per P3-01. |
| `backend/config.py` | Scheduler hour/minute are Vietnam time. | `CORRECT` | Scheduler configuration only. |
| `backend/api/refresh.py` | Uses `datetime.utcnow()` and exchange timestamp-derived dates. | `CORRECT` direction | Require unambiguous timezone-aware UTC persistence. |
| `src/lib/collectors/binance.ts` | Preserves exchange epoch timestamps for klines/OI history. | `CORRECT` | Convert and compare in UTC. |
| `src/app/api/refresh/route.ts` | Uses `getBusinessDate()` and converts kline dates through `Asia/Ho_Chi_Minh`. | `CONFLICT` | P3 inputs/windows and persistence identity use UTC. |
| `src/app/api/refresh/coin/[id]/route.ts` | Converts UTC kline timestamps to business-timezone dates. | `CONFLICT` | Do not carry this convention into P3. |
| `src/lib/utils.ts` | Declares `Asia/Ho_Chi_Minh` for all business dates and deprecates UTC helper. | `CONFLICT` | Scheduler-local helpers cannot govern P3 data. |
| `src/db/schema.ts` timestamps | Most `timestamp()` columns do not explicitly state timezone semantics. | `POTENTIAL ISSUE` | P3 schema must persist and serialize unambiguous UTC. |
| `src/db/schema.ts` daily `date` columns | Dates contain no timezone. | `POTENTIAL ISSUE` | P3-01 defines the UTC boundary producing each date/window. |
| Snapshot timezone (`src/db/schema.ts`, `snapshot.service.ts`) | Stores/defaults `Asia/Ho_Chi_Minh`. | `CONFLICT` for P3 data; legacy reporting metadata only | Never use as P3 observation/calculation timezone. |
| Narrative/health timeline routes | Commonly use `toISOString()` UTC date boundaries. | `CORRECT` direction | Standardize exact cutoff semantics in P3-01. |
| `src/lib/services/health-timeline.service.ts` | Date arithmetic plus UTC ISO serialization. | `POTENTIAL ISSUE` | Define inclusive/exclusive UTC window rules. |
| API `toISOString()` serialization | Emits UTC ISO timestamps. | `CORRECT` | P3 API timestamps use ISO 8601 UTC (`Z`). |
| Technical-analysis regime | Coin/timeframe concept unrelated to scheduler timezone. | `NOT APPLICABLE` | Keep separate from Narrative Regime. |

No timezone code is changed by P3-00.5. All conflicts are mandatory inputs to P3-01.

## P3 Data Contract Requirements

This is an architecture-level inventory, not the final P3-01 contract. P3-01 must finalize ranges, freshness, cutoffs, status enums, and confidence effects.

| Data | Actual repository source | Meaning / unit | Timestamp | Missing / invalid | Fallback and effects | Persist? |
|---|---|---|---|---|---|---|
| Coin Health | `health_scores`; `src/lib/features/engine.ts` | Deterministic `0..100` score | UTC observation/calculation boundary required | Missing remains unavailable; reject non-finite/out-of-range | No zero fabrication; coverage/confidence impact per approved metric | Reuse source; reference/snapshot in P3 provenance |
| Narrative Health | `narrative_health`; `src/lib/scoring/narrative-health.ts` | Aggregate `0..100` score | UTC boundary required | Missing/invalid makes dependent metric unavailable or partial | No bearish substitution; confidence impact | Reuse and reference |
| Market Cap | `coin_metrics.market_cap`; CoinGecko collector | USD market capitalization, valid when `> 0` | Source observation/collection UTC | Missing is `null`; reject non-finite, `<= 0`, stale, or fabricated values | Existing equal-weight fallback; affects weighting and confidence/provenance | Existing source plus fallback provenance |
| Volume | `market_price_daily.volume`, `quote_volume`, `volume_24h` | Base or quote/USD volume; fields cannot be mixed | Exchange candle UTC | Missing coverage is unavailable; reject negative/non-finite/unit mismatch | No invention; dependent metric partial/unavailable and confidence reduced | Existing source; reference exact field/unit |
| Open Interest | `coin_metrics.open_interest`; Binance Futures | Provider quantity; USD must not be assumed without normalization | Source observation UTC | `null` for unavailable/no-futures; reject negative/non-finite/stale | Unavailable is not bearish; reduce availability/confidence, not zero | Existing if valid, with provenance |
| BTC benchmark return | BTC `coins` record + `market_price_daily` | BTC close and derived return `%` | Same UTC window as narrative return | Missing history → `INSUFFICIENT_BENCHMARK_HISTORY`; reject invalid close/window mismatch | No zero return and no alternate benchmark | Persist source normally and benchmark return/provenance in P3 result |
| Narrative membership | `coin_narratives`, active coin/narrative flags | Active member set; `isPrimary` exists | Current state only | Historical membership unknown; reject orphan/invalid mapping | Do not infer historical set silently | Persist exact membership/provenance or add future effective history |
| Historical snapshots | normalized `morning_snapshot_*`; legacy `morning_snapshots` | Daily captured score summaries | Existing local metadata; P3 requires UTC boundary | Missing remains missing; reject inconsistent/incompatible versions | Other daily facts only when contract permits; no fabrication | Existing; P3 history stored separately/versioned |
| Momentum history | `narrative_health`; legacy `narrative_momentum` | Health changes/slopes; P3 periods TBD in P3-01 | UTC windows required | Missing → `null` + `INSUFFICIENT_HISTORY`; reject unordered/duplicate/incompatible windows | No zero/stable fallback; confidence/history coverage impact | Immutable P3 Momentum/Acceleration later |
| Coin price return | `market_price_daily.close` | Return `%` over exact window | UTC candle boundaries | Missing/invalid close/window means unavailable | No fabrication; aggregation policy defined in P3-01 | Source exists; derived return/provenance may persist |
| Rule/config identity | `rule_versions`, `score_configs`, `feature_versions` | Immutable calculation configuration | UTC activation/calculation timestamps | Missing required version blocks calculation; reject ambiguous/incomplete config | Fail rather than silently default unless contract approves | Persist exact references/fingerprint |

Critical conflict: `src/app/api/refresh/route.ts` currently contains market-cap fallback expressions based on volume/price or quote-volume multiplication. The Master Specification prohibits this. P3 must reject these as valid market cap. This task documents but does not fix the issue.

## Existing Components To Reuse

### Component Reuse Matrix

| Component | Current State | P3 Action | New Component? |
|---|---|---|---|
| Next.js refresh | Existing authoritative orchestrator with lock/logging | Integrate P3 after Narrative Health | No replacement |
| FastAPI scheduler | Existing trigger/fallback | Keep trigger role; prohibit P3 engine | No P3 component |
| FastAPI refresh | Legacy parallel P0-P2 fallback | Do not extend with P3; define degraded behavior | No P3 component |
| Feature engine | Existing versioned Coin features | Reuse upstream input | No |
| Coin Health | Existing daily/version-referenced score | Reuse input | No |
| Narrative Health | Existing aggregate | Reuse after contract validation | No |
| `MomentumService` | Existing service/API boundary | Refactor and extend | No second service |
| `narrative_momentum` | Legacy persistence | Compatibility/schema decision; no silent redefinition | TBD extension, not parallel engine |
| Rule version service | Existing active-version management | Reuse | No |
| Rule engine | Existing deterministic version-scoped rules | Reuse/extend config fields | No parallel engine |
| `score_configs` | Existing versioned configs | Extend approved P3 config types or bind immutable snapshot | No parallel system |
| Market collectors | Existing Binance/CoinGecko | Reuse; no P3 external calls | No |
| `market_price_daily` | Existing OHLCV history | Reuse for returns/BTC | No replacement |
| `coin_metrics` | Existing OI/market-cap history | Reuse only after semantic validation | No replacement |
| Health/snapshot history | Existing daily persistence | Reuse inputs; add immutable P3 history later | P3 persistence later |
| Existing narrative APIs | Health/timeline/momentum/correlation | Preserve compatibility; later project persisted P3 data | New read contract later |
| Existing dashboard | Health-oriented UI | Later consume persisted P3 APIs | New UI components later |

## Components To Extend

- `src/app/api/refresh/route.ts`: one authoritative P3 orchestration stage after Narrative Health.
- `src/lib/services/momentum.service.ts`: approved P3 Momentum/Acceleration with compatibility.
- existing version/config infrastructure: immutable P3 algorithm/config identity.
- historical persistence: append-only P3 results and provenance.
- BTC coverage in existing market infrastructure: configured BTC history without new ingestion.
- membership semantics: effective history or captured calculation membership.
- API version selection: explicit version and current-approved projections.

## Components NOT To Create

- FastAPI P3 engine or persistence;
- second Momentum service/formula path;
- parallel P3 rule/version framework;
- separate BTC ingestion pipeline;
- dashboard-time authoritative calculation;
- P3/read-API external provider calls;
- mutable date-only P3 history;
- scheduler-local P3 data semantics;
- fabricated market cap, returns, OI, volume, health, or history.

## Required Changes For P3

Future tasks must:

1. approve P3-01 Data Contract, including UTC windows, units, freshness, missing/invalid/fallback/confidence behavior;
2. exclude invalid market-cap semantics from P3 inputs;
3. define BTC configuration and minimum historical coverage;
4. define historical membership or membership snapshots;
5. define immutable P3 algorithm/config identity integrated with existing versions;
6. design append-only persistence and latest-version query semantics;
7. extend `MomentumService` with deliberate legacy compatibility;
8. integrate P3 only into Next.js refresh;
9. define scheduler degraded behavior when P3 cannot execute;
10. add deterministic tests in later implementation tasks.

## Risks / Conflicts

1. **Timezone leakage:** Next.js business-date helpers and refresh paths use `Asia/Ho_Chi_Minh` for persisted daily semantics, conflicting with AD-008.
2. **Fabricated market cap:** refresh contains volume/price-based fallbacks prohibited by the Master Specification.
3. **Mutable upserts:** existing date-keyed Momentum/score writes do not support immutable algorithm-version history.
4. **Momentum collision:** current score/type and missing-history behavior conflict with P3.
5. **FastAPI divergence:** fallback may report P0-P2 success while no P3 result exists.
6. **BTC availability:** BTC is absent from default seed; RS needs explicit configuration and coverage checks.
7. **Membership reproducibility:** `coin_narratives` has no effective-date history.
8. **Timestamp ambiguity:** timestamp columns do not consistently make UTC semantics explicit; date fields require UTC cutoffs.
9. **Version insufficiency:** `rule_version_id` alone may not identify all P3 algorithms, configs, upstream versions, and fallbacks.
10. **Momentum lifecycle:** the full Next.js refresh does not visibly call `MomentumService.saveMomentum`.
11. **Parallel schemas:** `src/db/schema.ts` and `drizzle/schema.ts` must remain synchronized in future schema work.
12. **Legacy compatibility:** Momentum contract changes can break route/UI consumers without a compatibility projection.

## Open Issues

1. Confirm `docs/P3_Upgrade/p3.md` as the permanent canonical Master filename or add the requested alias later.
2. Define exact UTC daily boundaries and inclusive/exclusive 1D/3D/7D/14D windows.
3. Decide whether P3 observation identity uses a UTC instant, UTC date, window-end timestamp, or combination.
4. Define BTC identity, source precedence, and minimum valid history.
5. Choose effective-dated membership versus captured membership per calculation.
6. Define legacy `narrative_momentum` and API transition behavior.
7. Define scheduler status when FastAPI P0-P2 succeeds but authoritative P3 does not run.
8. Define the minimum P3 algorithm-version artifact binding feature, rule, and config versions.
9. Define freshness/source precedence for market cap, volume, and OI.
10. Decide whether local-time snapshots remain legacy reporting artifacts or later gain a separate explicit reporting-date concept.

These issues authorize no implementation in P3-00.5.

## Implementation Boundary

### Allowed after review

Only **P3-01 — P3 Data Contract** may proceed next. It may specify semantics and acceptance criteria, but implementation or migrations require separate authorization.

### Prohibited in P3-00.5

- P3 scoring/business logic;
- Breadth, Momentum, Acceleration, Relative Strength, Leadership, Concentration, Regime, or Rotation implementation;
- schema/migration changes;
- API/dashboard behavior changes;
- scheduler/provider changes;
- Momentum refactor;
- production bug fixes;
- modifications to the Master Specification or baseline.

### Frozen principles

- Next.js owns P3 execution.
- FastAPI owns no P3 logic.
- existing Momentum is extended, not duplicated.
- existing version architecture is reused.
- Data Contract precedes schema and engines.
- BTC is the only RS benchmark.
- P3 history is append-only and reproducible.
- scheduler timezone is `Asia/Ho_Chi_Minh`; data semantics are UTC.
- missing data remains missing and never implies bearishness.

## Next Tasks

1. **P3-01 — P3 Data Contract**
   - finalize every input and derived-window contract;
   - resolve UTC boundaries and timestamp semantics;
   - define missing, invalid, fallback, weighting, and confidence behavior;
   - define BTC and membership-history requirements;
   - define immutable calculation/version identity requirements passed to schema design.
2. Review and accept P3-01 before schema/migration work.
3. Do not start P3 business logic until the approved dependency order permits it.

## Definition of Done Record

- [x] Existing Master Specification read from `docs/P3_Upgrade/p3.md`.
- [x] `docs/P3_Upgrade/P3_BASELINE.md` read.
- [x] Repository implementation inspected.
- [x] Next.js authoritative path confirmed.
- [x] FastAPI P3 boundary confirmed.
- [x] Existing Momentum strategy documented.
- [x] Existing rule/version infrastructure documented.
- [x] P3 Data Contract requirements documented.
- [x] Historical immutability and algorithm versioning documented.
- [x] BTC benchmark documented.
- [x] Scheduler timezone documented as `Asia/Ho_Chi_Minh`.
- [x] Data timezone documented as UTC.
- [x] Scheduler timezone prohibited from P3 data semantics.
- [x] Current and target architecture documented.
- [x] Reuse/extend/new-component matrix documented.
- [x] Timestamp audit completed.
- [x] Risks and open issues documented.
- [x] No business logic implemented.
- [x] No schema/migration created.
- [x] No production behavior changed.
- [x] Architecture decision document created.
