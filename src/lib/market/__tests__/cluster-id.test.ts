// RADAR-05 E1 — clusterId phải ổn định theo tập member + top narrative, không
// phụ thuộc thứ tự duyệt input/union-find.
import { computeClusters, type ClusterInput } from "@/lib/market/cluster";

function series(seed: number, length = 40): number[] {
  const closes: number[] = [];
  let price = 100;
  for (let i = 0; i < length; i += 1) {
    price *= 1 + Math.sin(i / 3 + seed) * 0.02 + 0.001;
    closes.push(price);
  }
  return closes;
}

function items(): ClusterInput[] {
  return [
    { symbol: "AAA", closes: series(1), composite: 80, narratives: ["AI"], changePct: 6 },
    { symbol: "BBB", closes: series(1), composite: 70, narratives: ["AI"], changePct: 4 },
    { symbol: "CCC", closes: series(9), composite: 60, narratives: ["AI"], changePct: -3 },
  ];
}

describe("computeClusters — clusterId ổn định (RADAR-05 E1)", () => {
  it("cùng tập member → cùng id dù đảo thứ tự input", () => {
    const forward = computeClusters(items());
    const reversed = computeClusters([...items()].reverse());

    for (const symbol of ["AAA", "BBB"]) {
      expect(forward.get(symbol)?.clusterId).toBe(reversed.get(symbol)?.clusterId);
      expect(forward.get(symbol)?.label).toBe(reversed.get(symbol)?.label);
    }
    expect(forward.get("AAA")?.clusterId).toMatch(/^cluster-ai-[a-z0-9]+$/);
  });

  it("id không còn là số thứ tự và không đổi giữa các lần quét", () => {
    const first = computeClusters(items()).get("AAA");
    const second = computeClusters(items()).get("AAA");
    expect(first?.clusterId).toBe(second?.clusterId);
    expect(first?.clusterId).not.toMatch(/^cluster-\d+$/);
  });

  it("tập member khác → id khác", () => {
    const base = computeClusters(items()).get("AAA")?.clusterId;
    const changed = computeClusters([
      ...items(),
      { symbol: "DDD", closes: series(1), composite: 65, narratives: ["AI"], changePct: 5 },
    ]).get("AAA")?.clusterId;

    expect(base).toBeTruthy();
    expect(changed).toBeTruthy();
    expect(changed).not.toBe(base);
  });

  it("không có narrative trội → label/id vẫn ổn định, không phụ thuộc thứ tự", () => {
    const mixed: ClusterInput[] = [
      { symbol: "AAA", closes: series(1), composite: 80, narratives: [], changePct: 6 },
      { symbol: "BBB", closes: series(1), composite: 70, narratives: [], changePct: 4 },
    ];
    const forward = computeClusters(mixed);
    const reversed = computeClusters([...mixed].reverse());

    expect(forward.get("AAA")?.clusterId).toBe(reversed.get("AAA")?.clusterId);
    expect(forward.get("AAA")?.clusterId).toMatch(/^cluster-mixed-[a-z0-9]+$/);
    expect(forward.get("AAA")?.label).toBe(reversed.get("AAA")?.label);
    expect(forward.get("AAA")?.label).toMatch(/^Cụm [a-z0-9]{6}$/);
  });

  it("singleton vẫn không có clusterId", () => {
    const result = computeClusters([
      { symbol: "SOLO", closes: series(5), composite: 90, narratives: ["AI"], changePct: 7 },
    ]);
    expect(result.get("SOLO")).toBeNull();
  });
});
