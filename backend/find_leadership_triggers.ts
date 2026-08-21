import { db } from "@/db";
import { sql } from "drizzle-orm";

async function findLeadershipTriggers() {
  console.log("Finding triggers on p3_leadership_members...\n");

  const result = await db.execute(sql`
    SELECT
      tgname as trigger_name,
      pg_get_triggerdef(oid) as trigger_definition
    FROM pg_trigger
    WHERE tgrelid = 'p3_leadership_members'::regclass
      AND tgname NOT LIKE '%pg%'
  `);

  console.log("Triggers on p3_leadership_members:");
  console.table(result.rows);
}

findLeadershipTriggers().catch(console.error);
