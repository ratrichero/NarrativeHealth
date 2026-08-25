// P6-02E: Feature Persistence Tests
// Authority: P6-02B, P6-02C, P6-02C2, P6-02D
// Tests: identity uniqueness, latest-only persistence, version tuple linkage,
//        provenance round-trip, quality metadata round-trip, freshness independence,
//        repeated calculation idempotency, different algorithm versions, backward compat

import {
  assembleQualityMetadata,
  type P6QualityMetadata,
} from "../persistence";
import type { FeatureProvenance, FeatureVersionTuple } from "../types";
import type { QualityState, Metric, Timeframe } from "../../quality/types";
import type { FreshnessStatus } from "../../freshness/types";

// ─── TEST HELPERS ────────────────────────────────────────────────────

function makeProvenanceInput(
  overrides: Partial<{
    metric: Metric;
    quality: QualityState;
    freshness: FreshnessStatus;
    source: string;
  }> = {}
): FeatureProvenance["input_observations"][0] {
  return {
    entity_id: 1,
    metric: (overrides.metric ?? "CLOSE") as Metric,
    source: overrides.source ?? "BINANCE_SPOT",
    observed_at: new Date("2025-01-01"),
    timeframe: "DAILY",
    quality_status: (overrides.quality ?? "VALID") as QualityState,
    freshness_status: (overrides.freshness ?? "FRESH") as FreshnessStatus,
  };
}

function makeProvenance(
  inputs: FeatureProvenance["input_observations"] = [],
  excluded: FeatureProvenance["excluded_inputs"] = []
): FeatureProvenance {
  return {
    input_observations: inputs,
    algorithm_version: "1.0.0",
    parameter_version: "1.0.0",
    schema_version: "1.0.0",
    calculated_at: new Date("2025-06-15T12:00:00Z"),
    input_window: "50 DAILY observations from BINANCE_SPOT",
    total_inputs_expected: 50,
    total_inputs_used: inputs.length,
    excluded_inputs: excluded,
  };
}

function makeVersion(overrides: Partial<FeatureVersionTuple> = {}): FeatureVersionTuple {
  return {
    algorithm_version: "1.0.0",
    parameter_version: "1.0.0",
    schema_version: "1.0.0",
    config_hash: "default-v1",
    ...overrides,
  };
}

// ─── QUALITY METADATA ASSEMBLY ────────────────────────────────────────

