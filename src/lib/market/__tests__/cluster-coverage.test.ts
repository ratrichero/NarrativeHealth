import { computeClusters, type ClusterInfo } from "@/lib/market/cluster";
import {
  applyClusterInfo,
  buildClusterBase,
  mergeClusterCandidates,
  selectClusterPool,
  selectClusterUniverse,
  summarizeClusters,
  type FuturesTicker,
} from "@/lib/market/radar";

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

describe("selectClusterUniverse", () => {
  it("dùng cùng universe cố định, gồm top gainer/loser và unusual", () => {
    const tickers = Array.from({ length: 40 }, (_, i) => ticker(i));
    const universe = selectClusterUniverse(tickers, 0, 32).map((item) => item.symbol);

    expect(universe).toHaveLength(32);
    expect(universe).toContain("C39USDT"); // top gainer
    expect(universe).toContain("C0USDT"); // top loser
    expect(universe).toContain("C12USDT"); // unusual volume, change -8
    expect(selectClusterUniverse(tickers, 0, 32).map((item) => item.symbol)).toEqual(universe);
  });
});

describe("buildClusterBase", () => {
  it("cùng universe cho cùng cụm dù composite enrich khác tab", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i));
    const candidates = [
      {
        symbol: "AAA",
        closes,
        composite: 10,
        narratives: ["AI"],
        changePct: 4,
        quoteVolumeUsd: 100,
      },
      {
        symbol: "BBB",
        closes,
        composite: 90,
        narratives: ["AI"],
        changePct: 3,
        quoteVolumeUsd: 80,
      },
      {
        symbol: "CCC",
        closes,
        composite: 50,
        narratives: ["AI"],
        changePct: 2,
        quoteVolumeUsd: 60,
      },
    ];
    const options = { absChangeRanks: [2, 3, 4] };
    const gainerTab = buildClusterBase(candidates, options);
    const loserTab = buildClusterBase(
      candidates.map((candidate) => ({ ...candidate, composite: 100 - candidate.composite })),
      options
    );

    expect(loserTab.summaries).toEqual(gainerTab.summaries);
    expect(gainerTab.summaries[0].members.map((member) => member.symbol)).toEqual([
      "AAA",
      "BBB",
      "CCC",
    ]);
    expect(gainerTab.summaries[0].leader).toBe("AAA");
  });
});

describe("applyClusterInfo", () => {
  it("gắn cluster/leader/laggard lên row detail và xoá sạch khi null", () => {
    const row = {
      clusterId: null as string | null,
      clusterLabel: null as string | null,
      clusterSize: 1,
      clusterLeader: false,
      clusterLaggard: false,
    };
    applyClusterInfo(row, {
      clusterId: "cluster-1",
      label: "AI",
      size: 4,
      leader: false,
      laggard: true,
    });
    expect(row.clusterId).toBe("cluster-1");
    expect(row.clusterLabel).toBe("AI");
    expect(row.clusterSize).toBe(4);
    expect(row.clusterLeader).toBe(false);
    expect(row.clusterLaggard).toBe(true);

    applyClusterInfo(row, null);
    expect(row.clusterId).toBeNull();
    expect(row.clusterLabel).toBeNull();
    expect(row.clusterSize).toBe(1);
    expect(row.clusterLeader).toBe(false);
    expect(row.clusterLaggard).toBe(false);
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
      ["AAA", { clusterId: "c1", label: "AI", size: 2, leader: false, laggard: true }],
      ["OUT", { clusterId: "c1", label: "AI", size: 2, leader: true, laggard: false }],
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

  it("giữ toàn bộ member và id ổn định theo membership", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      symbol: `M${i}`,
      changePct: i,
      quoteVolumeUsd: i * 100,
    }));
    const clusters = new Map<string, ClusterInfo | null>(
      items.map((item, i) => [
        item.symbol,
        {
          clusterId: "cluster-1",
          label: "AI",
          size: items.length,
          leader: i === items.length - 1,
          laggard: i !== items.length - 1,
        },
      ])
    );

    const [summary] = summarizeClusters(items, clusters);
    expect(summary.members).toHaveLength(8);
    expect(summary.size).toBe(8);
    expect(summary.members.map((member) => member.symbol)).toEqual([
      "M7",
      "M6",
      "M5",
      "M4",
      "M3",
      "M2",
      "M1",
      "M0",
    ]);

    const [reordered] = summarizeClusters([...items].reverse(), clusters);
    expect(reordered.id).toBe(summary.id);
  });

  it("trộn enrich + extra: chuẩn hoá composite và không để extra thành leader sai", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i));
    const enriched = [
      {
        symbol: "AAA",
        closes,
        composite: 72,
        narratives: ["AI"],
        changePct: 3,
        quoteVolumeUsd: 100,
      },
      {
        symbol: "BBB",
        closes,
        composite: 58,
        narratives: ["AI"],
        changePct: 2,
        quoteVolumeUsd: 80,
      },
    ];
    const extra = [
      {
        symbol: "OUT",
        closes,
        composite: 0,
        narratives: ["AI"],
        changePct: 25,
        quoteVolumeUsd: 40,
      },
    ];

    const merged = mergeClusterCandidates(enriched, extra, [2, 3, 25]);
    const out = merged.find((item) => item.symbol === "OUT")!;
    expect(out.composite).toBe(72);
    expect(out.composite).toBeLessThanOrEqual(Math.max(...enriched.map((item) => item.composite)));

    const clusters = computeClusters(merged);
    expect(clusters.get("AAA")!.leader).toBe(true);
    expect(clusters.get("OUT")!.leader).toBe(false);
    expect(clusters.get("OUT")!.laggard).toBe(true);
  });
});
