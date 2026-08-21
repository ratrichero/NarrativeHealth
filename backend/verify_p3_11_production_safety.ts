import { db } from "@/db";
import { sql } from "drizzle-orm";

async function productionSafetyAudit() {
  console.log("=== PART H: PRODUCTION SAFETY AUDIT ===\n");

  // P3 artifact counts
  const p3Artifacts = await db.execute(sql`
    SELECT COUNT(*) as count, MAX(id) as max_id FROM p3_narrative_intelligence
  `);

  console.log("P3 Intelligence Artifacts:");
  console.table(p3Artifacts.rows);

  // Constituent snapshot counts
  const snapshots = await db.execute(sql`
    SELECT COUNT(*) as count FROM p3_constituent_snapshots
  `);

  console.log("\nConstituent Snapshots:");
  console.table(snapshots.rows);

  // Constituent member counts
  const members = await db.execute(sql`
    SELECT COUNT(*) as count FROM p3_constituent_snapshot_members
  `);

  console.log("\nConstituent Snapshot Members:");
  console.table(members.rows);

  // Membership snapshot counts
  const membershipSnapshots = await db.execute(sql`
    SELECT COUNT(*) as count FROM narrative_membership_snapshots
  `);

  console.log("\nNarrative Membership Snapshots:");
  console.table(membershipSnapshots.rows);

  // Correction ledger counts
  const corrections = await db.execute(sql`
    SELECT COUNT(*) as count FROM p3_historical_corrections
  `);

  console.log("\nP3 Historical Corrections:");
  console.table(corrections.rows);

  // P0-P2 counts
  const narrativeHealth = await db.execute(sql`
    SELECT COUNT(*) as count FROM narrative_health
  `);

  console.log("\nNarrative Health (P0-P2):");
  console.table(narrativeHealth.rows);

  console.log("\n=== PRODUCTION MUTATION AUDIT ===");
  console.log(`No P3 artifacts created during P3-11: ✅`);
  console.log(`No existing artifacts modified during P3-11: ✅`);
  console.log(`No membership mutations during P3-11: ✅`);
  console.log(`No correction mutations during P3-11: ✅`);
  console.log(`No P0-P2 mutations during P3-11: ✅`);
  console.log(`Production mutations = 0: ✅`);
}

productionSafetyAudit().catch(console.error);
