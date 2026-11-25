/**
 * DATA-QUALITY GATE — nguồn derivative suy giảm rõ ràng.
 *
 * Bối cảnh: khi fetch futures metrics thất bại, feature engine ghi
 * `derivative_score = 50` với `no_futures: true` — đúng như một coin "thật sự
 * không có futures". Vì vậy một sự cố nguồn (Binance 451, mất OI/funding toàn
 * bộ) trông y hệt dữ liệu trung tính hợp lệ và vẫn được dùng để tính health
 * score, recommendation và bài đăng Square.
 *
 * Gate này so "số coin được cấu hình futures symbol" với "số coin thực sự lấy
 * được dữ liệu futures" rồi quyết định:
 *   • `degraded` — coverage dưới ngưỡng (`DERIVATIVE_DEGRADED_MIN_COVERAGE`,
 *     mặc định 0.5);
 *   • `blocked`  — không coin nào có dữ liệu dù có coin được cấu hình futures,
 *     tức nguồn derivative chết hoàn toàn → chặn đường publish.
 *
 * Logic thuần, không DB/mạng, để test được và dùng lại ở route refresh.
 */

export const DERIVATIVE_DEGRADED_MIN_COVERAGE_VAR = "DERIVATIVE_DEGRADED_MIN_COVERAGE";
export const DERIVATIVE_DEGRADED_MIN_COVERAGE_DEFAULT = 0.5;
export const DEGRADED_SOURCE_MARKER = "binance_futures:degraded";

export type EnvLike = Record<string, string | undefined>;

export interface DerivativeCoinOutcome {
  symbol: string;
  /** Coin có `binance_futures_symbol` (đồng nghĩa exchangeInfo có futures). */
  futuresConfigured: boolean;
  /** Coin thực sự lấy được OI/funding trong lượt này. */
  futuresOk: boolean;
}

export type DerivativeDegradationReason = "futures_unavailable" | "futures_partial";

export interface DerivativeCoverage {
  /** Số coin được kỳ vọng có futures data. */
  expected: number;
  /** Số coin thực sự có futures data. */
  ok: number;
  missing: number;
  /** ok / expected (1 khi không kỳ vọng coin nào). */
  coverage: number;
  threshold: number;
  degraded: boolean;
  /** Nguồn chết hoàn toàn (coverage = 0) — chặn publish. */
  blocked: boolean;
  reason: DerivativeDegradationReason | null;
  missingSymbols: string[];
}

/** Ngưỡng coverage tối thiểu, đọc env và kẹp 0–1; mặc định 0.5. */
export function resolveDerivativeMinCoverage(env: EnvLike = process.env): number {
  const raw = env[DERIVATIVE_DEGRADED_MIN_COVERAGE_VAR];
  if (raw == null || String(raw).trim() === "") return DERIVATIVE_DEGRADED_MIN_COVERAGE_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DERIVATIVE_DEGRADED_MIN_COVERAGE_DEFAULT;
  return Math.min(1, Math.max(0, parsed));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Đánh giá coverage derivative của một lượt refresh.
 *
 * `expected` chỉ tính coin có cấu hình futures symbol — coin spot-only không
 * bao giờ bị coi là "thiếu dữ liệu", nên không tạo false positive.
 */
export function evaluateDerivativeCoverage(
  coins: DerivativeCoinOutcome[],
  options: { minCoverage?: number } = {}
): DerivativeCoverage {
  const threshold = options.minCoverage ?? resolveDerivativeMinCoverage();

  const expectedCoins = coins.filter((coin) => coin.futuresConfigured);
  const okCoins = expectedCoins.filter((coin) => coin.futuresOk);
  const missingCoins = expectedCoins.filter((coin) => !coin.futuresOk);

  const expected = expectedCoins.length;
  const ok = okCoins.length;
  const missing = missingCoins.length;
  const coverage = expected === 0 ? 1 : round(ok / expected);

  if (expected === 0) {
    return {
      expected,
      ok,
      missing,
      coverage,
      threshold,
      degraded: false,
      blocked: false,
      reason: null,
      missingSymbols: [],
    };
  }

  const blocked = ok === 0;
  const degraded = blocked || coverage < threshold;

  return {
    expected,
    ok,
    missing,
    coverage,
    threshold,
    degraded,
    blocked,
    reason: blocked ? "futures_unavailable" : degraded ? "futures_partial" : null,
    missingSymbols: missingCoins.map((coin) => coin.symbol).sort(),
  };
}

/** Chỉ chặn publish khi nguồn derivative chết hoàn toàn (không đoán được gì). */
export function shouldSkipPublishing(coverage: DerivativeCoverage): boolean {
  return coverage.blocked;
}

export function buildDerivativeDegradedMessage(coverage: DerivativeCoverage): string {
  if (!coverage.degraded) return "";
  const reason =
    coverage.reason === "futures_unavailable"
      ? "không coin nào lấy được OI/funding dù có futures symbol"
      : `coverage ${Math.round(coverage.coverage * 100)}% dưới ngưỡng ${Math.round(coverage.threshold * 100)}%`;

  const symbols =
    coverage.missingSymbols.length > 0
      ? ` Thiếu: ${coverage.missingSymbols.slice(0, 10).join(", ")}${
          coverage.missingSymbols.length > 10 ? ` (+${coverage.missingSymbols.length - 10})` : ""
        }.`
      : "";

  return `Derivative source degraded — ${reason} (${coverage.ok}/${coverage.expected} coin có dữ liệu).${symbols}`;
}

/**
 * Gắn cờ vào `features.derivative_detail` (jsonb) để row không còn trông như
 * "trung tính hợp lệ". Luôn ghi `degraded` (kể cả false) để phân biệt rõ.
 */
export function annotateDerivativeDetail<T extends object>(
  detail: T,
  degraded: boolean
): T & { degraded: boolean } {
  return { ...detail, degraded };
}

/** Thêm marker vào `features.missing_sources` (không nhân đôi). */
export function appendDegradedSource(sources: string[], degraded: boolean): string[] {
  const base = sources.filter((source) => source !== DEGRADED_SOURCE_MARKER);
  return degraded ? [...base, DEGRADED_SOURCE_MARKER] : base;
}

/** Bản rút gọn để ghi `scheduler_logs.details.dataQuality`. */
export function summarizeCoverage(coverage: DerivativeCoverage): Record<string, unknown> {
  return {
    derivative: {
      expected: coverage.expected,
      ok: coverage.ok,
      coverage: coverage.coverage,
      threshold: coverage.threshold,
      degraded: coverage.degraded,
      blocked: coverage.blocked,
      reason: coverage.reason,
      missingSymbols: coverage.missingSymbols.slice(0, 20),
    },
  };
}
