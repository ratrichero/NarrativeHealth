import { buildSetup } from "@/lib/market/setup";

describe("buildSetup — preset legacy (hành vi cũ của chat tools)", () => {
  it("long: 1.5/1.5/3 ATR, R:R 1", () => {
    const setup = buildSetup("BULLISH", 100, 2);
    expect(setup.entryLow).toBeCloseTo(99);
    expect(setup.entryHigh).toBeCloseTo(101);
    expect(setup.tp1).toBeCloseTo(103);
    expect(setup.tp2).toBeCloseTo(106);
    expect(setup.stopLoss).toBeCloseTo(97);
    expect(setup.riskRewardRatio).toBe(1);
  });

  it("short: đối xứng hoàn toàn", () => {
    const setup = buildSetup("BEARISH", 100, 2);
    expect(setup.entryLow).toBeCloseTo(99);
    expect(setup.entryHigh).toBeCloseTo(101);
    expect(setup.tp1).toBeCloseTo(97);
    expect(setup.tp2).toBeCloseTo(94);
    expect(setup.stopLoss).toBeCloseTo(103);
    expect(setup.riskRewardRatio).toBe(1);
  });
});

describe("buildSetup — preset swing4h (radar, ATR 4h)", () => {
  it("long: entry là vùng hồi 0.25–0.75 ATR dưới giá, không chứa giá", () => {
    const setup = buildSetup("BULLISH", 100, 2, "swing4h");
    expect(setup.entryLow).toBeCloseTo(98.5);
    expect(setup.entryHigh).toBeCloseTo(99.5);
    expect(setup.entryHigh).toBeLessThan(100);
    expect(setup.tp1).toBeCloseTo(103);
    expect(setup.tp2).toBeCloseTo(107);
    expect(setup.stopLoss).toBeCloseTo(97);
    expect(setup.riskRewardRatio).toBe(2);
  });

  it("short: entry hồi lên trên giá, TP/SL đối xứng", () => {
    const setup = buildSetup("BEARISH", 100, 2, "swing4h");
    expect(setup.entryLow).toBeCloseTo(100.5);
    expect(setup.entryHigh).toBeCloseTo(101.5);
    expect(setup.tp1).toBeCloseTo(97);
    expect(setup.tp2).toBeCloseTo(93);
    expect(setup.stopLoss).toBeCloseTo(103);
    expect(setup.riskRewardRatio).toBe(2);
  });
});

describe("buildSetup — ATR không hợp lệ", () => {
  it("không tạo mức giá NaN và R:R null", () => {
    const setup = buildSetup("BULLISH", 100, 0);
    expect(Number.isFinite(setup.entryLow)).toBe(true);
    expect(setup.riskRewardRatio).toBeNull();
  });
});
