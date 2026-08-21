# SQ-OPERATE-02 IMPLEMENTATION

## Date
2026-08-21

## Overview
SQ-OPERATE-02 transforms the Binance Square pipeline from "can run" to "runs reliably and observably for real monetization."

---

## Files Changed

| File | Type | Changes |
|---|---|---|
| `drizzle/migrations/0023_add_square_reliability.sql` | migration | NEW — retry_count, failure_category, quota warning |
| `src/db/schema.ts` | schema | Added retryCount, failureCategory, warningAtThreshold, opportunityStatusIdx |
| `src/lib/square/publisher.ts` | production | Retry logic, failure classification, quota warning, observability |
| `src/lib/square/production.ts` | production | PipelineExecutionSummary, content generation, quota tracking |
| `src/app/api/admin/square-test/route.ts` | API | Full pipeline execution, dry-run mode, GET summary |
| `src/lib/square/__tests__/operate-02-reliability.test.ts` | test | NEW — 18 tests |

---

## P1 — Retry & Failure Handling

### New Status Types
```
DRAFT | PUBLISHED | FAILED | SUPPRESSED | RETRY_PENDING | UNKNOWN
```

### Failure Classification
```typescript
classifyFailure(errorCode, errorMessage, isTimeout) → { status, category }
```

| Error Pattern | Category | Status | Retry? |
|---|---|---|---|
| Network timeout, ECONNREFUSED, ETIMEDOUT | TRANSIENT | RETRY_PENDING | ✅ |
| Binance API 220003, 220004, 220009 | PERMANENT | FAILED | ❌ |
| Sensitive words (20002, 20022) | PERMANENT | FAILED | ❌ |
| Unknown error | UNKNOWN | FAILED | ❌ |
| Timeout without response | TIMEOUT | RETRY_PENDING | ✅ |

### Retry Flow
```
First attempt
  → FAIL + RETRY_PENDING
  → record with fingerprint, status=RETRY_PENDING

Second attempt (retryCount=1)
  → Skip dedup check (fingerprint already exists)
  → Re-attempt Binance API
  → If FAIL again + RETRYABLE → retryCount=2

Third attempt (retryCount=2, MAX_RETRIES)
  → If FAIL → status=UNKNOWN, category=UNKNOWN
  → No more retries
```

### Idempotency Safety
- Before retry: checks if PUBLISHED record exists → skip (already published)
- Before first attempt: checks fingerprint dedup + thesis stability
- On success: records fingerprint + thesis fingerprint + increments quota
- `MAX_RETRIES = 2` — hard limit, cannot be exceeded

---

## P2 — Publication Observability

### `llmUsed` Tracking
- `content-generator.ts` returns `GeneratedContent.llmUsed = true` when LLM succeeds
- `production.ts` passes `llmUsed` to `publishContent()`
- `publisher.ts` stores `llmUsed` in `squarePublications` record

### Retry Count
- `squarePublications.retry_count` — incremented on each retry
- First attempt: `retry_count = 0`
- First retry: `retry_count = 1`
- Second retry: `retry_count = 2`

### Pipeline Duration
- `PipelineExecutionSummary.durationMs` — total pipeline wall-clock time
- Per-opportunity `latencyMs` — time for each Binance API call

### Structured Logging
```
[SQ-PUBLISHER] PUBLISHED opp=42 retry=0 latency=1234ms category=null externalId=12345
[SQ-PIPELINE] evaluated=25 qualified=8 published=2 failed=1 deduped=3 retryPending=1 quotaBlocked=1 duration=5432ms quotaRemaining=97
```

---

## P3 — Quota Control

### Warning Threshold
- At 80% of daily cap (80/100): log warning + set `warning_at_threshold = true`
- Warning logged once per day (prevents spam)
- `QuotaStatus.warningThreshold: boolean` exposed to callers

### Atomic Quota Increment
- Existing `onConflictDoUpdate` pattern preserved
- Retry paths re-check quota before each attempt
- Quota consumed only on confirmed success (or timeout-with-ID)

---

## P4 — Controlled Manual Trigger

### Upgraded Admin Endpoint
```
POST /api/admin/square-test
  Body: { "dryRun": true }  — evaluate without publishing
  Body: { "dryRun": false } — full pipeline execution

GET /api/admin/square-test
  → Returns last pipeline execution summary + current quota
```

### Full Pipeline Execution
- Evaluates opportunities via `evaluateOpportunities()`
- Generates content via `generateContent()` (LLM or template fallback)
- Applies quality gates, thesis dedup, quota check
- Publishes 0..N posts
- Returns full `PipelineExecutionSummary`

### Dry-Run Mode
- Returns quota status without executing pipeline
- Safe for operator verification

---

## P5 — Failure-rate Visibility

### PipelineExecutionSummary
```typescript
{
  executedAt: string;          // ISO timestamp
  durationMs: number;          // Wall-clock time
  evaluated: number;           // Opportunities evaluated by engine
  qualified: number;           // Passed quality gates
  persisted: number;           // Saved to DB
  published: number;           // Successfully published
  failed: number;              // Failed publication
  deduplicated: number;        // Suppressed by dedup
  quotaBlocked: number;        // Blocked by quota
  retryPending: number;        // Pending retry
  quotaRemaining: number;      // Posts remaining today
  quotaWarning: boolean;       // Near daily cap
  llmUsedCount: number;        // Posts using LLM content
  llmFallbackCount: number;    // Posts using template fallback
  details: PipelineDetail[];   // Per-opportunity results
}
```

### Per-Opportunity Detail
```typescript
{
  opportunityId: number;
  coinSymbol?: string;
  type: string;
  score: number;
  result: "PUBLISHED" | "FAILED" | "DEDUPED" | "QUOTA_BLOCKED" | "RETRY_PENDING" | "SKIPPED";
  retryCount: number;
  failureCategory?: string;
  latencyMs?: number;
}
```

---

## Verification

| Check | Result |
|---|---|
| Typecheck | ✅ CLEAN |
| Square tests | ✅ 96/96 PASS (78 existing + 18 new) |
| P5 regression | ✅ 287/287 PASS |
| Full combined | ✅ 383/383 PASS |
| P4/P5/P6 untouched | ✅ ZERO modifications |
| No new trading semantics | ✅ No BUY/SELL/ORDER/EXECUTE |
| No API contract changes | ✅ SQ_API_CONTRACT.md unchanged |
