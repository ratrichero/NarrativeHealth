-- Migration 0026: P6-01C-D — Freshness Policies
-- Frozen contract: P6-01C-C (commit 6179135)
-- Adds freshness policy persistence for observation staleness evaluation

CREATE TABLE IF NOT EXISTS p6_freshness_policies (
  id SERIAL PRIMARY KEY,
  source_id VARCHAR(50) NOT NULL REFERENCES p6_source_definitions(source_id),
  metric VARCHAR(50) NOT NULL,
  timeframe VARCHAR(30) NOT NULL,
  expected_interval_ms BIGINT NOT NULL,
  stale_after_ms BIGINT NOT NULL,
  config_version INTEGER NOT NULL REFERENCES p6_registry_config_versions(version),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, metric, timeframe, config_version)
);

CREATE INDEX IF NOT EXISTS p6_freshness_policy_cv_idx ON p6_freshness_policies(config_version);

-- No production seed data — threshold values are PLANNER DECISION REQUIRED.
-- Policies must be explicitly configured before freshness evaluation is active.
