-- Migration 0025: P6-01C — Source Registry Data Model
-- Frozen contract: P6-01C (commit 18fb0f0)
-- Adds source definitions, capabilities, and config version tracking

-- Source Definitions: canonical source identity, type, status, entity coverage
CREATE TABLE IF NOT EXISTS p6_source_definitions (
  id SERIAL PRIMARY KEY,
  source_id VARCHAR(50) NOT NULL UNIQUE,
  provider VARCHAR(100) NOT NULL,
  source_type VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  entity_type VARCHAR(30) NOT NULL DEFAULT 'COIN',
  entity_coverage_requirement VARCHAR(200) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS p6_source_def_type_idx ON p6_source_definitions(source_type);
CREATE INDEX IF NOT EXISTS p6_source_def_status_idx ON p6_source_definitions(status);

-- Source Capabilities: metric + timeframe support per source
CREATE TABLE IF NOT EXISTS p6_source_capabilities (
  id SERIAL PRIMARY KEY,
  source_id VARCHAR(50) NOT NULL REFERENCES p6_source_definitions(source_id),
  metric VARCHAR(50) NOT NULL,
  timeframe VARCHAR(30) NOT NULL,
  is_supported BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, metric, timeframe)
);

CREATE INDEX IF NOT EXISTS p6_source_cap_metric_idx ON p6_source_capabilities(metric);
CREATE INDEX IF NOT EXISTS p6_source_cap_timeframe_idx ON p6_source_capabilities(timeframe);

-- Registry Config Versions: tracks which version of the registry is active
CREATE TABLE IF NOT EXISTS p6_registry_config_versions (
  id SERIAL PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial config version
INSERT INTO p6_registry_config_versions (version, description, is_active)
VALUES (1, 'Initial P6-01C source registry — BINANCE_SPOT, BINANCE_FUTURES, COINGECKO', true)
ON CONFLICT (version) DO NOTHING;

-- Seed source definitions
INSERT INTO p6_source_definitions (source_id, provider, source_type, status, entity_type, entity_coverage_requirement, description)
VALUES
  ('BINANCE_SPOT', 'Binance', 'MARKET_SPOT', 'ACTIVE', 'COIN', 'binanceSpotSymbol', 'Binance Spot market — OHLCV klines and ticker'),
  ('BINANCE_FUTURES', 'Binance', 'MARKET_DERIVATIVES', 'ACTIVE', 'COIN', 'binanceFuturesSymbol + hasFutures', 'Binance Futures (USDT-M) — klines, OI, funding rate'),
  ('COINGECKO', 'CoinGecko', 'MARKET_AGGREGATOR', 'ACTIVE', 'COIN', 'coingeckoId', 'CoinGecko — market cap, FDV, circulating supply')
ON CONFLICT (source_id) DO NOTHING;

-- Seed capabilities: BINANCE_SPOT
-- DAILY: OHLCV
INSERT INTO p6_source_capabilities (source_id, metric, timeframe, is_supported) VALUES
  ('BINANCE_SPOT', 'OPEN', 'DAILY', true),
  ('BINANCE_SPOT', 'HIGH', 'DAILY', true),
  ('BINANCE_SPOT', 'LOW', 'DAILY', true),
  ('BINANCE_SPOT', 'CLOSE', 'DAILY', true),
  ('BINANCE_SPOT', 'VOLUME', 'DAILY', true),
  ('BINANCE_SPOT', 'QUOTE_VOLUME', 'DAILY', true)
ON CONFLICT (source_id, metric, timeframe) DO NOTHING;

-- 4H: OHLCV
INSERT INTO p6_source_capabilities (source_id, metric, timeframe, is_supported) VALUES
  ('BINANCE_SPOT', 'OPEN', '4H', true),
  ('BINANCE_SPOT', 'HIGH', '4H', true),
  ('BINANCE_SPOT', 'LOW', '4H', true),
  ('BINANCE_SPOT', 'CLOSE', '4H', true),
  ('BINANCE_SPOT', 'VOLUME', '4H', true),
  ('BINANCE_SPOT', 'QUOTE_VOLUME', '4H', true)
ON CONFLICT (source_id, metric, timeframe) DO NOTHING;

-- Seed capabilities: BINANCE_FUTURES
-- DAILY: OHLCV
INSERT INTO p6_source_capabilities (source_id, metric, timeframe, is_supported) VALUES
  ('BINANCE_FUTURES', 'OPEN', 'DAILY', true),
  ('BINANCE_FUTURES', 'HIGH', 'DAILY', true),
  ('BINANCE_FUTURES', 'LOW', 'DAILY', true),
  ('BINANCE_FUTURES', 'CLOSE', 'DAILY', true),
  ('BINANCE_FUTURES', 'VOLUME', 'DAILY', true),
  ('BINANCE_FUTURES', 'QUOTE_VOLUME', 'DAILY', true)
ON CONFLICT (source_id, metric, timeframe) DO NOTHING;

-- 4H: OHLCV
INSERT INTO p6_source_capabilities (source_id, metric, timeframe, is_supported) VALUES
  ('BINANCE_FUTURES', 'OPEN', '4H', true),
  ('BINANCE_FUTURES', 'HIGH', '4H', true),
  ('BINANCE_FUTURES', 'LOW', '4H', true),
  ('BINANCE_FUTURES', 'CLOSE', '4H', true),
  ('BINANCE_FUTURES', 'VOLUME', '4H', true),
  ('BINANCE_FUTURES', 'QUOTE_VOLUME', '4H', true)
ON CONFLICT (source_id, metric, timeframe) DO NOTHING;

-- SOURCE_SNAPSHOT: OI + funding rate
INSERT INTO p6_source_capabilities (source_id, metric, timeframe, is_supported) VALUES
  ('BINANCE_FUTURES', 'OPEN_INTEREST', 'SOURCE_SNAPSHOT', true),
  ('BINANCE_FUTURES', 'FUNDING_RATE', 'SOURCE_SNAPSHOT', true)
ON CONFLICT (source_id, metric, timeframe) DO NOTHING;

-- Seed capabilities: COINGECKO
-- SOURCE_SNAPSHOT: market cap + FDV
INSERT INTO p6_source_capabilities (source_id, metric, timeframe, is_supported) VALUES
  ('COINGECKO', 'MARKET_CAP', 'SOURCE_SNAPSHOT', true),
  ('COINGECKO', 'FDV', 'SOURCE_SNAPSHOT', true)
ON CONFLICT (source_id, metric, timeframe) DO NOTHING;
