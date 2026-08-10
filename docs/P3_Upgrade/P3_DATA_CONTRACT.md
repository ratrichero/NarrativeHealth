# P3 Data Contract

## Status

**Status:** Proposed for review and freeze  
**Task:** P3-01 â€” P3 Data Contract  
**Scope:** P3 Narrative Intelligence only  
**Date:** 2026-08-09

This document freezes P3 input and output semantics for P3-02 and later implementation tasks. It defines no database schema and implements no intelligence logic.

## Purpose

This contract defines what P3 consumes, what each value means, where it originates, how time and availability are represented, and what provenance an immutable P3 result must preserve. P3-02 must be able to design storage from this document without redefining semantics.

A contracted datum is:

```text
value + availability state + observation period/time
+ collection/calculation time + source/provider identity
+ entity identity + version/config provenance
```

## Source Documents

Conflict priority:

1. `docs/P3_Upgrade/P3_ARCHITECTURE_DECISIONS.md`
2. `docs/P3_Upgrade/p3.md`
3. `docs/P3_Upgrade/P3_BASELINE.md`
4. Existing repository implementation
5. Agent assumptions

Inspected implementation includes `src/db/schema.ts`, `drizzle/schema.ts`, Next.js and FastAPI refresh paths, Binance/CoinGecko collectors, feature and health scoring, narrative-health aggregation, existing Momentum and its API, snapshots/history, and feature/rule/config/recommendation version infrastructure.

## Architectural Invariants

1. Authoritative path: `Scheduler -> Next.js Refresh -> P0-P2 -> P3 Intelligence -> Persistence`.
2. FastAPI must not calculate or persist independent P3 intelligence. A legacy fallback cannot claim P3 success without an authoritative Next.js P3 result.
3. Existing collectors and persistence are reused; no duplicate BTC, price, volume, market-cap, or OI ingestion.
4. Existing Momentum is extended through an approved compatibility path; a competing Momentum engine is prohibited.
5. Reuse `feature_versions`, `rule_versions`, `score_configs`, and `recommendation_rules`. P3 may require immutable calculation identity, not a separate version framework.
6. P3 outputs are deterministic, explainable, reproducible, and historically immutable.
7. Missing or unusable data remains unavailable. It is never fabricated, silently converted to zero, or interpreted as bearishness.

## Timestamp & Timezone Contract

### Scheduler Time Is Not Data Time

```text
Scheduler Time != Data Time
```

- Scheduler timezone: `Asia/Ho_Chi_Minh`, only for trigger times and human-facing schedule descriptions.
- Data timezone: `UTC`, for every observation, period boundary, lookback, collection, calculation, persistence, comparison, and P3 timestamp.
- Scheduler local midnight must not define P3 history. Stored market data must not be converted to Vietnam local time.
- P3 introduces no Vietnam-local business date.

### Timestamp Types

- `observed_at`: UTC instant at which a point-in-time provider value applies.
- `period_start` / `period_end`: UTC aggregate boundaries, half-open `[start, end)`.
- `window_end`: UTC instant at which a result is evaluated; later inputs are excluded.
- `collected_at`: UTC retrieval/acceptance instant.
- `calculated_at`: UTC calculation instant.
- `persisted_at`: UTC commit instant.
- Legacy `date`: only a UTC daily label `[date 00:00:00Z, next date 00:00:00Z)`; it does not prove freshness.

All instants must be timezone-aware or explicitly UTC. Daily candles describe provider UTC periods. Snapshot market cap/OI describe observations at or before collection and must not be backdated merely because storage has a daily `date`. Future-dated observations relative to `window_end` are `INVALID`.

## Entity Identity Contract

### Narrative Identity

- `narrative_id`: immutable internal key from `narratives.id`; required for P3 identity.
- `narrative_name`: mutable display label, not a historical key.
- `is_active`: current operational eligibility. Historical calculations require a captured historical universe.
- Name changes do not create a new identity.

### Coin Identity

- `coin_id`: immutable internal key from `coins.id`; canonical for P3 joins.
- `symbol`: display/trading symbol; not globally unique or canonical.
- `coingecko_id`: CoinGecko provider identity when populated.
- `binance_spot_symbol` / `binance_futures_symbol`: venue instrument identities, not coin identity.
- `is_active`: current operational eligibility.
- `has_futures`: capability metadata, not proof that OI exists.

Provider data is valid only when its provider identifier maps unambiguously to the internal coin.

## Narrative Membership Contract

### Current Membership

Current membership comes from `coin_narratives`: `coin_id`, `narrative_id`, `is_primary`, and `created_at`. A coin may belong to multiple narratives. `is_primary` does not exclude non-primary membership unless an approved formula explicitly says so.

