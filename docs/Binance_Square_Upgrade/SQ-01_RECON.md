# SQ-01 — Repository Recon & Binance Square API Contract

**Project:** NarrativeHealth  
**Upgrade:** Binance Square Content & Monetization  
**Document:** SQ-01 — Repository Recon  
**Status:** RECON COMPLETE  
**Baseline:** P4-P5 frozen, P6 NOT STARTED  
**Master spec:** `docs/Binance_Square_Upgrade/BINANCE_SQUARE_MASTER_SPECIFICATION.md`

---

## 1. Scheduler Architecture

### Current scheduler

**Location:** `backend/scheduler.py`  
**Type:** APScheduler `AsyncIOScheduler`  
**Timezone:** `Asia/Ho_Chi_Minh` (UTC+7)

Two modes:
- **Interval mode** (`scheduler_interval_hours > 0`): runs every N hours (current: configurable, default 4h)
- **Daily mode** (`scheduler_interval_hours = 0`): runs at configured hour:minute

### Refresh trigger chain

```text
APScheduler fires
    ↓
_run_refresh(job_id)
    ↓
POST http://localhost:3000/api/refresh  (Next.js primary)
    ↓ fallback on failure
POST http://localhost:8000/api/refresh  (FastAPI backup)
    ↓
Next.js /api/refresh/route.ts executes full pipeline
```

### P3 execution loop

Separate scheduler job (`p3_execution_loop`) runs independently, calls:
```
POST http://localhost:3000/api/admin/p3/execute
```

**Key finding:** The scheduler is a simple HTTP trigger. The Square integration can hook into the same post-refresh event without modifying the scheduler itself.

### Scheduler configuration

| Parameter | Source | Default |
|---|---|---|
| `SCHEDULER_ENABLED` | `.env` | `true` |
| `SCHEDULER_HOUR` | `.env` | `7` |
| `SCHEDULER_MINUTE` | `.env` | `0` |
| `SCHEDULER_INTERVAL_HOURS` | `.env` | `0` (daily) |
| `SCHEDULER_TIMEOUT` | `.env` | `600s` |
| `SCHEDULER_P3_ENABLED` | `.env` | `true` |
| `SCHEDULER_P3_INTERVAL_HOURS` | `.env` | `48` |

---

## 2. Data Pipeline (Refresh)

**Location:** `src/app/api/refresh/route.ts`

### Pipeline steps

```text
1. Get active rule version
2. Get all active coins
3. Get/get feature version
4. Get score configs (health_weights, confidence_weights)
5. Collect CoinGecko market data (FDV, market cap)
6. For each active coin:
   a. Fetch Binance Futures klines (200 daily)
   b. Fallback to Binance Spot klines
   c. Fetch 4h klines
   d. Fetch 24h volume from ticker
   e. Save market_price_daily
   f. Fetch Binance Futures OI + funding rate
   g. Save coin_metrics
   h. Calculate technical indicators (1d, 4h)
   i. Calculate features (trend, derivative, volume, momentum)
   j. Save features
   k. Calculate health score
   l. Save health_scores
   m. Generate recommendation via rule engine
   n. Save recommendations
7. For each active narrative:
   a. Get coin health scores
   b. Get market cap for weighting
   c. Calculate weighted narrative health
   d. Save narrative_health
8. Update source_status
9. Create morning snapshot
10. Log to scheduler_logs
```

### Data sources

| Source | API | Data Collected |
|---|---|---|
| Binance Spot | `api.binance.com/api/v3` | Klines (OHLCV), 24h ticker |
| Binance Futures | `fapi.binance.com/fapi/v1` | Klines, OI, funding rate |
| Binance Futures Data | `fapi.binance.com/futures/data` | OI history, long/short ratio |
| CoinGecko | `api.coingecko.com/api/v3` | Market cap, FDV, price, volume |

---

## 3. Available Data for Square Content

### Per-coin data (from refresh)

| Field | Source Table | Available? | Value for Square |
|---|---|---|---|
| Symbol | `coins` | ✅ | Cashtag `$SYMBOL` |
| Health score | `health_scores` | ✅ | Health assessment |
| Score change | `health_scores` | ✅ | Momentum signal |
| Signal | `recommendations` | ✅ | STRONG_WATCH/WATCH/OBSERVE/WEAK |
| Confidence | `health_scores` | ✅ | Data quality qualifier |
| Trend score | `features` | ✅ | Price trend assessment |
| Derivative score | `features` | ✅ | OI/funding assessment |
| Volume score | `features` | ✅ | Volume assessment |
| Momentum score | `features` | ✅ | Momentum assessment |
| Current price | `market_price_daily` | ✅ | Entry/TP/SL calculation |
| OI | `coin_metrics` | ✅ | Derivative context |
| Funding rate | `coin_metrics` | ✅ | Market sentiment |
| Market cap | `coin_metrics` | ✅ | Size context |
| FDV | `coin_metrics` | ✅ | Fully diluted valuation |
| Technical indicators | `indicators` | ✅ | RSI, MACD, EMA signals |
| Price history (200d) | `market_price_daily` | ✅ | Chart data, support/resistance |

