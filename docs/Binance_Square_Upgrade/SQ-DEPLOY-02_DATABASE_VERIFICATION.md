# SQ-DEPLOY-02 DATABASE VERIFICATION

## 1. Connection Test

| Check | Result |
|---|---|
| Database reachable | ✅ PASS |
| Connection method | `DATABASE_URL` via `pg` Node.js client |
| SSL/TLS | Unknown (not inspected) |

## 2. Table Existence

| Table | Expected | Found | Status |
|---|---|---|---|
| `square_opportunities` | Yes | Yes | ✅ PASS |
| `square_publications` | Yes | Yes | ✅ PASS |
| `square_quota_log` | Yes | Yes | ✅ PASS |
| `square_fingerprints` | Yes | Yes | ✅ PASS |
| `square_pipeline_executions` | Yes | Yes | ✅ PASS (was missing, applied migration 0024) |

## 3. Schema Verification — `square_pipeline_executions`

| Column | Expected Type | Actual Type | Nullable | Status |
|---|---|---|---|---|
| `id` | integer | integer | NO | ✅ PASS |
| `started_at` | TIMESTAMPTZ | timestamp with time zone | NO | ✅ PASS |
| `completed_at` | TIMESTAMPTZ | timestamp with time zone | YES | ✅ PASS |
| `trigger_type` | varchar(30) | character varying | NO | ✅ PASS |
| `evaluated` | integer | integer | NO | ✅ PASS |
| `qualified` | integer | integer | NO | ✅ PASS |
| `published` | integer | integer | NO | ✅ PASS |
| `failed` | integer | integer | NO | ✅ PASS |
| `deduplicated` | integer | integer | NO | ✅ PASS |
| `quota_blocked` | integer | integer | NO | ✅ PASS |
| `retry_pending` | integer | integer | NO | ✅ PASS |
| `content_generation_failed` | integer | integer | NO | ✅ PASS |
| `llm_used_count` | integer | integer | NO | ✅ PASS |
| `template_fallback_count` | integer | integer | NO | ✅ PASS |
| `duration_ms` | integer | integer | YES | ✅ PASS |
| `quota_remaining_start` | integer | integer | YES | ✅ PASS |
| `quota_remaining_end` | integer | integer | YES | ✅ PASS |
| `quota_warning` | boolean | boolean | YES | ✅ PASS |
| `error_summary` | jsonb | jsonb | YES | ✅ PASS |
| `created_at` | TIMESTAMPTZ | timestamp with time zone | NO | ✅ PASS |

**Verdict**: Schema matches Drizzle definition. All TIMESTAMPTZ columns are correctly typed.

## 4. Record Counts

| Table | Count | Notes |
|---|---|---|
| `square_pipeline_executions` | 2 | Created during verification (controlled test) |
| `square_opportunities` | 155 | 90 COIN_SETUP, 65 NARRATIVE_SETUP |
| `square_publications` | 91 | Mix of PUBLISHED and FAILED |
| `square_quota_log` | 3 | Aug 20, 21, 22 |
| `square_fingerprints` | 83 | Deduplication records |

## 5. Execution Records

| ID | Trigger | Started At | Duration | Evaluated | Qualified | Published | Failed |
|---|---|---|---|---|---|---|---|
| 1 | SCHEDULED | 2026-08-22 11:03:08 | 4044ms | 62 | 20 | 9 | 1 |
| 2 | SCHEDULED | 2026-08-22 11:06:55 | 354ms | 62 | 20 | 0 | 10 |

## 6. Publication Analysis

### Successful Publications
- Total: 9 (from execution #1)
- External post IDs: Confirmed in DB
- Example: #96 published at 2026-08-22 11:03:12, external ID 358318869305356

### Failed Publications
- Error 220095: 8 occurrences — "Coin pair count exceeds the allowed limit"
- Other errors: 3 occurrences (API key not set, spawn errors)

## 7. Analytics Query Results

### ALL Time
```json
{
  "total_executions": 2,
  "total_published": 9,
  "total_failed": 11,
  "total_deduplicated": 0,
  "total_quota_blocked": 0,
  "avg_duration": 2199,
  "avg_evaluated": 62,
  "avg_qualified": 20
}
```

### TODAY
Same as ALL (both executions occurred today).

## 8. Migration Applied

### Migration 0024
- **File**: `drizzle/migrations/0024_add_square_pipeline_executions.sql`
- **Status**: ✅ APPLIED
- **Table created**: `square_pipeline_executions`
- **Columns**: 19
- **Indexes**: 2 (`started_at`, `trigger_type`)
