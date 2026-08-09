# P3 Repository Baseline

**Project:** NarrativeHealth / MorningDashboard  
**Audit task:** P3-00 Repository Baseline Audit  
**Audit date:** 2026-08-09  
**Repository state:** `main` at `5ff75ce` (`Fix các chức năng Add Rule, Add Rule Version, Event.. trong Admin`)  
**Working tree:** clean application tree; untracked `docs/P3_Upgrade/` contains the P3 planning documents supplied for this phase.

## 1. Audit Scope and Method

This baseline follows the P3 Execution Plan P3-00 checklist. The audit inspected the repository implementation, database schema and migrations, refresh/scheduler paths, feature and scoring code, API routes, dashboard pages/components, historical persistence, versioning, README/MdSpec, and existing tests. No application code was modified as part of P3-00; this document is the only intended deliverable.

The repository contains two server implementations:

- **Primary:** Next.js 16 + TypeScript API routes and React dashboard under `src/`.
- **Legacy/backup:** FastAPI + SQLAlchemy implementation under `backend/`. `backend/scheduler.py` explicitly calls the Next.js refresh first and falls back to FastAPI, so the two implementations are an integration and semantic-conflict risk for P3.

## 2. Current Architecture

```text
External market sources
  ├─ Binance Spot / Futures
  └─ CoinGecko
        ↓
Next.js API refresh (`src/app/api/refresh/route.ts`)
        ↓
Market prices + coin metrics + source status
        ↓
Feature engine (`src/lib/features/`)
        ↓
Coin features + health scores + recommendations
        ↓
Narrative health aggregation (`src/lib/scoring/narrative-health.ts`)
        ↓
Narrative momentum service + daily snapshots
        ↓
Next.js API routes and React pages/components
```

The FastAPI path mirrors much of the collection/feature/health flow in `backend/api/refresh.py`, with models and schemas under `backend/models/` and `backend/schemas/`. The documented architecture in `README.md` and `MdSpec.md` describes Next.js as primary and FastAPI as backup, which matches the scheduler implementation.

Main application surfaces:

- Pages: `src/app/page.tsx`, `src/app/narrative/[id]/page.tsx`, `src/app/coin/[id]/page.tsx`, `src/app/snapshots/page.tsx`, `src/app/watchlist/page.tsx`, `src/app/admin/page.tsx`.
- Shared UI: `src/components/` including narrative cards, coin ranking, score breakdown, health timeline, correlation heatmap, indicators, signals, and refresh controls.
- Database access: `src/db/index.ts`, `src/db/schema.ts`, and `drizzle/` migrations/relations.
- Technical analysis is a separate existing subsystem under `src/lib/technical-analysis/`; its market-regime output is coin/timeframe technical analysis, not P3 narrative regime.

## 3. Current Scoring Pipeline

### 3.1 Coin pipeline

1. Refresh loads active coins from `coins`.
2. Binance Spot/Futures and CoinGecko data are fetched by `src/lib/collectors/binance.ts` and `src/lib/collectors/coingecko.ts`.
3. Daily market prices and coin metrics are upserted into `market_price_daily` and `coin_metrics`; source health is recorded in `source_status`.
4. Indicators are calculated/persisted through `src/lib/services/indicator.service.ts`.
5. `runFeatureEngine` in `src/lib/features/engine.ts` calculates Trend, Derivative, Volume, Momentum, confidence, data completeness, and missing-source provenance.
6. `calculateHealthScore` uses the DB-configurable default weights Trend 35%, Derivative 35%, Volume 20%, Momentum 10%.
7. Health scores and recommendations are upserted per coin/day. Recommendation text is deterministic and generated from component scores.
8. The active rule version is loaded through `src/lib/services/rule-version.service.ts`; rule evaluation is handled by `src/lib/services/rule-engine.service.ts`.

Feature modules:

