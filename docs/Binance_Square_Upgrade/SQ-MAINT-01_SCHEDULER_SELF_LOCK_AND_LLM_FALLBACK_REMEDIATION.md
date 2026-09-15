# SQ-MAINT-01 — Scheduler Self-Lock, React Compliance & LLM Fallback Diagnostics

**Date:** 2026-09-15
**Type:** Maintenance / Remediation
**Status:** Implemented (code-level fixes verified via typecheck + unit tests; production behavior pending next scheduled cycle)

---

## 1. Summary

Three independent issues were investigated and fixed in one maintenance session:

1. **Scheduled refresh never published to Binance Square** (only Manual Refresh did).
2. **React anti-patterns** flagged by ESLint in 2 files (18 errors).
3. **All Binance Square posts used the template fallback** — LLM never participated, and the reason was invisible because every fallback path failed silently.

---

## 2. Issue 1 — Scheduler Self-Lock (no Square publishing on scheduled refresh)

### 2.1 Symptom

- Manual Refresh (UI) → posts published to Binance Square ✅
- Scheduler Refresh (cron) → data refreshed but **no Square post ever published** ❌

### 2.2 Root Cause

The Python scheduler (`backend/scheduler.py`) **pre-inserts** a `SchedulerLog(job_name='daily_refresh', status='STARTED')` row into the database *before* POSTing to the Next.js refresh endpoint with the same `jobName`.

The Next.js route (`src/app/api/refresh/route.ts`) runs `checkRefreshLock(jobName)` which treats any non-stale `STARTED` log with a matching `job_name` as "a refresh is already in progress" → **HTTP 409**.

The scheduler interprets the 409 as primary failure and falls back to the FastAPI endpoint (`backend/api/refresh.py`), which refreshes data but **does not contain the Square pipeline** (`runSquarePipeline` only exists in the Next.js route).

Result: every scheduled run self-locked, silently downgraded to the FastAPI path, and Square publishing never ran.

### 2.3 Fix

`backend/scheduler.py` — the wrapper log now uses a distinct job name (`{job_id}_trigger`, e.g. `daily_refresh_trigger`) so it can never collide with the Next.js refresh lock check. The scheduler now consistently executes the primary Next.js path, which includes the Square pipeline.

### 2.4 Verification

- Next scheduled cycle should produce `scheduler_logs` rows with `job_name = 'daily_refresh_trigger'` (COMPLETED) and Next.js logs containing `[SQ-PIPELINE] evaluated=... published=...`.
- No migration or DB change required.

---

## 3. Issue 2 — React Anti-Patterns (ESLint errors)

### 3.1 `src/components/P4DecisionSupportPanel.tsx` (16 errors)

The `EvidenceReferenceRow` component named its prop `ref`, colliding with React's special `ref` prop and triggering `react-hooks/refs` ("Cannot access refs during render").

**Fix:** prop renamed to `evidence`; call site updated. Render logic unchanged.

### 3.2 `src/app/coin/[id]/page.tsx` (2 errors)

`prevPriceRef.current` (a ref) was **read during render** to color the live price — a React rules violation that can render stale values.

**Fix:** replaced with a single state object `{ current, previous }` adjusted conditionally during render (the React-endorsed "adjust state during render" pattern, satisfying `react-hooks/set-state-in-effect` as well). The old standalone `currentPriceColor` computation block was removed.

---

## 4. Issue 3 — Square Posts Always Template (LLM never used, silently)

### 4.1 Symptom

Analytics showed `llm_used = false` for all publications. No log ever explained why.

### 4.2 Root Cause

`generateWithLLM()` in `src/lib/square/content-generator.ts` had **three silent failure gates** — each returned `null` with zero logging:

| Gate | Condition | Consequence |
|---|---|---|
| 1 | `process.env.GOOGLE_API_KEY` missing | Every post, every cycle → template |
| 2 | Gemini HTTP non-2xx (invalid key, quota, blocked) | Silent fallback |
| 3 | Output fails `validateLLMOutput()` | Silent fallback |

Additionally, a **validator bug**: the forbidden-terms check used substring matching (`upper.includes("LONG")`), which rejected any output containing words like "along", "longer", "prolonged" — virtually guaranteed in analysis prose, causing mass false rejections even with a valid key.

### 4.3 Fixes

**`src/lib/square/content-generator.ts`:**
- Gate 1 → logs `[SQ-LLM] GOOGLE_API_KEY is not set — falling back to template.`
- Gate 2 → logs HTTP status + first 300 chars of the Gemini error body.
- Gate 3 → logs distinct messages for empty/blocked content vs. validation failure.
- Validator → whole-word regex: `\b(BUY|SELL|ORDER|EXECUTE)\b|\b(LONG|SHORT)(?!-?TERM)\b` (no longer matches "along"/"longer"; still blocks trade-advice terms; allows "long-term"/"short-term").

**`src/lib/square/production.ts`:**
- Pipeline-level warning when `GOOGLE_API_KEY` is absent: all content for the cycle will use template fallback.

### 4.4 Required Operator Action

Verify `GOOGLE_API_KEY` is set in the production environment (Settings → Environment / deploy env). This is the most probable root cause of the observed all-template behavior.

### 4.5 Spec Compliance

The fix preserves all invariants from `BINANCE_SQUARE_MASTER_SPECIFICATION.md`:
- LLM remains a phrasing layer only (never the source of truth) — §20.
- LLM failure triggers fallback, never blocks the scheduler — §18.
- Secrets remain env-only and are never logged — §19 (only key *presence* is checked/logged, never the value).

---

## 5. Verification Record

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ PASS (0 errors) |
| `eslint src/` | ✅ PASS (0 errors) |
| Jest `src/lib/square` | ✅ 69/69 executable tests PASS (2 suites skipped: sandbox lacks `DATABASE_URL`, pre-existing environment limitation, unrelated) |
| Python syntax (`backend/scheduler.py`) | ✅ PASS |

**Note:** Historical publications in `square_publications` with `llm_used = false` are unchanged; the fixes apply to posts generated after deployment.

---

## 6. Files Changed

| File | Change |
|---|---|
| `backend/scheduler.py` | Wrapper log job name → `{job_id}_trigger` (self-lock fix) |
| `src/app/coin/[id]/page.tsx` | Ref-read-in-render → conditional state-adjust-in-render |
| `src/components/P4DecisionSupportPanel.tsx` | `ref` prop → `evidence` prop |
| `src/lib/square/content-generator.ts` | Diagnostic logging on all LLM fallback paths; validator whole-word fix |
| `src/lib/square/production.ts` | Pipeline warning when LLM key missing |
