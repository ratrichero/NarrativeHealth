# SQ-OPERATE-01 MONETIZATION AUDIT

## 1. Monetization Funnel

```
Narrative data (DB)
    ↓
Opportunity detection (deterministic)
    ↓
Valuable post (LLM + template)
    ↓
$CASHTAG in post
    ↓
User sees post in Binance Square feed
    ↓
User clicks $CASHTAG
    ↓
Binance coin page
    ↓
Potential trading activity → Write-to-Earn revenue
```

### Funnel Stage Assessment

| Stage | Status | Evidence | Gap |
|---|---|---|---|
| Narrative data | ✅ Available | health_scores, features, recommendations, indicators, market_price_daily, coin_metrics | None |
| Opportunity detection | ✅ Working | Quality gates + scoring + sorting | No false positives due to gates |
| Valuable post | ✅ Working | WHY NOW, evidence, Entry/TP/SL, invalidation | Readability could be higher |
| $CASHTAG | ✅ Present | Normalized from coinSymbol / leadingCoinSymbols | None |
| User sees post | ✅ Published | Real Binance Square API integration verified | No visibility into impressions |
| User clicks | ⚠️ Unknown | Cashtag enables discovery | No click tracking available |
| Binance coin page | ✅ Works | Platform-rendered chart widget | None |
| Trading activity | ⚠️ Unknown | Write-to-Earn model | No conversion tracking |

## 2. What We Measure

### Directly Measured (in DB)

| Metric | Table | Queryable |
|---|---|---|
| Opportunities evaluated | `square_opportunities` (count by date) | ✅ |
| Opportunities by type | `square_opportunities` (type filter) | ✅ |
| Opportunities by coin | `square_opportunities` (coinSymbol filter) | ✅ |
| Opportunities by narrative | `square_opportunities` (narrativeId filter) | ✅ |
| Posts published | `square_publications` (status = PUBLISHED) | ✅ |
| Posts failed | `square_publications` (status = FAILED) | ✅ |
| Posts suppressed | `square_opportunities` (status = SUPPRESSED) | ✅ |
| Reject reasons | `square_publications` (errorCode, errorMessage) | ✅ |
| LLM vs fallback | `square_publications` (llmUsed) | ⚠️ Always false (bug) |
| Binance success/failure | `square_publications` (status, errorCode) | ✅ |
| Dedup count | `square_fingerprints` (count by date) | ✅ |
| Quota consumption | `square_quota_log` (postsPublished) | ✅ |
| Repeating theses | `square_fingerprints` (same fingerprint, multiple dates) | ✅ |
| Coin/Narrative distribution | `square_publications` + `square_opportunities` join | ✅ |
| Content snapshots | `square_publications` (contentSnapshot) | ✅ |
| Post IDs | `square_publications` (externalPostId) | ✅ |
| Publication timestamps | `square_publications` (publishedAt) | ✅ |

### NOT Measured (Gaps)

| Metric | Why Not Measured | Impact |
|---|---|---|
| Click-through rate | Binance Square API does not expose engagement metrics | Cannot optimize for clicks |
| Post impressions | Binance Square API does not expose view count | Cannot measure reach |
| User engagement (likes/comments) | Binance Square API does not expose social metrics | Cannot measure viral potential |
| Conversion to trade | No tracking from Square post to Binance trade | Cannot measure monetization revenue |
| Quota remaining real-time | Only tracked per-day, not per-hour | Cannot predict quota exhaustion |
| Pipeline duration | No timing metrics in DB | Cannot detect performance degradation |
| LLM latency | Not recorded | Cannot optimize LLM vs template decision |
| Binance API latency | Not recorded | Cannot detect API slowdowns |

## 3. Observability Audit

### Current Observability

| What | How | Where |
|---|---|---|
| Pipeline execution | `console.log` in refresh route | Server logs |
| Pipeline errors | `console.warn` / `console.error` | Server logs |
| Opportunity count | Returned in `SquarePipelineResult` | Server logs |
| Published count | Returned in `SquarePipelineResult` | Server logs |
| Suppressed count | Returned in `SquarePipelineResult` | Server logs |
| Quota status | `square_quota_log` table | DB |
| Publication records | `square_publications` table | DB |
| Content snapshots | `square_publications.contentSnapshot` | DB |
| Error codes | `square_publications.errorCode` | DB |

### Missing Observability

| What | Impact | Classification |
|---|---|---|
| No admin API endpoint | Must query DB directly to see what happened | B — High-value |
| No real-time quota alert | Could hit 100/day limit unexpectedly | B — High-value |
| No failure rate tracking | Cannot detect Binance API degradation | B — High-value |
| No engagement metrics | Cannot optimize content for clicks | C — Future |
| No pipeline duration metrics | Cannot detect performance issues | C — Future |

## 4. Production Safety Audit

### Scheduler Safety

| Check | Status | Evidence |
|---|---|---|
| Refresh not blocked by Square failure | ✅ PASS | `route.ts:1009-1012` catch block |
| Square failure logged | ✅ PASS | `console.error` with error details |
| Square errors returned in result | ✅ PASS | `SquarePipelineResult.errors` array |
| No infinite loop risk | ✅ PASS | Single invocation per refresh |

