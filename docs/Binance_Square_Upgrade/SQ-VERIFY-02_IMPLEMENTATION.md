# SQ-VERIFY-02 — IMPLEMENTATION

## Summary

Closed G18 by implementing proper chart integration through cashtag normalization, validation, and metadata tracking.

## Changes

### 1. `src/lib/square/chart-utils.ts` — NEW

Core chart utilities:

- **`normalizeCoinSymbol(input)`** — Converts any symbol format to canonical uppercase ticker
  - Handles: `BTC`, `$BTC`, `btc`, `BTCUSDT`, `BTC/USDT`, `BTC_USDT`, `BTCPERP`
  - Returns empty string for invalid inputs
  - Deterministic: same input → same output

- **`validateChartSymbol(input)`** — Validates and normalizes for cashtag use
  - Returns normalized symbol or null
  - Rejects common non-crypto words (THE, AND, etc.)
  - Allows known crypto tokens (FET)

- **`resolveChartCoin(explicit, cashtags)`** — Resolves primary chart coin
  - Priority: explicit > first valid cashtag > null
  - Returns `ChartCoinResult` with metadata

- **`generateChartMetadata(chartCoin, sourceSymbol)`** — Generates publication metadata
  - Tracks: chart enabled, symbol, matches source, cashtag count

### 2. `src/lib/square/opportunity-engine.ts` — UPDATED

Updated `buildContentBrief()`:
- Imports `normalizeCoinSymbol` and `validateChartSymbol`
- Normalizes `coinSymbol` before generating cashtag
- Validates chart coin
- Adds `chartCoinExplicit` field to brief
- Chart coin is now validated, not raw from DB

### 3. `src/lib/square/content-generator.ts` — UPDATED

Updated LLM validation:
- `validateLLMOutput()` now accepts `expectedCashtags` parameter
- If LLM output is missing expected cashtags → fallback to template
- LLM prompt includes `chartCoin` as metadata (cannot modify it)

### 4. `src/lib/square/publisher.ts` — UPDATED

Updated `publishContent()`:
- Accepts optional `chartMetadata` parameter
- Records `chartSymbol` and `chartMatchesSource` in `contentSnapshot`
- No new DB columns needed — stored in existing JSONB field

### 5. `src/lib/square/production.ts` — UPDATED

Updated pipeline:
- Imports `resolveChartCoin` and `generateChartMetadata`
- Resolves chart coin from brief before publishing
- Passes chart metadata to `publishContent()`

### 6. `src/lib/square/__tests__/chart-utils.test.ts` — NEW

47 tests covering:
- Symbol normalization (14 tests)
- Chart symbol validation (7 tests)
- Chart coin resolution (5 tests)
- Chart metadata generation (5 tests)
- Content brief chart integration (8 tests)
- Edge cases (8 tests)

## Boundary Verification

| Concern | Verified |
|---|---|
| Chart does NOT modify Entry/TP/SL | ✅ `calculateSetupLevels()` unchanged |
| Chart does NOT modify opportunityScore | ✅ `calculateOpportunityScore()` unchanged |
| Chart does NOT influence publication eligibility | ✅ Chart metadata recorded after publish decision |
| LLM cannot modify chart identity | ✅ Chart resolved before LLM; cashtags validated after |
| Chart is metadata only | ✅ Stored in `contentSnapshot` JSONB, not used for logic |
| No new DB schema | ✅ Uses existing JSONB field |
| No frozen P5/P4 changes | ✅ Zero imports from P4/P5 |
