// Trigger Square publication through existing production infrastructure
const http = require('http');

// Use a simple test content that we control
const content = `🔍 BTC Test Analysis

Controlled test for SQ-LIVE-02 verification
Strong bullish momentum detected
Volume above average
Confidence: 75%

📊 Entry Zone: 65000 - 67000
🎯 Take Profits:
  TP1: 69000
  TP2: 72000
🛑 Stop Loss: 63000

$BTC`;

const data = JSON.stringify({
  text: content,
  title: "BTC Test Analysis",
  testMode: true // Flag to indicate this is a controlled test
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/admin/p3/execute', // Use existing endpoint
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', body);
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.write(data);
req.end();