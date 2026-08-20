# SQ-08 — End-to-End Verification

**Project:** NarrativeHealth  
**Upgrade:** Binance Square Content & Monetization  
**Status:** SOURCE VERIFIED — REAL API PENDING  
**Master spec:** `docs/Binance_Square_Upgrade/BINANCE_SQUARE_MASTER_SPECIFICATION.md`

---

## 1. Verification Scope

Verified the complete Square pipeline from data collection to content generation:

```
Data refresh completes
    ↓
Square pipeline fires (non-blocking)
    ↓
Opportunity evaluation (quality gates + scoring)
    ↓
Content brief generation (Entry/TP/SL)
    ↓
Content generation (LLM + template fallback)
    ↓
Publication (Binance Square API)
    ↓
Persistence (PostgreSQL)
```

---

## 2. Source-Level Verification

### A. Opportunity Detection Engine

| Gate | Status | Evidence |
|---|---|---|
| Quality gates implemented | ✅ | `opportunity-engine.ts` lines 220-260 |
| Data freshness check | ✅ | `maxDataAgeHours` configurable (default 6h) |
| Confidence threshold | ✅ | `minConfidenceScore` configurable (default 50) |
| Data quality assessment | ✅ | HIGH/MEDIUM/LOW based on price, volume, indicators |
| Health change threshold | ✅ | `minHealthScoreChange` configurable (default 3) |
| Scoring weights sum to 1.0 | ✅ | Test verifies sum ≈ 1.0 |

### B. Entry/TP/SL Calculation

| Level | Formula | Source |
|---|---|---|
| Entry zone | price ± 0.5 × ATR_14 | `indicators.ATR_14` |
| TP1 | entry_high + 1.5 × ATR_14 | Calculated |
| TP2 | entry_high + 3.0 × ATR_14 | Calculated |
| SL | entry_low - 1.0 × ATR_14 | Calculated |

**No fabricated prices** — all levels derived from existing indicator data.

### C. Content Generation

| Path | Status | Evidence |
|---|---|---|
| LLM path (Google Gemini) | ✅ | `content-generator.ts` — API call + validation |
| Template fallback | ✅ | Deterministic from brief text |
| Forbidden term scan | ✅ | BUY/SELL/LONG/SHORT/ORDER/EXECUTE rejected |
| Content length validation | ✅ | Max 2000 chars enforced |

### D. Publisher

| Check | Status | Evidence |
|---|---|---|
| Quota check before publish | ✅ | `publisher.ts` — `getQuotaStatus()` |
| Deduplication via fingerprint | ✅ | SHA-256 hash, 72h TTL |
| Binance API integration | ✅ | `post-text.mjs` skill script |
| Publication persistence | ✅ | `square_publications` table |
| Fingerprint persistence | ✅ | `square_fingerprints` table |
| Quota increment | ✅ | `square_quota_log` table |

### E. Scheduler Integration

| Check | Status | Evidence |
|---|---|---|
| Non-blocking hook | ✅ | Dynamic import, try/catch wrapped |
| After refresh completes | ✅ | After morning snapshot creation |
| Failure isolation | ✅ | Errors logged but don't affect refresh |

---

## 3. Test Results

| Suite | Tests | Result |
|---|---|---|
| Square opportunity engine | 14 | ✅ PASS |
| P5 regression | 287 | ✅ PASS |
| Typecheck | — | ✅ CLEAN |
| Combined | 301 | ✅ ALL PASS |

---

## 4. Database Schema Verification

| Table | Created | Indexed |
|---|---|---|
| `square_opportunities` | ✅ | status, type, subject, created |
| `square_publications` | ✅ | status, opportunity, fingerprint, published |
| `square_quota_log` | ✅ | date (unique) |
| `square_fingerprints` | ✅ | fingerprint, expires |

Migration: `drizzle/migrations/0022_add_square_tables.sql`

---

## 5. Frozen Boundary

| Component | Status |
|---|---|
| P5-03/04/05/09/10/11 | UNTOUCHED |
| P4 Decision Support | UNTOUCHED |
| P3 Intelligence | UNTOUCHED |
| Refresh pipeline | MODIFIED (non-blocking hook only) |
| Database schema | EXTENDED (new tables only) |

---

## 6. Real API Verification

**Status: PENDING — ENVIRONMENT BLOCKER**

Real Binance Square API posting requires:
1. `BINANCE_SQUARE_OPENAPI_KEY` — not available in sandbox
2. Binance Square posting scripts — need to install from skill
3. Google API key for LLM — not available in sandbox

**What can be verified in sandbox:**
- ✅ All source code compiles
- ✅ All tests pass
- ✅ Opportunity evaluation logic
- ✅ Content generation (template path)
- ✅ Database schema
- ✅ Integration wiring

**What requires real environment:**
- ❌ Actual Binance Square API posting
- ❌ Quota enforcement against real API
- ❌ Fingerprint deduplication across real posts
- ❌ LLM content generation with real API key

---

## 7. Remaining Items

| Item | Status | Blocking? |
|---|---|---|
| Install Binance Square skill scripts | PENDING | Yes for real API |
| Set `BINANCE_SQUARE_OPENAPI_KEY` | PENDING | Yes for real API |
| Set `GOOGLE_API_KEY` | PENDING | No (template fallback works) |
| Run real post test | PENDING | Yes for SQ-FINAL |
| Observability dashboard | FUTURE | No |

---

**SQ-08 Verification: SOURCE VERIFIED — REAL API PENDING**
