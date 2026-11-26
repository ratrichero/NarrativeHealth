import { describe, expect, it } from "@jest/globals";

import {
  buildBiasReviewRows,
  buildTransitionMatrix,
  clampReviewDays,
  MAX_REVIEW_DAYS,
} from "@/lib/market/bias-review";

describe("bias review — bảng tổng hợp", () => {
  it("gộp bias × horizon, tính hit-rate và return theo chiều nhãn", () => {
    const rows = buildBiasReviewRows([
      { bias: "continuation", horizon: "1h", n: 10, wins: 6, avgEdgePct: 1.24, avgRelativePct: 0.4 },
      { bias: "continuation", horizon: "24h", n: 4, wins: 3, avgEdgePct: 8.5, avgRelativePct: 2.1 },
      { bias: "exhaustion", horizon: "1h", n: 8, wins: 3, avgEdgePct: -2.26, avgRelativePct: -1 },
    ]);

    expect(rows.map((row) => row.bias)).toEqual(["continuation", "exhaustion"]);
    const continuation = rows[0];
    expect(continuation.label).toBe("Tiếp diễn tăng");
    expect(continuation.n).toBe(10);
    // Horizon giữ đúng thứ tự chuẩn (1h trước 24h) dù input đảo.
    expect(continuation.horizons.map((cell) => cell.horizon)).toEqual(["1h", "24h"]);
    expect(continuation.horizons[0].hitRate).toBe(60);
    expect(continuation.horizons[1].avgEdgePct).toBe(8.5);
    expect(rows[1].horizons[0].hitRate).toBe(37.5);
  });

  it("bỏ horizon lạ và dòng không có mẫu", () => {
    const rows = buildBiasReviewRows([
      { bias: "breakdown", horizon: "12h", n: 5, wins: 2, avgEdgePct: 1, avgRelativePct: 0 },
      { bias: "breakdown", horizon: "4h", n: 0, wins: 0, avgEdgePct: null, avgRelativePct: null },
    ]);
    expect(rows).toEqual([]);
  });
});

describe("bias review — ma trận chuyển nhãn", () => {
  it("tách lật khỏi giữ nhãn và tính callout kiệt sức → tiếp diễn", () => {
    const matrix = buildTransitionMatrix([
      { fromBias: "exhaustion", toBias: "continuation", n: 5 },
      { fromBias: "exhaustion", toBias: "exhaustion", n: 4 },
      { fromBias: "continuation", toBias: "continuation", n: 7 },
    ]);

    const exhaustion = matrix.rows.find((row) => row.from === "exhaustion");
    expect(exhaustion?.total).toBe(9);
    expect(exhaustion?.flips).toBe(5);
    expect(exhaustion?.flipRate).toBe(55.6);
    expect(exhaustion?.byTo.map((cell) => cell.to)).toEqual(["continuation", "exhaustion"]);

    const continuation = matrix.rows.find((row) => row.from === "continuation");
    expect(continuation?.flips).toBe(0);
    expect(continuation?.flipRate).toBe(0);

    expect(matrix.afterExhaustion).toEqual({
      total: 9,
      toContinuation: 5,
      toContinuationRate: 55.6,
    });
    expect(matrix.columns.map((column) => column.bias)).toEqual(["continuation", "exhaustion"]);
  });

  it("không có dữ liệu thì callout rỗng thay vì chia cho 0", () => {
    const matrix = buildTransitionMatrix([]);
    expect(matrix.rows).toEqual([]);
    expect(matrix.afterExhaustion).toEqual({
      total: 0,
      toContinuation: 0,
      toContinuationRate: null,
    });
  });
});

describe("clampReviewDays", () => {
  it("kẹp cửa sổ 1..MAX và fallback khi rác", () => {
    expect(clampReviewDays("30")).toBe(30);
    expect(clampReviewDays("0")).toBe(30);
    expect(clampReviewDays("abc")).toBe(30);
    expect(clampReviewDays("999")).toBe(MAX_REVIEW_DAYS);
    expect(clampReviewDays(2.7)).toBe(2);
  });
});
