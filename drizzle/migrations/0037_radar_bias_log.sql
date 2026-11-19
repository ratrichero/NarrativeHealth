-- Migration: 0037_radar_bias_log.sql
-- RADAR-BIAS-LOG: nhật ký append-only của mọi row radar + outcome nhiều horizon.
--
-- Lý do: ledger `app_settings.radar.signals` chỉ ghi cohort 12/side, cap 500 dòng,
-- giữ 8 ngày và dedupe theo ngày — không đủ để backtest/ML và không lưu feature
-- đầu vào. Bảng này ghi mọi row của 3 snapshot mỗi lượt cohort (30 phút), giữ cả
-- feature của scoring để trả lời "điều kiện nào sai", không chỉ "bias đúng/sai".
--
-- Append-only: writer không UPDATE/DELETE bản ghi log. Outcome nằm ở bảng riêng
-- (radar_bias_outcome), mỗi (log_id, horizon) một dòng, chỉ thêm khi horizon đủ tuổi.
-- Idempotent: CREATE IF NOT EXISTS + unique (symbol, side, logged_at) và
-- (log_id, horizon), nên chạy lại migration hoặc job trùng đều an toàn.

CREATE TABLE IF NOT EXISTS radar_bias_log (
  id                        bigserial PRIMARY KEY,
  logged_at                 timestamptz NOT NULL,
  symbol                    varchar(20) NOT NULL,
  side                      varchar(10) NOT NULL,
  price                     real        NOT NULL,
  bias                      varchar(20) NOT NULL,
  prev_bias                 varchar(20),
  bias_changed              boolean     NOT NULL DEFAULT false,
  score                     integer     NOT NULL,
  entry_quality             integer     NOT NULL,
  composite                 integer,
  cluster_id                varchar(80),
  cluster_label             varchar(200),
  cluster_size              integer,
  cluster_leader            boolean,
  cluster_laggard           boolean,
  btc_price                 real,
  regime                    varchar(16),
  change_pct                real,
  change_atr_multiple       real,
  funding_rate              real,
  oi_change_pct             real,
  rsi14                     real,
  ema20                     real,
  ema50                     real,
  volume_z                  real,
  volume_ratio_7d           real,
  range_position            real,
  range_pct_7d              real,
  distance_from_high_pct    real,
  distance_from_7d_high_pct real,
  impulse_age_hours         real,
  atr_pct                   real,
  listing_age_days          integer,
  is_breakout_7d            boolean,
  spot_led                  boolean,
  relative_strength_pct     real,
  catalyst_triggered        boolean,
  invalidation_price        real,
  engine_version            varchar(16) NOT NULL DEFAULT 'v1'
);

-- Một dòng/(symbol, side, lượt cohort): job chạy lại cùng mốc thời gian không nhân bản.
CREATE UNIQUE INDEX IF NOT EXISTS radar_bias_log_run_unique
  ON radar_bias_log (symbol, side, logged_at);

-- Job outcome quét theo thời gian; prev_bias tra theo (symbol, side, logged_at).
CREATE INDEX IF NOT EXISTS radar_bias_log_logged_idx
  ON radar_bias_log (logged_at);

CREATE INDEX IF NOT EXISTS radar_bias_log_symbol_side_idx
  ON radar_bias_log (symbol, side, logged_at);

CREATE INDEX IF NOT EXISTS radar_bias_log_bias_idx
  ON radar_bias_log (bias);

CREATE TABLE IF NOT EXISTS radar_bias_outcome (
  id             bigserial PRIMARY KEY,
  log_id         bigint      NOT NULL REFERENCES radar_bias_log(id) ON DELETE CASCADE,
  horizon        varchar(4)  NOT NULL,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  close_pct      real,
  btc_return_pct real,
  relative_pct   real,
  mfe_pct        real,
  mae_pct        real,
  win            boolean
);

CREATE UNIQUE INDEX IF NOT EXISTS radar_bias_outcome_log_horizon_unique
  ON radar_bias_outcome (log_id, horizon);

CREATE INDEX IF NOT EXISTS radar_bias_outcome_horizon_idx
  ON radar_bias_outcome (horizon);
