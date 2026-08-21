# SQ-AN-01 — Data Inventory

## 1. Database Tables — Complete Field Inventory

### Table: `square_opportunities`

| # | Field | DB Type | Nullable | Default | Index | Reusable for Analytics |
|---|---|---|---|---|---|---|
| 1 | `id` | SERIAL PK | NO | auto | — | ✅ Primary key |
| 2 | `type` | VARCHAR(30) | NO | — | ✅ typeIdx | ✅ COIN vs NARRATIVE breakdown |
| 3 | `subject_id` | INTEGER | YES | — | ✅ subjectIdx | ✅ Join to coins/narratives |
| 4 | `narrative_id` | INTEGER FK | YES | — | ✅ subjectIdx | ✅ Narrative analytics |
| 5 | `coin_symbol` | VARCHAR(20) | YES | — | — | ✅ Coin-level analytics |
| 6 | `score` | DECIMAL(5,2) | NO | — | — | ✅ Score distribution |
| 7 | `data_as_of` | DATE | NO | — | — | ✅ Freshness tracking |
| 8 | `data_quality` | VARCHAR(10) | NO | — | — | ✅ Quality breakdown |
| 9 | `rationale` | JSONB | NO | — | — | ⚠️ Content analysis |
| 10 | `entry_zone` | JSONB | YES | — | — | ⚠️ Content snapshot |
| 11 | `take_profits` | JSONB | YES | — | — | ⚠️ Content snapshot |
| 12 | `stop_loss` | JSONB | YES | — | — | ⚠️ Content snapshot |
| 13 | `expires_at` | TIMESTAMPTZ | YES | — | — | ✅ Expiration tracking |
| 14 | `status` | VARCHAR(20) | NO | CANDIDATE | ✅ statusIdx | ✅ Status funnel |
| 15 | `content_snapshot` | JSONB | YES | — | — | ✅ Generated content |
| 16 | `created_at` | TIMESTAMPTZ | NO | NOW() | ✅ createdIdx | ✅ Time-series |

**Indexes**: statusIdx, typeIdx, subjectIdx (subject_id, narrative_id), createdIdx

### Table: `square_publications`

| # | Field | DB Type | Nullable | Default | Index | Reusable for Analytics |
|---|---|---|---|---|---|---|
| 1 | `id` | SERIAL PK | NO | auto | — | ✅ Primary key |
| 2 | `opportunity_id` | INTEGER FK | NO | — | ✅ opportunityIdx, opportunityStatusIdx | ✅ Join to opportunity |
| 3 | `fingerprint` | VARCHAR(200) UNIQUE | NO | — | ✅ fingerprintIdx | ✅ Dedup tracking |
| 4 | `provider` | VARCHAR(50) | NO | BINANCE_SQUARE | — | ✅ Multi-provider ready |
| 5 | `status` | VARCHAR(20) | NO | — | ✅ statusIdx, opportunityStatusIdx | ✅ Publication funnel |
| 6 | `published_at` | TIMESTAMPTZ | YES | — | ✅ publishedIdx | ✅ Time-series |
| 7 | `external_post_id` | VARCHAR(100) | YES | — | — | ✅ Binance post ID |
| 8 | `content_version` | VARCHAR(20) | NO | — | — | ⚠️ Version tracking |
| 9 | `template_version` | VARCHAR(20) | NO | — | — | ⚠️ Version tracking |
| 10 | `llm_used` | BOOLEAN | NO | false | — | ✅ LLM vs template breakdown |
| 11 | `retry_count` | INTEGER | YES | 0 | — | ✅ Reliability metrics |
| 12 | `failure_category` | VARCHAR(30) | YES | — | — | ✅ Failure classification |
| 13 | `error_code` | VARCHAR(20) | YES | — | — | ✅ Error analysis |
| 14 | `error_message` | TEXT | YES | — | — | ⚠️ Debugging |
| 15 | `content_snapshot` | JSONB | YES | — | — | ✅ Full content + latency |
| 16 | `created_at` | TIMESTAMPTZ | NO | NOW() | — | ✅ Creation time |

**Indexes**: statusIdx, opportunityIdx, fingerprintIdx, publishedIdx, opportunityStatusIdx (composite)

**content_snapshot structure**:
```json
{
  "text": "Full post text...",
  "title": "Optional title",
  "chartSymbol": "BTC",
  "chartMatchesSource": true,
  "latencyMs": 1234
}
```

### Table: `square_quota_log`

| # | Field | DB Type | Nullable | Default | Index | Reusable for Analytics |
|---|---|---|---|---|---|---|
| 1 | `id` | SERIAL PK | NO | auto | — | — |
| 2 | `date` | DATE UNIQUE | NO | — | — | ✅ Daily time-series |
| 3 | `posts_published` | INTEGER | NO | 0 | — | ✅ Quota utilization |
| 4 | `uploads_used` | INTEGER | NO | 0 | — | ✅ Upload tracking |
| 5 | `last_refresh_at` | TIMESTAMPTZ | YES | — | — | ✅ Refresh frequency |
| 6 | `warning_at_threshold` | BOOLEAN | YES | false | — | ✅ Warning events |
| 7 | `created_at` | TIMESTAMPTZ | NO | NOW() | — | — |
| 8 | `updated_at` | TIMESTAMPTZ | NO | NOW() | — | — |

### Table: `square_fingerprints`

