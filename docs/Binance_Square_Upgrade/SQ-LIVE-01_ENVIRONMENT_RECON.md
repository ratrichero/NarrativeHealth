# SQ-LIVE-01 — ENVIRONMENT RECON

## Phase A — Environment Verification

### A1: BINANCE_SQUARE_OPENAPI_KEY

| Check | Result |
|---|---|
| Key declared by operator | ✅ User confirmed |
| Key accessible in sandbox | ❌ BLOCKED — sandbox env access restricted |
| Key accessible in production runtime | ⚠️ CANNOT VERIFY — sandbox cannot invoke production runtime |
| Key server-side only | ✅ Source verified — only accessed in `publisher.ts` via `process.env` |
| Key not in source code | ✅ Only referenced as `process.env.BINANCE_SQUARE_OPENAPI_KEY` |
| Key not in API responses | ✅ No API endpoint returns key |
| Key not in client bundle | ✅ Publisher is server-only (API route) |

**Classification:** Operator-confirmed, source-verified. Sandbox cannot runtime-verify.

### A2: GOOGLE_API_KEY (Optional LLM)

| Check | Result |
|---|---|
| Key declared | ❌ NOT SET in sandbox |
| Template fallback mode | ✅ `generateContent()` falls back to template when key missing |
| LLM boundary | ✅ `validateLLMOutput()` validates + rejects invalid output |
| Fallback path verified | ✅ `generateFromBrief()` always available |

**Classification:** Template fallback mode. LLM is optional enhancement.

### A3: Database Migration

| Check | Result |
|---|---|
| `0022_add_square_tables.sql` exists | ✅ Source verified |
| Schema tables defined | ✅ `square_opportunities`, `square_publications`, `square_quota_log`, `square_fingerprints` |
| Drizzle schema updated | ✅ `src/db/schema.ts` includes all Square tables |
| Migration idempotent | ✅ `CREATE TABLE IF NOT EXISTS` |

**Classification:** Migration exists in source. Runtime DB application cannot be verified from sandbox.

## Pipeline Architecture Verification

### Refresh → Square Pipeline

```
POST /api/refresh
    ↓
refresh completes (P3/P4/P5)
    ↓
try { runSquarePipeline() } catch { /* non-blocking */ }
    ↓
evaluateOpportunities()
    ↓
0..N qualified candidates
    ↓
buildContentBrief() + resolveChartCoin()
    ↓
generateContent() [LLM or template]
    ↓
publishContent() → Binance API
    ↓
record in square_publications
```

### Key Safety Properties Verified

| Property | Source Evidence |
|---|---|
| Square failure doesn't break refresh | ✅ `try/catch` wrapper in `refresh/route.ts` |
| Non-blocking | ✅ `import("@/lib/square/production")` dynamic import |
| Quota checked before post | ✅ `getQuotaStatus()` in `publishContent()` |
| Dedup checked before post | ✅ `isDuplicate(fingerprint)` in `publishContent()` |
| Status only set after Binance confirms | ✅ `status: result.success ? "PUBLISHED" : "FAILED"` |
| API key never logged | ✅ `console.log("[SQUARE] ...")` — no key in logs |
| API key never in DB | ✅ `square_publications` has no `apiKey` column |
| Entry/TP/SL independent of chart | ✅ `calculateSetupLevels()` is pure function |

## Blocker

**SANDBOX ENVIRONMENT LIMITATION:**

The sandbox environment blocks:
1. Direct `process.env` access (security restriction)
2. Database connections (mocked in tests)
3. Binance Square skill scripts (not installed)
4. Real API calls to Binance

**This does NOT indicate a code defect.** The code is source-verified correct. Real posting requires the production/preview runtime where `BINANCE_SQUARE_OPENAPI_KEY` is accessible.

## Recommendation

To complete real posting verification, the operator should:
1. Trigger a data refresh via the production/preview endpoint
2. Monitor the `Square pipeline:` log output
3. Verify the post on Binance Square manually
4. Check the `square_publications` table for the publication record
