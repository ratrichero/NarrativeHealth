-- ============================================
-- P0B: Add rule_versions table
-- Sprint P0 | 2026-08-03
-- IDEMPOTENT: Safe to run multiple times
-- ============================================

CREATE TABLE IF NOT EXISTS rule_versions (
  id                          SERIAL PRIMARY KEY,
  version                     INTEGER NOT NULL,
  description                 TEXT,
  health_weights              JSONB NOT NULL
    DEFAULT '{"trend":0.35,"derivative":0.35,"volume":0.20,"momentum":0.10}',
  confidence_weights          JSONB NOT NULL
    DEFAULT '{"binance_spot":0.40,"binance_futures":0.40,"coingecko":0.20}',
  recommendation_thresholds   JSONB NOT NULL
    DEFAULT '{"strong_watch":90,"watch":80,"observe":65}',
  is_active                   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  activated_at                TIMESTAMP,
  CONSTRAINT rule_versions_version_unique UNIQUE (version)
);

CREATE INDEX IF NOT EXISTS idx_rule_versions_active
  ON rule_versions(is_active)
  WHERE is_active = TRUE;

-- Seed version 1 (default config)
-- ON CONFLICT ensures idempotency
INSERT INTO rule_versions (
  version,
  description,
  health_weights,
  confidence_weights,
  recommendation_thresholds,
  is_active,
  activated_at
) VALUES (
  1,
  'Initial default configuration - migrated from hardcoded values',
  '{"trend":0.35,"derivative":0.35,"volume":0.20,"momentum":0.10}',
  '{"binance_spot":0.40,"binance_futures":0.40,"coingecko":0.20}',
  '{"strong_watch":90,"watch":80,"observe":65}',
  TRUE,
  NOW()
) ON CONFLICT (version) DO NOTHING;