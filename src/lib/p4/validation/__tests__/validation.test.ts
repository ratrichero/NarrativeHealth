import type { P3IntelligenceViewModel } from "@/lib/types/p3-intelligence";
import { makeEventRisk, makeVm } from "../../__tests__/fixtures";
import { replayP4AtWindow, seriesUpTo } from "../replay";
import { deriveOutcomes, trendRelation } from "../outcomes";

/**
 * P4-06A replay harness tests.
 *
 * The replay must reuse the EXISTING P4 interpretation (never a second
 * algorithm), be deterministic (modulo the metadata-only `generatedAt`),
 * never leak future artifacts into a replay, and never mix identities.
 */

/** Ascending same-identity improving series (P3 read-model shapes). */
function improvingSeries(): P3IntelligenceViewModel[] {
  return [
    makeVm({
      artifactId: 1,
      windowEnd: "2026-08-01T00:00:00.000Z",
      regime: { availabilityState: "VALID", classification: "NEUTRAL", display: "NEUTRAL" },
      rotation: { availabilityState: "VALID", classification: "STABLE", score: 40, scoreDisplay: "40.00" },
      breadth: { availabilityState: "VALID", value: 0.5, display: "0.500" },
      momentum: { availabilityState: "VALID", value: 1, display: "+1.00" },
      relativeStrength: { availabilityState: "VALID", value: 0.02, display: "+0.020" },
      leadership: { availabilityState: "VALID", coinId: 1, symbol: "BTC", score: 80, scoreDisplay: "80.00" },
    }),
    makeVm({
      artifactId: 2,
      windowEnd: "2026-08-03T00:00:00.000Z",
      regime: { availabilityState: "VALID", classification: "STRONG", display: "STRONG" },
      rotation: { availabilityState: "VALID", classification: "ACCELERATING", score: 70, scoreDisplay: "70.00" },
      breadth: { availabilityState: "VALID", value: 0.7, display: "0.700" },
      momentum: { availabilityState: "VALID", value: 5, display: "+5.00" },
      relativeStrength: { availabilityState: "VALID", value: 0.06, display: "+0.060" },
      leadership: { availabilityState: "VALID", coinId: 2, symbol: "ETH", score: 85, scoreDisplay: "85.00" },
    }),
    makeVm({
      artifactId: 3,
      windowEnd: "2026-08-05T00:00:00.000Z",
      regime: { availabilityState: "VALID", classification: "STRONG", display: "STRONG" },
      rotation: { availabilityState: "VALID", classification: "ACCELERATING", score: 75, scoreDisplay: "75.00" },
      breadth: { availabilityState: "VALID", value: 0.9, display: "0.900" },
      momentum: { availabilityState: "VALID", value: 8, display: "+8.00" },
      relativeStrength: { availabilityState: "VALID", value: 0.1, display: "+0.100" },
      leadership: { availabilityState: "VALID", coinId: 2, symbol: "ETH", score: 90, scoreDisplay: "90.00" },
    }),
  ];
}

const NO_P2 = { narrativeWideEvents: [], coinLocalEvents: [] };

const strip = (record: NonNullable<ReturnType<typeof replayP4AtWindow>>) => ({
  ...record,
  generatedAt: "",
});

