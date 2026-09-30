-- Migration: 0034_seed_coins_to_100.sql
-- COIN-01: Mở rộng danh sách coin theo dõi từ 49 lên ~100.
--
-- Thiết kế:
--   * 0a — ETHFI bị seed trùng 2 dòng (id 23 + 31, đều active): deactivate dòng
--     id lớn, giữ lịch sử nguyên vẹn (bảng P3 có trigger immutability + FK
--     RESTRICT nên KHÔNG thể DELETE coin trùng — chỉ deactivate được).
--   * 0b — partial unique index coins(symbol) WHERE is_active để chặn trùng
--     active từ giờ sau (schema.ts có unique trong Drizzle nhưng DB thật chưa có
--     constraint nào trên symbol).
--   * Seed 52 coin mới: mỗi coin đều có pair Binance (spot và/hoặc futures).
--     ON CONFLICT trỏ đúng partial index → idempotent, chạy lại an toàn.
--   * Map narrative qua TÊN narrative hiện có (AI, RWA, TOPMC, FAVORITE,
--     RESTAKING, LAYER 2, DEFI / DEX, PAYFI & STABLE) — ổn định giữa các môi
--     trường, ON CONFLICT DO NOTHING trên PK (coin_id, narrative_id).
--
-- Coins đã loại khỏi danh sách ứng viên vì không có/không còn pair Binance:
--   RNDR (đổi tên RENDER 07/2024 — coin RENDER đã có sẵn), BOB (delist 04/2026),
--   XNO, RIO, LAND, RON, AI16Z (đổi tên), PYUSD (không pair Binance).

-- ===== 0a. Deactivate coin trùng symbol (giữ dòng id nhỏ nhất) =====
UPDATE coins SET is_active = false, updated_at = NOW()
WHERE symbol = 'ETHFI'
  AND id <> (SELECT MIN(id) FROM coins WHERE symbol = 'ETHFI');

-- ===== 0b. Chặn coin active trùng symbol từ giờ sau =====
CREATE UNIQUE INDEX IF NOT EXISTS coins_symbol_active_unique
  ON coins (symbol) WHERE is_active = true;

-- ===== 1. Majors & L1 (15) =====
INSERT INTO coins (symbol, name, binance_spot_symbol, binance_futures_symbol, coingecko_id, has_futures, is_active)
VALUES
  ('XRP',  'XRP',         'XRPUSDT',  'XRPUSDT',  'ripple',             true, true),
  ('BNB',  'BNB',         'BNBUSDT',  'BNBUSDT',  'binancecoin',        true, true),
  ('ADA',  'Cardano',     'ADAUSDT',  'ADAUSDT',  'cardano',            true, true),
  ('AVAX', 'Avalanche',   'AVAXUSDT', 'AVAXUSDT', 'avalanche-2',        true, true),
  ('DOGE', 'Dogecoin',    'DOGEUSDT', 'DOGEUSDT', 'dogecoin',           true, true),
  ('TON',  'Toncoin',     'TONUSDT',  'TONUSDT',  'the-open-network',   true, true),
  ('TRX',  'TRON',        'TRXUSDT',  'TRXUSDT',  'tron',               true, true),
  ('DOT',  'Polkadot',    'DOTUSDT',  'DOTUSDT',  'polkadot',           true, true),
  ('ATOM', 'Cosmos Hub',  'ATOMUSDT', 'ATOMUSDT', 'cosmos',             true, true),
  ('SUI',  'Sui',         'SUIUSDT',  'SUIUSDT',  'sui',                true, true),
  ('APT',  'Aptos',       'APTUSDT',  'APTUSDT',  'aptos',              true, true),
  ('SEI',  'Sei',         'SEIUSDT',  'SEIUSDT',  'sei-network',        true, true),
  ('HBAR', 'Hedera',      'HBARUSDT', 'HBARUSDT', 'hedera-hashgraph',   true, true),
  ('INJ',  'Injective',   'INJUSDT',  'INJUSDT',  'injective-protocol', true, true),
  ('TIA',  'Celestia',    'TIAUSDT',  'TIAUSDT',  'celestia',           true, true)
ON CONFLICT (symbol) WHERE is_active = true DO NOTHING;

