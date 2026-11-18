import { buildSetup } from "@/lib/market/setup";

describe("buildSetup", () => {
  it("long: entry quanh giá, TP trên, SL dưới, R:R 1", () => {
    const setup = buildSetup("BULLISH", 100, 2);
    expect(setup.entryLow).toBeCloseTo(99);
    expect(setup.entryHigh).toBeCloseTo(101);
    expect(setup.tp1).toBeGreaterThan(setup.entryHigh);
    expect(setup.tp2).toBeGreaterThan(setup.tp1);
    expect(setup.stopLoss).toBeLessThan(setup.entryLow);
    expect(setup.riskRewardRatio).toBe(1);
    expect(setup.direction).toBe("BULLISH");
  });

  it("short: đối xứng hoàn toàn", () => {
    const setup = buildSetup("BEARISH", 100, 2);
    expect(setup.entryLow).toBeCloseTo(99);
    expect(setup.entryHigh).toBeCloseTo(101);
    expect(setup.tp1).toBeLessThan(setup.entryLow);
    expect(setup.tp2).toBeLessThan(setup.tp1);
    expect(setup.stopLoss).toBeGreaterThan(setup.entryHigh);
    expect(setup.riskRewardRatio).toBe(1);
  });
});
