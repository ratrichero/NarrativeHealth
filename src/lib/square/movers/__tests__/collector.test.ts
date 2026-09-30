// SQ-MOVERS: collector tests — rank/filter từ fixture, không cần network
import {
  rankMovers,
  enrichMover,
  MIN_QUOTE_VOLUME_USD,
  MOVERS_PER_SIDE,
  type RawFuturesTicker,
  type MoverCoin,
} from "../collector";

// Mock binance collector cho enrichMover
jest.mock("@/lib/collectors/binance", () => ({
  fetchBinanceFuturesKlines: jest.fn(),
  fetchBinanceFundingRate: jest.fn(),
}));

import {
  fetchBinanceFuturesKlines,
  fetchBinanceFundingRate,
} from "@/lib/collectors/binance";

const mockedKlines = fetchBinanceFuturesKlines as jest.Mock;
const mockedFunding = fetchBinanceFundingRate as jest.Mock;

function ticker(
  symbol: string,
  changePct: number,
  quoteVolume: number,
  lastPrice: number = 1
): RawFuturesTicker {
  return {
    symbol,
    lastPrice: String(lastPrice),
    priceChangePercent: String(changePct),
    quoteVolume: String(quoteVolume),
  };
}

const FIVE_M = MIN_QUOTE_VOLUME_USD;

describe("rankMovers", () => {
  it("ranks top 3 gainers and top 3 losers by percent change", () => {
    const tickers: RawFuturesTicker[] = [
      ticker("AAAUSDT", 12.0, 10 * FIVE_M),
      ticker("BBBUSDT", 5.5, 10 * FIVE_M),
      ticker("CCCUSDT", 9.1, 10 * FIVE_M),
      ticker("DDDUSDT", 3.2, 10 * FIVE_M),
      ticker("EEEUSDT", 7.7, 10 * FIVE_M),
      ticker("FFFUSDT", -1.5, 10 * FIVE_M),
      ticker("GGGUSDT", -9.8, 10 * FIVE_M),
      ticker("HHHUSDT", -4.0, 10 * FIVE_M),
      ticker("IIIUSDT", -6.6, 10 * FIVE_M),
      ticker("JJJUSDT", 0.2, 10 * FIVE_M),
      ticker("KKKUSDT", -12.3, 10 * FIVE_M),
    ];

    const { gainers, losers, marketCount } = rankMovers(tickers);

    expect(marketCount).toBe(11);
    expect(gainers.map((t) => t.symbol)).toEqual([
      "AAAUSDT",
      "CCCUSDT",
      "EEEUSDT",
    ]);
    expect(losers.map((t) => t.symbol)).toEqual([
      "KKKUSDT",
      "GGGUSDT",
      "IIIUSDT",
    ]);
  });

  it("respects the per-side limit override", () => {
    const tickers = [
      ticker("AAAUSDT", 10, 10 * FIVE_M),
      ticker("BBBUSDT", 9, 10 * FIVE_M),
      ticker("CCCUSDT", 8, 10 * FIVE_M),
      ticker("FFFUSDT", -1, 10 * FIVE_M),
      ticker("GGGUSDT", -2, 10 * FIVE_M),
      ticker("HHHUSDT", -3, 10 * FIVE_M),
    ];
    const { gainers, losers } = rankMovers(tickers, 2);
    expect(gainers).toHaveLength(2);
    expect(gainers.map((t) => t.symbol)).toEqual(["AAAUSDT", "BBBUSDT"]);
    expect(losers).toHaveLength(2);
    // Ascending: giảm sâu nhất trước (−3 → −2)
    expect(losers.map((t) => t.symbol)).toEqual(["HHHUSDT", "GGGUSDT"]);
    expect(MOVERS_PER_SIDE).toBe(3);
  });

  it("drops quarterly futures symbols (BTCUSDT_240927)", () => {
    const tickers = [
      ticker("BTCUSDT_240927", 99, 50 * FIVE_M),
      ticker("ETHUSDT_240927", -99, 50 * FIVE_M),
      ticker("AAAUSDT", 4, 10 * FIVE_M),
      ticker("BBBUSDT", 3, 10 * FIVE_M),
      ticker("CCCUSDT", 2, 10 * FIVE_M),
      ticker("DDDUSDT", -4, 10 * FIVE_M),
      ticker("EEEUSDT", -3, 10 * FIVE_M),
      ticker("FFFUSDT", -2, 10 * FIVE_M),
    ];
    const { gainers, losers, marketCount } = rankMovers(tickers);
    expect(marketCount).toBe(6);
    expect(gainers.map((t) => t.symbol)).toEqual(["AAAUSDT", "BBBUSDT", "CCCUSDT"]);
    expect(losers.map((t) => t.symbol)).toEqual(["DDDUSDT", "EEEUSDT", "FFFUSDT"]);
  });

  it("drops symbols below the minimum quote volume", () => {
    const tickers = [
      ticker("PUMPUSDT", 95, FIVE_M - 1), // dưới ngưỡng 1 USD
      ticker("AAAUSDT", 4, 10 * FIVE_M),
      ticker("DUMPUSDT", -95, 1), // dưới ngưỡng
      ticker("BBBUSDT", -4, 10 * FIVE_M),
    ];
    const { gainers, losers, marketCount } = rankMovers(tickers);
    expect(marketCount).toBe(2);
    expect(gainers[0].symbol).toBe("AAAUSDT");
    expect(losers[0].symbol).toBe("BBBUSDT");
  });

  it("breaks ties by higher quote volume", () => {
    const tickers = [
      ticker("LOWVOLUSDT", 10, 6 * FIVE_M),
      ticker("HIGHVOLUSDT", 10, 20 * FIVE_M),
      ticker("MIDVOLUSDT", 10, 10 * FIVE_M),
      ticker("LOSER1USDT", -10, 10 * FIVE_M),
      ticker("LOSER2USDT", -9, 10 * FIVE_M),
      ticker("LOSER3USDT", -8, 10 * FIVE_M),
    ];
    const { gainers, losers } = rankMovers(tickers);
    expect(gainers.map((t) => t.symbol)).toEqual([
      "HIGHVOLUSDT",
      "MIDVOLUSDT",
      "LOWVOLUSDT",
    ]);
    expect(losers.map((t) => t.symbol)).toEqual([
      "LOSER1USDT",
      "LOSER2USDT",
      "LOSER3USDT",
    ]);
  });

  it("drops non-numeric prices and zero prices", () => {
    const tickers = [
      { symbol: "BADUSDT", lastPrice: "NaN", priceChangePercent: "50", quoteVolume: String(20 * FIVE_M) },
      { symbol: "ZEROUSDT", lastPrice: "0", priceChangePercent: "50", quoteVolume: String(20 * FIVE_M) },
      { symbol: "NOPCTUSDT", lastPrice: "1", priceChangePercent: "abc", quoteVolume: String(20 * FIVE_M) },
      ticker("GOODUSDT", 10, 10 * FIVE_M),
      ticker("GOOD2USDT", 9, 10 * FIVE_M),
      ticker("GOOD3USDT", 8, 10 * FIVE_M),
      ticker("FLOPPYUSDT", -10, 10 * FIVE_M),
      ticker("FLOPPY2USDT", -9, 10 * FIVE_M),
      ticker("FLOPPY3USDT", -8, 10 * FIVE_M),
    ];
    const { gainers, losers, marketCount } = rankMovers(tickers);
    expect(marketCount).toBe(6);
    expect(gainers[0].symbol).toBe("GOODUSDT");
    expect(losers[0].symbol).toBe("FLOPPYUSDT");
  });

  it("returns empty arrays when nothing is eligible", () => {
    const { gainers, losers, marketCount } = rankMovers([]);
    expect(marketCount).toBe(0);
    expect(gainers).toHaveLength(0);
    expect(losers).toHaveLength(0);
  });
});