- Trend: `src/lib/features/trend.ts`.
- Derivative: `src/lib/features/derivative.ts`.
- Volume: `src/lib/features/volume.ts`.
- Momentum: `src/lib/features/momentum.ts`.
- Confidence: `src/lib/features/confidence.ts`.
- Shared calculations: `src/lib/features/calculator.ts`.
- Orchestration and health score: `src/lib/features/engine.ts`.

### 3.2 Narrative pipeline

`src/lib/scoring/narrative-health.ts` aggregates current coin health for each narrative. It supports market-cap weighting, equal-weight fallback when any coin lacks a valid market cap, average confidence, top coin, weakest coin, score change, status, and explainable weight details. The refresh route persists the result in `narrative_health` with an idempotent `(narrative_id, date)` upsert.

`src/lib/services/momentum.service.ts` calculates a narrative 7-point history score and a slope-difference acceleration-like classification (`accelerating`, `decelerating`, `stable`) and persists it to `narrative_momentum`. The service is exposed by `src/app/api/narratives/[id]/momentum/route.ts`.

This existing momentum is based on narrative health history only. It does not implement the P3 definition based on breadth momentum, multi-period momentum/acceleration semantics, relative strength, or a full narrative intelligence aggregate.

## 4. Current Database Schema

The authoritative TypeScript schema is `src/db/schema.ts`. The parallel generated/Drizzle schema is `drizzle/schema.ts`; migrations are in `drizzle/migrations/`.

### Core market and mapping tables

- `narratives`, `coins`, `coin_narratives`.
- `market_price_daily`: OHLCV, source, unique coin/date.
- `coin_metrics`: open interest, funding rate, market cap, FDV, supply fields, source, unique coin/date/source.
- `source_status`: source/coin health and collection metadata.

### Feature, score, and recommendation tables

- `feature_versions` and `features`: versioned per-coin/day feature values, detail JSON, confidence, completeness, missing sources, provenance.
- `health_scores`: per-coin/day health score, component values/status/change and rule/feature references.
- `recommendations`: per-coin/day signal and explainable reason.
- `narrative_health`: per-narrative/day aggregate, status, confidence, top/weakest coin, weighting method and weight details.
- `score_configs`, `rule_versions`, `recommendation_rules`: configurable/versioned scoring and recommendation logic.

### Historical and operational tables

- `morning_snapshots` (legacy JSON snapshot).
- `morning_snapshot_headers`, `morning_snapshot_coins`, `morning_snapshot_narratives` (normalized daily snapshot model).
- `indicators`: per-coin/date/timeframe/type persisted indicator values.
- `scheduler_logs`: job status, timing, processed records, errors and details.
- `coin_correlations`, `narrative_momentum`, `decision_signals`, `event_risks`, `alert_rules`, `alert_history`, `watchlists`.

Relevant migrations include `0001_add_rule_versions.sql` through `0014_add_alert_history.sql`, especially `0005_add_indicators.sql`, `0007_add_snapshot_normalized.sql`, `0011_add_narrative_momentum.sql`, and `0012_add_decision_signals.sql`.

### P3 schema gap

The P3 specification proposes persisted `narrative_intelligence` and `narrative_coin_intelligence` data, including breadth, acceleration, benchmark returns, relative strength, leadership, concentration, regime, rotation, and component explanations. No corresponding P3 tables or fields exist in `src/db/schema.ts` or the current migrations.

## 5. Current Refresh Flow

The primary refresh entry point is `POST /api/refresh` in `src/app/api/refresh/route.ts`.

- Uses business dates from `src/lib/utils.ts` and the `Asia/Ho_Chi_Minh` business timezone.
- Prevents duplicate runs using `scheduler_logs` and a 15-minute stale-lock timeout.
- Creates a `STARTED` scheduler log, loads active rule/config versions, processes active coins, and upserts collected market/metric/source data.
- Calculates indicators, features, health scores and recommendations.
- Aggregates and upserts narrative health.
- Builds normalized daily snapshots through `src/lib/services/snapshot.service.ts`.
- Updates scheduler status and error details on completion/failure.
- Uses conflict-safe writes for daily market data, metrics, features, health scores, recommendations and narrative health.

