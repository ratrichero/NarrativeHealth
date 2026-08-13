# P3-10E.5 Historical Membership Contract & Schema Gap Audit

Audit date: 2026-08-10  
Scope: contract, repository, schema, and read-only production-data audit  
Production mutation: none

## 1. Executive Summary

For a P3 calculation ending at `window_end`, the authoritative constituent set is the narrative membership effective at that `window_end`, captured as an immutable set before constituent-dependent calculations run:

```text
membership(window_end)
        -> immutable constituent snapshot
        -> P3 calculation
```

The current repository and production database cannot establish that set for an arbitrary historical window. `coin_narratives` contains only current relationships. Its `created_at` is row-creation time, not an effective interval, and deleted relationships leave no history. Production has no P3 constituent snapshots. The existing P3 snapshot tables are immutable evidence attached to a completed calculation, but they are not an independent authoritative membership source.

The preparation path currently labels a snapshot with `narrativeId|windowEnd` in memory but selects members from current `coin_narratives` using only `narrative_id`. It does not filter membership as of `windowEnd` and does not read an authoritative historical snapshot. For an observed past window this is a **CONTRACT VIOLATION**.

Conclusion: **SCHEMA GAP**. An implementation correction alone cannot reconstruct membership history that the database never recorded.

## 2. P3 Contract

The controlling contract is `P3_DATA_CONTRACT.md`, especially the Narrative Membership Contract and the P3-09 constituent snapshot rule.

- Current membership comes from `coin_narratives`.
- `coin_narratives.created_at` records row creation only.
- There is no `effective_from`, `effective_to`, deletion history, membership audit log, or complete immutable historical membership ledger.
- Current membership must not be treated as historical truth.
- A constituent-dependent historical result must be `INSUFFICIENT_HISTORY` or `MISSING` when no authoritative set exists at the target `window_end`.
- `narrative_health.coin_breakdown` can be supporting evidence, but is not a complete membership ledger.
- Current-as-history is permitted only as a disclosed simulation with a distinct mode and reduced confidence; it is not observed production history.
- P3-09 must use the historical P3 constituent snapshot and must not reconstruct membership from current `coin_narratives`.

P3-04 Breadth and Strong Breadth require a captured denominator. P3-07 Leadership requires captured members. P3-08 consumes persisted/approved upstream outputs and inherits their membership provenance. P3-09 Rotation consumes historical P3 snapshots and intelligence; it must not rebuild historical membership from the current relationship table.

The older P3-10B/P3-10C documents say to query `coin_narratives` “at `window_end`” and capture before calculation. That wording is only implementable when the calculation is contemporaneous with `window_end`, or when an as-of source exists. The later Data Contract explicitly resolves the ambiguity: current `coin_narratives` cannot answer historical as-of queries.

Conclusion: **PASS** — the authoritative contract is clear: membership effective at `window_end`, not membership current at execution time.

## 3. Current Schema

### Core membership

| Table | Relevant fields | Historical capability |
|---|---|---|
| `narratives` | `id`, current `is_active`, `created_at`, `updated_at` | No status history |
| `coins` | `id`, current identity/status, `created_at`, `updated_at` | No identity/status history |
| `coin_narratives` | `coin_id`, `narrative_id`, `is_primary`, `created_at` | Current pair only; no effective end or delete history |

`coin_narratives` has a primary key on `(coin_id, narrative_id)` and cascading foreign keys. It has no immutability trigger, change log, effective interval, or tombstone. API update/delete paths can delete current relationships, after which the relationship and its original timestamp are no longer available.

### Existing P3 persistence

`p3_narrative_intelligence` identifies a calculation by narrative, window, algorithm key/version, and calculation mode. `p3_constituent_snapshots` has one row per `intelligence_id`; members are unique by `(snapshot_id, coin_id)`.

The snapshot's narrative and `window_end` are only reachable through `p3_narrative_intelligence`. There is no direct authoritative uniqueness constraint on `(narrative_id, window_end, membership_mode)`. Different algorithm identities can therefore have separate snapshots for the same narrative/window.

Conclusion: **SCHEMA GAP** — the schema stores current membership and calculation-attached evidence, but no independent authoritative as-of membership identity.

## 4. Current Production Data

All production queries were executed inside a read-only transaction.

### Current membership

