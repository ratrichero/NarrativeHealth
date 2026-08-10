# P3-08 / P3-09 Verification & Integration Audit

## Status

**BLOCKED** as of August 10, 2026.

## Executive Finding

`src/lib/p3/regime.ts` and `src/lib/p3/rotation.ts` are deterministic calculation modules with focused tests and shared persistence adapters, but they are not called by the authoritative Next.js refresh path or any production P3 orchestrator. They are isolated modules rather than integrated stages of the required P3 execution graph.

## Regime Findings

- Supports exactly `EMERGING`, `STRONG`, `MATURE`, `WEAKENING`, and `DEAD`.
- Consumes caller-supplied Health, Health change, Breadth, Breadth change, Momentum, Acceleration, Relative Strength, Relative Strength change, and confidence.
- Does not load these inputs from persisted P3-03 through P3-07 results.
- Thresholds are caller-supplied and included in provenance, but no production configuration loader binds them to `score_configs` or `rule_versions`.
- Missing, not-applicable, and ambiguous results remain distinct.
- Algorithm identity `regime/1` is now enforced by the result/persistence boundary.

## Rotation Findings

- Implements the approved `30/20/20/15/15` weighted score.
- Supports exactly `ACCELERATING`, `INFLOW`, `STABLE`, `DECELERATING`, and `OUTFLOW`.
- Requires caller-normalized `0-100` components and now rejects out-of-range inputs.
- The repository has no production preparation contract or implementation for Health Momentum normalization, Breadth Momentum normalization, Volume Expansion normalization, or OI Confirmation normalization/window selection.
- Missing OI or another required component makes Rotation unavailable; no weight redistribution or zero fabrication occurs.
- Algorithm identity `rotation/1` is now enforced.

## Execution Path

Actual authoritative path:

```text
Scheduler
  -> Next.js POST /api/refresh
  -> P0-P2 collection/features/health/narrative health/snapshot
  -> response
```

No imports or calls to `calculateRegime`, `persistRegime`, `calculateRotation`, or `persistRotation` exist in the refresh route or another production orchestrator. P3-03 through P3-07 are also not wired into that route. Implementing the missing orchestration here would be P3-10 scope and is explicitly prohibited by the audit task.

## Persistence

- `p3_narrative_intelligence.regime`, `.rotation`, and `.rotation_score` are mapped by the shared insert-only persistence boundary.
- Calculation identity remains `narrative_id + window_end + algorithm_key + algorithm_version + calculation_mode`.
- Migration `0015` provides uniqueness and immutable update/delete triggers.
- Migration `0017` adds nullable `rotation_score` without destructive changes.
- Persistence functions are not reached by production execution.

## Schema and Migration

- Canonical Drizzle configuration points to `src/db/schema.ts`, which includes Rotation Score.
- `drizzle/schema.ts` contains no P3 structures and is not synchronized with the canonical schema.
- `drizzle-kit check` cannot run because the installed Drizzle CLI interprets the repository configuration as AWS Data API configuration and reports a missing `database` parameter.
- Migration execution against a live database was not performed.

## Validation

- P3-08/P3-09 focused tests: 20 passed.
- TypeScript typecheck: passed.
- Focused ESLint: passed.
- `git diff --check`: passed.
- P3-03 through P3-07 regression: 90 passed, 1 existing Breadth test failed because the test expects a ratio while implementation returns `null` for unavailable constituent health.

## Blocking Issues

1. **INTEGRATION GAP (P0):** Regime and Rotation are not in the authoritative Next.js execution path.
2. **BUSINESS-CONTRACT GAP (P0):** Rotation component source/formula/window/normalization is undefined for Health Momentum, Breadth Momentum, Volume Expansion, and OI Confirmation.
3. **CONFIGURATION INTEGRATION GAP (P1):** Regime/Rotation thresholds are not loaded from or bound to existing versioned configuration infrastructure.
4. **SCHEMA/PERSISTENCE GAP (P1):** `drizzle/schema.ts` is not synchronized with canonical P3 schema, and migration validation is blocked by Drizzle configuration.
5. **TEST GAP (P1):** No real execution-path integration test can exist until the production orchestrator exists.
6. **P3 COMPATIBILITY GAP (P1):** Upstream P3 modules are implemented but not production-wired, so Regime/Rotation cannot consume actual persisted upstream outputs.
7. **REGRESSION ISSUE (P2):** One pre-existing Breadth test disagrees with current missing-health implementation.

## Required Next Action

Do not proceed on the assumption that P3-08/P3-09 are production-ready. First finalize the missing Rotation input contracts and implement the approved P3-10 authoritative orchestrator/configuration binding, then add a real refresh-to-persistence integration test and rerun this audit.
