-- P3-10E.17: append-only historical correction ledger.
-- This migration is additive. It does not alter P0-P2 tables or any existing P3 artifact.

CREATE TABLE IF NOT EXISTS p3_historical_corrections (
  id SERIAL PRIMARY KEY,
  original_intelligence_id INTEGER NOT NULL
    REFERENCES p3_narrative_intelligence(id) ON DELETE RESTRICT,
  original_snapshot_id BIGINT
    REFERENCES narrative_membership_snapshots(id) ON DELETE RESTRICT,
  corrected_snapshot_id BIGINT
    REFERENCES narrative_membership_snapshots(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  algorithm_key VARCHAR(100),
  algorithm_version VARCHAR(50),
  corrected_by VARCHAR(100),
  provenance JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS p3_historical_corrections_original_idx
  ON p3_historical_corrections(original_intelligence_id);

CREATE INDEX IF NOT EXISTS p3_historical_corrections_original_snapshot_idx
  ON p3_historical_corrections(original_snapshot_id);
