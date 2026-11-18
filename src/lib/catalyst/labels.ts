// RADAR-06 — nhãn hiển thị thuần (không DB, không LLM).
// Tách khỏi `summarize.ts` để client component (CatalystPanel) import được mà
// không kéo `pg`/provider vào browser bundle.

import type { CatalystFact } from "./types";

const TYPE_LABEL: Record<CatalystFact["type"], string> = {
  LISTING: "Binance listing",
  DELISTING: "Binance delisting",
  FUTURES_LAUNCH: "Binance futures launch",
  MONITORING_TAG: "Binance monitoring tag",
  UNLOCK: "Token unlock",
  NEWS: "Tin tức",
};

const SOURCE_LABEL: Record<CatalystFact["source"], string> = {
  BINANCE_ANNOUNCEMENT: "Binance Announcement",
  RSS_COINDESK: "CoinDesk",
  RSS_COINTELEGRAPH: "Cointelegraph",
  RSS_DECRYPT: "Decrypt",
  RSS_THEBLOCK: "The Block",
  EVENT_RISKS_UNLOCK: "Unlock calendar (event_risks)",
};

export function catalystSourceLabel(source: CatalystFact["source"]): string {
  return SOURCE_LABEL[source] ?? source;
}

export function catalystTypeLabel(type: CatalystFact["type"]): string {
  return TYPE_LABEL[type] ?? type;
}

// Tên nguồn trong trạng thái sync (`binance.listing`, `rss.RSS_COINDESK`, …) → nhãn
// cho panel. Panel liệt kê đúng nguồn đã chạy được, không hardcode 3 nhóm.
const SYNC_SOURCE_LABEL: Record<string, string> = {
  "binance.listing": "Binance listing announcement",
  "binance.delisting": "Binance delisting announcement",
  "binance.news": "Binance news announcement",
  "rss.RSS_COINDESK": "CoinDesk RSS",
  "rss.RSS_COINTELEGRAPH": "Cointelegraph RSS",
  "rss.RSS_DECRYPT": "Decrypt RSS",
  "rss.RSS_THEBLOCK": "The Block RSS",
  "unlocks.event_risks": "Unlock calendar (event_risks)",
};

export function catalystSyncSourceLabel(name: string): string {
  return SYNC_SOURCE_LABEL[name] ?? name;
}
