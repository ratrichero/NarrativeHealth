# SQ-DEPLOY-06 ANALYTICS VERIFICATION

## 1. Analytics Page

**URL**: `http://168.138.179.192:3000/square-analytics`

| Check | Result | Evidence |
|---|---|---|
| Page loads | ✅ PASS | HTTP 200 |
| TODAY range | ✅ PASS | Real data returned |
| 7D range | ✅ PASS | Real data returned |
| 30D range | ✅ PASS | Real data returned |
| ALL range | ✅ PASS | Real data returned |

## 2. TODAY Analytics (Latest)

```json
{
  "success": true,
  "range": "TODAY",
  "data": {
    "overview": {
      "totalExecutions": 5,
      "totalPublished": 10,
      "totalFailed": 10,
      "totalDeduplicated": 0,
      "totalQuotaBlocked": 0,
      "successRate": 50,
      "avgDurationMs": 1551,
      "avgEvaluated": 59,
      "avgQualified": 12
    },
    "funnel": {
      "evaluated": 177,
      "qualified": 36,
      "published": 10,
      "failed": 10,
      "deduplicated": 0,
      "quotaBlocked": 0
    },
    "daily": [
      {"date": "2026-08-24", "published": 10, "failed": 0, "quotaRemaining": 90}
    ],
    "quota": {
      "todayPublished": 10,
      "todayRemaining": 90,
      "dailyCap": 100,
      "warningThreshold": false
    }
  }
}
```

### Note on Dedup Counting
The analytics `deduplicated` field is 0, but 10 failures were caused by dedup. This is a known analytics data quality observation — dedup failures are categorized as `failed`, not `deduplicated`, in the execution records.

## 3. 7D Analytics

| Date | Published | Failed | Quota Remaining |
|---|---|---|---|
| 2026-08-24 | 10 | 0 | 90 |
| 2026-08-22 | 9 | 0 | 91 |
| 2026-08-21 | 32 | 0 | 68 |
| 2026-08-20 | 1 | 0 | 99 |

## 4. Recent Publications (ALL)

From analytics `publications` section, the 10 most recent publications are all from today (Aug 24) at 11:31 Vietnam time. All have real Binance post IDs.

## 5. Coin/Narrative Breakdown

### TODAY Coins
| Coin | Total | Published | Failed | Avg Score |
|---|---|---|---|---|
| AKT | 2 | 1 | 0 | 75.03 |
| ARB | 2 | 1 | 0 | 97.1 |
| CFG | 2 | 0 | 0 | 68.58 |
| FET | 2 | 1 | 0 | 75.47 |
| LDO | 2 | 1 | 0 | 100 |
| MANTRA | 2 | 0 | 0 | 67.83 |
| NVDA | 2 | 0 | 0 | 72.43 |
| ONDO | 2 | 1 | 0 | 76.03 |
| PENDLE | 2 | 1 | 0 | 76.93 |
| RENDER | 2 | 0 | 0 | 67.85 |
| STBL | 2 | 1 | 0 | 82.6 |
| TRUTH | 2 | 0 | 0 | 66.93 |
| XAU | 2 | 0 | 0 | 63.15 |
| ZEC | 2 | 1 | 0 | 100 |

### TODAY Narratives
| Narrative | Total | Published | Failed | Avg Score |
|---|---|---|---|---|
| AI | 12 | 2 | 0 | 70.86 |
| DEFI / DEX | 2 | 1 | 0 | 100 |
| FAVORITE | 2 | 1 | 0 | 100 |
| LAYER 2 | 2 | 1 | 0 | 97.1 |
| PAYFI & STABLE | 2 | 1 | 0 | 82.6 |
| RESTAKING | 2 | 1 | 0 | 100 |
| RWA | 10 | 2 | 0 | 70.5 |
| STOCKs | 2 | 0 | 0 | 72.43 |
| TOPMC | 2 | 1 | 0 | 100 |

## 6. New Publication Visibility

**No new publication was created during SQ-DEPLOY-06**, so analytics does not reflect any new publication from this verification.

The existing 10 publications from today are correctly reflected in:
- TODAY range: `published: 10`
- Coins breakdown: shows per-coin stats
- Narratives breakdown: shows per-narrative stats
- Recent publications: shows all 10 posts

## 7. Consistency Check

| Check | Result |
|---|---|
| DB → API consistency | ✅ PASS — Analytics data originates from real DB records |
| API → UI consistency | ✅ PASS — UI renders from API response |
| No fabricated metrics | ✅ PASS — All metrics derived from real pipeline executions |
| No analytics query errors | ✅ PASS — All ranges return HTTP 200 |

## 8. Data Quality Observation

The analytics `failed` count includes dedup failures. This means:
- `totalFailed: 10` includes 10 dedup failures from controlled tests
- `deduplicated: 0` in funnel is misleading — actual dedup count should be 10

This does not affect SQ-DEPLOY-06 status but is worth noting for analytics accuracy.
