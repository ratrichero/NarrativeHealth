jest.mock("@/db", () => ({ db: {} }));

import { calculateLeadership, classifyConcentration, normalizeLeadershipRelativeStrength, normalizeLeadershipReturn } from "../leadership";
import type { LeadershipConstituentInput, LeadershipHistoryObservation } from "../leadership";

const member = (coinId: number, overrides: Partial<LeadershipConstituentInput> = {}): LeadershipConstituentInput => ({
  coinId, marketCapAvailable: true, health: 70, volumeScore: 60, coinReturn7d: 0, relativeStrength7d: 0, instrument: `C${coinId}USDT`, ...overrides,
});

describe("P3 Leadership and Concentration", () => {
  test.each([[-0.30, 0], [-0.20, 0], [-0.10, 25], [-0.05, 37.5], [0, 50], [0.05, 62.5], [0.10, 75], [0.20, 100], [0.30, 100]])("normalizes momentum %s", (value, expected) => expect(normalizeLeadershipReturn(value)).toBe(expected));
  test.each([[-0.20, 0], [-0.10, 25], [-0.05, 37.5], [0, 50], [0.05, 62.5], [0.10, 75], [0.20, 100]])("normalizes RS %s", (value, expected) => expect(normalizeLeadershipRelativeStrength(value)).toBe(expected));

  test("calculates the fixed 40/25/20/15 Leader Score", () => {
    const result = calculateLeadership([member(1, { health: 80, coinReturn7d: 0.10, relativeStrength7d: 0.05, volumeScore: 60 }), member(2), member(3)]);
    expect(result.ranked.find((item) => item.coinId === 1)?.leaderScore).toBeCloseTo(80 * 0.4 + 75 * 0.25 + 62.5 * 0.2 + 60 * 0.15);
  });

  test("excludes any member with a missing required component", () => {
    const result = calculateLeadership([member(1), member(2), member(3), member(4, { volumeScore: null })]);
    expect(result.ranked.map((item) => item.coinId)).not.toContain(4);
    expect(result.excluded).toContainEqual({ coinId: 4, reason: "missing_or_invalid_volume" });
  });

  test.each([0, 1, 2])("requires at least three eligible members: %i", (count) => {
    expect(calculateLeadership([member(1), member(2)].slice(0, count)).availabilityState).toBe("INSUFFICIENT_HISTORY");
  });

  test("uses deterministic ranking tie-breakers", () => {
    const result = calculateLeadership([member(4), member(2), member(3), member(1)]);
    expect(result.ranked.map((item) => item.coinId)).toEqual([1, 2, 3, 4]);
    expect(result.ranked[0].status).toBe("LEADER");
    expect(result.ranked.slice(0, 3).map((item) => item.status)).toEqual(["LEADER", "LEADERS", "LEADERS"]);
  });

  test("marks only qualifying ranks below Top 3 as emerging", () => {
    const result = calculateLeadership([
      member(1, { health: 100, volumeScore: 100, coinReturn7d: 0.20, relativeStrength7d: 0.20 }),
      member(2, { health: 95, volumeScore: 95, coinReturn7d: 0.15, relativeStrength7d: 0.15 }),
      member(3, { health: 90, volumeScore: 90, coinReturn7d: 0.10, relativeStrength7d: 0.10 }),
      member(4, { health: 69.99, coinReturn7d: 0.08, relativeStrength7d: 0.04 }),
    ]);
    const emerging = result.ranked.find((item) => item.coinId === 4);
    expect(emerging?.rank).toBe(4);
    expect(emerging?.momentumScore).toBeGreaterThanOrEqual(70);
    expect(emerging?.relativeStrengthScore).toBeGreaterThanOrEqual(60);
    expect(emerging?.emergingLeader).toBe(true);
  });

  test("calculates Top-1 and Top-3 from Leader Score contributions", () => {
    const result = calculateLeadership([
      member(1, { health: 100, volumeScore: 100, coinReturn7d: 0.20, relativeStrength7d: 0.20 }),
      member(2, { health: 50, volumeScore: 50 }), member(3, { health: 25, volumeScore: 25 }), member(4, { health: 0, volumeScore: 0 }),
    ]);
    const sum = result.ranked.reduce((total, item) => total + item.leaderScore, 0);
    expect(result.top1Contribution).toBeCloseTo(result.ranked[0].leaderScore / sum);
    expect(result.top3Contribution).toBeCloseTo(result.ranked.slice(0, 3).reduce((total, item) => total + item.leaderScore, 0) / sum);
  });

  test("exactly three constituents produce 100% Top-3", () => {
    const result = calculateLeadership([member(1), member(2), member(3)]);
    expect(result.top3Contribution).toBeCloseTo(1);
    expect(result.concentrationClassification).toBe("Highly Concentrated");
  });

  test.each([[0.3999, "Broad"], [0.40, "Moderate"], [0.5499, "Moderate"], [0.55, "Concentrated"], [0.70, "Concentrated"], [0.7001, "Highly Concentrated"]] as const)("classifies concentration %s", (value, expected) => expect(classifyConcentration(value)).toBe(expected));

  test("calculates persistence only with seven distinct observations", () => {
    const history: LeadershipHistoryObservation[] = Array.from({ length: 7 }, (_, index) => ({ date: `2026-08-0${index + 1}`, top3CoinIds: index === 3 || index === 5 ? [2, 3, 4] : [1, 2, 3] }));
    const result = calculateLeadership([member(1), member(2), member(3)], history);
    expect(result.ranked.find((item) => item.coinId === 1)).toMatchObject({ leaderDays7d: 5, leaderPersistence7d: 5 / 7 });
    expect(calculateLeadership([member(1), member(2), member(3)], history.slice(0, 6)).ranked[0].leaderPersistence7d).toBeNull();
  });

  test("is deterministic for reversed snapshot order", () => {
    const values = [member(1, { health: 80 }), member(2, { health: 70 }), member(3, { health: 60 }), member(4, { health: 50 })];
    expect(calculateLeadership(values)).toEqual(calculateLeadership([...values].reverse()));
  });
});
