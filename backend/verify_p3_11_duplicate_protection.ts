import { db } from "@/db";
import { sql } from "drizzle-orm";

async function verifyDuplicateProtection() {
  console.log("=== PART D: DUPLICATE PROTECTION VERIFICATION ===\n");

  // Check unique constraint
  const constraints = await db.execute(sql`
    SELECT
      conname as constraint_name,
      pg_get_constraintdef(oid) as constraint_definition
    FROM pg_constraint
    WHERE conrelid = 'p3_narrative_intelligence'::regclass
      AND contype = 'u'
  `);

  console.log("Unique constraints on p3_narrative_intelligence:");
  console.table(constraints.rows);

  // Count artifacts for this identity
  const count = await db.execute(sql`
    SELECT COUNT(*) as count
    FROM p3_narrative_intelligence
    WHERE narrative_id = 1
      AND window_end = '2026-08-11 00:00:00'::timestamp
      AND algorithm_key = 'p3-orchestrator'
      AND algorithm_version = '1'
      AND calculation_mode = 'observed'
  `);

  console.log("\nArtifact count for this identity:");
  console.table(count.rows);

  // Check persistence code for upsert logic
  console.log("\n=== VERIFICATION ===");
  console.log(`Unique constraint exists: ${constraints.rows.length > 0 ? "✅" : "❌"}`);
  console.log(`Constraint protects identity: ${constraints.rows[0]?.constraint_definition.includes("narrative_id, window_end, algorithm_key, algorithm_version, calculation_mode") ? "✅" : "❌"}`);
  console.log(`Artifact count = 1: ${count.rows[0]?.count === 1 || count.rows[0]?.count === '1' ? "✅" : "❌"}`);
  console.log(`Duplicate protection verified: ${constraints.rows.length > 0 && (count.rows[0]?.count === 1 || count.rows[0]?.count === '1') ? "✅" : "❌"}`);
}

verifyDuplicateProtection().catch(console.error);
