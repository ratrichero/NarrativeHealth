/**
 * P3 Authoritative Orchestrator
 *
 * This is the single authoritative execution path for P3 calculations.
 * It executes P3-04 through P3-09 in dependency order, preserves availability
 * semantics, enforces futures-only data sources, and persists immutable results.
 *
 * EXECUTION GRAPH:
 * P3 Context → Historical Snapshot → P3-04 Breadth → P3-05 Momentum → P3-06 RS
 *   → P3-07 Leadership → P3-08 Regime → P3-09 Rotation → Persistence
 */

import type { P3CalculationContext, P3CalculationResult } from "./context";
import { createCalculationContext, normalizeResult } from "./context";
import { createP3ExecutionContext, type P3ExecutionContextResult, type LoadedP3ScoreConfig } from "./preparation";
import { prepareBreadthInputs, type PreparedBreadthInputs } from "./preparation";
import { prepareMomentumInputs, type PreparedMomentumInputs } from "./preparation";
import { prepareRelativeStrengthInputs, type PreparedRelativeStrengthInputs } from "./preparation";
import { prepareLeadershipInputs, type PreparedLeadershipInputs } from "./preparation";
import { prepareRegimeInputs, type PreparedRegimeInputs } from "./preparation";
import { prepareRotationInputs, type PreparedRotationInputs } from "./preparation";
import { loadRegimeScoreConfig, loadRotationScoreConfig } from "./preparation";
import { calculateBreadthResult } from "./breadth";
import { calculateP3MomentumResult } from "@/lib/services/momentum.service";
import { calculateRelativeStrengthResult } from "./relative-strength";
import { calculateLeadershipResult } from "./leadership";
import { calculateRegimeResult, P3_REGIME_ALGORITHM_KEY, P3_REGIME_ALGORITHM_VERSION, type RegimeInputs, type RegimeThresholds } from "./regime";
import { calculateRotationResult, P3_ROTATION_ALGORITHM_KEY, P3_ROTATION_ALGORITHM_VERSION, type RotationInputs, type RotationThresholds, normalizeRelativeStrength, normalizeVolumeExpansion } from "./rotation";
import { persistP3Calculation, type P3PersistenceOutcome } from "./persistence";

// ---------------------------------------------------------------------------
// Orchestrator Configuration
// ---------------------------------------------------------------------------

export interface P3ExecutionConfig {
  narrativeId: number;
  window: "1D" | "3D" | "7D" | "14D";
  windowEnd: Date;
  calculationMode: "observed" | "projected";
  featureVersionId?: number;
  ruleVersionId?: number;
}

export interface P3ExecutionResult {
  executionContext: P3ExecutionContextResult;
  breadthResult: P3CalculationResult;
  momentumResult: P3CalculationResult;
  relativeStrengthResult: P3CalculationResult;
  leadershipResult: P3CalculationResult;
  regimeResult: P3CalculationResult;
  rotationResult: P3CalculationResult;
  persistence: P3PersistenceOutcome;
}

export function createP3ModuleContext(
  baseContext: P3CalculationContext,
  algorithmKey: string,
  algorithmVersion: string,
  config: LoadedP3ScoreConfig<Record<string, number>>
): P3CalculationContext {
  return createCalculationContext({
    ...baseContext,
    algorithmKey,
    algorithmVersion,
    scoreConfigId: config.id,
    provenance: {
      ...baseContext.provenance,
      scoreConfig: {
        id: config.id,
        configType: config.configType,
        configKey: config.configKey,
        version: config.version,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

export class P3ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "P3ConfigurationError";
  }
}

export class P3InputPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "P3InputPreparationError";
  }
}

export class P3InsufficientDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "P3InsufficientDataError";
  }
}

export class P3CalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "P3CalculationError";
  }
}

export class P3PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "P3PersistenceError";
  }
}

// ---------------------------------------------------------------------------
// Persistence Safety Gate
// ---------------------------------------------------------------------------

/**
 * Validates that all mandatory P3 stages (P3-04 through P3-09) have completed
 * successfully (availabilityState === "VALID") before allowing persistence.
 *
 * This is the authoritative persistence gate: no P3 historical intelligence
 * may be persisted unless ALL mandatory stages are VALID. Any stage reporting
 * MISSING, INSUFFICIENT_HISTORY, INVALID, STALE, AMBIGUOUS, or NOT_APPLICABLE
 * must prevent persistence.
 *
 * Exported for testability.
 */