| Narrative | Current members | Count | Earliest/latest relationship `created_at` |
|---|---|---:|---|
| AI | CARV(1), FET(4), RENDER(5), BLUAI(10), AKT(11), PROMPT(12), TRUTH(22) | 7 | 2026-07-31 05:47:20Z / 2026-08-02 07:15:28Z |
| TOPMC | BTC(17), ETH(18), LINK(19), NEAR(20), HYPE(21), SOL(25) | 6 | 2026-08-02 07:13:19Z / 2026-08-02 07:17:30Z |
| RWA | ONDO(6), MANTRA(15), CFG(16) | 3 | 2026-07-31 05:47:20Z / 2026-08-02 07:10:41Z |
| RESTAKING | ENA(24), ETHFI(31), EIGEN(32), LDO(33), REZ(34) | 5 | 2026-08-07 04:25:33Z / 2026-08-07 04:47:25Z |
| FAVORITE | ETHFI(23), BLESS(26), PUMP(29), ZEC(35) | 4 | 2026-08-02 07:16:22Z / 2026-08-07 04:47:49Z |

### P3 historical rows

| Table | Production rows |
|---|---:|
| `p3_narrative_intelligence` | 0 |
| `p3_constituent_snapshots` | 0 |
| `p3_constituent_snapshot_members` | 0 |
| `p3_leadership_members` | 0 |

### Partial historical evidence

`narrative_health.coin_breakdown` demonstrates that membership/input populations changed. Examples include:

- AI on 2026-07-31 contains coin IDs `[1,2,3,4,5,10]`, while current AI is `[1,4,5,10,11,12,22]`.
- RWA on 2026-08-04 and 2026-08-05 contains `[6,15,16,29,30]`, while current RWA is `[6,15,16]`.
- FAVORITE changes from `[23,24,26]`, to `[23,24,26,29,30]`, then to current-like `[23,26,29,35]`.

This is evidence of historical drift and deleted relationships, but not an authoritative member ledger. Refresh builds `coin_breakdown` only from members that also have a health-score row for that date, and `narrative_health` is mutable through `ON CONFLICT DO UPDATE`. It cannot prove that an omitted member was not a member, and it does not record membership state, deletion, source, or immutable capture provenance.

Legacy `morning_snapshots` and normalized morning snapshot tables record aggregate narrative counts and global coin observations, not narrative-to-coin membership sets. No other production table supplies a complete historical membership ledger.

Conclusion: **DATA GAP** as a production fact, caused by the stronger **SCHEMA GAP**: some historical inclusion evidence exists, but authoritative complete sets cannot be reconstructed.

## 5. preparation.ts Behavior

`createP3ExecutionContext()` calls `prepareHistoricalConstituents(narrativeId, windowEnd)` before preparing component inputs. The function:

1. creates an in-memory string `snapshotId = narrativeId|YYYY-MM-DD`;
2. selects `coin_id` and `is_primary` from `coin_narratives`;
3. filters only by `coin_narratives.narrative_id = narrativeId`;
4. applies current coin activity and window-bounded market/metric eligibility;
5. returns the resulting in-memory constituent array.

It does not use `windowEnd` to constrain membership. It does not read `p3_constituent_snapshots`, an effective-dated ledger, or another historical source.

Classification of the active path:

```text
A. current coin_narratives membership: YES
B. p3_constituent_snapshots: NO
C. another historical source: NO
D. hybrid/fallback: NO
```

For a current calculation captured contemporaneously, this may reflect the current set at capture time. For a backdated observed calculation it substitutes execution-time membership for historical membership.

Conclusion: **IMPLEMENTATION GAP / CONTRACT VIOLATION**, subordinate to the schema gap because no correct historical source is available to wire in.

## 6. Existing P3 Snapshot Tables

| Required property | Result | Evidence |
|---|---|---|
| Narrative | PARTIAL | Indirect through `intelligence_id` |
| `snapshot_at` / `window_end` | PARTIAL | `captured_at` is direct; `window_end` is indirect through intelligence |
| Constituent coin IDs | PASS | Member PK `(snapshot_id, coin_id)` |
| Source/provenance | PASS | `membership_source`, `membership_mode`, `provenance`, member input manifest |
| One authoritative snapshot per narrative/window | FAIL | Unique only by `intelligence_id`; algorithm identities can duplicate a narrative/window |
| Immutable membership | PASS after insert | Production UPDATE/DELETE triggers protect snapshot and member rows |
| Deterministic ordering | FAIL as a schema guarantee | A set is unique, but no ordinal/rank and SQL row order is unspecified without `ORDER BY` |
| Historical reproducibility of completed calculation | PARTIAL | Can preserve members used if persistence succeeds |
| Authoritative source before first calculation | FAIL | Snapshot requires an existing intelligence row and is inserted after the result row |

