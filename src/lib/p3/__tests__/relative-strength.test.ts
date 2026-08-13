jest.mock("@/db", () => ({ db: {} }));

import {
  BTC_PERPETUAL_INSTRUMENT,
  calculateAssetReturn,
  calculateRelativeStrengthResult,
  calculateRelativeStrengthWindow,
  classifyRelativeStrength,
  type FuturesCloseObservation,
  type RSConstituentInput,
} from "../relative-strength";
import { createCalculationContext } from "../context";
import { resolveP3Window } from "../windows";

const END = new Date("2026-08-09T00:00:00.000Z");
const prices = (start: number, end: number, startDate = "2026-08-01", endDate = "2026-08-08"): FuturesCloseObservation[] => [{ date: startDate, close: start }, { date: endDate, close: end }];
const coin = (coinId: number, start: number, end: number, marketCapAvailable = true, instrument: string | null = `C${coinId}USDT`): RSConstituentInput => ({ coinId, instrument, marketCapAvailable, prices: prices(start, end) });
const btc = (start = 100, end = 110) => ({ coinId: 99, instrument: BTC_PERPETUAL_INSTRUMENT, prices: prices(start, end) });

function context() {
  const resolved = resolveP3Window("7D", END);
  return createCalculationContext({ narrativeId: 1, calculationMode: "observed", window: "7D", windowStart: resolved.windowStart, windowEnd: END, calculatedAt: new Date("2026-08-09T01:00:00Z"), algorithmKey: "relative-strength", algorithmVersion: "1", constituents: [], sourceAvailability: {} });
}

