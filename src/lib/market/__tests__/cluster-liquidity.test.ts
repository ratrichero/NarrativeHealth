import { computeClusters, correlation, hourlyReturns } from "@/lib/market/cluster";
import { computeLiquidity, netRiskReward } from "@/lib/market/liquidity";

function zigzag(n: number, amplitude = 0.01): number[] {
  return Array.from({ length: n }, (_, i) => 100 * (1 + amplitude * (i % 2 === 0 ? 1 : -1)));
}

function closesFromReturns(returns: number[]): number[] {
  let price = 100;
  const closes = [price];
  for (const value of returns) {
    price *= 1 + value;
    closes.push(price);
  }
  return closes;
}

describe("cluster", () => {
  it("hourlyReturns và correlation nhận chuỗi cùng nhịp", () => {
    const a = hourlyReturns(zigzag(30));
    const b = hourlyReturns(zigzag(30));
    expect(correlation(a, b)).toBeCloseTo(1, 5);
    expect(correlation(a, hourlyReturns(zigzag(30).reverse()))).toBeLessThan(0);
  });

  it("gộp coin tương quan cao, chọn leader và chỉ gắn laggard cùng chiều", () => {
    const base = zigzag(32);
    const other = Array.from({ length: 32 }, (_, i) => 50 + Math.sin(i) * 2);
    const clusters = computeClusters([
      { symbol: "AAA", closes: base, composite: 80, narratives: ["AI"], changePct: 5 },
      { symbol: "BBB", closes: base, composite: 60, narratives: ["AI"], changePct: 3 },
      { symbol: "DDD", closes: base, composite: 50, narratives: ["AI"], changePct: -2 },
      { symbol: "CCC", closes: other, composite: 90, narratives: [], changePct: 9 },
    ]);

    const a = clusters.get("AAA");
    expect(a).not.toBeNull();
    expect(a!.size).toBe(3);
    expect(a!.label).toBe("AI");
    expect(a!.leader).toBe(true);
    expect(a!.laggard).toBe(false);
    expect(clusters.get("BBB")!.laggard).toBe(true);
    expect(clusters.get("DDD")!.laggard).toBe(false);
    expect(clusters.get("CCC")).toBeNull();
  });

  it("loại beta chung: hai coin cùng chạy theo BTC không thành cụm", () => {
    const n = 32;
    const btcReturns = Array.from({ length: n }, (_, i) => Math.sin(i * 0.55) * 0.01);
    const aReturns = btcReturns.map((value, i) => value * 2 + Math.sin(i * 1.7) * 0.0015);
    const bReturns = btcReturns.map((value, i) => value * 3 + Math.cos(i * 2.3) * 0.0015);

    const clusters = computeClusters(
      [
        {
          symbol: "A",
          closes: closesFromReturns(aReturns),
          composite: 80,
          narratives: [],
          changePct: 4,
        },
        {
          symbol: "B",
          closes: closesFromReturns(bReturns),
          composite: 70,
          narratives: [],
          changePct: 3,
        },
      ],
      { btcCloses: closesFromReturns(btcReturns) }
    );

    expect(clusters.get("A")).toBeNull();
    expect(clusters.get("B")).toBeNull();
  });

  it("chặn bắc cầu A~B, B~C khi A~C yếu", () => {
    const n = 32;
    const base = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7));
    const aReturns = base.map((value, i) => value + Math.cos(i * 0.7));
    const cReturns = base.map((value, i) => value - Math.cos(i * 0.7));

    const clusters = computeClusters([
      {
        symbol: "A",
        closes: closesFromReturns(aReturns),
        composite: 80,
        narratives: [],
        changePct: 3,
      },
      {
        symbol: "B",
        closes: closesFromReturns(base),
        composite: 70,
        narratives: [],
        changePct: 2,
      },
      {
        symbol: "C",
        closes: closesFromReturns(cReturns),
        composite: 60,
        narratives: [],
        changePct: 1,
      },
    ]);

    expect(clusters.get("A")!.size).toBe(2);
    expect(clusters.get("A")!.clusterId).toBe(clusters.get("B")!.clusterId);
    expect(clusters.get("C")).toBeNull();
  });
});

describe("liquidity", () => {
  it("tính spread, depth, slippage và cờ thin", () => {
    const bids = [
      { price: 100, qty: 10 },
      { price: 99.5, qty: 10 },
    ];
    const asks = [
      { price: 100.1, qty: 10 },
      { price: 100.6, qty: 10 },
    ];
    const liq = computeLiquidity(bids, asks, 100);
    expect(liq.spreadBps).toBeCloseTo(10, 0);
    expect(liq.depthUsd1Pct).toBeGreaterThan(0);
    expect(liq.buySlippageBps[0].bps).toBeCloseTo(0, 1);
    expect(liq.buySlippageBps[2].bps).toBeNull(); // 50k vượt depth
    expect(liq.thin).toBe(true);
  });

  it("net R:R trừ phí taker", () => {
    expect(netRiskReward(100, 95, 110)).toBeCloseTo(1.96, 1);
    expect(netRiskReward(100, 100, 110)).toBeNull();
  });
});
