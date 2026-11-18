// RADAR-05 E5 — detail phải gán cụm như list.
// Trước fix: getMoverDetail không tính cụm → mở từ panel cụm mất clusterLabel/leader
// và cờ catalyst ở detail không bao giờ xét nhánh clusterLeader.
import { applyDetailCluster, type RadarRow } from "@/lib/market/radar";

function baseRow(overrides: Partial<RadarRow> & Pick<RadarRow, "symbol">): RadarRow {
  return {
    pair: `${overrides.symbol}USDT`,
    price: 1,
    changePct: 2.5,
    quoteVolume: 50_000_000,
    trades: 1000,
    high24h: 1.05,
    low24h: 0.95,
    rangePosition: 50,
    distanceFromHighPct: -2,
    volumeRatio7d: 1.1,
    volumeZ: 0.4,
    atrPct: 1.2,
    changeAtrMultiple: 0.6,
    rsi14: 52,
    fundingRate: 0.0001,
    oiChangePct: 0.5,
    listingAgeDays: 200,
    isBreakout7d: false,
    rangePct7d: 4,
    high7d: 1.1,
    inSystem: false,
    narratives: ["AI"],
    bias: "neutral",
    label: "Neutral",
    score: 50,
    entryQuality: 40,
    composite: 40,
    reasons: [],
    warnings: [],
    clusterId: null,
    clusterLabel: null,
    clusterSize: 1,
    clusterLeader: false,
    clusterLaggard: false,
    catalystTriggered: false,
    ...overrides,
  };
}

describe("applyDetailCluster", () => {
  it("leader cụm: giữ clusterId/label/size/leader và bật catalyst dù volume bình thường", () => {
    const row = baseRow({ symbol: "AAA" });
    // toRow() tính cờ trước khi biết cụm nên lúc này là false.
    expect(row.catalystTriggered).toBe(false);

    applyDetailCluster(row, { clusterId: "cluster-1", label: "AI", size: 3, leader: true, laggard: false });

    expect(row.clusterId).toBe("cluster-1");
    expect(row.clusterLabel).toBe("AI");
    expect(row.clusterSize).toBe(3);
    expect(row.clusterLeader).toBe(true);
    expect(row.clusterLaggard).toBe(false);
    expect(row.catalystTriggered).toBe(true);
  });

  it("laggard cụm: giữ label nhưng không phải leader và không tự bật cờ", () => {
    const row = baseRow({ symbol: "BBB" });

    applyDetailCluster(row, { clusterId: "cluster-1", label: "AI", size: 3, leader: false, laggard: true });

    expect(row.clusterLabel).toBe("AI");
    expect(row.clusterLeader).toBe(false);
    expect(row.clusterLaggard).toBe(true);
    expect(row.catalystTriggered).toBe(false);
  });

  it("không thuộc cụm: reset về size 1 và không bật cờ theo cụm", () => {
    const row = baseRow({ symbol: "CCC", clusterLeader: true, catalystTriggered: true });

    applyDetailCluster(row, null);

    expect(row.clusterId).toBeNull();
    expect(row.clusterLabel).toBeNull();
    expect(row.clusterSize).toBe(1);
    expect(row.clusterLeader).toBe(false);
    expect(row.clusterLaggard).toBe(false);
    // Không còn leader → cờ về false vì volume/change cũng bình thường.
    expect(row.catalystTriggered).toBe(false);
  });
});
