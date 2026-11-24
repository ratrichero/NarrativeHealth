-- Migration: 0041_track_record_snapshot_anchor.sql
-- SNAPSHOT-02 — rút bản chụp về `payload_hash` + neo `head_hash`.
--
-- 0040 lưu cả chuỗi (sequence, prev_hash, hash). Chuỗi nội bộ chỉ bắt được sửa
-- cục bộ — ai ghi được DB cũng tính lại được cả chuỗi — nên phần giữ lại chỉ
-- cần: hash của payload (kiểm lại được từ payload) và head hash để in ra NGOÀI
-- mỗi lần chốt. Head của dòng cũ chính là `hash` cũ (cùng công thức nối chuỗi),
-- nên dữ liệu đã có (nếu 0040 từng chạy) được giữ nguyên giá trị.
ALTER TABLE track_record_snapshots ADD COLUMN IF NOT EXISTS head_hash varchar(64);

UPDATE track_record_snapshots SET head_hash = hash WHERE head_hash IS NULL;

ALTER TABLE track_record_snapshots ALTER COLUMN head_hash SET NOT NULL;

ALTER TABLE track_record_snapshots DROP COLUMN IF EXISTS sequence;
ALTER TABLE track_record_snapshots DROP COLUMN IF EXISTS prev_hash;
ALTER TABLE track_record_snapshots DROP COLUMN IF EXISTS hash;
