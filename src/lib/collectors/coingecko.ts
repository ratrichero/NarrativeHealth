// CoinGecko data collector

import axios from "axios";

const COINGECKO_API = "https://api.coingecko.com/api/v3";

export interface CoinGeckoMetrics {
  marketCap: number | null;
  fullyDilutedValuation: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  currentPrice: number | null;
  priceChange24h: number | null;
  volume24h: number | null;
}

export interface CoinGeckoMarketData {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  fully_diluted_valuation: number | null;
  circulating_supply: number;
  total_supply: number | null;
  price_change_percentage_24h: number;
  total_volume: number;
}

/**
 * Fetch coin data from CoinGecko
 */
export async function fetchCoinGeckoData(coinId: string): Promise<CoinGeckoMetrics> {
  try {
    const response = await axios.get(`${COINGECKO_API}/coins/${coinId}`, {
      params: {
        localization: false,
        tickers: false,
        market_data: true,
        community_data: false,
        developer_data: false,
        sparkline: false,
      },
      timeout: 15000,
    });

    const marketData = response.data.market_data;

    return {
      marketCap: marketData?.market_cap?.usd || null,
      fullyDilutedValuation: marketData?.fully_diluted_valuation?.usd || null,
      circulatingSupply: marketData?.circulating_supply || null,
      totalSupply: marketData?.total_supply || null,
      currentPrice: marketData?.current_price?.usd || null,
      priceChange24h: marketData?.price_change_percentage_24h || null,
      volume24h: marketData?.total_volume?.usd || null,
    };
  } catch (error) {
    console.error(`Error fetching CoinGecko data for ${coinId}:`, error);
    return {
      marketCap: null,
      fullyDilutedValuation: null,
      circulatingSupply: null,
      totalSupply: null,
      currentPrice: null,
      priceChange24h: null,
      volume24h: null,
    };
  }
}

/**
 * Fetch multiple coins data from CoinGecko markets endpoint
 */
export async function fetchCoinGeckoMarkets(
  coinIds: string[]
): Promise<Map<string, CoinGeckoMetrics>> {
  const result = new Map<string, CoinGeckoMetrics>();

  if (coinIds.length === 0) return result;

  try {
    const response = await axios.get<CoinGeckoMarketData[]>(`${COINGECKO_API}/coins/markets`, {
      params: {
        vs_currency: "usd",
        ids: coinIds.join(","),
        order: "market_cap_desc",
        per_page: 250,
        page: 1,
        sparkline: false,
        price_change_percentage: "24h",
      },
      timeout: 15000,
    });

    for (const coin of response.data) {
      result.set(coin.id, {
        marketCap: coin.market_cap,
        fullyDilutedValuation: coin.fully_diluted_valuation,
        circulatingSupply: coin.circulating_supply,
        totalSupply: coin.total_supply,
        currentPrice: coin.current_price,
        priceChange24h: coin.price_change_percentage_24h,
        volume24h: coin.total_volume,
      });
    }

    return result;
  } catch (error) {
    console.error("CoinGecko API error:", error);
    return result;
  }
}

/**
 * Search for a coin on CoinGecko by symbol
 */
export async function searchCoinGecko(query: string): Promise<{ id: string; symbol: string; name: string }[]> {
  try {
    const response = await axios.get(`${COINGECKO_API}/search`, {
      params: { query },
      timeout: 10000,
    });

    return response.data.coins.slice(0, 10).map((coin: { id: string; symbol: string; name: string }) => ({
      id: coin.id,
      symbol: coin.symbol,
      name: coin.name,
    }));
  } catch (error) {
    console.error("Error searching CoinGecko:", error);
    return [];
  }
}

/**
 * Check if CoinGecko API is accessible
 */
export async function checkCoinGeckoHealth(): Promise<boolean> {
  try {
    const response = await axios.get(`${COINGECKO_API}/ping`, { timeout: 5000 });
    return response.data.gecko_says === "(V3) To the Moon!";
  } catch {
    return false;
  }
}
