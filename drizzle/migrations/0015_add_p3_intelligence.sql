CREATE TABLE IF NOT EXISTS p3_narrative_intelligence (
  id SERIAL PRIMARY KEY,
  narrative_id INTEGER NOT NULL REFERENCES narratives(id) ON DELETE RESTRICT,
  window_end TIMESTAMP NOT NULL,
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  algorithm_key VARCHAR(100) NOT NULL,
  algorithm_version VARCHAR(50) NOT NULL,
  rule_version_id INTEGER REFERENCES rule_versions(id) ON DELETE RESTRICT,
  feature_version_id INTEGER REFERENCES feature_versions(id) ON DELETE RESTRICT,
  score_config_id INTEGER REFERENCES score_configs(id) ON DELETE RESTRICT,
  calculation_mode VARCHAR(30) NOT NULL DEFAULT 'observed',
  availability_state VARCHAR(30) NOT NULL,
  confidence NUMERIC(7, 4),
  breadth NUMERIC(9, 6),
  strong_breadth NUMERIC(9, 6),
  momentum_1d NUMERIC(12, 6), momentum_3d NUMERIC(12, 6), momentum_7d NUMERIC(12, 6), momentum_14d NUMERIC(12, 6),
  acceleration NUMERIC(12, 6),
  relative_strength_1d NUMERIC(12, 6), relative_strength_3d NUMERIC(12, 6), relative_strength_7d NUMERIC(12, 6), relative_strength_14d NUMERIC(12, 6),
  concentration_top1 NUMERIC(9, 6), concentration_top3 NUMERIC(9, 6),
  regime VARCHAR(30), rotation VARCHAR(30), explanation JSONB, provenance JSONB NOT NULL,
  calculated_at TIMESTAMP NOT NULL, persisted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT p3_narrative_intelligence_identity_unique UNIQUE (narrative_id, window_end, algorithm_key, algorithm_version, calculation_mode)
);
CREATE INDEX IF NOT EXISTS p3_narrative_intelligence_narrative_window_idx ON p3_narrative_intelligence(narrative_id, window_end);
CREATE INDEX IF NOT EXISTS p3_narrative_intelligence_algorithm_idx ON p3_narrative_intelligence(algorithm_key, algorithm_version);
CREATE INDEX IF NOT EXISTS p3_narrative_intelligence_window_idx ON p3_narrative_intelligence(window_end);
CREATE TABLE IF NOT EXISTS p3_constituent_snapshots (
  id SERIAL PRIMARY KEY,
  intelligence_id INTEGER NOT NULL REFERENCES p3_narrative_intelligence(id) ON DELETE RESTRICT,
  captured_at TIMESTAMP NOT NULL,
  membership_source VARCHAR(40) NOT NULL,
  membership_mode VARCHAR(30) NOT NULL,
  member_count INTEGER NOT NULL,
  eligible_count INTEGER NOT NULL,
  provenance JSONB NOT NULL,
  CONSTRAINT p3_constituent_snapshot_intelligence_unique UNIQUE (intelligence_id)
);
CREATE INDEX IF NOT EXISTS p3_constituent_snapshot_captured_idx ON p3_constituent_snapshots(captured_at);
CREATE TABLE IF NOT EXISTS p3_constituent_snapshot_members (
  snapshot_id INTEGER NOT NULL REFERENCES p3_constituent_snapshots(id) ON DELETE RESTRICT,
  coin_id INTEGER NOT NULL REFERENCES coins(id) ON DELETE RESTRICT,
  membership_state VARCHAR(30) NOT NULL,
  inclusion_reason VARCHAR(100),
  availability_state VARCHAR(30) NOT NULL,
  input_manifest JSONB,
  CONSTRAINT p3_constituent_snapshot_members_snapshot_id_coin_id_pk PRIMARY KEY (snapshot_id, coin_id)
);
CREATE INDEX IF NOT EXISTS p3_constituent_snapshot_members_coin_idx ON p3_constituent_snapshot_members(coin_id);

CREATE OR REPLACE FUNCTION prevent_p3_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'P3 historical records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER p3_narrative_intelligence_immutable
BEFORE UPDATE OR DELETE ON p3_narrative_intelligence
FOR EACH ROW EXECUTE FUNCTION prevent_p3_history_mutation();

CREATE TRIGGER p3_constituent_snapshots_immutable
BEFORE UPDATE OR DELETE ON p3_constituent_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_p3_history_mutation();

CREATE TRIGGER p3_constituent_snapshot_members_immutable
BEFORE UPDATE OR DELETE ON p3_constituent_snapshot_members
FOR EACH ROW EXECUTE FUNCTION prevent_p3_history_mutation();