The scheduler is `backend/scheduler.py`. It runs scheduled refresh jobs, tries `http://localhost:3000/api/refresh` first, and falls back to `http://localhost:8000/api/refresh` when the primary endpoint fails. The FastAPI refresh implementation is `backend/api/refresh.py`.

### P3 integration implication

P3 intelligence should be calculated from persisted daily inputs and persisted idempotently as part of the refresh/scheduler pipeline. It should not be recomputed expensively inside dashboard requests. The dual refresh implementations must either share one authoritative P3 path or have explicitly equivalent semantics before scheduler integration.

## 6. Existing Historical Data and Persistence

Historical persistence already exists for:

- Daily OHLCV: `market_price_daily`.
- Daily source/metric records: `source_status`, `coin_metrics`.
- Versioned daily features: `features` + `feature_versions`.
- Daily coin scores/recommendations: `health_scores`, `recommendations`.
- Daily narrative health: `narrative_health`.
- Normalized daily snapshots: `morning_snapshot_headers`, `morning_snapshot_coins`, `morning_snapshot_narratives`.
- Indicators and correlation/momentum/decision history: `indicators`, `coin_correlations`, `narrative_momentum`, `decision_signals`.

Historical query examples include:

- Coin health timeline: `src/lib/services/health-timeline.service.ts` and `src/app/api/coins/[id]/health-timeline/route.ts`.
- Narrative health timeline: `src/app/api/narratives/[id]/health-timeline/route.ts`.
- Snapshot retrieval: `src/lib/services/snapshot.service.ts` and `src/app/api/snapshots/`.
- Narrative performance analytics: `src/app/api/admin/analytics/narrative-performance/route.ts`.

Snapshot creation is currently guarded by an existing-date check in `SnapshotService.createDailySnapshot`, while most daily fact tables use upserts. P3 persistence should preserve this idempotency approach and define behavior for recalculation/version changes explicitly.

## 7. Rule and Version System

- Feature algorithm versioning: `feature_versions` and `src/lib/services/rule-version.service.ts`.
- Health/recommendation configuration: `score_configs` and admin configuration routes/UI.
- Rule versions: `rule_versions`, `recommendation_rules`, rule-version APIs, and activation route under `src/app/api/admin/rule-versions/`.
- Deterministic rule evaluation: `src/lib/services/rule-engine.service.ts`.
- Refresh records the active rule version on score/snapshot-related writes.

P3 must introduce versioning for new intelligence calculations or extend the existing version model without changing historical results silently. Regime/rotation thresholds and classification rules need explicit persisted version/config ownership.

## 8. API Routes and Dashboard Architecture

### Existing API groups

- Dashboard: `src/app/api/dashboard/route.ts`, `src/app/api/health/route.ts`.
- Narratives: list/detail, health timeline, momentum, correlations under `src/app/api/narratives/`.
- Coins: list/detail/current price, health timeline, decision, long/short ratio, technical analysis under `src/app/api/coins/`.
- Refresh: full, per-coin, per-narrative, cleanup and status under `src/app/api/refresh/`.
- Snapshots: list and date-specific coin/narrative views under `src/app/api/snapshots/`.
- Indicators: current and history routes under `src/app/api/indicators/`.
- Admin: seed, configs, scheduler configs/logs, rules, events, alerts and analytics under `src/app/api/admin/`.

### Existing UI

The dashboard has market/narrative overview, narrative detail, coin detail, snapshots, watchlist and admin pages. Existing visualizations include health score breakdowns, ranking, timelines, correlations, technical analysis, indicators, alert/signal badges and refresh status.

