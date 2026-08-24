# P6-01D-C1 Data Quality Planner Decision Inventory

**Date:** 2026-08-24
**Task Type:** PLANNING / EVIDENCE ONLY — NO SEMANTIC DECISIONS, NO IMPLEMENTATION
**Authority Base:** P6-01D-B Data Quality Contract (FROZEN), P6-01D-A Recon (FROZEN)
**Planner Decisions Inventoried:** PD-01 … PD-18 (verified against frozen contract)

---

## 1. Purpose

This document gives the Planner a complete, evidence-based inventory of every Planner Decision declared in the frozen P6-01D-B Data Quality Contract, so that decisions can be made **without repeating repository reconnaissance**.

For each decision this report provides:

1. the exact question to be decided;
2. why it is unresolved;
3. repository evidence (classified by evidence type);
4. current behavior;
5. logically possible candidate options (NOT selected);
6. constraining invariants/contracts;
7. dependencies on other decisions;
8. likely future implementation surface;
9. deferral impact;
10. implementation-blocking classification.

**The Agent has made NO semantic decisions in this document.** All options are listed neutrally.

---

## 2. Scope

In scope:

- The 18 PDs exactly as declared in `P6-01D-B_DATA_QUALITY_CONTRACT.md` §26 (verified verbatim from the frozen file).
- Repository evidence needed to characterize each decision.
- Mandatory special analyses: NUMERIC_PARSE, zero/negative values, OHLC group availability, timestamps, entity resolution, duplicates, cross-source consistency, computation timing, existing signal coexistence.

Out of scope:

- Selecting any option for any PD.
- Inventing thresholds, ranges, or policies.
- Any production/schema/API/test change.
- A second full repository audit (P6-01D-A remains authoritative for general behavior).

---

## 3. Authority and Frozen Boundaries

| Authority | Status | Relevance |
|---|---|---|
| P6-01B Observation Contract | FROZEN | Identity `(entity_id, metric, source, observed_at, timeframe)`; observed_at UNKNOWN semantics; PRICE = alias of CLOSE |
| P6-01C Source Registry + Freshness | FROZEN | Sources BINANCE_SPOT / BINANCE_FUTURES / COINGECKO; freshness FRESH/STALE/UNKNOWN; config versioning pattern |
| P6-01C-E Freshness V1 Decision | FROZEN | DAILY 24h/36h, 4H 4h/6h; zero SOURCE_SNAPSHOT policies |
| P6-01D-A Recon | FROZEN | Current-behavior evidence baseline |
| P6-01D-B Contract | FROZEN | Quality vocabulary VALID/INVALID/MISSING/UNKNOWN; evidence-only outcomes; OHLC validation group; no-auto-correction; DQ-01…DQ-22 (+DQ-07a, DQ-11a) |

Frozen constraints that bound EVERY decision below:

- **DQ-01/DQ-02:** vocabulary is fixed; no new states.
- **DQ-03/DQ-04:** quality ⟂ freshness independence.
- **DQ-05/DQ-07a:** FAIL is evidence only; deferred mappings must be external configuration.
- **DQ-08/DQ-09:** absence and source failure → MISSING, never INVALID.
- **DQ-10/DQ-11:** UNKNOWN reserved for assessment-capability failure; malformed-present values follow the NUMERIC_PARSE path.
- **DQ-12:** no auto-correction of observations.
- **DQ-14:** collected_at never substitutes observed_at.
- **DQ-15:** identity untouched.
- **DQ-18:** no duplicate remediation absent Planner decision.
- **DQ-20:** no P4/P5 semantics.
- **DQ-21:** rule values live in declarative configuration.

---

## 4. Methodology

1. Read the frozen contract §26 and extract the actual PD list (PD-01…PD-18) — verified verbatim, not assumed from prior reports.
2. For each PD, gather only the repository evidence that characterizes it, reusing the FROZEN P6-01D-A recon as the behavioral baseline and spot-verifying live code where cited.
3. Classify every finding as one of:
   - **CODE EVIDENCE**
   - **SCHEMA / MIGRATION EVIDENCE**
   - **TEST EVIDENCE**
   - **DOCUMENTED CONTRACT EVIDENCE**
   - **EXTERNAL SOURCE API SHAPE EVIDENCE** (only as represented in repo code/docs)
   - **NO EVIDENCE**
4. Group PDs logically; build dependency graph, priority classification, and deferral analysis.
5. Verify git boundary: documentation-only change.

Labels used consistently: `FROZEN`, `CURRENT IMPLEMENTATION`, `CANDIDATE OPTION`, `NO EVIDENCE`, `PLANNER DECISION REQUIRED`.

---

## 5. Decision Inventory Summary

| Group | Decisions | Theme |
|---|---|---|
| A. Classification Semantics | PD-01, PD-02 | What INVALID means per metric; malformed-value final mapping |
| B. Metric / Numeric Domain Rules | PD-04, PD-05, PD-06 | Sign policy, zero policy, funding-rate range |
| C. OHLC Cross-Observation Validation | PD-03 | Violation propagation scope over the validation group |
| D. Temporal / Timestamp Validation | PD-07, PD-08 | Future / historical timestamp tolerance |
| E. Entity / Source Resolution | PD-09 | Entity-resolution failure classification |
| F. Identity / Duplicate / Consistency | PD-10, PD-11 | Duplicate remediation; cross-source consistency signal |
| G. Quality Computation Architecture | PD-12 | Write-time vs read-time vs hybrid evaluation |
| H. Persistence / History / Versioning | PD-13, PD-17 | Quality storage model; retention/history |
| I. Downstream Interaction / Aggregation | PD-14, PD-15 | Feature-engine gating; field→observation aggregation formula |
| J. Existing Signal Coexistence & Values | PD-16, PD-18 | Coexistence with existing signals; concrete rule values |

