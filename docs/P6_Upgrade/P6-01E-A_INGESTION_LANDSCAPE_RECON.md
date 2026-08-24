# P6-01E-A — Production Ingestion Landscape Recon

**Date:** 2026-08-25
**Task Type:** RECON ONLY — no production code, schema, or contract changes.
**Authority:** P6-01B, P6-01C, frozen P6-01D (FINAL audit `8b4e73e`). No frozen semantics reinterpreted.

---

## 1. Executive Summary

Production ingestion is implemented as a family of Next.js API routes (`/api/refresh`, `/api/refresh/coin/[id]`, `/api/refresh/narrative/[id]`) that call three collector modules and write directly to legacy tables (`market_price_daily`, `coin_metrics`), then immediately chain into the existing feature → health → recommendation pipeline inside the same request.

Key findings:

1. **observed_at is available for kline metrics** (OPEN/HIGH/LOW/CLOSE/VOLUME/QUOTE_VOLUME via `openTime`) but is currently **converted to a business_date** (`getBusinessDate(openTime)`) before persistence — the epoch timestamp itself is discarded.
2. **OPEN_INTEREST and FUNDING_RATE observation timestamps are discarded by collectors**: Binance `/fapi/v1/openInterest` and `/fapi/v1/premiumIndex` both return a `time` field; the collectors keep only the numeric value (CODE EVIDENCE: `src/lib/collectors/binance.ts`).
3. **CoinGecko `last_updated` is not mapped**: `/coins/markets` provides `last_updated`; `CoinGeckoMetrics` has no timestamp field (CODE EVIDENCE: `src/lib/collectors/coingecko.ts`).
4. **No DB transactions exist anywhere in the refresh path** (`grep db.transaction` in refresh routes/lib = 0 matches outside unrelated services). Every write is an independent auto-commit upsert; partial failure is tolerated per coin via try/catch.
5. **Source fallback already exists in production** (Futures→Spot klines) — this interacts with quality provenance but must not be altered by P6 wiring.
6. The safest P6 quality integration point is a **post-collect, pre-existing-DB-write hook for klines** (where observed_at is available) plus a separate decision point for OI/FR/MC/FDV where observed_at is UNKNOWN → MISSING/UNKNOWN-slot classifications per frozen PD-09/D1 rules. Final placement is **PLANNER DECISION REQUIRED** (see §10).

No semantic conflicts with frozen contracts were discovered. Nothing BLOCKING.

## 2. Current Ingestion Architecture

```text
External scheduler / manual trigger / scripts/trigger-refresh.js
        ↓ HTTP POST
/api/refresh (or /api/refresh/coin/[id], /api/refresh/narrative/[id])
        ↓
checkRefreshLock() via scheduler_logs          [refresh/route.ts:44-84]
        ↓
scheduler_logs INSERT (STARTED)                [refresh/route.ts:92-99]
        ↓
fetchCoinGeckoMarkets (batch, all coins)       [refresh/route.ts:157-168]
        ↓
FOR each active coin:                          [refresh/route.ts:171+]
    fetchBinanceFuturesKlines(200, "1d")       ← preferred source
    fetchBinanceFuturesKlines(100, "4h")
    fetchBinanceFuturesTicker (24h quoteVolume)
      ↳ on futures failure: fetchBinanceSpotKlines fallback
    INSERT/UPSERT market_price_daily           (per kline row)
    fetchBinanceFuturesMetrics (OI + FR)
    fetchBinanceOIHistory (prev OI)
    UPSERT coin_metrics (source=binance_futures|binance_spot)
    UPSERT coin_metrics (FDV, source=coingecko)
    DELETE+INSERT source_status (per coin)
    indicatorService.calculateAndSave (1d, 4h)
    runFeatureEngine → UPSERT features
    calculateHealthScore → UPSERT health_scores
    ruleEngineService.evaluate → UPSERT recommendations
FOR each active narrative:
    calculateWeightedNarrativeHealth → UPSERT narrative_health
        ↓
global source_status rows (delete+insert)
        ↓
snapshotService.createDailySnapshot (P1C)
        ↓
runSquarePipeline (non-blocking side effect)
        ↓
scheduler_logs UPDATE (COMPLETED/FAILED)
```

