// One-off probe: can we READ post engagement (likes/comments/views) for a
// published Square post? Tries plausible read-only endpoints with the real
// post ID from publication 448. GET only — no writes, no key logged.
require("dotenv").config();

const POST_ID = "369682866996034"; // real published post (opp 748, COTI)
const BASE = "https://www.binance.com/bapi/composite/v1";

const candidates = [
  // Documented OpenAPI family (keyed) — unlikely but cheap to check
  { name: "openApi/content/detail", url: `${BASE}/public/pgc/openApi/content/detail?id=${POST_ID}`, keyed: true },
  { name: "openApi/content/stats", url: `${BASE}/public/pgc/openApi/content/stats?id=${POST_ID}`, keyed: true },
  // Public web endpoints the Square frontend itself uses (no key)
  { name: "public/content/post/detail", url: `${BASE}/public/content/post/detail?postId=${POST_ID}`, keyed: false },
  { name: "public/square/post/detail", url: `${BASE}/public/square/post/detail?postId=${POST_ID}`, keyed: false },
  { name: "public/market/kline ... skip", url: "", keyed: false },
].filter((c) => c.url);

async function probe(c) {
  const headers = { "Content-Type": "application/json" };
  if (c.keyed && process.env.BINANCE_SQUARE_OPENAPI_KEY) {
    headers["X-Square-OpenAPI-Key"] = process.env.BINANCE_SQUARE_OPENAPI_KEY;
    headers.clienttype = "binanceSkill";
  }
  try {
    const res = await fetch(c.url, { method: "GET", headers, signal: AbortSignal.timeout(15000) });
    const raw = await res.text();
    let summary = raw.slice(0, 400);
    // Highlight engagement fields if present
    const engagement = {};
    for (const k of ["like", "comment", "view", "share", "favorite", "count", "interact"]) {
      const m = raw.toLowerCase().match(new RegExp(`"${k.toLowerCase()}[a-z]*"\\s*:\\s*([0-9.]+)`, "g"));
      if (m) engagement[k] = m.slice(0, 6);
    }
    console.log(`\n=== ${c.name} ===`);
    console.log("HTTP", res.status, "| engagement fields:", Object.keys(engagement).length ? JSON.stringify(engagement).slice(0, 300) : "none");
    console.log(summary.replace(/\s+/g, " "));
  } catch (e) {
    console.log(`\n=== ${c.name} ===`);
    console.log("ERROR:", e.message);
  }
}

(async () => {
  console.log("Probing engagement read endpoints for post", POST_ID);
  for (const c of candidates) await probe(c);
})();
