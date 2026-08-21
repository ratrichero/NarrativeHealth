const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const databaseUrl = process.env.DATABASE_URL?.replace(
  "postgresql+asyncpg://",
  "postgresql://"
) || "postgresql://upaper:Dotask24h365@168.138.179.192:5432/mdd";

const pool = new Pool({
  connectionString: databaseUrl,
});

async function applyMigration() {
  try {
    const migrationPath = path.join(__dirname, '../drizzle/migrations/0022_add_square_tables.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Applying Square tables migration...');
    await pool.query(migrationSQL);
    console.log('Migration applied successfully!');
    
    // Verify tables exist
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE 'square_%'
      ORDER BY table_name;
    `);
    
    console.log('Square tables created:', result.rows.map(r => r.table_name));
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

applyMigration();