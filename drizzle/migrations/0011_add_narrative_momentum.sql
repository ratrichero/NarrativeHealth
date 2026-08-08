CREATE TABLE IF NOT EXISTS narrative_momentum (
  id              SERIAL PRIMARY KEY,
  narrative_id    INTEGER NOT NULL REFERENCES narratives(id),
  date            DATE NOT NULL,
  momentum_score  DECIMAL(5,2),
  momentum_type   VARCHAR(20),
  health_7d_ago   DECIMAL(5,2),
  health_now      DECIMAL(5,2),
  created_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(narrative_id, date)
);

CREATE INDEX IF NOT EXISTS idx_narrative_momentum_narrative
  ON narrative_momentum(narrative_id);
