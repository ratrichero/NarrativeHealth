# P6-01E-D — Production Ingestion Wiring Hardening Audit

**Date:** 2026-08-26
**Task Type:** AUDIT ONLY — no semantic changes, no scope expansion, no redesign.
**Audited implementation:** P6-01E-C wiring (`src/lib/p6/ingestion/` + both refresh routes).
**Authority:** P6-01B, P6-01C, frozen P6-01D (FINAL `8b4e73e`), P6-01E-A recon (`1b381eb`), P6-01E-B decision contract (`e6c3fc3`) with frozen PD-E1…PD-E4.

---

## 1. Executive Summary

The P6-01E-C wiring is **conformant with every frozen decision and invariant audited**. The implementation is a thin, additive bridge: it constructs canonical kline observations in memory, delegates validation to the frozen D2 validator, persists through the frozen D3 latest-only upsert, and invokes the existing `market_price_daily` write unchanged immediately afterwards.

Key results:

- PD-E1…PD-E4: all four implemented exactly as frozen; no hidden interpretation found.
- Canonical identity is exact; OHLC group identity shared precisely across all four members.
- Failure boundary (classification ≠ infrastructure failure) is correctly enforced and tested.
- Existing ingestion writes are byte-for-byte unchanged (verified via diff: +12 additive lines per route).
- Idempotency/latest-only semantics hold; spot ≠ futures; distinct openTime = distinct observation.
- One **non-blocking performance risk** documented (per-row persistence volume vs `maxDuration=60`); no architecture change made per task instructions.
- Source scan found zero violations.
- Recommendation: **PASS WITH NON-BLOCKING FINDINGS**.

No blocking semantic violations were found. P6-01E FINAL/FROZEN declaration is left to the Planner, per task boundary.

## 2. PD-E1…PD-E4 Compliance

| Decision | Frozen requirement | Implementation evidence | Verdict |
|---|---|---|---|
| PD-E1 | Quality evaluation BEFORE existing DB write | Both routes call `evaluateKlineObservationQuality(...)` inside the kline loop immediately before the `db.insert(marketPriceDaily)` statement (`src/app/api/refresh/route.ts` kline loop; mirrored in `src/app/api/refresh/coin/[id]/route.ts`) | COMPLIANT |
| PD-E2 | Classification NEVER blocks ingestion | The hook returns normally for VALID/INVALID/MISSING/UNKNOWN; nothing inspects `quality_status` to gate any write. Proven by test "returns normally for a fully INVALID kline" — resolution succeeds and ingestion would proceed | COMPLIANT |
| PD-E3 | Kline-only V1 coverage | Hook evaluates exactly OPEN/HIGH/LOW/CLOSE/VOLUME/QUOTE_VOLUME. Grep confirms zero references to OPEN_INTEREST/FUNDING_RATE/MARKET_CAP/FDV/COINGECKO anywhere under `src/lib/p6/ingestion/`. Routes untouched outside the kline loop | COMPLIANT |
| PD-E4 | Additive timestamp surfacing only | `observedAt = new Date(kline.openTime)` — verbatim source epoch pass-through; collectors not modified at all (openTime already existed) | COMPLIANT |

Hidden interpretation check: none found. The hook adds no classification logic of its own (0 assignments to quality state in the module), no metric vocabulary extension, no timeframe invention (`DAILY` passed explicitly; vocabulary type-enforced).

## 3. Canonical Identity Audit

Every generated observation uses `(entity_id, metric, source, observed_at, timeframe)`:

| Property | Evidence |
|---|---|
| entity_id deterministic | `ctx.entityId` (= `coin.id`) applied to all 6 observations; test asserts `entityId === 42` on every call payload |
| source mapping deterministic | `toCanonicalSource()` is a total function over `{binance_spot→BINANCE_SPOT, binance_futures→BINANCE_FUTURES}`; unknown label throws rather than guessing (test covers both mappings + refusal) |
| metric vocabulary frozen | Only the six P6-01B kline metrics emitted; `Metric` type imported from frozen `quality/types.ts`; test asserts exact sorted metric list `[CLOSE,HIGH,LOW,OPEN,QUOTE_VOLUME,VOLUME]` |
| timeframe deterministic | Single `Timeframe` value from frozen vocabulary propagated identically to all members; test asserts `"4H"` on all four OHLC calls |
| openTime preserved | `new Date(kline.openTime)` used for every metric; test asserts equality with `new Date(VALID_KLINE.openTime)` on all 6 payloads |
| no collected_at substitution | Hook passes no `collectedAt` option → D4 defaults it to `null` (informational only); test asserts `collectedAt === null` on all payloads |
| no business_date substitution | No `getBusinessDate` reference in the hook; `klineDate` remains a separate legacy aggregation key computed only by the route for `market_price_daily.date` |
| no synthetic timestamp | Only timestamp constructed is from `kline.openTime`; `evaluatedAt` is D4's own evaluation metadata, never used as observed_at |

## 4. OHLC Group Audit