-- ===== 2. Layer 2 & Interop (7) =====
INSERT INTO coins (symbol, name, binance_spot_symbol, binance_futures_symbol, coingecko_id, has_futures, is_active)
VALUES
  ('STRK', 'Starknet',     'STRKUSDT', 'STRKUSDT', 'starknet',     true, true),
  ('ZK',   'ZKsync',       'ZKUSDT',   'ZKUSDT',   'zksync',       true, true),
  ('SCR',  'Scroll',       'SCRUSDT',  'SCRUSDT',  'scroll',       true, true),
  ('MNT',  'Mantle',       'MNTUSDT',  'MNTUSDT',  'mantle',       true, true),
  ('OMNI', 'Omni Network', 'OMNIUSDT', 'OMNIUSDT', 'omni-network', true, true),
  ('W',    'Wormhole',     'WUSDT',    'WUSDT',    'wormhole',     true, true),
  ('ZRO',  'LayerZero',    'ZROUSDT',  'ZROUSDT',  'layerzero',    true, true)
ON CONFLICT (symbol) WHERE is_active = true DO NOTHING;

-- ===== 3. DeFi (7) =====
INSERT INTO coins (symbol, name, binance_spot_symbol, binance_futures_symbol, coingecko_id, has_futures, is_active)
VALUES
  ('MKR',  'Maker',     'MKRUSDT',  'MKRUSDT',  'maker',                     true, true),
  ('COMP', 'Compound',  'COMPUSDT', 'COMPUSDT', 'compound-governance-token', true, true),
  ('SNX',  'Synthetix', 'SNXUSDT',  'SNXUSDT',  'havven',                    true, true),
  ('DYDX', 'dYdX',      'DYDXUSDT', 'DYDXUSDT', 'dydx-chain',                true, true),
  ('GMX',  'GMX',       'GMXUSDT',  'GMXUSDT',  'gmx',                       true, true),
  ('RUNE', 'THORChain', 'RUNEUSDT', 'RUNEUSDT', 'thorchain',                 true, true),
  ('KAVA', 'Kava',      'KAVAUSDT', 'KAVAUSDT', 'kava',                      true, true)
ON CONFLICT (symbol) WHERE is_active = true DO NOTHING;

-- ===== 4. AI & Compute (6) =====
INSERT INTO coins (symbol, name, binance_spot_symbol, binance_futures_symbol, coingecko_id, has_futures, is_active)
VALUES
  ('TAO',     'Bittensor',        'TAOUSDT',     'TAOUSDT',     'bittensor',        true, true),
  ('WLD',     'Worldcoin',        'WLDUSDT',     'WLDUSDT',     'worldcoin-wld',    true, true),
  ('ARKM',    'Arkham',           'ARKMUSDT',    'ARKMUSDT',    'arkham',           true, true),
  ('IO',      'io.net',           'IOUSDT',      'IOUSDT',      'io',               true, true),
  ('VIRTUAL', 'Virtuals Protocol','VIRTUALUSDT', 'VIRTUALUSDT', 'virtual-protocol', true, true),
  ('AIXBT',   'AIXBT',            'AIXBTUSDT',   'AIXBTUSDT',   'aixbt',            true, true)
ON CONFLICT (symbol) WHERE is_active = true DO NOTHING;

-- ===== 5. DePIN & Storage (3) =====
INSERT INTO coins (symbol, name, binance_spot_symbol, binance_futures_symbol, coingecko_id, has_futures, is_active)
VALUES
  ('FIL', 'Filecoin', 'FILUSDT', 'FILUSDT', 'filecoin', true, true),
  ('AR',  'Arweave',  'ARUSDT',  'ARUSDT',  'arweave',  true, true),
  ('HOT', 'Helium',   'HOTUSDT', 'HOTUSDT', 'helium',   true, true)
ON CONFLICT (symbol) WHERE is_active = true DO NOTHING;

-- ===== 6. Gaming (4) =====
INSERT INTO coins (symbol, name, binance_spot_symbol, binance_futures_symbol, coingecko_id, has_futures, is_active)
VALUES
  ('AXS',  'Axie Infinity', 'AXSUSDT',  'AXSUSDT',  'axie-infinity', true, true),
  ('SAND', 'The Sandbox',   'SANDUSDT', 'SANDUSDT', 'the-sandbox',   true, true),
  ('GALA', 'Gala',          'GALAUSDT', 'GALAUSDT', 'gala',          true, true),
  ('IMX',  'Immutable',     'IMXUSDT',  'IMXUSDT',  'immutable-x',   true, true)
ON CONFLICT (symbol) WHERE is_active = true DO NOTHING;

-- ===== 7. Oracle (1) =====
INSERT INTO coins (symbol, name, binance_spot_symbol, binance_futures_symbol, coingecko_id, has_futures, is_active)
VALUES
  ('PYTH', 'Pyth Network', 'PYTHUSDT', 'PYTHUSDT', 'pyth-network', true, true)
ON CONFLICT (symbol) WHERE is_active = true DO NOTHING;

