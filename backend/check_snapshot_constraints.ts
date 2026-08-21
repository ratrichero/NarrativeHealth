import { db } from "@/db";
import { sql } from "drizzle-orm";

async function checkSnapshotConstraints() {
  console.log("Checking constraints on p3_constituent_snapshots...\n");

  const result = await db.execute(sql`
    SELECT
      conname as constraint_name,
      pg_get_constraintdef(oid) as constraint_definition
    FROM pg_constraint
    WHERE conrelid = 'p3_constituent_snapshots'::regclass
      AND contype = 'u'
  `);

  console.log("Unique constraints on p3_constituent_snapshots:");
  console.table(result.rows);
}

checkSnapshotConstraints().catch(console.error);
