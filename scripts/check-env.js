// Check environment variables for SQ-LIVE-02 pre-flight
// This script only checks existence, never prints values
require('dotenv').config();

console.log('=== SQ-LIVE-02 Pre-flight Environment Check ===\n');

const binanceKey = process.env.BINANCE_SQUARE_OPENAPI_KEY;
const openaiKey = process.env.OPENAI_API_KEY; // LLM primary (Groq)
const databaseUrl = process.env.DATABASE_URL;

console.log('BINANCE_SQUARE_OPENAPI_KEY configured:', binanceKey ? 'YES' : 'NO');
console.log('OPENAI_API_KEY configured:', openaiKey ? 'YES' : 'NO');
console.log('DATABASE_URL configured:', databaseUrl ? 'YES' : 'NO');

if (binanceKey) {
  console.log('API key length:', binanceKey.length);
  console.log('API key format:', binanceKey.startsWith('sk-') || binanceKey.length > 20 ? 'VALID FORMAT' : 'UNKNOWN FORMAT');
}