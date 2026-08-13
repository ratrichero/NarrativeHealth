import { db } from "@/db";
import { sql } from "drizzle-orm";

async function findSnapshotTriggers() {
  console.log("Finding triggers on p3_constituent_snapshots...\n");

  const result = await db.execute(sql`
    SELECT
      tgname as trigger_name,
      pg_get_triggerdef(oid) as trigger_definition
    FROM pg_trigger
    WHERE tgrelid = 'p3_constituent_snapshots'::regclass
      AND tgname NOT LIKE '%pg%'
  `);

  console.log("Triggers on p3_constituent_snapshots:");
  console.table(result.rows);
}

findSnapshotTriggers().catch(console.error);
