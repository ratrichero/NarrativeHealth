import { db } from "@/db";
import { sql } from "drizzle-orm";

async function checkExistingSnapshots() {
  console.log("Checking for existing constituent snapshots...\n");

  const result = await db.execute(sql`
    SELECT
      id,
      intelligence_id,
      captured_at,
      membership_source
    FROM p3_constituent_snapshots
    WHERE intelligence_id = 1
  `);

  console.log("Existing snapshots for intelligence_id=1:");
  console.table(result.rows);
}

checkExistingSnapshots().catch(console.error);
