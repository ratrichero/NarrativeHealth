# P3-10E.4 — Authoritative Signal & Identity Remediation

**Date:** 2026-08-10  
**Scope:** P3-06 canonical BTC benchmark lookup and P3-08/P3-09 algorithm/config identity propagation  
**Status:** P3-10E.4 STATUS: PASS

## 1. BTC Benchmark Root Cause

The authoritative orchestrator called `prepareRelativeStrengthInputs()` in `src/lib/p3/preparation.ts`. That implementation constructed the BTC benchmark with a hard-coded numeric identity:

```text
coinId = 0
```

Production has no BTC coin with ID 0. Canonical BTC is resolved through semantic identity (`coingecko_id=bitcoin`) and currently maps to production coin ID 17. Because the authoritative path queried `market_price_daily` with ID 0, it received no benchmark prices even though global BTC futures history exists.

The defect was unrelated to AI narrative membership. There was no narrative filter on the BTC query; the lookup key itself was incorrect.

## 2. BTC Lookup Fix

The duplicate BTC lookup in `preparation.ts` was removed. `prepareRelativeStrengthInputs()` now delegates to the existing canonical P3-06 loader in `relative-strength.ts`:

```text
loadRelativeStrengthInputs(context)
```

That loader:

1. resolves BTC globally from `coins.coingecko_id = 'bitcoin'`;
2. rejects ambiguous canonical identities;
3. uses the environment-specific resolved coin ID rather than a hard-coded number;
4. reads `market_price_daily`;
5. filters `source = 'binance_futures'`;
6. loads the shared range required for 1D, 3D, 7D, and 14D returns;
7. does not require BTC to belong to the target narrative;
8. does not use spot fallback or TopMC as a price source.

No `coinId: 0` or equivalent BTC ID-zero lookup remains in the authoritative P3 preparation path.

**BTC benchmark: FIXED**

## 3. Algorithm/Config Identity Root Cause

`createP3ExecutionContext()` previously selected the first active `score_configs` row without filtering by semantic P3 identity. In production this returned ID 1:

```text
health_weights / default / v1
```

The same base `p3-kernel/1` context was then passed to Regime and Rotation. This violated both module contracts:

```text
Regime:   regime/1 + regime_thresholds/v1
Rotation: rotation/1 + rotation_thresholds/v1
```

It also caused P3-08 to throw `Regime context must use algorithm identity regime/1`.

## 4. Identity Fix

The base execution context no longer performs a generic active-config lookup and now starts with `scoreConfigId=null`.

Two semantic configuration resolvers were added:

```text
P3 / regime_thresholds / version 1 / active
P3 / rotation_thresholds / version 1 / active
```

Each resolver:

- filters by `config_type`, `config_key`, `version`, and `is_active`;
- rejects missing or ambiguous configurations;
- validates all required threshold fields;
- returns the database-generated ID without assuming production IDs.

The orchestrator creates independent module contexts:

```text
P3-08 context:
  algorithmKey     = regime
  algorithmVersion = 1
  scoreConfigId    = resolved regime_thresholds/v1 ID

P3-09 context:
  algorithmKey     = rotation
  algorithmVersion = 1
  scoreConfigId    = resolved rotation_thresholds/v1 ID
```

The aggregate persistence context uses `p3-orchestrator/1` and leaves its singular `scoreConfigId` null because the aggregate consumes two configurations. Both semantic configuration references and their resolved IDs are retained in persisted provenance under `scoreConfigs.regime` and `scoreConfigs.rotation`.

This keeps algorithm identity separate from configuration identity while retaining reproducibility.

**P3 identity: FIXED**

## 5. Tests

Added/updated coverage:

- canonical/global BTC benchmark can calculate RS when BTC is not a narrative constituent;
- authoritative preparation delegates to the canonical P3-06 loader;
- no BTC coin-ID-zero hard-code remains in authoritative preparation;
- Regime receives `regime/1` with `regime_thresholds/v1`;
- Rotation independently receives `rotation/1` with `rotation_thresholds/v1`;
- tests use arbitrary config and benchmark IDs rather than production IDs.

Verification results:

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `git diff --check` | PASS |
| Relative Strength + identity + config focused tests | PASS — 33/33 |
| Full available suite | PARTIAL — 19/21 suites, 296/303 tests passed |

Remaining full-suite failures are pre-existing and outside this remediation:

- `rotation.test.ts`: 6 RS-normalization assertions expect percent/fraction semantics different from the current implementation.
- `breadth.test.ts`: 1 unavailable-health denominator assertion differs from current missing-data behavior.

No unrelated implementation or tests were changed merely to obtain a green suite.

## 6. Production Read-only Verification

The full authoritative orchestrator was not executed. No P3 production record was created.

Read-only validation against production returned:

```text
base execution scoreConfigId = null

BTC benchmark:
  coinId      = 17 (semantically resolved, not hard-coded)
  instrument  = BTCUSDT
  loaded rows = 16 in the required preparation range
  source      = binance_futures
  total history = 208 rows, 2026-01-15 through 2026-08-10

Regime:
  algorithm       = regime/1
  configuration   = P3/regime_thresholds/v1
  production ID   = 4 (observed result only; not embedded in business logic)

Rotation:
  algorithm       = rotation/1
  configuration   = P3/rotation_thresholds/v1
  production ID   = 5 (observed result only; not embedded in business logic)
```

Production P3 table counts remained zero after validation.

## 7. P0-P2 Compatibility

The remediation is isolated to `src/lib/p3` and its tests.

No changes were made to:

- `health_weights`;
- `confidence_weights`;
- `recommendation_thresholds`;
- their P0-P2 lookup behavior;
- `/api/refresh`;
- production thresholds or configuration rows.

Production still contains all three original P0-P2 configuration rows unchanged.

## 8. Remaining Historical Membership Gap

The production schema does not provide effective-dated historical narrative membership. Current `coin_narratives` membership cannot prove membership as of an earlier `window_end` when membership changed later.

This task did not substitute current membership as historical truth, create a migration, fabricate snapshots, or backfill production data.

**Historical membership: DEFERRED / SCHEMA GAP**

## 9. Remaining Blockers

- Historical membership requires a separately approved data/schema design and migration task.
- The pre-existing Rotation RS-normalization and Breadth missing-denominator test disagreements remain separately tracked.
- Full production orchestrator verification remains intentionally deferred until explicitly authorized.

## Final Gate

**P3-10E.4 STATUS: PASS**

- BTC lookup is canonical and environment-independent.
- No authoritative BTC coin-ID-zero hard-code remains.
- Regime uses `regime/1` and `regime_thresholds/v1`.
- Rotation uses `rotation/1` and `rotation_thresholds/v1` independently.
- Focused remediation tests and typecheck pass.
- Remaining full-suite failures are explicitly classified and unrelated.
- P0-P2 behavior and production data remain unchanged.
- Historical membership remains deferred as required.

Hard stop honored: the full production orchestrator was not rerun; `/api/refresh`, scheduler integration, production data, schema, thresholds, and P3-11 were not modified.
