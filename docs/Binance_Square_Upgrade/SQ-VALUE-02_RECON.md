# SQ-VALUE-02 RECON

## 1. Source Architecture Review

### Existing Square Pipeline

```
Refresh completes
    ↓
runSquarePipeline()
    ↓
evaluateOpportunities()
    ↓
extractCoinOpportunities() + extractNarrativeOpportunities()
    ↓
persistOpportunity()
    ↓
buildContentBrief()
    ↓
publishContent()
    ↓
Binance Square API
```

### Current Data Fields Reused

| Field | Source | Used For |
|---|---|---|
| `coinSymbol` | `coins` | Cashtag generation |
| `narrativeId` | `coinNarratives` | Narrative grouping |
| `healthScore` | `health_scores` | Opportunity scoring |
| `scoreChange` | `health_scores` | Momentum, Why Now |
| `signal` | `recommendations` | Post headline, thesis fingerprint |
| `trendScore` | `features` | Why Now, scoring |
| `volumeScore` | `features` | Why Now, scoring |
| `confidenceScore` | `health_scores` | Quality gates |
| `currentPrice` | `market_price_daily` | Entry/TP/SL, invalidation |
| `atr14` | `indicators` | Entry/TP/SL, invalidation |
| `entryZone` | computed | Setup levels, invalidation |
| `stopLoss` | computed | Invalidation thesis |
| `rationale` | generated | Evidence, signal extraction |
| `leadingCoinSymbols` | computed | Multi-coin cashtags |

### Gap Analysis

| Gap | Current State | Enhancement |
|---|---|---|
| Narrative posts show only 1 coin | `extractNarrativeOpportunities` uses only `topCoin` | E1: Select 2-4 leading coins by deterministic score |
| No "Why now" urgency | Content brief has no timeliness section | E2: Generate `whyNowFacts` from score change, signal, data freshness |
| No explicit invalidation | SL exists but not labeled as invalidation | E3: Add `invalidation` field with deterministic text |
| Same thesis can publish daily | Fingerprint includes `dataAsOf` — different day = different fingerprint | E4: Thesis fingerprint without date, 7-day stability check |

## 2. Proposed Changes

### E1: Multi-coin Narrative Post

**File:** `src/lib/square/opportunity-engine.ts`

**Change:** `extractNarrativeOpportunities` now calls `selectNarrativeLeadingCoins` which:
- Filters coins to those passing quality gates
- Sorts by `calculateNarrativeCoinSelectionScore` (reuses existing data)
- Caps at `config.maxLeadingCoins` (default 3)
- Returns `leadingCoinSymbols[]` on `SquareOpportunity`

**Content brief:** `buildContentBrief` generates cashtags for ALL leading coins in narrative posts.

### E2: Why Now Hook

**File:** `src/lib/square/opportunity-engine.ts`

**Change:** Added `generateWhyNowForCoin` and `generateWhyNowForNarrative` helpers.
- Extract score change, signal, trend, volume from existing rationale/data
- Produce 1-3 deterministic facts
- Added `whyNowFacts?: string[]` to `SquareContentBrief`

**Content brief:** Includes "WHY NOW" section before "Key facts".

### E3: Invalidation Thesis

**File:** `src/lib/square/opportunity-engine.ts`

**Change:** Added `generateCoinInvalidation` and `generateNarrativeInvalidation` helpers.
- Coin: derives SL-based invalidation from existing setup levels
- Narrative: derives weakest coin / confidence-based invalidation
- Added `invalidation?: string | null` to `SquareContentBrief`

**Content brief:** Includes "INVALIDATION" section after setup levels.

### E4: Thesis Stability / Repetition Guard

**Files:** `src/lib/square/publisher.ts`, `src/lib/square/production.ts`

**Change:** Added `generateThesisFingerprint` and `isThesisStable` in publisher.
- Thesis fingerprint excludes `dataAsOf` (same thesis = same fingerprint across days)
- Includes semantic components: type, subject, coins, signal, entry, TP, SL, invalidation
- Uses existing `squareFingerprints` table with 168h TTL (7 days)
- `publishContent` accepts optional `thesisFingerprint` and returns `THESIS_STABLE` if duplicate found

**Production wiring:** `production.ts` computes thesis fingerprint from opportunity + brief, passes to `publishContent`.

## 3. Affected Files

| File | Type | Change |
|---|---|---|
| `src/lib/square/opportunity-engine.ts` | production | E1, E2, E3 |
| `src/lib/square/content-generator.ts` | production | E2, E3 (LLM prompt + validation) |
| `src/lib/square/publisher.ts` | production | E4 |
| `src/lib/square/production.ts` | production | E4 wiring |
| `src/lib/square/__tests__/value-enhancements.test.ts` | test | NEW — 17 tests |

## 4. Invariant Analysis

| Invariant | Status | Evidence |
|---|---|---|
| Entry/TP/SL unchanged | ✅ PASS | `calculateSetupLevels` not modified |
| Opportunity scoring unchanged | ✅ PASS | `calculateOpportunityScore` not modified |
| LLM cannot modify Entry/TP/SL | ✅ PASS | Levels appended after LLM, unchanged |
| LLM cannot invent coins | ✅ PASS | Validation checks expected cashtags + leading coins |
| Template fallback preserved | ✅ PASS | `generateFromBrief` uses `brief.text` directly |
| Quota 100/day preserved | ✅ PASS | `getQuotaStatus` unchanged |
| Non-blocking scheduler preserved | ✅ PASS | `runSquarePipeline` try/catch unchanged |
| 0..N publishing preserved | ✅ PASS | Soft cap + quota remaining logic unchanged |
| No P4/P5/P6 imports | ✅ PASS | No new imports from frozen layers |
| No trading semantics | ✅ PASS | No BUY/SELL/ORDER/EXECUTE added |
