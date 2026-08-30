/**
 * P6-PROD-14 — Historical Indicator Backfill Script
 * 
 * Restores missing Indicator Values (1D) for Aug 26-29, 2026.
 * Uses existing indicatorService.calculateAndSave() — no custom algorithm.
 * 
 * Usage: npx tsx scripts/backfill-indicators-aug26-29.ts
 * 
 * SAFETY:
 * - READ-ONLY on market_price_daily (source data)
 * - Uses ON CONFLICT DO UPDATE (idempotent)
 * - No schema changes
 * - No P6/P3/P4/P5 modifications
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

// ═══════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════

const TARGET_DATES = ['2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29'];
const TIMEFRAME = '1d';
const SOURCE = 'backfill_aug26-29';
const HISTORY_LIMIT = 250; // >200 for EMA_200, with buffer

// ═══════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════

interface KlineData {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
}

interface AuditLog {
  startTime: string;
  businessTimezone: string;
  targetDates: string[];
  coinCount: number;
  expectedIndicators: number; // per coin per date
  dates: Record<string, {
    attempted: number;
    succeeded: number;
    skipped: number;
    indicatorsWritten: number;
    errors: string[];
  }>;
  totalAttempted: number;
  totalSucceeded: number;
  totalSkipped: number;
  totalWritten: number;
  totalErrors: number;
  endTime: string;
}

// ═══════════════════════════════════════════════
// INDICATOR TYPES FOR 1d TIMEFRAME
// (derived from src/lib/indicators/registry.ts)
// ═══════════════════════════════════════════════

const EXPECTED_1D_INDICATORS = [
  'EMA_9', 'EMA_21', 'EMA_50', 'EMA_200',
  'RSI_14', 'MACD', 'ADX_14',
  'BB_20', 'ATR_14',
  'VOLUME_RATIO', 'OBV',
];

// ═══════════════════════════════════════════════
// DATABASE HELPERS
// ═══════════════════════════════════════════════

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  // Normalize asyncpg:// to postgresql:// for pg driver
  return url.replace('postgresql+asyncpg://', 'postgresql://');
}

function convertRowToKline(row: any): KlineData {
  return {
    openTime: new Date(row.date).getTime(),
    open: parseFloat(row.open),
    high: parseFloat(row.high),
    low: parseFloat(row.low),
    close: parseFloat(row.close),
    volume: parseFloat(row.volume),
    closeTime: new Date(row.date).getTime() + 86400000 - 1,
    quoteVolume: row.quote_volume ? parseFloat(row.quote_volume) : 0,
  };
}

// ═══════════════════════════════════════════════
// INDICATOR CALCULATION
// (reuses production engine — no custom implementation)
// ═══════════════════════════════════════════════

async function calculateIndicators(data: KlineData[], timeframe: string): Promise<Array<{ type: string; value: number | null; meta?: Record<string, unknown> }>> {
  // Dynamic import to use same code as production
  const { calculateIndicators: calc } = await import('../src/lib/indicators/engine');
  return calc(data, timeframe);
}

// ═══════════════════════════════════════════════
// BACKFILL CORE
// ═══════════════════════════════════════════════

async function backfill(): Promise<AuditLog> {
  const dbUrl = getDatabaseUrl();
  const pool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: 30000 });

  const audit: AuditLog = {
    startTime: new Date().toISOString(),
    businessTimezone: 'Asia/Ho_Chi_Minh',
    targetDates: TARGET_DATES,
    coinCount: 0,
    expectedIndicators: EXPECTED_1D_INDICATORS.length,
    dates: {},
    totalAttempted: 0,
    totalSucceeded: 0,
    totalSkipped: 0,
    totalWritten: 0,
    totalErrors: 0,
    endTime: '',
  };

  try {
    // ── Get all active coins ──
    const coinsResult = await pool.query(
      `SELECT id, symbol, name, binance_spot_symbol, binance_futures_symbol 
       FROM coins 
       WHERE is_active = true 
       ORDER BY id`
    );
    const coins = coinsResult.rows;
    audit.coinCount = coins.length;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`P6-PROD-14 — HISTORICAL INDICATOR BACKFILL`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`Start time:        ${audit.startTime}`);
    console.log(`Business timezone: ${audit.businessTimezone}`);
    console.log(`Target dates:      ${TARGET_DATES.join(', ')}`);
    console.log(`Timeframe:         ${TIMEFRAME}`);
    console.log(`Active coins:      ${coins.length}`);
    console.log(`Expected types:    ${EXPECTED_1D_INDICATORS.join(', ')}`);
    console.log(`Expected/coin/day: ${EXPECTED_1D_INDICATORS.length}`);
    console.log(`Expected total:    ${coins.length * TARGET_DATES.length * EXPECTED_1D_INDICATORS.length} rows`);
    console.log(`${'─'.repeat(60)}\n`);

    for (const date of TARGET_DATES) {
      const dateLog = {
        attempted: 0,
        succeeded: 0,
        skipped: 0,
        indicatorsWritten: 0,
        errors: [] as string[],
      };

      console.log(`\n📅 Date: ${date}`);
      console.log(`${'─'.repeat(40)}`);

      for (const coin of coins) {
        dateLog.attempted++;

        try {
          // ── PHASE 2: Historical input window ──
          // Get last HISTORY_LIMIT klines ending at or before target date
          // This ensures EMA_200 has enough historical context
          const klinesResult = await pool.query(
            `SELECT date, open, high, low, close, volume, quote_volume
             FROM market_price_daily
             WHERE coin_id = $1 AND date <= $2
             ORDER BY date DESC
             LIMIT $3`,
            [coin.id, date, HISTORY_LIMIT]
          );

          if (klinesResult.rows.length === 0) {
            dateLog.skipped++;
            dateLog.errors.push(`${coin.symbol}: no market_price_daily rows`);
            console.log(`  ⏭️  ${coin.symbol} (id=${coin.id}): SKIPPED — no klines`);
            continue;
          }

          // ── PHASE 3: Data integrity check ──
          const invalidRows = klinesResult.rows.filter(
            (r: any) => !r.open || !r.high || !r.low || !r.close || !r.volume
          );

          if (invalidRows.length > 0) {
            dateLog.skipped++;
            dateLog.errors.push(`${coin.symbol}: ${invalidRows.length} rows with missing OHLCV`);
            console.log(`  ⏭️  ${coin.symbol} (id=${coin.id}): SKIPPED — ${invalidRows.length} invalid rows`);
            continue;
          }

          // ── Reverse to chronological order (oldest first) ──
          const klines = klinesResult.rows.reverse().map(convertRowToKline);

          // ── No future leakage check ──
          const lastKlineDate = new Date(klines[klines.length - 1].openTime).toISOString().split('T')[0];
          if (lastKlineDate > date) {
            dateLog.skipped++;
            dateLog.errors.push(`${coin.symbol}: future data detected (${lastKlineDate} > ${date})`);
            console.log(`  ⏭️  ${coin.symbol} (id=${coin.id}): SKIPPED — future leakage (${lastKlineDate})`);
            continue;
          }

          // ── PHASE 4: Calculate indicators using existing production engine ──
          const calculated = await calculateIndicators(klines, TIMEFRAME);

          if (calculated.length === 0) {
            dateLog.skipped++;
            dateLog.errors.push(`${coin.symbol}: 0 indicators calculated from ${klines.length} klines`);
            console.log(`  ⏭️  ${coin.symbol} (id=${coin.id}): SKIPPED — 0 indicators from ${klines.length} klines`);
            continue;
          }

          // ── PHASE 5: Write using ON CONFLICT DO UPDATE ──
          let saved = 0;
          let failed = 0;

          for (const ind of calculated) {
            try {
              const valueStr = ind.value != null ? String(ind.value) : null;
              await pool.query(
                `INSERT INTO indicators (coin_id, date, timeframe, indicator_type, indicator_value, indicator_meta, source, calculated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                 ON CONFLICT (coin_id, date, timeframe, indicator_type)
                 DO UPDATE SET
                   indicator_value = EXCLUDED.indicator_value,
                   indicator_meta = EXCLUDED.indicator_meta,
                   source = EXCLUDED.source,
                   calculated_at = NOW()`,
                [
                  coin.id,
                  date,
                  TIMEFRAME,
                  ind.type,
                  valueStr,
                  ind.meta ? JSON.stringify(ind.meta) : null,
                  SOURCE,
                ]
              );
              saved++;
            } catch (indErr) {
              failed++;
              const errMsg = indErr instanceof Error ? indErr.message : String(indErr);
              console.error(`    ❌ ${coin.symbol} ${ind.type}: ${errMsg}`);
            }
          }

          dateLog.indicatorsWritten += saved;
          dateLog.succeeded++;

          if (saved > 0) {
            console.log(`  ✅ ${coin.symbol} (id=${coin.id}): ${saved} indicators (${klines.length} klines)`);
          }

        } catch (coinErr) {
          dateLog.errors.push(`${coin.symbol}: ${coinErr instanceof Error ? coinErr.message : String(coinErr)}`);
          console.error(`  ❌ ${coin.symbol} (id=${coin.id}): ${coinErr instanceof Error ? coinErr.message : String(coinErr)}`);
        }
      }

      audit.dates[date] = dateLog;
      audit.totalAttempted += dateLog.attempted;
      audit.totalSucceeded += dateLog.succeeded;
      audit.totalSkipped += dateLog.skipped;
      audit.totalWritten += dateLog.indicatorsWritten;
      audit.totalErrors += dateLog.errors.length;

      console.log(`\n  📊 ${date} Summary: ${dateLog.succeeded} succeeded, ${dateLog.skipped} skipped, ${dateLog.indicatorsWritten} written, ${dateLog.errors.length} errors`);
    }

    audit.endTime = new Date().toISOString();

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`BACKFILL COMPLETE`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`Duration:          ${audit.startTime} → ${audit.endTime}`);
    console.log(`Total attempted:   ${audit.totalAttempted}`);
    console.log(`Total succeeded:   ${audit.totalSucceeded}`);
    console.log(`Total skipped:     ${audit.totalSkipped}`);
    console.log(`Total written:     ${audit.totalWritten}`);
    console.log(`Total errors:      ${audit.totalErrors}`);
    console.log(`${'═'.repeat(60)}\n`);

    // Print any errors
    if (audit.totalErrors > 0) {
      console.log(`\n⚠️  ERRORS:`);
      for (const [date, log] of Object.entries(audit.dates)) {
        for (const err of log.errors) {
          console.log(`  ${date}: ${err}`);
        }
      }
    }

  } finally {
    await pool.end();
  }

  return audit;
}

// ═══════════════════════════════════════════════
// VERIFICATION (Phase 7-10)
// ═══════════════════════════════════════════════

async function verify(): Promise<void> {
  const dbUrl = getDatabaseUrl();
  const pool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: 30000 });

  try {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`POST-BACKFILL VERIFICATION`);
    console.log(`${'═'.repeat(60)}\n`);

    // ── Phase 7: Indicator counts ──
    console.log(`📊 Phase 7: Indicator counts by date`);
    const countsResult = await pool.query(`
      SELECT date, COUNT(DISTINCT coin_id) AS coins, COUNT(*) AS rows
      FROM indicators
      WHERE date BETWEEN '2026-08-26' AND '2026-08-29'
        AND timeframe = '1d'
      GROUP BY date
      ORDER BY date
    `);
    for (const row of countsResult.rows) {
      console.log(`  ${row.date}: ${row.coins} coins, ${row.rows} rows`);
    }

    // ── Phase 8: Indicator completeness for coin 16 ──
    console.log(`\n📊 Phase 8: Coin 16 indicator completeness`);
    for (const date of TARGET_DATES) {
      const typesResult = await pool.query(`
        SELECT indicator_type, indicator_value
        FROM indicators
        WHERE coin_id = 16 AND date = $1 AND timeframe = '1d'
        ORDER BY indicator_type
      `, [date]);
      const types = typesResult.rows.map((r: any) => r.indicator_type);
      const missing = EXPECTED_1D_INDICATORS.filter(t => !types.includes(t));
      const nullValues = typesResult.rows.filter((r: any) => r.indicator_value === null);
      console.log(`  ${date}: ${types.length}/${EXPECTED_1D_INDICATORS.length} types, missing: [${missing.join(', ')}], nulls: ${nullValues.length}`);
    }

    // ── Phase 9: No future leakage ──
    console.log(`\n📊 Phase 9: Future leakage check`);
    const leakageResult = await pool.query(`
      SELECT date, COUNT(*) as rows
      FROM indicators
      WHERE date > '2026-08-29'
        AND timeframe = '1d'
        AND source = 'backfill_aug26-29'
      GROUP BY date
    `);
    if (leakageResult.rows.length === 0) {
      console.log(`  ✅ No future leakage detected`);
    } else {
      console.log(`  ❌ FUTURE LEAKAGE DETECTED:`);
      for (const row of leakageResult.rows) {
        console.log(`    ${row.date}: ${row.rows} rows`);
      }
    }

    // ── Phase 10: Out-of-scope write verification ──
    console.log(`\n📊 Phase 10: Out-of-scope write verification`);
    const oosResult = await pool.query(`
      SELECT date, source, COUNT(*) as rows
      FROM indicators
      WHERE source = 'backfill_aug26-29'
        AND (date < '2026-08-26' OR date > '2026-08-29')
      GROUP BY date, source
    `);
    if (oosResult.rows.length === 0) {
      console.log(`  ✅ No out-of-scope writes`);
    } else {
      console.log(`  ❌ OUT-OF-SCOPE WRITES:`);
      for (const row of oosResult.rows) {
        console.log(`    ${row.date} (${row.source}): ${row.rows} rows`);
      }
    }

    // ── Phase 11: API verification (sample) ──
    console.log(`\n📊 Phase 11: Sample indicator values for coin 16`);
    const sampleResult = await pool.query(`
      SELECT date, indicator_type, indicator_value
      FROM indicators
      WHERE coin_id = 16 AND date BETWEEN '2026-08-26' AND '2026-08-29' AND timeframe = '1d'
      ORDER BY date, indicator_type
      LIMIT 33
    `);
    for (const row of sampleResult.rows) {
      console.log(`  ${row.date} ${row.indicator_type}: ${row.indicator_value}`);
    }

    // ── Additional: Coin 16 and 2 other coins ──
    console.log(`\n📊 Additional: Sample coins`);
    const sampleCoinsResult = await pool.query(`
      SELECT i.coin_id, c.symbol, i.date, i.indicator_type, i.indicator_value
      FROM indicators i
      JOIN coins c ON c.id = i.coin_id
      WHERE i.date = '2026-08-28' AND i.timeframe = '1d'
        AND i.coin_id IN (16, 
          (SELECT id FROM coins WHERE is_active = true AND id != 16 LIMIT 1),
          (SELECT id FROM coins WHERE is_active = true AND id NOT IN (16) ORDER BY id LIMIT 1 OFFSET 1)
        )
      ORDER BY i.coin_id, i.indicator_type
      LIMIT 40
    `);
    for (const row of sampleCoinsResult.rows) {
      console.log(`  ${row.symbol} (id=${row.coin_id}) ${row.date} ${row.indicator_type}: ${row.indicator_value}`);
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`VERIFICATION COMPLETE`);
    console.log(`${'═'.repeat(60)}\n`);

  } finally {
    await pool.end();
  }
}

// ═══════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════

async function main() {
  try {
    const audit = await backfill();
    await verify();

    console.log(`\n📋 Audit log saved to console output above.`);
    console.log(`   Script can be re-run safely (idempotent).\n`);

    if (audit.totalErrors > 0) {
      console.log(`⚠️  ${audit.totalErrors} errors occurred. Review above.`);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
  }
}

main();
