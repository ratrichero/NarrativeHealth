# SQ-DEPLOY-04 RECON

## 1. Expected Deployed Commit

```
57dbf420a6e36903158f0316312da8d0a751aebf
```

Short SHA: `57dbf42`

Repository: https://github.com/ratrichero/NarrativeHealth/commit/57dbf420a6e36903158f0316312da8d0a751aebf

## 2. Commit Contents

Commit `57dbf42` is a documentation-only commit that includes the fix from `2676c12` in its ancestry.

### Actual Code Fix
The `maxLeadingCoins` fix is in commit `2676c12`:
- File: `src/lib/square/opportunity-engine.ts`
- Change: `maxLeadingCoins: 3 → 1`
- This commit is an ancestor of `57dbf42`

### 57dbf42 Changes
- `docs/Binance_Square_Upgrade/SQ-DEPLOY-03_RECON.md` — NEW
- `docs/Binance_Square_Upgrade/SQ-DEPLOY-03_DEPLOYMENT.md` — NEW
- `docs/Binance_Square_Upgrade/SQ-DEPLOY-03_LIVE_SQUARE_TEST.md` — NEW
- `docs/Binance_Square_Upgrade/SQ-DEPLOY-03_ANALYTICS_VERIFICATION.md` — NEW
- `docs/Binance_Square_Upgrade/SQ-DEPLOY-03_FINAL_AUDIT.md` — NEW

No production source code changes in `57dbf42` itself. The fix is inherited from `2676c12`.

## 3. Production Verification Approach

Since direct SSH/process inspection is not available, verification relies on:

1. **Runtime behavior** — Does the production API exhibit expected behavior from the fix?
2. **Controlled test** — Does the Square pipeline run without 220095 errors?
3. **Analytics** — Does the analytics system show real production data?

## 4. Key Questions

| Question | Answer Method |
|---|---|
| Is production running 57dbf42? | Cannot prove exact SHA without SSH/version endpoint |
| Is production running the fix? | Runtime behavior evidence |
| Is Next.js healthy? | HTTP 200 from production URL |
| Is FastAPI healthy? | `/api/health` returns 200 |
| Is scheduler running? | `/api/refresh/status` shows active job |
| Does analytics work? | API + UI verification |
| Does Square pipeline work? | Controlled test |
| Is 220095 resolved? | Absence in controlled test errors |
