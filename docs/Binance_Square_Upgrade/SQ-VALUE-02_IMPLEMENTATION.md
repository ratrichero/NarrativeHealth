# SQ-VALUE-02 IMPLEMENTATION

## 1. E1 — Multi-coin Narrative Post

### Problem
Narrative posts only surfaced the top coin (`topCoin.symbol`), producing posts like:
```
📊 $FET — Health Signal
```
instead of the master-spec example:
```
AI Narrative is showing renewed strength.
Leading coins: $FET $RENDER $TAO
```

### Solution
Added `selectNarrativeLeadingCoins()` in `opportunity-engine.ts`:
1. Filters coins in narrative to those passing quality gates
2. Computes deterministic selection score: `healthScore * 0.4 + confidenceScore * 0.3 + |scoreChange| * 10 * 0.3`
3. Sorts descending, picks top N (configurable via `maxLeadingCoins`, default 3)
4. Returns `leadingCoinSymbols[]` on `SquareOpportunity`

`buildContentBrief` now:
- Generates cashtags for ALL leading coins in narrative posts
- Adds "Leading coins:" section with each cashtag on its own line

### Coin Selection Rule
- Must pass existing quality gates (same as coin opportunities)
- Cannot force fewer than 1 coin
- Does NOT use market cap ranking
- Uses existing data only (health, confidence, momentum)

## 2. E2 — "Why Now" Hook

### Problem
Posts lacked explicit timeliness. Users saw "Health improving (+5.2)" but not "this changed today / this refresh."

### Solution
Added two deterministic helpers:
- `generateWhyNowForCoin()` — extracts score change magnitude, signal upgrade, trend+volume confirmation
- `generateWhyNowForNarrative()` — extracts narrative score change, leading coin participation

Output: 1-3 factual sentences added as "WHY NOW" section before "Key facts."

### LLM Boundary
- Facts are generated deterministically in `buildContentBrief`
- LLM receives them as structured facts in the prompt
- LLM can only rephrase, not invent
- Template fallback includes them verbatim

## 3. E3 — Deterministic Invalidation Thesis

### Problem
SL was presented as a raw number without context. Users didn't know what would break the thesis.

### Solution
Added two deterministic helpers:
- `generateCoinInvalidation()` — derives SL-based invalidation from existing setup levels
- `generateNarrativeInvalidation()` — derives weakest coin signal / confidence threshold invalidation

Output: Single sentence added as "INVALIDATION" section after setup levels.

### Determinism
- Coin invalidation: computed from `entryLow - 1.0 * ATR` (same math as SL)
- Narrative invalidation: derived from weakest leading coin signal or avg confidence threshold
- LLM cannot modify invalidation (it's in `brief.invalidation`, not in LLM output path)

## 4. E4 — Thesis Stability / Repetition Guard

### Problem
Same thesis could publish daily because fingerprint included `dataAsOf`.

### Solution
Added `generateThesisFingerprint()` in `publisher.ts`:
- Semantic components: `type + subjectId + narrativeId + sortedCoins + signal + entryLow + entryHigh + tpLevels + slLevel + invalidation`
- NO `dataAsOf` — same thesis across days = same fingerprint
- Uses existing `squareFingerprints` table with 168h TTL (7 days)

Added `isThesisStable()` — checks if thesis fingerprint already exists in fingerprints table.

### Material Change Detection
The following changes produce a NEW fingerprint (thesis is eligible):
- Entry changed
- TP changed
- SL changed
- Invalidation changed
- Signal changed
- Leading coins changed
- Narrative posture changed

The following do NOT change the fingerprint:
- Date change alone
- Minor price movement within ATR rounding

## 5. LLM Prompt Changes

### Before
```
Write a concise Binance Square post about a crypto setup.
RULES:
- Use ONLY the facts provided below
- Do NOT invent any price, volume, trend, or data
- Do NOT change Entry/TP/SL levels
- Include coin cashtags (e.g. $BTC)
FACTS:
Coins: $BTC
• Health improving (+5.2)
• Signal: STRONG_WATCH
...
```

### After
```
Write a concise Binance Square post about a crypto setup.
RULES:
- Use ONLY the facts provided below
- Do NOT invent any price, volume, trend, or data
- Do NOT change Entry/TP/SL levels
- Do NOT add or remove coin cashtags
- Do NOT change the invalidation condition
FACTS:
Coins: $BTC
Leading coins: $BTC
WHY NOW:
• Health improved by 5.2 points in the latest refresh.
• Signal upgraded to STRONG_WATCH.
• Health improving (+5.2)
• Signal: STRONG_WATCH
...
INVALIDATION
• Setup invalidates if price breaks below 49000.0000 with sustained weakness.
```

### Validation Changes
- Added check: all expected cashtags must appear in LLM output
- Added check: all leading coin cashtags must appear in LLM output
- Added check: invalidation must be present in LLM output

## 6. Fallback Behavior

Template fallback (`generateFromBrief`) uses `brief.text` directly. Since `buildContentBrief` now includes all new sections (WHY NOW, LEADING COINS, INVALIDATION), the template fallback automatically includes them without any LLM involvement.

If LLM fails validation (drops cashtag, drops invalidation, adds forbidden terms), system falls back to template with all sections intact.

## 7. Test Coverage

### New Tests (17 total)

| Test Group | Tests | Coverage |
|---|---|---|
| E1: Multi-coin | 3 | 3 coins selected, 1 coin handled, insufficient coins handled |
| E2: Why Now | 3 | Coin why-now, narrative why-now, weak data fallback |
| E3: Invalidation | 3 | Coin invalidation, narrative invalidation, insufficient data |
| E4: Thesis Stability | 5 | Same thesis identical, changed entry, changed SL, changed posture, no random dependency |
| Integration | 3 | Coin post sections, narrative post sections, LLM prompt sections |

### Regression
- All 61 existing Square tests pass
- All 420 P4/P5 tests pass
- TypeScript typecheck clean

## 8. Configuration

New config field in `OpportunityScoringConfig`:
```typescript
maxLeadingCoins: number; // default 3
```

Existing config fields unchanged. Default values preserve existing behavior.

## 9. Backward Compatibility

- `SquareOpportunity.leadingCoinSymbols` is optional — existing coin opportunities unaffected
- `SquareContentBrief.whyNowFacts`, `invalidation` are optional — existing consumers ignore if absent
- `publishContent` accepts optional `thesisFingerprint` — existing callers unaffected
- No breaking changes to any public API
