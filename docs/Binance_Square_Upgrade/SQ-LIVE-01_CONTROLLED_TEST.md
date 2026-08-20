# SQ-LIVE-01 — CONTROLLED TEST

## Status

**🔴 BLOCKED — Sandbox Environment Limitation**

Real posting cannot be executed from the sandbox environment. The following verification was performed at the source level.

## Phase B — Controlled Opportunity Test

### Production Path Verification

The production path is:

```
Refresh → evaluateOpportunities() → buildContentBrief() → generateContent() → publishContent()
```

| Step | Source Verified | Runtime Tested |
|---|---|---|
| `evaluateOpportunities()` | ✅ Quality gates, scoring, freshness | ❌ Requires real DB |
| `buildContentBrief()` | ✅ Content generation, chart validation | ✅ Unit tested (14 tests) |
| `generateContent()` | ✅ LLM + template fallback | ✅ Unit tested |
| `publishContent()` | ✅ Quota, dedup, Binance API | ❌ Requires real API key |
| `runSquarePipeline()` | ✅ Orchestration, error handling | ❌ Requires real DB |

### Opportunity Detection

Cannot verify from sandbox because:
- `evaluateOpportunities()` queries live database tables
- No active coin data available in test environment
- Quality gates depend on real health scores, confidence, data freshness

**Expected behavior in production:** 0..N opportunities based on data quality. If no opportunity qualifies, 0 posts is the correct outcome.

## Phase C — One-Post Controlled Publication

**Cannot execute from sandbox.**

Expected production behavior when opportunity exists:
1. `buildContentBrief()` generates content with cashtag
2. `resolveChartCoin()` validates chart coin
3. `generateContent()` produces text (template or LLM)
4. `publishContent()` checks quota → dedup → Binance API → record

### Content Verification (Source)

The content brief for a coin setup includes:

```
🔍 $BTC — STRONG_WATCH

Key facts:
• Health improving (+5.2)
• Signal: STRONG_WATCH
• Confidence: 80%

📍 Setup:
Entry: 50000.0000–51000.0000
TP: 52500.0000
SL: 49000.0000

⚠️ This is data-driven analysis, not financial advice.
```

| Content Element | Present | Source |
|---|---|---|
| Cashtag ($BTC) | ✅ | `buildContentBrief()` |
| Narrative context | ✅ | Rationale from opportunity |
| Analysis | ✅ | Health, signal, confidence |
| Entry | ✅ | `calculateSetupLevels()` |
| TP | ✅ | `calculateSetupLevels()` |
| SL | ✅ | `calculateSetupLevels()` |
| Disclaimer | ✅ | Template includes disclaimer |
| Chart widget | ✅ | Cashtag auto-detected by Binance |

## Phase D — Binance Verification

**Cannot verify from sandbox.** Requires real Binance API call and post visibility check.

## Phase E — Database Verification

**Cannot verify from sandbox.** Requires real database connection.

Expected publication record after successful post:

| Field | Expected Value |
|---|---|
| `status` | `PUBLISHED` |
| `externalPostId` | Binance post ID |
| `contentSnapshot.chartSymbol` | Normalized coin symbol |
| `contentSnapshot.chartMatchesSource` | `true` |
| `publishedAt` | Timestamp |
| `fingerprint` | Deterministic hash |
| `contentVersion` | `1.0.0` |

## Phase F — Deduplication Test

**Cannot execute from sandbox.** Source-verified:

- Fingerprint is deterministic (same input → same hash)
- `isDuplicate()` checks before publishing
- `recordFingerprint()` records after successful publish
- Same opportunity → same fingerprint → DUPLICATE error

## Phase G — Failure Safety

Source-verified (no runtime test needed):

| Failure | Expected Behavior | Source |
|---|---|---|
| Binance API failure | `status: "FAILED"` | `publishContent()` catch |
| API key missing | `error: "BINANCE_SQUARE_OPENAPI_KEY not set"` | `postText()` |
| LLM failure | Template fallback | `generateContent()` |
| DB failure | Caught in `try/catch` in `production.ts` | Pipeline error handler |
| Quality gate fail | Opportunity filtered out | `passesQualityGates()` |
| Quota exceeded | `errorCode: "QUOTA_EXCEEDED"` | `publishContent()` |
| Duplicate | `errorCode: "DUPLICATE"` | `publishContent()` |

## Phase H — Quota Verification

Source-verified:

- `dailyHardCap: 100` in `DEFAULT_SCORING_CONFIG`
- `getQuotaStatus()` counts today's `PUBLISHED` records
- `incrementQuota()` increments after successful publish
- `publishContent()` checks quota before API call
- 0..N posts per cycle supported

## Monetization Verification

Source-verified:

| Check | Result |
|---|---|
| Cashtag correctly generated | ✅ `$SYMBOL` from normalized `coinSymbol` |
| Chart widget via cashtag | ✅ Binance auto-detects `$BTC` → renders chart |
| Account ownership | ⚠️ Requires real API key to verify |
| Publisher ID saved | ✅ `externalPostId` in `square_publications` |

## Regression

| Suite | Result |
|---|---|
| Typecheck | ✅ CLEAN |
| Square tests | ✅ 61/61 PASS |
| P5 regression | ✅ 287/287 PASS |

## Git Boundary

| Boundary | Status |
|---|---|
| P4 untouched | ✅ |
| P5-03/04/05/07/08/09/10/11 untouched | ✅ |
| Square algorithm unchanged | ✅ |
| Only documentation created this task | ✅ |
