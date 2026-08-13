import { db } from "@/db";
import { p3ConstituentSnapshots, p3ConstituentSnapshotMembers, p3LeadershipMembers } from "@/db/schema";
import { eq } from "drizzle-orm";

async function cleanupInvalidArtifacts() {
  console.log("Cleaning up invalid P3 artifacts...\n");

  try {
    // Delete leadership members first (FK dependency)
    const deletedLeadership = await db.delete(p3LeadershipMembers)
      .where(eq(p3LeadershipMembers.intelligenceId, 1))
      .returning({ id: p3LeadershipMembers.coinId });
    console.log("Deleted leadership members:", deletedLeadership.length);

    // Delete snapshot members first (FK dependency)
    const deletedMembers = await db.delete(p3ConstituentSnapshotMembers)
      .where(eq(p3ConstituentSnapshotMembers.snapshotId, 1))
      .returning({ id: p3ConstituentSnapshotMembers.coinId });
    console.log("Deleted snapshot members:", deletedMembers.length);

    // Delete snapshots
    const deletedSnapshots = await db.delete(p3ConstituentSnapshots)
      .where(eq(p3ConstituentSnapshots.intelligenceId, 1))
      .returning({ id: p3ConstituentSnapshots.id });
    console.log("Deleted snapshots:", deletedSnapshots.length);

    console.log("\nCleanup complete. Ready for authoritative execution.");
  } catch (error) {
    console.error("ERROR:", error);
    if (error instanceof Error) {
      console.error("Message:", error.message);
    }
  }
}

cleanupInvalidArtifacts().catch(console.error);
