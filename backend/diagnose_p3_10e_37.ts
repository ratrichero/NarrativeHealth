/**
 * P3-10E.37 Diagnostic - Verify Leadership and Regime blockers on production data
 * 
 * This is a READ-ONLY diagnostic. It does not persist anything.
 */
require("dotenv").config({ path: "./.env" });
if (!process.env.DATABASE_URL) {
  require("dotenv").config({ path: "../.env" });
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not found");
  process.exit(1);
}

import { runP3AuthoritativeExecution } from "../src/lib/p3/orchestrator";
import { resolveP3Membership } from "../src/lib/p3/membership";
import { prepareLeadershipInputs, prepareRegimeInputs, prepareRotationInputs, createP3ExecutionContext } from "../src/lib/p3/preparation";
import { calculateLeadership } from "../src/lib/p3/leadership";
import { classifyRegime } from "../src/lib/p3/regime";
import { calculateRotation } from "../src/lib/p3/rotation";
import { loadRegimeScoreConfig, loadRotationScoreConfig } from "../src/lib/p3/preparation";
import { calculateRelativeStrengthResult } from "../src/lib/p3/relative-strength";
import { prepareRelativeStrengthInputs } from "../src/lib/p3/preparation";
import { calculateBreadthResult } from "../src/lib/p3/breadth";
import { prepareBreadthInputs } from "../src/lib/p3/preparation";
import { calculateP3MomentumResult } from "../src/lib/services/momentum.service";
import { prepareMomentumInputs } from "../src/lib/p3/preparation";
import { extractMetricValue } from "../src/lib/p3/orchestrator";

