# P6-SEMANTIC-04 — P6 Narrative Market-Cap Aggregation Repair

**Date:** 2026-09-01
**Commit:** (pending)
**File changed:** `src/lib/p6/snapshot/service.ts`

---

## 1. Executive Summary

Repaired the P6 narrative snapshot aggregation by wiring `market_cap` from the `coin_metrics` table into the narrative member assembly in `service.ts`. Previously, `market_cap` was hardcoded to `null`, causing all narrative members to be excluded from weighted aggregation and all narratives to receive `SNAPSHOT_NEUTRAL_SCORE = 50`.

**Simulation result:** AI narrative health changes from 50 → 47.29 with real market-cap weighting.

---

## 2. Root Cause

`src/lib/p6/snapshot/service.ts` lines 108 and 118 hardcoded `market_cap: null` in both branches of the narrative member assembly. The `computeNarrativeHealthScore()` function filters out members with null market_cap, resulting in zero usable members and a fallback to 50.

---

## 3. Market Cap Data Provenance

| Source | Table | Column | Coverage |
|--------|-------|--------|----------|
| CoinGecko API | `coin_metrics` | `market_cap` | 49 coins, 19-44 records per coin in last 30 days |

All 49 active coins have market_cap data for 2026-09-01. No coins are missing.

---

## 4. Temporal Semantics

**Selected approach:** Latest available `market_cap` at or before snapshot date.

For a narrative snapshot at date T, query `coin_metrics WHERE date ≤ T ORDER BY date DESC LIMIT 1` per coin. This ensures:
- No future data leakage (only uses data available at or before snapshot time)
- Backward compatibility with historical snapshots
- Deterministic behavior (same input → same output)

---

## 5. Production Coverage

| Narrative | Members | With Market Cap | Coverage |
|-----------|---------|-----------------|----------|
| N1 (AI) | 7 | 7 | 100% |
| N2 (RWA) | 8 | 8 | 100% |
| N3 (TOPMC) | 7 | 7 | 100% |
| N4 (FAVORITE) | 4 | 4 | 100% |
| N6 (RESTAKING) | 6 | 6 | 100% |
| N7–N10 | 5–6 each | All | 100% |

---

## 6. Implementation

**Single file changed:** `src/lib/p6/snapshot/service.ts`

**Changes:**
1. Added imports: `db`, `coinMetrics`, `eq`, `and`, `lte`, `desc`
2. Added market_cap query before narrative member assembly
3. Replaced hardcoded `market_cap: null` with `market_cap: marketCapMap.get(m.coin_id) ?? null`

**No other files changed.** No schema changes. No migrations. No contract changes.

---

## 7. Missing Data Handling

Per existing P6 contract (PD-03B-12):
- Members with `market_cap = null` or `market_cap ≤ 0` are excluded from weighted aggregation
- Members without snapshots still get `health_score = 50` but are weighted by their market_cap if available
- If all members lack market_cap, the fallback to `SNAPSHOT_NEUTRAL_SCORE = 50` is preserved

---

## 8. Future Leakage Audit

The query uses `lte(coinMetrics.date, snapshotDate)` — only data at or before the snapshot date is used. No future information is accessed. Deterministic: same snapshot date → same market_cap values.

---

## 9. Before/After Quantitative Results

### Before (hardcoded null)
- Narrative health: 50 for all 9 narratives
- Narrative regime: STABLE for all 9 narratives
- Narrative warnings: 0 for all

### After (simulation with real data)
- AI narrative health: 47.29 (was 50)
- Coin health range: 31.38–57.88 (unchanged — coin snapshots unaffected)
- Market-cap weights: RENDER ($753M) and FET ($355M) dominate AI narrative

### Coin Snapshot Impact
- **None.** Coin snapshot generation is completely independent of the narrative aggregation fix.
- Coin health scores remain unchanged (25.88–79.38).

---

## 10. P6 Health Impact

After the next refresh with this fix applied:
- Narrative health will reflect actual coin health weighted by market cap
- High-cap healthy coins will pull narrative health up
- Low-cap weak coins will have minimal impact
- Narratives with mixed coin health will show differentiated scores

---

## 11. P6 Regime Impact

After repair:
- Narratives with weighted health > 60 → STRONG regime
- Narratives with weighted health 40–60 → STABLE regime
- Narratives with weighted health < 40 → WEAK regime
- P6 warnings will fire on regime transitions

---

## 12. Cross-Layer Impact

| Layer | Impact |
|-------|--------|
| P3 | None — P3 uses its own regime/rotation logic |
| P4 | None — P4 reads from P3, not P6 |
| P5 | None — P5 reads from P4 |
| P6 coin | None — coin snapshots unchanged |
| P6 narrative | **Fixed** — now uses real market-cap weighted health |
| P6 regime | **Will change** — regime now reflects actual narrative health |
| Indicators | None — indicators unaffected |

---

## 13. UI Impact

The P6IntelligencePanel already reads from the P6 narrative API. Once snapshots are regenerated with market_cap data, the UI will automatically display:
- Real health scores (not always 50)
- Varied regime states (not always STABLE)
- Warnings when regime changes occur

No UI code changes required.

---

## 14. Regression

- TypeScript: ✅ PASS
- P6 contract: ✅ Unchanged — market-cap weighting was the intended design
- P3/P4/P5: ✅ Unaffected
- Frozen boundaries: ✅ Preserved
- No schema/migration changes: ✅

---

## 15. Frozen Boundary

| Boundary | Violated? |
|----------|-----------|
| P3 semantics | ❌ No |
| P4 semantics | ❌ No |
| P5 semantics | ❌ No |
| P6 snapshot contract | ❌ No — market-cap weighting is the intended design |
| P6 feature computation | ❌ No |
| health_weights | ❌ No |
| regime_thresholds | ❌ No |

---

## 16. Remaining Semantic Questions

1. **Regime threshold tuning** — After narrative health becomes responsive, the existing regime boundaries (40/60/80) should be evaluated against the new distribution. This is a separate task.
2. **Health weight tuning** — P6-SEMANTIC-01 recommended derivative 0.35→0.30. This should be deferred until narrative health distribution is observed with real data.
3. **Warning thresholds** — P6 warnings will now fire. Their sensitivity should be evaluated after production data accumulates.

---

## 17. Next Task

After deployment and refresh:
- `P6-SEMANTIC-05 — P6 Narrative Health Distribution Calibration` (evaluate new distribution against regime thresholds)

---

## 18. Final Verdict

```
NARRATIVE AGGREGATION REPAIRED — PRODUCTION VERIFICATION PENDING
```

The code fix is complete and TypeScript passes. Production verification requires:
1. Deploy to production
2. Trigger a full refresh (which regenerates P6 snapshots)
3. Verify narrative health scores are no longer uniformly 50
4. Verify P6 regime differentiates between narratives
