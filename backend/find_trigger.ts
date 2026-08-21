import { db } from "@/db";
import { sql } from "drizzle-orm";

async function findTrigger() {
  console.log("Finding P3 triggers...\n");

  const result = await db.execute(sql`
    SELECT
      tgname as trigger_name,
      pg_get_triggerdef(oid) as trigger_definition
    FROM pg_trigger
    WHERE tgrelid = 'p3_narrative_intelligence'::regclass
      AND tgname NOT LIKE '%pg%'
  `);

  console.log("Triggers on p3_narrative_intelligence:");
  console.table(result.rows);
}

findTrigger().catch(console.error);
