CREATE TABLE IF NOT EXISTS morning_snapshot_headers (
  id               SERIAL PRIMARY KEY,
  date             DATE NOT NULL UNIQUE,
  total_coins      INTEGER,
  avg_health_score DECIMAL(5,2),
  top_narrative_id INTEGER REFERENCES narratives(id),
  alert_count      INTEGER DEFAULT 0,
  rule_version_id  INTEGER REFERENCES rule_versions(id),
  timezone         VARCHAR(50) DEFAULT 'Asia/Ho_Chi_Minh',
  created_at       TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS morning_snapshot_coins (
  id           SERIAL PRIMARY KEY,
  snapshot_id  INTEGER NOT NULL
    REFERENCES morning_snapshot_headers(id) ON DELETE CASCADE,
  coin_id      INTEGER NOT NULL REFERENCES coins(id),
  health_score DECIMAL(5,2),
  score_change DECIMAL(5,2),
  signal       VARCHAR(20),
  confidence   DECIMAL(5,2),
  UNIQUE(snapshot_id, coin_id)
);

CREATE TABLE IF NOT EXISTS morning_snapshot_narratives (
  id              SERIAL PRIMARY KEY,
  snapshot_id     INTEGER NOT NULL
    REFERENCES morning_snapshot_headers(id) ON DELETE CASCADE,
  narrative_id    INTEGER NOT NULL REFERENCES narratives(id),
  health_score    DECIMAL(5,2),
  score_change    DECIMAL(5,2),
  coin_count      INTEGER,
  top_coin_id     INTEGER REFERENCES coins(id),
  weakest_coin_id INTEGER REFERENCES coins(id),
  weighting_method VARCHAR(20),
  UNIQUE(snapshot_id, narrative_id)
);

CREATE INDEX IF NOT EXISTS idx_snap_coins_snapshot
  ON morning_snapshot_coins(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snap_narratives_snapshot
  ON morning_snapshot_narratives(snapshot_id);
