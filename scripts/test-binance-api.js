// Test the real Binance Square API call (official contract)
require('dotenv').config();

const BASE_URL_V1 = "https://www.binance.com/bapi/composite/v1/public/pgc/openApi";
const apiKey = process.env.BINANCE_SQUARE_OPENAPI_KEY || "";

if (!apiKey) {
  console.error("BINANCE_SQUARE_OPENAPI_KEY not set");
  process.exit(1);
}

const payload = {
  contentType: 1,
  bodyTextOnly: "$BTC Binance Square API live integration test."
};

async function main() {
  try {
    const res = await fetch(`${BASE_URL_V1}/content/add`, {
      method: "POST",
      headers: {
        "X-Square-OpenAPI-Key": apiKey,
        "Content-Type": "application/json",
        clienttype: "binanceSkill",
      },
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    console.log("HTTP Status:", res.status);
    console.log("Response:", raw);
    // If fail, print error
    try {
      const json = JSON.parse(raw);
      if (json.code !== "000000") {
        console.log("Error:", json.code, json.message);
      } else {
        console.log("SUCCESS!");
        console.log("Data:", JSON.stringify(json.data));
        if (json.data?.id) console.log("Post ID:", json.data.id);
        if (json.data?.shareLink) console.log("Link:", json.data.shareLink);
      }
    } catch {
      console.log("Non-JSON response");
    }
  } catch (e) {
    console.error("Error:", e.message);
  }
}

main();
