# SQ-VERIFY-01 — Recon

**Project:** NarrativeHealth  
**Upgrade:** Binance Square Content & Monetization  
**Document:** SQ-VERIFY-01 Recon  
**Status:** RECON COMPLETE  
**Master spec:** `docs/Binance_Square_Upgrade/BINANCE_SQUARE_MASTER_SPECIFICATION.md`

---

## 1. Source Files Audited

| File | Lines | Purpose |
|---|---|---|
| `src/lib/square/opportunity-engine.ts` | ~755 | Quality gates, scoring, Entry/TP/SL, content brief |
| `src/lib/square/publisher.ts` | ~295 | Binance API, deduplication, quota |
| `src/lib/square/content-generator.ts` | ~170 | LLM + template fallback |
| `src/lib/square/production.ts` | ~110 | Post-refresh pipeline wiring |
| `src/app/api/refresh/route.ts` | ~1041 | Square hook integration |
| `src/db/schema.ts` | ~600 | Square tables |
| `drizzle/migrations/0022_add_square_tables.sql` | ~65 | DB migration |
| `src/lib/square/__tests__/opportunity-engine.test.ts` | ~180 | 14 unit tests |

---

## 2. Opportunity Score vs Trading Score — Boundary Audit

**User concern:** Is `OpportunityScore` accidentally a trading score?

### Source evidence

The `calculateOpportunityScore()` function (opportunity-engine.ts ~line 290-330) computes:

```
total = qualityScore * 0.20
      + momentumScore * 0.25
      + signalScore * 0.20
      + volumeScore * 0.15
      + trendScore * 0.15
      + noveltyScore * 0.05
```

**Components:**
- `qualityScore` — data completeness (price/volume/indicators present)
- `momentumScore` — health score change magnitude (|Δscore| × 10 + 20)
- `signalScore` — maps STRONG_WATCH=90, WEAK=85, WATCH=70, OBSERVE=40
- `volumeScore` — volume score + 24h volume presence
- `trendScore` — average of trend + momentum scores
- `noveltyScore` — change magnitude × 15

**Verdict:** This is a **publishing-quality score** (how interesting is this for Square content), NOT a trading score. It determines "should we write about this?" not "should we trade this?"

### Entry/TP/SL boundary

The `calculateSetupLevels()` function (~line 335-370) is **completely separate** from scoring:

```
data → calculateSetupLevels(coin)
  ↓
if price ≤ 0 or ATR null → return null (no setup)
  ↓
Entry = price ± 0.5 × ATR_14
TP1 = entry_high + 1.5 × ATR_14
TP2 = entry_high + 3.0 × ATR_14
SL = entry_low - 1.0 × ATR_14
```

**Key facts:**
- Entry/TP/SL is only called AFTER opportunity passes quality gates
- Entry/TP/SL does NOT influence the opportunity score
- Entry/TP/SL uses ONLY `currentPrice` and `ATR_14` from indicators table
- If ATR is null, no setup is generated (returns null)
- Precision: 4 decimal places via `Math.round(x * 10000) / 10000`

**Boundary assessment:** The two concerns (opportunity selection vs setup levels) are in the same file but are **semantically clean** — they don't influence each other. The Master Spec separation is maintained at the function level.

---

## 3. LLM Boundary Audit

### What LLM receives (content-generator.ts)

The `buildLLMPrompt()` function constructs a prompt from:
- `brief.cashtags` — e.g. `["$BTC"]`
- Extracted lines from `brief.text` starting with `• `, `Entry:`, `TP:`, `SL:`

The prompt explicitly instructs:
```
RULES:
- Use ONLY the facts provided below
- Do NOT invent any price, volume, trend, or data
- Do NOT change Entry/TP/SL levels
```

### What LLM cannot do

The `validateLLMOutput()` function rejects:
- Text < 20 chars or > 2000 chars
- Any text containing BUY, SELL, LONG, SHORT, ORDER, EXECUTE

### What LLM CAN still do (gap)

