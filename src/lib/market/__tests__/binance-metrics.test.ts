import {
  recordBinanceRequest,
  recordSnapshotBuild,
  recordSnapshotCache,
  resetRadarMetrics,
  snapshotBuildStats,
  withSnapshotBuild,
  type SnapshotBuildMetric,
} from "../binance-metrics";

function build(overrides: Partial<SnapshotBuildMetric> = {}): SnapshotBuildMetric {
  return {
    side: "gainer",
    minVolume: 10_000_000,
    durationMs: 100,
    binanceRequests: 120,
    rows: 12,
    clusters: 3,
    failed: false,
    ...overrides,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe("radar metrics", () => {
  beforeEach(() => {
    resetRadarMetrics();
    jest.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("tổng hợp duration và request Binance theo từng side", () => {
    recordSnapshotBuild(build());
    recordSnapshotBuild(build({ durationMs: 300, binanceRequests: 180 }));
    recordSnapshotBuild(build({ side: "loser", durationMs: 50, binanceRequests: 80 }));

    const stats = snapshotBuildStats();
    expect(stats.builds.map((item) => item.side)).toEqual(["gainer", "loser"]);

    const gainer = stats.builds[0];
    expect(gainer.builds).toBe(2);
    expect(gainer.avgDurationMs).toBe(200);
    expect(gainer.maxDurationMs).toBe(300);
    expect(gainer.avgBinanceRequests).toBe(150);

    const loser = stats.builds[1];
    expect(loser.builds).toBe(1);
    expect(loser.avgDurationMs).toBe(50);
  });

  it("đếm build lỗi riêng và vẫn giữ số liệu", () => {
    recordSnapshotBuild(build({ failed: true, rows: 0, clusters: 0, durationMs: 20_000 }));
    const [gainer] = snapshotBuildStats().builds;
    expect(gainer.failed).toBe(1);
    expect(gainer.maxDurationMs).toBe(20_000);
  });

  it("tính cache hit rate", () => {
    recordSnapshotCache(true);
    recordSnapshotCache(true);
    recordSnapshotCache(true);
    recordSnapshotCache(false);

    const stats = snapshotBuildStats();
    expect(stats.cacheHits).toBe(3);
    expect(stats.cacheMisses).toBe(1);
    expect(stats.cacheHitRate).toBe(75);
  });

  it("chưa có lượt tra nào → hit rate null, không chia cho 0", () => {
    expect(snapshotBuildStats().cacheHitRate).toBeNull();
  });

  it("chỉ giữ 50 build gần nhất", () => {
    for (let index = 0; index < 60; index += 1) {
      recordSnapshotBuild(build({ durationMs: index }));
    }
    const [gainer] = snapshotBuildStats().builds;
    expect(gainer.builds).toBe(50);
    expect(gainer.maxDurationMs).toBe(59);
  });

  it("reset xoá sạch số liệu", () => {
    recordSnapshotBuild(build());
    recordSnapshotCache(true);
    resetRadarMetrics();
    const stats = snapshotBuildStats();
    expect(stats.builds).toHaveLength(0);
    expect(stats.cacheHitRate).toBeNull();
  });

  it("gán request cho đúng build khi nhiều build chạy song song", async () => {
    const slow = withSnapshotBuild(
      { side: "gainer", minVolume: 10_000_000 },
      async () => {
        recordBinanceRequest();
        await tick();
        recordBinanceRequest();
        recordBinanceRequest();
        await tick();
        return { rows: [1, 2, 3], clusters: [1] };
      },
      (result) => ({ rows: result.rows.length, clusters: result.clusters.length })
    );

    const fast = withSnapshotBuild(
      { side: "loser", minVolume: 10_000_000 },
      async () => {
        recordBinanceRequest();
        return { rows: [] as number[], clusters: [] as number[] };
      },
      (result) => ({ rows: result.rows.length, clusters: result.clusters.length })
    );

    await Promise.all([slow, fast]);

    const stats = snapshotBuildStats();
    expect(stats.builds.find((item) => item.side === "gainer")?.avgBinanceRequests).toBe(3);
    expect(stats.builds.find((item) => item.side === "loser")?.avgBinanceRequests).toBe(1);
  });

  it("request ngoài build không bị tính vào build nào", async () => {
    recordBinanceRequest();
    recordBinanceRequest();

    const built = await withSnapshotBuild(
      { side: "unusual", minVolume: 10_000_000 },
      async () => {
        recordBinanceRequest();
        return { rows: [] as number[], clusters: [] as number[] };
      },
      (result) => ({ rows: result.rows.length, clusters: result.clusters.length })
    );
    expect(built.rows).toHaveLength(0);
    expect(snapshotBuildStats().builds[0].avgBinanceRequests).toBe(1);
  });

  it("build lỗi vẫn ghi nhận request đã phát ra", async () => {
    await expect(
      withSnapshotBuild(
        { side: "unusual", minVolume: 10_000_000 },
        async () => {
          recordBinanceRequest();
          recordBinanceRequest();
          throw new Error("binance down");
        },
        () => ({ rows: 0, clusters: 0 })
      )
    ).rejects.toThrow("binance down");

    const [unusual] = snapshotBuildStats().builds;
    expect(unusual.side).toBe("unusual");
    expect(unusual.failed).toBe(1);
    expect(unusual.avgBinanceRequests).toBe(2);
  });
});