---

## 6. Master Decision Matrix

| ID | Decision Name | Exact Question | Current Behavior | Evidence Type | Evidence Location | Candidate Options (NOT selected) | Constraining Contracts | Dependencies | Implementation Impact | Deferral Impact | Planner Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| PD-01 | INVALID rules per metric | Which conditions make each metric INVALID (negative price, zero price, NaN-after-parse, etc.)? | No numeric validation anywhere; NaN/Infinity rejected only implicitly by PostgreSQL decimal insert; coin-level skip on DB error | CODE EVIDENCE | `src/lib/collectors/binance.ts`, `src/lib/collectors/coingecko.ts`, `src/app/api/refresh/route.ts` (P6-01D-A §8) | Strict reject / lenient flag / per-metric matrix | DQ-01, DQ-05, DQ-07a, DQ-08, DQ-12, DQ-21 | Upstream of PD-02, PD-04–06, PD-15, PD-18 | Pure validator + rule configuration | V1 cannot classify INVALID at all → evaluator would produce only MISSING/UNKNOWN | BLOCKING FOR V1 IMPLEMENTATION |
| PD-02 | Malformed value final mapping | Present-but-unparseable value (NUMERIC_PARSE FAIL): final state INVALID or MISSING? | parseFloat without checks; NaN reaches PostgreSQL which rejects at insert → whole-coin processing fails via try/catch | CODE EVIDENCE | `parseFloat(response.data.openInterest)`, `parseFloat(...lastFundingRate)` in `src/lib/collectors/binance.ts`; DB rejection path in refresh route (P6-01D-A §8.2) | INVALID / MISSING (automatic UNKNOWN excluded — FROZEN by contract §9) | DQ-07a, DQ-10, DQ-11, §9 malformed-value block, §11.4 | Depends on PD-01 shape; upstream of PD-18 tests | NUMERIC_PARSE check + mapping config | Parse-fail cases unclassifiable → fall back to UNKNOWN-like behavior, weakening V1 core | BLOCKING FOR V1 IMPLEMENTATION |
| PD-03 | OHLC violation scope | On group relational violation, mark violating pair, all four OHLC members, or whole observation? | No OHLC relationship validation exists anywhere | CODE EVIDENCE | Refresh route persists klines directly pre-insert (P6-01D-A §9); no check IDs exist | Pair / OHLC set / whole observation | DQ-07a, DQ-11a, §12.3 (all-members-present precondition) | Refines PD-01; feeds PD-15, PD-18 | Group-level validator + evidence records citing group key | Field-level V1 can ship without group checks; group checks additive later | IMPORTANT BUT DEFERRABLE |
| PD-04 | Negative-value policy | Negative VOLUME / QUOTE_VOLUME / MARKET_CAP / FDV / OPEN_INTEREST: INVALID or other state? | Not checked; PostgreSQL allows negative decimals; sources should never return negatives (unverified guarantee) | CODE EVIDENCE + EXTERNAL SOURCE API SHAPE EVIDENCE | Schema nullable decimals (`src/db/schema.ts`); collector pass-through (P6-01D-A §8.4 table) | INVALID / UNKNOWN / per-metric matrix | DQ-01, DQ-05, DQ-07a, DQ-21 | Refines PD-01; feeds PD-15, PD-18 | NUMERIC_SIGN checks + config | Sign anomalies undetected in V1; additive later | IMPORTANT BUT DEFERRABLE |
| PD-05 | Zero-value policy | Zero per metric: legitimate (VOLUME/OI/neutral FR) or anomalous (prices/MC/FDV)? | Only one guard exists: `marketCapToSave > 0` filter in refresh route (CoinGecko MC path); all other zeros accepted | CODE EVIDENCE | `src/app/api/refresh/route.ts` marketCap guard (P6-01D-A §8.5) | Per-metric allow/deny matrix | DQ-01, DQ-05, DQ-07a, DQ-21 | Refines PD-01; feeds PD-15, PD-18 | NUMERIC_RANGE/sign-adjacent checks + config | Zero anomalies undetected; additive later | IMPORTANT BUT DEFERRABLE |
| PD-06 | FUNDING_RATE range bounds | What range is acceptable given negative-normal semantics? | Accepted unchecked; extreme values persisted | CODE EVIDENCE + EXTERNAL SOURCE API SHAPE EVIDENCE | `fetchBinanceFundingRate` in binance.ts (P6-01D-A §5.10) | Symmetric bound / percentile-based / none | DQ-01, DQ-05, DQ-07a, DQ-21; recon fact "negative is normal" | Refines PD-01; feeds PD-18 | NUMERIC_RANGE config for FR only | Garbage rates undetected; additive later | IMPORTANT BUT DEFERRABLE |
| PD-07 | Future-timestamp tolerance | How far in future may a timestamp be before failing a temporal check? | No timestamp validation; future openTime accepted; observed_at not stored; SOURCE_SNAPSHOT observed_at = UNKNOWN | CODE EVIDENCE + DOCUMENTED CONTRACT EVIDENCE | Kline openTime handling in refresh route; P6-01C-E1 (observed_at UNKNOWN for all snapshot metrics) | Tolerance window / hard reject / warn-only | DQ-13, DQ-14, DQ-21; P6-01B temporal authority | Feeds PD-18; independent otherwise | Temporal checks + config | Temporal anomalies undetected in V1; additive later | IMPORTANT BUT DEFERRABLE |
| PD-08 | Historical-timestamp tolerance | How old may a timestamp be before failing? | Same as PD-07 — nothing checked | CODE EVIDENCE | As PD-07 | Window / none | DQ-13, DQ-14, DQ-21 | Feeds PD-18; independent | As PD-07 | As PD-07 | IMPORTANT BUT DEFERRABLE |
| PD-09 | Entity-resolution failure classification | Unknown symbol / missing mapping → MISSING or dedicated entity-check FAIL? | Silent skip: console.warn + no data + source_status=FAILED; no explicit "entity not found" quality signal | CODE EVIDENCE | Refresh route symbol guards; coins table mapping columns (P6-01D-A §11) | MISSING / INVALID / separate status (new state NOT allowed — must map into frozen vocabulary) | DQ-01 (vocabulary cap), DQ-09, registry coverage model (P6-01C-B) | Independent; interacts with PD-16 (source_status overlap) | Evidence records on collection skip paths | Coverage gaps invisible to quality in V1; additive later | IMPORTANT BUT DEFERRABLE |
| PD-10 | Duplicate remediation policy | Detect-only vs merge vs keep-latest on semantic identity collision? | DB upsert keep-latest via unique constraints; `market_price_daily` unique (coinId,date) lacks source → cross-source overwrite possible | SCHEMA/MIGRATION EVIDENCE | Unique indexes in `src/db/schema.ts`, base migration (P6-01D-A §12, §15.3) | Detect-only / merge / keep-latest formalized | DQ-18 (no remediation absent decision); P6-01B identity | Independent | Collision detection/evidence only | Current DB upsert continues unchanged; quality layer reports collisions only | FUTURE-SCOPE / NON-BLOCKING |
| PD-11 | Cross-source consistency as quality signal? | Should Spot-vs-Futures disagreement for same metric/entity/window be flagged? | No comparison at write time. At READ time, `coins/[id]` API merges coin_metrics rows across sources with null-coalescing (first non-null wins) — implicit reconciliation with no consistency check | CODE EVIDENCE | `src/app/api/coins/[id]/route.ts` latestMetrics reduce-merge (~lines 112–150); refresh route Spot/Futures selection (P6-01D-A §13) | On / off / advisory-only | DQ-03, DQ-19, DQ-20; read-model must not change silently | Independent; conceptually adjacent to PD-03 groups | Cross-source comparator (future) | No corruption detection across sources in V1 | FUTURE-SCOPE / NON-BLOCKING |
| PD-12 | Quality computation timing | Write-time, read-time, or hybrid classification? | N/A — quality does not exist yet. Lifecycle points available: collector return, normalization in refresh route, pre-insert, post-select read paths, feature engine input | CODE EVIDENCE (lifecycle surfaces) | Collector functions; refresh route pipeline; feature engine entry (`src/lib/features/engine.ts`) | Write / read / hybrid | DQ-16 (version recorded), DQ-21 (config-driven), §24 | Upstream of PD-13, PD-16, PD-14 architecture | Determines where evaluator hooks live | No implementation design can proceed — architecture fork unresolved | BLOCKING FOR V1 IMPLEMENTATION |
| PD-13 | Quality persistence model | Inline column, side table, or computed-on-read? | N/A — no storage exists; contract requires joinability to P6-01B identity (§20.2) | DOCUMENTED CONTRACT EVIDENCE | P6-01D-B §20 | Inline / side-table / virtual | §20 boundary; no tables authorized by contract itself | Depends on PD-12; upstream of migrations in P6-01D-D | Drizzle schema/migration (additive) | Storage-dependent code cannot be written; blocks schema work | BLOCKING FOR V1 IMPLEMENTATION |
| PD-14 | Feature engine gating on quality | Additive exposure only, gating, or weighted consumption? | Feature engine consumes stored values with no validity awareness; single sufficiency guard (<20 rows → neutral 50 + error flag) | CODE EVIDENCE | `src/lib/features/engine.ts`, `calculator.ts` preparePriceSeries (P6-01D-A §13.2, §18.1) | Additive only / gating / weighted | DQ-20 (no P4/P5 change); §21.2 (MUST NOT silently change computations) | Depends on PD-15 (needs aggregate status to gate meaningfully) | Feature-engine adapter (only if gating chosen) | V1 ships additive-only; downstream blind to INVALID but safe | IMPORTANT BUT DEFERRABLE |
| PD-15 | Aggregation formula | How do field statuses combine into an observation-level status? | N/A — no statuses exist. Contract leaves formula open (§16.4) | DOCUMENTED CONTRACT EVIDENCE | P6-01D-B §16, §6 | All-present-valid / threshold-based / worst-case-wins | DQ-19 (field independence), DQ-05, DQ-07a | Depends on PD-01…PD-05 field statuses; upstream of PD-14, any single-status consumer | Aggregation function + tests | Field-level V1 works without aggregate; consumers needing single status wait | IMPORTANT BUT DEFERRABLE |
| PD-16 | Coexistence with existing signals | Coexist / extend / replace relative to `source_status`, `dataCompleteness`, `missingSources`, `confidenceScore`? | All four signals live and consumed (see §11 analysis); none will be modified by P6-01D per contract §22 | CODE EVIDENCE | `source_status` writes in refresh route; features.dataCompleteness/missingSources/confidenceScore in feature engine + health_scores.confidenceScore consumer in `src/app/api/coins/[id]/route.ts`; Square `data_quality` (separate concern) | Coexist / extend / replace | DQ-20; §22.3 (existing inputs keep semantics); SD-10/SD-12/SD-13 from recon | Depends on PD-12 (timing determines touchpoints) | Naming/integration conventions only in V1 | Ambiguity risk between overlapping signals persists; no functional block | IMPORTANT BUT DEFERRABLE |
| PD-17 | Retention/history of classifications | Keep history of classifications + rule-set versions, or latest-only? | N/A — no classifications exist; freshness precedent: historical replay explicitly NOT implemented | DOCUMENTED CONTRACT EVIDENCE | P6-01D-B §24.3; P6-01C freshness open item | Keep history / latest-only | §24.5 (no retroactive rewrite w/o authorization); DQ-16/DQ-17 | Depends on PD-13 storage choice | Retention policy + optional pruning | Latest-only default acceptable for V1; history purely additive later | FUTURE-SCOPE / NON-BLOCKING |
| PD-18 | Concrete rule values | Actual numbers (ranges, bounds, tolerances) once shapes PD-01…08 chosen | NO EVIDENCE — no authoritative P6 document defines any quality threshold value; freshness thresholds are the only frozen numbers and are dimension-inappropriate | NO EVIDENCE | — | Deferred until shapes frozen (per contract) | DQ-21 (config not code); task prohibition on invented values | Downstream of PD-01…PD-08 | Rule configuration content | Checks whose values are missing simply remain unconfigured/unresolved (mirrors freshness empty-policy precedent) | BLOCKING FOR V1 IMPLEMENTATION *(for whichever checks enter V1 scope)* |