Call ordering is strictly sequential within a coin; coins are processed sequentially in one long-lived request (`maxDuration = 60`).

## 3. Collector Inventory

All collector functions live in two files. Evidence line references are to current code at commit time of this recon.

### 3.1 BINANCE_SPOT — `src/lib/collectors/binance.ts`

| Function | Metrics | Timeframe | Raw payload shape | Transformation | Notes |
|---|---|---|---|---|---|
| `fetchBinanceSpotKlines(symbol, limit=200, interval="1d")` | OPEN HIGH LOW CLOSE VOLUME QUOTE_VOLUME | 1d, 4h (as invoked) | Binance array `[openTime, open, high, low, close, volume, closeTime, quoteVolume, ...]` (strings) | mapped to `KlineData { openTime:number, open:string, high:string, low:string, close:string, volume:string, closeTime:number, quoteVolume:string }` | strings preserved unvalidated |
| `fetchBinanceSpotTicker(symbol)` | 24h quoteVolume, lastPrice | rolling 24h | full ticker JSON (`any`) | returned raw; caller does `parseFloat(ticker.quoteVolume)` | no timestamp kept |
| `fetchBinanceCurrentPrice(symbol)` | PRICE (=CLOSE alias) | spot instant | `{ price }` | parseFloat | not used by refresh path |

Error behavior: every function catches, logs, returns `[]` / `null`. **API failure is indistinguishable from "no data" at the type level.**

### 3.2 BINANCE_FUTURES — `src/lib/collectors/binance.ts`

| Function | Metrics | Raw payload | Timestamp handling |
|---|---|---|---|
| `fetchBinanceFuturesKlines` | OHLCV + QUOTE_VOLUME | same array shape as spot | keeps `openTime`/`closeTime` ✅ |
| `fetchBinanceFuturesOI(symbol)` | OPEN_INTEREST (instant) | `{ symbol, openInterest, time }` | **returns only `parseFloat(response.data.openInterest)` — `time` DISCARDED** ❌ |
| `fetchBinanceFundingRate(symbol)` | FUNDING_RATE | premiumIndex `{ ..., lastFundingRate, time }` | **returns only `parseFloat(lastFundingRate)` — `time` DISCARDED** ❌ |
| `fetchBinanceOIHistory(symbol, period="1d", limit=2)` | OPEN_INTEREST history | `[{ timestamp, sumOpenInterest }]` | keeps `timestamp` internally, BUT caller uses it only as `oiPrev` value; timestamp never persisted ❌ |
| `fetchBinanceFuturesTicker` | 24h volume/mcap approximation | ticker JSON | no timestamp kept |

### 3.3 COINGECKO — `src/lib/collectors/coingecko.ts`

| Function | Metrics | Raw payload | Timestamp handling |
|---|---|---|---|
| `fetchCoinGeckoMarkets(coinIds[])` | MARKET_CAP, FDV, (currentPrice, total_volume mapped but CG is used in refresh only for MC/FDV) | `/coins/markets` rows include `last_updated` per coin | **`last_updated` NOT mapped into `CoinGeckoMetrics`** ❌ — interface has no time field |
| `fetchCoinGeckoData(coinId)` | same, single coin | `/coins/{id}` with `market_data=true` | response includes top-level `last_updated`; NOT mapped ❌ |

Entity mapping: coin rows carry `coingeckoId`, `binanceSpotSymbol`, `binanceFuturesSymbol` (`coins` table); mapping failure manifests as missing map entries / empty arrays, never as explicit evidence.

## 4. Source → Metric → Timeframe Matrix

Statuses are evidence-based per task spec. `UNKNOWN` in timestamp columns means the source either provides no usable observation time or the collector discards it (explicitly recorded, not inferred).

