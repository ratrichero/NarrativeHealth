const http = require('http');

const data = JSON.stringify({ jobName: 'SQ_LIVE_02_test_with_tables' });

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/refresh',
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