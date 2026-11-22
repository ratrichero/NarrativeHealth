// BT-11 — kịch bản chi phí thực tế: thuần, không I/O.

import {
  ATR_SLIPPAGE_MAX_BPS,
  computeRealisticCost,
  summarizeRealistic,
  type RealisticCostInput,
} from "../realistic-costs";

const base: RealisticCostInput = {
  direction: "BULLISH",
  entryMid: 100,
  stopLoss: 90,
  tp1: 110,
  atr14: null,
  outcome: "TP1_WIN",
  exitRGross: 1,
  fundingRateSum: null,
  feeBps: 5,
  slippageBps: 2,
};

describe("BT-11 computeRealisticCost", () => {
  test("TP1_WIN: gross giữ nguyên, trừ phí + slippage tĩnh", () => {
    const b = computeRealisticCost(base);
    // round-trip 14bps, leverage = 100/10 = 10 → cost 0.0014 × 10 = 0.014R
    expect(b.partialTp1).toBe(false);
    expect(b.atrSlippageBps).toBe(0);
    expect(b.costR).toBeCloseTo(0.014, 4);
    expect(b.netR).toBe(0.99);
  });

  test("TP2_WIN chốt 50% ở TP1 → gross pha loãng, không thưởng toàn phần", () => {
    const b = computeRealisticCost({ ...base, outcome: "TP2_WIN", exitRGross: 2 });
    // 0.5 × (110-100)/10 + 0.5 × 2 = 1.5
    expect(b.partialTp1).toBe(true);
    expect(b.grossR).toBe(1.5);
    expect(b.netR).toBe(1.49);
  });

  test("SL_LOSS không được thưởng partial TP1 (không biết TP1 có chạm trước SL)", () => {
    const b = computeRealisticCost({ ...base, outcome: "SL_LOSS", exitRGross: -1 });
    expect(b.partialTp1).toBe(false);
    expect(b.grossR).toBe(-1);
    expect(b.netR).toBe(-1.01);
  });

  test("ATR cao → slippage tăng theo, có trần", () => {
    const b = computeRealisticCost({ ...base, atr14: 4 }); // 4% ATR → 20bps/chiều
    expect(b.atrSlippageBps).toBe(20);
    expect(b.netR).toBe(0.95); // 14 + 2×20 = 54bps → 1 − 0.054

    const capped = computeRealisticCost({ ...base, atr14: 100 }); // 100% ATR
    expect(capped.atrSlippageBps).toBe(ATR_SLIPPAGE_MAX_BPS);
  });

  test("funding: LONG trả, SHORT nhận khi rate dương", () => {
    const long = computeRealisticCost({ ...base, fundingRateSum: 0.001 });
    expect(long.fundingR).toBe(0.01); // 0.001 × 10
    expect(long.netR).toBe(0.98); // 1 − (0.014 + 0.01)

    const short = computeRealisticCost({
      ...base,
      direction: "BEARISH",
      fundingRateSum: 0.001,
    });
    expect(short.fundingR).toBe(-0.01);
    expect(short.netR).toBe(1); // 1 − (0.014 − 0.01)
  });

  test("thiếu levels → không định giá được, netR null", () => {
    const b = computeRealisticCost({ ...base, stopLoss: null });
    expect(b.netR).toBeNull();
    expect(b.costR).toBeNull();
    expect(b.grossR).toBe(1);
  });
});

describe("BT-11 summarizeRealistic", () => {
  test("tổng/trung bình và chênh lệch so với net R chuẩn", () => {
    const s = summarizeRealistic([0.86, -1.14], [1, -1], 1);
    expect(s.trades).toBe(2);
    expect(s.totalRNet).toBe(-0.28);
    expect(s.avgRNet).toBe(-0.14);
    expect(s.deltaVsBase).toBe(-0.28);
    expect(s.fundingCovered).toBe(1);
  });

  test("rỗng → avg null, tổng 0", () => {
    expect(summarizeRealistic([], [], 0)).toMatchObject({
      trades: 0,
      avgRNet: null,
      totalRNet: 0,
    });
  });
});
