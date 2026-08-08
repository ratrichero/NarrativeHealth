CREATE TABLE IF NOT EXISTS decision_signals (
  id              SERIAL PRIMARY KEY,
  coin_id         INTEGER NOT NULL REFERENCES coins(id),
  date            DATE NOT NULL,
  base_health     DECIMAL(5,2),
  event_risk_score DECIMAL(5,2),
  adjusted_score  DECIMAL(5,2),
  adjustment_reason TEXT,
  active_events   JSONB,
  created_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(coin_id, date)
);

CREATE INDEX IF NOT EXISTS idx_decision_signals_coin_date
  ON decision_signals(coin_id, date);
