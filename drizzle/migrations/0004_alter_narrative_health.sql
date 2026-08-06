-- ============================================
-- P0A + P0B: Enhance narrative_health table
-- Requires: 0001_add_rule_versions.sql
-- Adds: rule_version_id, weighting_method, weight_details
-- ============================================

ALTER TABLE narrative_health
  ADD COLUMN IF NOT EXISTS rule_version_id INTEGER
    REFERENCES rule_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS weighting_method VARCHAR(20)
    NOT NULL DEFAULT 'equal',
  ADD COLUMN IF NOT EXISTS weight_details JSONB;

-- Backfill rule_version_id
UPDATE narrative_health
  SET rule_version_id = (
    SELECT id FROM rule_versions
    WHERE version = 1 LIMIT 1
  )
  WHERE rule_version_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_narrative_health_rule_version
  ON narrative_health(rule_version_id);

CREATE INDEX IF NOT EXISTS idx_narrative_health_weighting
  ON narrative_health(weighting_method);