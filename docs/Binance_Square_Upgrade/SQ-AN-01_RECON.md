# SQ-AN-01 — Repository & Data Recon

## 1. Square Publishing Pipeline — Full Trace

### Data Flow (Source-Verified)

```
4h Scheduler Trigger
       ↓
POST /api/refresh
       ↓
Refresh success (P4 + P5 processing)
       ↓
runSquarePipeline() [src/lib/square/production.ts]
       ↓
evaluateOpportunities() [src/lib/square/opportunity-engine.ts]
       ↓
0..N SquareOpportunity[] (with Entry/TP/SL calculated deterministically)
       ↓
buildContentBrief() → SquareContentBrief (with chartCoin, cashtags)
       ↓
generateContent() [src/lib/square/content-generator.ts]
       ↓
  ├─ GOOGLE_API_KEY present → Google LLM generation
  └─ Fallback → Template-based generation (deterministic)
       ↓
publishContent() [src/lib/square/publisher.ts]
       ↓
  ├─ Quota check (100/day)
  ├─ Duplicate check (fingerprint)
  ├─ Thesis stability check
  ├─ Retry budget check (max 2 retries)
  ├─ Binance API call (POST /content/add)
  │    ├─ Success → PUBLISHED
  │    ├─ Transient error → RETRY_PENDING
  │    ├─ Permanent error → FAILED
  │    └─ Timeout with ID → PUBLISHED (idempotent)
  └─ Record in DB
       ↓
square_publications + square_fingerprints + square_quota_log
```

### Opportunity Fields (square_opportunities)

| Field | Type | Source | Description |
|---|---|---|---|
| `id` | SERIAL PK | System | Auto-increment |
| `type` | VARCHAR(30) | Opportunity engine | COIN_SETUP, NARRATIVE_SETUP, WATCH |
| `subject_id` | INTEGER | Refresh data | coin_id or narrative_id |
| `narrative_id` | INTEGER FK | Refresh data | Reference to narratives table |
| `coin_symbol` | VARCHAR(20) | Refresh data | e.g., BTC, ETH, SOL |
| `score` | DECIMAL(5,2) | Opportunity engine | 0-100 quality score |
| `data_as_of` | DATE | Refresh data | When source data was collected |
| `data_quality` | VARCHAR(10) | Opportunity engine | HIGH, MEDIUM, LOW |
| `rationale` | JSONB | Opportunity engine | Array of reason strings |
| `entry_zone` | JSONB | Deterministic calc | {low, high} or null |
| `take_profits` | JSONB | Deterministic calc | [{label, level}] or null |
| `stop_loss` | JSONB | Deterministic calc | {label, level} or null |
| `expires_at` | TIMESTAMPTZ | Opportunity engine | When opportunity expires |
| `status` | VARCHAR(20) | Pipeline | CANDIDATE, QUALIFIED, SUPPRESSED, PUBLISHED, EXPIRED |
| `content_snapshot` | JSONB | Content generator | Generated content snapshot |
| `created_at` | TIMESTAMPTZ | System | When detected |

### Publication Fields (square_publications)

| Field | Type | Source | Description |
|---|---|---|---|
| `id` | SERIAL PK | System | Auto-increment |
| `opportunity_id` | INTEGER FK | Pipeline | References square_opportunities |
| `fingerprint` | VARCHAR(200) UNIQUE | Publisher | SHA-256 dedup key |
| `provider` | VARCHAR(50) | Default | BINANCE_SQUARE |
| `status` | VARCHAR(20) | Publisher | DRAFT, PUBLISHED, FAILED, SUPPRESSED, RETRY_PENDING, UNKNOWN |
| `published_at` | TIMESTAMPTZ | Binance API | When Binance confirmed |
| `external_post_id` | VARCHAR(100) | Binance API | Real Binance post ID |
| `content_version` | VARCHAR(20) | Publisher | 1.0.0 |
| `template_version` | VARCHAR(20) | Publisher | 1.0.0 |
| `llm_used` | BOOLEAN | Content generator | true if Google LLM used |
| `retry_count` | INTEGER | Publisher | Number of retry attempts |
| `failure_category` | VARCHAR(30) | Publisher | TRANSIENT, PERMANENT, TIMEOUT, UNKNOWN |
| `error_code` | VARCHAR(20) | Binance API | API error code if failed |
| `error_message` | TEXT | Binance API | Error message if failed |
| `content_snapshot` | JSONB | Publisher | {text, title, chartSymbol, chartMatchesSource, latencyMs} |
| `created_at` | TIMESTAMPTZ | System | When record created |

### Quota Fields (square_quota_log)

