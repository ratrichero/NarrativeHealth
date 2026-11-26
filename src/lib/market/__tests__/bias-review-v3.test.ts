import { describe, expect, it } from "@jest/globals";
import {
  BIAS_REVIEW_CHANGELOG,
  BIAS_REVIEW_METRICS_VERSION,
  COUNTER_FORECAST_MIN_N,
  buildBiasReviewRows,
} from "@/lib/market/bias-review";

const aggregate = (
  bias: string,
  horizon: string,
  n: number,
  wins: number,
  avgEdgePct: number | null = 0
) => ({ bias, horizon, n, wins, avgEdgePct, avgRelativePct: null });

describe("bias review v3 — cờ phản dự báo", () => {
  it("CI trên dưới 50% với đủ mẫu → counterForecast", () => {
    const [row] = buildBiasReviewRows([aggregate("continuation", "24h", 25, 5, -1)]);
    const cell = row.horizons[0];
    expect(cell.hitRate).toBe(20);
    expect(cell.reliable).toBe(true);
    expect(cell.ciHigh).toBeLessThan(50);
    expect(cell.counterForecast).toBe(true);
    expect(cell.flagReason).toBe("ci-below-coin-flip");
  });

  it("hit-rate thấp nhưng CI rộng → không gắn cờ", () => {
    const [row] = buildBiasReviewRows([aggregate("breakdown", "1h", 5, 1)]);
    const cell = row.horizons[0];
    expect(cell.hitRate).toBe(20);
    expect(cell.reliable).toBe(false);
    expect(cell.counterForecast).toBe(false);
    expect(cell.flagReason).toBe("insufficient-sample");
  });

  it("hit-rate quanh 50% → không cờ", () => {
    const [row] = buildBiasReviewRows([aggregate("breakout", "4h", 40, 20)]);
    const cell = row.horizons[0];
    expect(cell.ciHigh).toBeGreaterThan(50);
    expect(cell.counterForecast).toBe(false);
    expect(cell.flagReason).toBeNull();
  });

  it("ngưỡng mẫu là hằng số công khai", () => {
    expect(COUNTER_FORECAST_MIN_N).toBe(20);
  });
});

describe("bias review v3 — alert precision nằm trong rows", () => {
  it("ô có aggregate alert → gắn precision với hit-rate + CI riêng", () => {
    const [row] = buildBiasReviewRows(
      [aggregate("continuation", "24h", 40, 24)],
      [aggregate("continuation", "24h", 12, 9, 2.5)]
    );
    expect(row.horizons[0].alertPrecision).toMatchObject({
      n: 12,
      wins: 9,
      hitRate: 75,
      avgEdgePct: 2.5,
    });
    expect(row.horizons[0].alertPrecision?.ciLow).not.toBeNull();
    expect(row.horizons[0].alertPrecision?.ciHigh).not.toBeNull();
    // Precision không thay số của cả ô.
    expect(row.horizons[0].n).toBe(40);
    expect(row.horizons[0].hitRate).toBe(60);
  });

  it("ô không có outcome nào đủ ngưỡng alert → null, không phải 0%", () => {
    const [row] = buildBiasReviewRows([aggregate("exhaustion", "4h", 8, 4)]);
    expect(row.horizons[0].alertPrecision).toBeNull();
  });

  it("aggregate alert của ô khác không bị gắn nhầm", () => {
    const [row] = buildBiasReviewRows(
      [aggregate("breakout", "1h", 30, 18)],
      [aggregate("breakout", "24h", 10, 7)]
    );
    expect(row.horizons[0].alertPrecision).toBeNull();
  });
});

describe("bias review v3 — version/changelog", () => {
  it("version hiện tại có mặt trong changelog, mới nhất trước", () => {
    expect(BIAS_REVIEW_CHANGELOG[0].version).toBe(BIAS_REVIEW_METRICS_VERSION);
    expect(BIAS_REVIEW_CHANGELOG[0].version).toBe("bias-review-v3");
    expect(BIAS_REVIEW_CHANGELOG[0].note).toContain("precision");
  });

  it("lịch sử v2 vẫn còn để hai con số khác nghĩa không bị so với nhau", () => {
    expect(BIAS_REVIEW_CHANGELOG.map((entry) => entry.version)).toContain("bias-review-v2");
  });
});
