# SQ-DEPLOY-06 RECON

## 1. Production State at Inspection

**Inspection time**: 2026-08-24T05:25:03Z (UTC) = 12:25 Vietnam time

### Health
| Check | Result | Evidence |
|---|---|---|
| Production URL | ✅ PASS | HTTP 200 from `http://168.138.179.192:3000/` |
| Next.js | ✅ PASS | Running |
| FastAPI | ✅ PASS | `/api/health` returns `{"ok":true}` |
| PostgreSQL | ✅ PASS | Direct DB connection verified |
| Scheduler | ✅ PASS | APScheduler running, interval mode every 4h |
| Analytics | ✅ PASS | TODAY/7D/30D/ALL return real data |

### Scheduler Configuration
```env
SCHEDULER_ENABLED=true
SCHEDULER_INTERVAL_HOURS=4
```
Scheduler runs every 4 hours via APScheduler (`backend/scheduler.py`). Triggers `POST http://localhost:3000/api/refresh` which runs data refresh + Square pipeline.

### Scheduler Log Pattern
| Job | Frequency | Duration | Records |
|---|---|---|---|
| `interval_refresh` | Every 4h | 0s | 0 |
| `manual_refresh` | Every 4h (paired) | ~29s | 47-49 |
| `p3_execution_loop` | Every 48h | ~1s | 9 |

Last `manual_refresh`: 2026-08-24T04:30:26Z (triggered during SQ-DEPLOY-04/05)
Last `interval_refresh`: 2026-08-24T01:29:27Z

### Current Quota
- Today (Aug 24): 10 published, 90 remaining
- Daily hard cap: 100
- Soft cap per pipeline: 10

### Current Opportunity State
| Category | Count | Status |
|---|---|---|
| CANDIDATE (no PUBLISHED record) | 36 | Ready for evaluation |
| Top 10 by score | 10 | All deduplicated by fresh fingerprints |
| Rank 11-18 | 8 | No fingerprints, blocked by softCap=10 |
| Rank 19+ | 18 | Lower scores, also blocked by softCap |

## 2. Dedup Architecture

### Fingerprint TTLs
- `FINGERPRINT_TTL_HOURS = 72` — coin/setup posts
- `THESIS_FINGERPRINT_TTL_HOURS = 168` — narrative posts

### Active Fingerprints Blocking Publication
| Opportunity Group | Type | Published At | Coin/setup TTL | Thesis TTL | Status |
|---|---|---|---|---|---|
| opp=176-185 (Aug 24) | Mixed | 11:31 Vietnam | 71h remaining | 167h remaining | Active |
| opp=117-125 (Aug 22) | Mixed | 11:03 Vietnam | 23h remaining | N/A | Active |
| opp=107-115 (Aug 21/22) | Mixed | 22:28-12:32 Vietnam | 10h remaining | N/A | Active |
| opp=86-94 (Aug 21) | Mixed | 12:32-22:28 Vietnam | 0h remaining | N/A | **EXPIRED** |

### Key Insight
Aug 21 coin/setup fingerprints (opp=86-94) have EXPIRED. But these opportunities are no longer in CANDIDATE status — they were already published or moved to other statuses.

## 3. Pipeline Architecture

```
evaluateOpportunities()
    ↓
persistOpportunity() for each qualified
    ↓
sort by score DESC
    ↓
slice(0, min(softCap=10, quotaRemaining))
    ↓
for each toPublish:
    buildContentBrief()
    generateContent()
    publishContent()
        ↓
    generateFingerprint()
    isDuplicate() → BLOCKS if fresh fingerprint exists
    postTextDirect() → Binance API
    recordFingerprint() → 72h + 168h TTL
    recordQuota()
```

### softCap Behavior
`dailySoftCap = 10` is hardcoded in `DEFAULT_SCORING_CONFIG`. No runtime override exists. Ranks 11+ are NEVER attempted.

## 4. Why No Real Post Can Be Created Now

### Top 10 Opportunities (Blocked by Dedup)
All have fresh fingerprints from today's scheduler run (11:31 Vietnam):
| Rank | Opp ID | Coin/Narrative | Score | Fingerprint TTL |
|---|---|---|---|---|
| 1 | 248 | ZEC | 100 | 168h |
| 2 | 249 | PUMP | 100 | 168h |
| 3 | 250 | LDO | 100 | 168h |
| 4 | 251 | AAVE | 100 | 168h |
| 5 | 252 | ARB | 97.1 | 168h |
| 6 | 253 | STBL | 82.6 | 168h |
| 7 | 254 | PENDLE | 76.93 | 72h |
| 8 | 255 | ONDO | 76.03 | 72h |
| 9 | 256 | FET | 75.47 | 72h |
| 10 | 257 | AKT | 75.03 | 72h |

### Rank 11-18 (Blocked by softCap)
| Rank | Opp ID | Coin | Score | Fingerprint |
|---|---|---|---|---|
| 11 | 258 | NVDA | 72.43 | None |
| 12 | 259 | CARV | 70.70 | None |
| 13 | 260 | PROMPT | 69.18 | None |
| 14 | 261 | CFG | 68.58 | None |
| 15 | 262 | RENDER | 67.85 | None |
| 16 | 263 | MANTRA | 67.83 | None |
| 17 | 264 | TRUTH | 66.93 | None |
| 18 | 265 | XAU | 63.15 | None |

These have NO fingerprints and would likely succeed if attempted. But `softCap=10` prevents them from reaching the publisher.

## 5. Expected Next Eligible Window

### Earliest Possible Publication
1. **Aug 22 fingerprint expiry**: ~23 hours from now (approx. 2026-08-25 11:03 Vietnam time)
   - Coins: PROMPT, LINEA, RENDER, PUMP, ONDO, MSTR, COTI, CRV, EIGEN, NEAR
   - If still qualifying, these could pass dedup after expiry

2. **New scheduler data**: Next refresh cycle (every 4h)
   - May produce new opportunities with different scores
   - Unpredictable if new unique coins will reach top 10

### Why Waiting Is Required
- Current data produces same top 10 with active fingerprints
- softCap=10 is hardcoded, no runtime bypass
- No existing endpoint allows targeting specific opportunities
- Source modification is forbidden by task rules

## 6. Regression Baseline
- Typecheck: ✅ PASS
- Square tests: ✅ 134/134 PASS
- P4/P5/P6 tests: ✅ 534/534 PASS