- All four members share EXACTLY one group identity: same `entity_id`, same canonical `source`, same `observed_at`, same `timeframe` — verified by test asserting all four fields identical across OPEN/HIGH/LOW/CLOSE payloads, plus group-level relational evidence (`OHLC_HIGH_GE_LOW` etc.) merged into each member's evidence array.
- Group construction happens in-memory from one `KlineData` object — no joins at all, therefore no approximate joins possible.
- UNKNOWN observed_at compatibility: the hook always supplies a KNOWN `observed_at` for klines (openTime exists in the Binance payload). If it were ever null/absent, the hook would construct `Invalid Date`, but structurally the code path passes `observed_at` straight into D2/D3 where the frozen NOT_EVALUABLE relational rule and NULL-slot persistence apply unchanged — compatible with P6-01D without modification. No new behavior was introduced for the UNKNOWN case (correctly out of V1 scope).

## 5. Failure Boundary Audit

QUALITY STATE ≠ INFRASTRUCTURE FAILURE — verified:

| Requirement | Evidence |
|---|---|
| INVALID does not block | Test: malformed kline resolves successfully; statuses contain INVALID; nothing thrown |
| UNKNOWN does not block | No code path inspects status; UNKNOWN classifications flow through `upsertQualityResult` like any other state |
| MISSING does not block | Test: null volume → MISSING persisted, execution continues |
| Persistence failure ≠ quality state | Test: rejected `upsertQualityResult` propagates the raw error (`"db connection refused"`); no try/catch in hook converts or wraps it |
| No silent swallow | Zero catch blocks in `kline-quality-hook.ts` |
| No invented retry | Test: first failing write stops the hook after exactly 1 attempt |

Propagation target verified against production structure:

- Global route: per-coin `try` (≈line 222) → per-coin `catch` (≈line 747) pushes `${coin.symbol}: <error>` into `errors[]` and proceeds to next coin. A hook infrastructure failure lands here — identical envelope to an existing market-write failure.
- Per-coin route: the price-save block sits inside the request-level `try` (line 109 → catch 696). A hook failure aborts the single-coin request exactly as a market-write failure does today. Parity preserved.

## 6. Existing Ingestion Compatibility

