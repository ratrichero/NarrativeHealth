import axios from "axios";
import { fetchBinanceFuturesKlines } from "@/lib/collectors/binance";
import { getRadarSnapshot } from "@/lib/market/radar";

jest.mock("axios", () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock("@/lib/collectors/binance", () => ({
  fetchBinanceFuturesKlines: jest.fn(),
  fetchBinanceFundingRate: jest.fn(async () => null),
  fetchBinanceOIHistory: jest.fn(async () => []),
  fetchBinanceFuturesDepth: jest.fn(async () => null),
}));

jest.mock("@/db", () => {
  const query = {
    from: jest.fn(),
    leftJoin: jest.fn(),
    where: jest.fn(async () => []),
  };
  query.from.mockReturnValue(query);
  query.leftJoin.mockReturnValue(query);
  return { db: { select: jest.fn(() => query) } };
});

const mockGet = axios.get as jest.Mock;
const mockKlines = fetchBinanceFuturesKlines as jest.Mock;

function candles(symbol: string) {
  // C39 và C15 cùng pattern để tạo một cụm; các coin khác pattern thứ hai.
  const correlated = symbol === "C39USDT" || symbol === "C15USDT";
  return Array.from({ length: 120 }, (_, i) => {
    const close = 100 + (correlated ? Math.sin(i * 0.7) : Math.cos(i * 0.5)) * 5;
    return {
      openTime: i * 3_600_000,
      open: String(close),
      high: String(close + 1),
      low: String(close - 1),
      close: String(close),
      volume: "100",
    };
  });
}

describe("radar snapshot cluster universe", () => {
  it("đưa coin ngoài top enrich vào clusters của snapshot", async () => {
    process.env.RADAR_DEMO = "0";

    const tickers = Array.from({ length: 40 }, (_, i) => ({
      symbol: `C${i}USDT`,
      lastPrice: "1",
      // C15 +1%: đủ điều kiện unusual nhưng không bao giờ vào top 15 gainer.
      priceChangePercent: String(i === 15 ? 1 : i - 20),
      quoteVolume: "50000000",
      highPrice: "1.1",
      lowPrice: "0.9",
      count: 100,
    }));

    mockGet.mockImplementation((url: string) => {
      if (url.includes("/fapi/v1/ticker/24hr")) return Promise.resolve({ data: tickers });
      if (url.includes("/fapi/v1/exchangeInfo")) return Promise.resolve({ data: { symbols: [] } });
      if (url.includes("binance.vision")) return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
    mockKlines.mockImplementation((symbol: string) => Promise.resolve(candles(symbol)));

    const snapshot = await getRadarSnapshot({
      side: "gainer",
      limit: 20,
      minVolume: 10_000_000,
    });

    const rowSymbols = snapshot.rows.map((row) => row.symbol);
    expect(rowSymbols).not.toContain("C15");

    const cluster = snapshot.clusters?.find((item) =>
      item.members.some((member) => member.symbol === "C15")
    );
    expect(cluster).toBeDefined();
    expect(cluster?.members.map((member) => member.symbol)).toEqual(
      expect.arrayContaining(["C39", "C15"])
    );

    const member = cluster?.members.find((item) => item.symbol === "C15");
    expect(member?.laggard).toBe(true);
    expect(cluster?.leader).toBe("C39");
  });
});