For a current calculation, eligible membership is the selected member set at `window_end`, active narrative/coin status, and component-specific requirements. Denominators and exclusions must be explainable; missing metrics must not silently remove a member.

### Historical Membership

The repository does **not** contain effective-dated membership history. `created_at` records row creation only; there is no `effective_from`, `effective_to`, deletion history, audit log, or complete immutable membership snapshot.

Therefore:

1. Historical membership cannot currently be reconstructed reliably.
2. Current membership must not be treated as historical truth.
3. Constituent-dependent historical calculations are `INSUFFICIENT_HISTORY` or `MISSING` unless an authoritative member set exists for the target `window_end`.
4. Historical `narrative_health.coin_breakdown` may evidence included coins, but is not a complete membership ledger.
5. Using current membership for a past period is a disclosed simulation, not observed history; it requires a distinct mode and reduced confidence and is not the default.
6. P3-02 must support effective-dated membership or an immutable captured member set per calculation.

Affected outputs include historical Breadth, Strong Breadth, Leadership, Concentration, Regime, Rotation, and constituent-built narrative returns. Narrative-health Momentum can use immutable narrative-health observations without reconstructing membership, while inheriting their provenance and quality.

## Coin Data Contract

P3 consumes identity/status from `coins`, OHLCV from `market_price_daily`, snapshot metrics from `coin_metrics`, feature components from `features`, Coin Health from `health_scores`, source evidence from `source_status`, and immutable snapshots/results where available.

### Price

- Source: existing Binance daily klines, with stored source retained. Current refresh prefers Futures when configured and falls back to Spot.
- Unit: quote currency per base asset. Comparisons require a consistent quote basis, normally USD-equivalent `USDT`; instrument and quote asset must be retained.
- Valid: finite and strictly positive OHLC with internally consistent high/low bounds.
- Timestamp: UTC candle period; `date` is the UTC candle-start label.
- Historical availability: only rows actually persisted/fetched; measure it, never assume it.
- Missing endpoint, invalid price, or incompatible source/quote basis makes a return unavailable. Missing return is not zero.

## Health Contract

### Coin Health

- Source: `health_scores` from the authoritative Next.js P0-P2 feature/health engine.
- Meaning: configured composite of Trend, Derivative, Volume, and Momentum.
- Unit/range: score points `[0,100]`; zero is valid when calculated.
- Confidence: `confidence_score` `[0,100]` when available, distinct from health.
- Timestamp: UTC daily period plus calculation/persistence timestamp.
- Historical availability: date-keyed records exist, but same-day upserts are mutable and do not preserve multiple algorithm/rule executions.
- Provenance: coin, period, feature/rule versions where recorded, breakdown, and missing-source details.
- Missing: no accepted record for the required period/version.
- Invalid: non-finite, outside range, wrong coin, unusable version, or future observation.

Unavailable health is never health zero. Component denominator behavior must be explicit and must retain excluded counts/reasons.

### Narrative Health

- Source: `narrative_health` from existing aggregation.
- Meaning: aggregate health of included constituents.
- Unit/range: `[0,100]`; zero is valid only under valid calculation semantics.
- Associated data: previous/change/status/count/top/weakest/confidence/breakdown/rule/weighting fields where populated.
- Timestamp: UTC daily period and calculation time.
- Historical availability: date-keyed and mutable under current `(narrative_id, date)` upsert.
- Invalid: out-of-range/non-finite score, negative count, or member/provenance mismatch.
- Missing: makes Health-based Momentum and Regime inputs unavailable.

Existing code returns `0`/`WEAK` for an empty coin set. P3 must represent no eligible health observations as unavailable.
## Market Cap Contract

- Meaning: provider-observed circulating market capitalization, not FDV or liquidity.
- Authoritative source: CoinGecko mapped by `coingecko_id`, stored with explicit source/provenance.
- Unit: USD.
- Timestamp: provider as-of time when available plus UTC collection time; `date` alone is insufficient.
- Valid: finite and strictly greater than zero. Zero/negative is `INVALID` for capitalization weighting.
- Historical: only persisted snapshots verified as genuine CoinGecko market cap.
- Freshness: maximum age is **REQUIRES P3 SPEC DECISION**; provider/source status is still retained.
- Missing: `null/unavailable`.
- Fallback: no raw numeric fallback. An approved algorithm may explicitly use equal weighting and record lower weighting confidence.
- Prohibited: `price x arbitrary supply`, `volume x price`, quote volume, or similar proxies labeled as market cap.