---

## 7. Group A — Classification Semantics

### PD-01 — INVALID rules per metric

- **Exact question:** What constitutes INVALID for each of the 10 canonical metrics?
- **Why unresolved:** P6-01B defined the vocabulary but explicitly left VALID/INVALID trigger conditions to Planner (SD-01 from recon carried forward). P6-01D-B froze state semantics and the evidence path, not the triggers.
- **CURRENT IMPLEMENTATION:** Zero application-level numeric validation. The only de facto invalidity mechanism is PostgreSQL decimal type rejection (NaN/Infinity/non-numeric string) at insert time, which throws, is caught by the per-coin try/catch, skips the entire coin, and marks `source_status=FAILED`. There is no field-level outcome.
- **Evidence:** CODE EVIDENCE — collectors (`src/lib/collectors/binance.ts`: raw `as string` casts, bare `parseFloat`), refresh route persistence path, schema (`src/db/schema.ts` decimal columns, no CHECK constraints on market tables). TEST EVIDENCE — none (zero quality tests exist; P6-01D-A §17).
- **CANDIDATE OPTIONS:** strict reject (any violation → INVALID), lenient flag (violation recorded, status contextual), per-metric matrix (each metric gets its own rule set).
- **Constrained by:** DQ-01, DQ-05 (INVALID needs executed FAIL), DQ-07a (mapping external), DQ-08/DQ-09 (absence/failure ≠ INVALID), DQ-12, DQ-21.
- **Dependencies:** upstream of PD-02 (parse mapping is one branch of it), PD-04/05/06 (metric-domain refinements), PD-15 (aggregation consumes statuses), PD-18 (values).
- **Implementation impact:** pure validator module + declarative rule configuration; canonical observation adapter.
- **Deferral:** Cannot defer — without it the evaluator cannot emit INVALID for any case; V1 degenerates to MISSING-detection only.
- **Priority:** BLOCKING FOR V1 IMPLEMENTATION.

