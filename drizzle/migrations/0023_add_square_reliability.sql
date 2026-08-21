-- Migration 0023: SQ-OPERATE-02 — Production reliability & control
-- Adds retry tracking, failure classification, and pipeline observability

-- 1. Add retry tracking columns to square_publications
ALTER TABLE square_publications ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE square_publications ADD COLUMN failure_category VARCHAR(30);
-- failure_category values: TRANSIENT, PERMANENT, TIMEOUT, UNKNOWN, null (on success)
-- RETRY_PENDING status uses the existing status column

-- 2. Add quota warning threshold tracking
ALTER TABLE square_quota_log ADD COLUMN warning_at_threshold BOOLEAN DEFAULT FALSE;

-- 3. Index for finding publications by opportunity (retry lookup)
CREATE INDEX IF NOT EXISTS square_publications_opportunity_status_idx
  ON square_publications (opportunity_id, status);
