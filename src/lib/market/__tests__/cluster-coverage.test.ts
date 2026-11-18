import type { ClusterInfo } from "@/lib/market/cluster";
import { selectClusterPool, summarizeClusters, type FuturesTicker } from "@/lib/market/radar";

function ticker(i: number): FuturesTicker {
  return {
    symbol: `C${i}USDT`,
    lastPrice: "1",
    priceChangePercent: String(i - 20),
    quoteVolume: String((40 - i) * 1_000_000),
    highPrice: "1.1",
    lowPrice: "0.9",
  };
}

describe("selectClusterPool", () => {
  const tickers = Array.from({ length: 40 }, (_, i) => ticker(i));

  it("quét thêm coin ngoài top enrich, có cả gainer/loser volume thấp", () => {
    const chosen = new Set(tickers.slice(30).map((t) => t.symbol)); // top change
    const pool = selectClusterPool(tickers, chosen, 20);
    const symbols = pool.map((t) => t.symbol);

    expect(pool).toHaveLength(20);
    expect(symbols.some((symbol) => chosen.has(symbol))).toBe(false);
    expect(symbols).toContain("C0USDT"); // loser mạnh, ngoài top change
    expect(symbols).toContain("C29USDT"); // gainer mạnh kế tiếp, volume thấp hơn top enrich
    expect(new Set(symbols).size).toBe(20);
  });

  it("tôn trọng limit và tắt khi limit = 0", () => {
    expect(selectClusterPool(tickers, new Set(), 5)).toHaveLength(5);
    expect(selectClusterPool(tickers, new Set(), 0)).toEqual([]);
  });
});

describe("summarizeClusters", () => {
  it("gộp member ngoài rows vào summary, tính avg/leader đúng", () => {
    const items = [
      { symbol: "AAA", changePct: 6, quoteVolumeUsd: 100 },
      { symbol: "OUT", changePct: 10, quoteVolumeUsd: 50 },
      { symbol: "BBB", changePct: -2, quoteVolumeUsd: 20 },
    ];
    const clusters = new Map<string, ClusterInfo | null>([
      ["AAA", { clusterId: "c1", label: "AI", size: 2, leader: false }],
      ["OUT", { clusterId: "c1", label: "AI", size: 2, leader: true }],
      ["BBB", null],
    ]);

    const [summary] = summarizeClusters(items, clusters);
    expect(summary.size).toBe(2);
    expect(summary.label).toBe("AI");
    expect(summary.leader).toBe("OUT");
    expect(summary.avgChangePct).toBe(8);
    expect(summary.direction).toBe("up");
    expect(summary.members.map((m) => m.symbol)).toEqual(["OUT", "AAA"]);
  });
});
