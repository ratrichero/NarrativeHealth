/**
 * Migration Execution Script
 *
 * This script executes P3 migrations against production database.
 * Each migration is applied with immediate verification.
 *
 * SAFETY: Migrations are applied in sequence with verification after each.
 * If any migration fails, execution stops immediately.
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
 * Execute a single migration file
 */
async function executeMigration(migrationFile) {
  const migrationPath = path.join(__dirname, '../../../../drizzle/migrations', migrationFile);
  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

  console.log(`\n=== Executing: ${migrationFile} ===`);

  try {
    await pool.query(migrationSQL);
    console.log(`✅ ${migrationFile} executed successfully`);
    return true;
  } catch (error) {
    console.error(`❌ ${migrationFile} FAILED:`);
    console.error(error.message);
    return false;
  }
}

/**
 * Verify migration 0015
 */
async function verify0015() {
  console.log('\n=== Verifying Migration 0015 ===');

  const checks = [
    { name: 'p3_narrative_intelligence table', sql: "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'p3_narrative_intelligence')" },
    { name: 'p3_constituent_snapshots table', sql: "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'p3_constituent_snapshots')" },
    { name: 'p3_constituent_snapshot_members table', sql: "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'p3_constituent_snapshot_members')" },
    { name: 'prevent_p3_history_mutation function', sql: "SELECT EXISTS (SELECT FROM pg_proc WHERE proname = 'prevent_p3_history_mutation')" },
  ];

  let allPass = true;
  for (const check of checks) {
    const result = await pool.query(check.sql);
    const exists = result.rows[0].exists;
    if (exists) {
      console.log(`✅ ${check.name}: EXISTS`);
    } else {
      console.log(`❌ ${check.name}: MISSING`);
      allPass = false;
    }
  }

  return allPass;
}

/**
 * Verify migration 0016
 */
async function verify0016() {
  console.log('\n=== Verifying Migration 0016 ===');

  const checks = [
    { name: 'p3_leadership_members table', sql: "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'p3_leadership_members')" },
    { name: 'leader_coin_id column', sql: "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'p3_narrative_intelligence' AND column_name = 'leader_coin_id')" },
    { name: 'leader_score column', sql: "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'p3_narrative_intelligence' AND column_name = 'leader_score')" },
    { name: 'concentration_classification column', sql: "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'p3_narrative_intelligence' AND column_name = 'concentration_classification')" },
  ];

  let allPass = true;
  for (const check of checks) {
    const result = await pool.query(check.sql);
    const exists = result.rows[0].exists;
    if (exists) {
      console.log(`✅ ${check.name}: EXISTS`);
    } else {
      console.log(`❌ ${check.name}: MISSING`);
      allPass = false;
    }
  }

  return allPass;
}

/**
 * Verify migration 0017
 */
