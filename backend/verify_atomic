import { db } from "@/db";
import { sql } from "drizzle-orm";

async function verifyAtomicity() {
  console.log("=== ATOMICITY VERIFICATION ===\n");

  // Check P3 intelligence artifacts
  const artifacts = await db.execute(sql`
    SELECT
      id,
      narrative_id,
      window_end,
      algorithm_key,
      algorithm_version,
      calculation_mode,
      availability_state,
      regime,
      rotation,
      persisted_at
    FROM p3_narrative_intelligence
    WHERE narrative_id = 1
      AND window_end = '2026-08-11 00:00:00'::timestamp
    ORDER BY persisted_at DESC
  `);

  console.log("P3 Intelligence Artifacts:");
  console.table(artifacts.rows);

  // Check constituent snapshots
  const snapshots = await db.execute(sql`
    SELECT
      id,
      intelligence_id,
      captured_at,
      membership_source,
      member_count,
      eligible_count
    FROM p3_constituent_snapshots
    WHERE intelligence_id = 1
    ORDER BY captured_at DESC
  `);

  console.log("\nConstituent Snapshots:");
  console.table(snapshots.rows);

  // Check leadership members
  const leadership = await db.execute(sql`
    SELECT
      intelligence_id,
      coin_id,
      leader_score,
      leader_rank
    FROM p3_leadership_members
    WHERE intelligence_id = 1
    ORDER BY leader_rank
  `);

  console.log("\nLeadership Members:");
  console.table(leadership.rows);

  // Verify counts
  console.log("\n=== VERIFICATION SUMMARY ===");
  console.log(`Total P3 artifacts for this window: ${artifacts.rows.length}`);
  console.log(`Total constituent snapshots: ${snapshots.rows.length}`);
  console.log(`Total leadership members: ${leadership.rows.length}`);
  console.log(`Regime: ${artifacts.rows[0]?.regime}`);
  console.log(`Rotation: ${artifacts.rows[0]?.rotation}`);
  console.log(`Availability: ${artifacts.rows[0]?.availability_state}`);

  if (artifacts.rows.length === 1 && 
      artifacts.rows[0].regime === 'NEUTRAL' && 
      artifacts.rows[0].rotation === 'ACCELERATING' &&
      artifacts.rows[0].availability_state === 'VALID') {
    console.log("\n✅ ATOMICITY VERIFICATION PASSED");
  } else {
    console.log("\n❌ ATOMICITY VERIFICATION FAILED");
  }
}

verifyAtomicity().catch(console.error);