### Per-narrative data

| Field | Source Table | Available? | Value for Square |
|---|---|---|---|
| Name | `narratives` | ✅ | Narrative context |
| Health score | `narrative_health` | ✅ | Narrative health |
| Score change | `narrative_health` | ✅ | Narrative momentum |
| Coin count | `narrative_health` | ✅ | Participation breadth |
| Top coin | `narrative_health` | ✅ | Leader identification |
| Weakest coin | `narrative_health` | ✅ | Laggard identification |
| Coin breakdown | `narrative_health` | ✅ | Individual contributions |
| Weighting method | `narrative_health` | ✅ | Market-cap vs equal |

### P3/P4/P5 intelligence (for richer content)

| Layer | Available? | Value for Square |
|---|---|---|
| P3 Intelligence | ✅ | Regime, rotation, leadership |
| P4 Decision Support | ✅ | Direction, confidence, opportunity/risk |
| P5 Decision Record | ✅ | Policy decision, safety, explanation |

---

## 4. Binance Square API Contract (from skill docs)

### Authentication

```env
BINANCE_SQUARE_OPENAPI_KEY=...
```

Key location priority:
1. `BINANCE_SQUARE_OPENAPI_KEY` env var
2. `~/.config/binance-square/openapi-key`

Key creation: https://www.binance.com/square/creator-center/home

### Post types

| Type | Script | Required Flags |
|---|---|---|
| Text-only short post | `post-text.mjs` | `--text` |
| Long article, no media | `post-text.mjs` | `--text --title` |
| Image post (1-4 imgs) | `post-image.mjs` | `--text --images "p1,p2"` |
| Article with cover | `post-image.mjs` | `--text --title --cover` |
| Video post | `post-video.mjs` | `--video --duration` (+ optional `--text`) |

### Constraints

- Images: max 4 per post; article cover: exactly 1
- Video: max 1 per post
- Images and video mutually exclusive
- Daily limits: 100 posts/day, 400 uploads/day
- `$coin` and `#topic` parsed server-side — preserve verbatim
- Never modify user-provided text

### Error codes

| Code | Meaning |
|---|---|
| 220003 | API key not found |
| 220004 | API key expired |
| 220009 | Daily post limit exceeded |
| 220014 | Daily upload limit exceeded |
| 20002/20022 | Sensitive words detected |
| 20013 | Content length limited |
| 30008/2000001/2000002 | Account/device restriction |

### Script execution

All scripts run from the skill directory:
```bash
node scripts/post-text.mjs --text "Hello #crypto $BTC"
node scripts/post-image.mjs --text "Chart analysis" --images "./chart1.png"
node scripts/post-video.mjs --video "./video.mp4" --duration 7.5 --text "My analysis"
```

Key must be injected as env var, never as CLI arg.

---

## 5. Entry / TP / SL Data Availability

### What we CAN calculate from existing data

| Level | Method | Data Source |
|---|---|---|
| **Entry zone** | Current price ± ATR-based range | `market_price_daily` + `indicators` (ATR_14) |
| **TP1** | Resistance / measured move | `indicators` (EMA levels, previous highs) |
| **TP2** | Extended target | `indicators` + percentage-based |
| **SL** | Below recent support / ATR stop | `indicators` (ATR_14, EMA levels) |

### What we CANNOT calculate (missing data)

| Level | Missing | Impact |
|---|---|---|
| On-chain support levels | No on-chain data | Minor — use technical levels |
| Order book depth | No order book API | Minor — use price structure |
| Liquidation levels | No liquidation data API | Minor — use ATR-based stops |

**Assessment:** Existing Binance price + indicator data is sufficient for defensible V1 Entry/TP/SL. The `indicators` table already stores RSI, MACD, EMA values that can be used for technical setup calculation.

---

## 6. Narrative→Coin Membership

**Tables:**
- `coin_narratives` (simple many-to-many)
- `narrative_membership_events` (authoritative ledger)
- `narrative_membership_snapshots` (periodic snapshots)

**Key fields:** `coinId`, `narrativeId`, `isPrimary`

Square content needs:
- Coin symbol → cashtag mapping: `coins.symbol` → `$SYMBOL`
- Narrative → coins mapping: `coin_narratives` or `narrative_membership_events`
- Primary coin per narrative: `coin_narratives.is_primary`

---

## 7. Scheduler Hook Point

### Option A: Post-refresh hook in Next.js

Add a Square evaluation step at the end of `/api/refresh/route.ts`, after morning snapshot creation.

**Pros:** Runs in the same transaction context, has direct DB access.
**Cons:** Extends refresh endpoint, couples Square to refresh.

### Option B: Separate scheduler job

Add a new APScheduler job that fires after refresh completion.

**Pros:** Clean separation, independent failure handling.
**Cons:** Requires scheduler modification, timing coordination.

### Option C: Event-driven (recommended for V1)

After refresh completes successfully, the refresh route calls a Square evaluation endpoint (POST) as a non-blocking side effect. The Square pipeline runs independently and fails independently.