| # | Field | DB Type | Nullable | Default | Index | Reusable for Analytics |
|---|---|---|---|---|---|---|
| 1 | `id` | SERIAL PK | NO | auto | — | — |
| 2 | `fingerprint` | VARCHAR(200) UNIQUE | NO | — | ✅ fingerprintIdx | — |
| 3 | `opportunity_id` | INTEGER FK | NO | — | — | ✅ Join to opportunity |
| 4 | `published_at` | TIMESTAMPTZ | NO | — | — | ✅ When published |
| 5 | `expires_at` | TIMESTAMPTZ | YES | — | ✅ expiresIdx | ✅ TTL tracking |
| 6 | `created_at` | TIMESTAMPTZ | NO | NOW() | — | — |

---

## 2. Existing Related Tables

### Table: `coins` (for join)

| Field | Analytics Use |
|---|---|
| `id` | Join from square_opportunities.subject_id |
| `symbol` | Coin-level grouping |
| `name` | Display |
| `binanceSpotSymbol` | Chart symbol normalization |
| `hasFutures` | Feature flag |

### Table: `narratives` (for join)

| Field | Analytics Use |
|---|---|
| `id` | Join from square_opportunities.narrative_id |
| `name` | Narrative-level grouping |
| `isActive` | Filter active narratives |

### Table: `scheduler_logs` (for pipeline correlation)

| Field | Analytics Use |
|---|---|
| `jobName` | Filter refresh jobs |
| `status` | STARTED/COMPLETED/FAILED |
| `startedAt` | When refresh ran |
| `completedAt` | When refresh finished |
| `duration` | Refresh duration |
| `recordsProcessed` | Volume metric |

---

## 3. Data Quality Assessment

### square_opportunities

| Check | Status |
|---|---|
| Data completeness | ⚠️ Entry/TP/SL may be null for WATCH type |
| Coin symbol consistency | ✅ Normalized to uppercase |
| Score range | ✅ 0-100 enforced by DECIMAL(5,2) |
| Status lifecycle | ✅ CANDIDATE → QUALIFIED → PUBLISHED/EXPIRED |
| Historical snapshot | ✅ entry_zone, take_profits, stop_loss stored as JSONB |

### square_publications

| Check | Status |
|---|---|
| Status accuracy | ✅ PUBLISHED only when Binance confirms |
| External post ID | ✅ Stored on success |
| Fingerprint uniqueness | ✅ UNIQUE constraint |
| Content snapshot | ✅ Full text + metadata |
| Error tracking | ✅ error_code + error_message + failure_category |

### Data Retention

| Table | Retention | Notes |
|---|---|---|
| `square_opportunities` | Indefinite | Historical record |
| `square_publications` | Indefinite | Historical record |
| `square_quota_log` | Indefinite | One row/day |
| `square_fingerprints` | TTL-based | Expired entries can be cleaned |

---

## 4. Query Patterns for V1 Analytics

### Publication Funnel (per cycle)

```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'CANDIDATE') as evaluated,
  COUNT(*) FILTER (WHERE status = 'QUALIFIED') as qualified,
  COUNT(*) FILTER (WHERE status = 'PUBLISHED') as published,
  COUNT(*) FILTER (WHERE status = 'FAILED') as failed,
  COUNT(*) FILTER (WHERE status = 'SUPPRESSED') as deduplicated
FROM square_opportunities
WHERE created_at >= $1;  -- cycle start time
```

### Daily Publication Stats

```sql
SELECT
  date,
  posts_published,
  uploads_used,
  warning_at_threshold
FROM square_quota_log
ORDER BY date DESC
LIMIT 30;
```

### Coin-Level Publication Count

```sql
SELECT
  o.coin_symbol,
  COUNT(p.id) as total_publications,
  COUNT(p.id) FILTER (WHERE p.status = 'PUBLISHED') as published,
  COUNT(p.id) FILTER (WHERE p.status = 'FAILED') as failed,
  AVG(p.retry_count) as avg_retries
FROM square_opportunities o
LEFT JOIN square_publications p ON p.opportunity_id = o.id
GROUP BY o.coin_symbol
ORDER BY published DESC;
```

### LLM vs Template Usage

```sql
SELECT
  llm_used,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE status = 'PUBLISHED') as published
FROM square_publications
GROUP BY llm_used;
```

### Failure Analysis

```sql
SELECT
  failure_category,
  error_code,
  COUNT(*) as count,
  AVG(retry_count) as avg_retries
FROM square_publications
WHERE status = 'FAILED'
GROUP BY failure_category, error_code
ORDER BY count DESC;
```

### Latency Distribution

```sql
SELECT
  (content_snapshot->>'latencyMs')::int as latency_ms
FROM square_publications
WHERE content_snapshot ? 'latencyMs'
ORDER BY latency_ms;
```

---

## 5. Data NOT Available

| Data | Why Missing | Possible Future Source |
|---|---|---|
| Post views | Binance API doesn't expose via OpenAPI | Binance internal analytics (if offered) |
| Post likes | Same | Same |
| Post comments | Same | Same |
| Post shares | Same | Same |
| Coin clicks from post | No tracking mechanism | Binance affiliate program (not integrated) |
| Conversion/revenue | No affiliate system | Binance affiliate API (if available) |
| Opportunity evaluation count (historical) | Not persisted per execution | Requires `square_pipeline_executions` table |
| Time spent on content generation | Not tracked | Low priority |

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
