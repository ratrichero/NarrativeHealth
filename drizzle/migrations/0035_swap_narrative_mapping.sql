-- Migration: 0035_swap_narrative_mapping.sql
-- COIN-02: Đổi narrative cho 19 coin mới thêm ở 0034 theo yêu cầu owner:
--   * Majors & L1 (BNB, ADA, AVAX, TON, DOT, ATOM, SUI, APT, SEI, HBAR, INJ, TIA)
--     : FAVORITE → TOPMC
--   * Memecoin (DOGE, SHIB, PEPE, WIF, BONK, FLOKI, TRUMP)
--     : TOPMC → FAVORITE
--
-- Cách làm: INSERT mapping mới (nếu chưa có) rồi DELETE mapping cũ — điều kiện
-- "chỉ còn đúng 1 membership sau khi insert" bảo đảm coin không bao giờ nằm
-- ở 2 narrative cùng lúc. Idempotent: chạy lại không đổi gì thêm.
-- Join narrative theo TÊN (ổn định giữa các môi trường), chỉ map coin ACTIVE.

-- ===== 1. Majors & L1: FAVORITE → TOPMC =====
INSERT INTO coin_narratives (coin_id, narrative_id, is_primary)
SELECT c.id, n_new.id, true
FROM coins c
JOIN narratives n_old ON n_old.name = 'FAVORITE' AND n_old.is_active = true
JOIN narratives n_new ON n_new.name = 'TOPMC'    AND n_new.is_active = true
JOIN coin_narratives cn ON cn.coin_id = c.id AND cn.narrative_id = n_old.id
WHERE c.is_active = true
  AND c.symbol IN ('BNB','ADA','AVAX','TON','DOT','ATOM','SUI','APT','SEI','HBAR','INJ','TIA')
  -- chỉ insert khi coin CHƯA có membership TOPMC (tránh dual-membership)
  AND NOT EXISTS (
    SELECT 1 FROM coin_narratives cn2
    WHERE cn2.coin_id = c.id AND cn2.narrative_id = n_new.id
  );

DELETE FROM coin_narratives cn
USING coins c, narratives n_old
WHERE cn.coin_id = c.id
  AND cn.narrative_id = n_old.id
  AND n_old.name = 'FAVORITE' AND n_old.is_active = true
  AND c.is_active = true
  AND c.symbol IN ('BNB','ADA','AVAX','TON','DOT','ATOM','SUI','APT','SEI','HBAR','INJ','TIA')
  -- chỉ xóa membership cũ khi coin ĐÃ có membership TOPMC
  AND EXISTS (
    SELECT 1 FROM coin_narratives cn2
    JOIN narratives n_new ON n_new.id = cn2.narrative_id AND n_new.is_active = true
    WHERE cn2.coin_id = c.id AND n_new.name = 'TOPMC'
  );

-- ===== 2. Memecoin: TOPMC → FAVORITE =====
INSERT INTO coin_narratives (coin_id, narrative_id, is_primary)
SELECT c.id, n_new.id, true
FROM coins c
JOIN narratives n_old ON n_old.name = 'TOPMC'    AND n_old.is_active = true
JOIN narratives n_new ON n_new.name = 'FAVORITE' AND n_new.is_active = true
JOIN coin_narratives cn ON cn.coin_id = c.id AND cn.narrative_id = n_old.id
WHERE c.is_active = true
  AND c.symbol IN ('DOGE','SHIB','PEPE','WIF','BONK','FLOKI','TRUMP')
  AND NOT EXISTS (
    SELECT 1 FROM coin_narratives cn2
    WHERE cn2.coin_id = c.id AND cn2.narrative_id = n_new.id
  );

DELETE FROM coin_narratives cn
USING coins c, narratives n_old
WHERE cn.coin_id = c.id
  AND cn.narrative_id = n_old.id
  AND n_old.name = 'TOPMC' AND n_old.is_active = true
  AND c.is_active = true
  AND c.symbol IN ('DOGE','SHIB','PEPE','WIF','BONK','FLOKI','TRUMP')
  AND EXISTS (
    SELECT 1 FROM coin_narratives cn2
    JOIN narratives n_new ON n_new.id = cn2.narrative_id AND n_new.is_active = true
    WHERE cn2.coin_id = c.id AND n_new.name = 'FAVORITE'
  );
