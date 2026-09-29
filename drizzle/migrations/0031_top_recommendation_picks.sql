-- Migration: 0031_top_recommendation_picks.sql
-- BT-01: Persistence cho 6 khuyến nghị dashboard (3 LONG + 3 SHORT) kèm setup
-- levels (entry/TP/SL) để chạy backtest đo hiệu quả hệ thống sau này.
-- Ghi từ GET /api/dashboard/top-recommendations — nguồn duy nhất của logic chọn,
-- idempotent theo (data_date, coin_id): pick mới → INSERT, pick đổi → UPDATE
-- (giữ picked_at, refresh updated_at → đo được độ ổn định pick trong ngày).

-- ====== top_recommendation_picks ======
CREATE TABLE IF NOT EXISTS top_recommendation_picks (
  id SERIAL PRIMARY KEY,
  data_date DATE NOT NULL,
  coin_id INTEGER NOT NULL REFERENCES coins(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  slot INTEGER NOT NULL DEFAULT 0,
  pick_kind VARCHAR(20) NOT NULL DEFAULT 'GENUINE',
  direction VARCHAR(10) NOT NULL,
  signal VARCHAR(30) NOT NULL,
  health_score REAL,
  score_change REAL,
  current_price DECIMAL(24,8),
  has_setup BOOLEAN NOT NULL DEFAULT false,
  entry_low DECIMAL(24,8),
  entry_high DECIMAL(24,8),
  entry_mid DECIMAL(24,8),
  tp1 DECIMAL(24,8),
  tp2 DECIMAL(24,8),
  stop_loss DECIMAL(24,8),
  risk_reward_ratio REAL,
  tp1_move_pct REAL,
  sl_risk_pct REAL,
  atr14 DECIMAL(24,8),
  atr_source VARCHAR(30),
  narrative_name VARCHAR(100),
  metrics JSONB,
  setup_unavailable_reason TEXT,
  picked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS top_rec_picks_unique ON top_recommendation_picks (data_date, coin_id);
CREATE INDEX IF NOT EXISTS top_rec_picks_date_idx ON top_recommendation_picks (data_date);
CREATE INDEX IF NOT EXISTS top_rec_picks_coin_idx ON top_recommendation_picks (coin_id);
