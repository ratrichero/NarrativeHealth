CREATE TABLE IF NOT EXISTS event_risks (
  id              SERIAL PRIMARY KEY,
  coin_id         INTEGER REFERENCES coins(id),
  narrative_id    INTEGER REFERENCES narratives(id),
  event_type      VARCHAR(30) NOT NULL,
  event_date      DATE NOT NULL,
  risk_level      VARCHAR(10) NOT NULL,
  risk_score      DECIMAL(5,2),
  title           VARCHAR(200) NOT NULL,
  description     TEXT,
  source_url      TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW(),
  expires_at      DATE
);

CREATE INDEX IF NOT EXISTS idx_event_risks_coin
  ON event_risks(coin_id);
CREATE INDEX IF NOT EXISTS idx_event_risks_narrative
  ON event_risks(narrative_id);
CREATE INDEX IF NOT EXISTS idx_event_risks_date
  ON event_risks(event_date);
