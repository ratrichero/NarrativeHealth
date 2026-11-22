// MARKET-CAP-01 — chỉ ghi vốn hoá khi thật sự suy ra được.
//
// Bug cũ: khi CoinGecko không có dữ liệu, `/api/refresh/coin/[id]` ghi
// `volume24h × price` vào `coin_metrics.market_cap`. Đó là giá trị giao dịch 24h,
// không phải vốn hoá, và nó chảy thẳng vào health score (feature engine nhận
// `marketCap`). Hai nguồn hợp lệ duy nhất:
//   1. market cap CoinGecko trả về (chuẩn);
//   2. price × circulating supply (ước tính, chỉ khi biết circulating supply).
// Không biết supply → null: thà thiếu số còn hơn ghi số sai.

export type MarketCapSource = "coingecko" | "price_x_circulating_supply";

export interface ResolvedMarketCap {
  value: number;
  /** true khi phải suy ra từ price × supply thay vì CoinGecko. */
  estimated: boolean;
  source: MarketCapSource;
}

export interface MarketCapInputs {
  /** Market cap CoinGecko trả về (USD). */
  coingeckoMarketCap?: number | null;
  /** Circulating supply CoinGecko trả về (số coin lưu hành). */
  circulatingSupply?: number | null;
  /** Giá mới nhất (USD). */
  price?: number | null;
}

const isPositive = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * Trả về market cap đúng nguồn, hoặc null khi không có cách tính hợp lệ.
 * Không bao giờ dùng volume — volume 24h không phải vốn hoá.
 */
export function resolveMarketCap(input: MarketCapInputs): ResolvedMarketCap | null {
  if (isPositive(input.coingeckoMarketCap)) {
    return { value: input.coingeckoMarketCap, estimated: false, source: "coingecko" };
  }
  if (isPositive(input.price) && isPositive(input.circulatingSupply)) {
    return {
      value: input.price * input.circulatingSupply,
      estimated: true,
      source: "price_x_circulating_supply",
    };
  }
  return null;
}
