// RADAR-DEMO — catalyst facts mẫu CHỈ dùng khi RADAR_DEMO=1.
//
// Mục đích: panel “Vì sao volume bất thường?” và hai card admin Catalyst
// sync/coverage có số liệu thật (facts + link nguồn, trạng thái sync, % phủ)
// khi server bị Binance geo-block (HTTP 451) hoặc khi dev không có DB.
//
// Dữ liệu là mẫu, KHÔNG gọi mạng, KHÔNG ghi DB. Tiêu đề có hậu tố “(demo)” để
// người xem không nhầm với tin thật; link trỏ tới trang nguồn tương ứng.

import type { CatalystFact } from "./types";
import type { CatalystSyncStatus } from "./sync";

const HOUR = 3_600_000;
const DAY = 86_400_000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function dateOnly(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Fact mẫu, thời gian tính tương đối theo `now` để demo không bị “cũ”. */
export function demoCatalystFacts(now = Date.now()): CatalystFact[] {
  return [
    {
      type: "LISTING",
      source: "BINANCE_ANNOUNCEMENT",
      externalId: "demo-binance-listing-ena",
      title: "Binance Will List Ethena (ENA) and Open Spot Trading (demo)",
      sourceUrl: "https://www.binance.com/en/support/announcement",
      symbols: ["ENA"],
      publishedAt: iso(now - 6 * HOUR),
      facts: { listing: "spot", quoteAsset: "USDT" },
    },
    {
      type: "UNLOCK",
      source: "EVENT_RISKS_UNLOCK",
      externalId: "demo-unlock-ena-next-epoch",
      title: "Ethena (ENA) linear unlock — 0.52% of circulating supply (demo)",
      sourceUrl: "https://token.unlocks.app/ethena",
      symbols: ["ENA"],
      publishedAt: iso(now - 2 * DAY),
      eventDate: dateOnly(now + 2 * DAY),
      facts: { unlockPct: 0.52 },
    },
    {
      type: "NEWS",
      source: "RSS_COINDESK",
      externalId: "demo-rss-coindesk-sui-defi",
      title: "Sui DeFi deposits climb as network activity hits a monthly high (demo)",
      sourceUrl: "https://www.coindesk.com/markets/",
      symbols: ["SUI"],
      publishedAt: iso(now - 18 * HOUR),
    },
    {
      type: "NEWS",
      source: "RSS_THEBLOCK",
      externalId: "demo-rss-theblock-render",
      title: "Render Network proposes expansion of GPU capacity for AI workloads (demo)",
      sourceUrl: "https://www.theblock.co/latest",
      symbols: ["RNDR"],
      publishedAt: iso(now - 12 * HOUR),
    },
    {
      type: "NEWS",
      source: "RSS_COINTELEGRAPH",
      externalId: "demo-rss-cointelegraph-fet",
      title: "Fetch.ai outlines agent-to-agent payments pilot with enterprise partners (demo)",
      sourceUrl: "https://cointelegraph.com/tags/artificial-intelligence",
      symbols: ["FET"],
      publishedAt: iso(now - 9 * HOUR),
    },
    {
      type: "UNLOCK",
      source: "EVENT_RISKS_UNLOCK",
      externalId: "demo-unlock-fet-cliff",
      title: "Fetch.ai (FET) cliff unlock for early backers (demo)",
      sourceUrl: "https://token.unlocks.app/fetch-ai",
      symbols: ["FET"],
      publishedAt: iso(now - 4 * DAY),
      eventDate: dateOnly(now + DAY),
      facts: { unlockPct: 1.1 },
    },
  ];
}

/** Symbol → catalyst types/sources, dùng để gắn nhãn ledger demo từ chính facts. */
export function demoCatalystLabels(
  now = Date.now()
): Map<string, { types: CatalystFact["type"][]; sources: CatalystFact["source"][] }> {
  const map = new Map<string, { types: CatalystFact["type"][]; sources: CatalystFact["source"][] }>();
  for (const fact of demoCatalystFacts(now)) {
    for (const symbol of fact.symbols) {
      const entry = map.get(symbol) ?? { types: [], sources: [] };
      if (!entry.types.includes(fact.type)) entry.types.push(fact.type);
      if (!entry.sources.includes(fact.source)) entry.sources.push(fact.source);
      map.set(symbol, entry);
    }
  }
  return map;
}

export function demoHasCatalyst(symbol: string, now = Date.now()): boolean {
  return demoCatalystLabels(now).has(symbol);
}

/**
 * Trạng thái sync mẫu: đủ 3 scope, không nguồn lỗi, vừa chạy 2 phút trước →
 * `catalystSyncInfo()` trả `synced` và card admin không báo STALE.
 */
export function demoCatalystSyncStatus(now = Date.now()): CatalystSyncStatus {
  const finishedAt = iso(now - 2 * 60_000);
  const startedAt = iso(now - 3 * 60_000);
  const source = (name: string, fetched: number, stored: number) => ({
    name,
    fetched,
    stored,
    skipped: 0,
    emptyStreak: 0,
  });

  return {
    version: 2,
    scopes: {
      announcements: {
        startedAt,
        finishedAt,
        scope: "announcements",
        sources: [
          source("binance.listing", 1, 1),
          source("binance.delisting", 0, 0),
          source("binance.news", 0, 0),
        ],
        totals: { fetched: 1, stored: 1, failedSources: 0 },
        purged: 0,
      },
      news: {
        startedAt,
        finishedAt,
        scope: "news",
        sources: [
          source("rss.RSS_COINDESK", 1, 1),
          source("rss.RSS_THEBLOCK", 1, 1),
          source("rss.RSS_COINTELEGRAPH", 1, 1),
        ],
        totals: { fetched: 3, stored: 3, failedSources: 0 },
        purged: 0,
      },
      unlocks: {
        startedAt,
        finishedAt,
        scope: "unlocks",
        sources: [source("unlocks.event_risks", 2, 2)],
        totals: { fetched: 2, stored: 2, failedSources: 0 },
        purged: 0,
      },
    },
  };
}

/** Số fact còn hạn theo source cho card admin (demo, không đọc DB). */
export function demoLiveCatalystCounts(
  now = Date.now()
): Array<{ source: CatalystFact["source"]; live: number }> {
  const bySource = new Map<CatalystFact["source"], number>();
  for (const fact of demoCatalystFacts(now)) {
    bySource.set(fact.source, (bySource.get(fact.source) ?? 0) + 1);
  }
  return [...bySource.entries()].map(([source, live]) => ({ source, live }));
}