| Source | Metric | Timeframe | Current field(s) | Canonical mapping | observed_at | collected_at | Status |
|---|---|---|---|---|---|---|---|
| binance_spot | OPEN/HIGH/LOW/CLOSE | 1d, 4h | `kline.open/high/low/close` (string) | direct | **AVAILABLE** (`openTime`, ms epoch) — converted to business_date before persist | absent (only DB `created_at` default) | AVAILABLE |
| binance_spot | VOLUME | 1d, 4h | `kline.volume` | direct | AVAILABLE (`openTime`) | absent | AVAILABLE |
| binance_spot | QUOTE_VOLUME | 1d, 4h | `kline.quoteVolume` | direct | AVAILABLE (`openTime`) | absent | AVAILABLE |
| binance_futures | OPEN/HIGH/LOW/CLOSE | 1d, 4h | `kline.*` | direct | AVAILABLE (`openTime`) | absent | AVAILABLE |
| binance_futures | VOLUME / QUOTE_VOLUME | 1d, 4h | `kline.volume/quoteVolume` | direct | AVAILABLE (`openTime`) | absent | AVAILABLE |
| binance_futures | OPEN_INTEREST | instant snapshot | `response.data.openInterest` | direct | **UNKNOWN** — source `time` discarded by collector | absent | AVAILABLE_WITH_UNKNOWN_OBSERVED_AT |
| binance_futures | FUNDING_RATE | instant snapshot | `response.data.lastFundingRate` | direct | **UNKNOWN** — source `time` discarded by collector | absent | AVAILABLE_WITH_UNKNOWN_OBSERVED_AT |
| binance_futures (ticker) | MARKET_CAP (approximate fallback) | rolling 24h | `quoteVolume * lastPrice` computed in route | TRANSFORMATION_REQUIRED (derived, not sourced) | UNKNOWN | absent | TRANSFORMATION_REQUIRED |
| coingecko | MARKET_CAP | rolling/current | `market_cap.usd` | direct | **UNKNOWN** — `last_updated` exists in payload, unmapped | absent | AVAILABLE_WITH_UNKNOWN_OBSERVED_AT |
| coingecko | FDV | rolling/current | `fully_diluted_valuation.usd` | direct | **UNKNOWN** — same as above | absent | AVAILABLE_WITH_UNKNOWN_OBSERVED_AT |
| binance_spot/futures | OPEN_INTEREST history prev value | 1d | `oiHistory[n].openInterest` | used transiently for feature delta only; never persisted | timestamp available internally, unused | absent | NOT_AVAILABLE (not persisted) |

PRICE never appears as a stored independent metric — CLOSE serves that role (consistent with P6-01D-B).

## 5. Timestamp / observed_at Analysis

### 5.1 Kline path

- `openTime` (ms epoch, UTC window-open) IS the true observation time of the OHLCV candle.
- Current route converts it: `const klineDate = getBusinessDate(new Date(kline.openTime))` then persists only `date = klineDate` into `market_price_daily.date` (business timezone `Asia/Ho_Chi_Minh`). **The raw epoch is discarded after conversion.**
- Therefore canonical `observed_at` is RECOVERABLE at ingestion time without any source change — it exists in memory at exactly the point where quality evaluation would run.

### 5.2 Instant-snapshot path (OI / FR / MC / FDV)

- BINANCE_FUTURES OI: `/fapi/v1/openInterest` response contains `time` — verified claim TRUE: collector discards it (`return parseFloat(response.data.openInterest)`).
- BINANCE_FUTURES FR: `/fapi/v1/premiumIndex` response contains `time` — verified claim TRUE: collector discards it.
- COINGECKO: verified claim TRUE — `last_updated` present in `/coins/markets` payloads but absent from `CoinGeckoMetrics` mapping.
- BINANCE_FUTURES OI history: usable per-point `timestamp` EXISTS in the source response (`openInterestHist`), so historical OI observations could carry observed_at if ever persisted — currently only the latest value is read transiently.
- In all four cases: **no fabrication proposed**. Per D1 REV1 these observations would enter the quality system with `observed_at = NULL` (UNKNOWN slot), or the collectors would later be extended to surface source-provided times — which is itself a future task, not decided here.

### 5.3 business_date

`getBusinessDate()` (`src/lib/utils.ts`, tz `Asia/Ho_Chi_Minh`) derives a calendar/business day from wall-clock or a supplied Date. It is a **presentation/aggregation key**, used as the sole temporal column of `market_price_daily` and `coin_metrics`. It MUST NOT be substituted for observed_at (frozen DQ/PQ invariants).

## 6. Existing DB Write Paths

