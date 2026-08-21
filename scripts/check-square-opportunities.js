// Check existing Square opportunities in production database
require('dotenv').config();
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL?.replace(
  "postgresql+asyncpg://",
  "postgresql://"
);

const pool = new Pool({
  connectionString: databaseUrl,
});

async function checkOpportunities() {
  try {
    console.log('=== SQ-LIVE-02 Production Database Check ===\n');
    
    // Check today's quota
    const today = new Date().toISOString().split('T')[0];
    const quotaResult = await pool.query(
      'SELECT * FROM square_quota_log WHERE date = $1',
      [today]
    );
    
    console.log('Today\'s quota status:');
    if (quotaResult.rows.length > 0) {
      console.log('Posts published today:', quotaResult.rows[0].posts_published);
      console.log('Posts remaining:', 100 - quotaResult.rows[0].posts_published);
    } else {
      console.log('No quota record for today - assuming 0 posts published');
      console.log('Posts remaining: 100');
    }
    
    // Check existing opportunities
    const oppResult = await pool.query(`
      SELECT id, type, subject_id, coin_symbol, score, data_as_of, 
             data_quality, status, created_at
      FROM square_opportunities 
      WHERE status = 'CANDIDATE' OR status = 'QUALIFIED'
      ORDER BY score DESC
      LIMIT 10
    `);
    
    console.log('\nExisting opportunities (CANDIDATE/QUALIFIED):');
    console.log('Total found:', oppResult.rows.length);
    
    if (oppResult.rows.length > 0) {
      console.log('\nTop opportunities:');
      oppResult.rows.forEach((row, i) => {
        console.log(`${i + 1}. ID: ${row.id}, Coin: ${row.coin_symbol}, Score: ${row.score}, Status: ${row.status}, Type: ${row.type}`);
      });
    }
    
    // Check recent publications
    const pubResult = await pool.query(`
      SELECT id, opportunity_id, status, external_post_id, published_at
      FROM square_publications 
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    console.log('\nRecent publications:');
    console.log('Total found:', pubResult.rows.length);
    
    if (pubResult.rows.length > 0) {
      console.log('\nLatest publications:');
      pubResult.rows.forEach((row, i) => {
        console.log(`${i + 1}. ID: ${row.id}, Status: ${row.status}, External ID: ${row.external_post_id || 'N/A'}, Published: ${row.published_at || 'N/A'}`);
      });
    }
    
    // Get detailed opportunity data for the best candidate
    if (oppResult.rows.length > 0) {
      const bestOpp = oppResult.rows[0];
      console.log('\n=== Best Opportunity Details ===');
      console.log('ID:', bestOpp.id);
      console.log('Type:', bestOpp.type);
      console.log('Coin Symbol:', bestOpp.coin_symbol);
      console.log('Score:', bestOpp.score);
      console.log('Status:', bestOpp.status);
      console.log('Data Quality:', bestOpp.data_quality);
      console.log('Data As Of:', bestOpp.data_as_of);
      
      // Get full details including rationale and entry/TP/SL
      const detailResult = await pool.query(
        'SELECT * FROM square_opportunities WHERE id = $1',
        [bestOpp.id]
      );
      
      if (detailResult.rows.length > 0) {
        const details = detailResult.rows[0];
        console.log('\nRationale:', JSON.stringify(details.rationale, null, 2));
        console.log('\nEntry Zone:', JSON.stringify(details.entry_zone, null, 2));
        console.log('\nTake Profits:', JSON.stringify(details.take_profits, null, 2));
        console.log('\nStop Loss:', JSON.stringify(details.stop_loss, null, 2));
      }
    }
    
  } catch (error) {
    console.error('Database check failed:', error.message);
  } finally {
    await pool.end();
  }
}

checkOpportunities();