`persistP3Calculation()` inserts `p3_narrative_intelligence`, then inserts the snapshot and members in the same transaction. Consequently these tables describe the members attached to a completed calculation. They cannot independently provide the input set for the first calculation of a historical window, and they cannot be pre-populated without first creating an intelligence record.

Conclusion: **SCHEMA GAP** — the tables are valuable immutable calculation evidence, but insufficient as the authoritative historical membership source required by the contract.

## 7. Historical Membership Source

### Strategy A — existing historical source

**BLOCKED.** No complete authoritative source exists. `narrative_health.coin_breakdown` is partial, mutable, and output-derived. Morning snapshots do not map narrative membership.

### Strategy B — existing P3 snapshots become the source

**IMPLEMENTATION GAP plus SCHEMA GAP.** Existing snapshots can preserve what a completed calculation used, prospectively. Their dependency on an intelligence result and identity-per-algorithm constraint prevents them from being the independent, shared snapshot-first authority.

### Strategy C — add an authoritative membership source

**REQUIRED.** The minimum robust approach is an immutable snapshot identity independent of a P3 result. Effective-dated relationship history is a valid broader alternative, but is not required if the approved operational contract captures an immutable set for every P3 window before calculation.

Conclusion: **SCHEMA GAP**.

## 8. Reproducibility Analysis

A persisted P3 result could be reproduced from existing P3 member rows only after such rows exist and only for the exact calculation attachment. Production has none. A first-time calculation for a past window cannot determine removed members, members lacking health rows, historical `is_primary`, or historical coin/narrative active state.

The observed differences in `narrative_health.coin_breakdown` prove that replaying with current membership can change denominators, eligibility, leadership ranking, concentration, narrative return construction, regime inputs, and rotation history.

Current-as-history must therefore not be persisted as `calculation_mode = observed`. If a separately approved simulation mode is later supported, its provenance must explicitly disclose execution-time membership and reduced confidence.

Conclusion: **SCHEMA GAP** — deterministic formulas and immutable result tables do not compensate for an unknowable historical input set.

## 9. Production Testability

```text
NO — only current membership exists
```

Production can test present-day capture prospectively, but it cannot authoritatively verify constituent-dependent P3 behavior for the prior production test window. The missing artifacts are a complete member set effective at that window, including members with unavailable component inputs, historical relationship removals, membership source/provenance, and an immutable snapshot identity.

Existing health breakdowns may support forensic comparison but cannot be promoted to authoritative truth without an external verified source.

Conclusion: **DATA GAP**, rooted in **SCHEMA GAP**.

## 10. 7 Pre-existing Test Failures

The previously recorded full-suite result had seven assertion failures:

- six `rotation.test.ts` assertions around Relative Strength normalization percent/fraction semantics;
- one `breadth.test.ts` assertion requiring a member with missing health to remain in the supplied denominator and degrade availability.

These failures pre-date P3-10E.4 and are unrelated to the BTC benchmark lookup and algorithm/config identity remediation completed there. The Rotation tests are pure normalization tests with explicit numeric inputs and no database or membership lookup.

The Breadth test is membership-adjacent because it defines behavior after a constituent set has already been supplied. It does not select historical membership and does not test `coin_narratives` or P3 snapshots. It remains a separate missing-input/denominator contract disagreement, not evidence that P3-10E.4 caused a regression and not a fix for the historical source gap.

Conclusion: **DEFERRED** — confirmed unrelated to P3-10E.4; do not fix under P3-10E.5.

## 11. Minimal Fix Options

### Option 1 — code-only read of existing P3 snapshots

Rejected as insufficient. It works only when a snapshot already exists, production has zero snapshots, and the schema cannot create a snapshot independently before its intelligence result.

Classification: **IMPLEMENTATION GAP remains, SCHEMA GAP unresolved**.

### Option 2 — promote `narrative_health.coin_breakdown`

Rejected. It contains only coins with health rows, is output-derived and upserted, and has no immutable membership provenance.

Classification: **CONTRACT VIOLATION / DATA GAP**.

### Option 3 — effective-dated membership/change log

