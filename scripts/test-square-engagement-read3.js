// Probe 3: community-known bapi patterns + shareLink resolution.
require("dotenv").config();

const POST_ID = "369682866996034";

const candidates = [
  // Patterns documented by community reverse-engineering of Square web
  { name: "composite/v1/public/cms/article/detail", url: `https://www.binance.com/bapi/composite/v1/public/cms/article/detail?articleNo=${POST_ID}` },
  { name: "composite/v1/public/square/feed", url: `https://www.binance.com/bapi/composite/v1/public/square/feed?postId=${POST_ID}` },
  { name: "composite/v3/public/content/post", url: `https://www.binance.com/bapi/composite/v3/public/content/post?postId=${POST_ID}` },
  // POST-style feed detail (many Square bapi endpoints are POST-only)
  { name: "POST composite/v1/public/market/square/detail", url: `https://www.binance.com/bapi/composite/v1/public/market/square/detail`, method: "POST", body: { postId: POST_ID } },
  { name: "POST composite/v1/public/promo/cms/post/detail", url: `https://www.binance.com/bapi/composite/v1/public/promo/cms/post/detail`, method: "POST", body: { postId: POST_ID } },
];

async function probe(c) {
  try {
    const method = c.method ?? "GET";
    const opts = {
      method,
      headers: { "Content-Type": "application/json", clienttype: "web" },
      signal: AbortSignal.timeout(15000),
    };
    if (c.body) opts.body = JSON.stringify(c.body);
    const res = await fetch(c.url, opts);
    const raw = await res.text();
    console.log(`\n=== ${c.name} === HTTP ${res.status}`);
    const counts = [...raw.matchAll(/"(commentCount|likeCount|viewCount|shareCount|favoriteCount|readCount)"\s*:\s*"?(\d+)/g)].map((m) => `${m[1]}=${m[2]}`);
    console.log("counts:", counts.length ? counts.join(", ") : "none");
    if (!counts.length) console.log(raw.slice(0, 250).replace(/\s+/g, " "));
  } catch (e) {
    console.log(`\n=== ${c.name} === ERROR: ${e.message}`);
  }
}

(async () => {
  for (const c of candidates) await probe(c);
})();
