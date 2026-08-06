const http = require('http');

function testEndpoint(url, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {}
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: data
        });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('=== Test 1: Coin timeline (valid) ===');
  try {
    const result = await testEndpoint('http://localhost:3000/api/coins/1/health-timeline?days=30');
    console.log(`Status: ${result.status}`);
    console.log(`Body: ${result.body.substring(0, 200)}...`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  console.log('\n=== Test 2: Coin timeline (invalid ID) ===');
  try {
    const result = await testEndpoint('http://localhost:3000/api/coins/abc/health-timeline');
    console.log(`Status: ${result.status}`);
    console.log(`Body: ${result.body}`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  console.log('\n=== Test 3: Narrative timeline ===');
  try {
    const result = await testEndpoint('http://localhost:3000/api/narratives/1/health-timeline');
    console.log(`Status: ${result.status}`);
    console.log(`Body: ${result.body.substring(0, 200)}...`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  console.log('\n=== Test 4: List rule versions ===');
  try {
    const result = await testEndpoint('http://localhost:3000/api/admin/rule-versions');
    console.log(`Status: ${result.status}`);
    console.log(`Body: ${result.body.substring(0, 200)}...`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  console.log('\n=== Test 5: Create version (valid weights) ===');
  try {
    const result = await testEndpoint('http://localhost:3000/api/admin/rule-versions', 'POST', {
      description: "Test version from Agent C",
      healthWeights: { trend: 0.40, derivative: 0.30, volume: 0.20, momentum: 0.10 },
      confidenceWeights: { binance_spot: 0.40, binance_futures: 0.40, coingecko: 0.20 },
      recommendationThresholds: { strong_watch: 90, watch: 80, observe: 65 }
    });
    console.log(`Status: ${result.status}`);
    console.log(`Body: ${result.body.substring(0, 200)}...`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  console.log('\n=== Test 6: Create version (invalid weights) ===');
  try {
    const result = await testEndpoint('http://localhost:3000/api/admin/rule-versions', 'POST', {
      healthWeights: { trend: 0.5, derivative: 0.5, volume: 0.2, momentum: 0.1 },
      confidenceWeights: { binance_spot: 0.40, binance_futures: 0.40, coingecko: 0.20 },
      recommendationThresholds: { strong_watch: 90, watch: 80, observe: 65 }
    });
    console.log(`Status: ${result.status}`);
    console.log(`Body: ${result.body}`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  console.log('\n=== Test 7: Activate version 2 ===');
  try {
    const result = await testEndpoint('http://localhost:3000/api/admin/rule-versions/2/activate', 'POST');
    console.log(`Status: ${result.status}`);
    console.log(`Body: ${result.body}`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  console.log('\n=== Test 8: Activate non-existent version ===');
  try {
    const result = await testEndpoint('http://localhost:3000/api/admin/rule-versions/999/activate', 'POST');
    console.log(`Status: ${result.status}`);
    console.log(`Body: ${result.body}`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  console.log('\n=== Cleanup: Restore version 1 ===');
  try {
    const result = await testEndpoint('http://localhost:3000/api/admin/rule-versions/1/activate', 'POST');
    console.log(`Status: ${result.status}`);
    console.log(`Body: ${result.body.substring(0, 200)}...`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

runTests().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
