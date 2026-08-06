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

async function runTest7() {
  console.log('=== Test 7: Activate version 2 ===');
  try {
    const result = await testEndpoint('http://localhost:3000/api/admin/rule-versions/2/activate', 'POST');
    console.log(`Status: ${result.status}`);
    console.log(`Body: ${result.body}`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

async function runTest8() {
  console.log('\n=== Test 8: Activate non-existent version ===');
  try {
    const result = await testEndpoint('http://localhost:3000/api/admin/rule-versions/999/activate', 'POST');
    console.log(`Status: ${result.status}`);
    console.log(`Body: ${result.body}`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

async function runCleanup() {
  console.log('\n=== Cleanup: Restore version 1 ===');
  try {
    const result = await testEndpoint('http://localhost:3000/api/admin/rule-versions/1/activate', 'POST');
    console.log(`Status: ${result.status}`);
    console.log(`Body: ${result.body}`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

async function main() {
  await runTest7();
  await runTest8();
  await runCleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
