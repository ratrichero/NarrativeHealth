// RADAR-05 bước 2 — E2: leader/laggard phải cùng chiều với cụm.
// Trước fix, leader = composite cao nhất (percentile của |changePct|), nên coin
// giảm mạnh nhất có thể làm leader của cụm đang tăng và coin tăng bị gắn laggard.
import { computeClusters, type ClusterInput } from "@/lib/market/cluster";

/** Chuỗi close giống nhau → correlation 1.0, chắc chắn vào cùng cụm. */
function closes(seed = 1, length = 60): number[] {
  const out: number[] = [];
  let price = 100;
  for (let i = 0; i < length; i += 1) {
    price *= 1 + Math.sin(i / 5 + seed) * 0.01 + 0.002;
    out.push(price);
  }
  return out;
}

function item(symbol: string, changePct: number, series: number[]): ClusterInput {
  return { symbol, closes: series, composite: 50, narratives: ["AI"], changePct };
}

describe("computeClusters — leader/laggard cùng chiều cụm (E2)", () => {
  it("cụm tăng không thể có leader là coin giảm mạnh nhất", () => {
    const series = closes();
    const items = [
      item("AAA", -18, series), // |change| lớn nhất → leader cũ (sai)
      item("BBB", 10, series),
      item("CCC", 9, series),
      item("DDD", 1, series),
    ];

    const clusters = computeClusters(items, { threshold: 0.6 });
    // Avg = +0.5% → cụm tăng.
    expect(clusters.get("BBB")?.leader).toBe(true);
    expect(clusters.get("AAA")?.leader).toBe(false);
    // Coin giảm trong cụm tăng không phải "laggard chưa bắt nhịp".
    expect(clusters.get("AAA")?.laggard).toBe(false);
    expect(clusters.get("CCC")?.laggard).toBe(true);
  });

  it("cụm toàn coin giảm có leader giảm mạnh nhất, không có leader tăng", () => {
    const series = closes(2);
    const items = [item("AAA", -9, series), item("BBB", -5, series), item("CCC", -3, series)];

    const clusters = computeClusters(items, { threshold: 0.6 });
    expect(clusters.get("AAA")?.leader).toBe(true);
    expect(clusters.get("BBB")?.laggard).toBe(true);
    expect(clusters.get("CCC")?.laggard).toBe(true);
    expect(items.filter((i) => clusters.get(i.symbol)?.leader && i.changePct > 0)).toEqual([]);
  });

  it("coin đứng giá (0%) không thành leader hay laggard của cụm tăng", () => {
    const series = closes(3);
    const items = [
      item("AAA", -18, series),
      item("BBB", 10, series),
      item("DDD", 9, series),
      item("FLAT", 0, series),
    ];

    const clusters = computeClusters(items, { threshold: 0.6 });
    expect(clusters.get("BBB")?.leader).toBe(true);
    expect(clusters.get("FLAT")?.leader).toBe(false);
    expect(clusters.get("FLAT")?.laggard).toBe(false);
  });
});