There is no P3 narrative intelligence API, rotation board, breadth/RS/concentration/regime/rotation dashboard section, or persisted intelligence explanation view.

## 9. Existing Test Coverage

Tests currently found in the repository:

- `src/lib/scoring/__tests__/narrative-health.test.ts`: weighted/equal narrative aggregation and status boundaries.
- `src/lib/services/__tests__/rule-version.service.test.ts`: rule/version validation and retrieval behavior.
- `src/lib/services/__tests__/health-timeline.service.test.ts`: historical timeline/trend behavior.
- `src/lib/technical-analysis/__tests__/risk.test.ts`: technical-analysis risk calculations.

The repository has no dedicated tests for P3 breadth, strong breadth, narrative momentum/acceleration semantics, relative strength, leadership, leadership persistence, concentration, narrative quality, regime, rotation, P3 ranking, or P3 persistence/API integration.

## 10. P3 Component Classification

| P3 component | Status | Current evidence | Main gap/conflict |
|---|---|---|---|
| P3-01 Data integrity / market cap | `PARTIAL` | `src/db/schema.ts` (`coin_metrics.marketCap`), CoinGecko collector, narrative market-cap weighting | No P3 data-quality contract, stale/missing market-cap policy, or explicit provenance validation for intelligence inputs. |
| P3-02 P3 schema | `MISSING` | Existing core and historical tables | No persisted narrative intelligence or coin intelligence tables/fields. |
| Breadth | `MISSING` | Coin-to-narrative mapping exists in `coin_narratives` | No narrative breadth calculation, thresholds, or history. |
| Strong breadth | `MISSING` | Existing health scores can be an input | No strong-coin breadth metric or persistence. |
| Momentum | `PARTIAL` | `src/lib/services/momentum.service.ts`, `narrative_momentum`, momentum API | Existing score is health change over up to 7 points; not the complete P3 multi-period momentum model. |
| Acceleration | `PARTIAL` | Momentum service computes slope difference and labels acceleration | Not persisted/exposed as a P3 acceleration metric and does not incorporate required breadth/momentum semantics. |
| Relative strength | `MISSING` | Market prices and historical data exist | No market benchmark return or narrative-vs-market RS calculation. |
| Leadership | `MISSING` | Narrative health stores top coin by health score | No P3 leader score combining health, momentum and RS; top health coin is not equivalent to leader. |
| Leadership persistence | `MISSING` | Historical health data exists | No persistence/stability calculation for leaders. |
| Concentration | `MISSING` | Market-cap weights and coin membership exist | No HHI/top-N contribution or concentration classification. |
| Narrative quality | `MISSING` | Narrative health and confidence exist | No P3 quality composition using breadth, momentum, RS, leadership and concentration. |
| Narrative regime | `MISSING` | Technical-analysis regime exists for individual coin/timeframes | No narrative-level Emerging/Strong/Mature/Weakening/Dead classifier. |
| Narrative rotation | `MISSING` | Narrative health/momentum history exists | No rotation score/state or cross-narrative transition logic. |
| Narrative ranking upgrade | `PARTIAL` | Existing narrative health and dashboard ranking | Ranking does not include P3 breadth, RS, regime, rotation or leader fields. |
| Coin ranking upgrade | `PARTIAL` | Existing coin health ranking and feature columns | No P3 momentum/RS/leader-role labels. |
| P3 API | `MISSING` | Existing narrative, snapshot, momentum and analytics APIs | No persisted intelligence read API or P3 payload contract. |
| P3 dashboard | `MISSING` | Existing overview/detail pages and reusable charts | No decision-oriented breadth/RS/leadership/concentration/regime/rotation UI. |
| P3 scheduler integration | `PARTIAL` | `backend/scheduler.py` invokes primary refresh; refresh is idempotent | No P3 calculation/persistence stage; dual implementation fallback can diverge. |
| P3 tests | `MISSING` | Existing non-P3 unit/service tests | No P3 business-logic or integration test suites. |

