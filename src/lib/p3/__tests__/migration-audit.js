/**
 * P3 Production Migration Audit (READ-ONLY)
 *
 * This script performs detailed READ-ONLY audit of P3 migrations against production schema.
 * It checks tables, columns, indexes, constraints, triggers, and configuration data.
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
 * Audit table structure
 */
async function auditTable(tableName) {
  console.log(`\n=== Table: ${tableName} ===`);

  // Check if table exists
  const tableExists = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = '${tableName.toLowerCase()}'
    )
  `);

  if (!tableExists.rows[0].exists) {
    console.log('❌ Table does not exist');
    return null;
  }

  console.log('✅ Table exists');

  // Get columns
  const columns = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = '${tableName.toLowerCase()}'
    ORDER BY ordinal_position
  `);

  console.log(`\nColumns (${columns.rows.length}):`);
  columns.rows.forEach(col => {
    console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
  });

  // Get indexes
  const indexes = await pool.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = '${tableName.toLowerCase()}'
  `);

  console.log(`\nIndexes (${indexes.rows.length}):`);
  indexes.rows.forEach(idx => {
    console.log(`  - ${idx.indexname}`);
  });

  // Get constraints
  const constraints = await pool.query(`
    SELECT constraint_name, constraint_type
    FROM information_schema.table_constraints
    WHERE table_name = '${tableName.toLowerCase()}'
  `);

  console.log(`\nConstraints (${constraints.rows.length}):`);
  constraints.rows.forEach(con => {
    console.log(`  - ${con.constraint_name}: ${con.constraint_type}`);
  });

  // Get triggers
  const triggers = await pool.query(`
    SELECT trigger_name, event_manipulation, action_timing
    FROM information_schema.triggers
    WHERE event_object_table = '${tableName.toLowerCase()}'
  `);

  console.log(`\nTriggers (${triggers.rows.length}):`);
  triggers.rows.forEach(trig => {
    console.log(`  - ${trig.trigger_name}: ${trig.event_manipulation} ${trig.action_timing}`);
  });

  // Get row count
  const count = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
  console.log(`\nRow count: ${count.rows[0].count}`);

  return {
    exists: true,
    columns: columns.rows,
    indexes: indexes.rows,
    constraints: constraints.rows,
    triggers: triggers.rows,
    rowCount: parseInt(count.rows[0].count)
  };
}

/**
 * Audit function existence
 */
async function auditFunction(functionName) {
  console.log(`\n=== Function: ${functionName} ===`);

  const result = await pool.query(`
    SELECT EXISTS (
      SELECT FROM pg_proc
      WHERE proname = '${functionName}'
    )
  `);

  if (result.rows[0].exists) {
    console.log('✅ Function exists');
  } else {
    console.log('❌ Function does not exist');
  }

  return result.rows[0].exists;
}

/**
 * Audit score_configs table
 */
async function auditScoreConfigs() {
  console.log('\n=== Score Configs Audit ===');

  const tableInfo = await auditTable('score_configs');

  if (tableInfo && tableInfo.exists) {
    // Check for P3 configs
    const configs = await pool.query(`
      SELECT config_type, config_key, version, is_active
      FROM score_configs
      WHERE config_type = 'P3'
    `);

    console.log(`\nP3 Configs (${configs.rows.length}):`);
    configs.rows.forEach(config => {
      console.log(`  - ${config.config_key} v${config.version} (active: ${config.is_active})`);
    });

    // Check all configs
    const allConfigs = await pool.query(`
      SELECT config_type, config_key, version, is_active
      FROM score_configs
    `);

    console.log(`\nAll Configs (${allConfigs.rows.length}):`);
    allConfigs.rows.forEach(config => {
      console.log(`  - ${config.config_type} / ${config.config_key} v${config.version} (active: ${config.is_active})`);
    });
  }

  return tableInfo;
}

/**
 * Main audit function
 */
async function main() {
  console.log('=== P3 Production Migration Audit (READ-ONLY) ===');
  console.log(`Database: ${databaseUrl.replace(/:[^:]*@/, ':****@')}\n`);

  try {
    // Audit P3 tables
    await auditTable('p3_narrative_intelligence');
    await auditTable('p3_constituent_snapshots');
    await auditTable('p3_constituent_snapshot_members');
    await auditTable('p3_leadership_members');
    await auditFunction('prevent_p3_history_mutation');
    await auditScoreConfigs();

    // Check for __drizzle_migrations
    console.log('\n=== Migration Tracking ===');
    const migrationTable = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = '__drizzle_migrations'
      )
    `);

    if (migrationTable.rows[0].exists) {
      console.log('✅ __drizzle_migrations table exists');
      const migrations = await pool.query(`
        SELECT migration_name, applied_at
        FROM __drizzle_migrations
        ORDER BY applied_at DESC
        LIMIT 10
      `);
      console.log(`\nRecent migrations (${migrations.rows.length}):`);
      migrations.rows.forEach(mig => {
        console.log(`  - ${mig.migration_name} at ${mig.applied_at}`);
      });
    } else {
      console.log('❌ __drizzle_migrations table does not exist');
    }

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
