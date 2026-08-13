/**
 * Score Configs Compatibility Audit (READ-ONLY)
 *
 * This script performs detailed READ-ONLY audit of score_configs table
 * to determine compatibility with migration 0018.
 *
 * SAFETY: This script only uses SELECT queries. No INSERT, UPDATE, DELETE, CREATE, ALTER, DROP.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Get DATABASE_URL from drizzle.config.json
let databaseUrl;
try {
  const configPath = path.join(__dirname, '../../../../drizzle.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  databaseUrl = config.dbCredentials.url;
} catch (error) {
  console.error('Cannot read drizzle.config.json');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
});

/**
 * Detailed score_configs schema audit
 */
async function auditScoreConfigsSchema() {
  console.log('=== score_configs Schema Audit ===\n');

  // Columns
  const columns = await pool.query(`
    SELECT
      column_name,
      data_type,
      character_maximum_length,
      is_nullable,
      column_default,
      ordinal_position
    FROM information_schema.columns
    WHERE table_name = 'score_configs'
    ORDER BY ordinal_position
  `);

  console.log('Columns:');
  columns.rows.forEach(col => {
    console.log(`  ${col.ordinal_position}. ${col.column_name}`);
    console.log(`     Type: ${col.data_type}${col.character_maximum_length ? `(${col.character_maximum_length})` : ''}`);
    console.log(`     Nullable: ${col.is_nullable}`);
    console.log(`     Default: ${col.column_default || 'none'}`);
  });

  // Constraints
  const constraints = await pool.query(`
    SELECT
      tc.constraint_name,
      tc.constraint_type,
      kcu.column_name,
      cc.check_clause
    FROM information_schema.table_constraints tc
    LEFT JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    LEFT JOIN information_schema.check_constraints cc
      ON tc.constraint_name = cc.constraint_name
    WHERE tc.table_name = 'score_configs'
    ORDER BY tc.constraint_type, tc.constraint_name
  `);

  console.log('\nConstraints:');
  constraints.rows.forEach(con => {
    console.log(`  - ${con.constraint_name}: ${con.constraint_type}`);
    if (con.column_name) console.log(`    Column: ${con.column_name}`);
    if (con.check_clause) console.log(`    Check: ${con.check_clause}`);
  });

  // Indexes
  const indexes = await pool.query(`
    SELECT
      indexname,
      indexdef
    FROM pg_indexes
    WHERE tablename = 'score_configs'
  `);

  console.log('\nIndexes:');
  indexes.rows.forEach(idx => {
    console.log(`  - ${idx.indexname}`);
    console.log(`    Definition: ${idx.indexdef}`);
  });

  // Triggers
  const triggers = await pool.query(`
    SELECT
      trigger_name,
      event_manipulation,
      action_timing,
      action_statement
    FROM information_schema.triggers
    WHERE event_object_table = 'score_configs'
  `);

  console.log('\nTriggers:');
  if (triggers.rows.length === 0) {
    console.log('  (none)');
  } else {
    triggers.rows.forEach(trig => {
      console.log(`  - ${trig.trigger_name}: ${trig.event_manipulation} ${trig.action_timing}`);
    });
  }

  // Foreign Keys
  const foreignKeys = await pool.query(`
    SELECT
      tc.constraint_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'score_configs'
  `);

  console.log('\nForeign Keys:');
  if (foreignKeys.rows.length === 0) {
    console.log('  (none)');
  } else {
    foreignKeys.rows.forEach(fk => {
      console.log(`  - ${fk.constraint_name}: ${fk.column_name} → ${fk.foreign_table_name}.${fk.foreign_column_name}`);
    });
  }

  return {
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    triggers: triggers.rows,
    foreignKeys: foreignKeys.rows
  };
}

/**
 * Read all score_configs rows
 */
async function auditScoreConfigsData() {
  console.log('\n=== score_configs Data Audit ===\n');

  const rows = await pool.query(`
    SELECT
      id,
      config_type,
      config_key,
      config_value,
      version,
      is_active,
      description,
      created_at,
      updated_at
    FROM score_configs
    ORDER BY id
  `);

  console.log(`Total rows: ${rows.rows.length}\n`);

  rows.rows.forEach(row => {
    console.log(`ID: ${row.id}`);
    console.log(`  config_type: ${row.config_type}`);
    console.log(`  config_key: ${row.config_key}`);
    console.log(`  version: ${row.version}`);
    console.log(`  is_active: ${row.is_active}`);
    console.log(`  description: ${row.description || '(none)'}`);
    console.log(`  config_value: ${JSON.stringify(row.config_value)}`);
    console.log(`  created_at: ${row.created_at}`);
    console.log(`  updated_at: ${row.updated_at}`);
    console.log('');
  });

  return rows.rows;
}

/**
 * Main audit function
 */
async function main() {
  console.log('=== Score Configs Compatibility Audit (READ-ONLY) ===');
  console.log(`Database: ${databaseUrl.replace(/:[^:]*@/, ':****@')}\n`);

  try {
    const schema = await auditScoreConfigsSchema();
    const data = await auditScoreConfigsData();

    console.log('=== Audit Complete ===');
    console.log('⚠️  READ-ONLY: No data was modified');
    await pool.end();
  } catch (error) {
    console.error('Audit failed:', error);
    await pool.end();
    process.exit(1);
  }
}

main();
