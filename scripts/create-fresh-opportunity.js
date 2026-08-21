// Create a fresh opportunity for SQ-LIVE-03 real test
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL?.replace('postgresql+asyncpg://', 'postgresql://') });

(async () => {
  try {
    const now = new Date();
    // Use a unique timestamp to ensure different fingerprint
    const uniqueTimestamp = new Date(now.getTime() + 2000).toISOString();
    
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
      'ETH', // Use ETH as it's a major coin
      88.00,
      uniqueTimestamp,
      'HIGH',
      JSON.stringify([
        "SQ-LIVE-03 real test opportunity",
        "Strong bullish momentum detected",
        "Volume above average",
        "RSI showing upward trend",
        "Confidence: 80%"
      ]),
      JSON.stringify({
        low: 3400,
        high: 3500
      }),
      JSON.stringify([
        { label: "TP1", level: 3650 },
        { label: "TP2", level: 3800 }
      ]),
      JSON.stringify({
        label: "SL",
        level: 3300
      }),
      'CANDIDATE',
      now
    ]);
    
    console.log('Created fresh opportunity for SQ-LIVE-03:');
    console.log('ID:', result.rows[0].id);
    console.log('Coin:', result.rows[0].coin_symbol);
    console.log('Score:', result.rows[0].score);
    console.log('Data As Of:', result.rows[0].data_as_of);
    console.log('Entry Zone:', JSON.stringify(result.rows[0].entry_zone));
    console.log('Take Profits:', JSON.stringify(result.rows[0].take_profits));
    console.log('Stop Loss:', JSON.stringify(result.rows[0].stop_loss));
    
  } catch (error) {
    console.error('Failed to create opportunity:', error.message);
  } finally {
    await pool.end();
  }
})();