The validation checks forbidden terms but does NOT verify:
- That Entry/TP/SL values in the output match the input brief
- That the narrative/signal claims match the input facts
- That no invented price/level appears

**Risk:** LLM could theoretically output "Entry: 1.5000" when the brief says "Entry: 1.2000–1.2500" — the validator wouldn't catch this.

### Fallback behavior

| Failure mode | Behavior |
|---|---|
| `GOOGLE_API_KEY` missing | `generateWithLLM()` returns null → template fallback |
| `GOOGLE_API_KEY` invalid | API returns 400/401 → returns null → template |
| Timeout (15s) | AbortSignal catches → returns null → template |
| Rate limit | API returns 429 → returns null → template |
| Malformed response | Null check on `candidates[0].content.parts[0].text` → template |
| Forbidden terms in output | `validateLLMOutput()` returns null → template |

**All failure paths reach template fallback.** ✅

---

## 4. Scheduler Integration Audit

### Hook location (refresh/route.ts lines 1000-1015)

```typescript
// After morning snapshot creation, before return statement
try {
  const { runSquarePipeline } = await import("@/lib/square/production");
  const squareResult = await runSquarePipeline();
  console.log(`Square pipeline: ...`);
} catch (squareError) {
  console.error("Square pipeline error (non-blocking):", squareError);
}
return NextResponse.json({ success: true, ... });
```

### Verification

| Check | Evidence | Result |
|---|---|---|
| After refresh success | Lines 998-1015, after snapshot creation | ✅ |
| Non-blocking | try/catch, errors logged but don't affect response | ✅ |
| No duplicate invocation | Dynamic import only fires once per POST | ✅ |
| Retry safe | Square runs after refresh response is about to be sent | ✅ |
| Multiple opportunities | production.ts iterates `toPublish` array | ✅ |

---

## 5. Binance API Audit

### Authentication

```typescript
const apiKey = process.env.BINANCE_SQUARE_OPENAPI_KEY;
if (!apiKey) {
  return { success: false, error: "BINANCE_SQUARE_OPENAPI_KEY not set" };
}
```

Key is passed via `env` option to `execAsync`, never as CLI argument. ✅

### API contract

| Aspect | Implementation | Skill Contract |
|---|---|---|
| Script | `node scripts/post-text.mjs` | Matches skill docs |
| Flags | `--text`, `--title` | Matches skill docs |
| Working dir | `SQUARE_SKILL_DIR` (node_modules path) | Needs installation |
| Timeout | 30000ms | Acceptable |
| Response parsing | Regex for `ID:\s*(\S+)` and `Link:\s*(\S+)` | Matches skill output format |
| Success detection | `stdout.includes("Success")` | Matches skill docs |

### Gaps identified

| Gap | Severity | Notes |
|---|---|---|
| No retry logic | MEDIUM | Single attempt, no exponential backoff |
| No error code classification | MEDIUM | All errors treated as generic |
| No chart widget integration | LOW | Skill supports it, not implemented |
| No image post support | LOW | Only text posts |
| Skill directory may not exist | HIGH | `node_modules/@anthropic/skills/binance/square-post` must be installed |

---

## 6. Quota Audit

### Daily hard cap

```typescript
const dailyHardCap = 100;
// ...
if (quota.postsRemaining <= 0) {
  return { success: false, errorCode: "QUOTA_EXCEEDED" };
}
```

### Per-cycle soft cap

```typescript
const softCap = DEFAULT_SCORING_CONFIG.dailySoftCap; // 10
const toPublish = persistedOpps
  .sort((a, b) => b.score - a.score)
  .slice(0, Math.min(softCap, quota.postsRemaining));
```

### Concurrent safety

```typescript
// incrementQuota uses SQL upsert:
await db.insert(squareQuotaLog)
  .values({ date: today, postsPublished: 1 })
  .onConflictDoUpdate({
    target: [squareQuotaLog.date],
    set: { postsPublished: sql`${squareQuotaLog.postsPublished} + 1` }
  });
```

