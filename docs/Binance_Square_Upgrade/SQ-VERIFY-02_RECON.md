# SQ-VERIFY-02 — RECON

## Objective

Audit and close G18 (Chart Integration) from SQ-VERIFY-01 by verifying the actual Binance Square chart mechanism and implementing correct integration.

## Binance Square Chart Mechanism — Verified

### How Charts Work

Binance Square uses **implicit cashtag detection** — there is **no explicit chart attachment API parameter**.

When a post contains a cashtag like `$BTC`, Binance's frontend:
1. Detects the cashtag pattern in the content text
2. Renders an interactive candle chart widget for that coin
3. Links the chart to the coin's Binance trading pair

### API Contract Evidence

From the Binance Square OpenAPI skill documentation:

```
Endpoint: https://openapi.binance.com/sapi/v1/public/content/add
Method: POST
Content-Type: application/json

Parameters:
  content: string (post text, includes cashtags)
  contentType: 1 (short post) | 2 (article with cover)
```

**No `chart`, `chartWidget`, `candleChart`, `symbol`, or `media` parameter exists.**

The chart widget is entirely **platform-rendered** based on cashtag detection in the `content` field.

### Implication

The chart integration is achieved by ensuring:
1. Cashtags are present in the post content (e.g., `$BTC`)
2. The cashtag corresponds to the analyzed coin
3. The cashtag format is consistent (uppercase ticker without quote suffix)

## Current State Analysis

### What Already Works

| Component | Status |
|---|---|
| Cashtags in content text | ✅ `buildContentBrief()` generates `$SYMBOL` from `coinSymbol` |
| Symbol source | ✅ Database `coins.symbol` stores uppercase tickers (BTC, ETH, etc.) |
| Content text includes cashtag | ✅ Headline contains `$BTC` for coin setups |

### What Was Missing (G18 Gap)

| Gap | Evidence |
|---|---|
| No symbol normalization | `coinSymbol` from DB is assumed clean, but no normalization guard |
| `chartCoin` field unused | Present in `SquareContentBrief` but never passed to publisher |
| No chart metadata in publication record | Publisher doesn't record which coin's chart was intended |
| No validation of cashtag in LLM output | LLM could theoretically drop the cashtag |
| No multi-coin chart behavior documented | Narrative posts with multiple coins — behavior undefined |

## Files Changed

| File | Change |
|---|---|
| `src/lib/square/chart-utils.ts` | **NEW** — Symbol normalization, chart validation, metadata |
| `src/lib/square/opportunity-engine.ts` | Updated `buildContentBrief()` to use chart validation |
| `src/lib/square/content-generator.ts` | Added cashtag validation for LLM output |
| `src/lib/square/publisher.ts` | Records chart metadata in publication snapshot |
| `src/lib/square/production.ts` | Wires chart metadata through pipeline |
| `src/lib/square/__tests__/chart-utils.test.ts` | **NEW** — 47 chart integration tests |

## Key Design Decisions

### 1. Symbol Normalization

```typescript
normalizeCoinSymbol("BTCUSDT") → "BTC"
normalizeCoinSymbol("$BTC")    → "BTC"
normalizeCoinSymbol("BTC/USDT") → "BTC"
normalizeCoinSymbol("btc")     → "BTC"
```

All formats normalize to the same canonical ticker. Deterministic.

### 2. Chart Coin = First Valid Cashtag

For a single-coin post: `chartCoin = normalized symbol`
For a narrative post: `chartCoin = leader coin's symbol`
Multi-chart: NOT supported by Binance API — one chart widget per post.

### 3. LLM Cannot Modify Chart

The LLM receives `chartCoin` as metadata in the prompt but:
- Cashtags are validated in `validateLLMOutput()` — if LLM drops a cashtag, fallback to template
- The chart coin is resolved BEFORE LLM generation
- The chart metadata is recorded independently of LLM output

### 4. Chart Does Not Affect Trading Levels

The chart integration operates at the **content/presentation layer** only:
- `chartCoin` is metadata for the publication record
- Entry/TP/SL are computed in `calculateSetupLevels()` (unchanged)
- `opportunityScore` is computed in `calculateOpportunityScore()` (unchanged)
- The chart has zero influence on scoring or level calculation

## Multi-Coin Behavior

For narrative posts with multiple mentioned coins:

| Scenario | Behavior |
|---|---|
| `$FET $RENDER $TAO` in text | Binance renders chart widgets for each detected cashtag |
| Our `chartCoin` field | Set to primary/leader coin only |
| Publication record | Records primary chart coin for audit |
| Other cashtags | Present in text content, Binance auto-detects |

**We do NOT create multi-chart payloads** — Binance handles this at the platform level.
