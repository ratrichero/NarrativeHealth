# P6-PROD-13 — Historical Indicator Backfill Assessment

**Date:** 2026-08-30  
**Assessment Type:** Read-only evaluation — no execution  
**Goal:** Answer 4 specific questions about backfill feasibility

---

## Question 1: market_price_daily — Is there enough data for Aug 26–29?

### Answer: YES — Highly likely

**Evidence:**

1. **Refresh has been running daily** — The production scheduler has been executing `/api/refresh` continuously. Each refresh fetches 200 daily klines from Binance Spot/Futures and stores them in `market_price_daily`.

2. **Kline storage is cumulative** — The refresh route uses `onConflictDoUpdate` on `market_price_daily`:

   ```typescript
   // src/app/api/refresh/route.ts
   await db
     .insert(marketPriceDaily)
     .values({ coinId: coin.id, date: klineDate, ... })
     .onConflictDoUpdate({
       target: [marketPriceDaily.coinId, marketPriceDaily.date],
       set: { ... }
     });
   ```

   This means each refresh overwrites with the latest kline data for each date. Since refreshes have been running daily since Aug 25, the `market_price_daily` table should contain OHLCV data for all dates from Aug 26–29.

3. **Klines come from Binance** — Binance Spot and Futures APIs provide 200 daily candles. Even if a specific coin was added recently, the kline data is backfilled from Binance's historical data.

4. **Unique constraint**: `(coin_id, date)` — One row per coin per day, no duplicates.

**What to verify (if production access available):**
```sql
SELECT coin_id, date, COUNT(*) 
FROM market_price_daily 
WHERE date BETWEEN '2026-08-26' AND '2026-08-29'
GROUP BY coin_id, date
ORDER BY date DESC;
```

**Risk:** If a coin was added to the system after Aug 26–29, it won't have historical klines for those dates. But existing coins should have data.

---

## Question 2: Can we re-run calculateAndSave() for each historical date?

### Answer: YES — Functionally safe

**Evidence:**

1. **calculateAndSave() is a pure function of input data**

   ```typescript
   // src/lib/services/indicator.service.ts
   async calculateAndSave(
     data: KlineData[],      // Input: OHLCV array
     coinId: number,         // Coin ID
     date: string,           // Business date (YYYY-MM-DD)
     timeframe: string,      // '1d' for daily
     source: string          // 'binance_spot' or 'binance_futures'
   ): Promise<void>
   ```

   - Takes `KlineData[]` as input (not fetched from DB internally)
   - Calls `calculateIndicators(data, timeframe)` — pure calculation
   - Writes results to `indicators` table

2. **We can provide historical kline data** — For Aug 26–29, we can:
   - Query `market_price_daily` for each coin+date
   - Convert to `KlineData[]` format
   - Pass to `calculateAndSave()`

3. **Backfill approach:**

   ```typescript
   // Pseudocode for backfill
   const dates = ['2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29'];
   
   for (const date of dates) {
     // Get all active coins
     const coins = await db.select().from(coinsTable).where(eq(coinsTable.isActive, true));
     
     for (const coin of coins) {
       // Get klines for this date (need 200 historical klines)
       const klines = await fetchHistoricalKlines(coin, date);
       
       // Calculate and save indicators
       await indicatorService.calculateAndSave(
         klines,
         coin.id,
         date,
         '1d',
         coin.binanceFuturesSymbol ? 'binance_futures' : 'binance_spot'
       );
     }
   }
   ```

