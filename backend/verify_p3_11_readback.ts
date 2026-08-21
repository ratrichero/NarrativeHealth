import { db } from "@/db";
import { p3NarrativeIntelligence, p3ConstituentSnapshots, p3ConstituentSnapshotMembers } from "@/db/schema";
import { eq, and } from "drizzle-orm";

async function readArtifactThroughApplicationPath() {
  console.log("=== PART A: ARTIFACT READ-BACK VERIFICATION ===\n");

  // Read through the same database layer used by the application
  const artifact = await db.select({
    id: p3NarrativeIntelligence.id,
    narrativeId: p3NarrativeIntelligence.narrativeId,
    windowEnd: p3NarrativeIntelligence.windowEnd,
    periodStart: p3NarrativeIntelligence.periodStart,
    periodEnd: p3NarrativeIntelligence.periodEnd,
    algorithmKey: p3NarrativeIntelligence.algorithmKey,
    algorithmVersion: p3NarrativeIntelligence.algorithmVersion,
    calculationMode: p3NarrativeIntelligence.calculationMode,
    availabilityState: p3NarrativeIntelligence.availabilityState,
    regime: p3NarrativeIntelligence.regime,
    rotation: p3NarrativeIntelligence.rotation,
    breadth: p3NarrativeIntelligence.breadth,
    momentum7d: p3NarrativeIntelligence.momentum7d,
    relativeStrength7d: p3NarrativeIntelligence.relativeStrength7d,
    leaderCoinId: p3NarrativeIntelligence.leaderCoinId,
    leaderScore: p3NarrativeIntelligence.leaderScore,
    concentrationTop1: p3NarrativeIntelligence.concentrationTop1,
    concentrationTop3: p3NarrativeIntelligence.concentrationTop3,
    concentrationClassification: p3NarrativeIntelligence.concentrationClassification,
    provenance: p3NarrativeIntelligence.provenance,
    persistedAt: p3NarrativeIntelligence.persistedAt,
  }).from(p3NarrativeIntelligence).where(and(
    eq(p3NarrativeIntelligence.narrativeId, 1),
    eq(p3NarrativeIntelligence.windowEnd, new Date("2026-08-11T00:00:00Z")),
    eq(p3NarrativeIntelligence.algorithmKey, "p3-orchestrator"),
    eq(p3NarrativeIntelligence.algorithmVersion, "1"),
    eq(p3NarrativeIntelligence.calculationMode, "observed")
  )).limit(1);

  console.log("Artifact #1:");
  console.table(artifact);

  if (artifact.length === 0) {
    console.log("❌ ARTIFACT NOT FOUND");
    return;
  }

  const art = artifact[0];

  // Verify key fields
  console.log("\n=== VERIFICATION ===");
  console.log(`artifact exists: ${art.id ? "✅" : "❌"}`);
  console.log(`narrativeId = 1: ${art.narrativeId === 1 ? "✅" : "❌"}`);
  console.log(`windowEnd = 2026-08-11: ${art.windowEnd?.toISOString() === "2026-08-11T00:00:00.000Z" ? "✅" : "❌"}`);
  console.log(`calculationMode = observed: ${art.calculationMode === "observed" ? "✅" : "❌"}`);
  console.log(`availabilityState = VALID: ${art.availabilityState === "VALID" ? "✅" : "❌"}`);
  console.log(`regime = NEUTRAL: ${art.regime === "NEUTRAL" ? "✅" : "❌"}`);
  console.log(`rotation = ACCELERATING: ${art.rotation === "ACCELERATING" ? "✅" : "❌"}`);
  console.log(`breadth available: ${art.breadth ? "✅" : "❌"}`);
  console.log(`momentum7d available: ${art.momentum7d ? "✅" : "❌"}`);
  console.log(`relativeStrength7d available: ${art.relativeStrength7d ? "✅" : "❌"}`);
  console.log(`leaderCoinId available: ${art.leaderCoinId ? "✅" : "❌"}`);
  console.log(`provenance readable: ${art.provenance ? "✅" : "❌"}`);

  // Read constituent snapshot
  const snapshot = await db.select({
    id: p3ConstituentSnapshots.id,
    intelligenceId: p3ConstituentSnapshots.intelligenceId,
    memberCount: p3ConstituentSnapshots.memberCount,
    eligibleCount: p3ConstituentSnapshots.eligibleCount,
  }).from(p3ConstituentSnapshots).where(eq(p3ConstituentSnapshots.intelligenceId, art.id)).limit(1);

  console.log("\nConstituent Snapshot:");
  console.table(snapshot);

  const members = await db.select({
    coinId: p3ConstituentSnapshotMembers.coinId,
    membershipState: p3ConstituentSnapshotMembers.membershipState,
  }).from(p3ConstituentSnapshotMembers).where(eq(p3ConstituentSnapshotMembers.snapshotId, snapshot[0]?.id));

  console.log("\nConstituent Members:");
  console.table(members);

  console.log(`\nConstituent snapshot exists: ${snapshot.length > 0 ? "✅" : "❌"}`);
  console.log(`Exactly 7 constituent members: ${members.length === 7 ? "✅" : "❌"}`);

  // Check for serialization errors
  try {
    const provenanceParsed = JSON.parse(JSON.stringify(art.provenance));
    console.log(`Provenance serialization: ✅`);
  } catch (error) {
    console.log(`Provenance serialization: ❌ (${error})`);
  }
}

readArtifactThroughApplicationPath().catch(console.error);
