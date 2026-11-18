import { computeClusters, correlation, hourlyReturns } from "@/lib/market/cluster";
import { computeLiquidity, netRiskReward } from "@/lib/market/liquidity";

function zigzag(n: number, amplitude = 0.01): number[] {
  return Array.from({ length: n }, (_, i) => 100 * (1 + amplitude * (i % 2 === 0 ? 1 : -1)));
}

describe("cluster", () => {
  it("hourlyReturns và correlation nhận chuỗi cùng nhịp", () => {
    const a = hourlyReturns(zigzag(30));
    const b = hourlyReturns(zigzag(30));
    expect(correlation(a, b)).toBeCloseTo(1, 5);
    expect(correlation(a, hourlyReturns(zigzag(30).reverse()))).toBeLessThan(0);
  });

  it("gộp coin tương quan cao, chọn leader và label narrative", () => {
    const base = zigzag(32);
    const other = Array.from({ length: 32 }, (_, i) => 50 + Math.sin(i) * 2);
    const clusters = computeClusters([
      { symbol: "AAA", closes: base, composite: 80, narratives: ["AI"] },
      { symbol: "BBB", closes: base, composite: 60, narratives: ["AI"] },
      { symbol: "CCC", closes: other, composite: 90, narratives: [] },
    ]);

    const a = clusters.get("AAA");
    expect(a).not.toBeNull();
    expect(a!.size).toBe(2);
    expect(a!.label).toBe("AI");
    expect(a!.leader).toBe(true);
    expect(clusters.get("BBB")!.leader).toBe(false);
    expect(clusters.get("CCC")).toBeNull();
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
