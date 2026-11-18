// RADAR-06 — nguồn Binance announcement (listing/delisting/futures launch).
// Endpoint nội bộ không chính thức, đã probe 200 ngày 2026-11-18:
//   GET /bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=48&pageNo=1&pageSize=20
// Schema: { code: "000000", data: { catalogs: [{ articles: [{ id, code, title, releaseDate }] }] } }
// Không có rate limit công bố → cache 5 phút/catalog, gọi tuần tự.

import {
  binanceArticleUrl,
  classifyBinanceAnnouncement,
  extractTickers,
} from "./normalize";
import type { CatalystFact } from "./types";

export const BINANCE_CATALOGS = {
  listing: 48,
  delisting: 161,
  news: 49,
} as const;

export type BinanceCatalogKey = keyof typeof BINANCE_CATALOGS;

const API = "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query";
const UA = "Mozilla/5.0 (compatible; NarrativeHealth/1.0; +https://coins.run.place)";
const CACHE_MS = 5 * 60_000;

interface BinanceArticle {
  id?: number;
  code?: string;
  title?: string;
  releaseDate?: number;
}

interface BinancePayload {
  code?: string;
  data?: { catalogs?: Array<{ catalogId?: number; articles?: BinanceArticle[] }> } | null;
}

const cache = new Map<number, { expires: number; facts: CatalystFact[] }>();

/** Pure: parse payload thành facts. Test dùng fixture thật. */
export function parseBinanceAnnouncementPayload(
  payload: unknown,
  catalogId: number
): CatalystFact[] {
  const body = payload as BinancePayload | null;
  if (!body || body.code !== "000000" || !body.data?.catalogs) return [];

  const facts: CatalystFact[] = [];
  for (const catalog of body.data.catalogs) {
    for (const article of catalog.articles ?? []) {
      if (!article.code || !article.title || !article.releaseDate) continue;
      const published = new Date(article.releaseDate);
      if (!Number.isFinite(published.getTime())) continue;
      facts.push({
        type: classifyBinanceAnnouncement(catalogId, article.title),
        source: "BINANCE_ANNOUNCEMENT",
        externalId: `binance:${article.code}`,
        title: article.title.slice(0, 300),
        sourceUrl: binanceArticleUrl(article.code),
        symbols: extractTickers(article.title),
        publishedAt: published.toISOString(),
        eventDate: null,
        facts: {
          catalogId,
          catalog: catalogId === BINANCE_CATALOGS.delisting ? "delisting" : "listing",
        },
        raw: article,
      });
    }
  }
  return facts;
}

/**
 * Fetch một catalog. Không nuốt lỗi: caller (sync) ghi lỗi theo từng nguồn
 * để panel biết “nguồn X không cập nhật”.
 */
export async function fetchBinanceCatalog(
  catalogId: number,
  pageSize = 20
): Promise<CatalystFact[]> {
  const cached = cache.get(catalogId);
  if (cached && cached.expires > Date.now()) return cached.facts;

  const url = `${API}?type=1&catalogId=${catalogId}&pageNo=1&pageSize=${pageSize}`;
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Binance announcement HTTP ${response.status} (catalog ${catalogId})`);
  }
  const payload = (await response.json()) as unknown;
  const facts = parseBinanceAnnouncementPayload(payload, catalogId);
  if (facts.length === 0) {
    throw new Error(`Binance announcement catalog ${catalogId}: payload rỗng/không hợp lệ`);
  }
  cache.set(catalogId, { expires: Date.now() + CACHE_MS, facts });
  return facts;
}

export function _resetBinanceAnnouncementCache(): void {
  cache.clear();
}