Next.js refresh paths contain volume/price-derived approximate market-cap fallbacks. Such values are not authoritative P3 market cap and must be rejected or marked invalid/unsupported.

```text
Missing Market Cap != Market Cap = 0
```

## Relative Strength / Narrative Return Contract

The finalized P3 Relative Strength contract is:

- **Weighting:** equal-weight across eligible constituents only. For `N_valid` eligible constituents, `weight_i = 1 / N_valid`.
- **Market cap:** eligibility/data-quality requirement only; never a weighting input. Missing market cap excludes the constituent.
- **Weight timestamp:** `N/A`, because no market-cap weighting is performed.
- **Price source:** canonical Coin-USDT perpetual futures instrument only, using its UTC daily close. Spot, quarterly/dated futures, non-USDT futures, and unrelated derivatives are invalid sources.
- **Spot fallback:** prohibited. Missing or insufficient perpetual-futures history excludes the constituent.
- **Eligibility:** a constituent must be in the captured P3 snapshot, have valid market cap, valid canonical perpetual-futures daily closes at both window endpoints, and satisfy the window history requirement.
- **Minimum population:** `N_valid < 3` makes Narrative Return and Relative Strength unavailable. No result is calculated from one or two valid constituents.
- **Individual return:** `Return_ND = price_end / price_start - 1`.
- **Narrative return:** arithmetic mean of eligible constituent returns: `sum(return_i) / N_valid`.
- **Benchmark:** BTC-USDT perpetual futures daily close only. Missing or insufficient BTC history makes BTC Return and Relative Strength unavailable; no zero or alternative benchmark is allowed.
- **Relative Strength:** `RS_ND = Narrative Return_ND - BTC Return_ND`.
- **Windows:** 1D, 3D, 7D, and 14D using the P3 UTC endpoint semantics.
- **Provenance:** preserve snapshot identity, canonical instruments, BTC instrument, window endpoints, eligible/excluded constituents and reasons, equal-weight method, `N_valid`, and algorithm/version references.

Missing market cap, missing/invalid/stale/insufficient perpetual-futures history, and `N_valid < 3` remain explicit unavailable states and never become zero or bearish values.
## Volume Contract

P3 must preserve volume type.

- Base candle volume: Binance kline `volume`; base-asset units over a UTC candle; finite and `>= 0`.
- Quote candle volume: Binance `quoteVolume`; quote-asset units over the same UTC candle; finite and `>= 0`.
- Rolling 24-hour volume: Binance/CoinGecko snapshot fields; not automatically equivalent to a closed UTC candle and requires source, unit, and observation time.
- Futures and spot volume are different domains and must remain labeled.
- Missing quote volume cannot be replaced by base volume without an approved conversion.
- Zero is a valid verified observation; negative/non-finite is `INVALID`; absence is `MISSING`.

```text
Volume = 0 != Volume unavailable
```

## Open Interest Contract

- Meaning/source: Binance Futures outstanding exposure through current OI and OI-history endpoints, stored in `coin_metrics` with source identity.
- Unit: current collector maps `sumOpenInterest`, a base-asset quantity, not USD notional.
- Timestamp: provider timestamp for history or UTC collection time for current value; a daily storage label is not a daily close.
- Valid: finite and `>= 0`; zero only when directly observed.
- Historical: incomplete/sparse; no complete dedicated timestamped OI series currently exists.
- Missing: unavailable, never zero.
- Not applicable: no supported futures instrument is `NOT_APPLICABLE`, not zero.
- Confidence: non-valid OI affects only derivatives-dependent outputs and never becomes bearishness.
- Fallback: none.

## BTC Benchmark Contract

- Official benchmark: BTC only.
- Canonical identity: exactly one active `coins.id` mapped to CoinGecko `bitcoin` and/or configured Binance BTC instrument. Symbol text alone is insufficient.
- Source: existing `market_price_daily`; prefer matching venue family, quote basis, frequency, and UTC period, with deterministic stored precedence.
- Return input: valid positive BTC closes at the same endpoints as the target return.
- Lookbacks: 1D, 3D, 7D, 14D.
- Historical: measured from persisted BTC rows; BTC is not guaranteed by current seed/configuration.
- Unavailable: either endpoint missing/invalid makes BTC return and corresponding RS unavailable.
- No fallback: no ETH, market index, alternate asset, or assumed zero.
- No separate ingestion: BTC uses existing coin/market-data infrastructure.

```text
BTC data unavailable -> Relative Strength unavailable
```

## Historical Window Contract

### General Window Model