| Field | Type | Description |
|---|---|---|
| `date` | DATE UNIQUE | Calendar day |
| `posts_published` | INTEGER | Posts published today |
| `uploads_used` | INTEGER | Media uploads today |
| `last_refresh_at` | TIMESTAMPTZ | Last refresh time |
| `warning_at_threshold` | BOOLEAN | Warning logged at 80% |
| `created_at` | TIMESTAMPTZ | Record creation |
| `updated_at` | TIMESTAMPTZ | Last update |

### Fingerprint Fields (square_fingerprints)

| Field | Type | Description |
|---|---|---|
| `fingerprint` | VARCHAR(200) UNIQUE | SHA-256 dedup key |
| `opportunity_id` | INTEGER FK | References square_opportunities |
| `published_at` | TIMESTAMPTZ | When published |
| `expires_at` | TIMESTAMPTZ | TTL (72h for regular, 168h for thesis) |

### Deduplication

- **Regular fingerprint**: `SHA256(type|subjectId|coinSymbol|narrativeId|entryLevel|dataAsOf)` → 64-char hex
- **Thesis fingerprint**: `SHA256(type|subjectId|narrativeId|coinSymbols|signal|entryLow|entryHigh|tpLevels|slLevel|invalidation)` → 64-char hex
- **TTL**: 72 hours (regular), 168 hours (thesis)
- **Behavior**: Same fingerprint within TTL → suppressed, not republished

### Quota

- **Daily hard cap**: 100 posts/day
- **Warning threshold**: 80 posts (80%)
- **Atomic increment**: Uses SQL `posts_published + 1` on conflict update
- **Cannot be exceeded** even in concurrent execution

---

## 2. Database Schema Audit

### All Square Tables

| Table | Rows Expected | Purpose |
|---|---|---|
| `square_opportunities` | 0..N per refresh | Detected publishing opportunities |
| `square_publications` | 0..N per opportunity | Published/failed post records |
| `square_quota_log` | 1 per day | Daily quota tracking |
| `square_fingerprints` | 0..N (TTL-based) | Deduplication state |

### Indexes

```sql
-- square_opportunities
idx_square_opportunities_status ON (status)
idx_square_opportunities_type ON (type)
idx_square_opportunities_subject ON (subject_id, narrative_id)
idx_square_opportunities_created ON (created_at)

-- square_publications
idx_square_publications_status ON (status)
idx_square_publications_opportunity ON (opportunity_id)
idx_square_publications_fingerprint ON (fingerprint)  -- UNIQUE
idx_square_publications_published ON (published_at)
idx_square_publications_opportunity_status ON (opportunity_id, status)  -- retry lookup

-- square_fingerprints
idx_square_fingerprints_fingerprint ON (fingerprint)  -- UNIQUE
idx_square_fingerprints_expires ON (expires_at)  -- TTL cleanup
```

### Uniqueness Constraints

| Table | Unique On | Purpose |
|---|---|---|
| `square_publications.fingerprint` | fingerprint | One record per unique content |
| `square_quota_log.date` | date | One row per calendar day |
| `square_fingerprints.fingerprint` | fingerprint | One dedup entry per content |

### Relationships

```
square_opportunities.id ←── square_publications.opportunity_id (FK, RESTRICT)
square_opportunities.id ←── square_fingerprints.opportunity_id (FK, RESTRICT)
narratives.id ←── square_opportunities.narrative_id (FK, SET NULL)
```

---

## 3. Binance Square Metrics Audit

### What the API Actually Supports

Based on `SQ_API_CONTRACT.md` and verified production usage:

| Capability | API Endpoint | Status |
|---|---|---|
| **Create post** | `POST /content/add` | ✅ VERIFIED LIVE |
| **Get post by ID** | Unknown | NOT AVAILABLE via OpenAPI |
| **Get post views** | Unknown | NOT AVAILABLE via OpenAPI |
| **Get post likes** | Unknown | NOT AVAILABLE via OpenAPI |
| **Get post comments** | Unknown | NOT AVAILABLE via OpenAPI |
| **Get post shares** | Unknown | NOT AVAILABLE via OpenAPI |
| **Get post saves** | Unknown | NOT AVAILABLE via OpenAPI |
| **Search own posts** | Unknown | NOT AVAILABLE via OpenAPI |
| **Get account stats** | Unknown | NOT AVAILABLE via OpenAPI |

### API Contract — Single Endpoint Verified

```
POST https://www.binance.com/bapi/composite/v1/public/pgc/openApi/content/add
Headers: X-Square-OpenAPI-Key, Content-Type, clienttype
Body: { contentType, bodyTextOnly }
Response: { code, message, success, data: { id, shareLink } }
```

