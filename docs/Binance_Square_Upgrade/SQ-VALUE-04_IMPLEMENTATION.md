# SQ-VALUE-04 IMPLEMENTATION

## 1. E1 — Per-Coin Rationale

### File: `src/lib/square/opportunity-engine.ts`

**New helper:**
```typescript
function generateNarrativeCoinRationale(coin: CoinData): string
```

Produces 1-line rationale from existing data:
- Signal strength → "strongest momentum contribution", "positive monitoring posture", "weakening relative strength", "stable baseline"
- Score change → "improving relative strength (+X.X)", "declining relative strength (-X.X)"
- Trend + volume → "confirmed by trend and volume"

**New field on `SquareOpportunity`:**
```typescript
leadingCoinRationales?: string[];
```

**New field on `SquareContentBrief`:**
```typescript
leadingCoinRationales?: string[];
```

**Brief output:**
```
Leading coins:
$FET — strongest momentum contribution
$TAO — improving relative strength (+4.2)
$RENDER — confirmed by trend and volume
```

## 2. E2 — Data-Grounded Narrative Invalidation

### File: `src/lib/square/opportunity-engine.ts`

**New helper:**
```typescript
function generateNarrativeInvalidationFromData(
  narrative: NarrativeData,
  leadingCoins: CoinData[]
): string | null
```

Logic:
1. Weak coins (OBSERVE/WEAK) → "Narrative thesis weakens if {symbol} loses its current signal posture."
2. Low avg confidence (<50) → "Narrative thesis weakens if average confidence drops further below current levels."
3. Declining coins (scoreChange < -3) → "Narrative thesis weakens if {symbol} continues declining."
4. Fallback → "The narrative thesis becomes weaker if the current leading-coin strength fails to persist."

**New field on `SquareOpportunity`:**
```typescript
narrativeInvalidation?: string | null;
```

**Removed:** Placeholder hardcoded `signal: "OBSERVE"` data in `buildContentBrief`.

## 3. E3 — Narrative Leader Coin Entry/TP/SL

### File: `src/lib/square/opportunity-engine.ts`

### Recon Decision
Narrative-level aggregate setup is **NOT FEASIBLE** because:
- No common price denominator across coins
- Different price scales make averaging meaningless
- No "narrative ATR" exists

### Implementation
Reuses existing `calculateSetupLevels()` on the #1 ranked leading coin.

**New fields on `SquareOpportunity`:**
```typescript
leaderCoinEntry?: PriceZone;
leaderCoinTakeProfits?: PriceTarget[];
leaderCoinStopLoss?: PriceTarget;
```

**New fields on `SquareContentBrief`:**
```typescript
leaderCoinEntry?: PriceZone;
leaderCoinTakeProfits?: PriceTarget[];
leaderCoinStopLoss?: PriceTarget;
```

**Brief output:**
```
📍 Leader setup:
Entry: 1.5000–1.5500
TP: 1.6500
TP: 2.0000
SL: 1.4000
```

**Conditions:**
- Only shown when leader coin has valid `currentPrice > 0` and `atr14 !== null`
- Omitted when data is insufficient (no fabrication)
- Clearly labeled "Leader setup:" not "Setup:"

## 4. E4 — LLM Output Consistency

### File: `src/lib/square/content-generator.ts`

**Changes:**
1. `MAX_LLM_OUTPUT_TOKENS`: 1024 → 1200
2. `MAX_TEXT_LENGTH`: 2000 → 1200
3. Prompt: "under 500 characters" → "under 800 characters"
4. Added "REQUIRED SECTIONS" list to prompt
5. Added `validateLLMOutput` checks:
   - WHY NOW section required when `brief.whyNowFacts` present
   - INVALIDATION section required when `brief.invalidation` present
   - All leading coin cashtags required

**Template fallback:**
Uses `brief.text` directly — all sections are deterministic, no LLM dependency.

## 5. Tests

### File: `src/lib/square/__tests__/value-enhancements.test.ts`

**Updated tests:**
- `generates narrative invalidation` — now sets `narrativeInvalidation` directly on test opportunity
- `narrative post contains leading coins and why now` — now includes `leadingCoinRationales` and `narrativeInvalidation`

**New test coverage:**
- Per-coin rationale display with rationale text
- Leader coin setup in narrative posts
- LLM prompt includes required sections
- Template fallback includes all new sections

## 6. Backward Compatibility

| Field | Optional? | Impact |
|---|---|---|
| `leadingCoinRationales` | Yes | Existing coin opportunities unaffected |
| `narrativeInvalidation` | Yes | Falls back to coin invalidation or null |
| `leaderCoinEntry/TP/SL` | Yes | Only used for NARRATIVE_SETUP |
| `MAX_TEXT_LENGTH` | Config | Only affects output truncation |

No breaking changes to any public API.

## 7. What Was NOT Changed

- P4/P5/P6: untouched
- Opportunity scoring: unchanged
- Entry/TP/SL algorithm: unchanged (`calculateSetupLevels` reused as-is)
- Publisher API contract: unchanged
- Scheduler integration: unchanged
- Quota/dedup logic: unchanged
- Template fallback mechanism: unchanged
