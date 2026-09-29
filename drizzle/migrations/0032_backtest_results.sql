-- Migration: 0032_backtest_results.sql
-- BT-03: Backtest lifecycle + stored results on top_recommendation_picks.
-- Each pick is evaluated AT MOST ONCE:
--   PENDING   — not yet backtested (also: still OPEN, horizon window not closed)
--   EVALUATED — final outcome stored (TP1_WIN / TP2_WIN / SL_LOSS); never re-run
--   EXPIRED   — horizon elapsed with neither TP nor SL hit (NO_HIT); never re-run
--   SKIPPED   — no usable setup (NO_SETUP); never re-run
-- Result columns are written once when the pick leaves PENDING; backtests read
-- the stored results afterwards instead of recomputing.

ALTER TABLE top_recommendation_picks ADD COLUMN IF NOT EXISTS backtest_status VARCHAR(20) NOT NULL DEFAULT 'PENDING';
ALTER TABLE top_recommendation_picks ADD COLUMN IF NOT EXISTS backtest_outcome VARCHAR(20);
ALTER TABLE top_recommendation_picks ADD COLUMN IF NOT EXISTS backtest_exit_r REAL;
ALTER TABLE top_recommendation_picks ADD COLUMN IF NOT EXISTS backtest_hit_day INTEGER;
ALTER TABLE top_recommendation_picks ADD COLUMN IF NOT EXISTS backtest_mfe_pct REAL;
ALTER TABLE top_recommendation_picks ADD COLUMN IF NOT EXISTS backtest_mae_pct REAL;
ALTER TABLE top_recommendation_picks ADD COLUMN IF NOT EXISTS backtest_entry_filled BOOLEAN;
ALTER TABLE top_recommendation_picks ADD COLUMN IF NOT EXISTS backtest_horizon_days INTEGER;
ALTER TABLE top_recommendation_picks ADD COLUMN IF NOT EXISTS backtest_run_id VARCHAR(40);
ALTER TABLE top_recommendation_picks ADD COLUMN IF NOT EXISTS backtest_evaluated_at TIMESTAMP;

-- Existing rows from BT-01 were never backtested — keep them PENDING.
UPDATE top_recommendation_picks SET backtest_status = 'PENDING' WHERE backtest_status IS NULL;

CREATE INDEX IF NOT EXISTS top_rec_picks_bt_status_idx ON top_recommendation_picks (backtest_status);
