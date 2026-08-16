import type { P3IntelligenceViewModel } from "@/lib/types/p3-intelligence";
import { makeVm } from "../../__tests__/fixtures";
import { replayP4AtWindow } from "../replay";
import { buildReplaySamples, evaluateRules, featuresOf, classesOf } from "../execution";
import { asOfRows, selectIdentityGroup } from "../loaders";
import type { ReplaySample } from "../execution";

/**
 * P4-06B execution tests. The "real-data" series below mirrors the actual
 * persisted artifacts from the P4-06A inventory (narrative 1, p3-orchestrator
 * /1/observed/7D, VALID): ids 1, 9, 10 with the persisted regime / rotation /
 * breadth / momentum / RS / leader values.
 */

/** Real-data-shaped series: artifact ids 1, 9, 10 of narrative 1. */
function realSeries(): P3IntelligenceViewModel[] {
  return [
    makeVm({
      artifactId: 1,
      windowEnd: "2026-08-11T00:00:00.000Z",
      regime: { availabilityState: "VALID", classification: "NEUTRAL", display: "NEUTRAL" },
      rotation: { availabilityState: "VALID", classification: "ACCELERATING", score: 75.19, scoreDisplay: "75.19" },
      breadth: { availabilityState: "VALID", value: 0.142857, display: "0.143" },
      momentum: { availabilityState: "VALID", value: 14.03, display: "+14.03" },
      relativeStrength: { availabilityState: "VALID", value: -0.011, display: "-0.011" },
      leadership: { availabilityState: "VALID", coinId: 10, symbol: "BTC", score: 89.29, scoreDisplay: "89.29" },
    }),
    makeVm({
      artifactId: 9,
      windowEnd: "2026-08-13T00:00:00.000Z",
      regime: { availabilityState: "VALID", classification: "WEAKENING", display: "WEAKENING" },
      rotation: { availabilityState: "VALID", classification: "INFLOW", score: 61.19, scoreDisplay: "61.19" },
      breadth: { availabilityState: "VALID", value: 0.142857, display: "0.143" },
      momentum: { availabilityState: "VALID", value: -0.98, display: "-0.98" },
      relativeStrength: { availabilityState: "VALID", value: 0.048, display: "+0.048" },
      leadership: { availabilityState: "VALID", coinId: 22, symbol: "ETH", score: 61.35, scoreDisplay: "61.35" },
    }),
    makeVm({
      artifactId: 10,
      windowEnd: "2026-08-15T00:00:00.000Z",
      regime: { availabilityState: "VALID", classification: "WEAKENING", display: "WEAKENING" },
      rotation: { availabilityState: "VALID", classification: "STABLE", score: 49.89, scoreDisplay: "49.89" },
      breadth: { availabilityState: "VALID", value: 0, display: "0.000" },
      momentum: { availabilityState: "VALID", value: -2.4, display: "-2.40" },
      relativeStrength: { availabilityState: "VALID", value: 0.04, display: "+0.040" },
      leadership: { availabilityState: "VALID", coinId: 12, symbol: "SOL", score: 55.98, scoreDisplay: "55.98" },
    }),
  ];
}

const NO_P2_BY_WINDOW = {
  "2026-08-11T00:00:00.000Z": { narrativeWideEvents: [], coinLocalEvents: [] },
  "2026-08-13T00:00:00.000Z": { narrativeWideEvents: [], coinLocalEvents: [] },
  "2026-08-15T00:00:00.000Z": { narrativeWideEvents: [], coinLocalEvents: [] },
};

function samplesFor(series: P3IntelligenceViewModel[]) {
  return buildReplaySamples({ series, constituentsByArtifact: {}, p2ByWindow: NO_P2_BY_WINDOW });
}

