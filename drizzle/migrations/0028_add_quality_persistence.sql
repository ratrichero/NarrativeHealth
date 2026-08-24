-- Migration: 0028_add_quality_persistence.sql
-- Frozen contract: P6-01D-D1 (commit bfeac25)
-- Implements: p6_observation_quality + p6_quality_rule_config

-- 1. Observation quality table
CREATE TABLE IF NOT EXISTS p6_observation_quality (
    id                    BIGSERIAL PRIMARY KEY,
    entity_id             INTEGER NOT NULL REFERENCES coins(id) ON DELETE CASCADE,
    metric                VARCHAR(50) NOT NULL,
    source                VARCHAR(50) NOT NULL,
    observed_at           TIMESTAMPTZ,                    -- NULL = UNKNOWN
    timeframe             VARCHAR(30) NOT NULL,
    quality_status        VARCHAR(20) NOT NULL,           -- VALID | INVALID | MISSING | UNKNOWN
    observation_status    VARCHAR(20) NOT NULL,           -- aggregated status
    quality_config_version VARCHAR(20) NOT NULL,          -- "v1"
    evidence              JSONB NOT NULL DEFAULT '[]'::jsonb,
    quality_evaluated_at  TIMESTAMPTZ NOT NULL,
    collected_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Partial unique indexes for latest-only retention (PD-17)
-- KNOWN observations: full 5-column identity
CREATE UNIQUE INDEX IF NOT EXISTS p6_oq_known_unique
    ON p6_observation_quality (entity_id, metric, source, observed_at, timeframe)
    WHERE observed_at IS NOT NULL;

-- UNKNOWN observations: 4-column identity (observed_at absent)
CREATE UNIQUE INDEX IF NOT EXISTS p6_oq_unknown_unique
    ON p6_observation_quality (entity_id, metric, source, timeframe)
    WHERE observed_at IS NULL;

-- 3. Operational indexes
CREATE INDEX IF NOT EXISTS p6_oq_entity_idx ON p6_observation_quality (entity_id);
CREATE INDEX IF NOT EXISTS p6_oq_status_idx ON p6_observation_quality (quality_status);
CREATE INDEX IF NOT EXISTS p6_oq_config_idx ON p6_observation_quality (quality_config_version);
CREATE INDEX IF NOT EXISTS p6_oq_evaluated_idx ON p6_observation_quality (quality_evaluated_at);
CREATE INDEX IF NOT EXISTS p6_oq_approx_join_idx ON p6_observation_quality (entity_id, source, timeframe, observed_at);

-- 4. Quality rule configuration table
CREATE TABLE IF NOT EXISTS p6_quality_rule_config (
    id                    SERIAL PRIMARY KEY,
    quality_config_version VARCHAR(20) NOT NULL,
    check_id              VARCHAR(100) NOT NULL,
    metric                VARCHAR(50),                    -- NULL = applies to all metrics
    check_type            VARCHAR(30) NOT NULL,
    parameters            JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_enabled            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT p6_quality_rule_config_unique
        UNIQUE (quality_config_version, check_id, metric)
);

CREATE INDEX IF NOT EXISTS p6_qrc_config_idx ON p6_quality_rule_config (quality_config_version);

-- 5. Seed: Frozen V1 Part-A rules (PD-18-RES)
-- NO rows for OI-01 (FR range) or OI-02 (temporal tolerance)

-- NUMERIC_PARSE: all metrics
INSERT INTO p6_quality_rule_config (quality_config_version, check_id, metric, check_type, parameters, is_enabled) VALUES
('v1', 'NUMERIC_PARSE', 'OPEN',          'NUMERIC_PARSE', '{"reject": ["NaN", "Infinity", "-Infinity", "non-numeric"]}', true),
('v1', 'NUMERIC_PARSE', 'HIGH',          'NUMERIC_PARSE', '{"reject": ["NaN", "Infinity", "-Infinity", "non-numeric"]}', true),
('v1', 'NUMERIC_PARSE', 'LOW',           'NUMERIC_PARSE', '{"reject": ["NaN", "Infinity", "-Infinity", "non-numeric"]}', true),
('v1', 'NUMERIC_PARSE', 'CLOSE',         'NUMERIC_PARSE', '{"reject": ["NaN", "Infinity", "-Infinity", "non-numeric"]}', true),
('v1', 'NUMERIC_PARSE', 'VOLUME',        'NUMERIC_PARSE', '{"reject": ["NaN", "Infinity", "-Infinity", "non-numeric"]}', true),
('v1', 'NUMERIC_PARSE', 'QUOTE_VOLUME',  'NUMERIC_PARSE', '{"reject": ["NaN", "Infinity", "-Infinity", "non-numeric"]}', true),
('v1', 'NUMERIC_PARSE', 'MARKET_CAP',    'NUMERIC_PARSE', '{"reject": ["NaN", "Infinity", "-Infinity", "non-numeric"]}', true),
('v1', 'NUMERIC_PARSE', 'FDV',           'NUMERIC_PARSE', '{"reject": ["NaN", "Infinity", "-Infinity", "non-numeric"]}', true),
('v1', 'NUMERIC_PARSE', 'OPEN_INTEREST', 'NUMERIC_PARSE', '{"reject": ["NaN", "Infinity", "-Infinity", "non-numeric"]}', true),
('v1', 'NUMERIC_PARSE', 'FUNDING_RATE',  'NUMERIC_PARSE', '{"reject": ["NaN", "Infinity", "-Infinity", "non-numeric"]}', true)
ON CONFLICT (quality_config_version, check_id, metric) DO NOTHING;

-- NEGATIVE_VALUE: all metrics except FUNDING_RATE (allows negative)
INSERT INTO p6_quality_rule_config (quality_config_version, check_id, metric, check_type, parameters, is_enabled) VALUES
('v1', 'NEGATIVE_VALUE', 'OPEN',          'NUMERIC_SIGN', '{"allow_negative": false}', true),
('v1', 'NEGATIVE_VALUE', 'HIGH',          'NUMERIC_SIGN', '{"allow_negative": false}', true),
('v1', 'NEGATIVE_VALUE', 'LOW',           'NUMERIC_SIGN', '{"allow_negative": false}', true),
('v1', 'NEGATIVE_VALUE', 'CLOSE',         'NUMERIC_SIGN', '{"allow_negative": false}', true),
('v1', 'NEGATIVE_VALUE', 'VOLUME',        'NUMERIC_SIGN', '{"allow_negative": false}', true),
('v1', 'NEGATIVE_VALUE', 'QUOTE_VOLUME',  'NUMERIC_SIGN', '{"allow_negative": false}', true),
('v1', 'NEGATIVE_VALUE', 'MARKET_CAP',    'NUMERIC_SIGN', '{"allow_negative": false}', true),
('v1', 'NEGATIVE_VALUE', 'FDV',           'NUMERIC_SIGN', '{"allow_negative": false}', true),
('v1', 'NEGATIVE_VALUE', 'OPEN_INTEREST', 'NUMERIC_SIGN', '{"allow_negative": false}', true),
('v1', 'NEGATIVE_VALUE', 'FUNDING_RATE',  'NUMERIC_SIGN', '{"allow_negative": true}', true)
ON CONFLICT (quality_config_version, check_id, metric) DO NOTHING;

-- ZERO_VALUE: per-metric zero policy (PD-05-RES)
INSERT INTO p6_quality_rule_config (quality_config_version, check_id, metric, check_type, parameters, is_enabled) VALUES
('v1', 'ZERO_VALUE', 'OPEN',          'NUMERIC_RANGE', '{"zero_valid": false}', true),
('v1', 'ZERO_VALUE', 'HIGH',          'NUMERIC_RANGE', '{"zero_valid": false}', true),
('v1', 'ZERO_VALUE', 'LOW',           'NUMERIC_RANGE', '{"zero_valid": false}', true),
('v1', 'ZERO_VALUE', 'CLOSE',         'NUMERIC_RANGE', '{"zero_valid": false}', true),
('v1', 'ZERO_VALUE', 'VOLUME',        'NUMERIC_RANGE', '{"zero_valid": true}', true),
('v1', 'ZERO_VALUE', 'QUOTE_VOLUME',  'NUMERIC_RANGE', '{"zero_valid": true}', true),
('v1', 'ZERO_VALUE', 'MARKET_CAP',    'NUMERIC_RANGE', '{"zero_valid": false}', true),
('v1', 'ZERO_VALUE', 'FDV',           'NUMERIC_RANGE', '{"zero_valid": false}', true),
('v1', 'ZERO_VALUE', 'OPEN_INTEREST', 'NUMERIC_RANGE', '{"zero_valid": true}', true),
('v1', 'ZERO_VALUE', 'FUNDING_RATE',  'NUMERIC_RANGE', '{"zero_valid": true}', true)
ON CONFLICT (quality_config_version, check_id, metric) DO NOTHING;

-- OHLC relational checks (PD-03-RES) — NULL metric = group-level check
INSERT INTO p6_quality_rule_config (quality_config_version, check_id, metric, check_type, parameters, is_enabled) VALUES
('v1', 'OHLC_HIGH_GE_LOW',    NULL, 'OHLC_RELATIONAL', '{"rule": "high >= low"}', true),
('v1', 'OHLC_OPEN_IN_RANGE',  NULL, 'OHLC_RELATIONAL', '{"rule": "low <= open <= high"}', true),
('v1', 'OHLC_CLOSE_IN_RANGE', NULL, 'OHLC_RELATIONAL', '{"rule": "low <= close <= high"}', true)
ON CONFLICT (quality_config_version, check_id, metric) DO NOTHING;

-- ENTITY_RESOLUTION: NULL metric = applies to all
INSERT INTO p6_quality_rule_config (quality_config_version, check_id, metric, check_type, parameters, is_enabled) VALUES
('v1', 'ENTITY_RESOLUTION_FAIL', NULL, 'ENTITY_RESOLUTION', '{"description": "entity source mapping missing"}', true)
ON CONFLICT (quality_config_version, check_id, metric) DO NOTHING;

-- NOTE: OI-01 (FUNDING_RATE range) — NOT seeded (deferred)
-- NOTE: OI-02 (temporal tolerance) — NOT seeded (deferred)
