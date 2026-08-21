import { db } from "@/db";
import { sql } from "drizzle-orm";

async function inspectTrigger() {
  console.log("Inspecting P3 immutability trigger...\n");

  const result = await db.execute(sql`
    SELECT
      pg_get_triggerdef(oid) as trigger_definition
    FROM pg_trigger
    WHERE tgname = 'prevent_p3_history_mutation'
  `);

  console.log("Trigger definition:");
  console.log(result.rows[0]?.trigger_definition || "Trigger not found");
}

inspectTrigger().catch(console.error);
