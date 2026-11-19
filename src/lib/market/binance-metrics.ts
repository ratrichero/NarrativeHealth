// RADAR-METRIC — đo tải thật của radar: thời gian build snapshot và số request
// Binance tiêu tốn cho mỗi lần build.
//
// Số liệu nằm trong RAM **từng process** (không phải metrics hệ thống): đủ để trả
// lời "radar có quá tải không" trước khi tối ưu tiếp. Build là phần đắt duy nhất
// (ticker + enrich klines/OI/funding cho ~30 coin); request phục vụ từ cache 60s
// không tạo build nên không tính vào đây.

export interface SnapshotBuildMetric {
  side: string;
  minVolume: number;
  durationMs: number;
  /** Số request Binance trong khoảng build (delta của counter toàn process). */
  binanceRequests: number;
  rows: number;
  clusters: number;
  failed: boolean;
  at: string;
}

const RECENT_LIMIT = 50;

let binanceRequests = 0;
let cacheHits = 0;
let cacheMisses = 0;
const recentBuilds: SnapshotBuildMetric[] = [];

/** Gọi ở mọi request Binance của radar (kể cả request lấy từ cache nội bộ). */
export function recordBinanceRequest(count = 1): void {
  binanceRequests += Math.max(0, Math.floor(count));
}

/** Tổng request Binance đã phát ra từ process này. */
export function binanceRequestTotal(): number {
  return binanceRequests;
}

export function recordSnapshotCache(hit: boolean): void {
  if (hit) cacheHits += 1;
  else cacheMisses += 1;
}

/** Ghi nhận 1 lần build (thành công hoặc lỗi) + log 1 dòng để grep trên VPS. */
export function recordSnapshotBuild(metric: SnapshotBuildMetric): void {
  recentBuilds.push(metric);
  if (recentBuilds.length > RECENT_LIMIT) recentBuilds.shift();
  console.info(
    `[RADAR-METRIC] snapshot side=${metric.side} minVolume=${metric.minVolume} ` +
      `durationMs=${metric.durationMs} binanceRequests=${metric.binanceRequests} ` +
      `rows=${metric.rows} clusters=${metric.clusters}${metric.failed ? " failed=1" : ""}`
  );
}

export interface SnapshotBuildAggregate {
  side: string;
  builds: number;
  failed: number;
  avgDurationMs: number;
  maxDurationMs: number;
  avgBinanceRequests: number;
  lastDurationMs: number | null;
  lastAt: string | null;
}

export interface RadarRuntimeMetrics {
  binanceRequestsTotal: number;
  cacheHits: number;
  cacheMisses: number;
  /** null khi chưa có request nào (chưa đo được). */
  cacheHitRate: number | null;
  builds: SnapshotBuildAggregate[];
  recent: SnapshotBuildMetric[];
}

const round = (value: number) => Math.round(value * 10) / 10;

/** Tổng hợp theo side từ tối đa 50 build gần nhất. */
export function snapshotBuildStats(): RadarRuntimeMetrics {
  const bySide = new Map<string, SnapshotBuildMetric[]>();
  for (const build of recentBuilds) {
    const list = bySide.get(build.side) ?? [];
    list.push(build);
    bySide.set(build.side, list);
  }

  const builds: SnapshotBuildAggregate[] = [...bySide.entries()]
    .map(([side, list]) => {
      const last = list[list.length - 1];
      const sumDuration = list.reduce((sum, item) => sum + item.durationMs, 0);
      const sumRequests = list.reduce((sum, item) => sum + item.binanceRequests, 0);
      return {
        side,
        builds: list.length,
        failed: list.filter((item) => item.failed).length,
        avgDurationMs: round(sumDuration / list.length),
        maxDurationMs: Math.max(...list.map((item) => item.durationMs)),
        avgBinanceRequests: round(sumRequests / list.length),
        lastDurationMs: last ? last.durationMs : null,
        lastAt: last ? last.at : null,
      };
    })
    .sort((a, b) => a.side.localeCompare(b.side));

  const lookups = cacheHits + cacheMisses;
  return {
    binanceRequestsTotal: binanceRequests,
    cacheHits,
    cacheMisses,
    cacheHitRate: lookups > 0 ? round((cacheHits / lookups) * 100) : null,
    builds,
    recent: [...recentBuilds],
  };
}

/** Xoá số liệu (test hoặc sau khi đổi cấu hình để đo lại từ đầu). */
export function resetRadarMetrics(): void {
  binanceRequests = 0;
  cacheHits = 0;
  cacheMisses = 0;
  recentBuilds.length = 0;
}
