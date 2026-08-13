-- ============================================
-- P3-10E: Add P3 score_configs table and seed Regime/Rotation thresholds v1
-- Sprint P3 | 2026-08-10
-- IDEMPOTENT: Safe to run multiple times
-- COMPATIBILITY: Modified for existing score_configs table in production
-- ============================================

-- Create score_configs table if not exists
CREATE TABLE IF NOT EXISTS score_configs (
  id SERIAL PRIMARY KEY,
  config_type VARCHAR(50) NOT NULL,
  config_key VARCHAR(100) NOT NULL,
  config_value JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT score_configs_config_type_key_version_unique UNIQUE (config_type, config_key, version)
);

-- Add indexes (IF NOT EXISTS works for indexes)
CREATE INDEX IF NOT EXISTS idx_score_configs_active
  ON score_configs(is_active)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_score_configs_type_key
  ON score_configs(config_type, config_key);

-- Add constraint with DO block for conditional creation (for production compatibility)
-- Note: The UNIQUE constraint is already created in the CREATE TABLE statement above
-- This DO block is only needed if the table already exists without the constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'score_configs_config_type_key_version_unique'
    AND conrelid = 'score_configs'::regclass
  ) THEN
    ALTER TABLE score_configs
    ADD CONSTRAINT score_configs_config_type_key_version_unique
    UNIQUE (config_type, config_key, version);
  END IF;
END $$;

-- Seed P3 Regime Thresholds v1
-- Configuration identity: configType=P3, configKey=regime_thresholds, version=1
INSERT INTO score_configs (
  config_type,
  config_key,
  config_value,
  version,
  is_active,
  description
) VALUES (
  'P3',
  'regime_thresholds',
  '{
    "healthHigh": 70,
    "healthLow": 35,
    "breadthHigh": 0.60,
    "breadthLow": 0.35,
    "momentumPositive": 0.05,
    "momentumNegative": -0.05,
    "accelerationDeclining": 0,
    "healthImproving": 0,
    "breadthIncreasing": 0,
    "relativeStrengthImproving": 0,
    "relativeStrengthPositive": 0.05,
    "relativeStrengthNegative": -0.05,
    "healthDeclining": 0,
    "breadthDeclining": 0,
    "momentumWeakening": -0.05
  }',
  1,
  TRUE,
  'P3 Regime classification thresholds v1 - approved business parameters'
) ON CONFLICT (config_type, config_key, version) DO NOTHING;

-- Seed P3 Rotation Thresholds v1
-- Configuration identity: configType=P3, configKey=rotation_thresholds, version=1
-- Classification: >=70 ACCELERATING, 55-<70 INFLOW, 45-<55 STABLE, 30-<45 DECELERATING, <30 OUTFLOW
INSERT INTO score_configs (
  config_type,
  config_key,
  config_value,
  version,
  is_active,
  description
) VALUES (
  'P3',
  'rotation_thresholds',
  '{
    "acceleratingMin": 70,
    "inflowMin": 55,
    "stableMin": 45,
    "deceleratingMin": 30
  }',
  1,
  TRUE,
  'P3 Rotation classification thresholds v1 - approved business parameters'
) ON CONFLICT (config_type, config_key, version) DO NOTHING;
