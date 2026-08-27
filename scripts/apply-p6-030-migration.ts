import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const databaseUrl = process.env.DATABASE_URL?.replace('postgresql+asyncpg://', 'postgresql://');
if (!databaseUrl) { console.error('DATABASE_URL not found'); process.exit(1); }

const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 15000 });

const migrationPath = resolve(__dirname, '../drizzle/migrations/0030_add_p6_core_tables.sql');
const SQL = readFileSync(migrationPath, 'utf8');

(async () => {
  try {
    const client = await pool.connect();
    console.log('Connected to database');
    await client.query(SQL);
    console.log('Migration 0030 applied successfully');

    // Verify all 4 tables
    const tables = ['p6_snapshots', 'p6_regime_states', 'p6_warnings', 'p6_intelligence_summaries'];
    for (const table of tables) {
      const res = await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_name = $1`,
        [table]
      );
      console.log(`${table}: ${res.rows.length > 0 ? 'EXISTS' : 'MISSING'}`);
    }

    client.release();
    console.log('DONE');
  } catch (e: any) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