export function validateMandatoryStages(
  breadthResult: P3CalculationResult,
  momentumResult: P3CalculationResult,
  relativeStrengthResult: P3CalculationResult,
  leadershipResult: P3CalculationResult,
  regimeResult: P3CalculationResult,
  rotationResult: P3CalculationResult,
): void {
  const stages: ReadonlyArray<{ name: string; result: P3CalculationResult }> = [
    { name: "P3-04 Breadth", result: breadthResult },
    { name: "P3-05 Momentum", result: momentumResult },
    { name: "P3-06 Relative Strength", result: relativeStrengthResult },
    { name: "P3-07 Leadership", result: leadershipResult },
    { name: "P3-08 Regime", result: regimeResult },
    { name: "P3-09 Rotation", result: rotationResult },
  ];

  const failedStages = stages.filter(
    ({ result }) => result.availabilityState !== "VALID"
  );

  if (failedStages.length > 0) {
    const details = failedStages
      .map((s) => `${s.name}=${s.result.availabilityState}`)
      .join(", ");
    throw new P3InsufficientDataError(
      `P3 calculation cannot be persisted: mandatory stages not VALID: ${details}`
    );
  }
}

// ---------------------------------------------------------------------------
// Authoritative Orchestrator
// ---------------------------------------------------------------------------

/**
 * Executes the complete P3 calculation pipeline in authoritative order.
 *
 * This is the ONLY production execution path for P3. Do not create parallel paths.
 */
