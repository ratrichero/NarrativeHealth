// Create a new opportunity directly for testing
require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({ connectionString: process.env.DATABASE_URL?.replace('postgresql+asyncpg://', 'postgresql://') });

async function createTestOpportunity() {
  try {
    const now = new Date();
    
    // Use a different timestamp to create unique fingerprint
    const uniqueTimestamp = new Date(now.getTime() + 1000).toISOString();
    
    const result = await pool.query(`
      INSERT INTO square_opportunities 
      (type, subject_id, narrative_id, coin_symbol, score, data_as_of, data_quality, 
       rationale, entry_zone, take_profits, stop_loss, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      'COIN_SETUP',
      29, // subject_id (using existing coin ID)
      4,  // narrative_id
      'BTC', // Use BTC as it's a major coin
      85.50,
      uniqueTimestamp,
      'HIGH',
      JSON.stringify([
        "Test opportunity for SQ-LIVE-02",
        "Strong bullish momentum",
        "Volume above average",
        "Confidence: 75%"
      ]),
      JSON.stringify({
        low: 65000,
        high: 67000
      }),
      JSON.stringify([
        { label: "TP1", level: 69000 },
        { label: "TP2", level: 72000 }
      ]),
      JSON.stringify({
        label: "SL",
        level: 63000
      }),
      'CANDIDATE',
      now
    ]);
    
    console.log('Created test opportunity:');
    console.log('ID:', result.rows[0].id);
    console.log('Coin:', result.rows[0].coin_symbol);
    console.log('Score:', result.rows[0].score);
    console.log('Data As Of:', result.rows[0].data_as_of);
    
    return result.rows[0].id;
    
  } catch (error) {
    console.error('Failed to create opportunity:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

createTestOpportunity().then(id => {
  console.log('\nCreated opportunity ID:', id);
  console.log('You can now use this ID for controlled publication.');
}).catch(err => {
  console.error('Script failed:', err);
});