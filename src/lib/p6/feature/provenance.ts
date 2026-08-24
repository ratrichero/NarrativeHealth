// P6 Provenance — Assembly module
// Authority: P6-02B §7 (Minimum Provenance Contract)
// Every persisted feature record MUST contain sufficient provenance for reproduction.

import type {
  FeatureObservation,
  FeatureProvenance,
  FeatureVersionTuple,
  ObservationIdentity,
  ProvenanceInputObservation,
} from "./types";
import type { Timeframe } from "../quality/types";

/**
 * Build provenance input observation records from observations.
 */
function buildInputObservations(
  observations: FeatureObservation[]
): ProvenanceInputObservation[] {
  return observations.map((o) => ({
    entity_id: o.entity_id,
    metric: o.metric,
    source: o.source,
    observed_at: o.observed_at,
    timeframe: o.timeframe,
    quality_status: o.quality_status,
    freshness_status: o.freshness_status,
  }));
}

/**
 * Build excluded input records from observations that failed quality gate.
 */
function buildExcludedInputs(
  excluded: FeatureObservation[]
): {
  identity: ObservationIdentity;
  reason: string;
}[] {
  return excluded.map((o) => ({
    identity: {
      entity_id: o.entity_id,
      metric: o.metric,
      source: o.source,
      observed_at: o.observed_at,
      timeframe: o.timeframe,
    },
    reason: `quality_status=${o.quality_status}`,
  }));
}

/**
 * Assemble complete provenance for a feature calculation.
 */
export function assembleProvenance(
  allObservations: FeatureObservation[],
  excludedObservations: FeatureObservation[],
  version: FeatureVersionTuple,
  timeframe: Timeframe,
  totalInputsExpected: number,
  totalInputsUsed: number
): FeatureProvenance {
  const inputObservations = buildInputObservations(allObservations);
  const excludedInputs = buildExcludedInputs(excludedObservations);

  // Build input window descriptor
  const sources = [...new Set(allObservations.map((o) => o.source))];
  const inputWindow = `${totalInputsExpected} ${timeframe} observations from ${sources.join(", ") || "none"}`;

  return {
    input_observations: inputObservations,
    algorithm_version: version.algorithm_version,
    parameter_version: version.parameter_version,
    schema_version: version.schema_version,
    calculated_at: new Date(),
    input_window: inputWindow,
    total_inputs_expected: totalInputsExpected,
    total_inputs_used: totalInputsUsed,
    excluded_inputs: excludedInputs,
  };
}