**Pros:** Clean separation, no impact on refresh success/failure, independent quota tracking.
**Cons:** Requires a new API endpoint.

**Recommendation:** Option C — the refresh route fires a non-blocking POST to a Square evaluation endpoint. The Square pipeline is fully isolated.

---

## 8. Environment Variables Required

```env
# Binance Square OpenAPI (posting)
BINANCE_SQUARE_OPENAPI_KEY=...

# Google LLM (content generation - future)
GOOGLE_API_KEY=...

# Existing (no changes)
DATABASE_URL=...
SCHEDULER_ENABLED=true
SCHEDULER_INTERVAL_HOURS=4
```

---

## 9. Database Schema Additions Required

### Square publications table

```sql
CREATE TABLE square_publications (
  id SERIAL PRIMARY KEY,
  opportunity_id VARCHAR(100) NOT NULL,
  fingerprint VARCHAR(200) NOT NULL UNIQUE,
  provider VARCHAR(50) NOT NULL DEFAULT 'BINANCE_SQUARE',
  status VARCHAR(20) NOT NULL, -- DRAFT, PUBLISHED, FAILED, SUPPRESSED
  published_at TIMESTAMPTZ,
  external_post_id VARCHAR(100),
  content_version VARCHAR(20) NOT NULL,
  template_version VARCHAR(20) NOT NULL,
  llm_used BOOLEAN NOT NULL DEFAULT FALSE,
  error_code VARCHAR(20),
  error_message TEXT,
  content_snapshot JSONB, -- What was published
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Square opportunities table

```sql
CREATE TABLE square_opportunities (
  id SERIAL PRIMARY KEY,
  type VARCHAR(30) NOT NULL, -- COIN_SETUP, NARRATIVE_SETUP, WATCH
  subject_id INTEGER, -- coin_id or narrative_id
  narrative_id INTEGER,
  coin_symbol VARCHAR(20),
  score DECIMAL(5,2) NOT NULL,
  data_as_of DATE NOT NULL,
  data_quality VARCHAR(10) NOT NULL, -- HIGH, MEDIUM, LOW
  rationale JSONB NOT NULL,
  entry_zone JSONB,
  take_profits JSONB,
  stop_loss JSONB,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Square quota tracking

```sql
CREATE TABLE square_quota_log (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  posts_published INTEGER NOT NULL DEFAULT 0,
  uploads_used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(date)
);
```

---

## 10. Frozen Boundary Checklist

| Boundary | Status | Square Impact |
|---|---|---|
| P5-03 Policy evaluator | FROZEN | Square does NOT modify |
| P5-04 Safety evaluator | FROZEN | Square does NOT modify |
| P5-05 Explanation evaluator | FROZEN | Square does NOT modify |
| P5-09 Artifact recorder | FROZEN | Square does NOT modify |
| P5-10 Decision producer | FROZEN | Square does NOT modify |
| P5-11 Runtime adapter | FROZEN | Square does NOT modify |
| P4 Decision Support | FROZEN | Square may READ |
| P3 Intelligence | FROZEN | Square may READ |
| Refresh pipeline | ACTIVE | Square hooks AFTER completion |
| Database schema | ACTIVE | Square adds new tables only |
| API contracts | ACTIVE | Square adds new endpoints only |

---

## 11. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Binance API key compromise | HIGH | Env var only, never in logs/source |
| LLM hallucination in content | HIGH | Deterministic validation, template fallback |
| Fabricated price levels | HIGH | Levels derived only from existing data |
| Daily quota exhaustion | MEDIUM | Quota tracking, cooldown, soft caps |
| Refresh failure cascading to Square | LOW | Square pipeline isolated from refresh |
| Duplicate posts | MEDIUM | Fingerprint-based deduplication |
| Sensitive word detection | LOW | Binance returns error, logged and suppressed |

---

## 12. Recon Summary

### What exists

- ✅ Working 4h refresh scheduler (APScheduler)
- ✅ Full Binance Spot/Futures data collection
- ✅ CoinGecko market data
- ✅ Feature calculation engine (trend, derivative, volume, momentum)
- ✅ Health scoring (coin + narrative)
- ✅ Technical indicators (RSI, MACD, EMA, ATR)
- ✅ P3/P4/P5 intelligence pipeline
- ✅ Morning snapshot persistence
- ✅ Narrative→coin membership

### What's needed for Square

- ❌ Binance Square posting scripts (install from skill)
- ❌ Opportunity evaluation engine
- ❌ Content brief builder
- ❌ Entry/TP/SL calculation module
- ❌ Content template engine
- ❌ LLM integration (Google API)
- ❌ Content validation
- ❌ Publication store (new tables)
- ❌ Quota tracking
- ❌ Deduplication/fingerprinting
- ❌ Scheduler hook (post-refresh)

### No blockers

All required data is available in the existing database. No new external data sources are needed for V1. The Binance Square API is well-documented via the provided skill.

---

**SQ-01 Recon: COMPLETE**  
**Next task:** SQ-02 — Opportunity Detection Engine
