// RADAR-06 — chuẩn hoá ticker/thời gian từ tiêu đề nguồn.
// Pure, test được. Best-effort: sai sót được bù bằng cách matching kiểm tra cả tiêu đề.

import type { CatalystType } from "./types";

/**
 * Token không phải ticker dù viết hoa. Giữ danh sách ngắn nhưng phủ các mẫu tiêu đề
 * Binance/RSS thường gặp để tránh gắn catalyst sai coin.
 */
const STOPWORDS = new Set([
  "USD", "USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI", "USDP", "EUR", "GBP", "BRL",
  "UAH", "TRY", "RUB", "JPY", "AUD", "ARS", "ZAR", "IDR", "PHP", "VND", "KRW", "INR",
  "THE", "AND", "FOR", "WILL", "WITH", "FROM", "THIS", "THAT", "NEW", "ADD", "ADDS",
  "ADDING", "LIST", "LISTS", "DELIST", "DELISTS", "LAUNCH", "LAUNCHES", "REMOVAL",
  "NOTICE", "TRADING", "PAIR", "PAIRS", "SPOT", "MARGIN", "FUTURES", "PERPETUAL",
  "CONTRACTS", "CONTRACT", "ALPHA", "MULTIPLE", "ASSET", "ASSETS", "COLLATERAL",
  "LOANS", "DEPOSITS", "WITHDRAWALS", "CONVERT", "API", "BOT", "CEO", "ETF", "ETFS",
  "NFT", "NFTS", "DEFI", "DAO", "TVL", "ATH", "IPO", "SEC", "FED", "CPI", "GDP",
  "BTC", "ETH", "BNB", // majors vẫn là ticker thật; bỏ khỏi stoplist? xem dưới
]);

// BTC/ETH/BNB là ticker hợp lệ — không chặn.
for (const major of ["BTC", "ETH", "BNB"]) STOPWORDS.delete(major);

const TICKER_RE = /\$?([A-Z0-9]{2,12})\b/g;

/** Tách ticker ứng viên từ tiêu đề (uppercase token hoặc cashtag). */
export function extractTickers(title: string): string[] {
  const out = new Set<string>();
  const text = title ?? "";
  for (const match of text.matchAll(TICKER_RE)) {
    const token = match[1];
    if (!token || !/^[A-Z]/.test(token)) continue;
    if (STOPWORDS.has(token)) continue;
    out.add(token);
    // Tiêu đề futures Binance dùng pair (HYPEUSDT) — thêm cả base để khớp radar symbol.
    const base = token.replace(/(USDT|USDC|BUSD|FDUSD)$/, "");
    if (base !== token && base.length >= 2 && !STOPWORDS.has(base)) out.add(base);
  }
  return [...out];
}

/** Kiểm tra tiêu đề có nhắc đúng ticker (word boundary, không khớp một phần). */
export function titleMentionsSymbol(title: string, symbol: string): boolean {
  const sym = symbol.toUpperCase();
  if (!sym) return false;
  const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`).test(title.toUpperCase());
}

export function classifyBinanceAnnouncement(catalogId: number, title: string): CatalystType {
  if (catalogId === 161) {
    return /monitoring/i.test(title) ? "MONITORING_TAG" : "DELISTING";
  }
  if (catalogId === 48) {
    return /futures/i.test(title) ? "FUTURES_LAUNCH" : "LISTING";
  }
  return "NEWS";
}

export function binanceArticleUrl(code: string): string {
  return `https://www.binance.com/en/support/announcement/${code}`;
}

/** Date -> YYYY-MM-DD (UTC). */
export function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}
