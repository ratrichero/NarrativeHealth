-- Migration 0027: P6-01C-E2 — Freshness V1 Production Policies
-- Frozen decision: P6-01C-E (commit 8557dce)
-- Seeds all supported DAILY and 4H freshness policies with frozen threshold values.
-- SOURCE_SNAPSHOT policies are NOT seeded (P6-01C-E1 confirmed cadence not established).
--
-- DAILY: expected_interval = 24h (86,400,000 ms), stale_after = 36h (129,600,000 ms)
-- 4H:    expected_interval = 4h  (14,400,000 ms),  stale_after = 6h  (21,600,000 ms)
--
-- Policy count: 28
--   BINANCE_SPOT:   6 metrics × 2 timeframes = 12
--   BINANCE_FUTURES: 8 metrics × 2 timeframes = 16
--   COINGECKO:      0 (only SOURCE_SNAPSHOT — no DAILY/4H)

-- Config version = 1 (same version created by migration 0025)
-- All policies use config_version = 1

-- ============================================================
-- BINANCE_SPOT — DAILY policies (6 metrics × 24h/36h)
-- ============================================================

INSERT INTO p6_freshness_policies (source_id, metric, timeframe, expected_interval_ms, stale_after_ms, config_version, description)
VALUES
  ('BINANCE_SPOT', 'OPEN',         'DAILY', 86400000, 129600000, 1, 'P6-01C-E: BINANCE_SPOT DAILY — expected 24h, stale 36h'),
  ('BINANCE_SPOT', 'HIGH',         'DAILY', 86400000, 129600000, 1, 'P6-01C-E: BINANCE_SPOT DAILY — expected 24h, stale 36h'),
  ('BINANCE_SPOT', 'LOW',          'DAILY', 86400000, 129600000, 1, 'P6-01C-E: BINANCE_SPOT DAILY — expected 24h, stale 36h'),
  ('BINANCE_SPOT', 'CLOSE',        'DAILY', 86400000, 129600000, 1, 'P6-01C-E: BINANCE_SPOT DAILY — expected 24h, stale 36h'),
  ('BINANCE_SPOT', 'VOLUME',       'DAILY', 86400000, 129600000, 1, 'P6-01C-E: BINANCE_SPOT DAILY — expected 24h, stale 36h'),
  ('BINANCE_SPOT', 'QUOTE_VOLUME', 'DAILY', 86400000, 129600000, 1, 'P6-01C-E: BINANCE_SPOT DAILY — expected 24h, stale 36h')
ON CONFLICT (source_id, metric, timeframe, config_version) DO NOTHING;

-- ============================================================
-- BINANCE_SPOT — 4H policies (6 metrics × 4h/6h)
-- ============================================================

INSERT INTO p6_freshness_policies (source_id, metric, timeframe, expected_interval_ms, stale_after_ms, config_version, description)
VALUES
  ('BINANCE_SPOT', 'OPEN',         '4H', 14400000, 21600000, 1, 'P6-01C-E: BINANCE_SPOT 4H — expected 4h, stale 6h'),
  ('BINANCE_SPOT', 'HIGH',         '4H', 14400000, 21600000, 1, 'P6-01C-E: BINANCE_SPOT 4H — expected 4h, stale 6h'),
  ('BINANCE_SPOT', 'LOW',          '4H', 14400000, 21600000, 1, 'P6-01C-E: BINANCE_SPOT 4H — expected 4h, stale 6h'),
  ('BINANCE_SPOT', 'CLOSE',        '4H', 14400000, 21600000, 1, 'P6-01C-E: BINANCE_SPOT 4H — expected 4h, stale 6h'),
  ('BINANCE_SPOT', 'VOLUME',       '4H', 14400000, 21600000, 1, 'P6-01C-E: BINANCE_SPOT 4H — expected 4h, stale 6h'),
  ('BINANCE_SPOT', 'QUOTE_VOLUME', '4H', 14400000, 21600000, 1, 'P6-01C-E: BINANCE_SPOT 4H — expected 4h, stale 6h')
ON CONFLICT (source_id, metric, timeframe, config_version) DO NOTHING;

-- ============================================================
-- BINANCE_FUTURES — DAILY policies (8 metrics × 24h/36h)
-- ============================================================