describe("P4-06B execution — real-data replay samples", () => {
  it("builds one sample per evaluation window (3 windows, deduplicated identities)", () => {
    const samples = samplesFor(realSeries());
    expect(samples.length).toBe(3);
    expect(new Set(samples.map((s) => s.sampleIdentity)).size).toBe(3);
    expect(samples.map((s) => s.currentArtifactId)).toEqual([1, 9, 10]);
    expect(samples[0].seriesLength).toBe(1); // insufficient history
    expect(samples[1].seriesLength).toBe(2);
    expect(samples[2].seriesLength).toBe(3);
  });

  it("W=9 (series [1,9]) replays as NEGATIVE dominant, minor conflict, Confidence MEDIUM (C1/C2 conforming)", () => {
    const samples = samplesFor(realSeries());
    const sample = samples.find((s) => s.windowEnd === "2026-08-13T00:00:00.000Z")!;
    const r = sample.record;

    expect(r.status).toBe("VALID");
    expect(r.direction).toBe("NEGATIVE"); // 3 core NEGATIVE, RS POSITIVE opposes — dominant survives
    expect(r.conflict).toEqual({ fired: true, material: false, severity: "low" }); // breadth/corroborator-only ⇒ minor (C1)
    expect(r.confidence).toBe("MEDIUM"); // cov HIGH − minor opposing (C2: material not involved)
    expect(r.risk).toBe("HIGH"); // ≥2 NEGATIVE movers
    expect(r.opportunity).toBe("LOW");
    expect(r.actionability).toBe("HIGH"); // LOW×HIGH×NEGATIVE×Conf≥MEDIUM ⇒ HIGH
    expect(r.signals.map((s) => s.id)).toEqual(
      expect.arrayContaining(["NARRATIVE_DETERIORATION", "REGIME_CHANGE", "ROTATION_CHANGE", "EVIDENCE_CONFLICT"])
    );
  });

  it("W=10 (series [1,9,10]) replays as NEGATIVE, no conflict, Confidence HIGH", () => {
    const samples = samplesFor(realSeries());
    const sample = samples.find((s) => s.windowEnd === "2026-08-15T00:00:00.000Z")!;
    const r = sample.record;

    expect(r.direction).toBe("NEGATIVE");
    expect(r.conflict).toEqual({ fired: false, material: false, severity: null });
    expect(r.confidence).toBe("HIGH");
    expect(r.risk).toBe("HIGH");
    expect(r.actionability).toBe("HIGH");
    expect(r.signals.map((s) => s.id)).toEqual(
      expect.arrayContaining(["NARRATIVE_DETERIORATION", "NARROWING", "ROTATION_CHANGE"])
    );
    expect(r.signals.map((s) => s.id)).not.toContain("EVIDENCE_CONFLICT");
  });

  it("W=1 (single artifact) degrades with INSUFFICIENT_HISTORY", () => {
    const samples = samplesFor(realSeries());
    const sample = samples.find((s) => s.windowEnd === "2026-08-11T00:00:00.000Z")!;
    expect(sample.record.status).toBe("DEGRADED");
    expect(sample.record.degradation.map((d) => d.code)).toContain("INSUFFICIENT_HISTORY");
  });

  it("classifies scenario classes from persisted observations only", () => {
    const series = realSeries();
    const samples = samplesFor(series);
    const w9 = samples.find((s) => s.windowEnd === "2026-08-13T00:00:00.000Z")!;
    const f9 = featuresOf(series.slice(0, 2), {}, w9.record);
    expect(classesOf(f9)[1]).toContain("dominant_opposing"); // NEGATIVE dominant + RS POSITIVE
    expect(classesOf(f9)[2]).toContain("breadth_only_minor");
    expect(classesOf(f9)[5]).toContain("neg_2plus");
    expect(classesOf(f9)[6]).toContain("cov_full");
    expect(classesOf(f9)[6]).toContain("minor_minus1");
    expect(classesOf(f9)[9]).toContain("deteriorating_fires");
  });
});

