import { describe, expect, it } from "@jest/globals";
import {
  CALIBRATION_MIN_N,
  buildCalibrationShadow,
} from "@/lib/market/bias-calibration";

const cell = (bias: string, horizon: string, n: number, wins: number) => ({
  bias,
  horizon,
  n,
  wins,
  avgEdgePct: null,
  avgRelativePct: null,
});

describe("bias calibration — shadow", () => {
  it("nửa sau tệ hơn nửa đầu quá ngưỡng → drifted, có delta", () => {
    const shadow = buildCalibrationShadow(
      [cell("continuation", "24h", 40, 28)], // 70%
      [cell("continuation", "24h", 40, 20)] // 50%
    );
    expect(shadow.mode).toBe("shadow");
    expect(shadow.status).toBe("drifted");
    expect(shadow.driftedCells).toBe(1);
    expect(shadow.cells[0].expectedHitRate).toBe(70);
    expect(shadow.cells[0].realizedHitRate).toBe(50);
    expect(shadow.cells[0].deltaPct).toBe(-20);
    expect(shadow.meanAbsDeltaPct).toBe(20);
  });

  it("lệch nhỏ trong ngưỡng → calibrated", () => {
    const shadow = buildCalibrationShadow(
      [cell("breakout", "4h", 30, 15)],
      [cell("breakout", "4h", 30, 17)]
    );
    expect(shadow.status).toBe("calibrated");
    expect(shadow.cells[0].deltaPct).toBeCloseTo(6.7, 1);
  });

  it("một phía dưới ngưỡng mẫu → không đánh giá, không bịa delta", () => {
    const shadow = buildCalibrationShadow(
      [cell("exhaustion", "1h", CALIBRATION_MIN_N - 1, 5)],
      [cell("exhaustion", "1h", 50, 30)]
    );
    expect(shadow.cells[0].evaluated).toBe(false);
    expect(shadow.cells[0].deltaPct).toBeNull();
    expect(shadow.status).toBe("insufficient");
    expect(shadow.meanAbsDeltaPct).toBeNull();
  });

  it("ô chỉ có ở một phía vẫn hiện nhưng chưa đánh giá", () => {
    const shadow = buildCalibrationShadow([], [cell("flush-bounce", "7d", 25, 10)]);
    expect(shadow.cells).toHaveLength(1);
    expect(shadow.cells[0].expectedHitRate).toBeNull();
    expect(shadow.cells[0].evaluated).toBe(false);
  });

  it("meanAbsDelta có trọng số theo mẫu nửa sau", () => {
    const shadow = buildCalibrationShadow(
      [
        cell("continuation", "1h", 20, 10),
        cell("continuation", "24h", 20, 10),
      ],
      [
        cell("continuation", "1h", 20, 12), // +10
        cell("continuation", "24h", 60, 30), // 0
      ]
    );
    expect(shadow.meanAbsDeltaPct).toBeCloseTo((10 * 20 + 0 * 60) / 80, 1);
  });

  it("ngưỡng lệch chỉnh được qua options", () => {
    const shadow = buildCalibrationShadow(
      [cell("continuation", "24h", 40, 28)],
      [cell("continuation", "24h", 40, 24)], // -10
      { maxGapPct: 5 }
    );
    expect(shadow.cells[0].drifted).toBe(true);
  });
});