| Table | Writer (route) | Columns written | Strategy | Conflict key | Transaction scope | Failure behavior |
|---|---|---|---|---|---|---|
| `market_price_daily` | refresh/route.ts (per kline) | coinId, date(business), OHLC, volume, quoteVolume, source, volume24h | insert…onConflictDoUpdate | `[coinId, date]` — **source NOT in key** (spot/futures overwrite each other for the same date) | none (auto-commit) | aborts remaining klines of that coin's loop iteration → caught by per-coin try/catch |
| `coin_metrics` | refresh/route.ts ×3 sites | marketCap OR openInterest+fundingRate OR FDV; date=today; source | insert…onConflictDoUpdate | `[coinId, date, source]` | none | caught per coin |
| `source_status` | per-coin + global | status OK/FAILED, lastAttempt, lastSuccess | **DELETE then INSERT** (not upsert) | n/a | none | delete+insert pair not atomic |
| `features` | refresh/route.ts | scores/details/confidence/completeness/provenance | upsert | `[coinId, date, versionId]` | none | skips health/rec for that coin |
| `health_scores` | refresh/route.ts | score/change/status/confidence | upsert | `[coinId, date]` | none | — |
| `recommendations` | refresh/route.ts | signal/reason/breakdown | upsert | `[coinId, date]` | none | — |
| `narrative_health` | refresh loop | weighted score/breakdown | upsert | `[narrativeId, date]` | none | caught per narrative |

Schema evidence: `src/db/schema.ts` — `marketPriceDaily` unique `(coinId, date)`; `coinMetrics` unique `(coinId, date, source)`.

Note: `db.transaction` appears only in `src/lib/p3/persistence.ts` and `rule-version.service.ts` — **the ingestion path has zero transactional boundaries**.

## 7. Refresh / Scheduling Flow

Entrypoints identified:

1. **POST /api/refresh** (global) — body `{ jobName }`, default `manual_refresh`. Lock via `scheduler_logs` STARTED row, stale after 15 min (`REFRESH_LOCK_TIMEOUT`).
2. **POST /api/refresh/coin/[id]** — identical pattern scoped to one coin, lock name `coin_refresh:<id>` (705 lines, mirrors global logic).
3. **POST /api/refresh/narrative/[id]** — per-narrative scope.
4. **scripts/trigger-refresh.js** — external HTTP trigger posting `{jobName:'SQ_LIVE_02_test_with_tables'}` to localhost:3000.
5. **Scheduler config** — `/api/admin/config/scheduler` edits `SCHEDULER_ENABLED/HOUR/MINUTE/INTERVAL_HOURS` in `.env`; **no cron worker exists inside this repository** — triggering is external (platform cron or manual). No background job runner found in-repo.

Retry behavior: NONE. No retries on collector or DB failures; failures degrade to warnings/partial data.

Partial-success semantics: a coin whose collectors all fail still counts toward `coinsProcessed++` (the counter increments unless the outer try/catch fires); errors accumulate in `errors[]`; final log status is `"COMPLETED"` even when `errors.length > 0`.

## 8. Failure and Transaction Behavior

| Failure case | Observed behavior | Frozen-contract comparison |
|---|---|---|
| Collector API error | catch → log → `[]`/`null` → downstream treated as missing values; source_status FAILED (per-coin/global rows) | Consistent with P6-01D §10: API failure ≠ INVALID observation. Today there is NO observation-level record at all — a quality pass would classify these as MISSING with evidence, which the frozen contract supports |
| Malformed numeric string | `parseFloat` yields NaN → decimal column insert would throw → whole coin iteration aborted at first bad kline | Frozen PD-02 requires malformed-present → INVALID classification; today it causes silent coin-level loss. This is the gap P6 wiring closes |
| Entity cannot resolve | missing `binanceSpotSymbol`/`binanceFuturesSymbol`/`coingeckoId` → warn, skip collection | Frozen PD-09: should produce MISSING + ENTITY_RESOLUTION_FAIL evidence; today produces nothing |
| DB write fails | throws → caught by per-coin try/catch → rest of coin skipped, next coin proceeds | Infrastructure failure; must remain infrastructure failure under P6 (D4 already propagates persistence errors as infrastructure errors) |
| One metric fails, others succeed | e.g., OI null but FR present → single `coin_metrics` row with mixed nulls; `oiCurrent ?? null` persisted | Frozen contract permits field-level independence; consistent |
| Quality persistence fails (future) | N/A — not wired yet; D4 contract mandates infrastructure-error propagation, never state coercion | Aligned by design |

