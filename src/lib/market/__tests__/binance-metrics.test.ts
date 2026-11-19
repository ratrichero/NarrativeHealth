import {
  binanceRequestTotal,
  recordBinanceRequest,
  recordSnapshotBuild,
  recordSnapshotCache,
  resetRadarMetrics,
  snapshotBuildStats,
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
    at: "2026-11-18T10:00:00.000Z",
    ...overrides,
  };
}

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
    expect(gainer.lastDurationMs).toBe(300);

    const loser = stats.builds[1];
    expect(loser.builds).toBe(1);
    expect(loser.avgDurationMs).toBe(50);
    expect(stats.recent).toHaveLength(3);
  });

  it("đếm build lỗi riêng và vẫn giữ số liệu", () => {
    recordSnapshotBuild(build({ failed: true, rows: 0, clusters: 0, durationMs: 20_000 }));
    const [gainer] = snapshotBuildStats().builds;
    expect(gainer.failed).toBe(1);
    expect(gainer.maxDurationMs).toBe(20_000);
  });

  it("tính cache hit rate và tổng request Binance", () => {
    recordSnapshotCache(true);
    recordSnapshotCache(true);
    recordSnapshotCache(true);
    recordSnapshotCache(false);
    recordBinanceRequest(4);
    recordBinanceRequest();

    const stats = snapshotBuildStats();
    expect(stats.cacheHits).toBe(3);
    expect(stats.cacheMisses).toBe(1);
    expect(stats.cacheHitRate).toBe(75);
    expect(stats.binanceRequestsTotal).toBe(5);
    expect(binanceRequestTotal()).toBe(5);
  });

  it("chưa có request nào → hit rate null, không chia cho 0", () => {
    expect(snapshotBuildStats().cacheHitRate).toBeNull();
  });

  it("chỉ giữ 50 build gần nhất", () => {
    for (let index = 0; index < 60; index += 1) {
      recordSnapshotBuild(build({ durationMs: index }));
    }
    const stats = snapshotBuildStats();
    expect(stats.recent).toHaveLength(50);
    expect(stats.recent[0].durationMs).toBe(10);
    expect(stats.builds[0].builds).toBe(50);
  });

  it("reset xoá sạch số liệu", () => {
    recordSnapshotBuild(build());
    recordSnapshotCache(true);
    recordBinanceRequest();
    resetRadarMetrics();
    const stats = snapshotBuildStats();
    expect(stats.recent).toHaveLength(0);
    expect(stats.binanceRequestsTotal).toBe(0);
    expect(stats.cacheHitRate).toBeNull();
  });
});
