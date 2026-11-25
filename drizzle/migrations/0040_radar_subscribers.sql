-- Migration: 0040_radar_subscribers.sql
-- RADAR-TG P4: bot tự phục vụ cho kênh/group của người dùng.
--
-- /start  → upsert ACTIVE (chat_id, thread_id)
-- /stop   → status STOPPED
-- /settings → đọc trạng thái/ngưỡng của chat
--
-- thread_id = 0 khi chat không có topic. Unique (chat_id, thread_id) chặn
-- đăng ký trùng khi /start gửi nhiều lần hoặc retry webhook.
-- `min_score` null = dùng ngưỡng alert chung; set riêng được cho kênh công khai
-- chặt hơn DM.
--
-- Idempotent: CREATE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS radar_subscribers (
  id                bigserial PRIMARY KEY,
  chat_id           varchar(32)  NOT NULL,
  thread_id         integer      NOT NULL DEFAULT 0,
  chat_type         varchar(20),
  title             varchar(200),
  telegram_user_id  varchar(32),
  status            varchar(12)  NOT NULL DEFAULT 'ACTIVE',
  min_score         integer,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS radar_subscribers_chat_thread_unique
  ON radar_subscribers (chat_id, thread_id);

CREATE INDEX IF NOT EXISTS radar_subscribers_status_idx
  ON radar_subscribers (status);
