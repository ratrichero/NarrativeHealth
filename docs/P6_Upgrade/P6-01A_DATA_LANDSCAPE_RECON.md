# P6-01A — Current Data Landscape Recon

**Date:** 2026-08-21
**Scope:** RECON ONLY — NO IMPLEMENTATION
**Evidence:** Code-based, source-verified

---

## 1. Executive Summary

NarrativeHealth is a Next.js 14 + PostgreSQL (Drizzle ORM) application that:

1. **Collects** market data from Binance (Spot + Futures) and CoinGecko
2. **Calculates** 4 feature scores (trend, derivative, volume, momentum) per coin
3. **Scores** coin health (0-100) and narrative health (market-cap-weighted)
4. **Generates** recommendations via a configurable rule engine
5. **Displays** data on Dashboard, WatchList, Coin Detail, and Admin pages
6. **Publishes** content to Binance Square via OpenAPI
7. **Snapshots** daily data for historical comparison

**Key finding:** The system has a solid P3/P4/P5 pipeline with real data collection, feature calculation, and scoring. However, it lacks several data structures that P6 intelligence requires: raw observation storage, tick/minute-level granularity, freshness tracking, data quality metadata, historical provenance chains, and breadth/participation metrics.

---

## 2. Repository Baseline

| Aspect | Value |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL via Drizzle ORM |
| Styling | Tailwind CSS + shadcn/ui |
| Charts | Recharts |
| Package Manager | Bun |
| Test Framework | Jest + React Testing Library |
| Deploy | Vercel (Freebuff) |

**Key directories:**
- `src/db/` — schema, migrations
- `src/lib/collectors/` — data collection (binance.ts, coingecko.ts)
- `src/lib/features/` — feature calculations
- `src/lib/scoring/` — narrative health scoring
- `src/lib/services/` — business logic services
- `src/lib/square/` — Binance Square pipeline
- `src/app/` — Next.js routes + API
- `tests/` — test suites
- `drizzle/migrations/` — 24 migrations

---

## 3. Data Source Inventory

| # | Source | Provider | Collector | Endpoint | Data Type | Granularity | Timestamp | Storage | Freshness | Retry | Fallback | Provenance | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | BTC/USDT Klines | Binance Spot | `fetchBinanceSpotKlines` | `GET /api/v3/klines` | OHLCV | Daily (1d) | openTime from API | `market_price_daily` | On refresh (4h schedule) | No | Futures fallback | source column | PRODUCTION |
| 2 | Futures Klines | Binance Futures | `fetchBinanceFuturesKlines` | `GET /fapi/v1/klines` | OHLCV | Daily + 4h | openTime from API | `market_price_daily` | On refresh | No | Spot fallback | source column | PRODUCTION |
| 3 | Open Interest | Binance Futures | `fetchBinanceFuturesMetrics` | `GET /fapi/v1/openInterest` | OI snapshot | Daily | current timestamp | `coin_metrics` | On refresh | No | None | source column | PRODUCTION |
| 4 | Funding Rate | Binance Futures | `fetchBinanceFuturesMetrics` | `GET /fapi/v1/fundingRate` | Rate snapshot | 8h (Binance) | current timestamp | `coin_metrics` | On refresh | No | None | source column | PRODUCTION |
| 5 | Market Cap | CoinGecko | `fetchCoinGeckoMarkets` | `/api/v3/coins/markets` | FDV + Market Cap | Snapshot | current timestamp | `coin_metrics` | On refresh | No | Binance approximation | source column | PRODUCTION |
| 6 | Spot Ticker | Binance Spot | `fetchBinanceSpotTicker` | `GET /api/v3/ticker/24hr` | Volume, price | 24h snapshot | current timestamp | `coin_metrics` | On refresh | No | None | Not persisted separately | PRODUCTION |
| 7 | Futures Ticker | Binance Futures | `fetchBinanceFuturesTicker` | `GET /fapi/v1/ticker/24hr` | Volume, price | 24h snapshot | current timestamp | `coin_metrics` | On refresh | No | None | Not persisted separately | PRODUCTION |
| 8 | OI History | Binance Futures | `fetchBinanceOIHistory` | `GET /fapi/v1/openInterestHist` | OI time series | Daily | API timestamps | In-memory only | On refresh | No | None | NOT PERSISTED | PRODUCTION |

**Evidence:**
- File: `src/lib/collectors/binance.ts` — all Binance collection functions
- File: `src/lib/collectors/coingecko.ts` — CoinGecko collection
- File: `src/app/api/refresh/route.ts` — orchestration of collection + feature calculation

**Gaps:**
- No tick/minute-level data — only daily OHLCV
- OI history not persisted (used in-memory for prev comparison only)
- No streaming/real-time data
- No DeFi/on-chain data (TVL, exchange flow, whale data)
- No GitHub activity data
- No token unlock/supply data
- CoinGlass integration NOT implemented (only planned in MDD_Plan.md)

---

## 4. Collector Inventory

### 4.1 Binance Spot Collector

File: `src/lib/collectors/binance.ts`