### PD-02 — Malformed value final mapping

- **Exact question:** For a present-but-unparseable value (NUMERIC_PARSE executes, outcome FAIL), is the final classification INVALID or MISSING?
- **Why unresolved:** Frozen contract §9 deliberately fixed the *evidence path* (present → check runs → FAIL) but deferred the *final mapping* to avoid deciding semantics prematurely. Automatic UNKNOWN was excluded (FROZEN).
- **CURRENT IMPLEMENTATION (NUMERIC_PARSE trace):**

```text
source value (string from Binance / number-or-null from CoinGecko)
    ↓
parseFloat() — bare, no NaN/Infinity check
    locations: fetchBinanceFuturesOI (openInterest),
               fetchBinanceFundingRate (lastFundingRate),
               refresh route (quoteVolume, lastPrice ×2)
    ↓
NaN propagates in JS (no guard)
    ↓
DB persistence: PostgreSQL decimal REJECTS NaN/Infinity/non-numeric
    → INSERT THROWS
    ↓
current failure behavior: per-coin try/catch catches,
    ENTIRE COIN skipped for cycle, source_status=FAILED
```

- **Evidence:** CODE EVIDENCE — exact parseFloat sites enumerated in P6-01D-A §8.1; SCHEMA/MIGRATION EVIDENCE — decimal column types reject non-numerics; TEST EVIDENCE — none.
- **CANDIDATE OPTIONS:** INVALID (value existed but unusable) / MISSING (treat unusable-as-absent). Automatic UNKNOWN is contract-excluded.
- **Constrained by:** DQ-07a, DQ-10, DQ-11, contract §9 malformed-value block (FROZEN path), §11.4.
- **Dependencies:** refinement branch of PD-01; upstream of PD-18 test values.
- **Implementation impact:** NUMERIC_PARSE check implementation + one mapping rule in configuration.
- **Deferral:** Without it, parse failures have no assigned state — the most common real-world anomaly path is unclassifiable.
- **Priority:** BLOCKING FOR V1 IMPLEMENTATION.

