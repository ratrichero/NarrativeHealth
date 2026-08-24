# SQ-DEPLOY-06 DB TRACE

## 1. Database Connection

- **Status**: ✅ VERIFIED
- **Evidence**: Direct PostgreSQL connection via `DATABASE_URL` from local machine
- **Tables inspected**: `square_opportunities`, `square_publications`, `square_fingerprints`, `square_quota_log`, `scheduler_logs`

## 2. Publication Trace

### Expected Trace (Not Achieved)
```
Opportunity #XX
→ Publication #YY
→ Binance post #ZZ
```

### Actual State
No new publication was created during SQ-DEPLOY-06 verification.

### Recent Successful Publications (Aug 24)
| Publication ID | Opportunity ID | Coin | Score | Post ID | Timestamp |
|---|---|---|---|---|---|
| 108 | 186 | AKT | 75.03 | 359033559712824 | 2026-08-24T11:31:17+07:00 |
| 107 | 185 | FET | 75.47 | 359033558415394 | 2026-08-24T11:31:17+07:00 |
| 106 | 184 | ONDO | 76.03 | 359033556941245 | 2026-08-24T11:31:16+07:00 |
| 105 | 183 | PENDLE | 76.93 | 359033555298366 | 2026-08-24T11:31:16+07:00 |
| 104 | 182 | STBL | 82.60 | 359033552781951 | 2026-08-24T11:31:16+07:00 |
| 103 | 181 | ARB | 97.10 | 359033551102705 | 2026-08-24T11:31:15+07:00 |
| 102 | 180 | AAVE | 100.00 | 359033549292669 | 2026-08-24T11:31:15+07:00 |
| 101 | 179 | LDO | 100.00 | 359033547297288 | 2026-08-24T11:31:14+07:00 |
| 100 | 178 | PUMP | 100.00 | 359033545856236 | 2026-08-24T11:31:14+07:00 |
| 99 | 176 | ZEC | 100.00 | 359033544439635 | 2026-08-24T11:31:14+07:00 |

### Publications Created During SQ-DEPLOY-06
| Publication ID | Opportunity ID | Status | Post ID | Timestamp |
|---|---|---|---|---|
| — | — | — | — | — |

**Result**: 0 new publications created.

## 3. Fingerprint Trace

### Active Fingerprints (Blocking Dedup)
Each of today's 10 publications created 2 fingerprints (72h + 168h TTL):

| Opportunity | Type | Published At | 72h Expires | 168h Expires | Status |
|---|---|---|---|---|---|
| 176 | NARRATIVE_SETUP | 11:31:14 | 27T11:31 | 31T11:31 | Active |
| 177 | NARRATIVE_SETUP | 11:31:14 | 27T11:31 | 31T11:31 | Active |
| 178 | NARRATIVE_SETUP | 11:31:14 | 27T11:31 | 31T11:31 | Active |
| 179 | NARRATIVE_SETUP | 11:31:15 | 27T11:31 | 31T11:31 | Active |
| 180 | NARRATIVE_SETUP | 11:31:15 | 27T11:31 | 31T11:31 | Active |
| 181 | NARRATIVE_SETUP | 11:31:16 | 27T11:31 | 31T11:31 | Active |
| 182 | COIN_SETUP | 11:31:16 | 27T11:31 | — | Active |
| 183 | COIN_SETUP | 11:31:16 | 27T11:31 | — | Active |
| 184 | COIN_SETUP | 11:31:17 | 27T11:31 | — | Active |
| 185 | COIN_SETUP | 11:31:17 | 27T11:31 | — | Active |

### Aug 22 Fingerprints (Expiring in ~23h)
| Opportunity | Type | Published At | 72h Expires | Status |
|---|---|---|---|---|
| 117 | NARRATIVE_SETUP | 11:03:09 | 25T11:03 | Active |
| 118 | NARRATIVE_SETUP | 11:03:09 | 25T11:03 | Active |
| 119 | NARRATIVE_SETUP | 11:03:10 | 25T11:03 | Active |
| 120 | NARRATIVE_SETUP | 11:03:10 | 25T11:03 | Active |
| 121 | COIN_SETUP | 11:03:11 | 25T11:03 | Active |
| 122 | COIN_SETUP | 11:03:11 | 25T11:03 | Active |
| 123 | COIN_SETUP | 11:03:11 | 25T11:03 | Active |
| 124 | COIN_SETUP | 11:03:11 | 25T11:03 | Active |
| 125 | COIN_SETUP | 11:03:12 | 25T11:03 | Active |

### Aug 21 Fingerprints (Expired)
| Opportunity | Type | Published At | 72h Expires | Status |
|---|---|---|---|---|
| 86-94 | Mixed | 12:32-22:28 | 24T12:32-22:28 | **EXPIRED** |

Note: These opportunities are no longer in CANDIDATE status.

## 4. Quota Trace

### Current Quota
| Date | Published | Remaining | Last Refresh |
|---|---|---|---|
| 2026-08-24 | 10 | 90 | 11:31 Vietnam |
| 2026-08-22 | 9 | 91 | 11:03 Vietnam |
| 2026-08-21 | 32 | 68 | 22:28 Vietnam |

### SQ-DEPLOY-06 Quota Delta
- Before: Not captured
- After: 10 published, 90 remaining
- Delta: 0 (no posts published during verification)

## 5. Failed Publication Trace

### Previous Failures (Pre-Fix)
| Pub ID | Opportunity | Error |
|---|---|---|
| 98 | 156 | 220095 — Coin pair count exceeds the allowed limit |
| 97 | 136 | 220095 — Coin pair count exceeds the allowed limit |
| 87 | 116 | 220095 — Coin pair count exceeds the allowed limit |
| 71 | 88 | 220095 — Coin pair count exceeds the allowed limit |

### SQ-DEPLOY-06 Failures
No new failures. All errors during verification were dedup-related, not 220095.

## 6. Scheduler Log Trace

| Job ID | Job Name | Status | Started At | Duration | Records |
|---|---|---|---|---|---|
| 296 | manual_refresh | COMPLETED | 04:30:26 Vietnam | 47s | 49 |
| 295 | manual_refresh | COMPLETED | 01:29:27 Vietnam | 28s | 49 |
| 294 | interval_refresh | COMPLETED | 01:29:27 Vietnam | 0s | 0 |

The `interval_refresh` job (0s duration) is the APScheduler heartbeat. The `manual_refresh` job (28-47s duration) performs the actual data refresh and Square pipeline execution.