describe("P3 Relative Strength", () => {
  test("uses individual return formula for positive, negative, and zero", () => {
    expect(calculateAssetReturn("7D", END, prices(100, 120)).value).toBeCloseTo(0.2);
    expect(calculateAssetReturn("7D", END, prices(100, 90)).value).toBeCloseTo(-0.1);
    expect(calculateAssetReturn("7D", END, prices(100, 100)).value).toBe(0);
  });

  test("uses equal-weight arithmetic mean", () => {
    const result = calculateRelativeStrengthWindow("7D", END, [coin(1, 100, 120), coin(2, 100, 110), coin(3, 100, 95), coin(4, 100, 90)], btc(100, 100));
    expect(result.narrativeReturn.value).toBeCloseTo(0.0375);
    expect(result.relativeStrength).toBeCloseTo(0.0375);
    expect(result.validConstituents).toBe(4);
  });

  test("market cap is eligibility only and excluded members do not enter denominator", () => {
    const result = calculateRelativeStrengthWindow("7D", END, [coin(1, 100, 120), coin(2, 100, 110), coin(3, 100, 90), coin(4, 100, 100, false)], btc(100, 100));
    expect(result.validConstituents).toBe(3);
    expect(result.narrativeReturn.value).toBeCloseTo((0.2 + 0.1 - 0.1) / 3);
    expect(result.excludedConstituents).toContainEqual({ coinId: 4, reason: "missing_market_cap" });
  });

  test.each([[0], [1], [2]])("N_valid=%i is unavailable", (count) => {
    const members = [coin(1, 100, 110), coin(2, 100, 110)].slice(0, count);
    expect(calculateRelativeStrengthWindow("7D", END, members, btc()).narrativeReturn).toMatchObject({ value: null, state: "INSUFFICIENT_HISTORY" });
  });

  test("N_valid=3 is calculable", () => {
    expect(calculateRelativeStrengthWindow("7D", END, [coin(1, 100, 110), coin(2, 100, 110), coin(3, 100, 110)], btc(100, 100)).narrativeReturn.state).toBe("VALID");
  });

  test("missing perpetual excludes constituent even when a spot-like instrument is supplied", () => {
    const members = [coin(1, 100, 110), coin(2, 100, 110), coin(3, 100, 110), coin(4, 100, 200, true, null)];
    const result = calculateRelativeStrengthWindow("7D", END, members, btc(100, 100));
    expect(result.validConstituents).toBe(3);
    expect(result.excludedConstituents).toContainEqual({ coinId: 4, reason: "missing_canonical_usdt_perpetual" });
  });

  test("missing or insufficient BTC makes RS unavailable", () => {
    const members = [coin(1, 100, 110), coin(2, 100, 110), coin(3, 100, 110)];
    expect(calculateRelativeStrengthWindow("7D", END, members, { coinId: null, instrument: null, prices: [] })).toMatchObject({ relativeStrength: null, state: "MISSING" });
    expect(calculateRelativeStrengthWindow("7D", END, members, { coinId: 99, instrument: BTC_PERPETUAL_INSTRUMENT, prices: [{ date: "2026-08-08", close: 100 }] })).toMatchObject({ relativeStrength: null, state: "INSUFFICIENT_HISTORY" });
  });

  test("calculates BTC outperformance, underperformance, and equality", () => {
    const members = [coin(1, 100, 110), coin(2, 100, 110), coin(3, 100, 110)];
    expect(calculateRelativeStrengthWindow("7D", END, members, btc(100, 105)).relativeStrength).toBeCloseTo(0.05);
    expect(calculateRelativeStrengthWindow("7D", END, members, btc(100, 120)).relativeStrength).toBeCloseTo(-0.1);
    expect(calculateRelativeStrengthWindow("7D", END, members, btc(100, 110)).relativeStrength).toBeCloseTo(0);
  });

  test("uses a global BTC benchmark even when BTC is not a narrative constituent", () => {
    const members = [coin(11, 100, 110), coin(12, 100, 105), coin(13, 100, 100)];
    const benchmark = { coinId: 987, instrument: BTC_PERPETUAL_INSTRUMENT, prices: prices(100, 102) };

    expect(members.some((member) => member.coinId === benchmark.coinId)).toBe(false);
    expect(calculateRelativeStrengthWindow("7D", END, members, benchmark)).toMatchObject({
      state: "VALID",
      validConstituents: 3,
      btcReturn: { state: "VALID" },
    });
  });

  test.each([
    [0.10, "strong_outperform"], [0.0999, "outperform"], [0.05, "outperform"], [0.0499, "neutral"],
    [-0.0499, "neutral"], [-0.05, "underperform"], [-0.10, "underperform"], [-0.1001, "strong_underperform"],
  ] as const)("classifies %s", (value, expected) => expect(classifyRelativeStrength(value)).toBe(expected));

  test("is deterministic and records approved provenance", () => {
    const members = [coin(1, 100, 110), coin(2, 100, 105), coin(3, 100, 95)];
    const first = calculateRelativeStrengthResult(context(), members, btc(100, 100));
    const second = calculateRelativeStrengthResult(context(), [...members].reverse(), btc(100, 100));
    expect(first).toEqual(second);
    expect(first.provenance).toMatchObject({ weightingMethod: "equal", weightTimestamp: "N/A", marketCapRole: "eligibility_only", minimumValidConstituents: 3 });
    expect(first.metrics.relativeStrength7d.state).toBe("VALID");
  });

  describe("adaptive window semantics (P3-10E.25/26)", () => {
    test("14D MISSING does not block stage when 1D/3D/7D are VALID", () => {
      const members: RSConstituentInput[] = [
        { coinId: 1, instrument: "C1USDT", marketCapAvailable: true, prices: [
          { date: "2026-08-01", close: 100 }, { date: "2026-08-05", close: 105 },
          { date: "2026-08-07", close: 108 }, { date: "2026-08-08", close: 110 },
        ]},
        { coinId: 2, instrument: "C2USDT", marketCapAvailable: true, prices: [
          { date: "2026-08-01", close: 100 }, { date: "2026-08-05", close: 103 },
          { date: "2026-08-07", close: 106 }, { date: "2026-08-08", close: 108 },
        ]},
        { coinId: 3, instrument: "C3USDT", marketCapAvailable: true, prices: [
          { date: "2026-08-01", close: 100 }, { date: "2026-08-05", close: 98 },
          { date: "2026-08-07", close: 96 }, { date: "2026-08-08", close: 95 },
        ]},
      ];
      const btcPrices = [
        { date: "2026-08-01", close: 100 },
        { date: "2026-08-05", close: 105 },
        { date: "2026-08-07", close: 108 },
        { date: "2026-08-08", close: 110 },
      ];
      const result = calculateRelativeStrengthResult(context(), members, { coinId: 99, instrument: BTC_PERPETUAL_INSTRUMENT, prices: btcPrices });
      expect(result.metrics.relativeStrength14d.state).toBe("INSUFFICIENT_HISTORY");
      expect(result.metrics.relativeStrength7d.state).toBe("VALID");
      expect(result.metrics.relativeStrength3d.state).toBe("VALID");
      expect(result.metrics.relativeStrength1d.state).toBe("VALID");
      expect(result.availabilityState).toBe("VALID");
      expect(result.provenance).toMatchObject({
        stageAvailability: "VALID",
        mandatoryWindows: ["1D", "3D", "7D"],
      });
    });

    test("missing mandatory 7D window blocks stage even when 1D/3D/14D are VALID", () => {
      const members: RSConstituentInput[] = [
        { coinId: 1, instrument: "C1USDT", marketCapAvailable: true, prices: [
          { date: "2026-08-05", close: 100 }, { date: "2026-08-07", close: 105 }, { date: "2026-08-08", close: 110 },
        ]},
        { coinId: 2, instrument: "C2USDT", marketCapAvailable: true, prices: [
          { date: "2026-08-05", close: 100 }, { date: "2026-08-07", close: 105 }, { date: "2026-08-08", close: 110 },
        ]},
        { coinId: 3, instrument: "C3USDT", marketCapAvailable: true, prices: [
          { date: "2026-08-05", close: 100 }, { date: "2026-08-07", close: 105 }, { date: "2026-08-08", close: 110 },
        ]},
      ];
      const btcPrices = [
        { date: "2026-08-05", close: 100 },
        { date: "2026-07-25", close: 90 },
        { date: "2026-08-07", close: 105 },
        { date: "2026-08-08", close: 110 },
      ];
      const result = calculateRelativeStrengthResult(context(), members, { coinId: 99, instrument: BTC_PERPETUAL_INSTRUMENT, prices: btcPrices });
      expect(result.metrics.relativeStrength7d.state).toBe("INSUFFICIENT_HISTORY");
      expect(result.availabilityState).toBe("INSUFFICIENT_HISTORY");
    });

    test("uses exact UTC window boundaries", () => {
      expect(() => calculateAssetReturn("7D", new Date("2026-08-09T07:00:00Z"), prices(100, 110))).toThrow("UTC day boundary");
    });
  });
});