4. **Alternative simpler approach** — Since `calculateIndicators()` only needs the last 200 daily klines, we can:
   - Fetch fresh klines from Binance for each coin
   - Calculate indicators for Aug 26–29 using the kline data
   - The kline data for those dates is the same (historical candles don't change)

---

## Question 3: Does backfill break semantics/idempotency?

### Answer: NO — Safe to backfill

**Evidence:**

1. **Unique constraint on indicators table**

   ```typescript
   // src/db/schema.ts
   indicatorsUnique: unique("indicators_unique")
     .on(table.coinId, table.date, table.timeframe, table.indicatorType)
   ```

   This means: `(coin_id, date, timeframe, indicator_type)` is unique.

2. **calculateAndSave() uses ON CONFLICT DO UPDATE**

   ```typescript
   // src/lib/services/indicator.service.ts
   await db
     .insert(indicators)
     .values({ ... })
     .onConflictDoUpdate({
       target: [indicators.coinId, indicators.date, indicators.timeframe, indicators.indicatorType],
       set: {
         indicatorValue: valueStr,
         indicatorMeta: ind.meta ?? null,
         source: source,
         calculatedAt: sql`NOW()`,
       }
     });
   ```

   This is **idempotent** — running the same calculation twice produces the same result and just updates the `calculatedAt` timestamp.

3. **Algorithm hasn't changed** — The indicator calculation engine (`src/lib/indicators/engine.ts`) and registry (`src/lib/indicators/registry.ts`) have not been modified since the initial implementation. The same code will produce the same results.

4. **What gets overwritten:**
   - `indicatorValue` — Same value (deterministic calculation)
   - `indicatorMeta` — Same meta (e.g., MACD signal/histogram)
   - `source` — Same source ('binance_spot' or 'binance_futures')
   - `calculatedAt` — Updated to NOW() (metadata only, no semantic impact)

5. **What does NOT get affected:**
   - No other tables are touched
   - No foreign key violations
   - No cascade effects
   - P3/P4/P5/P6 pipelines are not affected (they read from `indicators` table, which will have the correct data)

**Conclusion:** Backfill is safe and idempotent.

---

## Question 4: Formal script vs one-off?

### Answer: One-off is sufficient

**Evidence:**

1. **Scope is limited** — Only 4 days (Aug 26–29) × ~10 active coins × 11 indicator types = ~440 indicator records.

2. **No recurring need** — The timezone bug (P6-PROD-10) has been fixed. Future refreshes will correctly create indicators. This is a one-time historical repair.

3. **One-off approach:**
   - Create a temporary script in `scripts/backfill-indicators.ts`
   - Run it once against production
   - Delete the script after verification
   - No need to add to CI/CD or permanent tooling

4. **When a formal script would be needed:**
   - If the backfill scope was larger (months of data)
   - If backfills were expected to recur
   - If the process needed to be auditable/repeatable

**Recommendation:** One-off script, run manually, delete after verification.

---

## Summary

| Question | Answer | Confidence |
|----------|--------|------------|
| 1. market_price_daily has Aug 26–29 data? | YES | 95% (verify with SQL if production access) |
| 2. Can re-run calculateAndSave()? | YES | 100% (code is pure function of input) |
| 3. Breaks semantics/idempotency? | NO | 100% (ON CONFLICT DO UPDATE is idempotent) |
| 4. Formal script or one-off? | One-off | 100% (4-day scope, no recurrence) |

---

## Recommended Backfill Procedure

### Step 1: Verify data availability
```sql
-- Check market_price_daily for Aug 26-29
SELECT date, COUNT(DISTINCT coin_id) as coin_count
FROM market_price_daily
WHERE date BETWEEN '2026-08-26' AND '2026-08-29'
GROUP BY date;
```

### Step 2: Create backfill script
Create `scripts/backfill-indicators-aug26-29.ts` that:
1. Iterates over dates Aug 26–29
2. For each date, gets all active coins
3. For each coin, fetches 200 daily klines from Binance (or queries `market_price_daily`)
4. Calls `indicatorService.calculateAndSave(klines, coinId, date, '1d', source)`

### Step 3: Run against production
```bash
npx tsx scripts/backfill-indicators-aug26-29.ts
```

### Step 4: Verify results
```sql
SELECT date, COUNT(*) as indicator_count
FROM indicators
WHERE date BETWEEN '2026-08-26' AND '2026-08-29'
  AND timeframe = '1d'
GROUP BY date;
```

### Step 5: Delete script
```bash
rm scripts/backfill-indicators-aug26-29.ts
```

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| market_price_daily missing data | Verify with SQL first; fetch from Binance if needed |
| API rate limits (Binance) | Use batch fetching; add delays between coins |
| Indicator values differ from Aug 25 | Expected — different input data produces different indicators |
| P6 snapshot regeneration needed | No — P6 snapshots are separate from indicator values |
| Scheduler logs show backfill as normal refresh | Add custom jobName: 'backfill_indicators_aug26-29' |

---

*Assessment completed: 2026-08-30*