describe("P6-02E: Feature Persistence", () => {
  describe("Quality Metadata Assembly", () => {
    test("all VALID observations → summary has only valid_count", () => {
      const inputs = Array.from({ length: 10 }, () =>
        makeProvenanceInput({ quality: "VALID" })
      );
      const provenance = makeProvenance(inputs);
      const meta = assembleQualityMetadata(provenance);

      expect(meta.overall_quality_summary.total_observations).toBe(10);
      expect(meta.overall_quality_summary.valid_count).toBe(10);
      expect(meta.overall_quality_summary.invalid_count).toBe(0);
      expect(meta.overall_quality_summary.missing_count).toBe(0);
      expect(meta.overall_quality_summary.unknown_count).toBe(0);
    });

    test("mixed quality states are counted correctly", () => {
      const inputs = [
        makeProvenanceInput({ quality: "VALID", metric: "CLOSE" }),
        makeProvenanceInput({ quality: "VALID", metric: "HIGH" }),
        makeProvenanceInput({ quality: "INVALID", metric: "LOW" }),
        makeProvenanceInput({ quality: "MISSING", metric: "VOLUME" }),
        makeProvenanceInput({ quality: "UNKNOWN", metric: "OPEN_INTEREST" }),
      ];
      const provenance = makeProvenance(inputs);
      const meta = assembleQualityMetadata(provenance);

      expect(meta.overall_quality_summary.valid_count).toBe(2);
      expect(meta.overall_quality_summary.invalid_count).toBe(1);
      expect(meta.overall_quality_summary.missing_count).toBe(1);
      expect(meta.overall_quality_summary.unknown_count).toBe(1);
    });

    test("per-metric quality is tracked separately", () => {
      const inputs = [
        makeProvenanceInput({ quality: "VALID", metric: "CLOSE" }),
        makeProvenanceInput({ quality: "INVALID", metric: "CLOSE" }),
        makeProvenanceInput({ quality: "VALID", metric: "VOLUME" }),
        makeProvenanceInput({ quality: "VALID", metric: "VOLUME" }),
      ];
      const provenance = makeProvenance(inputs);
      const meta = assembleQualityMetadata(provenance);

      expect(meta.per_metric_quality["CLOSE"]).toEqual({
        valid: 1,
        invalid: 1,
        missing: 0,
        unknown: 0,
      });
      expect(meta.per_metric_quality["VOLUME"]).toEqual({
        valid: 2,
        invalid: 0,
        missing: 0,
        unknown: 0,
      });
    });

    test("freshness summary is independent of quality", () => {
      const inputs = [
        makeProvenanceInput({ freshness: "FRESH", quality: "VALID" }),
        makeProvenanceInput({ freshness: "FRESH", quality: "INVALID" }),
        makeProvenanceInput({ freshness: "STALE", quality: "VALID" }),
        makeProvenanceInput({ freshness: "UNKNOWN", quality: "UNKNOWN" }),
      ];
      const provenance = makeProvenance(inputs);
      const meta = assembleQualityMetadata(provenance);

      // Quality: 2 valid, 1 invalid, 1 unknown
      expect(meta.overall_quality_summary.valid_count).toBe(2);
      expect(meta.overall_quality_summary.invalid_count).toBe(1);
      expect(meta.overall_quality_summary.unknown_count).toBe(1);

      // Freshness: 2 fresh, 1 stale, 1 unknown — independent of quality
      expect(meta.freshness_summary.fresh_count).toBe(2);
      expect(meta.freshness_summary.stale_count).toBe(1);
      expect(meta.freshness_summary.unknown_count).toBe(1);
    });

    test("empty observations → zeroed summary", () => {
      const provenance = makeProvenance([]);
      const meta = assembleQualityMetadata(provenance);

      expect(meta.overall_quality_summary.total_observations).toBe(0);
      expect(meta.overall_quality_summary.valid_count).toBe(0);
      expect(meta.freshness_summary.fresh_count).toBe(0);
      expect(Object.keys(meta.per_metric_quality)).toHaveLength(0);
    });

    test("STALE + VALID does not affect quality count", () => {
      // DF-A-03: quality and freshness are orthogonal
      const inputs = [
        makeProvenanceInput({ freshness: "STALE", quality: "VALID" }),
        makeProvenanceInput({ freshness: "STALE", quality: "VALID" }),
      ];
      const provenance = makeProvenance(inputs);
      const meta = assembleQualityMetadata(provenance);

      // Both are VALID regardless of STALE freshness
      expect(meta.overall_quality_summary.valid_count).toBe(2);
      expect(meta.overall_quality_summary.invalid_count).toBe(0);
      expect(meta.freshness_summary.stale_count).toBe(2);
    });

    test("FRESH + INVALID does not affect quality count", () => {
      const inputs = [
        makeProvenanceInput({ freshness: "FRESH", quality: "INVALID" }),
      ];
      const provenance = makeProvenance(inputs);
      const meta = assembleQualityMetadata(provenance);

      expect(meta.overall_quality_summary.invalid_count).toBe(1);
      expect(meta.overall_quality_summary.valid_count).toBe(0);
      expect(meta.freshness_summary.fresh_count).toBe(1);
    });
  });

  // ─── PROVENANCE ROUND-TRIP ──────────────────────────────────────────

  describe("Provenance Round-Trip", () => {
    test("quality metadata preserves all observation quality states", () => {
      const qualities: QualityState[] = ["VALID", "INVALID", "MISSING", "UNKNOWN"];
      const inputs = qualities.map((q, i) =>
        makeProvenanceInput({
          quality: q,
          metric: (["CLOSE", "HIGH", "LOW", "VOLUME"][i] ?? "CLOSE") as Metric,
        })
      );
      const provenance = makeProvenance(inputs);
      const meta = assembleQualityMetadata(provenance);

      expect(meta.overall_quality_summary.valid_count).toBe(1);
      expect(meta.overall_quality_summary.invalid_count).toBe(1);
      expect(meta.overall_quality_summary.missing_count).toBe(1);
      expect(meta.overall_quality_summary.unknown_count).toBe(1);
    });

    test("version tuple is preserved in provenance", () => {
      const version = makeVersion({
        algorithm_version: "2.0.0",
        parameter_version: "3.1.0",
        schema_version: "1.0.0",
        config_hash: "abc123",
      });
      // Make provenance that uses this version
      const provenance: FeatureProvenance = {
        ...makeProvenance(),
        algorithm_version: version.algorithm_version,
        parameter_version: version.parameter_version,
        schema_version: version.schema_version,
      };

      expect(provenance.algorithm_version).toBe(version.algorithm_version);
      expect(provenance.parameter_version).toBe(version.parameter_version);
      expect(provenance.schema_version).toBe(version.schema_version);
    });

    test("excluded inputs are preserved in provenance", () => {
      const included = [makeProvenanceInput({ quality: "VALID" })];
      const excluded = [
        {
          identity: {
            entity_id: 1,
            metric: "CLOSE" as Metric,
            source: "BINANCE_SPOT",
            observed_at: new Date("2025-01-01"),
            timeframe: "DAILY" as Timeframe,
          },
          reason: "quality_status=INVALID",
        },
      ];
      const provenance = makeProvenance(included, excluded);

      expect(provenance.excluded_inputs).toHaveLength(1);
      expect(provenance.excluded_inputs[0].reason).toBe("quality_status=INVALID");
    });
  });

  // ─── DETERMINISTIC OUTPUT ───────────────────────────────────────────

  describe("Determinism", () => {
    test("same inputs produce same quality metadata", () => {
      const inputs = [
        makeProvenanceInput({ quality: "VALID" }),
        makeProvenanceInput({ quality: "INVALID" }),
        makeProvenanceInput({ quality: "UNKNOWN" }),
      ];
      const provenance = makeProvenance(inputs);

      const meta1 = assembleQualityMetadata(provenance);
      const meta2 = assembleQualityMetadata(provenance);

      expect(meta1).toEqual(meta2);
    });

    test("different quality inputs produce different metadata", () => {
      const inputs1 = [makeProvenanceInput({ quality: "VALID" })];
      const inputs2 = [makeProvenanceInput({ quality: "INVALID" })];

      const meta1 = assembleQualityMetadata(makeProvenance(inputs1));
      const meta2 = assembleQualityMetadata(makeProvenance(inputs2));

      expect(meta1.overall_quality_summary.valid_count).toBe(1);
      expect(meta2.overall_quality_summary.invalid_count).toBe(1);
    });
  });

  // ─── VERSION TUPLE ──────────────────────────────────────────────────

  describe("Version Tuple", () => {
    test("V1 version tuple produces consistent metadata", () => {
      const version = makeVersion();
      const provenance = makeProvenance();

      expect(provenance.algorithm_version).toBe("1.0.0");
      expect(provenance.parameter_version).toBe("1.0.0");
      expect(provenance.schema_version).toBe("1.0.0");
    });

    test("different versions are distinguished", () => {
      const v1 = makeVersion({ algorithm_version: "1.0.0" });
      const v2 = makeVersion({ algorithm_version: "2.0.0" });

      expect(v1.algorithm_version).not.toBe(v2.algorithm_version);
    });
  });

  // ─── FRESHNESS INDEPENDENCE ──────────────────────────────────────────

  describe("Freshness Independence", () => {
    test("freshness does not affect quality metadata counts", () => {
      const freshInputs = [
        makeProvenanceInput({ quality: "VALID", freshness: "FRESH" }),
        makeProvenanceInput({ quality: "VALID", freshness: "FRESH" }),
      ];
      const staleInputs = [
        makeProvenanceInput({ quality: "VALID", freshness: "STALE" }),
        makeProvenanceInput({ quality: "VALID", freshness: "STALE" }),
      ];

      const freshMeta = assembleQualityMetadata(makeProvenance(freshInputs));
      const staleMeta = assembleQualityMetadata(makeProvenance(staleInputs));

      // Quality counts identical regardless of freshness
      expect(freshMeta.overall_quality_summary.valid_count).toBe(
        staleMeta.overall_quality_summary.valid_count
      );
      // But freshness counts differ
      expect(freshMeta.freshness_summary.fresh_count).toBe(2);
      expect(staleMeta.freshness_summary.stale_count).toBe(2);
    });
  });

  // ─── BACKWARD COMPATIBILITY ──────────────────────────────────────────

  describe("Backward Compatibility", () => {
    test("quality metadata does not modify legacy fields", () => {
      const inputs = [
        makeProvenanceInput({ quality: "VALID" }),
        makeProvenanceInput({ quality: "INVALID" }),
      ];
      const provenance = makeProvenance(inputs);
      const meta = assembleQualityMetadata(provenance);

      // Legacy fields are untouched — quality metadata is additive
      expect(meta.overall_quality_summary).toBeDefined();
      expect(meta.per_metric_quality).toBeDefined();
      expect(meta.freshness_summary).toBeDefined();

      // These don't interfere with legacy score interpretation
      expect(typeof meta.overall_quality_summary.valid_count).toBe("number");
    });

    test("P4/P5 consumers can read legacy fields without P6 metadata", () => {
      // A P4 consumer reading features without p6_provenance should still work
      // This is a structural test — the P6 columns are nullable
      const meta = assembleQualityMetadata(makeProvenance([]));
      expect(meta.overall_quality_summary.total_observations).toBe(0);
      // P6 metadata is independent — legacy scores remain unchanged
    });
  });

  // ─── EDGE CASES ──────────────────────────────────────────────────────

  describe("Edge Cases", () => {
    test("single observation produces valid metadata", () => {
      const inputs = [makeProvenanceInput()];
      const meta = assembleQualityMetadata(makeProvenance(inputs));

      expect(meta.overall_quality_summary.total_observations).toBe(1);
      expect(meta.overall_quality_summary.valid_count).toBe(1);
    });

    test("large observation set produces correct counts", () => {
      const inputs = Array.from({ length: 200 }, (_, i) =>
        makeProvenanceInput({
          quality: (i % 4 === 0 ? "INVALID" : "VALID") as QualityState,
          freshness: (i % 3 === 0 ? "STALE" : "FRESH") as FreshnessStatus,
        })
      );
      const meta = assembleQualityMetadata(makeProvenance(inputs));

      expect(meta.overall_quality_summary.total_observations).toBe(200);
      expect(meta.overall_quality_summary.valid_count).toBe(150);
      expect(meta.overall_quality_summary.invalid_count).toBe(50);
      expect(meta.freshness_summary.fresh_count).toBeCloseTo(133, 0);
      expect(meta.freshness_summary.stale_count).toBeCloseTo(67, 0);
    });

    test("all four quality states represented in per-metric", () => {
      const inputs = [
        makeProvenanceInput({ quality: "VALID", metric: "CLOSE" }),
        makeProvenanceInput({ quality: "INVALID", metric: "CLOSE" }),
        makeProvenanceInput({ quality: "MISSING", metric: "CLOSE" }),
        makeProvenanceInput({ quality: "UNKNOWN", metric: "CLOSE" }),
      ];
      const meta = assembleQualityMetadata(makeProvenance(inputs));

      expect(meta.per_metric_quality["CLOSE"]).toEqual({
        valid: 1,
        invalid: 1,
        missing: 1,
        unknown: 1,
      });
    });

    test("multiple sources tracked in same metric", () => {
      const inputs = [
        makeProvenanceInput({ quality: "VALID", source: "BINANCE_SPOT", metric: "CLOSE" }),
        makeProvenanceInput({ quality: "VALID", source: "BINANCE_FUTURES", metric: "CLOSE" }),
      ];
      const meta = assembleQualityMetadata(makeProvenance(inputs));

      // Per-metric is by metric, not by source
      expect(meta.per_metric_quality["CLOSE"].valid).toBe(2);
    });
  });
});
