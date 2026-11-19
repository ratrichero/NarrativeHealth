import { shapeRadarSnapshot, type RadarClusterSummary, type RadarSnapshot } from "../radar";

function cluster(id: string, size = 2): RadarClusterSummary {
  return {
    id,
    label: id,
    size,
    avgChangePct: 1.2,
    totalVolumeUsd: 1_000_000,
    leader: `L${id}`,
    direction: "up",
    members: Array.from({ length: size }, (_, index) => ({
      symbol: `${id.toUpperCase()}${index}`,
      changePct: 1,
      quoteVolumeUsd: 500_000,
      leader: index === 0,
      laggard: false,
    })),
  };
}

function snapshot(): RadarSnapshot {
  const top = ["cluster-a", "cluster-b", "cluster-c", "cluster-d", "cluster-e", "cluster-f"].map(
    (id) => cluster(id)
  );
  return {
    side: "gainer",
    rows: [],
    market: {
      gainers: 10,
      losers: 5,
      totalVolumeUsd: 0,
      btcChangePct: 0,
      btcPrice: 0,
      universe: 15,
      breadthPct: 50,
      btcTrend: "flat",
      regime: "neutral",
    },
    clusters: top,
    // Cụm thật nhưng ngoài top 6 panel (id permalink cũ vẫn còn trong universe).
    allClusters: [...top, cluster("cluster-outside", 3)],
    minVolume: 10_000_000,
    collectedAt: new Date("2026-11-18T00:00:00Z").toISOString(),
  };
}

describe("radar cluster permalink", () => {
  it("ghim cụm ngoài top 6 vào đầu danh sách khi có ?cluster=", () => {
    const shaped = shapeRadarSnapshot(snapshot(), { cluster: "cluster-outside" });

    expect(shaped.clusters?.[0].id).toBe("cluster-outside");
    expect(shaped.clusters?.[0].members).toHaveLength(3);
    // Panel vẫn giữ đủ 6 cụm cũ + cụm được ghim.
    expect(shaped.clusters).toHaveLength(7);
  });

  it("không đổi payload khi không có ?cluster=", () => {
    const shaped = shapeRadarSnapshot(snapshot(), {});

    expect(shaped.clusters).toHaveLength(6);
    expect(shaped.clusters?.[0].id).toBe("cluster-a");
  });

  it("không nhân đôi cụm đã có trong top panel", () => {
    const shaped = shapeRadarSnapshot(snapshot(), { cluster: "cluster-c" });

    expect(shaped.clusters).toHaveLength(6);
    expect(shaped.clusters?.filter((item) => item.id === "cluster-c")).toHaveLength(1);
  });

  it("id không còn trong universe → không ghim, client hiện banner", () => {
    const shaped = shapeRadarSnapshot(snapshot(), { cluster: "cluster-gone" });

    expect(shaped.clusters?.some((item) => item.id === "cluster-gone")).toBe(false);
  });

  it("không rò allClusters ra payload API", () => {
    const shaped = shapeRadarSnapshot(snapshot(), { cluster: "cluster-outside" });

    expect("allClusters" in shaped).toBe(false);
  });
});
