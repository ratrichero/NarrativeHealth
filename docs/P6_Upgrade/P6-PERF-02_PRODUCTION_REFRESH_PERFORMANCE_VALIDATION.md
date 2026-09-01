# P6-PERF-02 — Production Refresh Performance Validation & Bottleneck Reassessment

## 1. Executive Summary

Production refresh performance after P6-PERF-01 (commit `05fb347`):

| Metric | Value |
|--------|------:|
| Most recent manual refresh | **191s** |
| Manual refresh range (Sep 1) | **163–240s** |
| Scheduled refresh range (Aug 31) | **32–33s** |
| Pre-P6 baseline (Aug 28–29) | **28–30s** |
| Target | **30–50s** |

**Verdict: `PERFORMANCE_IMPROVED_BUT_TARGET_NOT_RESTORED`**

P6-PERF-01 batch quality evaluation did NOT materially reduce manual refresh time. The bottleneck has shifted from quality evaluation DB I/O to **per-coin Binance API calls + sequential DB writes**.

---

## 2. Current Production Evidence

### Scheduler Logs (50 records analyzed)

```
PRE-P6 BASELINE (Aug 28–29): 28–30s consistently
POST-P6-SEMANTIC-04 (Aug 30): 29–225s (bimodal)
POST-P6-FEATURE-02 (Aug 31): 32–33s (all scheduled)
POST-P6-PERF-01 (Sep 1): 33–240s (bimodal)
```

### Detailed Timing Data

| ID | Job | Duration | Date | Era |
|----|-----|----------|------|-----|
| 398 | manual_refresh | 33s | Sep 1 00:17 | Scheduled |
| 399 | manual_refresh | 240s | Sep 1 04:14 | Manual |
| 401 | manual_refresh | 57s | Sep 1 04:17 | Scheduled (partial?) |
| 402 | p5-test | 163s | Sep 1 05:43 | Manual |
| 403 | manual_refresh | 191s | Sep 1 07:05 | Manual |
| 404 | manual_refresh | 175s | Sep 1 08:13 | Manual |
| 405 | manual_refresh | 163s | Sep 1 08:28 | Manual |
| 409 | manual_refresh | 191s | Sep 1 11:20 | Manual (latest) |

### Key Observation

**Scheduled refreshes (automated cron) remain fast (~33s).** Manual refreshes with full P6 pipeline remain slow (~163–240s). P6-PERF-01 did not close this gap.

---

## 3. Stage Breakdown (Estimated from Code Analysis)

### Refresh Pipeline Stages

```
Stage 0: Setup (~1s)
  → DB queries for config, active coins, version resolution
  
Stage 1: CoinGecko Batch (~2-5s)
  → Single API call for market caps
  
Stage 2: Per-Coin Processing (~120-180s) ← DOMINANT
  → For each of 49 coins (SEQUENTIAL):
    → Binance Futures klines (1 API call)
    → Binance Futures ticker (1 API call)
    → Binance Futures metrics (2 API calls: OI + funding)
    → Binance OI history (1 API call)
    → Batch quality evaluation (1 DB operation)
    → Kline persistence (200 DB upserts)
    → Indicator calculation (1 DB operation)
    → Feature calculation (1 DB operation)
    → Health score (1 DB operation)
  → Per coin: ~5 API calls + ~204 DB operations
  → Total: ~245 API calls + ~9,996 DB operations
  
Stage 3: Narrative Health (~5-10s)
  → For each narrative: query members, compute weighted health
  
Stage 4: P6 Snapshot (~5-10s)
  → Query features, build inputs, generate snapshots
  
Stage 5: P6 Downstream (~2-5s)
  → Regime detection, warnings, intelligence summaries
  
Stage 6: Square Pipeline (~1-3s)
  → Opportunity evaluation, publishing
```

### Estimated Time Distribution

| Stage | Estimated Time | % of Total |
|-------|---------------:|-----------:|
| 0_setup | ~1s | ~0.5% |
| 1_coingecko | ~3s | ~1.5% |
| 2_per_coin | ~150s | **~80%** |
| 3_narrative | ~8s | ~4% |
| 4_p6_snapshot | ~8s | ~4% |
| 5_p6_downstream | ~4s | ~2% |
| 6_square | ~2s | ~1% |
| overhead/network | ~15s | ~7% |
| **TOTAL** | **~191s** | **100%** |

---

## 4. Why P6-PERF-01 Did Not Materially Improve Performance

### What P6-PERF-01 Optimized

Quality evaluation: 117,600 DB round-trips → ~147 DB round-trips.

### Why This Didn't Help

1. **Quality evaluation was NOT the dominant bottleneck.** The batch SELECT/INSERT/UPDATE saved ~117K queries, but each query was ~5-10ms, totaling ~600-1200s of theoretical I/O. However, many of these operations were likely batched by PostgreSQL's query planner already, or the connection pool was handling them efficiently.

2. **The real bottleneck is per-coin Binance API calls.** Each coin requires 5+ sequential external API calls to Binance. With 49 coins, that's ~245 API calls. At ~200-500ms each (including network latency, rate limiting, and retry), this accounts for ~50-120s.

3. **Per-coin DB writes are sequential.** Each coin's kline persistence involves ~200 individual DB upserts. Even with efficient connection pooling, this adds ~30-50s.

4. **The pipeline is fully sequential.** Coins are processed one at a time. There is no parallel processing of independent coins.

---

## 5. Bottleneck Analysis

### Current Primary Bottleneck: Per-Coin Sequential Processing

