ALTER TABLE features
  ADD COLUMN IF NOT EXISTS source_provenance JSONB,
  ADD COLUMN IF NOT EXISTS calculated_at     TIMESTAMP;

UPDATE features
  SET calculated_at = created_at
  WHERE calculated_at IS NULL;
