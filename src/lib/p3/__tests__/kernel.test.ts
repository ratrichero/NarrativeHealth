import { propagateAvailability, unavailable, valid } from "../availability";
import { calculationIdentity, createCalculationContext, normalizeResult } from "../context";
import { prepareConstituents } from "../constituents";
import { resolveP3Window, utcDayStart } from "../windows";

const end = new Date("2026-08-09T00:00:00.000Z");

function context(version = "1") {
  const window = resolveP3Window("7D", end);
  return createCalculationContext({
    narrativeId: 4,
    calculationMode: "observed",
    window: "7D",
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    calculatedAt: new Date("2026-08-09T01:00:00.000Z"),
    algorithmKey: "p3-test",
    algorithmVersion: version,
    ruleVersionId: 2,
    featureVersionId: 3,
    scoreConfigId: 5,
    constituents: [],
    sourceAvailability: {},
  });
}

describe("P3 core kernel", () => {
  test("resolves UTC windows deterministically", () => {
    expect(resolveP3Window("1D", end)).toMatchObject({
      startTarget: new Date("2026-08-07T00:00:00.000Z"),
      endTarget: new Date("2026-08-08T00:00:00.000Z"),
    });
    expect(resolveP3Window("14D", end).startTarget.toISOString()).toBe("2026-07-25T00:00:00.000Z");
    expect(() => resolveP3Window("7D", new Date("2026-08-09T07:00:00.000Z"))).toThrow("UTC day boundary");
    expect(utcDayStart(new Date("2026-08-09T23:59:59.000Z")).toISOString()).toBe("2026-08-09T00:00:00.000Z");
  });

  test("propagates availability without converting missing to zero", () => {
    expect(propagateAvailability([valid(12), unavailable("MISSING", "BTC missing")], 0)).toEqual({
      value: null,
      state: "MISSING",
      reason: "BTC missing",
      confidenceContribution: undefined,
      provenance: undefined,
    });
    expect(valid(0)).toEqual({ value: 0, state: "VALID", provenance: undefined });
  });

  test("propagates unavailable BTC instead of relative strength zero", () => {
    const btc = unavailable<number>("MISSING", "BTC benchmark unavailable");
    const narrativeReturn = valid(0.12);
    expect(propagateAvailability([narrativeReturn, btc], 0)).toMatchObject({ value: null, state: "MISSING" });
  });

  test("prepares stable constituent snapshots", () => {
    const prepared = prepareConstituents([
      { coinId: 9, membershipState: "EXCLUDED", inclusionReason: "missing health", availabilityState: "MISSING" },
      { coinId: 2, membershipState: "ELIGIBLE", availabilityState: "VALID", inputManifest: { healthScoreId: 20 } },
    ]);
    expect(prepared.members.map((member) => member.coinId)).toEqual([2, 9]);
    expect(prepared).toMatchObject({ memberCount: 2, eligibleCount: 1 });
    expect(() => prepareConstituents([
      { coinId: 2, membershipState: "ELIGIBLE", availabilityState: "VALID" },
      { coinId: 2, membershipState: "ELIGIBLE", availabilityState: "VALID" },
    ])).toThrow("Duplicate constituent");
  });

  test("builds deterministic context, provenance, and identity", () => {
    const first = context();
    const second = context();
    expect(first.provenance).toEqual(second.provenance);
    expect(calculationIdentity(first)).toBe(calculationIdentity(second));
    expect(calculationIdentity(context("1"))).not.toBe(calculationIdentity(context("2")));
  });

  test("normalizes module results without adding formulas", () => {
    const normalized = normalizeResult(context(), {
      availabilityState: "VALID",
      confidence: null,
      metrics: { custom: { metric: "custom", value: 0, state: "VALID" } },
    });
    expect(normalized.metrics.custom.value).toBe(0);
    expect(normalized.provenance).toMatchObject({ kernel: "p3-core" });
  });
});
