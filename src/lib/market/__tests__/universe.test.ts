import { isEligibleTicker, listingAgeDays, MIN_LISTING_AGE_DAYS } from "@/lib/market/universe";

const now = Date.now();
const old = now - 120 * 86_400_000;

function ticker(overrides: Partial<{ symbol: string; lastPrice: string; quoteVolume: string; priceChangePercent: string }> = {}) {
  return {
    symbol: "ALTUSDT",
    lastPrice: "1.25",
    quoteVolume: "50000000",
    priceChangePercent: "8.5",
    ...overrides,
  };
}

const meta = {
  status: "TRADING",
  contractType: "PERPETUAL",
  baseAsset: "ALT",
  quoteAsset: "USDT",
  onboardDate: old,
};

describe("isEligibleTicker", () => {
  it("nhận perpetual USDT đủ thanh khoản, đủ tuổi", () => {
    expect(isEligibleTicker(ticker(), meta, 10_000_000)).toBe(true);
  });

  it("loại volume thấp, giá 0, stablecoin, token leveraged", () => {
    expect(isEligibleTicker(ticker({ quoteVolume: "1000000" }), meta, 10_000_000)).toBe(false);
    expect(isEligibleTicker(ticker({ lastPrice: "0" }), meta, 10_000_000)).toBe(false);
    expect(isEligibleTicker(ticker(), { ...meta, baseAsset: "USDC" }, 10_000_000)).toBe(false);
    expect(isEligibleTicker(ticker(), { ...meta, baseAsset: "BTCBULL" }, 10_000_000)).toBe(false);
  });

  it("loại coin mới list dưới ngưỡng và symbol không phải USDT perp", () => {
    const young = now - 5 * 86_400_000;
    expect(isEligibleTicker(ticker(), { ...meta, onboardDate: young }, 10_000_000)).toBe(false);
    expect(isEligibleTicker(ticker({ symbol: "BTCUSDC" }), meta, 10_000_000)).toBe(false);
    expect(isEligibleTicker(ticker({ symbol: "BTCUSDT_240927" }), meta, 10_000_000)).toBe(false);
  });

  it("loại symbol không TRADING hoặc không phải PERPETUAL", () => {
    expect(isEligibleTicker(ticker(), { ...meta, status: "BREAK" }, 10_000_000)).toBe(false);
    expect(isEligibleTicker(ticker(), { ...meta, contractType: "CURRENT_QUARTER" }, 10_000_000)).toBe(false);
  });

  it("listingAgeDays trả null khi thiếu onboardDate", () => {
    expect(listingAgeDays(undefined)).toBeNull();
    expect(listingAgeDays(old)).toBeGreaterThanOrEqual(MIN_LISTING_AGE_DAYS);
  });
});
