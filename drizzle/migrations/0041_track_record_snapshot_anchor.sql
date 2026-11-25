-- Migration: 0041_track_record_snapshot_anchor.sql
-- SNAPSHOT-02 — rút bản chụp về `payload_hash` + neo `head_hash`.
--
-- 0040 lưu cả chuỗi (sequence, prev_hash, hash). Chuỗi nội bộ chỉ bắt được sửa
-- cục bộ — ai ghi được DB cũng tính lại được cả chuỗi — nên phần giữ lại chỉ
-- cần: hash của payload (kiểm lại được từ payload) và head hash để in ra NGOÀI
-- mỗi lần chốt. Head của dòng cũ chính là `hash` cũ (cùng công thức nối chuỗi),
-- nên dữ liệu đã có (nếu 0040 từng chạy) được giữ nguyên giá trị.
ALTER TABLE track_record_snapshots ADD COLUMN IF NOT EXISTS head_hash varchar(64);

-- Backfill CHỈ khi cột `hash` của 0040 còn tồn tại.
--
-- Vì sao phải kiểm tra: file này drop `hash` ở cuối, nên lần chạy thứ hai (chạy
-- tay, hoặc `scripts/migrate-raw.ts` chạy lại khi nội dung file đổi) sẽ chết ở
-- `column "hash" does not exist` — đúng lúc cần migration nhất. Postgres không
-- có `UPDATE ... IF COLUMN EXISTS`, nên điều kiện đọc từ information_schema và
-- câu UPDATE được EXECUTE động chỉ khi cột còn.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'track_record_snapshots'
       AND column_name = 'hash'
  ) THEN
    EXECUTE 'UPDATE track_record_snapshots SET head_hash = hash WHERE head_hash IS NULL';
  END IF;
END
$$;

ALTER TABLE track_record_snapshots ALTER COLUMN head_hash SET NOT NULL;

ALTER TABLE track_record_snapshots DROP COLUMN IF EXISTS sequence;
ALTER TABLE track_record_snapshots DROP COLUMN IF EXISTS prev_hash;
ALTER TABLE track_record_snapshots DROP COLUMN IF EXISTS hash;
