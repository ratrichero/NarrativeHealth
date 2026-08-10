ALTER TABLE p3_narrative_intelligence
  ADD COLUMN IF NOT EXISTS leader_coin_id INTEGER REFERENCES coins(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS leader_score NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS concentration_classification VARCHAR(30);

CREATE TABLE IF NOT EXISTS p3_leadership_members (
  intelligence_id INTEGER NOT NULL REFERENCES p3_narrative_intelligence(id) ON DELETE RESTRICT,
  coin_id INTEGER NOT NULL REFERENCES coins(id) ON DELETE RESTRICT,
  leader_score NUMERIC(9, 6) NOT NULL,
  leader_rank INTEGER NOT NULL,
  leadership_status VARCHAR(30),
  is_emerging_leader BOOLEAN NOT NULL DEFAULT FALSE,
  leader_days_7d INTEGER,
  leader_persistence_7d NUMERIC(9, 8),
  contribution NUMERIC(9, 8) NOT NULL,
  health_score NUMERIC(9, 6) NOT NULL,
  momentum_score NUMERIC(9, 6) NOT NULL,
  relative_strength_score NUMERIC(9, 6) NOT NULL,
  volume_score NUMERIC(9, 6) NOT NULL,
  CONSTRAINT p3_leadership_members_pk PRIMARY KEY (intelligence_id, coin_id),
  CONSTRAINT p3_leadership_members_intelligence_rank_unique UNIQUE (intelligence_id, leader_rank),
  CONSTRAINT p3_leadership_members_rank_positive CHECK (leader_rank > 0),
  CONSTRAINT p3_leadership_members_persistence_range CHECK (leader_persistence_7d IS NULL OR (leader_persistence_7d >= 0 AND leader_persistence_7d <= 1))
);
CREATE INDEX IF NOT EXISTS p3_leadership_members_coin_idx ON p3_leadership_members(coin_id);
CREATE TRIGGER p3_leadership_members_immutable BEFORE UPDATE OR DELETE ON p3_leadership_members FOR EACH ROW EXECUTE FUNCTION prevent_p3_history_mutation();
