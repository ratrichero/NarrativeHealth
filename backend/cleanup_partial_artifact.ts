import { db } from "@/db";
import { p3NarrativeIntelligence } from "@/db/schema";
import { eq, and } from "drizzle-orm";

async function cleanupPartialArtifact() {
  console.log("Cleaning up partial artifact...\n");

  const result = await db.delete(p3NarrativeIntelligence)
    .where(and(
      eq(p3NarrativeIntelligence.narrativeId, 1),
      eq(p3NarrativeIntelligence.windowEnd, new Date("2026-08-11T00:00:00Z")),
      eq(p3NarrativeIntelligence.algorithmKey, "p3-orchestrator"),
      eq(p3NarrativeIntelligence.algorithmVersion, "1"),
      eq(p3NarrativeIntelligence.calculationMode, "observed")
    ))
    .returning({ id: p3NarrativeIntelligence.id });

  console.log("Deleted rows:", result);
  console.log("Cleanup complete. Ready for authoritative execution.");
}

cleanupPartialArtifact().catch(console.error);