```
fetchBinanceSpotKlines(symbol, limit=200, interval='1d')
  → Binance API → KlineData[] (open, high, low, close, volume, quoteVolume, openTime)
  → Stored in: market_price_daily
  → Error handling: try/catch, logged, returns []
  → Rate limits: Binance default (1200/min)
  → No retry mechanism
  → No timeout configuration
  → No deduplication (uses onConflictDoUpdate)
```

### 4.2 Binance Futures Collector

```
fetchBinanceFuturesKlines(symbol, limit=200, interval='1d')
  → Same structure as spot
  → Used for price when futures symbol available

fetchBinanceFuturesMetrics(symbol)
  → openInterest + fundingRate in single call
  → Stored in: coin_metrics (openInterest, fundingRate)

fetchBinanceOIHistory(symbol, period='1d', limit=2)
  → Returns OI time series — NOT PERSISTED
  → Used only for oiPrev comparison
```

### 4.3 CoinGecko Collector

File: `src/lib/collectors/coingecko.ts`

```
fetchCoinGeckoMarkets(coingeckoIds[])
  → Batch fetch for multiple coins
  → Returns: marketCap, fullyDilutedValuation
  → Stored in: coin_metrics (FDV in separate row)
  → No retry
  → Graceful degradation (returns empty Map on failure)
```

**All collectors share:**
- No explicit retry logic
- No timeout configuration
- No rate limit backoff
- Source status tracked in `source_status` table
- Error logged to console only

---

## 5. Persistence / Database Inventory

### 5.1 Schema Tables

File: `src/db/schema.ts` (24 migrations)

**Core Entity Tables:**

| Table | Purpose | Key Fields |
|---|---|---|
| `coins` | Coin registry | id, symbol, name, binanceSpotSymbol, binanceFuturesSymbol, coingeckoId, isActive |
| `narratives` | Narrative registry | id, name, description, isActive |
| `coin_narratives` | Membership mapping | coinId, narrativeId (many-to-many) |
| `watchlist` | User watchlist | userId, coinId, note, priority |

**Market Data Tables:**

| Table | Purpose | Key Fields |
|---|---|---|
| `market_price_daily` | OHLCV daily | coinId, date, open, high, low, close, volume, quoteVolume, source, volume24h |
| `coin_metrics` | Derivative + market data | coinId, date, source, marketCap, openInterest, fundingRate, fullyDilutedValuation |

**Feature/Scoring Tables:**

| Table | Purpose | Key Fields |
|---|---|---|
| `features` | Per-coin feature scores | coinId, date, versionId, trendScore, derivativeScore, volumeScore, momentumScore, confidenceScore, dataCompleteness, missingSources, sourceProvenance |
| `health_scores` | Coin health scores | coinId, date, healthScore, previousScore, scoreChange, status, confidenceScore, weightBreakdown, ruleVersionId |
| `recommendations` | Trading signals | coinId, date, signal, reason, reasonBreakdown, ruleVersionId |
| `narrative_health` | Narrative health | narrativeId, date, healthScore, scoreChange, status, coinCount, topCoinId, weakestCoinId, weightingMethod, weightDetails |
| `feature_versions` | Feature version tracking | id, version, description, isActive |
| `score_configs` | Weight configuration | id, configKey, configValue, isActive |

**Intelligence Tables:**

| Table | Purpose | Key Fields |
|---|---|---|
| `rule_versions` | Rule version registry | id, version, description, isActive |
| `recommendation_rules` | Rule definitions | id, ruleVersionId, signal, conditions, priority, isActive |
| `indicators` | Technical indicators | coinId, date, timeframe, indicatorType, indicatorValue, indicatorMeta, source |

**Snapshot Tables:**

| Table | Purpose | Key Fields |
|---|---|---|
| `morning_snapshots` | Daily snapshot header | id, date, ruleVersionId, createdAt |
| `morning_snapshot_headers` | Snapshot metadata | snapshotId, coinsProcessed, narrativesProcessed, duration, errors |
| `morning_snapshot_coins` | Per-coin snapshot | snapshotId, coinId, healthScore, scoreChange, signal, confidence |
| `morning_snapshot_narratives` | Per-narrative snapshot | snapshotId, narrativeId, healthScore, scoreChange, coinCount, topCoinId, weakestCoinId, weightingMethod |

**Infrastructure Tables:**

| Table | Purpose | Key Fields |
|---|---|---|
| `source_status` | Collector health | source, coinId, status, lastAttempt, lastSuccess, recordsCollected |
| `scheduler_logs` | Refresh job tracking | jobName, status, startedAt, completedAt, duration, recordsProcessed, errorMessage |

**Binance Square Tables (P5):**

| Table | Purpose | Key Fields |
|---|---|---|
| `square_opportunities` | Generated opportunities | type, subjectId, narrativeId, coinSymbol, score, rationale, entryZone, takeProfits, stopLoss, status |
| `square_publications` | Published posts | opportunityId, status, externalPostId, publishedAt, contentSnapshot, llmUsed, failureCategory, retryCount |
| `square_quota_log` | Daily quota tracking | date, postsPublished |
| `square_fingerprints` | Deduplication | fingerprint, expiresAt |
| `square_pipeline_executions` | Execution tracking | triggerType, startedAt, completedAt, evaluated, qualified, published, failed, deduped, quotaBlocked, durationMs |