describe("enrichMover", () => {
  const base: MoverCoin = {
    symbol: "XYZ",
    price: 2.28,
    changePct: 12.4,
    quoteVolume: 45_000_000,
    volumeRatio: null,
    fundingRate: null,
  };

  beforeEach(() => {
    mockedKlines.mockReset();
    mockedFunding.mockReset();
  });

  it("computes volume ratio vs 7-day average excluding today's unclosed candle", async () => {
    // 8 klines: 7 đã đóng (TB 10M) + 1 nến hôm nay 30M → ratio 3.0
    const closed = Array.from({ length: 7 }, () => ({
      quoteVolume: "10000000",
    }));
    const today = { quoteVolume: "30000000" };
    mockedKlines.mockResolvedValue([...closed, today]);
    mockedFunding.mockResolvedValue(0.0001); // 0.01%/8h dạng thập phân

    const enriched = await enrichMover(base);
    expect(enriched.volumeRatio).toBeCloseTo(3.0, 5);
    expect(enriched.fundingRate).toBeCloseTo(0.0001, 8);
  });

  it("keeps nulls when klines or funding fail (null-safe enrichment)", async () => {
    mockedKlines.mockResolvedValue([]); // lỗi → []
    mockedFunding.mockResolvedValue(null);

    const enriched = await enrichMover(base);
    expect(enriched.volumeRatio).toBeNull();
    expect(enriched.fundingRate).toBeNull();
  });

  it("survives unexpected rejections from both collectors", async () => {
    mockedKlines.mockRejectedValue(new Error("network down"));
    mockedFunding.mockRejectedValue(new Error("timeout"));

    const enriched = await enrichMover(base);
    expect(enriched.volumeRatio).toBeNull();
    expect(enriched.fundingRate).toBeNull();
    expect(enriched.symbol).toBe("XYZ"); // dữ liệu gốc giữ nguyên
  });

  it("ignores NaN funding values", async () => {
    mockedKlines.mockResolvedValue([]);
    mockedFunding.mockResolvedValue(Number.NaN);

    const enriched = await enrichMover(base);
    expect(enriched.fundingRate).toBeNull();
  });

  it("does not compute a ratio when the 7-day average is zero", async () => {
    mockedKlines.mockResolvedValue([
      ...Array.from({ length: 7 }, () => ({ quoteVolume: "0" })),
      { quoteVolume: "5000" },
    ]);
    mockedFunding.mockResolvedValue(null);

    const enriched = await enrichMover(base);
    expect(enriched.volumeRatio).toBeNull();
  });
});
