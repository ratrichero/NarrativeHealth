import { db } from "@/db";
import { p3NarrativeIntelligence } from "@/db/schema";

async function testMinimalInsert() {
  console.log("Testing minimal insert...");

  try {
    const result = await db.insert(p3NarrativeIntelligence).values({
      narrativeId: 1,
      windowEnd: new Date("2026-08-11T00:00:00Z"),
      periodStart: new Date("2026-08-03T00:00:00Z"),
      periodEnd: new Date("2026-08-11T00:00:00Z"),
      algorithmKey: "p3-orchestrator",
      algorithmVersion: "1",
      ruleVersionId: 1,
      featureVersionId: 1,
      scoreConfigId: 2,
      membershipSnapshotId: 2,
      calculationMode: "observed",
      availabilityState: "VALID",
      confidence: null,
      breadth: "0.14",
      strongBreadth: "0",
      momentum1d: "-1.31",
      momentum3d: "3.67",
      momentum7d: "14.03",
      momentum14d: null,
      acceleration: "4.98",
      relativeStrength1d: "-0.012",
      relativeStrength3d: "-0.011",
      relativeStrength7d: "-0.011",
      relativeStrength14d: "-0.039",
      leaderCoinId: 10,
      leaderScore: "89.29",
      concentrationTop1: "0.26",
      concentrationTop3: "0.58",
      concentrationClassification: "Concentrated",
      regime: "NEUTRAL",
      rotation: "ACCELERATING",
      rotationScore: "75.19",
      explanation: null,
      provenance: { test: "minimal" },
      calculatedAt: new Date(),
    }).returning({ id: p3NarrativeIntelligence.id });

    console.log("SUCCESS:", result);
  } catch (error) {
    console.error("ERROR:", error);
    if (error instanceof Error) {
      console.error("Message:", error.message);
      console.error("Cause:", error.cause);
    }
  }
}

testMinimalInsert().catch(console.error);
