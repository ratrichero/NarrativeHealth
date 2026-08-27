import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL?.replace('postgresql+asyncpg://', 'postgresql://');
if (!databaseUrl) { console.error('DATABASE_URL not found'); process.exit(1); }

const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });

const SQL = `
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
ALTER TABLE features ADD COLUMN IF NOT EXISTS p6_version_id INTEGER;
ALTER TABLE features ADD COLUMN IF NOT EXISTS p6_provenance JSONB;
ALTER TABLE features ADD COLUMN IF NOT EXISTS p6_quality_metadata JSONB;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'features_p6_version_id_fk') THEN
    ALTER TABLE features ADD CONSTRAINT features_p6_version_id_fk
      FOREIGN KEY (p6_version_id) REFERENCES p6_feature_versions(id) ON DELETE SET NULL;
  END IF;
END $$;
`;

(async () => {
  try {
    const client = await pool.connect();
    console.log('Connected to database');
    await client.query(SQL);
    console.log('Migration applied successfully');
    const res = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'features' AND column_name IN ('p6_version_id', 'p6_provenance', 'p6_quality_metadata')
      ORDER BY column_name
    `);
    console.log('Verified columns:', res.rows.map((r: any) => r.column_name).join(', '));
    const tblRes = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_name = 'p6_feature_versions'`);
    console.log('p6_feature_versions table:', tblRes.rows.length > 0 ? 'EXISTS' : 'MISSING');
    client.release();
    console.log('DONE');
  } catch (e: any) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
