// RADAR-06 — nguồn news qua RSS (free, đã probe 200 ngày 2026-11-18):
//   CoinDesk (308 → 200 với redirect), Cointelegraph, Decrypt, The Block.
// Chỉ lưu tiêu đề + link + thời gian; không lưu toàn văn bài báo.

import { extractTickers } from "./normalize";
import type { CatalystFact, CatalystSource } from "./types";

export const RSS_FEEDS: Array<{ source: CatalystSource; url: string; label: string }> = [
  { source: "RSS_COINDESK", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", label: "CoinDesk" },
  { source: "RSS_COINTELEGRAPH", url: "https://cointelegraph.com/rss", label: "Cointelegraph" },
  { source: "RSS_DECRYPT", url: "https://decrypt.co/feed", label: "Decrypt" },
  { source: "RSS_THEBLOCK", url: "https://www.theblock.co/rss.xml", label: "The Block" },
];

const UA = "Mozilla/5.0 (compatible; NarrativeHealth/1.0; +https://coins.run.place)";
const CACHE_MS = 10 * 60_000;
const MAX_ITEMS = 30;

const cache = new Map<string, { expires: number; facts: CatalystFact[] }>();

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")).trim();
}

function pick(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? stripTags(match[1]) : null;
}

/** Pure: parse XML RSS thành facts. Test dùng fixture thật. */
export function parseRssItems(xml: string, source: CatalystSource): CatalystFact[] {
  const facts: CatalystFact[] = [];
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];

  for (const item of items.slice(0, MAX_ITEMS)) {
    const title = pick(item, "title");
    const link = pick(item, "link");
    if (!title || !link) continue;

    const guid = pick(item, "guid");
    const pubDate = pick(item, "pubDate");
    const published = pubDate ? new Date(pubDate) : new Date();
    const symbols = extractTickers(title);

    facts.push({
      type: "NEWS",
      source,
      externalId: `${source.toLowerCase()}:${guid || link}`.slice(0, 200),
      title: title.slice(0, 300),
      sourceUrl: link,
      symbols,
      publishedAt: (Number.isFinite(published.getTime()) ? published : new Date()).toISOString(),
      eventDate: null,
      facts: { feed: source },
      raw: { title, link, pubDate },
    });
  }

  return facts;
}

export async function fetchRssFeed(feed: {
  source: CatalystSource;
  url: string;
}): Promise<CatalystFact[]> {
  const cached = cache.get(feed.source);
  if (cached && cached.expires > Date.now()) return cached.facts;

  const response = await fetch(feed.url, {
    headers: { accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8", "user-agent": UA },
    signal: AbortSignal.timeout(10_000),
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`RSS ${feed.source} HTTP ${response.status}`);
  }
  const xml = await response.text();
  const facts = parseRssItems(xml, feed.source);
  if (facts.length === 0) {
    throw new Error(`RSS ${feed.source}: không parse được item nào`);
  }
  cache.set(feed.source, { expires: Date.now() + CACHE_MS, facts });
  return facts;
}

export function _resetRssCache(): void {
  cache.clear();
}