## 9. Canonical Observation Mapping

For every V1 metric, what a canonical observation `(entity_id=coinId, metric, source, observed_at, timeframe)` would look like at the existing collection site:

| Metric | Construction site (today) | entity_id | source | observed_at | timeframe |
|---|---|---|---|---|---|
| OPEN/HIGH/LOW/CLOSE/VOLUME/QUOTE_VOLUME | kline loop, refresh/route.ts (`market_price_daily` upsert) | coin.id | priceSource variable (`binance_spot`\|`binance_futures`) | `new Date(kline.openTime)` (in-memory, currently dropped) | "DAILY" or "4H" per invocation |
| OPEN_INTEREST | `fetchBinanceFuturesMetrics` result → `coin_metrics` upsert | coin.id | `binance_futures` | UNKNOWN (NULL) | SOURCE_SNAPSHOT per registry |
| FUNDING_RATE | same | coin.id | `binance_futures` | UNKNOWN (NULL) | SOURCE_SNAPSHOT |
| MARKET_CAP | CoinGecko map entry (primary) or Binance-derived fallback | coin.id | `coingecko` (or futures/spot approx) | UNKNOWN (NULL) | SOURCE_SNAPSHOT |
| FDV | CoinGecko map entry → `coin_metrics` upsert | coin.id | `coingecko` | UNKNOWN (NULL) | SOURCE_SNAPSHOT |

OHLC group availability: all four members travel together in one `KlineData` object with one shared `openTime`, and 1d + 4h arrays are fetched separately — exact group identity `(entity_id, source, observed_at, timeframe)` is constructible **in-memory today** for both cadences.

## 10. P6 Quality Integration Point Analysis

Candidate insertion points evaluated (per task requirement). The frozen D2/D4 interfaces are: `validateMetric()/validateOHLCGroup()` (pure) and `evaluateAndPersistQuality()` → `upsertQualityResult()`.

### Option 1 — BEFORE existing DB write (post-collect, pre-persist)

- Evidence: all inputs needed (values + observed_at + source + timeframe) are in scope immediately before each upsert; kline loop is per-row, giving natural per-observation granularity; OHLC group intact.
- Advantages: classification reflects exactly what is about to be persisted; observed_at available for klines; no dependency on legacy tables; failure isolation easy.
- Risks: adds latency per kline row (200 rows × N coins); a quality-persistence failure could abort market-data persistence unless explicitly isolated — needs defined error policy (**PLANNER DECISION REQUIRED**).
- Transaction implications: none today (no wrapping transaction); quality write and market write remain independent commits.
- P4/P5 impact: none — purely additive writes to `p6_observation_quality`.
- Failure behavior: must be non-blocking or explicitly blocking — undecided.

### Option 2 — AFTER existing DB write (post-persist)

- Evidence: same in-scope variables persist after the upsert; could also batch after the kline loop.
- Advantages: zero risk of quality machinery delaying/corrupting market-data writes; can batch per coin (fewer round-trips).
- Risks: a crash between market write and quality write leaves observations unclassified (partial coverage); classification describes data already committed.
- Transaction implications: none (still no transactions).
- P4/P5 impact: none.
- Failure behavior: quality gap silently possible — monitoring concern.

### Option 3 — INSIDE existing transaction

- Evidence: **NO EXISTING TRANSACTION TO JOIN** — the refresh path has zero `db.transaction` usage (§6). Introducing one would restructure the ingestion path itself.
- Assessment: not applicable without changing production write architecture. Out of scope for minimal wiring; flagged as architectural change.

### Option 4 — OUTSIDE existing transaction (separate post-pass)

- Evidence: a post-ingestion pass could re-read recently written rows — but `market_price_daily` lacks `observed_at` and `metric` dimensions (D1 BLOCKING GAP finding stands), so reconstruction from DB would force approximate joins, which frozen contracts forbid.
- Assessment: viable ONLY if quality evaluation consumes in-memory collection results, i.e., collapses into Option 1/2. A pure read-back design is NOT viable under frozen identity rules.