describe("P4-06B execution — mechanical rule evaluation", () => {
  it("all 9 provisional rules are INSUFFICIENT_EVIDENCE on the real dataset (required classes unobserved)", () => {
    const series = realSeries();
    const samples = samplesFor(series);
    const results = evaluateRules({
      samples,
      seriesByNarrative: { 1: series },
      constituentsByArtifact: { 1: {} },
    });

    expect(results.length).toBe(9);
    for (const result of results) {
      expect(result.status).toBe("INSUFFICIENT_EVIDENCE");
      expect(result.narratives).toBe(1);
      expect(result.samples).toBe(3);
      expect(result.contradictions).toEqual([]);
    }

    // Observed classes are recorded — the evidence is not discarded.
    const byId = new Map(results.map((r) => [r.ruleId, r]));
    expect(byId.get(1)!.observedClasses).toEqual(["dominant_opposing", "no_opposing"]);
    expect(byId.get(2)!.observedClasses).toEqual(["breadth_only_minor", "no_conflict"]);
    expect(byId.get(3)!.observedClasses).toEqual(["missing_p2"]);
    expect(byId.get(5)!.observedClasses).toEqual(["neg_2plus"]);
    expect(byId.get(6)!.observedClasses).toEqual(expect.arrayContaining(["cov_full", "minor_minus1"]));
    expect(byId.get(7)!.observedClasses).toEqual(expect.arrayContaining(["matrix_lowxhigh_neg", "conf_high", "conf_medium"]));
    expect(byId.get(8)!.observedClasses).toEqual(["lowxhigh"]);
    expect(byId.get(9)!.observedClasses).toEqual(["deteriorating_fires", "not_suppressed_breadth_only"]);
  });

  it("flags CONTRADICTED when a sample violates the frozen expectation (machinery check)", () => {
    const series = realSeries();
    const samples = samplesFor(series);
    const w10 = samples.find((s) => s.windowEnd === "2026-08-15T00:00:00.000Z")!;
    const tampered: ReplaySample = {
      ...w10,
      record: { ...w10.record, risk: "LOW" }, // 3 NEGATIVE movers but risk LOW — violates §11
    };
    const results = evaluateRules({
      samples: [...samples.filter((s) => s !== w10), tampered],
      seriesByNarrative: { 1: series },
      constituentsByArtifact: { 1: {} },
    });
    const rule5 = results.find((r) => r.ruleId === 5)!;
    expect(rule5.status).toBe("CONTRADICTED");
    expect(rule5.contradictions.length).toBeGreaterThan(0);
    expect(rule5.contradictions[0].actual).toBe("LOW");
  });
});

describe("P4-06B loaders — pure helpers", () => {
  const row = (id: number, windowEnd: string, algo = "p3-orchestrator", ver = "1", mode = "observed"): any => ({
    id,
    windowEnd: new Date(windowEnd),
    algorithmKey: algo,
    algorithmVersion: ver,
    calculationMode: mode,
    provenance: { context: { window: "7D" } },
  });

  it("asOfRows never returns rows after W and preserves chronological order (leakage-safe)", () => {
    const rows = [row(10, "2026-08-15T00:00:00.000Z"), row(1, "2026-08-11T00:00:00.000Z"), row(9, "2026-08-13T00:00:00.000Z")];
    const prefix = asOfRows(rows, "2026-08-13T00:00:00.000Z");
    expect(prefix.map((r) => r.id)).toEqual([1, 9]);
    expect(prefix.every((r) => r.windowEnd.getTime() <= new Date("2026-08-13T00:00:00.000Z").getTime())).toBe(true);
  });

  it("selectIdentityGroup keeps only the latest row's identity group (no mixing)", () => {
    const rows = [
      row(0, "2026-08-09T00:00:00.000Z", "p3-orchestrator", "2"), // different version, older — excluded
      row(1, "2026-08-11T00:00:00.000Z", "p3-orchestrator", "1"),
      row(9, "2026-08-13T00:00:00.000Z", "p3-orchestrator", "1"),
    ];
    const group = selectIdentityGroup(asOfRows(rows, null));
    expect(group.map((r) => r.id)).toEqual([1, 9]);
    // The latest row's identity wins even when the other identity is newer.
    const newerOther = [
      row(1, "2026-08-11T00:00:00.000Z", "p3-orchestrator", "1"),
      row(20, "2026-08-15T00:00:00.000Z", "p3-orchestrator", "2"),
    ];
    expect(selectIdentityGroup(asOfRows(newerOther, null)).map((r) => r.id)).toEqual([20]);
  });

  it("replayP4AtWindow rejects a mixed-identity series passed directly", () => {
    const series = realSeries();
    const mixed = [...series.slice(0, 2), { ...series[2], algorithmVersion: "2" }];
    expect(replayP4AtWindow({ series: mixed, p2: { narrativeWideEvents: [], coinLocalEvents: [] } })).toBeNull();
  });
});