**No read/metrics endpoints documented or verified.**

### Binance Square OpenAPI Skill (External Reference)

The `binance-skills-hub/square-post` skill provides write-only capabilities:
- Text posts
- Image posts (up to 4)
- Long-form articles
- Video posts

**No analytics/metrics/read capabilities in the skill.**

---

## 4. Monetization / Affiliate Audit

### Current State

| Capability | Status | Evidence |
|---|---|---|
| Affiliate link integration | NOT AVAILABLE | No code references to affiliate/referral |
| Commission tracking | NOT AVAILABLE | No schema, no API, no code |
| Click tracking | NOT AVAILABLE | No Binance API for this |
| Conversion tracking | NOT AVAILABLE | No data source |
| Revenue attribution | NOT AVAILABLE | No data source |
| UTM parameters | NOT AVAILABLE | Not implemented |

### Key Question: Can we trace which post generated a click?

**Answer: NO.**

The current system:
1. Publishes to Binance Square → gets `postId`
2. Saves `postId` in `square_publications`
3. **Cannot** receive any feedback from Binance about user interactions with that post

### Key Question: Can we trace which post generated revenue?

**Answer: NO.**

There is no:
- Affiliate link in posts
- Click tracking mechanism
- Conversion tracking
- Commission data source

---

## 5. UI Architecture Audit

### Navigation

```
Navigation (src/components/Navigation.tsx)
  ├─ Dashboard (/)
  ├─ Watchlist (/watchlist)
  ├─ Snapshots (/snapshots)
  └─ Admin (/admin)
```

### Current Routes

| Route | Page | Purpose |
|---|---|---|
| `/` | `src/app/page.tsx` | Dashboard — narrative cards, top movers, weakest |
| `/watchlist` | `src/app/watchlist/page.tsx` | Watchlist management |
| `/snapshots` | `src/app/snapshots/page.tsx` | Historical snapshot browser |
| `/coin/[id]` | `src/app/coin/[id]/page.tsx` | Coin detail — health, indicators, timeline |
| `/narrative/[id]` | `src/app/narrative/[id]/page.tsx` | Narrative detail — coins, correlations, momentum |
| `/admin` | `src/app/admin/page.tsx` | Admin panel — alerts, events, rules, logs |

### Design Conventions

- **Theme**: Dark mode (`bg-slate-950`, `text-slate-100`)
- **Components**: shadcn/ui (`Card`, `CardHeader`, `CardContent`, `CardTitle`)
- **Colors**: Cyan accents (`cyan-400`, `cyan-500`), green for positive, red for negative
- **Icons**: Lucide React (`TrendingUp`, `TrendingDown`, `AlertCircle`)
- **Data**: React Query (`@tanstack/react-query`) for server state
- **Layout**: `container mx-auto px-4 py-6`
- **Tables**: Custom components with `bg-slate-800/50` backgrounds

### Proposed Analytics UI Location

| Section | Proposed Route | Rationale |
|---|---|---|
| Square Analytics Dashboard | `/square` or `/admin/square` | Keep with admin or add to nav |
| Square Publications List | Within dashboard | Tab/section in Square page |
| Square Performance Chart | Within dashboard | Chart component |

---

## 6. Historical Integrity Audit

### Publication Traceability

For any publication, the following can be traced:

```
square_publications
  ├─ opportunity_id → square_opportunities
  │    ├─ type (COIN_SETUP / NARRATIVE_SETUP)
  │    ├─ coin_symbol → coins (via subject_id)
  │    ├─ narrative_id → narratives
  │    ├─ score (opportunity quality)
  │    ├─ data_as_of (when data was collected)
  │    ├─ data_quality (HIGH/MEDIUM/LOW)
  │    ├─ rationale (reasons for opportunity)
  │    ├─ entry_zone → {low, high}
  │    ├─ take_profits → [{label, level}]
  │    └─ stop_loss → {label, level}
  ├─ content_snapshot
  │    ├─ text (full post content)
  │    ├─ title (if article)
  │    ├─ chartSymbol (normalized coin)
  │    ├─ chartMatchesSource (boolean)
  │    └─ latencyMs (API response time)
  ├─ external_post_id (Binance post ID)
  ├─ status (PUBLISHED / FAILED / etc.)
  ├─ published_at (Binance confirmation time)
  ├─ llm_used (true/false)
  ├─ retry_count (number of retries)
  ├─ failure_category (TRANSIENT/PERMANENT/TIMEOUT/UNKNOWN)
  └─ fingerprint (dedup key)
```

### What Is Snapshot vs Reference