### 5.2 Indexes

Primary keys on all `id` columns. Key composite indexes:
- `market_price_daily`: unique on (coinId, date)
- `coin_metrics`: unique on (coinId, date, source)
- `features`: unique on (coinId, date, versionId)
- `health_scores`: unique on (coinId, date)
- `recommendations`: unique on (coinId, date)
- `narrative_health`: unique on (narrativeId, date)
- `indicators`: index on (coinId, date, timeframe)
- `source_status`: index on (source, coinId)
- `scheduler_logs`: index on (jobName, status)

### 5.3 What Exists vs What P6 Needs

| P6 Need | Current Status | Evidence |
|---|---|---|
| Raw observations | **MISSING** | Only aggregated OHLCV stored |
| Normalized observations | **MISSING** | No normalization step |
| Market snapshots (point-in-time) | **PARTIAL** | `morning_snapshots` exist but only for daily refresh |
| OHLCV | **PRESENT** | `market_price_daily` |
| Volume | **PRESENT** | In `market_price_daily.volume` and `volume24h` |
| Open Interest | **PRESENT** | In `coin_metrics.openInterest` |
| Funding Rate | **PRESENT** | In `coin_metrics.fundingRate` |
| Price | **PRESENT** | In `market_price_daily.close` |
| Market Cap | **PRESENT** | In `coin_metrics.marketCap` |
| FDV | **PRESENT** | In `coin_metrics.fullyDilutedValuation` |
| Narrative Membership | **PRESENT** | `coin_narratives` table |
| Derived metrics | **PRESENT** | `features` table (trend, derivative, volume, momentum scores) |
| Health scores | **PRESENT** | `health_scores` + `narrative_health` |
| Trend states | **PRESENT** | `recommendations.signal` |
| Historical snapshots | **PRESENT** | `morning_snapshots*` tables |
| Alerts/warnings | **MISSING** | No alerting infrastructure |
| Confidence | **PRESENT** | `features.confidenceScore` |
| Data quality | **PARTIAL** | `features.dataCompleteness` + `features.missingSources` |
| Source provenance | **PRESENT** | `features.sourceProvenance` (JSON) |
| Algorithm version | **PRESENT** | `featureVersions` + `ruleVersions` |

---

## 6. Data Flow Map

```
                    ┌─────────────────────────────────────────┐
                    │           /api/refresh (POST)            │
                    │     Trigger: scheduler (4h) or manual    │
                    └────────────────┬────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────────┐
                    │         1. COLLECTION PHASE              │
                    │                                         │
                    │  Binance Spot ──→ Klines (200 daily)    │
                    │  Binance Futures ──→ Klines + OI + FR   │
                    │  CoinGecko ──→ Market Cap + FDV         │
                    │                                         │
                    │  Persist: market_price_daily, coin_metrics│
                    │  Track: source_status                    │
                    └────────────────┬────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────────┐
                    │       2. INDICATOR CALCULATION           │
                    │       (indicator.service.ts)             │
                    │                                         │
                    │  1D indicators → indicators table        │
                    │  4H indicators → indicators table        │
                    └────────────────┬────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────────┐
                    │        3. FEATURE ENGINE                 │
                    │     (features/engine.ts)                 │
                    │                                         │
                    │  Input: priceData[], OI, FR, MC, weights │
                    │  Output: FeatureEngineResult             │
                    │  ┌──────────────────────────────────┐    │
                    │  │ trend_score (EMA-based, 0-100)   │    │
                    │  │ derivative_score (OI+FR, 0-100)  │    │
                    │  │ volume_score (ratio, 0-100)      │    │
                    │  │ momentum_score (ROC+ATR, 0-100)  │    │
                    │  │ confidence_score (0-100)          │    │
                    │  │ data_completeness (0-1)           │    │
                    │  └──────────────────────────────────┘    │
                    │  Persist: features table                 │
                    └────────────────┬────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────────┐
                    │     4. HEALTH SCORING (Coin)             │
                    │   (features/engine.ts calculateHealthScore)│
                    │                                         │
                    │  formula:                                │
                    │    trend*0.35 + derivative*0.35          │
                    │    + volume*0.2 + momentum*0.1           │
                    │  Persist: health_scores table            │
                    └────────────────┬────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────────┐
                    │     5. RECOMMENDATION                    │
                    │   (rule-engine.service.ts)               │
                    │                                         │
                    │  Input: all feature scores + confidence  │
                    │  Output: signal (STRONG_WATCH/WATCH/     │
                    │          OBSERVE/WEAK) + reason          │
                    │  Persist: recommendations table          │
                    └────────────────┬────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────────┐
                    │     6. NARRATIVE HEALTH                  │
                    │   (scoring/narrative-health.ts)          │
                    │                                         │
                    │  Formula: market-cap weighted average    │
                    │  of coin health scores within narrative  │
                    │  Fallback: equal weighting               │
                    │  Persist: narrative_health table         │
                    └────────────────┬────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────────┐
                    │     7. MORNING SNAPSHOT (P1C)            │
                    │   (snapshot.service.ts)                  │
                    │                                         │
                    │  Creates daily snapshot of all scores    │
                    │  Persist: morning_snapshots* tables      │
                    └────────────────┬────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────────┐
                    │     8. SQUARE PIPELINE (non-blocking)    │
                    │   (square/production.ts)                 │
                    │                                         │
                    │  opportunity → content → publish         │
                    │  Persist: square_* tables                │
                    └─────────────────────────────────────────┘
```

