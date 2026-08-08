CREATE TABLE IF NOT EXISTS coin_correlations (
  id              SERIAL PRIMARY KEY,
  date            DATE NOT NULL,
  coin_id_a       INTEGER NOT NULL REFERENCES coins(id),
  coin_id_b       INTEGER NOT NULL REFERENCES coins(id),
  correlation     DECIMAL(5,4),
  period_days     INTEGER DEFAULT 30,
  created_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(date, coin_id_a, coin_id_b, period_days)
);

CREATE INDEX IF NOT EXISTS idx_coin_correlations_date
  ON coin_correlations(date);
CREATE INDEX IF NOT EXISTS idx_coin_correlations_coins
  ON coin_correlations(coin_id_a, coin_id_b);