| Data | Stored In | Type |
|---|---|---|
| Full post text | `content_snapshot.text` | Snapshot |
| Entry zone values | `opportunity.entry_zone` | Snapshot (immutable once created) |
| TP/SL values | `opportunity.take_profits/stop_loss` | Snapshot |
| Opportunity score | `opportunity.score` | Snapshot |
| Coin symbol | `opportunity.coin_symbol` | Snapshot |
| Narrative ID | `opportunity.narrative_id` | FK reference |
| Binance post ID | `external_post_id` | Runtime value |
| Published timestamp | `published_at` | Runtime value |

---

## 7. Analytics Feasibility Matrix

| Metric | Source | Available Now | Historical | Reliable | Implementation Needed |
|---|---|---|---|---|---|
| **Published count** | DB (`square_publications`) | ✅ YES | ✅ YES | ✅ YES | API query |
| **Failed count** | DB (`square_publications`) | ✅ YES | ✅ YES | ✅ YES | API query |
| **Deduped count** | DB (opportunity status SUPPRESSED) | ✅ YES | ✅ YES | ✅ YES | API query |
| **Quota remaining** | DB (`square_quota_log`) | ✅ YES | ✅ YES | ✅ YES | API query |
| **Opportunity evaluated** | Pipeline summary (in-memory) | ⚠️ LAST RUN ONLY | ❌ NO | ⚠️ PARTIAL | Add pipeline_execution table |
| **LLM usage** | DB (`llm_used`) | ✅ YES | ✅ YES | ✅ YES | API query |
| **Retry count** | DB (`retry_count`) | ✅ YES | ✅ YES | ✅ YES | API query |
| **Failure category** | DB (`failure_category`) | ✅ YES | ✅ YES | ✅ YES | API query |
| **Latency** | DB (`content_snapshot.latencyMs`) | ✅ YES | ✅ YES | ✅ YES | API query |
| **Post views** | Binance API | ❌ NOT AVAILABLE | ❌ NOT AVAILABLE | — | Requires new API (not exist) |
| **Post likes** | Binance API | ❌ NOT AVAILABLE | ❌ NOT AVAILABLE | — | Requires new API (not exist) |
| **Post comments** | Binance API | ❌ NOT AVAILABLE | ❌ NOT AVAILABLE | — | Requires new API (not exist) |
| **Post shares** | Binance API | ❌ NOT AVAILABLE | ❌ NOT AVAILABLE | — | Requires new API (not exist) |
| **Coin clicks** | Binance/Affiliate | ❌ NOT AVAILABLE | ❌ NOT AVAILABLE | — | No data source exists |
| **Conversions** | Affiliate API | ❌ NOT AVAILABLE | ❌ NOT AVAILABLE | — | No data source exists |
| **Revenue** | Affiliate API | ❌ NOT AVAILABLE | ❌ NOT AVAILABLE | — | No data source exists |

---

## 8. Gap Classification

### A — Must Fix Before V1 Analytics UI

| Gap | Impact | Effort |
|---|---|---|
| No pipeline execution history table | Cannot show per-cycle stats | LOW — add table |
| Opportunity evaluation count not persisted | Cannot compute pass rate | LOW — add to table |
| No admin API for Square analytics | Cannot display data in UI | MEDIUM — new API |

### B — High-Value Enhancement

| Gap | Impact | Effort |
|---|---|---|
| No content performance metrics | Cannot measure post effectiveness | HIGH — requires Binance API (not available) |
| No time-series of publication status | Cannot show trend charts | LOW — query existing data |
| No coin-level publication breakdown | Cannot show per-coin stats | LOW — SQL aggregation |
| No narrative-level publication breakdown | Cannot show per-narrative stats | LOW — SQL aggregation |

### C — Future (Blocked by External Dependencies)

| Gap | Impact | Effort |
|---|---|---|
| Binance post metrics (views/likes) | Cannot measure engagement | BLOCKED — no API available |
| Affiliate link integration | Cannot trace monetization | BLOCKED — no affiliate setup |
| Click tracking | Cannot measure click-through | BLOCKED — no Binance support |
| Conversion tracking | Cannot measure ROI | BLOCKED — no data source |

### D — Not Needed

| Item | Reason |
|---|---|
| Real-time WebSocket updates | Not applicable for daily analytics |
| ML prediction of post performance | Premature without metrics data |
| A/B testing framework | Not applicable at this scale |

---

## Verification

| Check | Result |
|---|---|
| Typecheck | NOT RUN (read-only audit) |
| Tests | NOT RUN (read-only audit) |
| Production source modified | ZERO |
| P4 modified | ZERO |
| P5 modified | ZERO |
| P6 modified | ZERO |
