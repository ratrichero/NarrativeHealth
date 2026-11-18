// RADAR-UNIVERSE: lọc symbol Binance Futures đủ điều kiện.
// Pure — test được không cần network/DB.

export const MIN_LISTING_AGE_DAYS = 21;

const STABLE_BASES = new Set([
  "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "EUR", "AEUR", "USD1", "USDE", "XUSD",
]);
const LEVERAGED_RE = /(BULL|BEAR)$/;

export interface UniverseTicker {
  symbol: string;
  lastPrice: string;
  quoteVolume: string;
  priceChangePercent: string;
}

export interface UniverseMeta {
  status?: string;
  contractType?: string;
  baseAsset?: string;
  quoteAsset?: string;
  onboardDate?: number;
}

export function listingAgeDays(onboardDate: number | undefined): number | null {
  if (!onboardDate || !Number.isFinite(onboardDate)) return null;
  return Math.floor((Date.now() - onboardDate) / 86_400_000);
}

export function isEligibleTicker(
  ticker: UniverseTicker,
  meta: UniverseMeta | undefined,
  minVolume: number
): boolean {
  if (!/^[A-Z0-9]{2,15}USDT$/.test(ticker.symbol)) return false;
  if ((meta?.status ?? "TRADING") !== "TRADING") return false;
  if ((meta?.contractType ?? "PERPETUAL") !== "PERPETUAL") return false;
  if ((meta?.quoteAsset ?? "USDT") !== "USDT") return false;

  const base = (meta?.baseAsset ?? ticker.symbol.replace(/USDT$/, "")).toUpperCase();
  if (STABLE_BASES.has(base) || LEVERAGED_RE.test(base)) return false;

  const price = Number(ticker.lastPrice);
  const volume = Number(ticker.quoteVolume);
  const change = Number(ticker.priceChangePercent);
  if (!Number.isFinite(price) || price <= 0) return false;
  if (!Number.isFinite(volume) || volume < minVolume) return false;
  if (!Number.isFinite(change)) return false;

  const age = listingAgeDays(meta?.onboardDate);
  if (age !== null && age < MIN_LISTING_AGE_DAYS) return false;
  return true;
}