describe("P4-06A replay harness — deterministic replay of P4-03 v1", () => {
  it("replays the latest window: VALID record with direction, signals, O/R/C/A, evidence", () => {
    const record = replayP4AtWindow({ series: improvingSeries(), p2: NO_P2 });

    expect(record).not.toBeNull();
    expect(record!.status).toBe("VALID");
    expect(record!.windowEnd).toBe("2026-08-05T00:00:00.000Z");
    expect(record!.artifactId).toBe(3);
    expect(record!.precedingArtifactIds).toEqual([1, 2]);
    expect(record!.direction).toBe("POSITIVE");
    // Latest step (a2→a3) is regime STABLE / rotation STABLE, so the
    // per-step REGIME_CHANGE/ROTATION_CHANGE correctly do NOT fire here;
    // they fire at the interior window (see the interior replay test).
    expect(record!.signals.map((s) => s.id)).toEqual(
      expect.arrayContaining(["NARRATIVE_IMPROVEMENT", "BROADENING"])
    );
    expect(record!.opportunity).toBe("HIGH");
    expect(record!.risk).toBe("LOW");
    expect(record!.confidence).toBe("HIGH");
    expect(record!.actionability).toBe("HIGH");
    expect(record!.conflict).toEqual({ fired: false, material: false, severity: null });
    expect(record!.evidence.length).toBeGreaterThan(0);
    expect(record!.p2Scope).toBe("none");
    expect(record!.semanticVersion).toBe("1");
    expect(record!.interpretationRuleVersion).toBe("p4-03/v1");
  });

  it("is deterministic for the same series (modulo generatedAt metadata)", () => {
    const first = replayP4AtWindow({ series: improvingSeries(), p2: NO_P2 });
    const second = replayP4AtWindow({ series: improvingSeries(), p2: NO_P2 });

    expect(first).not.toBeNull();
    expect(strip(first!)).toEqual(strip(second!));
  });

  it("replays an interior window identically regardless of later artifacts (no future leakage)", () => {
    const series = improvingSeries();
    const prefix = seriesUpTo(series, "2026-08-03T00:00:00.000Z");
    expect(prefix.map((a) => a.artifactId)).toEqual([1, 2]);

    const recordAtWindow = replayP4AtWindow({ series: prefix, p2: NO_P2 });

    // Same prefix, but the series extends differently afterwards.
    const divergingTail = [...prefix, makeVm({ ...series[2], artifactId: 99, windowEnd: "2026-08-06T00:00:00.000Z" })];
    const recordFromExtended = replayP4AtWindow({ series: seriesUpTo(divergingTail, "2026-08-03T00:00:00.000Z"), p2: NO_P2 });

    expect(recordAtWindow).not.toBeNull();
    expect(strip(recordAtWindow!)).toEqual(strip(recordFromExtended!));
    // The record must reflect only evidence up to its own window.
    expect(recordAtWindow!.windowEnd).toBe("2026-08-03T00:00:00.000Z");
    expect(recordAtWindow!.artifactId).toBe(2);
    // At the interior window the first step (a1→a2) moved regime NEUTRAL→STRONG
    // and rotation STABLE→ACCELERATING, so the per-step change signals fire.
    expect(recordAtWindow!.signals.map((s) => s.id)).toEqual(
      expect.arrayContaining(["NARRATIVE_IMPROVEMENT", "REGIME_CHANGE", "ROTATION_CHANGE", "BROADENING"])
    );
  });

  it("rejects mixed identity series (P4-02 §7 — same identity only)", () => {
    const series = improvingSeries();
    const mixed = [
      ...series.slice(0, 2),
      makeVm({ ...series[2], algorithmVersion: "2", artifactId: 30 }),
    ];
    expect(replayP4AtWindow({ series: mixed, p2: NO_P2 })).toBeNull();
  });

  it("returns null for an empty series", () => {
    expect(replayP4AtWindow({ series: [], p2: NO_P2 })).toBeNull();
  });

  it("degrades with INSUFFICIENT_HISTORY when the series has a single artifact", () => {
    const record = replayP4AtWindow({ series: improvingSeries().slice(0, 1), p2: NO_P2 });
    expect(record).not.toBeNull();
    expect(record!.status).toBe("DEGRADED");
    expect(record!.degradation.map((d) => d.code)).toContain("INSUFFICIENT_HISTORY");
  });

  it("attaches P2 scope when narrative-wide event risk is present (provenance preserved)", () => {
    const record = replayP4AtWindow({
      series: improvingSeries(),
      p2: {
        narrativeWideEvents: [
          makeEventRisk({ title: "Vesting unlock", riskLevel: "HIGH", narrativeId: 1 }),
        ],
        coinLocalEvents: [],
      },
    });
    expect(record).not.toBeNull();
    expect(record!.p2Scope).toBe("narrative-wide");
    const p2Refs = record!.evidence.filter((ref) => ref.sourceLayer === "P2");
    expect(p2Refs.length).toBeGreaterThan(0);
    expect(p2Refs[0].sourceType).toBe("P2_EVENT_RISK");
    expect(p2Refs[0].artifactIdentity).toBeNull();
  });
});