P3 evaluates completed UTC daily observations at a `window_end`. For daily calculations, `window_end` is a UTC day boundary and the exclusive end of the latest completed daily period.

For an `ND` lookback:

```text
end target   = window_end - 1 day
start target = window_end - (N + 1) days
return       = close(end target) / close(start target) - 1
health delta = health(end target) - health(start target)
```

This provides exact UTC calendar-day comparisons for 1D, 3D, 7D, and 14D. It does not use scheduler timezone.

### Boundaries and Gaps

- Boundaries are UTC and half-open.
- An in-progress daily candle is not accepted as a daily close.
- Endpoint delta/return needs two valid endpoint observations. Slopes, persistence, and acceleration may require more observations under their approved formulas.
- Crypto weekends are ordinary UTC days, not expected exchange closures.
- If the exact target date is absent, the latest valid observation at or before the target may be used only when the gap is at most one UTC day; selected timestamp and gap are retained and coverage is degraded. Larger gaps are `INSUFFICIENT_HISTORY`.
- No observation after the target may be used.
- Missing interior observations do not invalidate endpoint-only deltas, but reduce completeness and may make path-dependent metrics unavailable.

| Window | End target | Start target | Minimum endpoints | Maximum as-of gap |
| --- | --- | --- | ---: | ---: |
| 1D | `window_end - 1d` | `window_end - 2d` | 2 | 1 UTC day each |
| 3D | `window_end - 1d` | `window_end - 4d` | 2 | 1 UTC day each |
| 7D | `window_end - 1d` | `window_end - 8d` | 2 | 1 UTC day each |
| 14D | `window_end - 1d` | `window_end - 15d` | 2 | 1 UTC day each |

The Master Specification also requires at least seven daily snapshots for a full seven-observation Momentum display. That is distinct from endpoint `Delta7D`; agents must not conflate seven observations with seven calendar days.

### Insufficient History

A window is `INSUFFICIENT_HISTORY` when the entity or benchmark lacks enough valid observations for the approved calculation. It is not assigned a neutral zero.

## Missing Data Taxonomy

| State | Meaning | Value rule | Downstream rule |
| --- | --- | --- | --- |
| `VALID` | Meets identity, unit, time, range, and provenance requirements | Present; zero only when valid | May be consumed |
| `MISSING` | Expected datum not obtained or no record exists | Null/unavailable | No imputation unless explicitly approved |
| `INVALID` | Exists but violates range, identity, unit, timestamp, or provenance | Contracted value unavailable | Exclude and record reason |
| `STALE` | Exists but too old for intended calculation | Audit only, not fresh | Exclude or degrade only as approved |
| `INSUFFICIENT_HISTORY` | Existing observations cannot satisfy required window/sequence | Derived value null | No false signal; reduce confidence |
| `NOT_APPLICABLE` | Domain does not apply, such as OI for spot-only coin | Null | Do not penalize as a negative value |
| `AMBIGUOUS` | Multiple mappings/sources or unclear units prevent selection | Null until resolved | Do not choose silently |

Every non-`VALID` state carries a machine-readable reason and, where relevant, source attempts and timestamps.

### Missing Data vs Zero

- Missing market cap != market cap `0`.
- Missing volume != volume `0`.
- Missing OI != OI `0`.
- Missing health != health `0`.
- Missing return != return `0`.
- Missing BTC benchmark != BTC return `0`.
- No eligible observations != Breadth `0%`.
- No history != Momentum `0` or Rotation `STABLE`.

A valid zero participates normally in an approved formula. Unavailable values remain null/unavailable. Missing data reduces confidence or availability; it does not create a bearish signal.

## Freshness Contract

- `FRESH`: valid and within the component's approved maximum age or a valid historical period observation.
- `STALE`: valid but older than the approved maximum age or source status indicates inadequate refresh.
- `UNAVAILABLE`: no valid usable observation; includes `MISSING`, `INVALID`, `INSUFFICIENT_HISTORY`, and `AMBIGUOUS`, and may include `NOT_APPLICABLE` depending on output.

Closed daily candles and immutable historical results are fresh for their historical periods; collection age alone does not make historical truth stale. The one-day endpoint as-of tolerance above must be disclosed as degraded coverage. Numeric maximum-age thresholds for current market cap, OI, rolling volume, and current-display health are **REQUIRES P3 SPEC DECISION**. `source_status` is supporting evidence, not a replacement for observation timestamps.

## Confidence Contract

This defines confidence factors, not the final formula. Factors include:

- upstream Coin Health confidence;
- valid members versus eligible members;
- missing/invalid market cap and equal-weight fallback;
- missing/stale/invalid/not-applicable OI for derivative-dependent outputs;
- exact versus as-of endpoint matches;
- missing interior observations for path-dependent metrics;
- missing BTC benchmark;
- incomplete membership history;
- source failures/substitutions and unit discontinuities;
- insufficient lookback;
- ambiguous identity;
- incomplete provenance or unknown upstream version.

Rules:

1. Missing data lowers coverage/confidence; it does not lower the metric value as bearishness.
2. A required missing input makes the affected output unavailable regardless of a scalar confidence score.
3. `NOT_APPLICABLE` differs from failed collection.
4. Equal-weight fallback may be valid only when explicitly selected and recorded, with reduced weighting confidence.
5. Current-membership historical simulations are lower-confidence and not observed history.
6. Missing BTC makes RS unavailable; confidence cannot substitute for it.
7. Retain numerator/denominator, valid/excluded counts, state counts, and reasons.
8. Final confidence range/weights/formula are **REQUIRES P3 SPEC DECISION** unless later explicitly approved.

## Provenance Contract

Every persisted P3 result must identify:

- narrative and constituent coin IDs;
- UTC `window_end`, period start/end, and `calculated_at`;
- exact input observation IDs or immutable input manifest/digest;
- captured/effective membership set;
- input values, states, units, providers, observation times, and as-of substitutions;
- P0-P2 health record identities plus feature/rule versions;
- P3 algorithm name/version;
- existing `feature_version_id`, `rule_version_id`, score-config identity, and recommendation-rule version where used;
- source precedence and fallback method actually used;
- confidence factors and exclusion/unavailable reasons;
- execution/run identity and authoritative Next.js path;
- structured explanation sufficient to reproduce the result.

Reuse existing version infrastructure. A `rule_version_id` alone is insufficient because multiple P3 algorithms/configurations may share it. P3-02 must model an immutable calculation/algorithm identity binding reused version references and P3 configuration. Structured provenance is authoritative; prose explanation is supplemental.

## Historical Immutability Contract

P3 history is append-only by calculation identity:

```text
same narrative + same window + algorithm A -> result A
same narrative + same window + algorithm B -> result B
```

Result B must not overwrite result A. P3-02 must support identity including entity, output, UTC period/window, algorithm version, relevant rule/feature/config versions, and calculation mode; multiple versions for one period; immutable input/membership manifest; reprocessing as a new result with lineage; exact-identity idempotency; and query-time selection of latest approved result.

Existing date-only unique keys and `onConflictDoUpdate` behavior in health, narrative health, and Momentum do not satisfy this requirement.

## P3 Output Contract

All outputs carry `narrative_id`, UTC period/window, availability state, value/classification, confidence/coverage, algorithm/version provenance, and explanation details.

| Output | Meaning | Unit/range | Required inputs | Unavailable | Zero valid? |
| --- | --- | --- | --- | --- | --- |
| Breadth | Share with Coin Health >= 65 | Ratio/percent; counts | Captured membership and health | No authoritative set/denominator | Yes, denominator > 0 |
| Strong Breadth | Share with Coin Health >= 80 | Ratio/percent; counts | Same as Breadth | Same as Breadth | Yes |
| Momentum | Narrative Health change over 1D/3D/7D/14D | Signed health points | Narrative Health endpoints | Missing/stale/invalid/insufficient history | Yes, equal endpoints |
| Acceleration | Momentum change over approved periods | Signed change | Required Momentum observations | Any required Momentum unavailable | Yes, unchanged momentum |
| Relative Strength | Narrative return minus BTC return | Signed return spread | Matching narrative and BTC returns | BTC or narrative return unavailable | Yes, equal returns |
| Leadership | Ranked constituent contribution/strength | Ranked list plus components | Captured members and approved inputs | Required member/input unavailable | Component may be zero |
| Leadership Persistence | Stability of leaders through time | Approved score/count/classification | Immutable leadership history | Insufficient history | Formula-dependent |
| Concentration | Dominance of top constituents; Top-1/Top-3 | Ratio/percent | Members and approved weights/contributions | No valid basis/empty input | Valid balanced case only |
| Regime | Lifecycle class, e.g. Emerging/Strong/Mature/Weakening/Dead | Enum | Approved combination of P3 inputs | Mandatory input/history unavailable | Not numeric |
| Rotation | Direction/state transition through time | Enum | Current/prior immutable intelligence | Prior or inputs unavailable | Not numeric; no default Stable |
| Confidence | Reliability/completeness of output | Later-approved numeric range plus factors | Coverage, freshness, provenance | Required input may make output unavailable | Formula-dependent |
| Explanation/Provenance | Structured reason, inputs, exclusions, versions | Structured object/text | Calculation context | Must not be omitted | N/A |

