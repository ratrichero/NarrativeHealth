require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL?.replace('postgresql+asyncpg://', 'postgresql://') });

(async () => {
  const result = await pool.query("SELECT id, coin_symbol, score, type FROM square_opportunities WHERE type = 'COIN_SETUP' AND status = 'CANDIDATE' ORDER BY score DESC LIMIT 10");
  console.log('COIN_SETUP candidates:');
  result.rows.forEach(row => {
    console.log('ID:', row.id, 'Coin:', row.coin_symbol, 'Score:', row.score);
  });
  
  // Check which ones have been published
  const pubResult = await pool.query('SELECT DISTINCT opportunity_id FROM square_publications');
  const publishedIds = pubResult.rows.map(r => r.opportunity_id);
  console.log('\nAlready published opportunity IDs:', publishedIds);
  
  const candidates = result.rows.filter(r => !publishedIds.includes(r.id));
  console.log('\nUnpublished COIN_SETUP candidates:');
  candidates.forEach(row => {
    console.log('ID:', row.id, 'Coin:', row.coin_symbol, 'Score:', row.score);
  });
  
  if (candidates.length > 0) {
    console.log('\n=== Best Unpublished Candidate ===');
    const best = candidates[0];
    const detailResult = await pool.query('SELECT * FROM square_opportunities WHERE id = $1', [best.id]);
    console.log(JSON.stringify(detailResult.rows[0], null, 2));
  }
  
  await pool.end();
})();