---

## 8. Group B — Metric / Numeric Domain Rules

### PD-04 — Negative-value policy

Per-metric current behavior (evidence-separated):

| Metric | Mathematical plausibility | Source behavior (as represented in repo) | Current app behavior | CANDIDATE OPTIONS space |
|---|---|---|---|---|
| VOLUME | Never negative | Binance returns non-negative strings; NOT guaranteed by code | Accepted unchecked | INVALID / UNKNOWN / allow-flag |
| QUOTE_VOLUME | Never negative | Same | Accepted; column nullable | same |
| MARKET_CAP | Never negative | CoinGecko number/null | Only `> 0` guard on CoinGecko path; Binance-derived path unguarded for sign | same |
| FDV | Never negative | CoinGecko number/null (`?.` chain) | Accepted unchecked | same |
| OPEN_INTEREST | Never negative | `parseFloat(openInterest)` bare | Accepted unchecked; NaN risk | same |

- **Evidence:** CODE EVIDENCE + EXTERNAL SOURCE API SHAPE EVIDENCE (P6-01D-A §8.4).
- **Constrained by:** DQ-01, DQ-05, DQ-07a, DQ-21. Note: FUNDING_RATE is deliberately EXCLUDED here (legitimately negative — handled by PD-06/recon fact).
- **Dependencies:** refines PD-01; feeds PD-15, PD-18.
- **Impact / deferral / priority:** NUMERIC_SIGN checks + config; deferral leaves sign anomalies undetected (additive later); IMPORTANT BUT DEFERRABLE.

### PD-05 — Zero-value policy

| Metric | Zero plausible? | Current handling |
|---|---|---|
| OPEN/HIGH/LOW/CLOSE | No (normal trading) | Accepted |
| VOLUME / QUOTE_VOLUME | Yes (paused/delisted pairs) | Accepted |
| MARKET_CAP | Anomalous | Filtered by `>0` on CoinGecko path ONLY (CODE EVIDENCE, refresh route) |
| FDV | Unusual | Accepted |
| OPEN_INTEREST | Yes (new/delisted contracts) | Accepted |
| FUNDING_RATE | Yes (neutral funding) | Accepted |

Options: per-metric allow/deny matrix (contract wording). Constrained identically to PD-04. IMPORTANT BUT DEFERRABLE.

### PD-06 — FUNDING_RATE range bounds

- CURRENT IMPLEMENTATION: bare `parseFloat(lastFundingRate)`, accepted unchecked; negative normal, extremes unchecked. EXTERNAL SOURCE API SHAPE EVIDENCE: premiumIndex payload also carries a discarded `time` field (P6-01C-E1 finding — relevant if Planner later couples temporal checks).
- Options: symmetric absolute bound / percentile-derived / none.
- IMPORTANT BUT DEFERRABLE.

---

## 9. Group C — OHLC Cross-Observation Validation

### PD-03 — Violation scope

**Frozen group context (P6-01D-B §12):**

```text
group_key = (entity_id, source, observed_at, timeframe)
members   = {OPEN, HIGH, LOW, CLOSE}
```

**Availability evidence (does the group currently exist?):**

1. All four members ARE produced together by one kline row: each Binance kline carries open/high/low/close mapped from indices 1–4 (CODE EVIDENCE, collectors + refresh route formatting loop).
2. Time alignment: all four share one kline `openTime`; business date derived via `getBusinessDate()` (Asia/Ho_Chi_Minh). So within one persisted row, group membership is trivially satisfiable.
3. BUT `observed_at` is NOT persisted today (only business `date`), and the storage row collapses the four observations into one physical record with identity `(coinId, date)` lacking `source`. Reconstructing the frozen group key therefore requires either the P6 observation layer (future) or deriving key components from current columns (entity_id≈coinId, timeframe=DAILY implied, observed_at≈UNKNOWN→date proxy — a semantic question the Planner must NOT let slide silently if group checks are scheduled before observation persistence exists).
4. Partial OHLC behavior: schema declares open/high/low/close NOT NULL — partial OHLC cannot persist in `market_price_daily`; it manifests upstream as a failed insert → whole-coin skip (SCHEMA EVIDENCE).

**INSUFFICIENT EVIDENCE — PLANNER DECISION REQUIRED** on whether group checks may operate against the coarse current storage or must await observation-level persistence. This sequencing fact materially affects when PD-03 can be implemented.

- Options (frozen list): pair / OHLC set / whole observation.
- Priority: IMPORTANT BUT DEFERRABLE (field-level V1 unaffected).

---

## 10. Group D — Temporal / Timestamp Validation

### PD-07 / PD-08 — Future / historical tolerance

**Quality-vs-freshness separation (FROZEN):** freshness already owns age-based staleness under configured policies (DAILY 24h/36h etc.). PD-07/PD-08 concern *structural/anomalous* timestamps on observations that exist — a distinct concern. They MUST NOT duplicate freshness logic (DQ-03).

Current handling inventory:

| Case | Current behavior | Evidence |
|---|---|---|
| Missing timestamp | Klines always carry openTime (index 0); SOURCE_SNAPSHOT metrics have none → observed_at = UNKNOWN (FROZEN under P6-01C-E1) | CODE + CONTRACT |
| Malformed timestamp | Would fail `new Date()` conversion → caught upstream as coin error; no dedicated classification | CODE |
| Future timestamp | Accepted silently | CODE |
| Historical timestamp | Accepted silently | CODE |
| Timezone | `getBusinessDate()` buckets to Asia/Ho_Chi_Minh; applied to klines only | CODE |

