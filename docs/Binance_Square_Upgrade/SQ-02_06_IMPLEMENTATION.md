# SQ-02/SQ-06 — Implementation Report

**Project:** NarrativeHealth  
**Upgrade:** Binance Square Content & Monetization  
**Document:** SQ-02/SQ-06 Implementation Report  
**Status:** IMPLEMENTED  
**Baseline:** P4-P5 frozen, P6 NOT STARTED  
**Master spec:** `docs/Binance_Square_Upgrade/BINANCE_SQUARE_MASTER_SPECIFICATION.md`

---

## 1. Summary

Implemented the core Binance Square content pipeline:

- **SQ-02:** Opportunity detection engine with quality gates and scoring
- **SQ-03:** Content brief builder with Entry/TP/SL calculation
- **SQ-05:** Binance Square publisher with deduplication and quota management
- **SQ-06:** Scheduler integration (post-refresh hook)

---

## 2. Files Created/Modified

### New files

| File | Purpose |
|---|---|
| `src/lib/square/opportunity-engine.ts` | Opportunity detection, quality gates, scoring, Entry/TP/SL, content brief |
| `src/lib/square/publisher.ts` | Binance Square API integration, deduplication, quota |
| `src/lib/square/production.ts` | Production wiring — post-refresh pipeline |
| `src/lib/square/__tests__/opportunity-engine.test.ts` | 14 unit tests |
| `drizzle/migrations/0022_add_square_tables.sql` | Database schema for Square |
| `docs/Binance_Square_Upgrade/SQ-01_RECON.md` | Recon document |

### Modified files

| File | Change |
|---|---|
| `src/db/schema.ts` | Added Square tables (opportunities, publications, quotas, fingerprints) |
| `src/app/api/refresh/route.ts` | Added post-refresh Square pipeline hook |

---

## 3. Architecture

```text
Refresh completes
    ↓
Square Pipeline (non-blocking)
    ↓
┌─────────────────────────────────────┐
│ 1. Check quota                      │
│ 2. Evaluate opportunities           │
│ 3. Persist opportunities            │
│ 4. Publish top N (respecting cap)   │
└─────────────────────────────────────┘
    ↓
Binance Square API
    ↓
Publication record + fingerprint
```

### Key design decisions

1. **Non-blocking side effect:** Square pipeline fires AFTER refresh completes. Failure does NOT affect refresh status.
2. **Quota-first:** Checks daily quota before evaluation.
3. **Deterministic scoring:** All scoring uses existing P4/P5 data — no hidden thresholds.
4. **Entry/TP/SL from ATR:** Uses existing `indicators.ATR_14` for defensible price levels.
5. **Deduplication via fingerprint:** SHA-256 hash of type + subject + date prevents duplicate posts.

---

## 4. Opportunity Detection Engine

### Quality gates

| Gate | Condition | Purpose |
|---|---|---|
| Data freshness | ≤ 6 hours since refresh | Avoid stale data |
| Confidence | ≥ 50% | Minimum data quality |
| Data quality | Not LOW | Price, volume, indicators present |
| Health change | ≥ 3 points | Meaningful momentum signal |

### Scoring weights

| Component | Weight | Source |
|---|---|---|
| Data quality | 0.20 | Confidence + completeness |
| Health momentum | 0.25 | Score change magnitude |
| Signal alignment | 0.20 | STRONG_WATCH/WEAK = high |
| Volume confirmation | 0.15 | Volume score + 24h volume |
| Trend strength | 0.15 | Trend + momentum scores |
| Novelty bonus | 0.05 | Score change magnitude |

### Entry/TP/SL calculation

```
Entry zone:     current_price ± 0.5 × ATR_14
TP1:            entry_high + 1.5 × ATR_14
TP2:            entry_high + 3.0 × ATR_14
SL:             entry_low - 1.0 × ATR_14
```

All levels derived from existing `indicators.ATR_14` — no fabricated prices.

---

## 5. Content Brief Builder

Generates structured content from opportunity data:

```text
🔍 $BTC — STRONG_WATCH

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

⚠️ This is data-driven analysis, not financial advice.
```

---

## 6. Publisher

### Authentication

```env
BINANCE_SQUARE_OPENAPI_KEY=...
```

### Posting flow

1. Check quota → reject if exhausted
2. Generate fingerprint → reject if duplicate
3. Call `post-text.mjs` via skill scripts
4. Record publication in `square_publications`
5. Record fingerprint in `square_fingerprints`
6. Increment daily quota

### Deduplication

Fingerprint = SHA-256(type + subjectId + coinSymbol + narrativeId + entryLevel + dataAsOf)

TTL: 72 hours (configurable).

---

## 7. Database Schema

### New tables

| Table | Purpose |
|---|---|
| `square_opportunities` | Detected publishing opportunities |
| `square_publications` | Published posts with status tracking |
| `square_quota_log` | Daily usage tracking |
| `square_fingerprints` | Deduplication fingerprints |

---

## 8. Scheduler Integration

### Hook point

Added to `src/app/api/refresh/route.ts` after morning snapshot creation:

```typescript
// Binance Square content pipeline (non-blocking side effect)
try {
  const { runSquarePipeline } = await import("@/lib/square/production");
  const squareResult = await runSquarePipeline();
  console.log(`Square pipeline: evaluated=${squareResult.evaluated} ...`);
} catch (squareError) {
  console.error("Square pipeline error (non-blocking):", squareError);
}
```

### Isolation guarantee

- Square pipeline failure does NOT affect refresh success/failure
- Square pipeline runs after all refresh steps complete
- Square pipeline has its own error handling and logging

---

## 9. Test Results

| Suite | Result |
|---|---|
| Square opportunity engine | 14/14 PASS |
| P5 regression | 287/287 PASS |
| Typecheck | CLEAN |
| Combined | 301/301 PASS |

---

## 10. Remaining Tasks

| Task | Status |
|---|---|
| SQ-04: LLM + Template Fallback | NOT STARTED |
| SQ-07: Publication Store & Observability | PARTIAL (schema done) |
| SQ-08: End-to-End Verification | NOT STARTED |
| SQ-FINAL: Monetization Baseline | NOT STARTED |

---

## 11. Frozen Boundary

| Boundary | Status |
|---|---|
| P5-03/04/05/09/10/11 | UNTOUCHED |
| P4 Decision Support | UNTOUCHED |
| P3 Intelligence | UNTOUCHED |
| Refresh pipeline | MODIFIED (non-blocking hook only) |
| Database schema | EXTENDED (new tables only) |

---

**SQ-02/SQ-06 Implementation: COMPLETE**
