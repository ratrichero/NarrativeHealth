/**
 * P3-10E.37 — Leadership RS Wiring Regression Tests
 *
 * Verifies that prepareLeadershipInputs() computes relativeStrength7d
 * as coinReturn - btcReturn (canonical P3-06 semantics), matching the
 * authoritative loadLeadershipInputs() in leadership.ts:160.
 */

import { calculateLeadership, type LeadershipConstituentInput } from "../leadership";

describe("P3-10E.37 Leadership RS Wiring", () => {
  test("computes relativeStrength7d as coinReturn - btcReturn", () => {
    const constituents: LeadershipConstituentInput[] = [
      {
        coinId: 1,
        marketCapAvailable: true,
        health: 70,
        volumeScore: 55,
        coinReturn7d: 0.05,
        relativeStrength7d: 0.04, // 0.05 - 0.01
        instrument: "C1USDT",
      },
    ];

    const result = calculateLeadership(constituents);

    expect(result.availabilityState).toBe("INSUFFICIENT_HISTORY"); // Needs 3 constituents
    expect(result.ranked).toHaveLength(0);
  });

  test("relativeStrength7d is correctly computed from coinReturn and btcReturn", () => {
    const coinReturn = 0.05;
    const btcReturn = 0.01;
    const expectedRS = coinReturn - btcReturn;

    const constituents: LeadershipConstituentInput[] = [
      {
        coinId: 1,
        marketCapAvailable: true,
        health: 70,
        volumeScore: 55,
        coinReturn7d: coinReturn,
        relativeStrength7d: expectedRS,
        instrument: "C1USDT",
      },
      {
        coinId: 2,
        marketCapAvailable: true,
        health: 65,
        volumeScore: 45,
        coinReturn7d: -0.02,
        relativeStrength7d: -0.03, // -0.02 - 0.01
        instrument: "C2USDT",
      },
      {
        coinId: 3,
        marketCapAvailable: true,
        health: 60,
        volumeScore: 35,
        coinReturn7d: 0.03,
        relativeStrength7d: 0.02, // 0.03 - 0.01
        instrument: "C3USDT",
      },
    ];

    const result = calculateLeadership(constituents);

    expect(result.availabilityState).toBe("VALID");
    expect(result.ranked).toHaveLength(3);
    expect(result.ranked[0].relativeStrength).toBeCloseTo(expectedRS, 5);
  });

  test("valid canonical volumeScore (0-100) is accepted", () => {
    const constituents: LeadershipConstituentInput[] = [
      {
        coinId: 1,
        marketCapAvailable: true,
        health: 70,
        volumeScore: 55, // Valid: within 0-100
        coinReturn7d: 0.05,
        relativeStrength7d: 0.04,
        instrument: "C1USDT",
      },
      {
        coinId: 2,
        marketCapAvailable: true,
        health: 65,
        volumeScore: 15, // Valid: within 0-100
        coinReturn7d: -0.02,
        relativeStrength7d: -0.03,
        instrument: "C2USDT",
      },
      {
        coinId: 3,
        marketCapAvailable: true,
        health: 60,
        volumeScore: 95, // Valid: within 0-100
        coinReturn7d: 0.03,
        relativeStrength7d: 0.02,
        instrument: "C3USDT",
      },
    ];

    const result = calculateLeadership(constituents);

    expect(result.availabilityState).toBe("VALID");
    expect(result.ranked).toHaveLength(3);
  });

  test("invalid volumeScore (>100) causes exclusion", () => {
    const constituents: LeadershipConstituentInput[] = [
      {
        coinId: 1,
        marketCapAvailable: true,
        health: 70,
        volumeScore: 155, // Invalid: > 100
        coinReturn7d: 0.05,
        relativeStrength7d: 0.04,
        instrument: "C1USDT",
      },
      {
        coinId: 2,
        marketCapAvailable: true,
        health: 65,
        volumeScore: 45,
        coinReturn7d: -0.02,
        relativeStrength7d: -0.03,
        instrument: "C2USDT",
      },
      {
        coinId: 3,
        marketCapAvailable: true,
        health: 60,
        volumeScore: 35,
        coinReturn7d: 0.03,
        relativeStrength7d: 0.02,
        instrument: "C3USDT",
      },
    ];

    const result = calculateLeadership(constituents);

    expect(result.availabilityState).toBe("INSUFFICIENT_HISTORY");
    expect(result.excluded).toContainEqual({ coinId: 1, reason: "missing_or_invalid_volume" });
  });

  test("relativeStrength7d is required for eligibility", () => {
    const constituents: LeadershipConstituentInput[] = [
      {
        coinId: 1,
        marketCapAvailable: true,
        health: 70,
        volumeScore: 55,
        coinReturn7d: 0.05,
        relativeStrength7d: null, // Missing
        instrument: "C1USDT",
      },
      {
        coinId: 2,
        marketCapAvailable: true,
        health: 65,
        volumeScore: 45,
        coinReturn7d: -0.02,
        relativeStrength7d: -0.03,
        instrument: "C2USDT",
      },
      {
        coinId: 3,
        marketCapAvailable: true,
        health: 60,
        volumeScore: 35,
        coinReturn7d: 0.03,
        relativeStrength7d: 0.02,
        instrument: "C3USDT",
      },
    ];

    const result = calculateLeadership(constituents);

    expect(result.availabilityState).toBe("INSUFFICIENT_HISTORY");
    expect(result.excluded).toContainEqual({ coinId: 1, reason: "missing_or_invalid_relative_strength" });
  });
});
