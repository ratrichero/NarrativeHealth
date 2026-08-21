# SQ-AN-02 — Analytics Data Foundation & API

## 1. Migration 0024: `square_pipeline_executions`

Persists per-cycle pipeline metrics for analytics queries.

```sql
CREATE TABLE square_pipeline_executions (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  trigger_type VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED',  -- SCHEDULED, MANUAL, RETRY
  evaluated INTEGER NOT NULL DEFAULT 0,
  qualified INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  deduplicated INTEGER NOT NULL DEFAULT 0,
  quota_blocked INTEGER NOT NULL DEFAULT 0,
  retry_pending INTEGER NOT NULL DEFAULT 0,
  content_generation_failed INTEGER NOT NULL DEFAULT 0,
  llm_used_count INTEGER NOT NULL DEFAULT 0,
  template_fallback_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  quota_remaining_start INTEGER,
  quota_remaining_end INTEGER,
  quota_warning BOOLEAN DEFAULT FALSE,
  error_summary JSONB,  -- { errors: string[], error_count: number }
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Indexes
- `idx_square_pipeline_executions_started` ON `started_at`
- `idx_square_pipeline_executions_trigger` ON `trigger_type`

---

## 2. Schema Changes

| Table | Change | Column |
|---|---|---|
| `square_pipeline_executions` | NEW TABLE | All fields above |

### Drizzle Schema Definition

Added to `src/db/schema.ts` after `squareFingerprints`:

```typescript
export const squarePipelineExecutions = pgTable("square_pipeline_executions", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  triggerType: varchar("trigger_type", { length: 30 }).notNull().default("SCHEDULED"),
  evaluated: integer("evaluated").notNull().default(0),
  qualified: integer("qualified").notNull().default(0),
  published: integer("published").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  deduplicated: integer("deduplicated").notNull().default(0),
  quotaBlocked: integer("quota_blocked").notNull().default(0),
  retryPending: integer("retry_pending").notNull().default(0),
  contentGenerationFailed: integer("content_generation_failed").notNull().default(0),
  llmUsedCount: integer("llm_used_count").notNull().default(0),
  templateFallbackCount: integer("template_fallback_count").notNull().default(0),
  durationMs: integer("duration_ms"),
  quotaRemainingStart: integer("quota_remaining_start"),
  quotaRemainingEnd: integer("quota_remaining_end"),
  quotaWarning: boolean("quota_warning").default(false),
  errorSummary: jsonb("error_summary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  startedIdx: index("square_pipeline_executions_started_idx").on(table.startedAt),
  triggerIdx: index("square_pipeline_executions_trigger_idx").on(table.triggerType),
}));
```

---

## 3. Production Pipeline Changes

### `src/lib/square/production.ts`

Added after pipeline execution summary is built:
- Imports `db` and `squarePipelineExecutions` from schema
- Inserts execution record after successful pipeline run
- Inserts execution record after failed pipeline run
- Wrapped in try/catch — DB failure does not break the pipeline

**Key design decisions:**
1. Execution record is inserted AFTER the summary is built (non-blocking)
2. If the insert fails, the pipeline still completes successfully
3. Both success AND failure paths create execution records
4. Error summary is stored as JSONB for post-hoc analysis

---

## 4. Analytics Service

### `src/lib/square/analytics.ts`

| Function | Returns | Source |
|---|---|---|
| `getOverview(range)` | Total executions, published, failed, success rate | `square_pipeline_executions` |
| `getPublicationFunnel(range)` | Evaluated → qualified → published funnel | `square_pipeline_executions` |
| `getDailyPublications(range)` | Daily published/remaining counts | `square_quota_log` |
| `getCoinBreakdown(range)` | Per-coin publication stats | `square_opportunities` + `square_publications` |
| `getNarrativeBreakdown(range)` | Per-narrative publication stats | `square_opportunities` + `square_publications` |
| `getLlmUsage(range)` | LLM vs template usage + publish rates | `square_publications` |
| `getFailureAnalysis(range)` | Failure by category + avg retries | `square_publications` |
| `getRetryStats(range)` | Retry success rate, max retries | `square_publications` |
| `getLatencyStats(range)` | P50/P95/P99 API latency | `square_publications.content_snapshot` |
| `getQuotaAnalytics()` | Today's usage, daily cap, avg usage | `square_quota_log` |
| `getScoreDistribution(range)` | Opportunity score histogram | `square_opportunities` |
| `getSuccessRateTrend(range)` | Daily success rate over time | `square_pipeline_executions` |

### Time Ranges
- `TODAY` — current day
- `7D` — last 7 days
- `30D` — last 30 days
- `ALL` — since 2024-01-01

---

## 5. Analytics API

### `GET /api/admin/square/analytics`

**Query parameters:**
- `?range=TODAY|7D|30D|ALL` (default: 30D)
- `?section=overview|funnel|daily|coins|narratives|llm|failures|retry|latency|quota|scores|trend|all` (default: all)

**Response:**
```json
{
  "success": true,
  "range": "30D",
  "section": "all",
  "data": {
    "overview": { ... },
    "funnel": { ... },
    "daily": [ ... ],
    "coins": [ ... ],
    "narratives": [ ... ],
    "llm": { ... },
    "failures": [ ... ],
    "retry": { ... },
    "latency": { ... },
    "quota": { ... },
    "scores": [ ... ],
    "trend": [ ... ]
  }
}
```

**Design decisions:**
- Single endpoint with section parameter (reduces HTTP overhead)
- No external API calls — all data from DB
- No engagement metrics (SQ-AN-01 confirmed: NOT AVAILABLE)
- No fake/estimated metrics
- Server-side only (no client bundle exposure)

---

## 6. Data Reconciliation

### How analytics numbers reconcile with existing tables

| Metric | Source Table | Reconciliation |
|---|---|---|
| Published count | `square_pipeline_executions.published` | Sum of all executions |
| Published count (alt) | `square_publications.status = 'PUBLISHED'` | COUNT of published records |
| Failed count | `square_pipeline_executions.failed` | Sum of all executions |
| Failed count (alt) | `square_publications.status = 'FAILED'` | COUNT of failed records |
| Quota today | `square_quota_log.postsPublished` | Today's row |
| LLM usage | `square_publications.llmUsed` | Boolean filter |

**Both reconciliation paths should produce identical numbers.** Any discrepancy indicates a bug.

---

## 7. Files Changed

| File | Type | Change |
|---|---|---|
| `drizzle/migrations/0024_add_square_pipeline_executions.sql` | NEW | Schema migration |
| `src/db/schema.ts` | MODIFIED | Added `squarePipelineExecutions` table |
| `src/lib/square/production.ts` | MODIFIED | Persist execution records |
| `src/lib/square/analytics.ts` | NEW | Analytics service |
| `src/app/api/admin/square/analytics/route.ts` | NEW | Analytics API endpoint |
| `src/lib/square/__tests__/analytics.test.ts` | NEW | 11 tests |

## 8. Tests

| Test | Count | Status |
|---|---|---|
| Analytics service | 11 | ✅ PASS |
| Square tests (existing) | 96 | ✅ PASS |
| P5 regression | 287 | ✅ PASS |
| Combined | 394 | ✅ PASS |

## 9. Verification

| Check | Result |
|---|---|
| Typecheck | ✅ CLEAN |
| Square tests | ✅ 96/96 PASS |
| P5 regression | ✅ 287/287 PASS |
| P4 modified | ZERO |
| P5 modified | ZERO |
| P6 modified | ZERO |
| No external API calls | ✅ VERIFIED |
| No secret leakage | ✅ VERIFIED |
| No fake metrics | ✅ VERIFIED |
