// Probe 2: the actual Square webapp feed endpoints (observed from public
// web traffic patterns) + the canonical post page for SSR-embedded stats.
require("dotenv").config();

const POST_ID = "369682866996034";
const POST_URL = `https://www.binance.com/en/square/post/${POST_ID}`;

const candidates = [
  { name: "bapi/composite/v3/public/market/post/detail", url: `https://www.binance.com/bapi/composite/v1/public/promo/cms/market/post/detail?postId=${POST_ID}` },
  { name: "bapi/feed square post", url: `https://www.binance.com/bapi/composite/v1/public/promo/cms/square/post/detail?id=${POST_ID}` },
  { name: "bapi/cryptology fanzgat detail", url: `https://www.binance.com/bapi/composite/v1/public/promo/cms/cryptology/post/detail?postId=${POST_ID}` },
];

async function probe(c) {
  try {
    const res = await fetch(c.url, { headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000) });
    const raw = await res.text();
    console.log(`\n=== ${c.name} === HTTP ${res.status}`);
    console.log(raw.slice(0, 300).replace(/\s+/g, " "));
  } catch (e) {
    console.log(`\n=== ${c.name} === ERROR: ${e.message}`);
  }
}

async function fetchPostPage() {
  try {
    const res = await fetch(POST_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" },
      signal: AbortSignal.timeout(20000),
    });
    const html = await res.text();
    console.log(`\n=== SSR post page === HTTP ${res.status}, length=${html.length}`);
    // Look for embedded engagement numbers in __NEXT_DATA__ / meta
    const likeMatch = html.match(/"likeCount"\s*:\s*(\d+)/) || html.match(/"likes?"\s*:\s*"?(\d+)/);
    const commentMatch = html.match(/"commentCount"\s*:\s*(\d+)/);
    const viewMatch = html.match(/"viewCount"\s*:\s*(\d+)/) || html.match(/"readCount"\s*:\s*(\d+)/);
    console.log("likeCount:", likeMatch?.[1] ?? "not found");
    console.log("commentCount:", commentMatch?.[1] ?? "not found");
    console.log("viewCount:", viewMatch?.[1] ?? "not found");
    // Any JSON blob with "count" fields for engagement
    const counts = [...html.matchAll(/"(commentCount|likeCount|viewCount|shareCount|favoriteCount|readCount)"\s*:\s*"?(\d+)/g)].map((m) => `${m[1]}=${m[2]}`);
    console.log("all count fields:", counts.length ? counts.join(", ") : "none");
  } catch (e) {
    console.log("SSR page ERROR:", e.message);
  }
}

(async () => {
  for (const c of candidates) await probe(c);
  await fetchPostPage();
})();
