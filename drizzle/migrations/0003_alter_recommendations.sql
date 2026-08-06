-- ============================================
-- P0B: Add rule_version_id to recommendations
-- Requires: 0001_add_rule_versions.sql
-- IDEMPOTENT: IF NOT EXISTS guards
-- ============================================

ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS rule_version_id INTEGER
    REFERENCES rule_versions(id) ON DELETE SET NULL;

UPDATE recommendations
  SET rule_version_id = (
    SELECT id FROM rule_versions
    WHERE version = 1 LIMIT 1
  )
  WHERE rule_version_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_recommendations_rule_version
  ON recommendations(rule_version_id);