**Integration verdict (evidence-only):** Options 1 and 2 are the only frozen-compatible candidates; Option 1 preserves more information (pre-write classification), Option 2 minimizes interference. Selection between them, plus the quality-failure blocking policy, is **PLANNER DECISION REQUIRED**. Neither choice alters any frozen semantic.

## 11. OHLC Group Integration Analysis

- Exact group identity `(entity_id, source, observed_at, timeframe)` is constructible in-memory at the kline loop: group members share one `KlineData.openTime`, one `priceSource`, one interval.
- If the pipeline evaluates BEFORE persistence (Option 1), `validateOHLCGroup()` receives exact identity directly — no lookup needed.
- For OI/FR/MC/FDV there is no OHLC involvement.
- **If observed_at were UNKNOWN for an OHLC observation**, relational validation is NOT_EVALUABLE by frozen rule (PD-03). In the CURRENT code path this cannot occur for klines because `openTime` always exists in the payload; however, if a future collector variant omitted it, the frozen rule applies unchanged — no substitution permitted.
- Approximate grouping by business_date would merge distinct candles across midnight-boundary edge cases in the business timezone and violates DQ-11a/PQ-11 — rejected without implementation consideration.

## 12. Idempotency / Duplicate Analysis

Semantic observation identity vs legacy conflict keys:

| Layer | Key | Repeated-refresh effect |
|---|---|---|
| Semantic (P6-01B) | `(entity_id, metric, source, observed_at, timeframe)` | n/a — legacy tables don't store this identity |
| `market_price_daily` | `(coinId, date=business_date)` | overwrite (last writer wins). Futures→Spot fallback means the SAME date can be written by different sources across runs — the stored `source` flips, prior source's values silently replaced. Under canonical identity these would be TWO distinct observations; under legacy keys they collapse to one. Documented, not redesigned. |
| `coin_metrics` | `(coinId, date, source)` | stable overwrite per source |
| `p6_observation_quality` (future) | partial unique indexes KNOWN/UNKNOWN slots | latest-only upsert per D3 — repeated evaluation updates, never duplicates |

Duplicate-quality-record risk once wired: none structurally (D3 enforces uniqueness). Partial quality records: possible only if wiring covers some metrics and not others (a coverage decision, see §15). Inconsistent source state: possible today via the marketPriceDaily cross-source overwrite described above — pre-existing behavior, unchanged by P6.

## 13. P4/P5 Boundary Verification

- Refresh route chains features → health → recommendations → narrative health → snapshots using existing signals (`confidenceScore`, `dataCompleteness`, `missingSources`, `sourceProvenance`) exactly as before.
- Quality modules import nothing from P4/P5/collectors (verified grep, P6-01D-FINAL §11); adding quality calls at the ingestion boundary would be additive and downstream consumers untouched.
- `git diff` scope discipline from D2–E holds: no P4/P5 file was modified in any implementation commit.

## 14. Gaps and Risks

| # | Gap/Risk | Severity |
|---|---|---|
| G-1 | OI/FR observation time discarded by collectors → those metrics can only enter quality as UNKNOWN-slot (NULL observed_at) unless collectors are extended later | Medium — semantic coverage gap, not a violation |
| G-2 | CoinGecko `last_updated` unmapped → MC/FDV UNKNOWN observed_at | Medium |
| G-3 | `parseFloat` NaN on malformed kline string aborts entire coin iteration (DB decimal reject) — the exact failure mode quality classification is designed to prevent | High motivation for wiring |
| G-4 | `market_price_daily` conflict key excludes `source` → cross-source silent overwrite | Pre-existing; document only |
| G-5 | No transactions → quality and market writes cannot be made atomic without restructuring | Architectural constraint on integration option |
| G-6 | `maxDuration = 60` — added per-row quality persistence may pressure the global refresh budget; batching may be required | Operational |
| G-7 | source_status delete-then-insert is non-atomic | Cosmetic/operational |
| G-8 | No retry/backoff on collectors | Operational |

## 15. Planner Decision Required

