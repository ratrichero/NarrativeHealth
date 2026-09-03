// Binance data collector - Spot and Futures

import axios from "axios";

const BINANCE_SPOT_API = "https://api.binance.com/api/v3";
const BINANCE_FUTURES_API = "https://fapi.binance.com/fapi/v1";
const BINANCE_FUTURES_DATA_API = "https://fapi.binance.com/futures/data";

export interface KlineData {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteVolume: string;
}

export type BinanceInterval = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "6h" | "8h" | "12h" | "1d" | "3d" | "1w" | "1M";

export interface FuturesMetrics {
  openInterest: number | null;
  fundingRate: number | null;
}

export interface LongShortRatio {
  longAccount: number | null;
  shortAccount: number | null;
  longShortRatio: number | null;
}

/**
 * Fetch klines from Binance Spot with custom interval
 */
export async function fetchBinanceSpotKlines(
  symbol: string,
  limit: number = 200,
  interval: BinanceInterval = "1d"
): Promise<KlineData[]> {
  try {
    const response = await axios.get(`${BINANCE_SPOT_API}/klines`, {
      params: {
        symbol,
        interval,
        limit,
      },
      timeout: 10000,
    });

    return response.data.map((k: (string | number)[]) => ({
      openTime: k[0] as number,
      open: k[1] as string,
      high: k[2] as string,
      low: k[3] as string,
      close: k[4] as string,
      volume: k[5] as string,
      closeTime: k[6] as number,
      quoteVolume: k[7] as string,
    }));
  } catch (error: any) {
    const status = error.response?.status;
    if (status === 451) {
      console.error(`[BINANCE-451] Spot klines ${symbol}: geo-blocked (HTTP 451)`);
    } else {
      console.error(`Binance API error for ${symbol}: [HTTP ${status || 'N/A'}] ${error.message}`);
    }
    return [];
  }
}

/**
 * Fetch klines from Binance Futures with custom interval
 */
export async function fetchBinanceFuturesKlines(
  symbol: string,
  limit: number = 200,
  interval: BinanceInterval = "1d"
): Promise<KlineData[]> {
  try {
    const response = await axios.get(`${BINANCE_FUTURES_API}/klines`, {
      params: {
        symbol,
        interval,
        limit,
      },
      timeout: 10000,
    });

    return response.data.map((k: (string | number)[]) => ({
      openTime: k[0] as number,
      open: k[1] as string,
      high: k[2] as string,
      low: k[3] as string,
      close: k[4] as string,
      volume: k[5] as string,
      closeTime: k[6] as number,
      quoteVolume: k[7] as string,
    }));
  } catch (error: any) {
    const status = error.response?.status;
    if (status === 451) {
      console.error(`[BINANCE-451] Futures klines ${symbol}: geo-blocked (HTTP 451)`);
    } else {
      console.error(`Binance Futures API error for ${symbol}: [HTTP ${status || 'N/A'}] ${error.message}`);
    }
    return [];
  }
}

/**
 * Fetch Open Interest from Binance Futures
 */
export async function fetchBinanceFuturesOI(symbol: string): Promise<number | null> {
  try {
    const response = await axios.get(`${BINANCE_FUTURES_API}/openInterest`, {
      params: { symbol },
      timeout: 10000,
    });

    return parseFloat(response.data.openInterest);
  } catch (error: any) {
    const status = error.response?.status;
    const msg = error.response?.data?.msg || error.message;
    if (status === 451) {
      console.error(`[BINANCE-451] Futures OI ${symbol}: geo-blocked (HTTP 451). Binance terms restrict this region.`);
    } else {
      console.error(`Binance futures OI error for ${symbol}: [HTTP ${status || 'N/A'}] ${msg}`);
    }
    return null;
  }
}

/**
 * Fetch Funding Rate from Binance Futures
 */
export async function fetchBinanceFundingRate(symbol: string): Promise<number | null> {
  try {
    const response = await axios.get(`${BINANCE_FUTURES_API}/premiumIndex`, {
      params: { symbol },
      timeout: 10000,
    });

    return parseFloat(response.data.lastFundingRate);
  } catch (error: any) {
    const status = error.response?.status;
    const msg = error.response?.data?.msg || error.message;
    if (status === 451) {
      console.error(`[BINANCE-451] Funding rate ${symbol}: geo-blocked (HTTP 451). Binance terms restrict this region.`);
    } else {
      console.error(`Binance funding rate error for ${symbol}: [HTTP ${status || 'N/A'}] ${msg}`);
    }
    return null;
  }
}

/**
 * Fetch both OI and Funding Rate
 */
export async function fetchBinanceFuturesMetrics(symbol: string): Promise<FuturesMetrics> {
  const [openInterest, fundingRate] = await Promise.all([
    fetchBinanceFuturesOI(symbol),
    fetchBinanceFundingRate(symbol),
  ]);

  return { openInterest, fundingRate };
}

/**
 * Fetch historical Open Interest
 */
