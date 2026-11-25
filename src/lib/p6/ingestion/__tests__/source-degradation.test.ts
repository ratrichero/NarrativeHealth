import {
  annotateDerivativeDetail,
  appendDegradedSource,
  buildDerivativeDegradedMessage,
  DEGRADED_SOURCE_MARKER,
  DERIVATIVE_DEGRADED_MIN_COVERAGE_VAR,
  evaluateDerivativeCoverage,
  resolveDerivativeMinCoverage,
  shouldSkipPublishing,
  summarizeCoverage,
  type DerivativeCoinOutcome,
} from "../source-degradation";

function coin(symbol: string, futuresConfigured: boolean, futuresOk: boolean): DerivativeCoinOutcome {
  return { symbol, futuresConfigured, futuresOk };
}

describe("resolveDerivativeMinCoverage", () => {
  it("mặc định 0.5, kẹp 0–1, bỏ giá trị không hợp lệ", () => {
    expect(resolveDerivativeMinCoverage({})).toBe(0.5);
    expect(resolveDerivativeMinCoverage({ [DERIVATIVE_DEGRADED_MIN_COVERAGE_VAR]: "abc" })).toBe(0.5);
    expect(resolveDerivativeMinCoverage({ [DERIVATIVE_DEGRADED_MIN_COVERAGE_VAR]: "0.8" })).toBe(0.8);
    expect(resolveDerivativeMinCoverage({ [DERIVATIVE_DEGRADED_MIN_COVERAGE_VAR]: "-1" })).toBe(0);
    expect(resolveDerivativeMinCoverage({ [DERIVATIVE_DEGRADED_MIN_COVERAGE_VAR]: "5" })).toBe(1);
  });
});

describe("evaluateDerivativeCoverage", () => {
  it("tất cả coin no_futures dù có futures symbol → blocked, chặn publish", () => {
    const coins = Array.from({ length: 40 }, (_, i) => coin(`C${i}`, true, false));
    const coverage = evaluateDerivativeCoverage(coins, { minCoverage: 0.5 });

    expect(coverage.expected).toBe(40);
    expect(coverage.ok).toBe(0);
    expect(coverage.missing).toBe(40);
    expect(coverage.coverage).toBe(0);
    expect(coverage.degraded).toBe(true);
    expect(coverage.blocked).toBe(true);
    expect(coverage.reason).toBe("futures_unavailable");
    expect(coverage.missingSymbols).toHaveLength(40);
    expect(shouldSkipPublishing(coverage)).toBe(true);
  });

  it("coverage dưới ngưỡng → degraded nhưng không chặn publish", () => {
    const coins = [
      coin("A", true, true),
      coin("B", true, false),
      coin("C", true, false),
      coin("D", true, false),
    ];
    const coverage = evaluateDerivativeCoverage(coins, { minCoverage: 0.5 });

    expect(coverage.coverage).toBe(0.25);
    expect(coverage.degraded).toBe(true);
    expect(coverage.blocked).toBe(false);
    expect(coverage.reason).toBe("futures_partial");
    expect(coverage.missingSymbols).toEqual(["B", "C", "D"]);
    expect(shouldSkipPublishing(coverage)).toBe(false);
  });

  it("coverage đủ ngưỡng → không degraded", () => {
    const coins = [coin("A", true, true), coin("B", true, true), coin("C", true, false)];
    const coverage = evaluateDerivativeCoverage(coins, { minCoverage: 0.5 });

    expect(coverage.coverage).toBe(0.667);
    expect(coverage.degraded).toBe(false);
    expect(coverage.reason).toBeNull();
  });

  it("coin spot-only không bị tính là thiếu futures", () => {
    const coins = [coin("SPOT1", false, false), coin("SPOT2", false, false), coin("FUT", true, true)];
    const coverage = evaluateDerivativeCoverage(coins, { minCoverage: 0.5 });

    expect(coverage.expected).toBe(1);
    expect(coverage.degraded).toBe(false);
    expect(coverage.missingSymbols).toEqual([]);
  });

  it("không coin nào cấu hình futures → không degraded, coverage 1", () => {
    const coverage = evaluateDerivativeCoverage([coin("A", false, false)], { minCoverage: 0.5 });

    expect(coverage.expected).toBe(0);
    expect(coverage.coverage).toBe(1);
    expect(coverage.degraded).toBe(false);
    expect(coverage.blocked).toBe(false);
    expect(shouldSkipPublishing(coverage)).toBe(false);
  });
});

describe("cờ degraded trên row feature", () => {
  it("annotate giữ nguyên detail và thêm degraded", () => {
    const detail = { oi_current: null, no_futures: true, oi_component: 50 };
    expect(annotateDerivativeDetail(detail, true)).toEqual({
      oi_current: null,
      no_futures: true,
      oi_component: 50,
      degraded: true,
    });
    expect(annotateDerivativeDetail(detail, false).degraded).toBe(false);
  });

  it("append marker một lần, bỏ marker cũ khi không còn degraded", () => {
    expect(appendDegradedSource(["binance_spot"], true)).toEqual([
      "binance_spot",
      DEGRADED_SOURCE_MARKER,
    ]);
    expect(appendDegradedSource(["binance_spot", DEGRADED_SOURCE_MARKER], true)).toEqual([
      "binance_spot",
      DEGRADED_SOURCE_MARKER,
    ]);
    expect(appendDegradedSource(["binance_spot", DEGRADED_SOURCE_MARKER], false)).toEqual([
      "binance_spot",
    ]);
  });
});

describe("thông điệp và bản ghi log", () => {
  it("nêu số coin có dữ liệu và danh sách thiếu", () => {
    const coverage = evaluateDerivativeCoverage(
      [coin("AAA", true, false), coin("BBB", true, false)],
      { minCoverage: 0.5 }
    );
    const message = buildDerivativeDegradedMessage(coverage);
    expect(message).toContain("0/2 coin có dữ liệu");
    expect(message).toContain("AAA");
    expect(message).toContain("BBB");
    expect(message).toContain("không coin nào lấy được OI/funding");
  });

  it("không degraded thì không có message", () => {
    const coverage = evaluateDerivativeCoverage([coin("A", true, true)]);
    expect(buildDerivativeDegradedMessage(coverage)).toBe("");
  });

  it("summarizeCoverage là object thuần để ghi jsonb", () => {
    const coverage = evaluateDerivativeCoverage([coin("A", true, false)], { minCoverage: 0.5 });
    const summary = summarizeCoverage(coverage);
    expect(summary.derivative).toMatchObject({
      expected: 1,
      ok: 0,
      coverage: 0,
      degraded: true,
      blocked: true,
      reason: "futures_unavailable",
    });
  });
});