-- ===== 8. Memecoin lớn (6) =====
INSERT INTO coins (symbol, name, binance_spot_symbol, binance_futures_symbol, coingecko_id, has_futures, is_active)
VALUES
  ('SHIB',  'Shiba Inu',      'SHIBUSDT',  'SHIBUSDT',  'shiba-inu',      true, true),
  ('PEPE',  'Pepe',           'PEPEUSDT',  'PEPEUSDT',  'pepe',           true, true),
  ('WIF',   'dogwifhat',      'WIFUSDT',   'WIFUSDT',   'dogwifcoin',     true, true),
  ('BONK',  'Bonk',           'BONKUSDT',  'BONKUSDT',  'bonk',           true, true),
  ('FLOKI', 'Floki',          'FLOKIUSDT', 'FLOKIUSDT', 'floki',          true, true),
  ('TRUMP', 'OFFICIAL TRUMP', 'TRUMPUSDT', 'TRUMPUSDT', 'official-trump', true, true)
ON CONFLICT (symbol) WHERE is_active = true DO NOTHING;

-- ===== 9. Payment & Stable infra (2) =====
INSERT INTO coins (symbol, name, binance_spot_symbol, binance_futures_symbol, coingecko_id, has_futures, is_active)
VALUES
  ('XLM', 'Stellar', 'XLMUSDT', 'XLMUSDT', 'stellar', true, true),
  ('VET', 'VeChain', 'VETUSDT', 'VETUSDT', 'vechain', true, true)
ON CONFLICT (symbol) WHERE is_active = true DO NOTHING;

-- ===== 10. Restaking / Jito (1) =====
INSERT INTO coins (symbol, name, binance_spot_symbol, binance_futures_symbol, coingecko_id, has_futures, is_active)
VALUES
  ('JTO', 'Jito', 'JTOUSDT', 'JTOUSDT', 'jito-governance-token', true, true)
ON CONFLICT (symbol) WHERE is_active = true DO NOTHING;

-- ===== Narrative mapping (join theo TÊN narrative, idempotent trên PK) =====
INSERT INTO coin_narratives (coin_id, narrative_id, is_primary)
SELECT c.id, n.id, true
FROM coins c
JOIN (VALUES
  -- Majors
  ('XRP',   'PAYFI & STABLE'),
  ('BNB',   'FAVORITE'), ('ADA', 'FAVORITE'), ('AVAX', 'FAVORITE'),
  ('TON',   'FAVORITE'), ('DOT', 'FAVORITE'), ('ATOM', 'FAVORITE'),
  ('SUI',   'FAVORITE'), ('APT', 'FAVORITE'), ('SEI',  'FAVORITE'),
  ('HBAR',  'FAVORITE'), ('INJ', 'FAVORITE'), ('TIA',  'FAVORITE'),
  ('TRX',   'PAYFI & STABLE'),
  ('DOGE',  'TOPMC'),
  -- L2 & Interop
  ('STRK',  'LAYER 2'), ('ZK', 'LAYER 2'), ('SCR',  'LAYER 2'),
  ('MNT',   'LAYER 2'), ('OMNI', 'LAYER 2'), ('W', 'LAYER 2'), ('ZRO', 'LAYER 2'),
  -- DeFi
  ('MKR',   'DEFI / DEX'), ('COMP', 'DEFI / DEX'), ('SNX',  'DEFI / DEX'),
  ('DYDX',  'DEFI / DEX'), ('GMX',  'DEFI / DEX'), ('RUNE', 'DEFI / DEX'),
  ('KAVA',  'DEFI / DEX'), ('PYTH', 'DEFI / DEX'),
  -- AI & Compute + DePIN (gắn vào narrative AI)
  ('TAO',   'AI'), ('WLD', 'AI'), ('ARKM', 'AI'),
  ('IO',    'AI'), ('VIRTUAL', 'AI'), ('AIXBT', 'AI'),
  ('FIL',   'AI'), ('AR',  'AI'), ('HOT',  'AI'),
  -- Gaming (chưa có narrative riêng → FAVORITE)
  ('AXS',   'FAVORITE'), ('SAND', 'FAVORITE'),
  ('GALA',  'FAVORITE'), ('IMX',  'FAVORITE'),
  -- Memecoin
  ('SHIB',  'TOPMC'), ('PEPE', 'TOPMC'), ('WIF',   'TOPMC'),
  ('BONK',  'TOPMC'), ('FLOKI', 'TOPMC'), ('TRUMP', 'TOPMC'),
  -- Payment & Restaking
  ('XLM',   'PAYFI & STABLE'), ('VET', 'PAYFI & STABLE'),
  ('JTO',   'RESTAKING')
) AS m(symbol, narrative_name) ON m.symbol = c.symbol
JOIN narratives n ON n.name = m.narrative_name AND n.is_active = true
ON CONFLICT DO NOTHING;
