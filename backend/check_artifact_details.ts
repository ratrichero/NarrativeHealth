import { db } from "@/db";
import { sql } from "drizzle-orm";

async function checkExistingArtifactDetails() {
  console.log("Checking existing artifact details...\n");

  const result = await db.execute(sql`
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
  `);

  console.log("All artifacts for this window:");
  console.table(result.rows);
}

checkExistingArtifactDetails().catch(console.error);
