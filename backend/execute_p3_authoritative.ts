/**
 * P3-10E.11 Controlled Authoritative Execution
 * Direct execution of runP3AuthoritativeExecution for AI narrative
 */

// Load environment from project root
require("dotenv").config({ path: "./.env" });

// Ensure DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  // Fallback: try to load from parent directory
  require("dotenv").config({ path: "../.env" });
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not found. Checked ./.env and ../.env");
  console.error("Available env vars:", Object.keys(process.env).filter(k => k.includes("DATABASE")));
  throw new Error("DATABASE_URL is required");
}

import { runP3AuthoritativeExecution, type P3ExecutionConfig } from "../src/lib/p3/orchestrator";

async function main() {
  console.log("=".repeat(60));
  console.log("P3-10E.11 CONTROLLED AUTHORITATIVE EXECUTION");
  console.log("=".repeat(60));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log();

  // Pre-flight configuration
  // Baseline established at 2026-08-10T16:09:44Z
  // First valid UTC window boundary after baseline: 2026-08-11T00:00:00Z
  const config: P3ExecutionConfig = {
    narrativeId: 1,
    window: "7D",
    windowEnd: new Date("2026-08-11T00:00:00Z"),
    calculationMode: "observed",
  };

  console.log("## Pre-flight Configuration");
  console.log(`  Narrative: AI (ID: ${config.narrativeId})`);
  console.log(`  Window: ${config.window}`);
  console.log(`  Window End: ${config.windowEnd.toISOString()}`);
  console.log(`  Calculation Mode: ${config.calculationMode}`);
  console.log();

  try {
    // Execute the authoritative orchestrator
    console.log("## Executing runP3AuthoritativeExecution...");
    const result = await runP3AuthoritativeExecution(config);
    
    console.log("\n## Execution Results");
    console.log("P3-04 Breadth:");
    console.log(`  Availability: ${result.breadthResult.availabilityState}`);
    console.log(`  Confidence: ${result.breadthResult.confidence}`);
    
    console.log("\nP3-05 Momentum:");
    console.log(`  Availability: ${result.momentumResult.availabilityState}`);
    console.log(`  Confidence: ${result.momentumResult.confidence}`);
    
    console.log("\nP3-06 Relative Strength:");
    console.log(`  Availability: ${result.relativeStrengthResult.availabilityState}`);
    console.log(`  Confidence: ${result.relativeStrengthResult.confidence}`);
    
    console.log("\nP3-07 Leadership:");
    console.log(`  Availability: ${result.leadershipResult.availabilityState}`);
    console.log(`  Confidence: ${result.leadershipResult.confidence}`);
    
    console.log("\nP3-08 Regime:");
    console.log(`  Availability: ${result.regimeResult.availabilityState}`);
    console.log(`  Confidence: ${result.regimeResult.confidence}`);
    console.log(`  Regime metrics: ${JSON.stringify(result.regimeResult.metrics)}`);
    console.log(`  Regime provenance: ${JSON.stringify(result.regimeResult.provenance)}`);
    
    console.log("\nP3-09 Rotation:");
    console.log(`  Availability: ${result.rotationResult.availabilityState}`);
    console.log(`  Confidence: ${result.rotationResult.confidence}`);
    
    console.log("\nPersistence:");
    console.log(`  Inserted: ${result.persistence.inserted ? "YES" : "NO"}`);
    console.log(`  Intelligence ID: ${result.persistence.intelligenceId}`);
    console.log(`  Identity: ${result.persistence.identity}`);
    
    console.log("\n" + "=".repeat(60));
    console.log("EXECUTION COMPLETE");
    console.log("=".repeat(60));
    
  } catch (error) {
    console.error("\n## Execution Failed");
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(`Stack: ${error.stack}`);
    }
    process.exit(1);
  }
}

main();