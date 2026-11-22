-- Migration: 0038_backtest_horizon_results.sql
-- BT-10: settlement đa horizon, append-only.
--
-- top_recommendation_picks chỉ giữ kết quả của horizon đã chốt (auto-settle
-- 14d). Bảng này ghi thêm kết quả cho MỌI horizon đã đóng window tại thời điểm
-- chốt (7/14/30/60), để so sánh "thắng ở 7d hay chỉ thắng ở 60d" mà không phải
-- tính lại — kết quả đã chốt là bất biến, không UPDATE, chỉ INSERT.
--
-- Unique (pick_id, horizon_days) + ON CONFLICT DO NOTHING làm thao tác idempotent.

CREATE TABLE IF NOT EXISTS backtest_horizon_results (
  id SERIAL PRIMARY KEY,
  pick_id INTEGER NOT NULL REFERENCES top_recommendation_picks(id) ON DELETE CASCADE,
  horizon_days INTEGER NOT NULL,
  outcome VARCHAR(20) NOT NULL,
  exit_r REAL,
  hit_day INTEGER,
  entry_filled BOOLEAN,
  run_id VARCHAR(40),
  evaluated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bt_horizon_results_unique
  ON backtest_horizon_results (pick_id, horizon_days);

CREATE INDEX IF NOT EXISTS bt_horizon_results_horizon_idx
  ON backtest_horizon_results (horizon_days);