---

## 7. Existing Metric / Feature Inventory

### 7.1 Feature Calculations

| Metric | Implementation | Input | Formula | Window | Output | Persistence | Consumer |
|---|---|---|---|---|---|---|---|
| **Trend Score** | `features/trend.ts` calculateTrendScore | closes[] | EMA(9) vs EMA(21) vs EMA(50) vs EMA(200), ADX positioning | 200 days | 0-100 | `features.trendScore` | health score |
| **Derivative Score** | `features/derivative.ts` calculateDerivativeScore | OI, OI_prev, fundingRate | OI change % component + funding rate component + accumulation bonus | 2 days | 0-100 | `features.derivativeScore` | health score |
| **Volume Score** | `features/volume.ts` calculateVolumeScore | volumes[] | volume_ratio = current / MA(20) | 20 days | 0-100 | `features.volumeScore` | health score |
| **Momentum Score** | `features/momentum.ts` calculateMomentumScore | closes[], highs[], lows[] | ROC(14) component + ATR(14)/price component | 14 days | 0-100 | `features.momentumScore` | health score |
| **Confidence Score** | `features/confidence.ts` calculateConfidence | source flags, hasFutures, weights | Weighted availability: spot(0.4) + futures(0.4) + coingecko(0.2) | Snapshot | 0-100 | `features.confidenceScore` | health score, UI warning |
| **Data Completeness** | `features/confidence.ts` | source flags | Fraction of expected sources available | Snapshot | 0-1 | `features.dataCompleteness` | health score |
| **Health Score (Coin)** | `features/engine.ts` calculateHealthScore | 4 feature scores + weights | Weighted sum: trend(0.35) + derivative(0.35) + volume(0.2) + momentum(0.1) | Daily | 0-100 | `health_scores` | narrative, dashboard |
| **Health Score (Narrative)** | `scoring/narrative-health.ts` | coin health scores + market caps | Market-cap weighted average of coin scores | Daily | 0-100 | `narrative_health` | dashboard |
| **Recommendation Signal** | `features/engine.ts` getRecommendationSignal | healthScore + thresholds | ≥90 STRONG_WATCH, ≥80 WATCH, ≥65 OBSERVE, else WEAK | Daily | enum | `recommendations` | dashboard |

**Evidence:**
- File: `src/lib/features/trend.ts` — lines 1-80
- File: `src/lib/features/derivative.ts` — lines 1-60
- File: `src/lib/features/volume.ts` — lines 1-40
- File: `src/lib/features/momentum.ts` — lines 1-50
- File: `src/lib/features/confidence.ts` — lines 1-60
- File: `src/lib/features/engine.ts` — lines 1-120
- File: `src/lib/scoring/narrative-health.ts` — lines 1-150

### 7.2 Technical Indicators (P1A)

File: `src/lib/services/indicator.service.ts`

| Indicator | Timeframe | Source |
|---|---|---|
| Various TA indicators | 1d, 4h | Binance klines |
| Stored per coin per day per timeframe | | `indicators` table |

### 7.3 What P6 Would Need But Is Missing

| P6 Need | Current Status | Gap |
|---|---|---|
| EMA (configurable windows) | Only EMA(9,21,50,200) hardcoded | Need configurable windows |
| ROC | Present (ROC(14)) | May need multiple windows |
| ATR | Present (ATR(14)) | May need multiple windows |
| Relative strength | **MISSING** | No cross-coin comparison metric |
| Volatility (standalone) | **MISSING** | Only ATR as proxy |
| Breadth | **MISSING** | No multi-coin aggregate metric |
| Participation | **MISSING** | No volume-weighted participation metric |
| Persistence score | **MISSING** | No scoring of score persistence over time |
| Multi-timeframe aggregation | **PARTIAL** | 1d and 4h calculated but not aggregated |

---

## 8. Existing Health System

### 8.1 Coin Health

File: `src/lib/features/engine.ts`

```
calculateHealthScore(trend, derivative, volume, momentum, weights)
  → weights: { trend: 0.35, derivative: 0.35, volume: 0.2, momentum: 0.1 }
  → Formula: weighted sum, clamped to [0, 100]
  → Configurable via score_configs table
```

**Status mapping** (from `getHealthStatus`):
- ≥90 → STRONG
- ≥80 → HEALTHY  
- ≥65 → NEUTRAL
- ≥50 → CAUTION
- <50 → WEAK

### 8.2 Narrative Health

File: `src/lib/scoring/narrative-health.ts`

```
calculateWeightedNarrativeHealth(narrativeId, date, coinScores, ruleVersionId, previousScore?)
  → If any coin missing marketCap: equal weighting
  → Otherwise: marketCap-weighted average
  → Outputs: healthScore, status, scoreChange, topCoinId, weakestCoinId, weightDetails
```

### 8.3 Health Timeline

File: `src/lib/services/health-timeline.service.ts`