Add a relationship history model with `effective_from`, `effective_to`, event/source metadata, uniqueness preventing overlapping intervals, indexes for narrative/time as-of lookup, and append-only protection. This supports arbitrary as-of lookup prospectively, but is broader than the minimum P3 snapshot requirement.

Classification: **SCHEMA GAP fix candidate**.

### Option 4 — standalone authoritative membership snapshots

Add snapshot tables independent of `p3_narrative_intelligence`, capture one immutable member set per narrative/window/mode before calculation, then make P3 results reference that snapshot.

Classification: **recommended minimal SCHEMA GAP fix**.

## 12. Recommended Solution

Introduce a standalone authoritative snapshot model, for example:

```text
narrative_membership_snapshots
  id
  narrative_id
  window_end
  membership_mode
  membership_source
  source_version_or_digest
  captured_at
  provenance

narrative_membership_snapshot_members
  snapshot_id
  coin_id
  is_primary
  membership_state
  provenance
```

Required constraints and indexes:

- unique `(narrative_id, window_end, membership_mode)` for the authoritative identity;
- primary key `(snapshot_id, coin_id)` for set uniqueness;
- index `(narrative_id, window_end)` and member index on `coin_id`;
- foreign keys with `ON DELETE RESTRICT`;
- UPDATE/DELETE prevention on snapshot and member rows;
- explicit `ORDER BY coin_id` when deterministic serialization/digests are produced;
- P3 intelligence references the authoritative `membership_snapshot_id` used by the calculation.

Operational order:

```text
resolve window
  -> obtain/create authoritative membership snapshot
  -> freeze and validate members
  -> calculate P3-04 through P3-09 from that set
  -> persist result referencing the snapshot
```

An effective-dated change log can be added later if product requirements demand arbitrary as-of membership outside captured P3 windows. It is not necessary to fabricate past snapshots.

Conclusion: **SCHEMA GAP** with a bounded migration and preparation-path change required in a separately approved task.

## 13. Migration / Rollout Requirements

No migration was executed in this audit. A future approved rollout should include:

1. Create the standalone snapshot identity/member tables, indexes, constraints, and immutability triggers.
2. Add `membership_snapshot_id` to P3 intelligence/persistence and establish the required FK/validation policy.
3. Change preparation to load the authoritative snapshot, never current membership for an observed past window.
4. Capture current membership only for current/prospective windows. Record exact source, capture time, mode, and digest.
5. Backfill a historical window only from a repository-owner-verified authoritative source. Do not infer full membership from `narrative_health`, morning snapshots, or current relationships.
6. Return `INSUFFICIENT_HISTORY`/`MISSING` for unsnapshotted historical windows instead of fabricating observed history.
7. Validate snapshot idempotency, immutability, concurrent capture behavior, replay consistency, and unavailable-member denominator behavior in a non-production database.
8. Roll out schema first, then capture/read path, then controlled P3 verification. Keep scheduler and `/api/refresh` unchanged until separately authorized.

Historical backfill feasibility: **PARTIAL/DATA GAP**. The daily health breakdown can identify some coins that participated in health calculations, but cannot prove the complete membership set. Reliable backfill requires an external authoritative audit source; absent that, old windows must remain unavailable.

Conclusion: **DEFERRED** — proposal only; implementation requires separate approval.

## 14. P0-P2 Impact

The recommended model is additive and P3-owned. It should not change `coin_narratives` semantics, P0-P2 scoring, thresholds, narrative health, morning snapshots, scheduler behavior, or existing API refresh behavior during the schema phase.

The later integration must avoid triggers or write-path changes that alter existing membership administration without an explicit rollout plan. P0-P2 may continue reading current `coin_narratives`; P3 observed historical calculations must read the authoritative snapshot.

This audit performed no writes and made no production changes.

Conclusion: **PASS** for audit safety; future P0-P2 impact is expected to be none if the fix remains additive.

## 15. Final Classification

```text
P3-10E.5 STATUS: SCHEMA GAP
```

Exact blocker:

```text
Production has no authoritative, independently addressable, immutable narrative
membership set effective at a historical window_end. Current coin_narratives cannot
reconstruct removed or unavailable members, and existing P3 snapshot rows can only
be attached after an intelligence result exists.
```

Secondary finding:

```text
preparation.ts uses current coin_narratives for backdated observed calculations:
CONTRACT VIOLATION / IMPLEMENTATION GAP
```

Hard stop observed. No schema/code fix, data insertion, migration, full orchestrator run, `/api/refresh` change, scheduler action, or P3-11 work was performed.