export async function runP3AuthoritativeExecution(
  config: P3ExecutionConfig
): Promise<P3ExecutionResult> {
  // Step 1: Create immutable execution context
  const executionContext = await createP3ExecutionContext(config);
  if (executionContext.membership.availability !== "AVAILABLE") {
    throw new P3InsufficientDataError(
      `Historical membership unavailable: ${executionContext.membership.availability}` +
      (executionContext.membership.reason ? ` (${executionContext.membership.reason})` : "")
    );
  }
  const context = executionContext.context;
  const constituents = executionContext.constituents;
  const resolvedWindow = executionContext.resolvedWindow;

  // Step 2: Load configuration
  let regimeConfig: LoadedP3ScoreConfig<Record<string, number>>;
  let rotationConfig: LoadedP3ScoreConfig<Record<string, number>>;
  try {
    regimeConfig = await loadRegimeScoreConfig();
    rotationConfig = await loadRotationScoreConfig();
  } catch (error) {
    throw new P3ConfigurationError(
      `Failed to load P3 configuration: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const regimeThresholds = regimeConfig.configValue as unknown as RegimeThresholds;
  const rotationThresholds = rotationConfig.configValue as unknown as RotationThresholds;

  // Step 3: P3-04 Breadth
  const breadthInputs = await prepareBreadthInputs(
    config.narrativeId,
    config.windowEnd,
    constituents
  );
  const breadthResult = calculateBreadthResult(context, breadthInputs.constituents);

  // Step 4: P3-05 Momentum
  const momentumInputs = await prepareMomentumInputs(
    config.narrativeId,
    config.windowEnd
  );
  const momentumResult = calculateP3MomentumResult(
    context,
    momentumInputs.observations
  );

  // Step 5: P3-06 Relative Strength
  const rsInputs = await prepareRelativeStrengthInputs(context);
  const relativeStrengthResult = calculateRelativeStrengthResult(
    context,
    rsInputs.constituents,
    rsInputs.btc
  );

  // Step 6: P3-07 Leadership
  // Wire canonical P3-06 7D per-coin returns to Leadership inputs
  const rsConstituentReturns = (relativeStrengthResult.provenance?.constituentReturns7d as ReadonlyMap<number, number> | undefined) ?? undefined;
  const leadershipInputs = await prepareLeadershipInputs(
    config.narrativeId,
    config.windowEnd,
    constituents,
    rsConstituentReturns,
    context.featureVersionId ?? undefined
  );
  const leadershipResult = await calculateLeadershipResult(
    context,
    leadershipInputs.constituents,
    leadershipInputs.history
  );

  // Step 7: P3-08 Regime (requires upstream results)
  // Use prepareRegimeInputs to load narrative health and calculate breadth/RS changes from historical data
  const regimeInputs = await prepareRegimeInputs(
    config.narrativeId,
    config.windowEnd,
    {
      health: null, // Will be loaded by prepareRegimeInputs
      healthChange: null, // Will be calculated by prepareRegimeInputs
      breadth: extractMetricValue(breadthResult, "breadth"),
      breadthChange: null, // Will be calculated from historical breadth in prepareRegimeInputs
      momentum: extractMetricValue(momentumResult, "momentum7d"),
      acceleration: extractMetricValue(momentumResult, "acceleration"),
      relativeStrength: extractMetricValue(relativeStrengthResult, "relativeStrength7d"),
      relativeStrengthChange: null, // Will be calculated from historical RS in prepareRegimeInputs
      confidence: breadthResult.confidence,
    }
  );
  const regimeContext = createP3ModuleContext(
    context,
    P3_REGIME_ALGORITHM_KEY,
    P3_REGIME_ALGORITHM_VERSION,
    regimeConfig
  );
  const regimeResult = calculateRegimeResult(regimeContext, regimeInputs as RegimeInputs, regimeThresholds);

  // Step 8: P3-09 Rotation (requires upstream results + volume/OI)
  // Pass current P3-06 relativeStrength7d to Rotation for canonical RS input
  const currentRS7d = (relativeStrengthResult.metrics?.relativeStrength7d?.value as number | null) ?? null;
  const rotationInputs = await prepareRotationInputs(
    config.narrativeId,
    config.windowEnd,
    constituents,
    currentRS7d
  );

  // Normalize rotation components according to P3-09 contract
  // Health Momentum: already normalized to 0-100 in preparation layer
  const healthMomentum = rotationInputs.healthMomentum;

  // Breadth Momentum: now calculated in preparation layer from historical breadth
  // Normalize breadth change to 0-100 (already done in preparation, but ensure it's correct)
  const breadthMomentum = rotationInputs.breadthMomentum;

  // Relative Strength: use the value from preparation layer (loaded from historical RS)
  // If preparation layer didn't load it, fall back to current P3-06 result
  const relativeStrength = rotationInputs.relativeStrength != null
    ? normalizeRelativeStrength(rotationInputs.relativeStrength)
    : (() => {
        const rsValue = extractMetricValue(relativeStrengthResult, "relativeStrength7d");
        return rsValue != null ? normalizeRelativeStrength(rsValue) : null;
      })();

  // Volume Expansion: normalize the expansion ratio to 0-100
  const volumeExpansion = rotationInputs.volumeExpansion != null
    ? normalizeVolumeExpansion(rotationInputs.volumeExpansion + 1)
    : null;

  // OI Confirmation: now calculated in preparation layer with proper matrix
  // Already normalized to 0-100 in preparation layer
  const oiConfirmation = rotationInputs.oiConfirmation;

  const rotationCompleteInputs: RotationInputs = {
    healthMomentum,
    breadthMomentum,
    relativeStrength,
    volumeExpansion,
    oiConfirmation,
    firstRun: rotationInputs.firstRun,
  };

  const rotationContext = createP3ModuleContext(
    context,
    P3_ROTATION_ALGORITHM_KEY,
    P3_ROTATION_ALGORITHM_VERSION,
    rotationConfig
  );
  const rotationResult = calculateRotationResult(rotationContext, rotationCompleteInputs, rotationThresholds);

  // Step 9: Aggregate and persist final result
  // Create a new context with the orchestrator's algorithm identity
  const orchestratorContext = createCalculationContext({
    ...context,
    algorithmKey: "p3-orchestrator",
    algorithmVersion: "1",
    scoreConfigId: null,
    provenance: {
      ...context.provenance,
      scoreConfigs: {
        regime: {
          id: regimeConfig.id,
          configType: regimeConfig.configType,
          configKey: regimeConfig.configKey,
          version: regimeConfig.version,
        },
        rotation: {
          id: rotationConfig.id,
          configType: rotationConfig.configType,
          configKey: rotationConfig.configKey,
          version: rotationConfig.version,
        },
      },
    },
  });

  const aggregateResult = aggregateP3Results(
    orchestratorContext,
    breadthResult,
    momentumResult,
    relativeStrengthResult,
    leadershipResult,
    regimeResult,
    rotationResult
  );

  console.log("\nP3-08 Regime (pre-persistence):");
  console.log(`  Availability: ${regimeResult.availabilityState}`);
  console.log(`  Confidence: ${regimeResult.confidence}`);
  console.log(`  Metrics: ${JSON.stringify(regimeResult.metrics)}`);
  console.log(`  Provenance: ${JSON.stringify(regimeResult.provenance)}`);

  // PERSISTENCE GATE: ALL mandatory stages must be VALID before persistence.
  // Partial/insufficient results must not be persisted as historical artifacts.
  validateMandatoryStages(
    breadthResult,
    momentumResult,
    relativeStrengthResult,
    leadershipResult,
    regimeResult,
    rotationResult
  );

  const persistence = await persistP3Calculation({
    context: orchestratorContext,
    result: aggregateResult,
    membershipSource: "authoritative_membership_snapshot",
    membershipMode: context.calculationMode,
  });

  return {
    executionContext,
    breadthResult,
    momentumResult,
    relativeStrengthResult,
    leadershipResult,
    regimeResult,
    rotationResult,
    persistence,
  };
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Extracts a numeric value from a P3CalculationResult metric.
 * Returns null if the metric is missing or unavailable.
 */
export function extractMetricValue(result: P3CalculationResult, metricName: string): number | null {
  const metric = result.metrics[metricName];
  if (!metric || metric.state !== "VALID" || metric.value == null) {
    return null;
  }
  if (typeof metric.value === "number") {
    return metric.value;
  }
  if (typeof metric.value === "string") {
    const parsed = parseFloat(metric.value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Aggregates all P3 module results into a single authoritative result.
 * This builds the final p3_narrative_intelligence record.
 */
function aggregateP3Results(
  context: P3CalculationContext,
  breadthResult: P3CalculationResult,
  momentumResult: P3CalculationResult,
  relativeStrengthResult: P3CalculationResult,
  leadershipResult: P3CalculationResult,
  regimeResult: P3CalculationResult,
  rotationResult: P3CalculationResult
): P3CalculationResult {
  // Collect all metrics from individual modules
  const aggregatedMetrics: P3CalculationResult["metrics"] = {
    ...breadthResult.metrics,
    ...momentumResult.metrics,
    ...relativeStrengthResult.metrics,
    ...leadershipResult.metrics,
    ...regimeResult.metrics,
    ...rotationResult.metrics,
  };

  // Determine overall availability state
  const availabilityStates = [
    breadthResult.availabilityState,
    momentumResult.availabilityState,
    relativeStrengthResult.availabilityState,
    leadershipResult.availabilityState,
    regimeResult.availabilityState,
    rotationResult.availabilityState,
  ] as const;

  // If any module is INSUFFICIENT_HISTORY, propagate that state
  const overallAvailability = availabilityStates.includes("INSUFFICIENT_HISTORY" as const)
    ? ("INSUFFICIENT_HISTORY" as const)
    : availabilityStates.includes("INVALID" as const)
    ? ("INVALID" as const)
    : availabilityStates.includes("MISSING" as const)
    ? ("MISSING" as const)
    : ("VALID" as const);

  // Aggregate confidence (use the minimum if all have confidence)
  const confidences = [
    breadthResult.confidence,
    momentumResult.confidence,
    relativeStrengthResult.confidence,
    leadershipResult.confidence,
    regimeResult.confidence,
    rotationResult.confidence,
  ].filter((c): c is number => c != null);

  const overallConfidence = confidences.length > 0
    ? Math.min(...confidences)
    : null;

  // Build aggregated explanation
  const explanation = {
    breadth: breadthResult.explanation,
    momentum: momentumResult.explanation,
    relativeStrength: relativeStrengthResult.explanation,
    leadership: leadershipResult.explanation,
    regime: regimeResult.explanation,
    rotation: rotationResult.explanation,
  };

  // Build aggregated provenance
  const provenance = {
    ...context.provenance,
    modules: {
      breadth: breadthResult.provenance,
      momentum: momentumResult.provenance,
      relativeStrength: relativeStrengthResult.provenance,
      leadership: leadershipResult.provenance,
      regime: regimeResult.provenance,
      rotation: rotationResult.provenance,
    },
  };

  // Use normalizeResult to construct the final result with proper context fields
  return normalizeResult(context, {
    availabilityState: overallAvailability,
    confidence: overallConfidence,
    metrics: aggregatedMetrics,
    explanation,
    provenance,
  });
}
