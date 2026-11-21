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

// ─── UNIVERSE-01: crypto-only picks ──────────────────────────────────────
//
// `coins` also contains tokenized equity tickers (AAPL, AMZN, ASML, MSTR,
// NVDA, SPCX) under the "STOCKs" narrative. They carry Binance-style perp
// pairs and health scores like every coin, so the top-pick pipeline used to
// select them and the public track record reported them as crypto trades — a
// performance claim mixing asset classes.
//
// The exclusion lives here, next to the rest of the universe rules, and is
// applied by BOTH pick generation and the public track record. It is defined
// by narrative (the business classification) because a coin is non-crypto if
// ANY of its narratives is a reserved non-crypto one, regardless of which
// narrative is "primary".

import { sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";

/** Narrative names reserved for non-crypto (tokenized equity) instruments. */
export const NON_CRYPTO_NARRATIVES = ["STOCKs"] as const;

/** True when a narrative name marks an instrument outside the crypto universe. */
export function isNonCryptoNarrative(name: string | null | undefined): boolean {
  if (name == null) return false;
  const normalized = name.trim().toLowerCase();
  if (normalized === "") return false;
  return NON_CRYPTO_NARRATIVES.some((n) => n.toLowerCase() === normalized);
}

/**
 * `EXISTS (...)` fragment matching coins that belong to a non-crypto
 * narrative. Use it negated in a WHERE clause:
 *   sql`NOT (${nonCryptoCoinExistsSql(coins.id)})`
 */
export function nonCryptoCoinExistsSql(coinId: AnyColumn | SQL): SQL {
  const names = sql.join(
    NON_CRYPTO_NARRATIVES.map((n) => sql`${n}`),
    sql`, `
  );
  return sql`EXISTS (
    SELECT 1 FROM coin_narratives cn
    JOIN narratives n ON n.id = cn.narrative_id
    WHERE cn.coin_id = ${coinId} AND n.name IN (${names})
  )`;
}
