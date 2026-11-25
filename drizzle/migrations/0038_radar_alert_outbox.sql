-- Migration: 0038_radar_alert_outbox.sql
-- RADAR-TG P2: outbox cho alert Radar (Telegram + webhook).
--
-- Lý do: P1 gửi thẳng trong dispatch; Telegram 429/5xx hay webhook sập một lần
-- là alert mất vì không có bản ghi để thử lại. Outbox ghi PENDING trước khi
-- gửi, job `radar_alert_outbox` (FastAPI, 1 phút) gửi/retry theo backoff
-- 30s → 2m → 10m, tôn trọng `retry_after` khi Telegram trả 429, tối đa 4 lần.
--
-- Mỗi dòng = một (alert, kênh, đích). Cap ngày/kênh đếm các dòng SENT theo
-- `target_key`; vượt cap thì dòng chuyển SUPPRESSED thay vì gửi.
--
-- Idempotent: CREATE IF NOT EXISTS + unique (alert_key, channel, target_key),
-- nên chạy lại migration và enqueue trùng đều an toàn.

CREATE TABLE IF NOT EXISTS radar_alert_outbox (
  id               bigserial PRIMARY KEY,
  alert_key        varchar(160) NOT NULL,
  channel          varchar(16)  NOT NULL,
  target_key       varchar(160) NOT NULL,
  payload          jsonb        NOT NULL,
  status           varchar(12)  NOT NULL DEFAULT 'PENDING',
  attempts         integer      NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz  NOT NULL DEFAULT now(),
  last_error       text,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  sent_at          timestamptz
);

-- Một alert chỉ vào outbox một lần cho mỗi kênh đích.
CREATE UNIQUE INDEX IF NOT EXISTS radar_alert_outbox_key_target_unique
  ON radar_alert_outbox (alert_key, channel, target_key);

-- Job drain quét theo (status, next_attempt_at).
CREATE INDEX IF NOT EXISTS radar_alert_outbox_due_idx
  ON radar_alert_outbox (status, next_attempt_at);

-- Cap ngày/kênh đếm SENT theo target_key + sent_at.
CREATE INDEX IF NOT EXISTS radar_alert_outbox_sent_idx
  ON radar_alert_outbox (target_key, sent_at);
