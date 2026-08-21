import { db } from "@/db";
import { sql } from "drizzle-orm";

async function checkExistingRow() {
  console.log("Checking for existing P3 artifact...\n");

  const result = await db.execute(sql`
    SELECT
      id,
      narrative_id,
      window_end,
      algorithm_key,
      algorithm_version,
      calculation_mode,
      regime,
      rotation,
      availability_state,
      persisted_at
    FROM p3_narrative_intelligence
    WHERE narrative_id = 1
      AND window_end = '2026-08-11 00:00:00'::timestamp
      AND algorithm_key = 'p3-orchestrator'
      AND algorithm_version = '1'
      AND calculation_mode = 'observed'
  `);

  console.log("Existing rows:");
  console.table(result.rows);

  if (result.rows.length > 0) {
    console.log("\nROW ALREADY EXISTS! This is why INSERT fails with duplicate key error.");
    console.log("The upsert logic should handle this by updating the existing row.");
  }
}

checkExistingRow().catch(console.error);
