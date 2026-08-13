# P3-10E.36 — Leadership Volume Score Normalization Remediation

## 1. Executive Summary

P3-10E.36 remediated a genuine code defect in `prepareLeadershipInputs()`
that caused all Leadership constituents to fail volume validation during
the P3-10E.30 controlled execution.

| Item | Status |
|---|---|
| Root cause | **Code defect in `prepareLeadershipInputs()`** |
| Fix | Load `volumeScore` from canonical `features` table |
| Tests added | 5 focused regression tests |
| Typecheck | **PASS** |
| Git diff check | **PASS** |
| Production mutations | **0** |
| P3 orchestrator executed | **NO** |

**P3-10E.36 is a prerequisite for P3-10E.30 retry.**

---

## 2. Root Cause

`prepareLeadershipInputs()` in `src/lib/p3/preparation.ts:471-497` computed
`volumeScore` as the **raw average of `market_price_daily.volume`** values.

Example raw values for AI constituents:
- CARV: 57,198,047
- FET: 169,081,359
- BLUAI: 4,731,073,620

However, `calculateLeadership()` in `src/lib/p3/leadership.ts:67` validates
`volumeScore` with `validComponent()`:

```typescript
function validComponent(value: number | null): value is number {
  return value != null && Number.isFinite(value) && value >= 0 && value <= 100;
}
```

**Raw volume values always exceed 100, causing all constituents to fail
validation with reason `missing_or_invalid_volume`.**

Result: 0 eligible constituents → `INSUFFICIENT_HISTORY`.

---

## 3. Canonical Feature Source

The `features` table already contains normalized `volume_score` values
in the expected 0-100 range.

**Schema reference:** `src/db/schema.ts:157`
```typescript
volumeScore: real("volume_score"),
```

**Existing canonical consumer:** `src/lib/p3/leadership.ts:149-160`
```typescript
const featureRows = await db.select({ coinId: features.coinId, date: features.date, volumeScore: features.volumeScore }).from(features).where(and(...featureConditions));
const featureByCoin = latestByCoin(featureRows.map((row) => ({ ...row, date: String(row.date) })));
// ...
volumeScore: featureByCoin.get(member.coinId)?.volumeScore ?? null,
```

**Production verification (window_end = 2026-08-11):**

| Coin | Symbol | `features.volume_score` |
|------|--------|------------------------|
| 1 | CARV | 15.0 |
| 4 | FET | 15.0 |
| 5 | RENDER | 60.0 |
| 10 | BLUAI | 95.0 |
| 11 | AKT | 15.0 |
| 12 | PROMPT | 30.0 |
| 22 | TRUTH | 15.0 |

All values are within the valid 0-100 range.

---

## 4. Code Change

### 4.1 `src/lib/p3/preparation.ts`

**Import change (line 27):**
```typescript
import {
  coins,
  narratives,
  narrativeHealth,
  healthScores,
  marketPriceDaily,
  coinMetrics,
  features,               // NEW
  featureVersions,
  ruleVersions,
  scoreConfigs,
  p3NarrativeIntelligence,
} from "@/db/schema";
```

**Function signature change (line 439-444):**
```typescript
export async function prepareLeadershipInputs(
  narrativeId: number,
  windowEnd: Date,
  constituents: readonly P3Constituent[],
  relativeStrengthData?: ReadonlyMap<number, number>,
  featureVersionId?: number    // NEW
): Promise<PreparedLeadershipInputs> {
```

**Volume score loading change (lines 471-497):**

Before:
```typescript
// Load volume scores from market_price_daily (7D average volume)
const volumeData = await db
  .select({
    coinId: marketPriceDaily.coinId,
    volume: marketPriceDaily.volume,
    date: marketPriceDaily.date,
  })
  .from(marketPriceDaily)
  .where(
    and(
      gte(marketPriceDaily.date, utcDateLabel(resolvedWindow.startTarget)),
      lte(marketPriceDaily.date, utcDateLabel(resolvedWindow.endTarget)),
      inArray(marketPriceDaily.coinId, eligibleCoinIds)
    )
  )
  .orderBy(marketPriceDaily.date);

const volumeMap = new Map<number, number>();
for (const coinId of eligibleCoinIds) {
  const coinVolumes = volumeData
    .filter((v) => v.coinId === coinId)
    .map((v) => parseFloat(v.volume as string));
  if (coinVolumes.length > 0) {
    const avgVolume = coinVolumes.reduce((sum, v) => sum + v, 0) / coinVolumes.length;
    volumeMap.set(coinId, avgVolume);
  }
}
```

