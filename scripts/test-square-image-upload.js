// SQ-CHART-PROBE: Safely test whether the Binance Square OpenAPI supports
// image upload (contentType 2 / media endpoints) on the REAL API key.
//
// Usage: node scripts/test-square-image-upload.js
//
// Safety:
//  - Only runs when BINANCE_SQUARE_OPENAPI_KEY is set.
//  - Posts a clearly-labeled test, then prints the response so we can decide
//    whether to wire image upload into the pipeline.
//  - Never logs the API key.
require('dotenv').config();

const apiKey = process.env.BINANCE_SQUARE_OPENAPI_KEY;
if (!apiKey) {
  console.error('BINANCE_SQUARE_OPENAPI_KEY not set — cannot probe.');
  process.exit(1);
}

const BASE = 'https://www.binance.com/bapi/composite/v1/public/pgc/openApi';
const POST_TEXT =
  '[TEST] Chart image upload probe — will be deleted. $BTC';

async function tryEndpoint(name, url, options) {
  try {
    const res = await fetch(url, options);
    const raw = await res.text();
    console.log(`\n=== ${name} ===`);
    console.log('HTTP', res.status);
    console.log('Body:', raw.slice(0, 500));
    return raw;
  } catch (e) {
    console.log(`\n=== ${name} ===`);
    console.log('ERROR:', e.message);
    return null;
  }
}

async function main() {
  console.log('=== SQ Chart Upload Probe ===');
  console.log('Strategy: probe documented-but-unverified endpoints one by one.\n');

  // Probe 1: contentType 2 (article with title) — documented as "where supported"
  await tryEndpoint('Probe 1: contentType 2', `${BASE}/content/add`, {
    method: 'POST',
    headers: {
      'X-Square-OpenAPI-Key': apiKey,
      'Content-Type': 'application/json',
      clienttype: 'binanceSkill',
    },
    body: JSON.stringify({
      contentType: 2,
      title: 'SQ Chart Probe',
      bodyTextOnly: POST_TEXT,
    }),
    signal: AbortSignal.timeout(30000),
  });

  // Probe 2: common media upload path (guess based on error 220014 "upload limit")
  await tryEndpoint('Probe 2: media/upload (multipart)', `${BASE}/media/upload`, {
    method: 'POST',
    headers: {
      'X-Square-OpenAPI-Key': apiKey,
      clienttype: 'binanceSkill',
    },
    body: (() => {
      const fd = new FormData();
      // 1x1 transparent PNG
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64'
      );
      fd.append('file', new Blob([png], { type: 'image/png' }), 'probe.png');
      return fd;
    })(),
    signal: AbortSignal.timeout(30000),
  });

  console.log('\n=== Probe complete ===');
  console.log(
    'Next: if any probe returned code 000000, image upload is supported and' +
      ' can be wired into the publisher behind a feature flag.'
  );
}

main();