async function main() {
  const config = {
    narrativeId: 1,
    window: "7D" as const,
    windowEnd: new Date("2026-08-11T00:00:00Z"),
    calculationMode: "observed" as const,
  };

  console.log("=".repeat(70));
  console.log("P3-10E.37 DIAGNOSTIC - PRODUCTION DATA");
  console.log("=".repeat(70));
  console.log(`Narrative: AI (${config.narrativeId})`);
  console.log(`Window: ${config.window}`);
  console.log(`Window End: ${config.windowEnd.toISOString()}`);
  console.log(`Mode: ${config.calculationMode}`);
  console.log();

  // Step 1: Resolve membership
  console.log("## 1. MEMBERSHIP RESOLUTION");
  const membership = await resolveP3Membership(config.narrativeId, config.windowEnd, { mode: "observed" });
  console.log(`  Availability: ${membership.availability}`);
  console.log(`  Source: ${membership.source}`);
  console.log(`  Snapshot ID: ${membership.snapshotId}`);
  console.log(`  Members: ${membership.constituents.length}`);
  for (const m of membership.constituents) {
    console.log(`    coinId=${m.coinId}, isPrimary=${m.isPrimary}`);
  }
  console.log();

  // Step 2: Create execution context
  console.log("## 2. EXECUTION CONTEXT");
  const executionContext = await createP3ExecutionContext(config);
  const context = executionContext.context;
  const constituents = executionContext.constituents;
  console.log(`  Constituents: ${constituents.length}`);
  for (const c of constituents) {
    console.log(`    coinId=${c.coinId}, state=${c.membershipState}, avail=${c.availabilityState}, manifest=${JSON.stringify(c.inputManifest)}`);
  }
  console.log(`  featureVersionId: ${context.featureVersionId}`);
  console.log(`  ruleVersionId: ${context.ruleVersionId}`);
  console.log();

  // Step 3: P3-04 Breadth
  console.log("## 3. P3-04 BREADTH");
  const breadthInputs = await prepareBreadthInputs(config.narrativeId, config.windowEnd, constituents);
  const breadthResult = calculateBreadthResult(context, breadthInputs.constituents);
  console.log(`  Availability: ${breadthResult.availabilityState}`);
  console.log(`  Metrics: ${JSON.stringify(breadthResult.metrics)}`);
  console.log();

  // Step 4: P3-05 Momentum
  console.log("## 4. P3-05 MOMENTUM");
  const momentumInputs = await prepareMomentumInputs(config.narrativeId, config.windowEnd);
  const momentumResult = calculateP3MomentumResult(context, momentumInputs.observations);
  console.log(`  Availability: ${momentumResult.availabilityState}`);
  console.log(`  Metrics: ${JSON.stringify(momentumResult.metrics)}`);
  console.log();

  // Step 5: P3-06 Relative Strength
  console.log("## 5. P3-06 RELATIVE STRENGTH");
  const rsInputs = await prepareRelativeStrengthInputs(context);
  const relativeStrengthResult = calculateRelativeStrengthResult(context, rsInputs.constituents, rsInputs.btc);
  console.log(`  Availability: ${relativeStrengthResult.availabilityState}`);
  console.log(`  Metrics: ${JSON.stringify(relativeStrengthResult.metrics)}`);
  console.log(`  Provenance keys: ${Object.keys(relativeStrengthResult.provenance).join(", ")}`);
  const rsMap = relativeStrengthResult.provenance?.constituentReturns7d as ReadonlyMap<number, number> | undefined;
  if (rsMap) {
    console.log(`  constituentReturns7d (raw coin returns):`);
    for (const [coinId, value] of rsMap) {
      console.log(`    coinId=${coinId}: return=${value}`);
    }
  } else {
    console.log(`  constituentReturns7d: NOT PRESENT`);
  }
  console.log();

  // Step 6: P3-07 Leadership
  console.log("## 6. P3-07 LEADERSHIP");
  const rsConstituentReturns = rsMap ?? undefined;
  const leadershipInputs = await prepareLeadershipInputs(
    config.narrativeId,
    config.windowEnd,
    constituents,
    rsConstituentReturns,
    context.featureVersionId ?? undefined
  );
  console.log(`  Leadership constituents (${leadershipInputs.constituents.length}):`);
  for (const c of leadershipInputs.constituents) {
    console.log(`    coinId=${c.coinId}: marketCap=${c.marketCapAvailable}, health=${c.health}, volumeScore=${c.volumeScore}, coinReturn7d=${c.coinReturn7d}, relativeStrength7d=${c.relativeStrength7d}, instrument=${c.instrument}`);
  }
  const leadershipCalc = calculateLeadership(leadershipInputs.constituents, leadershipInputs.history);
  console.log(`  Leadership availability: ${leadershipCalc.availabilityState}`);
  console.log(`  Excluded: ${JSON.stringify(leadershipCalc.excluded)}`);
  console.log(`  Ranked: ${leadershipCalc.ranked.length}`);
  console.log();

  // Step 7: P3-08 Regime
  console.log("## 7. P3-08 REGIME");
  const regimeInputs = await prepareRegimeInputs(config.narrativeId, config.windowEnd, {
    health: null,
    healthChange: null,
    breadth: extractMetricValue(breadthResult, "breadth"),
    breadthChange: null,
    momentum: extractMetricValue(momentumResult, "momentum7d"),
    acceleration: extractMetricValue(momentumResult, "acceleration"),
    relativeStrength: extractMetricValue(relativeStrengthResult, "relativeStrength7d"),
    relativeStrengthChange: null,
    confidence: breadthResult.confidence,
  });
  console.log(`  Regime inputs: ${JSON.stringify(regimeInputs)}`);
  const regimeConfig = await loadRegimeScoreConfig();
  const regimeThresholds = regimeConfig.configValue as Record<string, number>;
  console.log(`  Regime thresholds: ${JSON.stringify(regimeThresholds)}`);
  const regimeResult = classifyRegime(regimeInputs as any, regimeThresholds as any);
  console.log(`  Regime availability: ${regimeResult.availabilityState}`);
  console.log(`  Regime: ${regimeResult.regime}`);
  console.log(`  Reasons: ${JSON.stringify(regimeResult.reasons)}`);
  console.log();

  // Step 8: P3-09 Rotation
  console.log("## 8. P3-09 ROTATION");
  const currentRS7d = (relativeStrengthResult.metrics?.relativeStrength7d?.value as number | null) ?? null;
  const rotationInputs = await prepareRotationInputs(config.narrativeId, config.windowEnd, constituents, currentRS7d);
  console.log(`  Rotation inputs: ${JSON.stringify(rotationInputs)}`);
  const rotationConfig = await loadRotationScoreConfig();
  const rotationThresholds = rotationConfig.configValue as Record<string, number>;
  console.log(`  Rotation thresholds: ${JSON.stringify(rotationThresholds)}`);
  const rotationResult = calculateRotation(rotationInputs as any, rotationThresholds as any);
  console.log(`  Rotation availability: ${rotationResult.availabilityState}`);
  console.log(`  Rotation state: ${rotationResult.state}`);
  console.log(`  Rotation score: ${rotationResult.score}`);
  console.log(`  Reasons: ${JSON.stringify(rotationResult.reasons)}`);
  console.log();

  console.log("=".repeat(70));
  console.log("DIAGNOSTIC COMPLETE");
  console.log("=".repeat(70));
}

main().catch((error) => {
  console.error("Diagnostic failed:", error);
  process.exit(1);
});