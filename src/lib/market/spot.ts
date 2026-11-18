// RADAR-SPOT: so spot vs perp để biết move do spot dẫn hay perp squeeze.
// Dùng data-api.binance.vision (spot public) vì endpoint này vẫn truy cập được
// ở một số môi trường bị chặn fapi.

import axios from "axios";

const SPOT_24H_URL = "https://data-api.binance.vision/api/v3/ticker/24hr";

export interface SpotTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}

let cache: { value: Map<string, SpotTicker>; expires: number } = { value: new Map(), expires: 0 };
let inflight: Promise<Map<string, SpotTicker>> | null = null;

export async function fetchSpotTickers(): Promise<Map<string, SpotTicker>> {
  if (cache.expires > Date.now() && cache.value.size > 0) return cache.value;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const response = await axios.get(SPOT_24H_URL, { timeout: 12_000 });
      const list = Array.isArray(response.data) ? (response.data as SpotTicker[]) : [];
      const map = new Map(list.map((t) => [t.symbol, t]));
      cache = { value: map, expires: Date.now() + 60_000 };
      return map;
    } catch (error) {
      console.warn(
        "[RADAR-SPOT] Không lấy được spot ticker:",
        error instanceof Error ? error.message : String(error)
      );
      cache = { value: new Map(), expires: Date.now() + 60_000 };
      return cache.value;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export interface SpotLeadership {
  spotChangePct: number;
  spotVolume24h: number;
  basisPct: number;
  spotLed: boolean | null;
}

/**
 * Spot dẫn khi spot di chuyển cùng chiều và biên độ không nhỏ hơn perp.
 * Spot không có pair tương ứng → null (không kết luận).
 */
export function computeSpotLeadership(
  perpChangePct: number,
  perpPrice: number,
  spot: { lastPrice: string; priceChangePercent: string; quoteVolume: string } | undefined
): SpotLeadership | null {
  if (!spot) return null;
  const spotPrice = Number(spot.lastPrice);
  const spotChangePct = Number(spot.priceChangePercent);
  const spotVolume24h = Number(spot.quoteVolume);
  if (!Number.isFinite(spotPrice) || spotPrice <= 0 || !Number.isFinite(spotChangePct)) return null;

  const sameDirection = Math.sign(perpChangePct) === Math.sign(spotChangePct) && perpChangePct !== 0;
  return {
    spotChangePct,
    spotVolume24h: Number.isFinite(spotVolume24h) ? spotVolume24h : 0,
    basisPct: ((perpPrice - spotPrice) / spotPrice) * 100,
    spotLed: sameDirection ? Math.abs(spotChangePct) >= Math.abs(perpChangePct) : false,
  };
}
