# P3 Schema Design

## Status

**Status:** Implemented for review  
**Task:** P3-02 â€” P3 Schema Design  
**Date:** 2026-08-09

This document describes the schema foundation implemented for P3 persistence. It contains no P3 intelligence algorithms.

## Source Documents

- `docs/P3_Upgrade/p3.md`
- `docs/P3_Upgrade/P3_BASELINE.md`
- `docs/P3_Upgrade/P3_ARCHITECTURE_DECISIONS.md`
- `docs/P3_Upgrade/P3_DATA_CONTRACT.md`

## Existing Schema Reuse

| P3 Requirement | Existing Structure | P3 Action |
| --- | --- | --- |
| Narrative identity | `narratives` | Foreign key reference |
| Coin identity | `coins` | Foreign key reference |
| Current membership | `coin_narratives` | Consumed by future engine; not copied as history |
| Coin health | `health_scores` | Consumed; not duplicated |
| Narrative health | `narrative_health` | Consumed; not duplicated |
| Market data | `market_price_daily`, `coin_metrics` | Consumed; not duplicated |
| Existing Momentum | `narrative_momentum` | Preserved; not replaced or duplicated |
| Feature provenance | `feature_versions` | Nullable foreign key reference |
| Rule provenance | `rule_versions` | Nullable foreign key reference |
| Configuration provenance | `score_configs` | Nullable foreign key reference |
| Narrative intelligence | None | Create `p3_narrative_intelligence` |
| Constituent capture | None | Create snapshot header and member tables |
| API/dashboard/scheduler | Existing | No changes |

## P3 Tables

### `p3_narrative_intelligence`

One immutable narrative-level result for one calculation identity. It stores the UTC evaluation period, algorithm identity, reusable upstream version references, availability, nullable P3 output values, structured explanation, structured provenance, and calculation/persistence timestamps.

Windowed metrics use nullable columns for 1D, 3D, 7D, and 14D. Null means unavailable under the Data Contract; numeric zero remains a valid value where the output permits it. `regime` and `rotation` are nullable so unavailable is not silently mapped to a meaningful classification.

### `p3_constituent_snapshots`

One immutable snapshot header per intelligence result. It records capture time, membership source/mode, counts, and provenance. It does not reconstruct historical membership.

### `p3_constituent_snapshot_members`

Immutable normalized members actually passed to a calculation. It records canonical `coin_id`, membership state, inclusion reason, per-member availability state, and optional input manifest. The primary key `(snapshot_id, coin_id)` prevents duplicate membership rows.

The table can represent all captured members, including members excluded from a metric, because eligibility rules belong to the future P3 engine.

## Entity Relationships

```text
narratives 1 ---- * p3_narrative_intelligence
p3_narrative_intelligence 1 ---- 1 p3_constituent_snapshots
p3_constituent_snapshots 1 ---- * p3_constituent_snapshot_members
coins 1 ---- * p3_constituent_snapshot_members

p3_narrative_intelligence * ---- 0..1 rule_versions
p3_narrative_intelligence * ---- 0..1 feature_versions
p3_narrative_intelligence * ---- 0..1 score_configs
```

Restrictive deletes prevent current entity/version removal from cascading into historical P3 intelligence or constituent evidence.

## Calculation Identity

Database uniqueness is enforced on:

```text
narrative_id + window_end + algorithm_key + algorithm_version + calculation_mode
```

`period_start` and `period_end` are retained as semantic context. `updated_at` is not identity. The identity is independent of scheduler timezone.

`calculation_mode` distinguishes observed/captured calculations from any explicitly approved simulation mode.

## Versioning

The P3 algorithm identity is represented by `algorithm_key` plus `algorithm_version`, because existing `rule_versions` describes P0-P2 rules and does not uniquely identify every P3 algorithm/configuration. Existing `rule_versions`, `feature_versions`, and `score_configs` are referenced rather than duplicated. `provenance` records exact effective configuration, fallback method, input manifest, and version bindings.

Different algorithm versions coexist for the same narrative/window. No update/upsert behavior is implied.

## Constituent Snapshot

- Captured when the future P3 engine assembles the actual input set.
- `captured_at` is UTC.
- Immutable by contract; historical records have no update/delete path.
- May include active/inactive coins and missing/invalid inputs when actually passed; state fields record the facts.
- Represents the captured set, not inferred historical membership.
- Counts are audit/denominator context; this schema does not define eligibility semantics.

## Timestamp Semantics

All P3 timestamps use UTC application semantics: `window_end`, `period_start`, `period_end`, `captured_at`, `calculated_at`, and `persisted_at`. The repository commonly uses PostgreSQL `timestamp` without timezone mode, so UTC convention must be enforced by P3 writers until an approved timestamp migration exists.

`Asia/Ho_Chi_Minh` is not represented in any P3 field and remains scheduler-only.

