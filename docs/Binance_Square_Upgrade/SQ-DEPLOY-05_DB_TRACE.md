# SQ-DEPLOY-05 DB TRACE

## 1. Database Connection

- **Status**: ✅ VERIFIED
- **Evidence**: Direct PostgreSQL connection via `DATABASE_URL` from local machine
- **Tables inspected**: `square_opportunities`, `square_publications`, `square_fingerprints`, `square_quota_log`

## 2. Publication Trace

### Expected Trace (Not Achieved)
```
Opportunity #XX
→ Publication #YY
→ Binance post #ZZ
```

### Actual State
No new publication was created during SQ-DEPLOY-05 verification.

### Recent Successful Publications (Aug 24)
| Publication ID | Opportunity ID | Coin | Score | Post ID | Timestamp |
|---|---|---|---|---|---|
| 99 | 177 | ZEC | 100 | 359033544439635 | 2026-08-24T11:31:14Z |
| 100 | 178 | PUMP | 100 | 359033545856236 | 2026-08-24T11:31:14Z |
| 101 | 179 | LDO | 100 | 359033547297288 | 2026-08-24T11:31:14Z |
| 102 | 180 | AAVE | 100 | 359033549292669 | 2026-08-24T11:31:15Z |
| 103 | 181 | ARB | 97.1 | 359033551102705 | 2026-08-24T11:31:15Z |
| 104 | 182 | STBL | 82.6 | 359033552781951 | 2026-08-24T11:31:16Z |
| 105 | 183 | PENDLE | 76.93 | 359033555298366 | 2026-08-24T11:31:16Z |
| 106 | 184 | ONDO | 76.03 | 359033556941245 | 2026-08-24T11:31:16Z |
| 107 | 185 | FET | 75.47 | 359033558415394 | 2026-08-24T11:31:17Z |
| 108 | 186 | AKT | 75.03 | 359033559712824 | 2026-08-24T11:31:17Z |

### Publications Created During SQ-DEPLOY-05
| Publication ID | Opportunity ID | Status | Post ID | Timestamp |
|---|---|---|---|---|
| — | — | — | — | — |

**Result**: 0 new publications created.

## 3. Fingerprint Trace

### Active Fingerprints (Blocking Dedup)
Each of today's 10 publications created 2 fingerprints (72h + 168h TTL):

| Opportunity | Published At | 72h Expires | 168h Expires | Status |
|---|---|---|---|---|
| 177 | 2026-08-24T11:31:14Z | 2026-08-27T11:31:14Z | 2026-08-31T11:31:14Z | Active |
| 178 | 2026-08-24T11:31:14Z | 2026-08-27T11:31:14Z | 2026-08-31T11:31:14Z | Active |
| 179 | 2026-08-24T11:31:14Z | 2026-08-27T11:31:14Z | 2026-08-31T11:31:14Z | Active |
| 180 | 2026-08-24T11:31:15Z | 2026-08-27T11:31:15Z | 2026-08-31T11:31:15Z | Active |
| 181 | 2026-08-24T11:31:15Z | 2026-08-27T11:31:15Z | 2026-08-31T11:31:15Z | Active |
| 182 | 2026-08-24T11:31:16Z | 2026-08-27T11:31:16Z | 2026-08-31T11:31:16Z | Active |
| 183 | 2026-08-24T11:31:16Z | 2026-08-27T11:31:16Z | 2026-08-31T11:31:16Z | Active |
| 184 | 2026-08-24T11:31:16Z | 2026-08-27T11:31:16Z | 2026-08-31T11:31:16Z | Active |
| 185 | 2026-08-24T11:31:17Z | 2026-08-27T11:31:17Z | 2026-08-31T11:31:17Z | Active |
| 186 | 2026-08-24T11:31:17Z | 2026-08-27T11:31:17Z | 2026-08-31T11:31:17Z | Active |

### Lower-Ranked Opportunities (No Fingerprints)
| Opportunity | Type | Coin | Score | Fingerprints |
|---|---|---|---|---|
| 240 | COIN_SETUP | NVDA | 72.43 | None |
| 241 | COIN_SETUP | CARV | 70.70 | None |
| 242 | COIN_SETUP | PROMPT | 69.18 | None |
| 243 | COIN_SETUP | CFG | 68.58 | None |
| 244 | COIN_SETUP | RENDER | 67.85 | None |
| 245 | COIN_SETUP | MANTRA | 67.83 | None |
| 246 | COIN_SETUP | TRUTH | 66.93 | None |
| 247 | COIN_SETUP | XAU | 63.15 | None |

These opportunities have NO fingerprints and would likely pass dedup if attempted.

## 4. Quota Trace

### Before Test
Not captured (no pre-test snapshot).

### After Test 1 (04:28)
- Posts published: 0
- Posts remaining: 100
- Daily hard cap: 100

### After Test 2 (04:49)
- Posts published: 10 (from scheduler, not from test)
- Posts remaining: 90
- Daily hard cap: 100

### After Test 3 (04:54)
- Posts published: 10
- Posts remaining: 90
- Daily hard cap: 100

### Delta
No quota change during SQ-DEPLOY-05 tests (0 posts published).

## 5. Failed Publication Trace

### Previous Failures (Pre-Fix)
| Pub ID | Opportunity | Error |
|---|---|---|
| 98 | 156 | 220095 — Coin pair count exceeds the allowed limit |
| 97 | 136 | 220095 — Coin pair count exceeds the allowed limit |
| 87 | 116 | 220095 — Coin pair count exceeds the allowed limit |
| 71 | 88 | 220095 — Coin pair count exceeds the allowed limit |

### SQ-DEPLOY-05 Failures
No new failures. All errors were dedup-related, not 220095.

## 6. Conclusion

**No DB publication trace exists for SQ-DEPLOY-05 because no real post was created.**

The DB contains valid publication records from earlier today (scheduler run), and the dedup fingerprints from those publications are actively blocking new publications of the same content.
