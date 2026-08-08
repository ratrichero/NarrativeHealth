CREATE TABLE IF NOT EXISTS indicators (
  id              SERIAL PRIMARY KEY,
  coin_id         INTEGER NOT NULL REFERENCES coins(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  timeframe       VARCHAR(10) NOT NULL,
  indicator_type  VARCHAR(50) NOT NULL,
  indicator_value DECIMAL(20,8),
  indicator_meta  JSONB,
  source          VARCHAR(30),
  calculated_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT indicators_unique
    UNIQUE(coin_id, date, timeframe, indicator_type)
);

CREATE INDEX IF NOT EXISTS idx_indicators_coin_date
  ON indicators(coin_id, date);
CREATE INDEX IF NOT EXISTS idx_indicators_type
  ON indicators(coin_id, indicator_type, date DESC);