```
getCoinTimeline(coinId, days=30)
  → Fetches health_scores for period
  → Calculates trend via linear regression (last 7 points)
  → Outputs: direction (improving/declining/stable), slope, 7d/30d change
```

### 8.4 Health Weights Configuration

Default weights stored in `score_configs`:
- `health_weights`: { trend: 0.35, derivative: 0.35, volume: 0.2, momentum: 0.1 }
- `confidence_weights`: { binance_spot: 0.4, binance_futures: 0.4, coingecko: 0.2 }

### 8.5 What's Missing for P6

| P6 Need | Status |
|---|---|
| Component health scores with weights | **PRESENT** (4 components) |
| Historical health state transitions | **PARTIAL** (scoreChange only, no state history table) |
| Health degradation alerts | **MISSING** |
| Multi-timeframe health | **MISSING** (only daily) |
| Coin-level vs narrative-level | **PRESENT** |
| Health state machine | **MISSING** (no state transition tracking) |
| Threshold-based alerts | **MISSING** |

---

## 9. Narrative Membership

File: `src/db/schema.ts` — `coin_narratives` table

```
coin_narratives:
  coinId: integer (FK → coins.id)
  narrativeId: integer (FK → narratives.id)
```

**Evidence:**
- File: `src/app/api/refresh/route.ts`, lines 310-320 — joins coinNarratives with coins to find coins in a narrative
- File: `src/lib/scoring/narrative-health.ts` — consumes membership for narrative health calculation

**Characteristics:**
- Many-to-many relationship
- Manual assignment (admin UI)
- No effective date / temporal membership
- No ordering within narrative
- No active/inactive per membership (only per coin)
- No membership history
- No duplicate handling needed (unique constraint)

**P6 Impact:** P6 breadth/participation metrics depend on membership. Current model is sufficient for basic breadth but lacks temporal awareness.

---

## 10. Timestamp & Freshness

### 10.1 Timestamp Semantics

| Table | Field | Meaning | Timezone |
|---|---|---|---|
| `market_price_daily` | `date` | Business date (YYYY-MM-DD) from openTime | Asia/Ho_Chi_Minh |
| `coin_metrics` | `date` | Business date of collection | Asia/Ho_Chi_Minh |
| `features` | `date` | Business date | Asia/Ho_Chi_Minh |
| `features` | `calculatedAt` | UTC timestamp of calculation | UTC |
| `health_scores` | `date` | Business date | Asia/Ho_Chi_Minh |
| `recommendations` | `date` | Business date | Asia/Ho_Chi_Minh |
| `narrative_health` | `date` | Business date | Asia/Ho_Chi_Minh |
| `indicators` | `date` | Business date | Asia/Ho_Chi_Minh |
| `source_status` | `lastAttempt` | UTC timestamp of last collection attempt | UTC |
| `source_status` | `lastSuccess` | UTC timestamp of last successful collection | UTC |
| `scheduler_logs` | `startedAt` | UTC timestamp of job start | UTC |
| `scheduler_logs` | `completedAt` | UTC timestamp of job completion | UTC |
| `morning_snapshots` | `date` | Business date | Asia/Ho_Chi_Minh |
| `morning_snapshots` | `createdAt` | UTC creation timestamp | UTC |

**Evidence:**
- File: `src/lib/utils.ts` — `getBusinessDate()` uses `Asia/Ho_Chi_Minh` timezone
- File: `src/app/api/refresh/route.ts` — kline timestamps converted via `getBusinessDate(new Date(kline.openTime))`

### 10.2 What's Missing

| P6 Need | Status |
|---|---|
| Source timestamp (when data was generated at source) | **PARTIAL** — openTime from klines, but OI/FR have no source timestamp |
| Ingestion timestamp | **PARTIAL** — calculatedAt for features, but not for raw observations |
| Processing timestamp | **MISSING** — no processing_end timestamp |
| Freshness model | **MISSING** — no freshness calculation or staleness detection |
| Daily boundary definition | **PRESENT** — Asia/Ho_Chi_Minh timezone |
| Clock assumptions | **PRESENT** — system clock for collection time |
| Stale detection | **MISSING** — only scheduler_logs stale lock (15min) |

---

## 11. Data Quality

### 11.1 Current Mechanisms

| Mechanism | Implementation | Location |
|---|---|---|
| Missing data handling | Feature engine returns 50 (neutral) if <20 price rows | `features/engine.ts` line 30-60 |
| Source availability tracking | `sourceStatus` table tracks OK/FAILED per source per coin | `refresh/route.ts` |
| Confidence scoring | Weighted source availability (spot 0.4, futures 0.4, coingecko 0.2) | `features/confidence.ts` |
| Data completeness | Fraction of available sources | `features/dataCompleteness` |
| Missing sources | List of unavailable sources | `features.missingSources` |
| Error logging | Console.log for collection failures | `refresh/route.ts` |

### 11.2 What's Missing

| P6 Need | Status |
|---|---|
| Missing data tracking (per-field) | **MISSING** — only source-level |
| Invalid value detection | **MISSING** |
| Outlier detection | **MISSING** |
| Stale data detection | **MISSING** |
| Inconsistent observation detection | **MISSING** |
| Insufficient history warning | **PARTIAL** — "Insufficient price data" in feature engine |
| Data quality metadata | **PARTIAL** — dataCompleteness + missingSources |
| Market health vs data quality distinction | **MISSING** |