| ID | Question | Why now |
|---|---|---|
| PD-E1 | Integration placement: evaluate BEFORE existing write (Option 1) vs AFTER (Option 2)? | Determines wiring architecture for P6-01E-B |
| PD-E2 | Quality-persistence failure policy during ingestion: block the corresponding market-data write, or proceed and log? | Defines failure coupling between quality layer and legacy path |
| PD-E3 | Coverage for V1: wire kline metrics only (observed_at available) or also UNKNOWN-slot metrics (OI/FR/MC/FDV)? | Scope of first production wiring |
| PD-E4 | May collectors later be extended to surface source-provided `time`/`last_updated` (without semantic reinterpretation), or must collector files remain untouched in P6-01E? | Determines whether UNKNOWN observed_at is permanent for snapshot metrics |

None of these overlap OI-01…OI-08; all are new integration-layer decisions. None is resolved here.

## 16. Recommended Next Implementation Boundary

Evidence-based suggestion only (ordering, not semantics):

1. Freeze PD-E1…PD-E4 above.
2. Implement wiring in a dedicated module (e.g., an ingestion-hook service) that accepts in-memory collection results and invokes `evaluateAndPersistQuality`/`evaluateAndPersistOHLCQuality`; keep refresh-route edits minimal.
3. Wire klines first (full identity available; OHLC groups constructible).
4. Add UNKNOWN-slot metrics per PD-E3 decision.
5. Extend test matrix with route-level integration tests using mocked collectors.
6. Only then consider collector timestamp surfacing (PD-E4), which would upgrade snapshot metrics from UNKNOWN to KNOWN observed_at.

## 17. Source Evidence / File References

| File | Evidence used |
|---|---|
| `src/lib/collectors/binance.ts` | All Binance functions; OI/FR discard `time`; kline mapping; error-swallowing returns |
| `src/lib/collectors/coingecko.ts` | Markets/single-coin fetchers; `last_updated` unmapped; interface shapes |
| `src/app/api/refresh/route.ts` | Full global flow: lock, CG batch, per-coin loop, futures→spot fallback, all upserts incl. conflict targets, source_status delete+insert, features/health/rec/narrative/snapshot/square chain |
| `src/app/api/refresh/coin/[id]/route.ts` | Per-coin mirror flow, lock naming |
| `src/app/api/refresh/narrative/[id]/route.ts` | Existence/scope (706 lines) |
| `src/app/api/admin/config/scheduler/route.ts` | Env-based scheduler configuration |
| `scripts/trigger-refresh.js` | External HTTP trigger example |
| `src/db/schema.ts` | `marketPriceDaily` unique(coinId,date); `coinMetrics` unique(coinId,date,source); column types |
| `src/lib/utils.ts` | `getBusinessDate` (referenced via import in refresh route; BUSINESS_TIMEZONE constant duplicated at route top) |
| `src/lib/p6/quality/evaluation-service.ts` | `evaluateAndPersistQuality/OHLCQuality/Multiple` signatures |
| `src/lib/p6/quality-persistence/service.ts` | `upsertQualityResult` signature |
| `src/lib/p3/persistence.ts`, `src/lib/services/rule-version.service.ts` | Only `db.transaction` usages in repo — none in ingestion |

## 18. Acceptance Checklist

- [x] All active P6 sources traced (BINANCE_SPOT, BINANCE_FUTURES, COINGECKO)
- [x] All V1 metrics mapped (matrix §4)
- [x] All collector entrypoints identified (§7)
- [x] /api/refresh path traced end-to-end
- [x] Scheduled/manual refresh paths traced (external trigger; env-configured scheduler; no in-repo cron)
- [x] DB write paths identified with conflict keys (§6)
- [x] Timestamp behavior verified from code (§5; FR/OI `time` discard and CG `last_updated` claims CONFIRMED against current code)
- [x] observed_at UNKNOWN cases explicitly preserved (no invention)
- [x] No collected_at substitution proposed
- [x] OHLC exact group identity respected (§11)
- [x] Quality integration candidates analyzed (4 options, §10)
- [x] Transaction implications documented (none exist; constraints stated)
- [x] Failure semantics documented (§8)
- [x] Idempotency behavior documented (§12)
- [x] P4/P5 boundary verified (§13)
- [x] All unresolved architectural decisions explicitly marked (§15: PD-E1…PD-E4)
- [x] No production code modified
- [x] No schema modified
- [x] No frozen contract modified
- [x] Only the recon document changed

**BLOCKING CONFLICTS: NONE.**