export async function fetchBinanceOIHistory(
  symbol: string,
  period: "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "6h" | "12h" | "1d" = "1d",
  limit: number = 2
): Promise<{ timestamp: number; openInterest: number }[]> {
  try {
    const response = await axios.get(`${BINANCE_FUTURES_DATA_API}/openInterestHist`, {
      params: {
        symbol,
        period,
        limit,
      },
      timeout: 10000,
    });

    return response.data.map((item: { timestamp: number; sumOpenInterest: string }) => ({
      timestamp: item.timestamp,
      openInterest: parseFloat(item.sumOpenInterest),
    }));
  } catch (error: any) {
    const status = error.response?.status;
    const msg = error.response?.data?.msg || error.message;
    if (status === 451) {
      console.error(`[BINANCE-451] OI history ${symbol}: geo-blocked (HTTP 451). Binance terms restrict this region.`);
    } else {
      console.error(`Binance OI history error for ${symbol}: [HTTP ${status || 'N/A'}] ${msg}`);
    }
    return [];
  }
}

/**
 * Fetch Global Long/Short Account Ratio from Binance Futures
 */
export async function fetchBinanceGlobalLongShortRatio(
  symbol: string,
  period: "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "6h" | "12h" | "1d" = "5m",
  limit: number = 1
): Promise<LongShortRatio> {
  try {
    const response = await axios.get(`${BINANCE_FUTURES_DATA_API}/globalLongShortAccountRatio`, {
      params: { symbol, period, limit },
      timeout: 10000,
    });

    if (response.data && response.data.length > 0) {
      const item = response.data[0];
      return {
        longAccount: parseFloat(item.longAccount),
        shortAccount: parseFloat(item.shortAccount),
        longShortRatio: parseFloat(item.longShortRatio),
      };
    }
    return { longAccount: null, shortAccount: null, longShortRatio: null };
  } catch (error) {
    console.error(`Binance global long/short ratio error for ${symbol}:`, error);
    return { longAccount: null, shortAccount: null, longShortRatio: null };
  }
}

/**
 * Fetch Top Trader Long/Short Account Ratio from Binance Futures
 */
export async function fetchBinanceTopLongShortRatio(
  symbol: string,
  period: "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "6h" | "12h" | "1d" = "5m",
  limit: number = 1
): Promise<LongShortRatio> {
  try {
    const response = await axios.get(`${BINANCE_FUTURES_DATA_API}/topLongShortAccountRatio`, {
      params: { symbol, period, limit },
      timeout: 10000,
    });

    if (response.data && response.data.length > 0) {
      const item = response.data[0];
      return {
        longAccount: parseFloat(item.longAccount),
        shortAccount: parseFloat(item.shortAccount),
        longShortRatio: parseFloat(item.longShortRatio),
      };
    }
    return { longAccount: null, shortAccount: null, longShortRatio: null };
  } catch (error) {
    console.error(`Binance top trader long/short ratio error for ${symbol}:`, error);
    return { longAccount: null, shortAccount: null, longShortRatio: null };
  }
}

/**
 * Get current price from Binance
 */
export async function fetchBinanceCurrentPrice(symbol: string): Promise<number | null> {
  try {
    const response = await axios.get(`${BINANCE_SPOT_API}/ticker/price`, {
      params: { symbol },
      timeout: 10000,
    });

    return parseFloat(response.data.price);
  } catch (error) {
    console.error(`Error fetching Binance price for ${symbol}:`, error);
    return null;
  }
}

/**
 * Get current price from Binance Futures
 */
export async function fetchBinanceFuturesCurrentPrice(symbol: string): Promise<number | null> {
  try {
    const response = await axios.get(`${BINANCE_FUTURES_API}/ticker/price`, {
      params: { symbol },
      timeout: 10000,
    });

    return parseFloat(response.data.price);
  } catch (error) {
    console.error(`Error fetching Binance Futures price for ${symbol}:`, error);
    return null;
  }
}

/**
 * Get 24h ticker data from Binance Spot
 */
export async function fetchBinanceSpotTicker(symbol: string): Promise<any | null> {
  try {
    const response = await axios.get(`${BINANCE_SPOT_API}/ticker/24hr`, {
      params: { symbol },
      timeout: 10000,
    });

    return response.data;
  } catch (error) {
    console.error(`Error fetching Binance Spot ticker for ${symbol}:`, error);
    return null;
  }
}

/**
 * Get 24h ticker data from Binance Futures
 */
export async function fetchBinanceFuturesTicker(symbol: string): Promise<any | null> {
  try {
    const response = await axios.get(`${BINANCE_FUTURES_API}/ticker/24hr`, {
      params: { symbol },
      timeout: 10000,
    });

    return response.data;
  } catch (error) {
    console.error(`Error fetching Binance Futures ticker for ${symbol}:`, error);
    return null;
  }
}

/**
 * Check if a symbol exists on Binance Spot
 */
export async function checkBinanceSpotSymbol(symbol: string): Promise<boolean> {
  try {
    const response = await axios.get(`${BINANCE_SPOT_API}/ticker/price`, {
      params: { symbol },
      timeout: 5000,
    });
    return !!response.data.price;
  } catch {
    return false;
  }
}

/**
 * Check if a symbol exists on Binance Futures
 */
export async function checkBinanceFuturesSymbol(symbol: string): Promise<boolean> {
  try {
    const response = await axios.get(`${BINANCE_FUTURES_API}/premiumIndex`, {
      params: { symbol },
      timeout: 5000,
    });
    return !!response.data.symbol;
  } catch {
    return false;
  }
}
