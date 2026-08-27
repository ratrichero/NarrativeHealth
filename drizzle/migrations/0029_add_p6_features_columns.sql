-- P6-02E: p6_feature_versions table (version tuple for feature provenance)
CREATE TABLE IF NOT EXISTS p6_feature_versions (
  id SERIAL PRIMARY KEY,
  algorithm_version TEXT NOT NULL,
  parameter_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMP,
  CONSTRAINT p6_feature_version_unique UNIQUE (algorithm_version, parameter_version, schema_version, config_hash)
);

-- P6-02E: additive columns on features table (PD-4, PD-7)
ALTER TABLE features
  ADD COLUMN IF NOT EXISTS p6_version_id INTEGER,
  ADD COLUMN IF NOT EXISTS p6_provenance JSONB,
  ADD COLUMN IF NOT EXISTS p6_quality_metadata JSONB;

-- FK constraint for p6_version_id → p6_feature_versions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'features_p6_version_id_fk'
  ) THEN
    ALTER TABLE features
      ADD CONSTRAINT features_p6_version_id_fk
      FOREIGN KEY (p6_version_id) REFERENCES p6_feature_versions(id) ON DELETE SET NULL;
  END IF;
END $$;
