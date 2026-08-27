-- Migration: 0030_add_p6_core_tables.sql
-- P6 core pipeline tables: snapshots, regime states, warnings, intelligence summaries
-- Tables defined in src/db/schema.ts but never migrated to production.

-- ====== P6-03: Intelligence Snapshots ======
CREATE TABLE IF NOT EXISTS p6_snapshots (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(20) NOT NULL,
  entity_id INTEGER NOT NULL,
  snapshot_type VARCHAR(30) NOT NULL,
  timeframe VARCHAR(20) NOT NULL DEFAULT 'DAILY',
  window_end TIMESTAMP NOT NULL,
  health_score REAL NOT NULL,
  confidence_score REAL,
  data_completeness REAL,
  status VARCHAR(20) NOT NULL DEFAULT 'CURRENT',
  snapshot_algorithm_version TEXT NOT NULL,
  snapshot_parameter_version TEXT NOT NULL,
  snapshot_schema_version TEXT NOT NULL,
  snapshot_config_hash TEXT NOT NULL,
  feature_version_id INTEGER,
  health_dimensions JSONB,
  quality_metadata JSONB,
  freshness_metadata JSONB,
  provenance JSONB NOT NULL,
  calculation_time TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS p6_snapshots_entity_idx ON p6_snapshots (entity_type, entity_id, snapshot_type);
CREATE INDEX IF NOT EXISTS p6_snapshots_window_idx ON p6_snapshots (window_end);
CREATE UNIQUE INDEX IF NOT EXISTS p6_snapshots_unique ON p6_snapshots (entity_type, entity_id, snapshot_type, window_end);

-- FK to p6_feature_versions (created in 0029)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'p6_snapshots_feature_version_id_fk') THEN
    ALTER TABLE p6_snapshots ADD CONSTRAINT p6_snapshots_feature_version_id_fk
      FOREIGN KEY (feature_version_id) REFERENCES p6_feature_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ====== P6-04: Regime States ======
CREATE TABLE IF NOT EXISTS p6_regime_states (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(20) NOT NULL,
  entity_id INTEGER NOT NULL,
  regime_type VARCHAR(30) NOT NULL DEFAULT 'HEALTH',
  regime_state VARCHAR(30) NOT NULL,
  previous_state VARCHAR(30),
  confidence REAL NOT NULL DEFAULT 0,
  consecutive_count INTEGER NOT NULL DEFAULT 0,
  health_score REAL NOT NULL,
  algorithm_version TEXT NOT NULL,
  parameter_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  snapshot_version_id INTEGER,
  timeframe VARCHAR(20) NOT NULL DEFAULT 'DAILY',
  quality_metadata JSONB,
  freshness_metadata JSONB,
  provenance JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'CURRENT',
  calculation_time TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS p6_regime_entity_idx ON p6_regime_states (entity_type, entity_id, regime_type);
CREATE INDEX IF NOT EXISTS p6_regime_status_idx ON p6_regime_states (status);
CREATE INDEX IF NOT EXISTS p6_regime_calculation_idx ON p6_regime_states (calculation_time);

-- ====== P6-05: Early Warnings ======
CREATE TABLE IF NOT EXISTS p6_warnings (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(20) NOT NULL,
  entity_id INTEGER NOT NULL,
  warning_type VARCHAR(30) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  lifecycle VARCHAR(20) NOT NULL DEFAULT 'DETECTED',
  message TEXT NOT NULL,
  health_score REAL NOT NULL,
  previous_health_score REAL,
  health_delta REAL,
  regime_state VARCHAR(30),
  previous_regime_state VARCHAR(30),
  confidence REAL NOT NULL DEFAULT 0,
  dedup_key TEXT NOT NULL,
  quality_metadata JSONB,
  freshness_metadata JSONB,
  evidence JSONB,
  algorithm_version TEXT NOT NULL,
  parameter_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  provenance JSONB NOT NULL,
  lifecycle_status VARCHAR(20) NOT NULL DEFAULT 'DETECTED',
  detection_window TIMESTAMP NOT NULL,
  detected_at TIMESTAMP NOT NULL,
  effective_from TIMESTAMP NOT NULL,
  effective_until TIMESTAMP,
  superseded_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS p6_warnings_entity_idx ON p6_warnings (entity_type, entity_id, warning_type);
CREATE INDEX IF NOT EXISTS p6_warnings_status_idx ON p6_warnings (lifecycle_status);
CREATE INDEX IF NOT EXISTS p6_warnings_detected_idx ON p6_warnings (detected_at);
CREATE INDEX IF NOT EXISTS p6_warnings_dedup_idx ON p6_warnings (dedup_key);
CREATE UNIQUE INDEX IF NOT EXISTS p6_warnings_dedup_unique ON p6_warnings (dedup_key);

-- ====== P6-06: Intelligence Summaries ======
CREATE TABLE IF NOT EXISTS p6_intelligence_summaries (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(20) NOT NULL,
  entity_id INTEGER NOT NULL,
  timeframe VARCHAR(20) NOT NULL DEFAULT 'DAILY',
  window_end TIMESTAMP NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'CURRENT',
  health_score REAL,
  snapshot_confidence REAL,
  regime_state VARCHAR(30),
  regime_confidence REAL,
  active_warning_count INTEGER NOT NULL DEFAULT 0,
  highest_severity VARCHAR(20),
  active_warnings JSONB NOT NULL DEFAULT '[]',
  health_delta REAL,
  health_change_pct REAL,
  regime_changed BOOLEAN NOT NULL DEFAULT false,
  previous_regime_state VARCHAR(30),
  new_warning_count INTEGER NOT NULL DEFAULT 0,
  resolved_warning_count INTEGER NOT NULL DEFAULT 0,
  what_changed JSONB NOT NULL DEFAULT '[]',
  why_explanation JSONB NOT NULL DEFAULT '[]',
  what_to_watch JSONB NOT NULL DEFAULT '[]',
  quality_metadata JSONB,
  freshness_metadata JSONB,
  algorithm_version TEXT NOT NULL,
  parameter_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  provenance JSONB NOT NULL,
  calculated_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS p6_summaries_entity_idx ON p6_intelligence_summaries (entity_type, entity_id, timeframe);
CREATE INDEX IF NOT EXISTS p6_summaries_status_idx ON p6_intelligence_summaries (status);
CREATE INDEX IF NOT EXISTS p6_summaries_window_idx ON p6_intelligence_summaries (window_end);
CREATE UNIQUE INDEX IF NOT EXISTS p6_summaries_identity_unique ON p6_intelligence_summaries (entity_type, entity_id, timeframe, window_end);
