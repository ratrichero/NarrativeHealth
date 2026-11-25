-- Migration: 0039_radar_alert_metrics.sql
-- RADAR-ALERT-METRICS: đo hiệu quả alert trên đúng hệ outcome sẵn có.
--
-- 1) radar_alert_outbox.bias_log_id — mỗi alert trỏ tới row `radar_bias_log`
--    của lượt cohort sinh ra nó; `tier` (URGENT/ACTIONABLE/WATCH) để thống kê
--    sent/failed/suppressed theo tầng. p95 detection→delivery = sent_at -
--    bias_log.logged_at (fallback created_at).
-- 2) radar_bias_outcome.atr_multiple / invalidation_hit — job outcome hiện có
--    (1h/4h/24h/3d/7d) tính thêm: MFE/ATR của row log và giá trong horizon có
--    chạm invalidation_price của row log hay không. Không tạo bảng đo mới.

ALTER TABLE radar_alert_outbox
  ADD COLUMN IF NOT EXISTS bias_log_id bigint;

ALTER TABLE radar_alert_outbox
  ADD COLUMN IF NOT EXISTS tier varchar(12);

CREATE INDEX IF NOT EXISTS radar_alert_outbox_bias_log_idx
  ON radar_alert_outbox (bias_log_id);

CREATE INDEX IF NOT EXISTS radar_alert_outbox_tier_idx
  ON radar_alert_outbox (tier, status, created_at);

ALTER TABLE radar_bias_outcome
  ADD COLUMN IF NOT EXISTS atr_multiple real;

ALTER TABLE radar_bias_outcome
  ADD COLUMN IF NOT EXISTS invalidation_hit boolean;