INSERT INTO p6_freshness_policies (source_id, metric, timeframe, expected_interval_ms, stale_after_ms, config_version, description)
VALUES
  ('BINANCE_FUTURES', 'OPEN',         'DAILY', 86400000, 129600000, 1, 'P6-01C-E: BINANCE_FUTURES DAILY — expected 24h, stale 36h'),
  ('BINANCE_FUTURES', 'HIGH',         'DAILY', 86400000, 129600000, 1, 'P6-01C-E: BINANCE_FUTURES DAILY — expected 24h, stale 36h'),
  ('BINANCE_FUTURES', 'LOW',          'DAILY', 86400000, 129600000, 1, 'P6-01C-E: BINANCE_FUTURES DAILY — expected 24h, stale 36h'),
  ('BINANCE_FUTURES', 'CLOSE',        'DAILY', 86400000, 129600000, 1, 'P6-01C-E: BINANCE_FUTURES DAILY — expected 24h, stale 36h'),
  ('BINANCE_FUTURES', 'VOLUME',       'DAILY', 86400000, 129600000, 1, 'P6-01C-E: BINANCE_FUTURES DAILY — expected 24h, stale 36h'),
  ('BINANCE_FUTURES', 'QUOTE_VOLUME', 'DAILY', 86400000, 129600000, 1, 'P6-01C-E: BINANCE_FUTURES DAILY — expected 24h, stale 36h'),
  ('BINANCE_FUTURES', 'OPEN_INTEREST', 'DAILY', 86400000, 129600000, 1, 'P6-01C-E: BINANCE_FUTURES DAILY — expected 24h, stale 36h'),
  ('BINANCE_FUTURES', 'FUNDING_RATE',  'DAILY', 86400000, 129600000, 1, 'P6-01C-E: BINANCE_FUTURES DAILY — expected 24h, stale 36h')
ON CONFLICT (source_id, metric, timeframe, config_version) DO NOTHING;

-- ============================================================
-- BINANCE_FUTURES — 4H policies (8 metrics × 4h/6h)
-- ============================================================

INSERT INTO p6_freshness_policies (source_id, metric, timeframe, expected_interval_ms, stale_after_ms, config_version, description)
VALUES
  ('BINANCE_FUTURES', 'OPEN',          '4H', 14400000, 21600000, 1, 'P6-01C-E: BINANCE_FUTURES 4H — expected 4h, stale 6h'),
  ('BINANCE_FUTURES', 'HIGH',          '4H', 14400000, 21600000, 1, 'P6-01C-E: BINANCE_FUTURES 4H — expected 4h, stale 6h'),
  ('BINANCE_FUTURES', 'LOW',           '4H', 14400000, 21600000, 1, 'P6-01C-E: BINANCE_FUTURES 4H — expected 4h, stale 6h'),
  ('BINANCE_FUTURES', 'CLOSE',         '4H', 14400000, 21600000, 1, 'P6-01C-E: BINANCE_FUTURES 4H — expected 4h, stale 6h'),
  ('BINANCE_FUTURES', 'VOLUME',        '4H', 14400000, 21600000, 1, 'P6-01C-E: BINANCE_FUTURES 4H — expected 4h, stale 6h'),
  ('BINANCE_FUTURES', 'QUOTE_VOLUME',  '4H', 14400000, 21600000, 1, 'P6-01C-E: BINANCE_FUTURES 4H — expected 4h, stale 6h'),
  ('BINANCE_FUTURES', 'OPEN_INTEREST', '4H', 14400000, 21600000, 1, 'P6-01C-E: BINANCE_FUTURES 4H — expected 4h, stale 6h'),
  ('BINANCE_FUTURES', 'FUNDING_RATE',  '4H', 14400000, 21600000, 1, 'P6-01C-E: BINANCE_FUTURES 4H — expected 4h, stale 6h')
ON CONFLICT (source_id, metric, timeframe, config_version) DO NOTHING;

-- ============================================================
-- Verification: no SOURCE_SNAPSHOT policies seeded
-- ============================================================
-- If you see rows here, the migration is wrong.
-- SELECT * FROM p6_freshness_policies WHERE timeframe = 'SOURCE_SNAPSHOT';
-- Expected: 0 rows
