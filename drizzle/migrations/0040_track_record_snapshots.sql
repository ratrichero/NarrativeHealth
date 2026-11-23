-- Migration: 0040_track_record_snapshots.sql
-- SNAPSHOT-01 — bản chụp công khai theo ngày + chuỗi hash.
--
-- Track record được tính lại mỗi lần đọc, nên cùng một ngày có thể cho hai con
-- số khác nhau sau khi đổi cost/settlement/horizon và không có cách nào chứng
-- minh con số đã công bố hôm qua. Mỗi ngày chốt một dòng bất biến: hash của
-- payload + hash của dòng trước. Sửa một dòng quá khứ làm gãy chuỗi tại đó.
--
-- Append-only, một dòng/ngày: dòng đầu tiên của ngày thắng (ON CONFLICT DO
-- NOTHING) để chạy lại cron không âm thầm viết lại lịch sử.
CREATE TABLE IF NOT EXISTS track_record_snapshots (
  day              date PRIMARY KEY,
  sequence         integer     NOT NULL,
  payload_hash     varchar(64) NOT NULL,
  prev_hash        varchar(64) NOT NULL,
  hash             varchar(64) NOT NULL,
  metrics_version  varchar(40) NOT NULL,
  payload          jsonb       NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS track_record_snapshots_created_idx
  ON track_record_snapshots (created_at);
