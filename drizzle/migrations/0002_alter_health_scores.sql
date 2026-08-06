-- ============================================
-- P0B: Add rule_version_id to health_scores
-- Requires: 0001_add_rule_versions.sql
-- IDEMPOTENT: IF NOT EXISTS guards
-- ============================================

ALTER TABLE health_scores
  ADD COLUMN IF NOT EXISTS rule_version_id INTEGER
    REFERENCES rule_versions(id) ON DELETE SET NULL;

-- Backfill existing records with version 1
UPDATE health_scores
  SET rule_version_id = (
    SELECT id FROM rule_versions
    WHERE version = 1 LIMIT 1
  )
  WHERE rule_version_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_health_scores_rule_version
  ON health_scores(rule_version_id);