# SQ-OPERATE-01 RECON

## 1. Purpose

This document provides a technical recon of the Binance Square monetization pipeline for production readiness assessment. No production code was modified.

## 2. Pipeline Architecture (Current)

```
4h Refresh completes
    ↓
src/app/api/refresh/route.ts:998-1012
    ↓
dynamic import("@/lib/square/production")
    ↓
runSquarePipeline()
    ├── getQuotaStatus() — check 100/day cap
    ├── evaluateOpportunities()
    │   ├── getLatestCoinData() — DB query
    │   ├── getNarrativeData() — DB query
    │   ├── extractCoinOpportunities()
    │   │   ├── passesQualityGates()
    │   │   ├── calculateOpportunityScore()
    │   │   ├── calculateSetupLevels()
    │   │   ├── generateRationale()
    │   │   └── generateWhyNowForCoin()
    │   └── extractNarrativeOpportunities()
    │       ├── selectNarrativeLeadingCoins()
    │       ├── generateNarrativeCoinRationale()
    │       ├── generateNarrativeInvalidationFromData()
    │       ├── calculateSetupLevels() for leader coin
    │       └── generateWhyNowForNarrative()
    ├── persistOpportunity() — DB insert
    └── for top N opportunities:
        ├── buildContentBrief()
        │   ├── WHY NOW section
        │   ├── Key facts
        │   ├── Leading coins with per-coin rationale
        │   ├── Setup levels (coin or leader coin)
        │   ├── INVALIDATION
        │   └── Disclaimer
        ├── resolveChartCoin() + generateChartMetadata()
        ├── generateThesisFingerprint()
        ├── generateContent()
        │   ├── LLM path (with validation)
        │   └── Template fallback
        └── publishContent()
            ├── Quota check
            ├── Content dedup (72h)
            ├── Thesis stability check (7d)
            ├── postText() → Binance Square API
            ├── Record publication
            ├── Record fingerprints
            └── Increment quota
```

## 3. Component Status

| Component | Status | Notes |
|---|---|---|
| Scheduler trigger | ✅ Active | Non-blocking try/catch in refresh route |
| 0..N publishing | ✅ Active | Soft cap 10, limited by quota |
| Opportunity scoring | ✅ Active | Deterministic, weights sum to 1.0 |
| Quality gates | ✅ Active | Freshness, confidence, quality, change |
| Coin post | ✅ Complete | All sections present |
| Narrative post | ✅ Complete | Multi-coin, rationale, invalidation, leader setup |
| WHY NOW | ✅ Active | Data-grounded for coin and narrative |
| Invalidation | ✅ Active | Coin: SL-based; Narrative: data-grounded |
| Entry/TP/SL | ✅ Active | Deterministic ATR-based |
| LLM path | ✅ Active | With validation and fallback |
| Template fallback | ✅ Active | Includes all sections |
| Binance API | ✅ Verified | Real post ID: 357738400893035 |
| $cashtag | ✅ Active | Normalized, validated |
| Chart auto-detect | ✅ Active | resolveChartCoin |
| Content dedup | ✅ Active | 72h fingerprint TTL |
| Thesis dedup | ✅ Active | 7d fingerprint TTL |
| Quota | ✅ Active | 100/day hard cap |
| Failure handling | ⚠️ Partial | No retry; failures recorded |

## 4. DB Schema (Square Tables)

| Table | Purpose | Key Fields |
|---|---|---|
| `square_opportunities` | Store evaluated opportunities | type, score, dataQuality, rationale, entryZone, takeProfits, stopLoss, status |
| `square_publications` | Store publication records | opportunityId, fingerprint, status, externalPostId, contentVersion, templateVersion, llmUsed, errorCode, contentSnapshot |
| `square_quota_log` | Track daily quota | date, postsPublished, uploadsUsed |
| `square_fingerprints` | Deduplication fingerprints | fingerprint, opportunityId, publishedAt, expiresAt |

## 5. Key Findings

### What Works
1. Scheduler integration is non-blocking — Square failures never affect refresh
2. Quality gates prevent weak data from publishing
3. Both coin and narrative posts are fully supported
4. LLM + template fallback provides resilience
5. Dual-layer dedup prevents spam
6. Quota enforcement prevents over-publishing
7. All content is data-grounded — no hallucination

### What Needs Attention
1. No retry mechanism for transient Binance API failures
2. `llmUsed` field always false (hardcoded) — data integrity issue
3. No admin/operational API endpoint for monitoring
4. No engagement metrics from Binance Square
5. No alerting for quota consumption or failure rates

## 6. Data Flow Verification

| Step | Verified | Evidence |
|---|---|---|
| Refresh triggers Square pipeline | ✅ | `route.ts:1001` dynamic import |
| 0..N opportunities evaluated | ✅ | `evaluateOpportunities` returns all candidates |
| Quality gates applied | ✅ | `passesQualityGates` filters by 4 criteria |
| Scoring deterministic | ✅ | Weights sum to 1.0, no randomness |
| Content brief includes all sections | ✅ | `buildContentBrief` builds complete text |
| LLM validates output | ✅ | `validateLLMOutput` checks sections, cashtags, forbidden terms |
| Template fallback works | ✅ | `generateFromBrief` uses `brief.text` directly |
| Thesis fingerprint computed | ✅ | `generateThesisFingerprint` in `production.ts:88-99` |
| PUBLISHED only on success | ✅ | `publisher.ts:305` status = result.success ? "PUBLISHED" : "FAILED" |
| Quota incremented only on success | ✅ | `publisher.ts:323` inside `if (result.success)` |
| Fingerprints recorded only on success | ✅ | `publisher.ts:318-322` inside `if (result.success)` |