### Data Safety

| Check | Status | Evidence |
|---|---|---|
| No P4/P5 modification | ✅ PASS | No imports from P4/P5/P6 |
| No API key in logs | ✅ PASS | `BINANCE_SQUARE_OPENAPI_KEY` passed via env, not logged |
| No API key in DB | ✅ PASS | Key loaded from `process.env` only |
| No API key in content | ✅ PASS | Key not included in post text |
| No fabricated Entry/TP/SL | ✅ PASS | Only generated when `currentPrice > 0` and `atr14 !== null` |
| No fabricated facts | ✅ PASS | All rationale from DB fields |
| No hallucinated coins | ✅ PASS | Only from `coins` table via quality gates |

### Publication Safety

| Check | Status | Evidence |
|---|---|---|
| PUBLISHED only on Binance success | ✅ PASS | `publisher.ts:305` checks `result.success` |
| Quota checked before publish | ✅ PASS | `publisher.ts:260-267` |
| Quota incremented only on success | ✅ PASS | `publisher.ts:323` inside success block |
| Dedup checked before publish | ✅ PASS | `publisher.ts:279-285` |
| Thesis stability checked | ✅ PASS | `publisher.ts:288-294` |
| Content snapshot saved | ✅ PASS | `publisher.ts:313` |

### Content Safety

| Check | Status | Evidence |
|---|---|---|
| No BUY/SELL/ORDER/EXECUTE | ✅ PASS | Validation rejects these terms |
| No guaranteed profit claims | ✅ PASS | Disclaimer present in all posts |
| No certainty language | ✅ PASS | "invalidates if", "weakens if" — conditional |
| No trading execution | ✅ PASS | No Binance trading API calls |
| No P6 semantics | ✅ PASS | No P6 imports or modifications |

## 5. Gap Classification

### A — Must Fix Before Operation

**None identified.**

The system can safely run in production. All critical safety boundaries are intact.

### B — High-Value Optimization

| # | Gap | Impact | Evidence |
|---|---|---|---|
| B1 | No retry for transient Binance API failures | Lost posts on temporary network/API issues | `postText` has single attempt, no retry |
| B2 | `llmUsed` always false in publication record | Cannot measure LLM vs template ratio | `publisher.ts:310` hardcoded `llmUsed: false` |
| B3 | No admin/operational API endpoint | Must query DB directly for operational visibility | No `/api/admin/square-*` endpoint exists |
| B4 | No quota consumption alerting | Could unexpectedly hit 100/day limit | No alert when quota > 80% |
| B5 | No failure rate tracking | Cannot detect Binance API degradation trends | `errorCode` recorded but no aggregation |
| B6 | No way to manually trigger/replay | Cannot recover from scheduler failure without waiting for next refresh | No manual trigger endpoint |

### C — Future Enhancement

| # | Gap | Impact | Evidence |
|---|---|---|---|
| C1 | No click/engagement metrics from Binance | Cannot optimize content for monetization | Binance API doesn't expose these |
| C2 | No pipeline duration metrics | Cannot detect performance degradation | No timing recorded |
| C3 | No LLM latency tracking | Cannot optimize LLM vs template decision | No timing recorded |
| C4 | No price change percentage | Users don't see magnitude of move | Not in brief |
| C5 | No regime-adaptive ATR | Levels may be suboptimal in extreme volatility | Fixed 0.5x/1.5x/3x/1x |

### D — Not Needed

| Item | Reason |
|---|---|
| Auto-trading features | Explicitly out of scope per master spec |
| P4/P5 modifications | Frozen boundaries |
| Image/video posts | Text posts verified and working |
| Real-time dashboard | Not required for MVP monetization |

## 6. Risk Assessment

| Risk | Likelihood | Impact | Mitigation | Classification |
|---|---|---|---|---|
| Transient Binance API failure loses post | Medium | Low (one lost post) | B1 — Add retry logic |
| Quota exhausted unexpectedly | Low | Medium (lost opportunities) | B4 — Add alerting |
| Same thesis accidentally suppressed | Low | Low | Already mitigated by material-change detection |
| LLM produces invalid output | Low | Low | Validation rejects invalid output |
| API key leaked | Very Low | Very High | Env var only, never logged |
| P4/P5 accidentally modified | Very Low | Very High | No imports, no references |
| Refresh blocked by Square failure | Very Low | Very High | Non-blocking try/catch |
| Post published without evidence | Very Low | Medium | Quality gates require score change >= 3 |

## 7. Conclusion

The Binance Square monetization pipeline is **operationally ready**. All critical safety boundaries are intact, the scheduler integration is non-blocking, quality gates prevent weak data from publishing, and the content generation produces data-grounded posts with proper disclaimers.

The identified gaps are all B-class (high-value optimization) or C-class (future). No A-class (must-fix) blockers exist.

**Recommendation:** Proceed with monetization launch. Address B-class items in subsequent operational sprint.