describe("P4-06A outcome derivation — narrative-state evolution only", () => {
  it("derives outcomes only from artifacts after the replay window", () => {
    const series = improvingSeries();
    const record = replayP4AtWindow({ series: seriesUpTo(series, "2026-08-03T00:00:00.000Z"), p2: NO_P2 })!;
    const current = series[1];
    const subsequent = series.slice(2);

    const outcomes = deriveOutcomes({ record, current, subsequent });

    expect(outcomes.length).toBe(6);
    const trend = outcomes.find((o) => o.id === "trend_overall_evolution")!;
    // momentum 5 → 8 over the horizon: +3 > ε 1.0 ⇒ IMPROVING ⇒ CONTINUATION for POSITIVE.
    expect(trend.observation).toBe("IMPROVING");
    expect(trendRelation(record, trend.observation)).toBe("CONTINUATION");
    expect(trend.sourceArtifactIds).toEqual([2, 3]);

    const regime = outcomes.find((o) => o.id === "regime_evolution")!;
    expect(regime.observation).toBe("STRONG");
    expect(regime.relation).toBe("CONTINUATION");

    const leadership = outcomes.find((o) => o.id === "leadership_persistence")!;
    expect(leadership.relation).toBe("PERSISTENCE");
  });

  it("reports REVERSAL when the horizon state contradicts the interpretation", () => {
    const series = improvingSeries();
    const prefix = seriesUpTo(series, "2026-08-03T00:00:00.000Z");
    const record = replayP4AtWindow({ series: prefix, p2: NO_P2 })!;
    const current = series[1];
    const deterioratingTail = makeVm({
      artifactId: 50,
      windowEnd: "2026-08-06T00:00:00.000Z",
      regime: { availabilityState: "VALID", classification: "WEAKENING", display: "WEAKENING" },
      rotation: { availabilityState: "VALID", classification: "DECELERATING", score: 20, scoreDisplay: "20.00" },
      breadth: { availabilityState: "VALID", value: 0.2, display: "0.200" },
      momentum: { availabilityState: "VALID", value: -3, display: "-3.00" },
      relativeStrength: { availabilityState: "VALID", value: -0.05, display: "-0.050" },
      leadership: { availabilityState: "VALID", coinId: 5, symbol: "SOL", score: 40, scoreDisplay: "40.00" },
    });

    const outcomes = deriveOutcomes({ record, current, subsequent: [deterioratingTail] });
    const trend = outcomes.find((o) => o.id === "trend_overall_evolution")!;
    expect(trend.observation).toBe("DETERIORATING");
    expect(trendRelation(record, trend.observation)).toBe("REVERSAL");
    const leadership = outcomes.find((o) => o.id === "leadership_persistence")!;
    expect(leadership.relation).toBe("CHANGE");
  });

  it("returns no outcomes when no subsequent artifacts exist (never fabricated)", () => {
    const series = improvingSeries();
    const record = replayP4AtWindow({ series, p2: NO_P2 })!;
    expect(deriveOutcomes({ record, current: series[2], subsequent: [] })).toEqual([]);
  });

  it("is NOT_APPLICABLE for UNKNOWN direction (no directional prediction)", () => {
    expect(trendRelation({ direction: "UNKNOWN" } as never, "IMPROVING")).toBe("NOT_APPLICABLE");
    expect(trendRelation({ direction: "MIXED" } as never, "DETERIORATING")).toBe("NOT_APPLICABLE");
  });
});