Formulas not explicitly frozen by `p3.md` remain outside this data contract. Nullable values and numeric zero are never interchangeable.
## Data Availability Matrix

| Domain | Field | Source | Unit | Timestamp | Historical | Freshness | Missing | Invalid | Confidence Impact |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Narrative | ID/name/active | `narratives` | ID/text/bool | Entity timestamps; active is current | No name/status history | Current state only | Identity/eligibility unavailable | Ambiguous/missing ID | Fatal for identity; high for universe |
| Coin | ID/symbol/active | `coins` | ID/text/bool | Entity timestamps; active is current | No symbol/status history | Current state only | Coin input unavailable | Ambiguous symbol/mapping | Fatal for identity |
| Coin | Provider IDs | `coins` | Provider identifiers | Current mapping | No mapping history | Must match observation | Provider unavailable | Wrong/ambiguous mapping | High |
| Membership | Current pair | `coin_narratives` | Relationship | `created_at` only | Current set only | Current calculation | Missing relationship | Orphan/mismatch | High |
| Membership | Historical set | No complete source; health breakdown partial | ID set | Effective at `window_end` | Not reconstructable today | Immutable once captured | `INSUFFICIENT_HISTORY` | Current-as-history assumption | Fatal/severe |
| Price | OHLC close | Binance -> `market_price_daily` | Quote/base | UTC daily period | Persisted rows | Fresh for its period | Endpoint missing | Non-positive/non-finite/inconsistent OHLC | Fatal for return |
| Volume | Base candle | Binance kline `volume` | Base asset | UTC daily period | Persisted rows | Fresh for its period | Missing row | Negative/non-finite | Component-specific |
| Volume | Quote candle | Binance `quoteVolume` | Quote asset | UTC daily period | Persisted where available | Fresh for its period | Null | Negative/non-finite/wrong quote | Component-specific |
| Volume | Rolling 24h | CoinGecko/Binance snapshot fields | USD/quote by source | Provider observation + collection UTC | Sparse | Threshold requires decision | Null | Unit/source ambiguity | Reduction; no zero imputation |
| Market cap | Circulating cap | CoinGecko -> `coin_metrics` | USD | Provider as-of + collection UTC | Sparse snapshots | Threshold requires decision | Null | `<=0`, fabricated proxy, wrong source | Weight fallback/reduction |
| FDV | Fully diluted value | CoinGecko -> `coin_metrics` | USD | Provider as-of + collection UTC | Sparse | Threshold requires decision | Null | Negative/wrong identity | Never substitutes for market cap |
| OI | Current/history | Binance Futures -> collector/`coin_metrics` | Base asset quantity | Provider or collection UTC | Incomplete/sparse | Threshold requires decision | Null | Negative/non-finite/wrong instrument | Derivative-output reduction |
| Source health | Status/success/attempt | `source_status` | Enum/timestamps | UTC | Primarily latest state | Supporting evidence | Unknown | Contradictory timestamps | Confidence evidence only |
| Feature | Component scores/detail | `features` | Score/detail | UTC daily + calculation | Feature-version rows | Historical if provenance complete | Missing row | Range/version mismatch | Propagates to health |
| Coin Health | Score/confidence | `health_scores` | `[0,100]` points | UTC daily + calculation | Date history; mutable same-day | Historical period | No row/null | Range/non-finite | Fatal for health input/reduces confidence |
| Narrative Health | Score/breakdown | `narrative_health` | `[0,100]` + structured detail | UTC daily + calculation | Date history; mutable same-day | Historical period | No row | Range/empty-input zero/member mismatch | Fatal for Momentum/Regime |
| Existing Momentum | Score/type | `narrative_momentum` | `[-100,100]`/enum | Date | Mutable date rows | Historical period | Code emits zero/stable | Missing history collapsed | Cannot be adopted unchanged |
| BTC | Identity | `coins` mapping | ID | Current mapping | Mapping history absent | Must be unambiguous | Not configured | Multiple candidates | Fatal for RS |
| BTC | Close/return | Existing price history | Quote/base and return | Matching UTC windows | Only if rows exist | Endpoint rules | Endpoint missing | Invalid/mismatched basis | RS unavailable |
| Version | Feature version | `feature_versions` | ID/version | Calculation time | Existing | Immutable reference expected | Missing | Broken reference | Reproducibility reduction |
| Version | Rule version | `rule_versions` | ID/version | Calculation time | Existing | Immutable reference expected | Missing | Broken reference | Reproducibility reduction |
| Version | Score config | `score_configs` | ID/version/JSON | Calculation time | Existing | Capture exact identity | Missing | Ambiguous active config | Reproducibility reduction |
| Version | Recommendation rules | `recommendation_rules` | Ordered rule set | Calculation time | Version-linked | Capture if used | Missing when required | Order/version mismatch | Output-specific |
| P3 | `window_end` | Calculation context | UTC instant | UTC | Required | N/A | Result invalid | Non-UTC/ambiguous | Fatal |
| P3 | Availability state | Calculation | Taxonomy enum | Calculation time | Required | N/A | Must not be omitted | State/value conflict | Fatal |
| P3 | Input manifest | Persistence requirement | IDs/digest | Calculation time | Immutable | N/A | Not reproducible | Manifest mismatch | Fatal for audit |