---

## 12. Provenance & Reproducibility

### 12.1 Current Provenance Chain

```
Raw observation (API response)
    ↓ [NOT STORED — only OHLCV persisted]
Normalized observation
    ↓ [NOT STORED]
Derived metric (features)
    ↓ [STORED: features.sourceProvenance JSON]
Health result
    ↓ [STORED: health_scores.weightBreakdown JSON]
API response
    ↓
UI display
```

**Source Provenance stored in `features.sourceProvenance`:**

```json
{
  "trend": {
    "sources": ["binance_spot", "binance_futures"],
    "indicators": ["EMA_9", "EMA_21", "EMA_50", "EMA_200", "ADX_14"],
    "calculated_at": "2026-08-21T...",
    "confidence": 85
  },
  "derivative": {
    "sources": ["binance_futures"],
    "indicators": ["OI_CHANGE", "FUNDING_RATE"],
    "missing": ["LIQUIDATION"]
  }
}
```

### 12.2 Provenance Assessment

| Link | Status | Evidence |
|---|---|---|
| Raw observation → Source ID | **PARTIAL** | `source` column in tables |
| Source timestamp | **PARTIAL** | `calculated_at` in provenance, but no API response timestamp |
| Ingestion timestamp | **MISSING** | No explicit ingestion time |
| Algorithm version | **PRESENT** | `featureVersions`, `ruleVersions` |
| Configuration version | **PRESENT** | `scoreConfigs` active version |
| Input snapshot | **MISSING** | No snapshot of inputs used |
| Historical reproducibility | **NOT GUARANTEED** | Algorithm changes would recalculate differently |

---

## 13. API Consumers

| Route | Method | Purpose | Data Source | Consumer |
|---|---|---|---|---|
| `/api/refresh` | POST | Trigger data refresh | All collectors + feature engine | Scheduler, Admin |
| `/api/narratives` | GET | List narratives | `narratives` + `narrative_health` | Dashboard |
| `/api/narratives/[id]` | GET | Narrative detail | `narrative_health` + `health_scores` | Dashboard |
| `/api/coins` | GET | List coins | `coins` + `health_scores` | Dashboard, WatchList |
| `/api/coins/[id]` | GET | Coin detail | `coins` + `health_scores` + `features` + `indicators` | Coin page |
| `/api/coins/[id]/indicators` | GET | Technical indicators | `indicators` table | Coin page |
| `/api/coins/[id]/technical-analysis` | GET | Technical analysis | `indicators` + calculations | Coin page |
| `/api/watchlist` | GET/POST/DELETE | Watchlist CRUD | `watchlist` table | WatchList page |
| `/api/health-timeline/[coinId]` | GET | Health timeline | `health_scores` | Coin page |
| `/api/morning-snapshot` | GET | Daily snapshot | `morning_snapshots*` | Dashboard |
| `/api/admin/square/*` | Various | Square pipeline | `square_*` tables | Admin, Analytics |
| `/api/admin/square/analytics` | GET | Square analytics | `square_*` tables | Analytics UI |

---

## 14. UI Consumers

| Page | Route | Data Consumed | Components |
|---|---|---|---|
| **Dashboard** | `/` | Narratives list, top movers, source status | NarrativeHealthCard, TopMoversCard, SourceStatus |
| **WatchList** | `/watchlist` | User watchlist + coin scores | WatchlistCard |
| **Coin Detail** | `/coin/[id]` | Full coin data: scores, indicators, health timeline, technical analysis, price chart | HealthTimeline, ScoreBreakdown, PriceChart, IndicatorPanel |
| **Binance Square** | `/binance-square` | Square pipeline status | SquareDashboard |
| **Square Analytics** | `/square-analytics` | Analytics metrics | Full analytics dashboard |
| **Admin** | `/admin` | All system data | AdminDashboard |
| **Health Timeline** | (component) | `health_scores` history | HealthTimeline component |

---

## 15. Test Coverage

| Test File | What It Protects | Type |
|---|---|---|
| `src/lib/features/__tests__/*.test.ts` | Feature calculations (trend, derivative, volume, momentum, confidence, engine) | Unit |
| `src/lib/scoring/__tests__/*.test.ts` | Narrative health scoring | Unit |
| `src/lib/square/__tests__/*.test.ts` | Square pipeline (opportunity engine, content generator, publisher, analytics, production) | Unit |
| `src/lib/services/__tests__/*.test.ts` | Services (rule engine, snapshot, health timeline, indicator) | Unit |
| `src/app/api/**/*.test.ts` | API routes | Integration |
| `src/components/__tests__/*.test.ts` | UI components | Unit |
| `tests/p5/**/*.test.ts` | P5 regression (287 tests) | Regression |

**Current test counts:**
- Square tests: 134 PASS
- Analytics tests: 27 PASS
- P5 tests: 287 PASS
- Combined: 448+ PASS

---

## 16. P3/P4/P5 Dependency Boundary

### P3 → P4

