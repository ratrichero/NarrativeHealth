# SQ-AN-02 — Analytics API Specification

## Endpoint

```
GET /api/admin/square/analytics
```

## Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `range` | `TODAY \| 7D \| 30D \| ALL` | No | `30D` | Time range for analytics |
| `section` | `overview \| funnel \| daily \| coins \| narratives \| llm \| failures \| retry \| latency \| quota \| scores \| trend \| all` | No | `all` | Which section(s) to return |

## Response Format

```typescript
{
  success: boolean;
  range: TimeRange;
  section: string;
  data: {
    overview?: OverviewAnalytics;
    funnel?: PublicationFunnel;
    daily?: DailyPublication[];
    coins?: CoinBreakdown[];
    narratives?: NarrativeBreakdown[];
    llm?: LlmUsage;
    failures?: FailureAnalysis[];
    retry?: RetryStats;
    latency?: LatencyStats;
    quota?: QuotaStatus;
    scores?: ScoreDistribution[];
    trend?: SuccessRateTrend[];
  };
}
```

## Section Details

### `overview`
```typescript
{
  totalExecutions: number;      // Total pipeline runs in range
  totalPublished: number;       // Total posts published
  totalFailed: number;          // Total posts failed
  totalDeduplicated: number;    // Total posts deduplicated
  totalQuotaBlocked: number;    // Total posts blocked by quota
  successRate: number;          // published / (published + failed) * 100
  avgDurationMs: number;        // Average pipeline duration
  avgEvaluated: number;         // Average opportunities evaluated per run
  avgQualified: number;         // Average opportunities qualified per run
}
```

### `funnel`
```typescript
{
  evaluated: number;            // Total opportunities evaluated
  qualified: number;            // Total passed quality gates
  published: number;            // Total successfully published
  failed: number;               // Total failed publication
  deduplicated: number;         // Total suppressed by dedup
  quotaBlocked: number;         // Total blocked by quota
}
```

### `daily`
```typescript
Array<{
  date: string;                 // YYYY-MM-DD
  published: number;            // Posts published that day
  failed: number;               // Posts failed that day (0 if from quota log)
  quotaRemaining: number;       // 100 - published
}>
```

### `coins`
```typescript
Array<{
  coinSymbol: string;           // e.g., "BTC", "ETH"
  total: number;                // Total opportunities for this coin
  published: number;            // Successfully published
  failed: number;               // Failed publication
  avgScore: number;             // Average opportunity score
}>
```

### `narratives`
```typescript
Array<{
  narrativeId: number;          // Narrative ID
  total: number;                // Total opportunities
  published: number;            // Successfully published
  failed: number;               // Failed publication
  avgScore: number;             // Average opportunity score
}>
```

### `llm`
```typescript
{
  llmUsed: number;              // Posts using Google LLM
  templateFallback: number;     // Posts using template fallback
  llmPublishRate: number;       // LLM publish success rate (%)
  templatePublishRate: number;  // Template publish success rate (%)
}
```

### `failures`
```typescript
Array<{
  category: string;             // TRANSIENT | PERMANENT | TIMEOUT | UNKNOWN
  count: number;                // Number of failures in this category
  avgRetries: number;           // Average retry count for this category
  topErrorCodes: Array<{        // Placeholder for V2
    code: string;
    count: number;
  }>;
}>
```

### `retry`
```typescript
{
  totalRetries: number;         // Sum of all retry counts
  avgRetries: number;           // Average retry count
  maxRetries: number;           // Maximum retry count observed
  retrySuccessRate: number;     // % of retried posts that eventually succeeded
}
```

### `latency`
```typescript
{
  avgMs: number;                // Average API response time
  p50Ms: number;                // 50th percentile
  p95Ms: number;                // 95th percentile
  p99Ms: number;                // 99th percentile
}
```

### `quota`
```typescript
{
  todayPublished: number;       // Posts published today
  todayRemaining: number;       // 100 - todayPublished
  dailyCap: number;             // Always 100
  warningThreshold: boolean;    // true if >= 80 posts today
  avgDailyUsage: number;        // Average daily usage over last 30 days
}
```

### `scores`
```typescript
Array<{
  range: string;                // "90-100" | "80-89" | "70-79" | "60-69" | "50-59" | "<50"
  count: number;                // Number of opportunities in this range
}>
```

### `trend`
```typescript
Array<{
  date: string;                 // YYYY-MM-DD
  rate: number;                 // Success rate (%) for that day
  published: number;            // Posts published that day
  total: number;                // published + failed that day
}>
```

## Example Requests

```bash
# Full analytics for last 30 days
GET /api/admin/square/analytics?range=30D&section=all

# Just the overview for today
GET /api/admin/square/analytics?range=TODAY&section=overview

# Coin breakdown for last 7 days
GET /api/admin/square/analytics?range=7D&section=coins

# Quota status (always current)
GET /api/admin/square/analytics?section=quota
```

## Error Responses

```json
{
  "success": false,
  "error": "Invalid range. Use TODAY, 7D, 30D, or ALL."
}
```

```json
{
  "success": false,
  "error": "Invalid section. Use: overview, funnel, daily, ..."
}
```

```json
{
  "success": false,
  "error": "Database query failed"
}
```