## P3-07 Leadership and Concentration Contract

This section appends the approved P3-07 semantics and does not replace or weaken the finalized P3-06 Relative Strength/Narrative Return contract above. P3-06 remains authoritative for equal-weight Narrative Return, market-cap eligibility, Coin-USDT perpetual futures, daily close, no spot fallback, minimum `N_valid = 3`, BTC-USDT perpetual benchmark, and UTC windows.

### Leadership

- Leadership uses the `7D` UTC window only in algorithm version `1`.
- Constituents come from the captured P3 constituent snapshot; current `coin_narratives` membership is never substituted for historical membership.
- Required eligibility inputs are historical membership, valid market cap, Coin Health Score, Coin Volume Score, Coin-USDT perpetual daily-close history for 7D, and BTC-USDT perpetual daily-close history for 7D.
- Market cap is an eligibility gate only. It is not used for weighting, ranking, contribution, or tie-breaking. Missing market cap excludes the constituent. There is no spot fallback.
- Coin Momentum is the 7D Coin-USDT perpetual return: `Price_end / Price_start - 1`. Coin Relative Strength is `Coin Return_7D - BTC Return_7D`. Missing BTC makes all affected coin RS and Leadership unavailable.
- Momentum Score is `clip(50 + 2.5 * return_percent, 0, 100)`. RS Score is `clip(50 + 2.5 * rs_percent, 0, 100)`. Health and Volume reuse existing normalized `0-100` scores.
- Leader Score is `Health * 0.40 + Momentum Score * 0.25 + RS Score * 0.20 + Volume Score * 0.15`; weights are not redistributed when an input is missing.
- Missing or invalid required components exclude the constituent; partial Leader Scores are not calculated.
- At least 3 Leadership-eligible constituents are required. Below 3, Leadership and Concentration are unavailable.
- Ranking is deterministic: Leader Score descending, Health descending, Momentum Score descending, then Coin ID ascending. Rank 1 is `LEADER`; ranks 1-3 are `LEADERS`.
- `EMERGING_LEADER` requires rank > 3, Momentum Score >= 70, RS Score >= 60, and Health < 70.
- Leadership persistence is Top-3 presence over seven required daily rankings: `leader_days_7d / 7`. Fewer than seven daily observations makes persistence unavailable; missing days are not treated as non-leader days.

### Concentration

- Concentration uses the complete Leadership-eligible population and Leader Scores only.
- Constituent contribution is `Leader Score_i / sum(all eligible Leader Scores)`. Market cap, raw return, Health alone, Volume alone, and current portfolio weights are not used.
- Top-1 is the maximum contribution (equivalently rank-1 contribution). Top-3 is the sum of ranks 1-3 contributions.
- At least 3 eligible constituents are required. Exactly 3 valid constituents produce Top-3 = 1.0, which is valid.
- Classification boundaries are: `< 0.40` Broad; `>= 0.40 and < 0.55` Moderate; `>= 0.55 and <= 0.70` Concentrated; `> 0.70` Highly Concentrated.
- Missing or invalid leadership inputs exclude constituents before the concentration denominator. Missing is never converted to zero.

### P3-07 Provenance and Persistence

P3-07 persists through the shared P3 insert-only persistence boundary with algorithm key `leadership-concentration` and algorithm version `1`. Provenance records the snapshot, 7D UTC window, perpetual instruments, BTC benchmark, health/volume inputs, normalized component scores, ranking, exclusions, contributions, classification, and existing rule/feature/configuration version references.


## Rules For P3 Implementation Agents

