# SQ-VALUE-04 RECON

## 1. Task Scope

This task upgrades the narrative post quality from "listing 2–4 coins" to an investment-research style insight with thesis, per-coin rationale, and actionable setup. No production source was modified prior to this recon.

### Inspected Files
- `src/lib/square/opportunity-engine.ts`
- `src/lib/square/content-generator.ts`
- `src/lib/square/publisher.ts`
- `src/lib/square/production.ts`
- `src/lib/square/chart-utils.ts`
- `src/db/schema.ts`
- `src/lib/square/__tests__/*.test.ts`
- `docs/Binance_Square_Upgrade/SQ-VALUE-03_*`

## 2. E1 — Per-Coin Rationale

### Problem
Narrative posts listed leading coins as bare cashtags:
```
Leading coins:
$FET
$RENDER
$TAO
```
No explanation of why each coin qualifies.

### Solution
Added `generateNarrativeCoinRationale(coin: CoinData): string` that produces a deterministic 1-line rationale from existing data:
- Signal strength (STRONG_WATCH, WATCH, WEAK, OBSERVE)
- Score change magnitude (improving/declining relative strength)
- Trend + volume confirmation

Added `leadingCoinRationales?: string[]` to `SquareOpportunity`.

In `buildContentBrief`, narrative posts now render:
```
Leading coins:
$FET — strongest momentum contribution
$TAO — improving relative strength (+4.2)
$RENDER — confirmed by trend and volume
```

### Data Source
Reuses existing `CoinData` fields: `signal`, `scoreChange`, `trendScore`, `volumeScore`. No new DB queries.

## 3. E2 — Data-Grounded Narrative Invalidation

### Problem
`buildContentBrief` called `generateNarrativeInvalidation` with hardcoded placeholder data:
```typescript
signal: "OBSERVE",  // HARDCODED for ALL leading coins
confidenceScore: 50,
```

This produced generic, non-data-grounded invalidation text.

### Solution
Moved invalidation generation to `extractNarrativeOpportunities` where real `coinData` is available.

Added `generateNarrativeInvalidationFromData(narrative, leadingCoinsData)` that:
1. Checks for weak coins (OBSERVE/WEAK signal) among leading coins
2. Checks for declining coins (scoreChange < -3)
3. Checks for low narrative confidence (< 50)
4. Falls back to generic but valid statement: "The narrative thesis becomes weaker if the current leading-coin strength fails to persist."

Added `narrativeInvalidation?: string | null` to `SquareOpportunity`.

### Important
The generic fallback statement is used ONLY when no specific data condition is detected. It is not a placeholder — it is a valid logical inference: if the narrative's strength comes from leading coins, and those coins don't maintain strength, the thesis weakens.

## 4. E3 — Narrative Entry / TP / SL

### Recon Findings

| Approach | Feasible? | Reason |
|---|---|---|
| Narrative-level aggregate setup | ❌ NOT FEASIBLE | No "narrative price" exists; coins have vastly different price scales (e.g., $FET ~$1.5, $TAO ~$400) |
| Average of leader coin levels | ❌ NOT FEASIBLE | Averaging ATRs and prices across different coins is meaningless |
| Per-leader-coin setup | ✅ FEASIBLE | Reuses existing `calculateSetupLevels()` on the #1 leader coin |

### Decision
**DEFERRED** for narrative-level aggregate setup. Not implementable from current data without inventing a synthetic "narrative price."

**IMPLEMENTED** for leader coin setup: when the top leading coin has full ATR + price data, its Entry/TP/SL is appended to the narrative post under "📍 Leader setup:" section. This is clearly labeled as the leader coin's setup, not the narrative's setup.

### Implementation
Added to `SquareOpportunity`:
- `leaderCoinEntry?: PriceZone`
- `leaderCoinTakeProfits?: PriceTarget[]`
- `leaderCoinStopLoss?: PriceTarget`

In `extractNarrativeOpportunities`:
```typescript
const leaderCoin = leadingCoinsData[0];
const leaderSetup = leaderCoin ? calculateSetupLevels(leaderCoin) : null;
```

In `buildContentBrief`:
```typescript
} else if (opportunity.type === "NARRATIVE_SETUP" && opportunity.leaderCoinEntry) {
  lines.push("");
  lines.push("📍 Leader setup:");
  // ... Entry/TP/SL
}
```

### Boundary
- No new algorithm invented
- Existing `calculateSetupLevels` reused unchanged
- LLM cannot modify levels (same as coin posts)
- Missing data → section omitted (no fabrication)

## 5. E4 — LLM Output Consistency

### Problems
1. LLM prompt said "under 500 characters" but template produces 500–600 chars
2. No explicit required-section validation
3. WHY NOW and INVALIDATION sections could be dropped by LLM without rejection

### Solutions
1. **Length**: Increased `maxOutputTokens` from 1024 → 1200, `maxTextLength` from 2000 → 1200, prompt says "under 800 characters"
2. **Section validation**: Added checks in `validateLLMOutput`:
   - WHY NOW must appear if `brief.whyNowFacts` provided
   - INVALIDATION must appear if `brief.invalidation` provided
   - All cashtags must appear
   - All leading coin cashtags must appear
3. **Prompt structure**: Added "REQUIRED SECTIONS" list to LLM prompt

### Template Fallback
Template fallback (`generateFromBrief`) uses `brief.text` directly. Since `buildContentBrief` now includes all sections deterministically, template fallback produces semantically complete output.

## 6. Architecture

No new pipelines. No changes to:
- `publisher.ts` (only type imports)
- `production.ts` (no changes needed)
- P4/P5/P6
- Opportunity scoring
- Entry/TP/SL algorithm
- Quota/dedup logic

## 7. Data Flow

```
extractNarrativeOpportunities()
    ├── selectNarrativeLeadingCoins()
    ├── generateNarrativeCoinRationale() per coin [E1]
    ├── generateNarrativeInvalidationFromData() [E2]
    └── calculateSetupLevels() for leader coin [E3]
         ↓
SquareOpportunity {
  leadingCoinSymbols,
  leadingCoinRationales,
  narrativeInvalidation,
  leaderCoinEntry,
  leaderCoinTakeProfits,
  leaderCoinStopLoss
}
    ↓
buildContentBrief()
    ├── WHY NOW section
    ├── Key facts
    ├── Leading coins with per-coin rationale [E1]
    ├── Leader setup (if available) [E3]
    ├── INVALIDATION (data-grounded) [E2]
    └── Disclaimer
    ↓
generateContent()
    ├── LLM (validated sections)
    └── Template fallback
```

## 8. Gap Classification

| Gap | Classification | Evidence |
|---|---|---|
| Narrative invalidation hardcoded | **B** | FIXED — now uses real coin signals |
| No per-coin rationale | **B** | FIXED — `leadingCoinRationales` added |
| LLM length inconsistency | **B** | FIXED — aligned to 800 chars |
| Narrative Entry/TP/SL missing | **DEFERRED** | Aggregate setup not feasible; leader coin setup added instead |
| Technical jargon unexplained | C | Not addressed in this task |
| No price change % | C | Not addressed in this task |
| Comparative context | C | Not addressed in this task |