- `git diff` shows the two route files changed by **+12 lines each**: one import + one commented hook invocation. All insert/upsert values, conflict targets (`[coinId,date]` for `market_price_daily`, `[coinId,date,source]` for `coin_metrics`), `volume24h` logic, source-status delete+insert, indicator/feature/health/recommendation/narrative/snapshot chains: **untouched**.
- Conflict/update semantics unchanged; cross-source overwrite behavior on `(coinId,date)` is pre-existing (P6-01E-A G-4) and was correctly left alone.
- Scheduler/lock behavior untouched (`checkRefreshLock`, `scheduler_logs`, stale-lock timeout).
- Documented behavioral delta (expected, not a violation): a quality-persistence DB failure now aborts the remaining klines of that coin slightly EARLIER than before (before the current row's market write instead of during it). Blast radius is identical (same per-coin boundary); ordering shift only. This follows directly from frozen PD-E1 placement and is recorded as finding NB-2 below.

## 7. Idempotency Audit

Latest-only is enforced structurally by D3 `upsertQualityResult`: select-by-full-semantic-identity then UPDATE-or-INSERT (partial unique indexes back this; refresh lock prevents concurrent writers). Wiring adds no alternate identity that could fragment slots.

New regression tests added in this audit prove at the wiring layer:

1. **Repeated refresh of the same kline targets the exact same 6 identity slots** (two passes produce identical sorted identity tuples; set size 6 — no accidental duplicates).
2. **spot ≠ futures**: same kline values under both sources produce 12 distinct targeted rows spanning `{BINANCE_SPOT, BINANCE_FUTURES}`.
3. **different observed_at ≠ same observation**: two 4H candles differing only in openTime map to 2 distinct timestamps — never collapsed (contrast: legacy `(coinId,business_date)` key WOULD collapse these; the semantic identity does not).

## 8. Performance Observation

Per kline: **6 quality rows** (4 OHLC members + VOLUME + QUOTE_VOLUME), each requiring up to 2 DB operations in D3 (SELECT by identity + INSERT/UPDATE) → **~12 DB round-trips per kline**, executed sequentially ahead of the existing market write.

Scale estimate: 200 daily klines × N coins ⇒ ~2,400 quality DB operations per coin per refresh, on top of the pre-existing ~200 market writes. With sequential coins and `maxDuration = 60`, this materially pressures the global-refresh budget (consistent with P6-01E-A gap G-6).

**NON-BLOCKING PERFORMANCE RISK (NB-1):** per-row synchronous quality persistence may extend refresh duration significantly at production coin counts. Mitigation options (batching, per-coin bulk evaluation, latency measurement) are deliberately NOT implemented per task instruction ("Do NOT optimize yet"). Recommend the Planner schedule a measured load check before declaring P6-01E FINAL.

## 9. Test Adequacy

Reviewed `src/lib/p6/ingestion/__tests__/kline-quality-hook.test.ts`. Assessment: tests assert observable behavior (payloads sent to the persistence boundary, resolution/rejection outcomes, identity sets) rather than internal call graphs. Pre-existing coverage already proved: 6 observations/kline, openTime verbatim, collected_at null, exact OHLC shared identity + relational evidence merged, config version v1, malformed≠missing classification, INVALID non-blocking, persistence-failure propagation, no-retry.

Gaps identified and closed in this audit (minimal additions, no scope inflation): the three idempotency tests in §7. Total suite now 15 tests. Full run: **27 suites / 678 tests PASS** (`bun jest src/lib/p4 src/lib/p5 src/lib/p6`). Typecheck clean (`bun tsc --noEmit`). Note: full-repo `bun jest` was OOM-killed on the heavy P3 integration suites — pre-existing resource limitation, unrelated to wiring; targeted P4/P5/P6 regression covers all affected boundaries.

## 10. Source Scan

| Scan | Pattern | Result |
|---|---|---|
| collected_at as observed_at | grep hook + routes | NONE — collected_at only ever `null` (informational field) |
| business_date as observed_at | grep hook | NONE — `getBusinessDate` appears only in legacy route code for `market_price_daily.date` |
| freshness imports in hook | grep `freshness`/`stale_after` | NONE — quality/freshness separation intact |
| P4/P5 imports in hook | grep `@/lib/p4`, `@/lib/p5`, `features/engine`, `scoring/` | NONE |
| OI/FR/MC/FDV wiring | grep metric names + COINGECKO in `src/lib/p6/ingestion/` | NONE |
| duplicate validator logic | grep state assignment in hook | ZERO — hook contains no classification code, pure delegation to D2 |
| alternate observation identity | review | SINGLE construction site (one `observedAt`, one source mapping, one timeframe propagation) |

**Violations: NONE.**

## 11. P4/P5 Boundary

No file under P4/P5 contracts or implementation was modified (git diff limited to the two refresh routes + new `src/lib/p6/ingestion/` + audit doc). Downstream consumers read `market_price_daily`/`coin_metrics` exactly as before. P4/P5 regression suites green (§9). Feature-engine inputs, provenance objects, health/recommendation chains: unmodified.

## 12. Findings

| # | Severity | Finding |
|---|---|---|
| NB-1 | NON-BLOCKING / PERFORMANCE | Per-row quality persistence ≈12 DB ops per kline; refresh-budget pressure vs `maxDuration=60` at scale (§8). Measurement recommended before FINAL |
| NB-2 | NON-BLOCKING / DOCUMENTED DELTA | With PD-E1 pre-write placement, a quality-persistence infrastructure failure now aborts a coin's kline processing before the affected row's market write (ordering-only change; blast radius identical to today's market-write failures; §5–6) |
| NB-3 | NON-BLOCKING / OBSERVATION | Legacy `market_price_daily` conflict key excludes `source`; spot/futures still overwrite each other per business date while quality records preserve BOTH sources as distinct identities. Intentional divergence (frozen contracts forbid changing legacy keys); noted so future readers don't misread quality row counts vs legacy table counts |

Blocking issues requiring semantic change: none discovered.

## 13. Blocking Issues

**NONE.**

## 14. Non-Blocking Issues

See §12: NB-1 (performance risk), NB-2 (documented ordering delta), NB-3 (legacy-vs-semantic identity divergence note).

## 15. Recommendation

**PASS WITH NON-BLOCKING FINDINGS.**

The P6-01E-C implementation conforms to PD-E1…PD-E4, all audited frozen invariants, and preserves existing ingestion behavior within the documented deltas. NB-1 warrants a measured load check before the Planner considers declaring P6-01E FINAL/FROZEN. Per task boundary, FROZEN declaration is explicitly **not** made here.

## 16. Acceptance Checklist

- [x] PD-E1 verified: evaluation before existing DB write
- [x] PD-E2 verified: classification never blocks; persistence failure stays infrastructure
- [x] PD-E3 verified: kline-only scope, no snapshot metrics wired
- [x] PD-E4 verified: additive openTime surfacing only, no collector changes
- [x] Canonical identity exact on all generated observations
- [x] OHLC group identity exactly shared across OPEN/HIGH/LOW/CLOSE
- [x] No approximate joins introduced
- [x] Failure boundary tested (INVALID/MISSING non-blocking; throw-on-infrastructure; no retry; no swallow)
- [x] Existing DB writes unchanged (+12 additive lines per route)
- [x] Per-coin error envelope parity confirmed in both routes
- [x] Idempotency/latest-only regression tests added and passing
- [x] spot≠futures and distinct-openTime identity tests added and passing
- [x] Performance impact estimated and documented (no optimization performed)
- [x] Source scan: zero violations
- [x] P4/P5 files untouched; P4/P5 suites green
- [x] Git boundary respected: audit doc + minimal test hardening only
- [x] Frozen contracts unmodified
- [x] No FROZEN declaration made (deferred to Planner)