## Nullability

- Metric columns are nullable because unavailable is distinct from zero.
- `confidence` is nullable until a defined confidence output exists.
- `regime` and `rotation` are nullable when required inputs/history are unavailable.
- `provenance`, availability, identity, periods, and timestamps are required.
- Version FKs are nullable when a calculation does not consume that domain; used domains must be present in provenance and FK fields.
- Snapshot counts, source/mode, and member availability are required.

## Numeric Precision

P3 values use PostgreSQL `NUMERIC`, not floating point:

- Confidence: `NUMERIC(7,4)`.
- Breadth, Strong Breadth, concentration: `NUMERIC(9,6)`.
- Momentum, acceleration, Relative Strength: `NUMERIC(12,6)`.

These are capacities, not formulas or validity ranges.

## Constraints

- Primary keys on headers and the composite snapshot-member key.
- Foreign keys to canonical narratives, coins, and existing version tables.
- `ON DELETE RESTRICT` for P3 historical references.
- Unique calculation identity prevents duplicate retries while allowing algorithm-version coexistence.
- One constituent snapshot per intelligence result.
- One member row per snapshot/coin.
- No numeric defaults that hide unavailable data.

## Indexes

- Narrative + window: historical detail and latest-result lookup.
- Algorithm key + version: version comparison.
- Window end: cross-narrative queries.
- Snapshot capture time: audit inspection.
- Snapshot member coin: constituent/coin audit queries.

No regime/rotation indexes are added because P3 APIs and query patterns are not defined yet.

## Idempotency

An exact retry uses the same database identity and is rejected as a duplicate by the unique constraint. Future persistence code must treat that as idempotent success or load the existing immutable record; it must not update it. A different algorithm version or calculation mode creates a distinct record.

## Historical Immutability

Restrictive foreign keys prevent parent deletion from erasing evidence, unique identities prevent duplicate results, and migration triggers reject direct `UPDATE` or `DELETE` operations on all three P3 tables. Future persistence uses insert-only behavior. Reprocessing produces a new identity/version and retains the prior result.

## Migration

`drizzle/migrations/0015_add_p3_intelligence.sql` creates only the three P3 tables, foreign keys, indexes, uniqueness constraints, and P3-only immutability triggers. It has no backfill and performs no calculations. Table/index creation statements use `IF NOT EXISTS`; the migration itself is applied once through the repository migration process.

## Query Patterns

1. Latest approved result for one narrative ordered by `window_end`.
2. Historical results for one narrative and algorithm version.
3. Cross-narrative results for a common `window_end`.
4. All algorithm versions for one narrative/window.
5. Constituent set and per-member availability for one result.
6. All P3 results involving a given coin.

## Non-Goals

- No P3 intelligence algorithms or confidence/ranking formulas.
- No P0-P2 schema redesign or semantic change.
- No API, dashboard, scheduler, FastAPI, collector, ingestion, or production logic changes.
- No duplicate P3 entity, market-data, Momentum, or version framework.
- No freshness thresholds.

## Known Limitations

- PostgreSQL `timestamp` columns follow repository convention and rely on UTC application semantics.
- Existing source tables remain mutable.
- Historical membership is reproducible only for calculations that capture their actual member set.
- Output columns do not freeze formulas or final confidence semantics.

## Next Task

P3-03 â€” Core Intelligence Engine / according to the approved execution plan

## P3-07 Leadership Extension

Migration `0016_add_p3_leadership.sql` minimally extends the P3 persistence foundation for the finalized P3-07 contract. Narrative-level `leader_coin_id`, `leader_score`, and `concentration_classification` remain directly queryable beside the existing Top-1/Top-3 concentration columns.

`p3_leadership_members` stores the immutable constituent-level Leadership result for each `p3_narrative_intelligence` record: deterministic rank, Leader Score, Leadership status, Emerging Leader flag, contribution, normalized input components, and nullable seven-day persistence evidence. Its composite primary key prevents duplicate members, its per-intelligence rank constraint prevents duplicate ranks, restrictive foreign keys preserve history, and the P3 immutability trigger rejects updates/deletes.

The extension does not create a new calculation identity or version framework. It uses the parent P3 identity and preserves coexistence of algorithm versions. Market cap is not persisted as a weight because P3-07 uses it only as an eligibility gate.


## P3-08/P3-09 Extension

The existing `regime` and `rotation` columns on `p3_narrative_intelligence` are reused. Migration `0017_add_p3_rotation_score.sql` adds only the normalized `rotation_score` column required by the Rotation result contract. Regime thresholds and Rotation thresholds remain configuration/provenance data; no parallel threshold or version framework is created.

Both engines persist through the existing immutable calculation identity. Missing values remain NULL, and `AMBIGUOUS`/`NOT_APPLICABLE` states are represented through `availability_state` and provenance rather than defaulting to a regime or rotation state.