Options: tolerance window / hard reject / warn-only (PD-07); window / none (PD-08). Values → PD-18. IMPORTANT BUT DEFERRABLE both.

---

## 11. Group E — Entity / Source Resolution

### PD-09 — Entity-resolution failure classification

Trace (CODE EVIDENCE):

```text
coins.binanceSpotSymbol / binanceFuturesSymbol+hasFutures / coingeckoId
    ↓ missing?
console.warn + skip that source's collection
    ↓
source_status = FAILED (operational signal)
    ↓
fields absent → today: silent absence; tomorrow: MISSING candidates
```

Invalid-but-configured symbols: passed straight to API → HTTP 4xx → catch → empty result → same skip path. Symbol mismatch across sources: never validated (admin metadata trusted).

Registry linkage: P6-01C-B coverage requirements (`binanceSpotSymbol`, `binanceFuturesSymbol+hasFutures`, `coingeckoId`) give the quality layer a declarative reference for WHY a field is absent — reusable regardless of final classification.

Options: MISSING / INVALID / separate-status (note: any "separate" outcome must still land in the frozen 4-state vocabulary — DQ-01 caps expressiveness; the realistic reading is *which evidence/check* produces the state, not a new state). IMPORTANT BUT DEFERRABLE.

---

## 12. Group F — Identity / Duplicate / Consistency

### PD-10 — Duplicate remediation

Canonical identity (FROZEN, P6-01B): `(entity_id, metric, source, observed_at, timeframe)`.
Current DB uniqueness (SCHEMA EVIDENCE):

| Table | Unique constraint | Gap vs canonical identity |
|---|---|---|
| `market_price_daily` | (coinId, date) | no source, no metric granularity, no observed_at |
| `coin_metrics` | (coinId, date, source) | no metric granularity, no observed_at |

Consequence: repeated runs upsert-overwrite (keep-latest de facto); Futures can overwrite Spot in `market_price_daily`. Quality layer's role is detect-and-report only until decided (DQ-18). Options: detect-only / merge / keep-latest-formalized. FUTURE-SCOPE / NON-BLOCKING.

### PD-11 — Cross-source consistency

Write-time: no comparison anywhere; refresh route selects Spot vs Futures per availability (operational fallback, NOT quality reconciliation — and explicitly out of P6 scope per P6-01C prohibitions).
Read-time discovery: `src/app/api/coins/[id]/route.ts` merges `coin_metrics` rows across sources for the latest date using null-coalescing reduce (`merged.X ?? row.X`, ~lines 132–150) — first-non-null-wins with no agreement check. This is the only place multiple sources meet.
Options: on / off / advisory-only. FUTURE-SCOPE / NON-BLOCKING.

---

## 13. Group G — Quality Computation Architecture

### PD-12 — Computation timing

Lifecycle points where classification could theoretically evaluate (all CODE EVIDENCE):

| Point | Surface | Trade-off character (not a recommendation) |
|---|---|---|
| collector-time | inside collector functions | earliest evidence; touches files under collector-isolation norms |
| normalization-time | refresh route transform loop | sees formatted values pre-persist |
| persistence-time | pre/post insert in refresh route | strongest evidence completeness; write-path coupling |
| read-time | API/read models | zero write coupling; recomputation cost; identity reconstruction issues (see PD-03 note) |
| feature-calculation-time | feature engine entry | too late for observation-level truth; useful for gating (PD-14) |
| snapshot-time | health/snapshot writers | downstream again |

Options: write / read / hybrid. Without a choice, no evaluator placement, no migration plan, and no test harness shape can be designed. BLOCKING FOR V1 IMPLEMENTATION.

---

## 14. Group H — Persistence / History / Versioning

### PD-13 — Persistence model

Contract §20 requires joinability to P6-01B identity and forbids modifying existing tables. Options inline-column / side-table / computed map directly onto whether P6-01D-D ships a migration. BLOCKING FOR V1 IMPLEMENTATION (schema work impossible until chosen).

### PD-17 — Retention/history

Freshness precedent: replay/version-history explicitly NOT implemented (P6-01C-C open item). Contract §24.5 forbids retroactive rewrites without authorization. Options: keep-history / latest-only. FUTURE-SCOPE / NON-BLOCKING.

---

## 15. Group I — Downstream Interaction / Aggregation

### PD-14 — Feature engine gating

CURRENT IMPLEMENTATION: engine trusts inputs fully; single guard `< 20 rows → neutral 50 + error`; OI/FR null → neutral derivative path with `no_futures` flag (CODE EVIDENCE, engine/calculator/derivative). Options: additive-only / gating / weighted. Gating requires PD-15's aggregate status to be meaningful; frozen contract permits additive exposure now. IMPORTANT BUT DEFERRABLE.

### PD-15 — Aggregation formula

Depends on field statuses existing (PD-01…PD-05). Options: all-present-valid / threshold / worst-case. Constrained by DQ-19 (field independence) and DQ-05/DQ-07a. IMPORTANT BUT DEFERRABLE.

---

## 16. Group J — Existing Signal Coexistence & Rule Values

### PD-16 — Coexistence strategy

Existing-signal interaction analysis is consolidated in Section 18 below (mandatory special analysis). Options: coexist / extend / replace. Frozen constraint: §22.3 — existing P4/P5 inputs keep semantics; nothing forces replacement in V1. IMPORTANT BUT DEFERRABLE.

### PD-18 — Concrete rule values