After:
```typescript
// Load volume scores from canonical features (normalized 0-100)
const featureConditions = [inArray(features.coinId, eligibleCoinIds), lte(features.date, utcDateLabel(windowEnd))];
if (featureVersionId != null) featureConditions.push(eq(features.versionId, featureVersionId));
const featureRows = await db.select({ coinId: features.coinId, date: features.date, volumeScore: features.volumeScore }).from(features).where(and(...featureConditions));
const featureByCoin = new Map<number, { volumeScore: number | null; date: string }>();
for (const row of featureRows) {
  const existing = featureByCoin.get(row.coinId);
  const dateStr = String(row.date);
  if (!existing || dateStr > existing.date) {
    featureByCoin.set(row.coinId, { volumeScore: row.volumeScore ?? null, date: dateStr });
  }
}
```

**Constituent building change (lines 525-538):**

Before:
```typescript
const volume = volumeMap.get(coinId);
// ...
volumeScore: volume ?? null,
```

After:
```typescript
const feature = featureByCoin.get(coinId);
// ...
volumeScore: feature?.volumeScore ?? null,
```

### 4.2 `src/lib/p3/orchestrator.ts`

**Line 230-235:** Pass `featureVersionId` to `prepareLeadershipInputs()`:

```typescript
const leadershipInputs = await prepareLeadershipInputs(
  config.narrativeId,
  config.windowEnd,
  constituents,
  rsConstituentReturns,
  context.featureVersionId ?? undefined
);
```

---

## 5. Tests

### 5.1 New Test File: `src/lib/p3/__tests__/leadership-volume-score.test.ts`

| # | Test | Result |
|---|---|---|
| 1 | Raw volume is NOT passed as Leadership `volumeScore` | PASS |
| 2 | Canonical normalized feature value is used | PASS |
| 3 | Feature value within 0-100 is accepted | PASS |
| 4 | Missing feature value produces null `volumeScore` | PASS |
| 5 | Large raw volume values do not cause Leadership exclusion | PASS |

### 5.2 Existing Tests

| Suite | Tests | Result |
|---|---|---|
| `leadership.test.ts` | 33 | PASS |
| `orchestrator.test.ts` | 15 | PASS |
| `relative-strength.test.ts` | 23 | PASS |
| `oi-source-filter.test.ts` | 4 | PASS |
| `extract-metric-value.test.ts` | 9 | PASS |

**No regressions introduced.**

---

## 6. Verification

### 6.1 Static Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| `git diff --check` | PASS (pre-existing CRLF warnings only) |

### 6.2 Production Safety

| Check | Status |
|---|---|
| Production writes | 0 |
| Production mutations | 0 |
| P3 orchestrator execution | 0 |
| New snapshots created | 0 |
| P3 artifacts created | 0 |
| Schema changes | 0 |
| Threshold changes | 0 |
| Configuration changes | 0 |
| P0-P2 data modified | 0 |

### 6.3 Read-Only Production Verification

Confirmed all 7 AI constituents have canonical normalized `volume_score`
values in the 0-100 range for window_end = 2026-08-11.

---

## 7. Impact

| Component | Impact |
|-----------|--------|
| P3-07 Leadership | **Fixed** — volumeScore now loads from canonical features |
| P3-08 Regime | **Unaffected** |
| P3-09 Rotation | **Unaffected** |
| P3-04/P3-06 | **Unaffected** |
| P0-P2 data | **Unaffected** |
| Existing snapshots | **Unaffected** |
| Correction ledger | **Unaffected** |

---

## 8. Next Action

P3-10E.30 can now be retried. The controlled first valid production execution
should proceed with the fixed `prepareLeadershipInputs()`.

---

## 9. Files Modified

| File | Change |
|------|--------|
| `src/lib/p3/preparation.ts` | Added `features` import; added `featureVersionId` parameter; replaced raw volume calculation with features query |
| `src/lib/p3/orchestrator.ts` | Pass `context.featureVersionId` to `prepareLeadershipInputs()` |
| `src/lib/p3/__tests__/leadership-volume-score.test.ts` | New: 5 regression tests |

---

## 10. Important Notes

1. **This fix preserves all existing P3 contracts and thresholds.**
2. **No normalization formula was invented.** The canonical `features.volume_score`
   is used directly.
3. **The fix reuses the same pattern as `loadLeadershipInputs()` in
   `leadership.ts:149-160`, ensuring consistency between preparation and
   calculation layers.**
4. **P3 orchestrator was NOT executed.** This task only fixed the preparation
   defect. P3-10E.30 must be retried separately.
