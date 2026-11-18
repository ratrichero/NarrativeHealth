// RADAR-06 — regression: cờ catalyst phải tính lại SAU khi gán cluster.
// Trước fix, toRow() tính cờ khi clusterLeader còn false nên leader không có
// volume/change bất thường không bao giờ mở panel “vì sao volume bất thường”.
import { computeClusters } from "@/lib/market/cluster";
import {
  applyClusterAssignments,
  type ClusterCandidate,
  type RadarRow,
} from "@/lib/market/radar";

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
    clusterLeader: false,
    clusterLaggard: false,
    catalystTriggered: false,
    ...overrides,
  };
}

// Hai coin tương quan 1.0 (cùng chuỗi close) → cùng 1 cụm; composite quyết định leader.
const closes = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);

const clusterItems: ClusterCandidate[] = [
  { symbol: "AAA", closes, composite: 80, narratives: ["AI"], changePct: 2.5, quoteVolumeUsd: 50_000_000 },
  { symbol: "BBB", closes, composite: 40, narratives: ["AI"], changePct: 2.5, quoteVolumeUsd: 40_000_000 },
];

describe("applyClusterAssignments — catalystTriggered theo cluster leader", () => {
  it("cluster leader không có volumeZ/ratio/change bất thường vẫn bật cờ", () => {
    const leader = baseRow({ symbol: "AAA", composite: 80 });
    const laggard = baseRow({ symbol: "BBB", composite: 40 });

    // toRow() tính cờ trước khi biết cụm → cả hai đều false ở thời điểm này.
    expect(leader.catalystTriggered).toBe(false);
    expect(laggard.catalystTriggered).toBe(false);

    applyClusterAssignments([leader, laggard], computeClusters(clusterItems));

    expect(leader.clusterLeader).toBe(true);
    expect(leader.clusterSize).toBe(2);
    expect(leader.catalystTriggered).toBe(true);

    // Laggard không tự bật cờ chỉ vì nằm trong cụm.
    expect(laggard.clusterLeader).toBe(false);
    expect(laggard.clusterLaggard).toBe(true);
    expect(laggard.catalystTriggered).toBe(false);
  });

  it("nguồn trigger cũ (volume/change) vẫn hoạt động sau khi tính lại", () => {
    const volumeRow = baseRow({ symbol: "CCC", volumeZ: 2.4 });
    const changeRow = baseRow({ symbol: "DDD", changePct: -11 });

    applyClusterAssignments([volumeRow, changeRow], computeClusters([]));

    expect(volumeRow.clusterLeader).toBe(false);
    expect(volumeRow.catalystTriggered).toBe(true);
    expect(changeRow.catalystTriggered).toBe(true);
  });
});
