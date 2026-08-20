-- Square Opportunity & Publication tables
-- Migration 0022: Binance Square Content & Monetization

-- Square Opportunities - Detected publishing opportunities
CREATE TABLE IF NOT EXISTS square_opportunities (
  id SERIAL PRIMARY KEY,
  type VARCHAR(30) NOT NULL, -- COIN_SETUP, NARRATIVE_SETUP, WATCH
  subject_id INTEGER, -- coin_id or narrative_id
  narrative_id INTEGER,
  coin_symbol VARCHAR(20),
  score DECIMAL(5,2) NOT NULL,
  data_as_of DATE NOT NULL,
  data_quality VARCHAR(10) NOT NULL, -- HIGH, MEDIUM, LOW
  rationale JSONB NOT NULL,
  entry_zone JSONB,
  take_profits JSONB,
  stop_loss JSONB,
  expires_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'CANDIDATE', -- CANDIDATE, QUALIFIED, SUPPRESSED, PUBLISHED, EXPIRED
  content_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_square_opportunities_status ON square_opportunities(status);
CREATE INDEX idx_square_opportunities_type ON square_opportunities(type);
CREATE INDEX idx_square_opportunities_subject ON square_opportunities(subject_id, narrative_id);
CREATE INDEX idx_square_opportunities_created ON square_opportunities(created_at);

-- Square Publications - Published posts
CREATE TABLE IF NOT EXISTS square_publications (
  id SERIAL PRIMARY KEY,
  opportunity_id INTEGER NOT NULL REFERENCES square_opportunities(id),
  fingerprint VARCHAR(200) NOT NULL UNIQUE,
  provider VARCHAR(50) NOT NULL DEFAULT 'BINANCE_SQUARE',
  status VARCHAR(20) NOT NULL, -- DRAFT, PUBLISHED, FAILED, SUPPRESSED
  published_at TIMESTAMPTZ,
  external_post_id VARCHAR(100),
  content_version VARCHAR(20) NOT NULL,
  template_version VARCHAR(20) NOT NULL,
  llm_used BOOLEAN NOT NULL DEFAULT FALSE,
  error_code VARCHAR(20),
  error_message TEXT,
  content_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_square_publications_status ON square_publications(status);
CREATE INDEX idx_square_publications_opportunity ON square_publications(opportunity_id);
CREATE INDEX idx_square_publications_fingerprint ON square_publications(fingerprint);
CREATE INDEX idx_square_publications_published ON square_publications(published_at);

-- Square Quota Log - Daily usage tracking
CREATE TABLE IF NOT EXISTS square_quota_log (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  posts_published INTEGER NOT NULL DEFAULT 0,
  uploads_used INTEGER NOT NULL DEFAULT 0,
  last_refresh_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Square Publication Fingerprint - Deduplication
CREATE TABLE IF NOT EXISTS square_fingerprints (
  id SERIAL PRIMARY KEY,
  fingerprint VARCHAR(200) NOT NULL UNIQUE,
  opportunity_id INTEGER NOT NULL REFERENCES square_opportunities(id),
  published_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_square_fingerprints_fingerprint ON square_fingerprints(fingerprint);
CREATE INDEX idx_square_fingerprints_expires ON square_fingerprints(expires_at);