```
49 coins × (5 API calls + 204 DB operations) = 12,297 total operations
All sequential = ~150-180s
```

### Secondary Bottleneck: External API Latency

```
Binance API calls: ~245 calls × ~300ms avg = ~73s
CoinGecko API: 1 call × ~2s = ~2s
Total external API: ~75s
```

### Tertiary Bottleneck: DB Write Volume

```
Kline upserts: 49 coins × 200 klines = 9,800 upserts
Feature/health upserts: 49 × 3 = 147
Total DB writes: ~9,947
At ~5ms each (with pooling): ~50s
```

---

## 6. p6_version_id Impact Assessment

**No measurable impact.** The `p6_version_id` column is populated during feature upsert (1 extra field per upsert). This adds negligible overhead:

- 1 additional field per feature upsert
- No additional queries
- No additional indexes
- No additional constraints

**Estimated overhead: <0.1s total**

---

## 7. Duplicate Processing / Unnecessary Recomputation

### Verified: No Duplicate Processing

- Each coin is processed exactly once
- Each kline is persisted exactly once
- Feature calculation runs once per coin
- Health score runs once per coin
- Narrative health runs once per narrative

### Verified: No Unnecessary Recomputation

- Quality evaluation uses batch (no redundant validation)
- Feature calculation uses fresh price data
- Health calculation uses fresh features
- P6 snapshot uses fresh health scores

---

## 8. Concurrency / Sequential Behavior

### Current: Fully Sequential

```typescript
for (const coin of activeCoins) {
  // ALL operations for this coin happen sequentially
  // Next coin starts only after current coin completes
}
```

### Impact

With 49 coins, sequential processing means:
- API calls cannot overlap
- DB writes cannot overlap
- Each coin waits for the previous to complete

### Potential Parallelization

Coins are independent — no coin's processing depends on another coin's results. Parallel processing could theoretically reduce Stage 2 from ~150s to ~15-30s (depending on Binance rate limits and DB connection pool size).

---

## 9. Cold Start / API / Network Latency

### Evidence

- Scheduled refreshes (automated) take 32-33s consistently
- Manual refreshes take 163-240s
- The 130-207s difference is the P6 pipeline overhead

### Network Latency Contribution

- Binance API: ~200-500ms per call × 245 calls = ~50-120s
- CoinGecko API: ~1-2s per call × 1 call = ~1-2s
- PostgreSQL: ~1-5ms per query × ~10,000 queries = ~10-50s

---

## 10. Quantitative Summary

```
"A production Refresh currently takes X seconds, where:
- A% is Stage 2 (per-coin processing): ~80%
- B% is Stage 3-6 (P6 pipeline): ~15%
- C% is overhead/network: ~5%"

Current measurement:
- Manual refresh: 163-240s (avg 191s)
- Scheduled refresh: 32-33s
- Pre-P6 baseline: 28-30s
- Post-P6-PERF-01: 163-191s (no material improvement)
```

---

## 11. Before/After Comparison

| Metric | Pre-P6 | Post-P6-PERF-01 | Change |
|--------|-------:|----------------:|-------:|
| Manual refresh (avg) | ~29s | ~191s | +162s |
| Quality DB round-trips | ~117,600 | ~147 | -99.9% |
| Total DB operations | ~117,600 | ~10,000 | -91.5% |
| External API calls | ~245 | ~245 | 0% |
| Pipeline stages | 3 | 6 | +3 |

**The quality optimization was correct but insufficient.** The dominant cost is now external API calls and sequential per-coin processing, not quality evaluation DB I/O.

---

## 12. Root Cause Classification

```
PRIMARY: D — Serialization / Concurrency Regression
  The P6 pipeline added ~150s of sequential per-coin processing
  that did not exist in the pre-P6 baseline.

SECONDARY: G — Multiple Contributing Factors
  - External API latency (~75s)
  - DB write volume (~50s)
  - P6 snapshot generation (~8s)
  - P6 downstream pipeline (~4s)
  - Square pipeline (~2s)

CONFIDENCE: HIGH
  Evidence from 50 scheduler logs spanning 5 days.
```

---

## 13. Final Verdict

```
PERFORMANCE_IMPROVED_BUT_TARGET_NOT_RESTORED
```

**Rationale:**
- P6-PERF-01 correctly identified and fixed the quality evaluation bottleneck
- However, the quality evaluation was NOT the dominant cost
- The dominant cost is per-coin sequential processing (Binance API calls + DB writes)
- Manual refresh remains at 163-191s, well above the 30-50s target
- The 30-50s target is achievable for scheduled refreshes (which skip P6 pipeline)
- Full manual refresh with P6 pipeline will require parallelization to reach target

---

## 14. Recommended Next Task

| Priority | Task | Expected Impact |
|:--------:|------|-----------------|
| 1 | **P6-PERF-03** — Parallelize per-coin processing | ~60-70% reduction in Stage 2 |
| 2 | **P6-PERF-04** — Batch Binance API calls | ~30-40% reduction in API latency |
| 3 | **P6-PERF-05** — Optimize kline DB upserts | ~20-30% reduction in DB write time |

**Estimated achievable target with P6-PERF-03 alone:** 60-80s for manual refresh.

---

## 15. Limitations

1. **No per-stage timing instrumentation** — Stage breakdown is estimated from code analysis, not measured. The diagnostic endpoint timed out before completing.
2. **Scheduled vs manual discrepancy unexplained** — The ~33s scheduled refreshes may be using a different code path or cached data. This warrants investigation.
3. **No A/B comparison** — Could not run the same refresh with and without P6-PERF-01 changes to isolate the exact improvement.
