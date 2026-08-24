# SQ-DEPLOY-05 RECON

## 1. Repository State

### Production Code Version
User confirms production deployed:
```
57dbf420a6e36903158f0316312da8d0a751aebf
```

### Local HEAD
```
75299f9 docs: SQ-DEPLOY-04 production post-deployment verification
```

### Key Source Files Inspected
- `src/lib/square/publisher.ts` — Dedup, fingerprint TTL, Binance contract
- `src/lib/square/production.ts` — Pipeline orchestration, softCap=10
- `src/lib/square/opportunity-engine.ts` — Candidate extraction, scoring, suppression
- `src/app/api/admin/square-test/route.ts` — Controlled test endpoint
- `docs/Binance_Square_Upgrade/SQ_API_CONTRACT.md` — Frozen Binance API contract

## 2. Binance API Contract (FROZEN)

Endpoint:
```
POST https://www.binance.com/bapi/composite/v1/public/pgc/openApi/content/add
```

Auth:
```
X-Square-OpenAPI-Key
```

Minimal verified body:
```json
{
  "contentType": 1,
  "bodyTextOnly": "..."
}
```

Success response:
```json
{
  "code": "000000",
  "success": true,
  "data": {
    "id": "357738400893035",
    "shareLink": "https://app.binance.com/uni-qr/cpos/357738400893035"
  }
}
```

## 3. Dedup Architecture

### Fingerprint TTLs
- `FINGERPRINT_TTL_HOURS = 72` — coin/setup posts
- `THESIS_FINGERPRINT_TTL_HOURS = 168` — narrative posts

### Dedup Flow
1. `generateFingerprint(type, subjectId, coinSymbols, signal, entry, tp, sl, invalidation)`
2. `isDuplicate(fingerprint)` — checks `square_fingerprints` where `expiresAt >= now`
3. `isThesisStable(fingerprint)` — same check for thesis
4. If duplicate → permanent failure, no retry
5. If success → `recordFingerprint` or `recordThesisFingerprint` with TTL expiry

### Each Publication Creates TWO Fingerprints
One with 72h TTL, one with 168h TTL.

## 4. Pipeline Architecture

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
    postTextDirect() → Binance API
        ↓
    recordFingerprint()
    recordQuota()
```

### Soft Cap
`dailySoftCap = 10` — hardcoded in `DEFAULT_SCORING_CONFIG`.

### Test Endpoint
`POST /api/admin/square-test` runs `runSquarePipeline()` with all quality gates, dedup, and quota. No `opportunityId` parameter supported.

## 5. Current Production State

### Scheduler
- Latest job: #296, `manual_refresh`
- Status: COMPLETED at 2026-08-24T04:31:13Z
- Duration: 47s, 49 records

### Today's Publications (Aug 24)
10 successful publications at 11:31 local time:
| Pub ID | Opportunity | Coin | Score | Post ID |
|---|---|---|---|---|
| 99 | 177 | ZEC | 100 | 359033544439635 |
| 100 | 178 | PUMP | 100 | 359033545856236 |
| 101 | 179 | LDO | 100 | 359033547297288 |
| 102 | 180 | AAVE | 100 | 359033549292669 |
| 103 | 181 | ARB | 97.1 | 359033551102705 |
| 104 | 182 | STBL | 82.6 | 359033552781951 |
| 105 | 183 | PENDLE | 76.93 | 359033555298366 |
| 106 | 184 | ONDO | 76.03 | 359033556941245 |
| 107 | 185 | FET | 75.47 | 359033558415394 |
| 108 | 186 | AKT | 75.03 | 359033559712824 |

### Active Fingerprints from Today
- 10 coin/setup fingerprints: expire Aug 27 11:31 (~71h remaining)
- 10 thesis fingerprints: expire Aug 31 11:31 (~167h remaining)

## 6. Controlled Test History

### Test 1 — 2026-08-24T04:28:43Z
```json
{"evaluated":53,"opportunities":0,"published":0,"suppressed":0,"errors":[]}
```
No opportunities qualified. No posts created.

### Test 2 — 2026-08-24T04:49:32Z
```json
{"evaluated":62,"opportunities":18,"published":0,"suppressed":28,"errors":[...10x "Similar thesis recently published"]}
```
18 qualified, top 10 all deduplicated.

### Test 3 — 2026-08-24T04:54:07Z (with ignored opportunityId param)
Same result: 18 qualified, top 10 deduplicated.

### Root Cause
All top 10 candidates (ZEC, PUMP, LDO, AAVE, ARB, STBL, PENDLE, ONDO, FET, AKT) were published 18 minutes prior. Their fingerprints are fresh.

### Lower-Ranked Opportunities (Rank 11-18)
These exist but are NEVER attempted due to `softCap=10`:
| Rank | Opp ID | Coin | Score | Fingerprint |
|---|---|---|---|---|
| 11 | 240 | NVDA | 72.43 | None |
| 12 | 241 | CARV | 70.70 | None |
| 13 | 242 | PROMPT | 69.18 | None |
| 14 | 243 | CFG | 68.58 | None |
| 15 | 244 | RENDER | 67.85 | None |
| 16 | 245 | MANTRA | 67.83 | None |
| 17 | 246 | TRUTH | 66.93 | None |
| 18 | 247 | XAU | 63.15 | None |

These have NO fingerprints and would likely succeed if attempted. But they are blocked by `softCap=10`.

## 7. Blocker Analysis

### Why No Real Post Can Be Created

1. **Dedup blocks top 10**: All top opportunities have fresh fingerprints from today's scheduler run
2. **SoftCap blocks rank 11+**: Only top 10 are attempted per pipeline execution
3. **No runtime override**: `softCap` is hardcoded, no env var or API parameter
4. **No opportunity targeting**: Test endpoint does not support `opportunityId`
5. **Source modification required**: Bypassing dedup or increasing softCap requires code changes

### Why Waiting Is Not Practical

- Aug 22 coin/setup fingerprints expire in ~23h
- Aug 24 coin/setup fingerprints expire in ~71h
- Thesis fingerprints expire in 5-7 days
- Even after partial expiry, Aug 24 coin/setup fingerprints remain active

### Why Direct DB Insertion Is Not Viable

- Would create fake market data pretending to be real (forbidden)
- Would not go through the real production evaluation pipeline
- Would bypass quality gates

## 8. Conclusion

**Production is healthy. The 220095 fix is active. Binance API is reachable.**

**However, a real Binance Square post cannot be produced through the existing production pipeline at this time because:**

1. All qualifying opportunities that reach the publisher are deduplicated
2. Lower-ranked unique opportunities exist but are never attempted due to `softCap=10`
3. Creating a controlled test opportunity would require modifying production source code

**This is a BLOCKED verification.**
