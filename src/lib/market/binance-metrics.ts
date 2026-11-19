// RADAR-METRIC — đo tải thật của radar: thời gian build snapshot và số request
// Binance tiêu tốn cho mỗi lần build.
//
// Số liệu nằm trong RAM **từng process**: đủ để trả lời "radar có quá tải không"
// trước khi tối ưu tiếp. Request phục vụ từ cache 60s hoặc từ build đang chạy của
// người khác không tạo build nên không tính vào đây; cache hit được đếm riêng.
//
// Request được gán cho đúng build đã phát ra nó bằng AsyncLocalStorage. Counter
// toàn process không dùng được: gainer/loser/unusual build song song sẽ cùng nhìn
// thấy request của nhau, và cả ba đều phóng đại như nhau.

import { AsyncLocalStorage } from "node:async_hooks";

export interface SnapshotBuildMetric {
  side: string;
  minVolume: number;
  durationMs: number;
  /** Request Binance phát ra trong ngữ cảnh build này. */
  binanceRequests: number;
  rows: number;
  clusters: number;
  failed: boolean;
}

const WINDOW_SIZE = 50;

interface BuildMeter {
  requests: number;
}

const buildMeter = new AsyncLocalStorage<BuildMeter>();

let cacheHits = 0;
let cacheMisses = 0;
const recentBuilds: SnapshotBuildMetric[] = [];

/** Gọi ở mọi request Binance của radar; chỉ tính khi đang trong một build. */
export function recordBinanceRequest(): void {
  const meter = buildMeter.getStore();
  if (meter) meter.requests += 1;
}

/**
 * Đếm ở mức **lượt tra snapshot** (kể cả lượt gọi nội bộ từ detail/cohort), nên
 * hit rate = tỉ lệ lượt tra không phải build, không phải tỉ lệ request của người dùng.
 */
export function recordSnapshotCache(hit: boolean): void {
  if (hit) cacheHits += 1;
  else cacheMisses += 1;
}

/** Ghi nhận 1 lần build (thành công hoặc lỗi) + log 1 dòng để grep trên VPS. */
export function recordSnapshotBuild(metric: SnapshotBuildMetric): void {
  recentBuilds.push(metric);
  if (recentBuilds.length > WINDOW_SIZE) recentBuilds.shift();
  console.info(
    `[RADAR-METRIC] snapshot side=${metric.side} minVolume=${metric.minVolume} ` +
      `durationMs=${metric.durationMs} binanceRequests=${metric.binanceRequests} ` +
      `rows=${metric.rows} clusters=${metric.clusters}${metric.failed ? " failed=1" : ""}`
  );
}

/**
 * Chạy một build snapshot trong ngữ cảnh đếm riêng và ghi metric khi xong.
 *
 * Đây là chỗ duy nhất dựng metric build: request Binance phát ra bên trong `build`
 * (kể cả trong các promise con) được cộng cho build này, không lẫn với build khác.
 */
export function withSnapshotBuild<T>(
  base: { side: string; minVolume: number },
  build: () => Promise<T>,
  measure: (result: T) => { rows: number; clusters: number }
): Promise<T> {
  const meter: BuildMeter = { requests: 0 };
  const startedAt = Date.now();

  return buildMeter.run(meter, build).then(
    (result) => {
      recordSnapshotBuild({
        ...base,
        ...measure(result),
        durationMs: Date.now() - startedAt,
        binanceRequests: meter.requests,
        failed: false,
      });
      return result;
    },
    (error: unknown) => {
      // Build lỗi vẫn phải hiện trong số liệu: lỗi thường là build chậm/timeout.
      recordSnapshotBuild({
        ...base,
        rows: 0,
        clusters: 0,
        durationMs: Date.now() - startedAt,
        binanceRequests: meter.requests,
        failed: true,
      });
      throw error;
    }
  );
}

export interface SnapshotBuildAggregate {
  side: string;
  builds: number;
  failed: number;
  avgDurationMs: number;
  maxDurationMs: number;
  avgBinanceRequests: number;
}

export interface RadarRuntimeMetrics {
  cacheHits: number;
  cacheMisses: number;
  /** null khi chưa có lượt tra nào (chưa đo được). */
  cacheHitRate: number | null;
  builds: SnapshotBuildAggregate[];
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Tổng hợp theo side trong cửa sổ build gần nhất. Timeline từng build không trả
 * ở đây — mỗi build đã có một dòng `[RADAR-METRIC]` trong log.
 */
export function snapshotBuildStats(): RadarRuntimeMetrics {
  const bySide = new Map<string, SnapshotBuildMetric[]>();
  for (const build of recentBuilds) {
    const list = bySide.get(build.side) ?? [];
    list.push(build);
    bySide.set(build.side, list);
  }

  const builds: SnapshotBuildAggregate[] = [...bySide.entries()]
    .map(([side, list]) => {
      const sumDuration = list.reduce((sum, item) => sum + item.durationMs, 0);
      const sumRequests = list.reduce((sum, item) => sum + item.binanceRequests, 0);
      return {
        side,
        builds: list.length,
        failed: list.filter((item) => item.failed).length,
        avgDurationMs: round(sumDuration / list.length),
        maxDurationMs: Math.max(...list.map((item) => item.durationMs)),
        avgBinanceRequests: round(sumRequests / list.length),
      };
    })
    .sort((a, b) => a.side.localeCompare(b.side));

  const lookups = cacheHits + cacheMisses;
  return {
    cacheHits,
    cacheMisses,
    cacheHitRate: lookups > 0 ? round((cacheHits / lookups) * 100) : null,
    builds,
  };
}

/** Xoá số liệu (test). */
export function resetRadarMetrics(): void {
  cacheHits = 0;
  cacheMisses = 0;
  recentBuilds.length = 0;
}