P3 (Intelligence) provides:
- Coin health scores → consumed by P4 for opportunity detection
- Narrative health scores → consumed by P4 for narrative opportunities
- Feature scores → consumed by P4 for scoring
- Recommendations → consumed by P4 for signal-based opportunities
- Technical indicators → consumed by P4 for Entry/TP/SL calculation

### P4 → P5

P4 (Opportunity Engine) provides:
- `square_opportunities` records → consumed by P5 for content generation
- Quality gates → P5 only publishes qualified opportunities
- Entry/TP/SL levels → P5 includes in content

### P5 → P6

P5 (Square Publisher) provides:
- `square_publications` records → P6 could measure publication success
- `square_pipeline_executions` → P6 could analyze pipeline efficiency
- Content snapshots → P6 could analyze content quality

### Critical Boundaries

| Boundary | Status | Evidence |
|---|---|---|
| P4 does NOT interpret health scores as trading signals | **CORRECT** | P4 uses scores for opportunity quality, not trade execution |
| P5 does NOT modify Entry/TP/SL | **CORRECT** | P5 passes through from P4 |
| P5 does NOT bypass quality gates | **CORRECT** | Publisher checks qualification status |
| No trade execution semantics in P3-P5 | **CORRECT** | No buy/sell orders, no position management |

---

## 17. P6 Reusable Assets

| Asset | Reuse Classification | Notes |
|---|---|---|
| `market_price_daily` table | **REUSE-AS-IS** | Daily OHLCV is sufficient for daily-level P6 metrics |
| `coin_metrics` table | **REUSE-AS-IS** | OI, funding rate, market cap available |
| `features` table | **REUSE-AS-IS** | Feature scores with provenance |
| `health_scores` table | **REUSE-WITH-SEMANTIC-REVIEW** | Health scores may need P6-specific interpretation |
| `narrative_health` table | **REUSE-AS-IS** | Narrative-level aggregation |
| `indicators` table | **REUSE-AS-IS** | Technical indicators already calculated |
| `source_status` table | **REUSE-AS-IS** | Data source health tracking |
| `morning_snapshots` tables | **REUSE-AS-IS** | Daily snapshots for historical comparison |
| `coin_narratives` table | **REUSE-AS-IS** | Membership for breadth calculations |
| `feature_versions` | **REUSE-AS-IS** | Algorithm version tracking |
| `score_configs` | **REUSE-WITH-SEMANTIC-REVIEW** | Weights may need P6-specific configuration |
| `rule_versions` + `recommendation_rules` | **REUSE-AS-IS** | Configurable rule engine |
| Binance collectors | **REUSE-AS-IS** | Data collection functions |
| CoinGecko collector | **REUSE-AS-IS** | Market cap collection |
| Feature engine | **REUSE-WITH-ADAPTER** | May need configurable windows for P6 |
| Health timeline service | **REUSE-AS-IS** | Trend calculation |
| Snapshot service | **REUSE-AS-IS** | Daily snapshot creation |
| Refresh orchestration | **REUSE-WITH-ADAPTER** | P6 may need additional collection phases |
| Recharts | **REUSE-AS-IS** | Charting library for P6 UI |

---

## 18. P6 Gaps

### BLOCKING

| Gap | Description | Impact |
|---|---|---|
| **GAP-01: No raw observation storage** | API responses are parsed and aggregated but raw observations are not persisted. P6 cannot reprocess historical raw data. | P6 must either: (a) start storing raw observations, or (b) accept daily-only granularity forever. |
| **GAP-02: No tick/minute-level data** | Only daily OHLCV stored. P6 metrics like intraday volatility, volume profiles, or session analysis impossible. | P6 must decide: daily-only or invest in higher-frequency collection + storage. |
| **GAP-03: No freshness model** | No mechanism to detect stale data. P6 cannot know if a coin's data is 1 hour or 5 days old. | P6 must implement freshness tracking. |

### NON-BLOCKING

| Gap | Description | Impact |
|---|---|---|
| **GAP-04: No breadth/participation metrics** | No aggregate market metrics (e.g., % of coins in uptrend). | P6 must compute from existing data or add new collection. |
| **GAP-05: No relative strength** | No cross-coin comparison metric. | P6 must implement if needed. |
| **GAP-06: No volatility standalone metric** | Only ATR as proxy. | P6 may need dedicated volatility calculation. |
| **GAP-07: No persistence/stability scoring** | No metric for how stable a health score has been over time. | P6 must implement. |
| **GAP-08: No alerting infrastructure** | No mechanism to trigger alerts on score changes. | P6 must implement if alerts needed. |
| **GAP-09: No DeFi/on-chain data** | No TVL, exchange flow, whale data. | P6 may need new collectors. |
| **GAP-10: No token unlock/supply data** | No circulating supply changes. | P6 may need new collectors. |

### INFORMATIONAL

| Gap | Description |
|---|---|
| **GAP-11: No multi-timeframe aggregation** | 1d and 4h indicators calculated separately, not aggregated |
| **GAP-12: OI history not persisted** | Used in-memory for comparison only |
| **GAP-13: No health state machine** | No tracking of state transitions (WEAK→NEUTRAL→HEALTHY) |

---

## 19. Ambiguities / Unknowns