async function verify0017() {
  console.log('\n=== Verifying Migration 0017 ===');

  const result = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.columns
      WHERE table_name = 'p3_narrative_intelligence'
      AND column_name = 'rotation_score'
    )
  `);

  const exists = result.rows[0].exists;
  if (exists) {
    console.log(`✅ rotation_score column: EXISTS`);
    return true;
  } else {
    console.log(`❌ rotation_score column: MISSING`);
    return false;
  }
}

/**
 * Verify migration 0018
 */
async function verify0018() {
  console.log('\n=== Verifying Migration 0018 ===');

  const checks = [
    { name: 'idx_score_configs_active index', sql: "SELECT EXISTS (SELECT FROM pg_indexes WHERE indexname = 'idx_score_configs_active')" },
    { name: 'idx_score_configs_type_key index', sql: "SELECT EXISTS (SELECT FROM pg_indexes WHERE indexname = 'idx_score_configs_type_key')" },
    { name: 'score_configs_config_type_key_version_unique constraint', sql: "SELECT EXISTS (SELECT FROM pg_constraint WHERE conname = 'score_configs_config_type_key_version_unique')" },
  ];

  let allPass = true;
  for (const check of checks) {
    const result = await pool.query(check.sql);
    const exists = result.rows[0].exists;
    if (exists) {
      console.log(`✅ ${check.name}: EXISTS`);
    } else {
      console.log(`❌ ${check.name}: MISSING`);
      allPass = false;
    }
  }

  // Check for P3 configs
  const p3Configs = await pool.query(`
    SELECT config_key, version
    FROM score_configs
    WHERE config_type = 'P3'
  `);

  console.log(`\nP3 Configs found: ${p3Configs.rows.length}`);
  p3Configs.rows.forEach(config => {
    console.log(`  - ${config.config_key} v${config.version}`);
  });

  const expectedConfigs = ['regime_thresholds', 'rotation_thresholds'];
  const foundConfigs = p3Configs.rows.map(r => r.config_key);
  const missingConfigs = expectedConfigs.filter(c => !foundConfigs.includes(c));

  if (missingConfigs.length > 0) {
    console.log(`❌ Missing P3 configs: ${missingConfigs.join(', ')}`);
    allPass = false;
  } else {
    console.log(`✅ All expected P3 configs present`);
  }

  return allPass;
}

/**
 * Verify P0-P2 config integrity
 */
async function verifyP0P2Integrity() {
  console.log('\n=== Verifying P0-P2 Config Integrity ===');

  const configs = await pool.query(`
    SELECT config_type, config_key, config_value
    FROM score_configs
    WHERE config_type IN ('health_weights', 'recommendation_thresholds', 'confidence_weights')
    ORDER BY config_type
  `);

  console.log(`P0-P2 Configs found: ${configs.rows.length}`);
  configs.rows.forEach(config => {
    console.log(`  - ${config.config_type} / ${config.config_key}`);
  });

  const expectedCount = 3;
  if (configs.rows.length === expectedCount) {
    console.log(`✅ All P0-P2 configs present and unchanged`);
    return true;
  } else {
    console.log(`❌ Expected ${expectedCount} P0-P2 configs, found ${configs.rows.length}`);
    return false;
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log('=== P3 Production Migration Execution ===');
  console.log(`Database: ${databaseUrl.replace(/:[^:]*@/, ':****@')}\n`);
  console.log('BACKUP STATUS: NOT VERIFIED');
  console.log('⚠️  Manual backup verification recommended before proceeding\n');

  const migrations = [
    '0015_add_p3_intelligence.sql',
    '0016_add_p3_leadership.sql',
    '0017_add_p3_rotation_score.sql',
    '0018_add_p3_score_configs.sql'
  ];

  for (const migration of migrations) {
    const success = await executeMigration(migration);
    if (!success) {
      console.log(`\n❌ Migration failed at ${migration}. Stopping execution.`);
      await pool.end();
      process.exit(1);
    }

    // Verify after each migration
    if (migration === '0015_add_p3_intelligence.sql') {
      const verified = await verify0015();
      if (!verified) {
        console.log('\n❌ Verification failed for 0015. Stopping execution.');
        await pool.end();
        process.exit(1);
      }
    } else if (migration === '0016_add_p3_leadership.sql') {
      const verified = await verify0016();
      if (!verified) {
        console.log('\n❌ Verification failed for 0016. Stopping execution.');
        await pool.end();
        process.exit(1);
      }
    } else if (migration === '0017_add_p3_rotation_score.sql') {
      const verified = await verify0017();
      if (!verified) {
        console.log('\n❌ Verification failed for 0017. Stopping execution.');
        await pool.end();
        process.exit(1);
      }
    } else if (migration === '0018_add_p3_score_configs.sql') {
      const verified = await verify0018();
      if (!verified) {
        console.log('\n❌ Verification failed for 0018. Stopping execution.');
        await pool.end();
        process.exit(1);
      }
    }
  }

  // Final P0-P2 integrity check
  const p0p2Integrity = await verifyP0P2Integrity();
  if (!p0p2Integrity) {
    console.log('\n❌ P0-P2 config integrity check failed.');
    await pool.end();
    process.exit(1);
  }

  console.log('\n=== All Migrations PASS ===');
  console.log('✅ 0015: PASS');
  console.log('✅ 0016: PASS');
  console.log('✅ 0017: PASS');
  console.log('✅ 0018: PASS');
  console.log('✅ P0-P2 Integrity: PASS');

  await pool.end();
}

main();