NO EVIDENCE exists anywhere in authoritative documents for any quality threshold value. The only frozen numeric policies in P6 are freshness intervals (dimensionally inappropriate to reuse). Mirrors the freshness precedent: unconfigured checks remain unresolved rather than receiving defaults. BLOCKING FOR V1 IMPLEMENTATION for whichever checks enter V1 scope; sequenced after PD-01…PD-08.

---

## 17. Dependency Graph

```text
PD-01 (INVALID rules per metric)
 ├── PD-02  (malformed-value mapping — branch of PD-01)
 ├── PD-04  (sign policy)
 ├── PD-05  (zero policy)
 ├── PD-06  (FR range)
 ├── PD-03  (OHLC scope — group refinement)
 └────────────────► PD-18 (values for shaped checks)

PD-07 (future ts) ──┐
                    ├──► PD-18
PD-08 (historical) ─┘

PD-12 (computation timing)
 ├──► PD-13 (persistence model)
 │      └──► PD-17 (retention)
 └──► PD-16 (coexistence touchpoints)

PD-01..PD-05 ──► PD-15 (aggregation) ──► PD-14 (gating)

Independent: PD-09, PD-10, PD-11
```

Upstream roots: PD-01, PD-12. Everything else hangs off these two chains or stands alone.

---

## 18. Existing System Interaction Analysis (mandatory)

| Signal | Owner/module | Semantic purpose | Current consumers | Interaction risk with quality |
|---|---|---|---|---|
| `source_status` (OK/PARTIAL/FAILED) | refresh route writes; `source_status` table | Operational collector-attempt health | Admin UI, refresh diagnostics | Highest name-collision risk: FAILED ≠ INVALID. Must remain operational-only (contract §10.2). PD-09/PD-16 decide evidence linkage, never relabeling |
| `features.dataCompleteness` | feature engine (`confidence.ts` path) | % of expected sources returning data | Stored on features; UI display | Measures AVAILABILITY not validity — a source returning garbage counts as "complete". Quality adds orthogonal axis; merging would corrupt both |
| `features.missingSources` | feature engine | Names of sources that failed this cycle | Stored on features; UI | Overlaps semantically with quality MISSING but at source-granularity, not field-granularity; coexistence harmless, conflation harmful |
| `confidenceScore` | confidence calc → features; mirrored on `health_scores` | Weighted 0–100 source-availability score | P4 decision support; coins API response | P4 CONSUMER — any quality-weighting change is PD-14+PD-16 territory and DQ-20-bounded; V1 must leave untouched |
| `health` (health_scores.status/score) | health service | Narrative-health product score | Dashboard, P4/P5 chain | Downstream of everything; quality must never feed it silently (§21.2) |
| Freshness (P6-01C) | p6/freshness module | Age vs configured policy; observed_at-based | Future consumers only | Fully independent dimension (DQ-03/04); shares only the label UNKNOWN and the config-version pattern; separate namespace enforced (DQ-17) |
| Square `data_quality` (HIGH/MED/LOW) | Square pipeline | Opportunity pipeline assessment | Square system | Different domain entirely; naming adjacency only — no interaction |

---

## 19. Candidate Implementation Surfaces (evidence-based, not design)

Surfaces implied by the PD set, mapped to decisions that activate them:

| Surface | Activated by |
|---|---|
| Pure validator functions (numeric/temporal/relational checks) | PD-01…PD-08 |
| Declarative rule configuration + `quality_config_version` registry row | PD-18, PD-17 |
| Evidence record model (check_id/field/outcome/detail) | Already FROZEN structurally (§6–7); realized by any validator |
| Canonical observation adapter (map current rows ↔ P6-01B identity) | PD-12, PD-13; prerequisite surfaced by PD-03 group-key note |
| Additive Drizzle migration (side table or columns) | PD-13 only |
| Quality evaluation service (resolution + classification orchestration) | PD-12 |
| Aggregation function | PD-15 |
| Feature-engine adapter | PD-14 (only if gating/weighted) |
| API/read-model exposure | PD-12/PD-14 (additive) |
| Tests (unit + regression) | Every implemented surface; currently ZERO quality tests exist (TEST EVIDENCE gap) |

No implementation design is made here.

---

## 20. Recommended Planner Decision Order (dependency ordering only — NOT semantic recommendations)

```text
1. PD-12   — architecture root; nothing placements-wise decidable before it
2. PD-01   — semantic root of classification
3. PD-02   — smallest decisive branch of PD-01 (parse path)
4. PD-04, PD-05, PD-06 — complete field-level rule shapes
5. PD-03   — decide group-check scheduling (incl. the storage-prerequisite question flagged in §9)
6. PD-13   — storage model (after timing known)
7. PD-18   — concrete values for whatever entered scope
8. PD-15   — aggregation, once field statuses exist
9. PD-07, PD-08 — temporal tolerances (can move earlier if temporal checks prioritized)
10. PD-09  — entity classification
11. PD-16  — coexistence formalization
12. PD-14  — downstream gating
13. PD-10, PD-11, PD-17 — future-scope items, any time after their parents
```

---

## 21. Blocking vs Deferrable Analysis

**BLOCKING FOR V1 IMPLEMENTATION:** PD-01, PD-02, PD-12, PD-13, PD-18 (scoped)

- PD-01/PD-02: without them no INVALID/parse classification exists — evaluator emits nothing meaningful.
- PD-12: architecture fork (write/read/hybrid) gates every placement and test-harness decision.
- PD-13: schema/migration work cannot start.
- PD-18: checks entering V1 need values; unconfigured checks stay unresolved (acceptable only if V1 scope shrinks accordingly — that scoping itself is a Planner act).