1. Do not fabricate data.
2. Do not treat missing, invalid, stale, insufficient, ambiguous, or not-applicable data as zero.
3. Do not treat unavailable data as bearish.
4. Use `Asia/Ho_Chi_Minh` only for scheduler trigger semantics.
5. Use UTC for observations, windows, calculations, persistence, and history.
6. Use BTC as the sole Relative Strength benchmark.
7. If BTC is unavailable, mark RS unavailable; do not substitute a benchmark or zero return.
8. Reuse existing coin, market-data, health, snapshot, collector, and version infrastructure.
9. Preserve source, unit, observation/collection time, state, and fallback method.
10. Preserve historical immutability; do not overwrite older algorithm/version results.
11. Do not silently substitute current membership for historical membership.
12. Do not silently exclude members without retaining denominator and exclusion details.
13. Do not create duplicate ingestion pipelines, Momentum engines, or Rule engines.
14. Do not consume volume/price-derived approximations as market cap.
15. Do not combine spot and futures series without explicit labeling and an approved formula.
16. Do not default unavailable enum outputs to `WEAK`, `DEAD`, `STABLE`, or another meaningful class.
17. Do not infer freshness from row existence or `date` alone.
18. Fail only the affected component explicitly when its mandatory input is unavailable; independent components may still calculate under their own states.

## Existing Repository Gaps

1. `coin_narratives` has no effective dating, removal history, or immutable snapshots.
2. Narrative and coin active-status history is not retained.
3. BTC is not guaranteed by seed/configuration.
4. Market-cap persistence can contain invalid volume/price approximations.
5. `coin_metrics.date` mixes daily labels with point-in-time market cap/OI and lacks provider observation time.
6. OI history is not persisted as a complete timestamped series.
7. Coin Health, Narrative Health, and Momentum use date-level keys and mutable upserts.
8. Existing Momentum converts insufficient history into `0`/`stable`, uses the last seven rows rather than guaranteed UTC calendar endpoints, and lacks complete version provenance.
9. Empty narrative-health input currently yields `0`/`WEAK`.
10. Timestamp/date helpers are not consistently UTC; some Next.js refresh/snapshot behavior uses `Asia/Ho_Chi_Minh` business-date helpers.
11. `source_status` primarily retains latest state, not complete attempt history.
12. `src/db/schema.ts` and `drizzle/schema.ts` are parallel definitions that future schema work must keep synchronized.
13. FastAPI mirrors legacy refresh logic and can diverge, but may not own P3.

## Risks

- Historical results become irreproducible if membership is not captured.
- Approximate market caps can contaminate weighting unless provenance is validated.
- Scheduler/local-date leakage can shift UTC windows and create false deltas.
- Date-only snapshots can overstate freshness.
- Mutable upserts can erase results after algorithm/config changes.
- Futures/spot source changes can create discontinuities.
- Missing BTC configuration can make all RS unavailable.
- Legacy Momentum/API consumers may confuse unavailable with zero/stable.
- A scalar confidence without structured factors can conceal severe coverage gaps.

## Open Issues

1. Numeric maximum-age thresholds for current market cap, OI, rolling volume, and current-display health: **REQUIRES P3 SPEC DECISION**.
2. Final numeric P3 confidence range, weights, and formula: **REQUIRES P3 SPEC DECISION**.
3. Physical choice between effective-dated membership and captured member set per calculation.
4. Exact immutable P3 algorithm/config artifact binding existing versions.
5. Approved construction of narrative price return for Relative Strength if no authoritative precomputed series exists.
6. Deterministic/versioned source precedence when both Binance Futures and Spot are usable.
7. Compatibility policy for legacy `narrative_momentum` and its API without a duplicate engine.
8. Whether local-time morning snapshots remain reporting-only artifacts; they are not P3 data-time authority.

## Implementation Issues Discovered

- Next.js refresh contains market-cap estimates based on volume multiplied by price; these are invalid P3 market cap.
- Existing Momentum emits zero/stable for insufficient history.
- Current daily upserts overwrite same-period calculations.
- Full authoritative refresh does not clearly persist Narrative Momentum on every run.
- FastAPI remains a divergent legacy fallback and must not be extended with P3.

These issues are documented only and were not fixed in P3-01.

## Implementation Boundary

P3-01 changes documentation only. It does not:

- create/alter tables, migrations, Drizzle schema, or SQLAlchemy models;
- implement Breadth, Momentum, Acceleration, Relative Strength, Leadership, Concentration, Regime, or Rotation;
- modify APIs, dashboard, scheduler, collectors, refresh, ingestion, or scoring;
- refactor existing Momentum;
- create a new rule/version framework.

P3-02 may design a schema satisfying this contract after review. It must not reinterpret these semantics.

## Next Task

```text
P3-02 â€” P3 Schema Design
```

Do not begin P3-02 until this contract is reviewed and accepted.