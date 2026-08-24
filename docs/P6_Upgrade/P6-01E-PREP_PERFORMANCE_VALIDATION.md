# P6-01E-PREP — Performance Validation of NB-1 Risk

**Date:** 2026-08-26
**Scope:** Measure/estimate the DB operation overhead introduced by P6-01E-C `evaluateKlineObservationQuality` in the production `/api/refresh` path.
**Constraint:** No production load testing. No implementation changes. No semantic changes.

---

## 1. Test Methodology

| Layer | Method | Confidence |
|---|---|---|
| D2 pure validation overhead | Jest unit test: 100k iterations, warmup, wall-clock measurement | HIGH — deterministic, no external dependency |
| DB operation count | Static code analysis: trace through `evaluateKlineObservationQuality` → `evaluateAndPersistOHLCQuality` / `evaluateAndPersistQuality` → `upsertQualityResult` → Drizzle SQL | HIGH — deterministic from source |
| DB round-trip latency | **NOT MEASURABLE** — sandbox blocks direct DB access; no production load test | LOW — requires live DB measurement |
| Coin count for extrapolation | Route loads `activeCoins` from DB; exact count unknown at audit time | N/A |

## 2. Environment

| Parameter | Value | Note |
|---|---|---|
| Runtime | Node.js (Freebuff sandbox) | Same Node.js process as production |
| DB driver | `pg` (node-postgres), default Pool (max=10 connections) | Sequential SQL execution per request |
| DB target | External PostgreSQL (asyncpg-style URL → postgresql://) | Remote DB assumed (Vercel Postgres / Neon / Supabase); network RTT applies |
| Drizzle upsert pattern | Application-level SELECT + INSERT/UPDATE (2 SQL statements per quality row) | See D3 `upsertQualityResult` — ON CONFLICT on partial index not supported by Drizzle, so select-first is used |

## 3. Workload

| Parameter | Value | Source |
|---|---|---|
| Klines per coin per refresh | **200 daily** | Default limit in `fetchBinanceSpotKlines` / `fetchBinanceFuturesKlines` calls |
| Klines hooked | **200 daily only** — 4H klines feed indicators, not the quality hook | Route code inspection |
| Metrics per kline | **6** — OPEN, HIGH, LOW, CLOSE (OHLC group) + VOLUME + QUOTE_VOLUME | PD-E3 frozen scope |
| D2 calls per kline | **1 × `validateOHLCGroup`** (pure) + **2 × `validateMetric`** (pure) | `evaluateAndPersistOHLCQuality` + 2 × `evaluateAndPersistQuality` |
| D3 `upsertQualityResult` calls per kline | **6** (4 OHLC members + VOLUME + QUOTE_VOLUME) | Loop in `evaluateAndPersistOHLCQuality` + 2 standalone calls |

## 4. Operation Count Analysis

### Per kline (deterministic)

| Operation | SQL statements | Type |
|---|---|---|
| D2 `validateOHLCGroup` | 0 | Pure function |
| D2 `validateMetric` × 2 | 0 | Pure function |
| D3 `upsertQualityResult` × 6 | 6 × (SELECT + INSERT/UPDATE) = **12** | DB round-trips |
| **Total per kline** | **12 DB round-trips** | Sequential |

### Per coin (200 daily klines)

| Operation | Count |
|---|---|
| Quality DB round-trips | 200 × 12 = **2,400** |
| Existing pre-E-C DB ops (market_price_daily upserts + metrics + indicators + features + health + recs) | **~208** (estimated) |
| **Total post-E-C DB ops per coin** | **~2,608** |

### Delta

| Metric | Value |
|---|---|
| Added DB ops per coin | +2,400 |
| Percentage increase | +1,154% |
| Added DB ops per kline | +12 |

## 5. Measured Results

### D2 Pure Validation (measured via Jest, 100k iterations)

| Metric | Result |
|---|---|
| `validateMetric` throughput | ~sub-microsecond per call |
| `validateOHLCGroup` throughput | ~few microseconds per call |
| **Per-kline pure validation time** | **~0.007ms** |
| **Per 200 klines (D2 only)** | **~1.4ms** |

**Conclusion:** D2 pure validation overhead is **completely negligible** (<0.1% of any reasonable DB round-trip time).

### DB Round-Trip Latency

| Metric | Value |
|---|---|
| Single SELECT/INSERT latency | **NOT MEASURABLE** — sandbox blocks direct DB access |
| Estimated range (remote Postgres) | 2–50ms per round-trip depending on network distance |
| Estimated range (co-located Postgres) | 0.5–5ms per round-trip |

**NOTE:** Actual DB latency was not measured. All latency extrapolations below use documented assumption ranges.

## 6. Extrapolation

Using DB round-trip estimate of **2ms/operation** (optimistic: co-located DB):

| Active coins | Pre-E-C total ops | Pre-E-C est. time | Post-E-C total ops | Post-E-C est. time | Within maxDuration=60? |
|---|---|---|---|---|---|
| 5 | 1,040 | ~2.1s | 13,040 | ~26.1s | YES |
| 10 | 2,080 | ~4.2s | 26,080 | ~52.2s | BORDERLINE |
| 15 | 3,120 | ~6.2s | 39,120 | ~78.2s | NO |
| 20 | 4,160 | ~8.3s | 52,160 | ~104.3s | NO |

Using DB round-trip estimate of **10ms/operation** (moderate: remote Postgres):

| Active coins | Pre-E-C est. time | Post-E-C est. time | Within maxDuration=60? |
|---|---|---|---|
| 5 | ~10.4s | ~130.4s | NO |
| 10 | ~20.8s | ~260.8s | NO |
| 15 | ~31.2s | ~391.2s | NO |

**Key observation:** With remote DB latency (10ms/round-trip), the quality wiring pushes even 5-coin refreshes well beyond `maxDuration=60`. With co-located DB (2ms/round-trip), 10+ coins are at risk.

## 7. Relation to maxDuration=60

- `maxDuration = 60` is a hard Next.js function timeout (`src/app/api/refresh/route.ts:51`).
- Pre-E-C, the route was already approaching budget pressure at ~10+ active coins with remote DB.
- P6-01E-C adds a ~11.5× multiplier to per-coin DB operations.
- The refresh route processes coins **sequentially** (no parallelism).
- **If the pre-E-C refresh was already within budget for the production coin count, the 11.5× increase will likely exceed it.** If it was already over budget, quality wiring makes it worse but was not the root cause.

**Without knowing the production coin count and actual DB latency, this cannot be determined as PASS or BLOCKING.**

## 8. NB-1 Verdict

**NON-BLOCKING RISK — INSUFFICIENT EVIDENCE TO DETERMINE BLOCKING STATUS**

Rationale:
1. The **operation count is deterministically measured** (2,400 added DB round-trips per coin per refresh) and is significant.
2. The **D2 pure validation overhead is negligible** (~1.4ms for 200 klines) — confirmed by measurement.
3. The **DB latency was not measurable** in the sandbox environment — all latency extrapolations use assumed ranges.
4. The **production coin count is unknown** at audit time.
5. The risk is real but its severity depends on two unmeasured variables (actual DB latency × actual coin count).

**Recommendation for Planner:**
- Before declaring P6-01E FINAL, measure actual refresh duration with E-C wiring enabled on the production database.
- If refresh duration exceeds `maxDuration` budget, mitigation options (not implemented here per task constraint) include: batching quality writes, reducing DB round-trips via proper ON CONFLICT upsert, or processing quality evaluation in parallel.
- The D3 application-level select-then-insert/upsert pattern (2 SQL ops per row) is the primary contributor and could be optimized to 1 SQL op per row with a `drizzle` ON CONFLICT fix — but this is a D3 architecture question, not an E-C wiring question.

## 9. Limitations

| Limitation | Impact |
|---|---|
| DB latency not measured | Cannot produce actual timing; all latency numbers are extrapolations |
| Production coin count unknown | Cannot determine actual refresh duration |
| No load test performed | Cannot confirm real-world contention, connection pool exhaustion, or network degradation effects |
| Pg Pool max=10 default | With 2,400 sequential DB ops per coin, pool saturation is unlikely (sequential execution) but connection reuse overhead may vary |
| Existing refresh duration unknown | Cannot determine pre-E-C baseline; the delta itself is clear but its impact on budget depends on baseline |
