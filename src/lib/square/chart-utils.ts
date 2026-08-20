// Square Chart Integration Utilities
// Coin symbol normalization and chart validation for Binance Square posts

// ─── Symbol Normalization ──────────────────────────────

/**
 * Normalize a coin symbol to Binance Square canonical format.
 *
 * Input formats accepted:
 *   BTC, $BTC, btc, BTCUSDT, BTCUSDT, BTC/USDT, BTC_USDT
 *
 * Output: always uppercase ticker without quote suffix (e.g., "BTC")
 *
 * This normalization is deterministic — same input always produces same output.
 * It does NOT produce a trading pair symbol; it produces the cashtag base.
 */
export function normalizeCoinSymbol(input: string): string {
  if (!input || typeof input !== "string") return "";

  let s = input.trim().toUpperCase();

  // Remove leading $
  if (s.startsWith("$")) {
    s = s.slice(1);
  }

  // Remove common quote suffixes
  const quoteSuffixes = ["USDT", "USDC", "BUSD", "USD", "PERP"];
  for (const suffix of quoteSuffixes) {
    if (s.endsWith(suffix) && s.length > suffix.length) {
      s = s.slice(0, -suffix.length);
      break;
    }
  }

  // Remove separators
  s = s.replace(/[\/_\-]/g, "");

  // Validate: must be 2-10 uppercase letters only
  if (!/^[A-Z]{2,10}$/.test(s)) {
    return "";
  }

  return s;
}

/**
 * Validate that a coin symbol is a valid Binance Square cashtag.
 *
 * Returns the normalized symbol if valid, or null if invalid.
 * A valid cashtag must:
 *   - Be a recognized ticker (2-10 uppercase letters)
 *   - Not be a common non-crypto word that might be mistaken
 */
export function validateChartSymbol(input: string): string | null {
  const normalized = normalizeCoinSymbol(input);
  if (!normalized) return null;

  // Additional validation: reject obviously non-crypto symbols
  const invalidSymbols = new Set([
    "THE", "AND", "FOR", "ARE", "BUT", "NOT", "ALL", "CAN",
    "HER", "WAS", "ONE", "OUR", "OUT", "HAS", "HIS", "HOW",
    "ITS", "MAY", "NEW", "NOW", "OLD", "SEE", "WAY", "WHO",
    "DID", "GET", "LET", "SAY", "SHE", "TOO", "USE", "FET",
  ]);

  // FET is actually a crypto token (Fetch.ai), so we don't block it
  if (invalidSymbols.has(normalized) && normalized !== "FET") {
    return null;
  }

  return normalized;
}

// ─── Chart Coin Resolution ─────────────────────────────

export interface ChartCoinResult {
  /** Normalized primary coin symbol for chart widget */
  primarySymbol: string | null;
  /** All valid cashtags in the post */
  allCashtags: string[];
  /** Whether the chart coin was explicitly specified vs auto-detected */
  wasExplicit: boolean;
}

/**
 * Resolve the chart coin for a Square post.
 *
 * Priority:
 *   1. Explicitly specified chartCoin (normalized)
 *   2. First valid cashtag from content
 *   3. null (no chart widget)
 */
export function resolveChartCoin(
  explicitChartCoin: string | undefined | null,
  cashtags: string[]
): ChartCoinResult {
  // Try explicit chart coin first
  if (explicitChartCoin) {
    const validated = validateChartSymbol(explicitChartCoin);
    if (validated) {
      return {
        primarySymbol: validated,
        allCashtags: cashtags
          .map((c) => validateChartSymbol(c))
          .filter((c): c is string => c !== null),
        wasExplicit: true,
      };
    }
  }

  // Fall back to first valid cashtag
  for (const tag of cashtags) {
    const validated = validateChartSymbol(tag);
    if (validated) {
      return {
        primarySymbol: validated,
        allCashtags: cashtags
          .map((c) => validateChartSymbol(c))
          .filter((c): c is string => c !== null),
        wasExplicit: false,
      };
    }
  }

  return {
    primarySymbol: null,
    allCashtags: [],
    wasExplicit: false,
  };
}

// ─── Chart Widget Metadata ─────────────────────────────

/**
 * Generate chart widget metadata for a Square post.
 *
 * Binance Square automatically renders a candle chart widget
 * when it detects cashtags (e.g., $BTC) in post content.
 * No explicit API parameter is needed — the chart is platform-rendered.
 *
 * This function generates metadata for:
 *   - Publication record tracking
 *   - Content validation (ensuring chart coin matches analyzed coin)
 *   - Audit trail
 */
export function generateChartMetadata(
  chartCoin: ChartCoinResult,
  sourceSymbol: string | undefined | null
): {
  chartEnabled: boolean;
  chartSymbol: string | null;
  chartMatchesSource: boolean;
  cashtagCount: number;
} {
  const normalizedSource = sourceSymbol
    ? normalizeCoinSymbol(sourceSymbol)
    : null;

  return {
    chartEnabled: chartCoin.primarySymbol !== null,
    chartSymbol: chartCoin.primarySymbol,
    chartMatchesSource:
      chartCoin.primarySymbol !== null &&
      normalizedSource !== null &&
      chartCoin.primarySymbol === normalizedSource,
    cashtagCount: chartCoin.allCashtags.length,
  };
}
