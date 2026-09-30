// SQ-MOVERS: Top Movers collector
// Lấy 3 coin Top Gain + 3 coin Top Loss trên Binance Futures (ticker 24h),
// lọc thanh khoản, enrich volume ratio 7 ngày + funding rate.
//
// Nguồn: GET https://fapi.binance.com/fapi/v1/ticker/24hr (KHÔNG truyền
// symbol → trả toàn bộ market trong 1 request). Public, không cần API key.

import axios from "axios";
import {
  fetchBinanceFuturesKlines,
  fetchBinanceFundingRate,
} from "@/lib/collectors/binance";

const FUTURES_24HR_URL = "https://fapi.binance.com/fapi/v1/ticker/24hr";

/** Ngưỡng thanh khoản tối thiểu (USD/24h) — loại coin sổ lệnh mỏng. */
export const MIN_QUOTE_VOLUME_USD = 5_000_000;

/** Số coin mỗi nhóm (Top Gain / Top Loss). */
export const MOVERS_PER_SIDE = 3;

/** Symbol perpetual USDT chuẩn (bỏ quarterly: BTCUSDT_240927, bỏ USDC/BUSD pair). */
const PERPETUAL_USDT_RE = /^[A-Z0-9]+USDT$/;

export interface RawFuturesTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  count?: number;
}

/** Một coin mover đã enrich đủ dữ liệu cho content generation. */
export interface MoverCoin {
  symbol: string;
  price: number;
  changePct: number;
  quoteVolume: number;
  /** Volume 24h / volume TB 7 ngày (null nếu không lấy được klines). */
  volumeRatio: number | null;
  /** Funding rate hiện tại, thập phân (0.0001 = 0.01%/8h). Null nếu không lấy được. */
  fundingRate: number | null;
}

export interface MoversSnapshot {
  gainers: MoverCoin[];
  losers: MoverCoin[];
  collectedAt: string;
  /** Tổng số symbol futures hợp lệ sau lọc — dùng cho context "thị trường". */
  marketCount: number;
}

/**
 * Lọc + xếp hạng danh sách ticker raw thành movers.
 * Pure function — test được không cần network.
 */
export function rankMovers(
  tickers: RawFuturesTicker[],
  perSide: number = MOVERS_PER_SIDE
): { gainers: RawFuturesTicker[]; losers: RawFuturesTicker[]; marketCount: number } {
  const eligible = tickers.filter(
    (t) =>
      PERPETUAL_USDT_RE.test(t.symbol) &&
      Number(t.quoteVolume) >= MIN_QUOTE_VOLUME_USD &&
      Number.isFinite(Number(t.lastPrice)) &&
      Number(t.lastPrice) > 0 &&
      Number.isFinite(Number(t.priceChangePercent))
  );

  const marketCount = eligible.length;

  // Tie-break: volume giảm dần — coin đắt đỏ hơn đáng tin hơn cùng %change.
  const byChangeDesc = [...eligible].sort(
    (a, b) =>
      Number(b.priceChangePercent) - Number(a.priceChangePercent) ||
      Number(b.quoteVolume) - Number(a.quoteVolume)
  );
  const byChangeAsc = [...eligible].sort(
    (a, b) =>
      Number(a.priceChangePercent) - Number(b.priceChangePercent) ||
      Number(b.quoteVolume) - Number(a.quoteVolume)
  );

  return {
    gainers: byChangeDesc.slice(0, perSide),
    losers: byChangeAsc.slice(0, perSide),
    marketCount,
  };
}

function toMoverCoin(t: RawFuturesTicker): MoverCoin {
  return {
    symbol: t.symbol.replace(/USDT$/, ""),
    price: Number(t.lastPrice),
    changePct: Number(t.priceChangePercent),
    quoteVolume: Number(t.quoteVolume),
    volumeRatio: null,
    fundingRate: null,
  };
}

/**
 * Enrich 1 mover: volume ratio 7 ngày (klines 1d) + funding rate hiện tại.
 * Mọi enrichment đều null-safe — lỗi nguồn không được làm hỏng cycle.
 */
export async function enrichMover(coin: MoverCoin): Promise<MoverCoin> {
  const futuresSymbol = `${coin.symbol}USDT`;

  // Cả 2 hàm đều null-safe (lỗi → [] / null), không throw — nhưng vẫn catch
  // để chống lỗi bất ngờ từ map/format.
  const [klines, funding] = await Promise.all([
    fetchBinanceFuturesKlines(futuresSymbol, 8).catch(() => []),
    fetchBinanceFundingRate(futuresSymbol).catch(() => null),
  ]);

  let volumeRatio: number | null = null;
  if (Array.isArray(klines) && klines.length >= 7) {
    // Kline cuối là nến hôm nay (chưa đóng) — so sánh với TB 7 nến trước.
    const closed = klines.slice(0, -1).slice(-7);
    const vols = closed.map((k) => Number(k.quoteVolume ?? 0));
    const avg = vols.reduce((s, v) => s + v, 0) / vols.length;
    const today = Number(klines[klines.length - 1].quoteVolume ?? 0);
    if (avg > 0 && Number.isFinite(today)) {
      volumeRatio = today / avg;
    }
  }

  // lastFundingRate là số thập phân (0.0001 = 0.01%/8h) — giữ nguyên đơn vị.
  const fundingRate = typeof funding === "number" && Number.isFinite(funding) ? funding : null;

  return { ...coin, volumeRatio, fundingRate };
}

/**
 * Lấy snapshot movers hoàn chỉnh: rank + enrich + validate đủ ≥1 coin/bên.
 * Trả null khi nguồn lỗi hoặc không đủ dữ liệu tối thiểu (cycle bị hủy).
 */
export async function fetchMoversSnapshot(): Promise<MoversSnapshot | null> {
  let tickers: RawFuturesTicker[] | null = null;
  try {
    const response = await axios.get(FUTURES_24HR_URL, { timeout: 15_000 });
    if (Array.isArray(response.data)) {
      tickers = response.data as RawFuturesTicker[];
    }
  } catch (error) {
    console.error(
      "[SQ-MOVERS] Futures 24hr ticker fetch failed:",
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }

  if (!tickers || tickers.length === 0) {
    return null;
  }

  const { gainers, losers, marketCount } = rankMovers(tickers);

  // Cần tối thiểu 1 coin mỗi bên — nếu không bài recap không có ý nghĩa.
  if (gainers.length === 0 || losers.length === 0) {
    console.warn("[SQ-MOVERS] Not enough eligible movers after filtering.");
    return null;
  }

  const [gainerCoins, loserCoins] = await Promise.all([
    Promise.all(gainers.map(toMoverCoin).map(enrichMover)),
    Promise.all(losers.map(toMoverCoin).map(enrichMover)),
  ]);

  return {
    gainers: gainerCoins,
    losers: loserCoins,
    collectedAt: new Date().toISOString(),
    marketCount,
  };
}