**IMPORTANT BUT DEFERRABLE:** PD-03, PD-04, PD-05, PD-06, PD-07, PD-08, PD-09, PD-14, PD-15, PD-16

All deferrable because: field-level parse/sign/zero/range checks and group checks are individually additive; frozen contract guarantees no-correction and additive-only downstream behavior, so their absence neither corrupts data nor breaks frozen semantics; none forces breaking schema changes when added later under PD-13's side-table-compatible options.

**FUTURE-SCOPE / NON-BLOCKING:** PD-10, PD-11, PD-17

- PD-10: DQ-18 freezes detect-only behavior pending decision; current DB upsert continues legally.
- PD-11: no comparison exists; adding one later is additive.
- PD-17: latest-only default consistent with freshness precedent.

---

## 22. Unresolved Evidence Gaps

| # | Gap | Status |
|---|---|---|
| EG-01 | No authoritative quality threshold values anywhere | INSUFFICIENT EVIDENCE — PLANNER DECISION REQUIRED (PD-18) |
| EG-02 | Whether OHLC group checks can run against coarse current storage or require observation-level persistence first | INSUFFICIENT EVIDENCE — PLANNER DECISION REQUIRED (sequencing input to PD-03/PD-13) |
| EG-03 | Whether source APIs *guarantee* non-negativity (vs merely never having returned negatives) | INSUFFICIENT EVIDENCE — PLANNER DECISION REQUIRED (informs PD-04 severity) |
| EG-04 | No runtime cadence/behavioral telemetry for malformed-payload frequency | INSUFFICIENT EVIDENCE — PLANNER DECISION REQUIRED (prioritization context only) |

---

## 23. P6-01B / P6-01C Compatibility

- Canonical identity: UNCHANGED — this report modifies nothing; every PD analysis treats identity as read-only (DQ-15). ✅
- observed_at: UNCHANGED — UNKNOWN where source provides none; no substitution proposed anywhere. ✅
- collected_at substitution: NEVER — reaffirmed throughout; DQ-14 cited in PD-07/08 analyses. ✅
- Provenance: UNCHANGED — RAW→CANONICAL plus the contract-defined OBSERVATION→CLASSIFICATION extension only. ✅
- Freshness: INDEPENDENT — separation maintained in every analysis; shared-label caveat documented; version namespaces separate (DQ-17). ✅

## 24. P4/P5 Boundary

No Data Quality semantics propagated into P4/P5. `confidenceScore` identified as a P4 consumer requiring protection (DQ-20); PD-14/PD-16 flagged as the only decisions that could ever touch it, both currently deferred and bounded by frozen contract §22. No BUY/SELL/action semantics appear anywhere in this report. ✅

---

## 25. Exact Files Inspected

Authoritative documents (all 12 mandated):

- `docs/P6_Upgrade/P6_MASTER_SPECIFICATION.md`
- `docs/P6_Upgrade/P6_00_EXECUTION_PLAN.md`
- `docs/P6_Upgrade/P6-00_EXECUTION_PLAN_REVISION_01.md`
- `docs/P6_Upgrade/P6-01A_DATA_LANDSCAPE_RECON.md`
- `docs/P6_Upgrade/P6-01B_OBSERVATION_CONTRACT.md`
- `docs/P6_Upgrade/P6-01C_SOURCE_REGISTRY_CONTRACT.md`
- `docs/P6_Upgrade/P6-01C_FRESHNESS_POLICY_CONTRACT.md`
- `docs/P6_Upgrade/P6-01C-E_FRESHNESS_V1_POLICY_DECISION.md`
- `docs/P6_Upgrade/P6-01C-E1_SNAPSHOT_CADENCE_RECON.md`
- `docs/P6_Upgrade/P6-01D-A_DATA_QUALITY_LANDSCAPE_RECON.md`
- `docs/P6_Upgrade/P6-01D-B_DATA_QUALITY_CONTRACT.md`
- `docs/P5_Upgrade/P4-P5_HANDOFF.md`

Code spot-verification (targeted, per-task scope):

- `src/lib/collectors/binance.ts`
- `src/lib/collectors/coingecko.ts`
- `src/app/api/refresh/route.ts`
- `src/app/api/coins/[id]/route.ts` (read-model cross-source merge — new evidence for PD-11)
- `src/db/schema.ts`
- `src/lib/features/engine.ts`, `src/lib/features/calculator.ts`, `src/lib/features/confidence.ts`
- `src/lib/p6/registry/*`, `src/lib/p6/freshness/*`
- `drizzle/migrations/0025_add_source_registry.sql`, `drizzle/migrations/0026_add_freshness_policies.sql`, `drizzle/migrations/0027_seed_freshness_v1_policies.sql`

---

## 26. Verification

| Check | Result |
|---|---|
| Source scan | ✅ targeted inspection completed; P6-01D-A reused as frozen baseline |
| Documentation scan | ✅ all 12 authoritative docs read |
| PD list verified from frozen contract | ✅ PD-01…PD-18 extracted verbatim from `P6-01D-B_DATA_QUALITY_CONTRACT.md` §26 |
| Semantic decisions made | NONE — all options listed neutrally |
| Production changes | NONE |
| Git diff | Documentation-only (verified at commit) |
| P6-01B changes | NONE |
| P6-01C changes | NONE |
| P4/P5 changes | NONE |

---

**END OF P6-01D-C1 — PLANNER DECISION INVENTORY (EVIDENCE ONLY)**

Awaiting Planner audit and PD resolutions before P6-01D-C2/D.
