# SQ-VALUE-03 RECON

## 1. Audit Scope

This audit evaluates the actual output quality of the Binance Square monetization pipeline after SQ-VALUE-02 enhancements. No production source code was modified.

### What was inspected
- All `src/lib/square/*.ts` production files
- `src/db/schema.ts` Square tables
- All Square tests (78 tests)
- Master specification content contract (§10)
- API contract (frozen)
- SQ-VALUE-01/02 documentation

### What was NOT modified
- No production source changed
- No P4/P5/P6 touched
- No scoring algorithm changed
- No Entry/TP/SL algorithm changed
- No quota changed

## 2. Current Pipeline Architecture

```
Refresh completes
    ↓
runSquarePipeline()
    ↓
evaluateOpportunities()
    ├── extractCoinOpportunities()
    │   ├── passesQualityGates()
    │   ├── calculateOpportunityScore()
    │   ├── calculateSetupLevels() → Entry/TP/SL
    │   ├── generateRationale()
    │   └── generateWhyNowForCoin() [E2]
    └── extractNarrativeOpportunities()
        ├── passesQualityGates() per coin
        ├── selectNarrativeLeadingCoins() [E1]
        ├── calculateNarrativeScore()
        ├── generateNarrativeRationale()
        └── generateWhyNowForNarrative() [E2]
    ↓
persistOpportunity()
    ↓
buildContentBrief()
    ├── WHY NOW section [E2]
    ├── Key facts
    ├── Leading coins (narrative) [E1]
    ├── Entry/TP/SL
    ├── Invalidation [E3]
    └── Disclaimer
    ↓
generateContent()
    ├── LLM path (with validation)
    └── Template fallback
    ↓
publishContent()
    ├── Quota check
    ├── Content dedup
    ├── Thesis stability check [E4]
    ├── Binance Square API
    └── Record fingerprint + thesis fingerprint
```

## 3. Data-to-Content Mapping

| Data Field | Coin Post Usage | Narrative Post Usage |
|---|---|---|
| `coinSymbol` | Cashtag, headline | Leading coin cashtag |
| `narrativeId` | Context in rationale | Narrative grouping |
| `healthScore` | Rationale, scoring | Narrative score |
| `scoreChange` | WHY NOW, rationale | WHY NOW, rationale |
| `signal` | Headline, WHY NOW, thesis fingerprint | Not surfaced per-coin |
| `trendScore` | WHY NOW, rationale | Not surfaced per-coin |
| `volumeScore` | WHY NOW, rationale | Not surfaced per-coin |
| `confidenceScore` | Rationale, quality gates | Narrative quality |
| `currentPrice` | Entry calculation | Not used |
| `atr14` | Entry/TP/SL, invalidation | Not used |
| `entryZone` | Setup section | Not present |
| `stopLoss` | Setup section, invalidation | Not present |
| `leadingCoinSymbols` | Not used | Multi-coin cashtags |
| `whyNowFacts` | WHY NOW section | WHY NOW section |
| `invalidation` | INVALIDATION section | INVALIDATION section |

## 4. Component Inventory

| Component | Status | Notes |
|---|---|---|
| Opportunity scoring | ✅ Deterministic | Unchanged from baseline |
| Quality gates | ✅ Active | Freshness, confidence, quality, change |
| Entry/TP/SL | ✅ Deterministic | ATR-based, unchanged |
| Coin post content | ✅ Complete | All master spec sections present |
| Narrative post content | ⚠️ Partial | Missing per-coin rationale, has placeholder invalidation |
| WHY NOW | ✅ Implemented | Data-grounded for coin, partial for narrative |
| Invalidation | ✅ Present | Coin: data-grounded; Narrative: placeholder |
| Multi-coin | ✅ Implemented | 2-4 leading coins selected deterministically |
| Thesis stability | ✅ Implemented | 7-day window, semantic fingerprint |
| LLM boundary | ✅ Intact | Levels appended after, validation checks cashtags |
| Template fallback | ✅ Working | Includes all new sections |
| Quota | ✅ 100/day | Unchanged |
| Dedup | ✅ Dual layer | Content fingerprint + thesis fingerprint |

## 5. Identified Output Patterns

### Coin Post (template fallback output)
```
🔍 $BTC — STRONG_WATCH

WHY NOW
• Health improved by 5.2 points in the latest refresh.
• Signal upgraded to STRONG_WATCH.
• Trend and volume are confirming each other.

Key facts:
• Health improving significantly (+5.2)
• Signal: STRONG_WATCH
• Strong bullish trend
• Volume above average
• Confidence: 80%

📍 Setup:
Entry: 50000.0000–51000.0000
TP: 52500.0000
TP: 55000.0000
SL: 49000.0000

INVALIDATION
Setup invalidates if price breaks below 49000.0000 with sustained weakness.

⚠️ This is data-driven analysis, not financial advice. Always do your own research.
```

### Narrative Post (template fallback output)
```
📊 $FET — Health Signal

WHY NOW
• Narrative health improved by 4.5 points in the latest refresh.
• 3 leading coins are participating in this move.

Key facts:
• Narrative health improving (+4.5)
• Leader: $FET
• 3 coins in narrative
• Avg confidence: 80%

Leading coins:
$FET
$RENDER
$TAO

INVALIDATION
Narrative thesis weakens if FET loses its current signal posture.

⚠️ This is data-driven analysis, not financial advice. Always do your own research.
```

## 6. Gap Summary

| Gap | Classification | Evidence |
|---|---|---|
| Narrative invalidation uses placeholder coin signals | B | `buildContentBrief` line 919-945: hardcoded `signal: "OBSERVE"` |
| Narrative posts lack per-coin selection rationale | B | No "FET selected because..." explanation |
| LLM prompt says "under 500 characters" but template produces 500+ | B | `content-generator.ts` line 90 vs `brief.text` length |
| Narrative posts omit leader coin Entry/TP/SL when available | B | Master spec §5.2 allows coin-specific levels |
| Entry/TP/SL not regime-adaptive | C | Fixed ATR multiples |
| No price change percentage | C | Not in brief or rationale |
| Technical jargon without plain-English | C | RSI, ATR, funding rate unexplained |
| No comparative context between opportunities | C | Same rationale templates |
