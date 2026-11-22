-- TRACK-01 ORIGIN-01 — nguồn gốc hàng pick, ghi lúc insert.
--
-- Heuristic picked_at − data_date ≤ 1 ngày không phân biệt được pick live thật
-- với lượt chạy bù cho ngày hôm trước: cả hai đều được ghi vào sáng hôm sau.
-- Cột này lưu ý định của lượt ghi (`live` = chạy đúng ngày dữ liệu,
-- `backfill` = chạy bù). NULL = hàng cũ trước migration → vẫn phân loại bằng
-- heuristic picked_at như trước, không suy đoán thêm.
--
-- Idempotent: chạy lại không lỗi, không rewrite bảng (không DEFAULT).
ALTER TABLE top_recommendation_picks
  ADD COLUMN IF NOT EXISTS picked_origin varchar(10);
