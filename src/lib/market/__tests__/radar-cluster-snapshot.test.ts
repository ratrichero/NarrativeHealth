import axios from "axios";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/market/movers/route";
import { fetchBinanceFuturesKlines } from "@/lib/collectors/binance";
import { getRadarSnapshot } from "@/lib/market/radar";

jest.mock("axios", () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// Route radar không còn chạy cohort trong after(): công việc đó do job
// scheduler gọi POST /api/market/radar/cohort.

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

function stubMarket(changes: Record<number, number> = {}) {
  process.env.RADAR_DEMO = "0";

  const tickers = Array.from({ length: 40 }, (_, i) => ({
    symbol: `C${i}USDT`,
    lastPrice: "1",
    // C15 +1%: đủ điều kiện unusual nhưng không bao giờ vào top 15 gainer.
    priceChangePercent: String(changes[i] ?? (i === 15 ? 1 : i - 20)),
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
}

describe("radar snapshot cluster universe", () => {
  it("route /api/market/movers trả cluster chứa coin ngoài top enrich", async () => {
    stubMarket();

    const response = await GET(
      new NextRequest(
        "http://localhost/api/market/movers?side=gainer&limit=20&minVolume=10000000"
      )
    );
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.success).toBe(true);
    const rows = payload.data.rows as Array<{ symbol: string }>;
    const clusters = payload.data.clusters as Array<{
      leader: string | null;
      members: Array<{ symbol: string; laggard?: boolean }>;
    }>;

    expect(rows.map((row) => row.symbol)).not.toContain("C15");
    const cluster = clusters.find((item) =>
      item.members.some((member) => member.symbol === "C15")
    );
    expect(cluster).toBeDefined();
    expect(cluster?.members.map((member) => member.symbol)).toEqual(
      expect.arrayContaining(["C39", "C15"])
    );
    expect(cluster?.members.find((member) => member.symbol === "C15")?.laggard).toBe(true);
    expect(cluster?.leader).toBe("C39");
  });

  it("đưa coin ngoài top enrich vào clusters của snapshot", async () => {
    stubMarket();

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

  it("tính lại cluster base khi mốc ticker đổi, không ghép row mới với cụm cũ", async () => {
    stubMarket();

    const first = await getRadarSnapshot({
      side: "gainer",
      limit: 20,
      minVolume: 10_000_000,
    });
    const firstCluster = first.clusters?.find((item) =>
      item.members.some((member) => member.symbol === "C15")
    );
    expect(firstCluster?.leader).toBe("C39");

    // Sau 46s ticker cache đã hết hạn (45s) và dữ liệu đổi: C15 +25% thành
    // leader của cụm. Trước đây cluster base sống 5 phút nên snapshot mới vẫn
    // dùng changePct/leader cũ (C15 +1%, leader C39).
    const spy = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 46_000);
    try {
      stubMarket({ 15: 25 });
      const second = await getRadarSnapshot({
        side: "unusual",
        limit: 20,
        minVolume: 10_000_000,
      });

      const cluster = second.clusters?.find((item) =>
        item.members.some((member) => member.symbol === "C15")
      );
      expect(cluster).toBeDefined();
      expect(cluster?.leader).toBe("C15");
      expect(cluster?.members.find((member) => member.symbol === "C15")?.changePct).toBe(25);
      expect(cluster?.members.find((member) => member.symbol === "C39")?.changePct).toBe(19);
    } finally {
      spy.mockRestore();
    }
  });
});
