require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL?.replace('postgresql+asyncpg://', 'postgresql://') });

(async () => {
  const result = await pool.query('SELECT * FROM square_opportunities WHERE type = $1 AND coin_symbol IN ($2, $3, $4) ORDER BY score DESC LIMIT 5', ['COIN_SETUP', 'BTC', 'ETH', 'SOL']);
  console.log('Major coin opportunities:');
  console.log(JSON.stringify(result.rows, null, 2));
  await pool.end();
})();