| # | Question | Evidence Needed |
|---|---|---|
| 1 | How fresh is the 4-hour refresh cycle in practice? Are there delays? | Production scheduler logs analysis |
| 2 | What is the actual data retention period? Are old records purged? | Production DB inspection |
| 3 | Are CoinGecko API rate limits causing data gaps? | Production source_status analysis |
| 4 | What is the current active coin count? | Production coins table |
| 5 | Are there coins with incomplete data coverage? | Production features table analysis |
| 6 | How do the current health scores compare to market reality? | External validation needed |
| 7 | What is the actual latency of the refresh pipeline end-to-end? | Production scheduler_logs.duration |

---

## 20. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Daily-only data may limit P6 metric granularity | HIGH | P6 must decide early whether higher-frequency data is required |
| 2 | No raw observation storage limits reprocessing | MEDIUM | P6 can start fresh with new storage; historical data limited |
| 3 | CoinGecko free tier rate limits may cause gaps | MEDIUM | Monitor source_status; consider paid tier |
| 4 | Feature engine weights are not version-controlled per calculation | LOW | featureVersions table exists but weights aren't snapshot per calculation |
| 5 | No data quality score independent of health score | MEDIUM | P6 must distinguish data quality from market health |
| 6 | Refresh lock timeout (15min) may be too short for large coin sets | LOW | Monitor scheduler_logs for stale jobs |

---

## 21. Evidence Index

| Finding | File | Lines | Observation |
|---|---|---|---|
| Feature engine runs 4 scores | `src/lib/features/engine.ts` | 25-100 | trend, derivative, volume, momentum calculated from price + OI + FR |
| Health score weights hardcoded | `src/lib/features/engine.ts` | 92-98 | trend:0.35, derivative:0.35, volume:0.2, momentum:0.1 default |
| Narrative health uses MC weighting | `src/lib/scoring/narrative-health.ts` | 50-80 | Falls back to equal if any coin missing marketCap |
| OI history not persisted | `src/app/api/refresh/route.ts` | ~200-210 | `oiPrev` from `fetchBinanceOIHistory` used in-memory only |
| Provenance stored as JSON | `src/app/api/refresh/route.ts` | ~230-260 | `sourceProvenance` object with sources, indicators, calculated_at |
| Business timezone is Asia/Ho_Chi_Minh | `src/lib/utils.ts` | N/A | `getBusinessDate()` uses this timezone for all date calculations |
| Square pipeline runs non-blocking | `src/app/api/refresh/route.ts` | ~400-415 | try/catch around `runSquarePipeline()`, failure doesn't break refresh |
| Refresh lock timeout 15min | `src/app/api/refresh/route.ts` | 23-24 | `REFRESH_LOCK_TIMEOUT = 15 * 60 * 1000` |
| No retry in collectors | `src/lib/collectors/binance.ts` | All | try/catch with console.error, no retry loop |
| Market cap from CoinGecko prioritized | `src/app/api/refresh/route.ts` | ~130-150 | CoinGecko mcap used if available, Binance approximation as fallback |
| Morning snapshot created per refresh | `src/app/api/refresh/route.ts` | ~370-400 | snapshotService.createDailySnapshot called at end of refresh |
| Indicators calculated for 1d and 4h | `src/app/api/refresh/route.ts` | ~280-300 | Both timeframes calculated if klines available |

---

## 22. Final Recon Verdict

### Implementation Truth

The system has a working P3→P4→P5 pipeline with:
- Real market data from Binance (spot + futures) and CoinGecko
- 4 feature scores calculated per coin daily
- Coin and narrative health scores with market-cap weighting
- Configurable rule engine for recommendations
- Daily morning snapshots for historical comparison
- Binance Square content publication with analytics
- Solid test coverage (448+ tests)

### Documentation Intent vs Implementation

| Area | Implementation Truth | Documentation Intent | Gap |
|---|---|---|---|
| Data Collection | Binance + CoinGecko, daily only | MDD_Plan.md planned CoinGlass, DeFiLlama | NOT IMPLEMENTED |
| Health Scoring | 4-component weighted average | MDD_Plan.md planned 6 components (including narrative, smart_money, onchain, risk) | Only 4 of 6 implemented |
| Morning Snapshot | Daily snapshot of scores | MDD_Plan.md planned morning brief, vital signs, diagnosis, prescription | Only scores snapshotted |
| Technical Indicators | 1d and 4h via indicator service | MDD_Plan.md planned comprehensive TA | Partially implemented |

### P6 Reusability Summary

**Can reuse immediately:**
- All market data tables (OHLCV, OI, FR, MC)
- Feature calculation framework
- Health scoring framework
- Narrative membership model
- Snapshot infrastructure
- Source status tracking
- Collector functions

**Must adapt for P6:**
- Feature engine (configurable windows)
- Refresh orchestration (additional collection phases)

**Must build new for P6:**
- Raw observation storage
- Freshness model
- Breadth/participation metrics
- Relative strength
- Alerting infrastructure
- State machine tracking

---

**P6-01A RECON COMPLETE**
**NO PRODUCTION CODE CHANGES**
**NO SCHEMA CHANGES**
**NO API CHANGES**
**NO P4/P5 CONTRACT CHANGES**
