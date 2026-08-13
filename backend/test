import { db } from "@/db";
import { p3NarrativeIntelligence } from "@/db/schema";
import { eq, and } from "drizzle-orm";

async function testUpdate() {
  console.log("Testing UPDATE on existing artifact...\n");

  try {
    const result = await db.update(p3NarrativeIntelligence)
      .set({
        regime: "NEUTRAL",
        rotation: "ACCELERATING",
        availabilityState: "VALID",
      })
      .where(and(
        eq(p3NarrativeIntelligence.narrativeId, 1),
        eq(p3NarrativeIntelligence.windowEnd, new Date("2026-08-11T00:00:00Z")),
        eq(p3NarrativeIntelligence.algorithmKey, "p3-orchestrator"),
        eq(p3NarrativeIntelligence.algorithmVersion, "1"),
        eq(p3NarrativeIntelligence.calculationMode, "observed")
      ))
      .returning({ id: p3NarrativeIntelligence.id, regime: p3NarrativeIntelligence.regime });

    console.log("UPDATE SUCCESS:", result);
  } catch (error) {
    console.error("UPDATE ERROR:", error);
    if (error instanceof Error) {
      console.error("Message:", error.message);
    }
  }
}

testUpdate().catch(console.error);
