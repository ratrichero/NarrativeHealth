/**
 * Backup Availability Check (READ-ONLY)
 *
 * This script checks if a database backup/snapshot is available.
 * This is READ-ONLY and does not modify anything.
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

async function checkBackupAvailability() {
  console.log('=== Backup Availability Check (READ-ONLY) ===');
  console.log(`Database: ${databaseUrl.replace(/:[^:]*@/, ':****@')}\n`);

  // Check for pg_dump availability (common backup tool)
  console.log('Checking for backup indicators...\n');

  // Check for common backup tables
  const backupTables = await pool.query(`
    SELECT tablename
    FROM pg_tables
    WHERE tablename LIKE '%backup%'
       OR tablename LIKE '%snapshot%'
       OR tablename LIKE '%archive%'
    ORDER BY tablename
  `);

  if (backupTables.rows.length > 0) {
    console.log(`Found ${backupTables.rows.length} potential backup tables:`);
    backupTables.rows.forEach(row => {
      console.log(`  - ${row.tablename}`);
    });
  } else {
    console.log('No backup tables found');
  }

  // Check for backup schemas
  const backupSchemas = await pool.query(`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE '%backup%'
       OR schema_name LIKE '%archive%'
    ORDER BY schema_name
  `);

  if (backupSchemas.rows.length > 0) {
    console.log(`\nFound ${backupSchemas.rows.length} potential backup schemas:`);
    backupSchemas.rows.forEach(row => {
      console.log(`  - ${row.schema_name}`);
    });
  } else {
    console.log('No backup schemas found');
  }

  // Check for replication slots (common for backups)
  const replicationSlots = await pool.query(`
    SELECT slot_name, slot_type, active
    FROM pg_replication_slots
  `);

  if (replicationSlots.rows.length > 0) {
    console.log(`\nFound ${replicationSlots.rows.length} replication slots:`);
    replicationSlots.rows.forEach(row => {
      console.log(`  - ${row.slot_name} (${row.slot_type}, active: ${row.active})`);
    });
  } else {
    console.log('\nNo replication slots found');
  }

  console.log('\n=== Backup Check Complete ===');
  console.log('BACKUP STATUS: NOT VERIFIED');
  console.log('⚠️  Automated backup availability could not be determined');
  console.log('⚠️  Manual backup verification recommended before migration');

  await pool.end();
}

checkBackupAvailability();