## 11. Potential Conflicts and Risks

1. **Dual implementation:** Next.js and FastAPI both contain refresh/feature/health paths. P3 must select an authoritative implementation and prevent semantic drift.
2. **Existing momentum name collision:** `narrative_momentum` and `MomentumService` already exist, but their current definition is narrower than P3 momentum and acceleration. Reuse requires a migration/semantic decision, not silent reinterpretation.
3. **Technical regime collision:** `src/lib/technical-analysis/` has coin/timeframe market-regime terminology. P3 narrative regime must be separately named and scoped.
4. **Market-cap fallback semantics:** Current narrative aggregation falls back to equal weights if any coin lacks valid market cap. P3 requires explicit data-integrity and fallback policy; this may affect concentration and leadership calculations.
5. **Historical immutability:** Snapshot creation returns an existing snapshot for a date, while daily fact tables upsert. P3 must define recalculation behavior, version keys and whether historical intelligence is immutable.
6. **Timezone consistency:** Primary refresh uses `Asia/Ho_Chi_Minh`; `HealthTimelineService` derives dates from the runtime timezone/UTC conversion. P3 historical windows need a single business-date policy.
7. **Schema duplication:** `src/db/schema.ts` and `drizzle/schema.ts` are parallel artifacts. Every P3 schema change must keep the authoritative source, generated schema and migration metadata synchronized.
8. **Data coverage:** The current tracked universe and historical depth are database/runtime concerns; P3 should not fabricate missing observations and must expose insufficient-data states.

## 12. Files Likely Affected by P3

### Foundation and persistence

- `src/db/schema.ts`
- `drizzle/schema.ts`
- `drizzle/migrations/`
- `drizzle/relations.ts`
- `src/db/index.ts`
- `src/lib/utils.ts`

### Intelligence engines and services

- `src/lib/features/`
- `src/lib/scoring/`
- `src/lib/services/momentum.service.ts`
- New P3 services likely under `src/lib/services/` or the repository's established equivalent.

### Refresh, scheduler and APIs

- `src/app/api/refresh/route.ts`
- `src/app/api/refresh/status/route.ts`
- `backend/scheduler.py`
- `backend/api/refresh.py` only if the fallback path remains supported
- New routes under `src/app/api/narratives/` and/or a dedicated intelligence namespace

### UI

- `src/app/page.tsx`
- `src/app/narrative/[id]/page.tsx`
- `src/components/NarrativeCard.tsx`
- `src/components/CoinRankingTable.tsx`
- `src/components/ScoreBreakdown.tsx`
- New P3 dashboard components/pages following existing conventions

### Tests and documentation

- Existing test directories under `src/lib/**/__tests__/`
- New tests for each deterministic P3 engine plus persistence/API integration
- `README.md`, `MdSpec.md`, and P3 documentation as implementation contracts evolve

## 13. P3-00 Checklist Result

- [x] Repository implementation inspected.
- [x] Database schema and migrations documented.
- [x] Refresh pipeline documented.
- [x] Existing historical persistence identified.
- [x] Existing rule/version system identified.
- [x] Existing API and dashboard surfaces identified.
- [x] Existing tests identified.
- [x] P3 components classified with exact file paths.
- [x] Potential P3 conflicts identified.
- [x] No application code changed.

## 14. Recommended Gate Before P3-01/P3-02

Before implementation begins, confirm:

1. Whether Next.js remains the sole authoritative P3 execution path.
2. Whether `narrative_momentum` is extended, replaced, or retained as a legacy metric.
3. The authoritative business timezone and historical missing-data policy.
4. The exact P3 persistence model and versioning strategy.
5. Whether FastAPI fallback must expose P3 intelligence or be retired from scheduled execution.

**Baseline status:** `READY FOR REVIEW` — P3-00 audit complete; no P3 implementation performed.
