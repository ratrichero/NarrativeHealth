-- Migration: 0033_pick_episode_dedup.sql
-- BT-04: Episode dedup cho top_recommendation_picks.
-- Refresh chạy sát nhau thường tạo ra CÙNG MỘT setup cho cùng coin (giá/ATR
-- gần như không đổi) — không được tạo row backtest mới cho mỗi lần lặp.
-- persistTopPicks giờ so pick mới với pick PENDING gần nhất của coin: cùng
-- episode (cùng direction + cùng levels) → KHÔNG insert, chỉ bump
-- repeat_count + last_repeat_at trên row gốc (backtest dùng data_date đầu).

ALTER TABLE top_recommendation_picks ADD COLUMN IF NOT EXISTS repeat_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE top_recommendation_picks ADD COLUMN IF NOT EXISTS last_repeat_at TIMESTAMP;
