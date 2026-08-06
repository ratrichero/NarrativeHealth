-- ============================================
-- P0 ROLLBACK SCRIPT
-- Run ONLY if migration fails
-- Execute in order shown below
-- ============================================

-- Step 4 first (reverse order, remove dependent columns)
ALTER TABLE narrative_health
  DROP COLUMN IF EXISTS weight_details,
  DROP COLUMN IF EXISTS weighting_method,
  DROP COLUMN IF EXISTS rule_version_id;

DROP INDEX IF EXISTS idx_narrative_health_weighting;
DROP INDEX IF EXISTS idx_narrative_health_rule_version;

-- Step 3
ALTER TABLE recommendations
  DROP COLUMN IF EXISTS rule_version_id;

DROP INDEX IF EXISTS idx_recommendations_rule_version;

-- Step 2
ALTER TABLE health_scores
  DROP COLUMN IF EXISTS rule_version_id;

DROP INDEX IF EXISTS idx_health_scores_rule_version;

-- Step 1 (last - other columns referenced it)
DROP INDEX IF EXISTS idx_rule_versions_active;
DROP TABLE IF EXISTS rule_versions;