The SQL `+ 1` is atomic — concurrent refreshes won't exceed the cap. ✅

---

## 7. Deduplication Audit

### Fingerprint generation

```typescript
function generateFingerprint(type, subjectId, coinSymbol, narrativeId, entryLevel, dataAsOf) {
  const components = [type, subjectId, coinSymbol || "", narrativeId || "", entryLevel || "", dataAsOf];
  return createHash("sha256").update(components.join("|")).digest("hex").slice(0, 64);
}
```

### Fingerprint check

```typescript
export async function isDuplicate(fingerprint: string): Promise<boolean> {
  const [existing] = await db.select().from(squareFingerprints)
    .where(and(
      eq(squareFingerprints.fingerprint, fingerprint),
      gte(squareFingerprints.expiresAt, now)
    )).limit(1);
  return !!existing;
}
```

**Issue:** The fingerprint in `publishContent()` is generated with `entryLevel: null`:

```typescript
const fingerprint = generateFingerprint("TEXT", opportunityId, null, null, null, today);
```

This means two different opportunities with the same `opportunityId` and same date would have the same fingerprint — which is actually correct for idempotency (same opportunity shouldn't be published twice).

**However:** Two different opportunities with different Entry/TP/SL but same date would NOT be distinguished by fingerprint if they happen to share the same opportunityId (which they won't since each opportunity gets a unique DB id).

**Verdict:** Deduplication is correct for the current architecture. ✅

---

## 8. Database Audit

### Migration 0022

| Table | Indexes | Constraints |
|---|---|---|
| `square_opportunities` | status, type, subject, created | None |
| `square_publications` | status, opportunity, fingerprint, published | fingerprint UNIQUE |
| `square_quota_log` | date | date UNIQUE |
| `square_fingerprints` | fingerprint, expires | fingerprint UNIQUE |

### Gap: No foreign key from publications to opportunities

`square_publications.opportunity_id` references `square_opportunities.id` but the migration doesn't add `REFERENCES`. The schema.ts does add `.references(() => squareOpportunities.id)` but the SQL migration doesn't enforce it at DB level.

**Severity:** LOW — application-level integrity is maintained.

---

## 9. Publication Lifecycle Audit

### Current states

```
square_opportunities.status: CANDIDATE → PUBLISHED
square_publications.status: FAILED | PUBLISHED
```

### Missing states from Master Spec

| Expected | Actual | Gap |
|---|---|---|
| CANDIDATE | ✅ CANDIDATE | — |
| GENERATED | ❌ Missing | Content generated but not yet published |
| VALIDATED | ❌ Missing | Content validated but not yet sent |
| PUBLISHED | ✅ PUBLISHED | — |
| FAILED | ✅ FAILED | — |
| SUPPRESSED | ❌ Missing (in publications) | Quota/dedup suppression not recorded as publication status |

### Error classification

| Error | Code | Recorded? |
|---|---|---|
| QUOTA_EXCEEDED | ✅ errorCode | ✅ |
| DUPLICATE | ✅ errorCode | ✅ |
| BINANCE_FAILED | ❌ Generic error | ⚠️ All API errors use `error` field, not classified |
| LLM_FAILED | ❌ Not applicable | LLM never fails to publish (template fallback) |
| VALIDATION_FAILED | ❌ Not applicable | Validation happens before publish |

---

## 10. Security Audit

| Check | Result | Evidence |
|---|---|---|
| `BINANCE_SQUARE_OPENAPI_KEY` server-only | ✅ | `process.env` in server route only |
| `GOOGLE_API_KEY` server-only | ✅ | `process.env` in content-generator (server) |
| Key not in CLI args | ✅ | Passed via `env` option to `execAsync` |
| Key not in logs | ⚠️ | Error messages from Binance API could contain key in response — need to verify |
| Key not in DB | ✅ | `square_publications` stores content/keywords, not API keys |
| Key not in client bundle | ✅ | All Square code is server-side only |
| Key not in API responses | ✅ | Square endpoints return only publication status |
