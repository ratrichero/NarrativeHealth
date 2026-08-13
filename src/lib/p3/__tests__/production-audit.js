/**
 * Production DB Read-Only Audit
 *
 * This script performs READ-ONLY operations against the production database
 * to verify migration status and existing data without modifying anything.
 *
 * SAFETY: This script only uses SELECT queries. No INSERT, UPDATE, DELETE.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Try to get DATABASE_URL from environment or drizzle.config.json
let databaseUrl = process.env.DATABASE_URL?.replace(
  "postgresql+asyncpg://",
  "postgresql://"
);

if (!databaseUrl) {
  // Try to read from drizzle.config.json
  try {
    const configPath = path.join(__dirname, '../../../../drizzle.config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    databaseUrl = config.dbCredentials.url;
    console.log('Using DATABASE_URL from drizzle.config.json');
  } catch (error) {
    console.error('DATABASE_URL is required and not found in environment or drizzle.config.json');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
});

/**
 * Check if P3 tables exist and their structure
 */
async function auditP3Tables() {
  console.log('=== Production DB Audit ===\n');
  console.log(`Database: ${databaseUrl.replace(/:[^:]*@/, ':****@')}\n`);

  // Check p3_narrative_intelligence table
  try {
    const result = await pool.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'p3_narrative_intelligence'
      ORDER BY ordinal_position
    `);
    console.log('✅ p3_narrative_intelligence table exists');
    console.log(`   Columns: ${result.rows.length}`);
  } catch (error) {
    console.log('❌ p3_narrative_intelligence table does not exist');
  }

  // Check score_configs table
  try {
    const result = await pool.query(`
      SELECT * FROM score_configs
      WHERE algorithm_key IN ('regime_thresholds', 'rotation_thresholds')
    `);
    console.log(`✅ score_configs table exists`);
    console.log(`   Found ${result.rows.length} score config rows`);
    result.rows.forEach(row => {
      console.log(`   - ${row.algorithm_key} / ${row.version}`);
    });
  } catch (error) {
    console.log('❌ score_configs table does not exist or no data');
  }

  // Check existing narratives
  try {
    const result = await pool.query(`
      SELECT id, name FROM narratives
      LIMIT 5
    `);
    console.log(`✅ narratives table exists`);
    console.log(`   Found ${result.rows.length} narratives (showing first 5)`);
    result.rows.forEach(row => {
      console.log(`   - ID ${row.id}: ${row.name}`);
    });
  } catch (error) {
    console.log('❌ narratives table does not exist');
  }

  // Check existing narrative health data
  try {
    const result = await pool.query(`
      SELECT COUNT(*) as count FROM narrative_health
    `);
    console.log(`✅ narrative_health table exists`);
    console.log(`   Total records: ${result.rows[0].count}`);
  } catch (error) {
    console.log('❌ narrative_health table does not exist');
  }

  // Check for existing P3 intelligence records
  try {
    const result = await pool.query(`
      SELECT COUNT(*) as count FROM p3_narrative_intelligence
    `);
    console.log(`✅ p3_narrative_intelligence has data`);
    console.log(`   Total records: ${result.rows[0].count}`);
  } catch (error) {
    console.log('❌ p3_narrative_intelligence has no data or table does not exist');
  }

  // Check migration table
  try {
    const result = await pool.query(`
      SELECT migration_name, applied_at FROM __drizzle_migrations
      ORDER BY applied_at DESC
      LIMIT 5
    `);
    console.log(`✅ __drizzle_migrations table exists`);
    console.log(`   Recent migrations (last 5):`);
    result.rows.forEach(row => {
      console.log(`   - ${row.migration_name} at ${row.applied_at}`);
    });
  } catch (error) {
    console.log('❌ __drizzle_migrations table does not exist');
  }
}

/**
 * Main audit function
 */
async function main() {
  try {
    await auditP3Tables();
    console.log('\n=== Audit Complete ===');
    console.log('⚠️  READ-ONLY: No data was modified');
    await pool.end();
  } catch (error) {
    console.error('Audit failed:', error);
    await pool.end();
    process.exit(1);
  }
}

main();
