// MARKET-CAP-01 — hồi quy cho fallback `volume24h × price` bị ghi thành market cap.
import { resolveMarketCap } from "@/lib/market/market-cap";

describe("resolveMarketCap", () => {
  it("dùng market cap CoinGecko khi có (không ước tính)", () => {
    const result = resolveMarketCap({
      coingeckoMarketCap: 2_600_000,
      circulatingSupply: 100_000_000,
      price: 0.02,
    });
    expect(result).toEqual({
      value: 2_600_000,
      estimated: false,
      source: "coingecko",
    });
  });

  it("ước tính price × circulating supply khi CoinGecko thiếu market cap", () => {
    const result = resolveMarketCap({
      coingeckoMarketCap: null,
      circulatingSupply: 1_000_000_000,
      price: 0.0155,
    });
    expect(result?.value).toBeCloseTo(15_500_000, 5);
    expect(result?.estimated).toBe(true);
    expect(result?.source).toBe("price_x_circulating_supply");
  });

  it("trả null khi không có circulating supply — không lấy volume 24h thay thế", () => {
    // Đây đúng là hình dạng dữ liệu của bug cũ: có giá, có volume, nhưng không có supply.
    const result = resolveMarketCap({
      coingeckoMarketCap: null,
      circulatingSupply: null,
      price: 0.0155,
    });
    expect(result).toBeNull();
  });

  it("bỏ qua market cap CoinGecko không hợp lệ rồi ước tính từ supply", () => {
    expect(
      resolveMarketCap({ coingeckoMarketCap: 0, circulatingSupply: 10, price: 2 })
    ).toEqual({ value: 20, estimated: true, source: "price_x_circulating_supply" });
    expect(
      resolveMarketCap({ coingeckoMarketCap: -5, circulatingSupply: 10, price: 2 })?.estimated
    ).toBe(true);
    expect(
      resolveMarketCap({ coingeckoMarketCap: Number.NaN, circulatingSupply: 10, price: 2 })?.value
    ).toBe(20);
  });

  it("trả null khi price hoặc supply không hợp lệ", () => {
    expect(
      resolveMarketCap({ coingeckoMarketCap: null, circulatingSupply: Infinity, price: 2 })
    ).toBeNull();
    expect(
      resolveMarketCap({ coingeckoMarketCap: null, circulatingSupply: 10, price: 0 })
    ).toBeNull();
    expect(
      resolveMarketCap({ coingeckoMarketCap: null, circulatingSupply: -1, price: 2 })
    ).toBeNull();
  });
});
