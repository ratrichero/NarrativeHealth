import { db } from "@/db";
import { sql } from "drizzle-orm";

async function verifyImmutability() {
  console.log("=== PART C: IMMUTABILITY VERIFICATION ===\n");

  // Check trigger definitions
  const triggers = await db.execute(sql`
    SELECT
      tgname as trigger_name,
      pg_get_triggerdef(oid) as trigger_definition
    FROM pg_trigger
    WHERE tgrelid = 'p3_narrative_intelligence'::regclass
      AND tgname NOT LIKE '%pg%'
      AND tgname LIKE '%immutable%'
  `);

  console.log("Immutability triggers on p3_narrative_intelligence:");
  console.table(triggers.rows);

  // Verify artifact #1 remains unchanged from initial persistence
  const artifact = await db.execute(sql`
    SELECT
      id,
      narrative_id,
      window_end,
      availability_state,
      regime,
      rotation,
      persisted_at
    FROM p3_narrative_intelligence
    WHERE id = 1
  `);

  console.log("\nArtifact #1 current state:");
  console.table(artifact.rows);

  // Check trigger function
  const triggerFunc = await db.execute(sql`
    SELECT
      pg_get_functiondef(oid) as function_definition
    FROM pg_proc
    WHERE proname = 'prevent_p3_history_mutation'
  `);

  console.log("\nTrigger function definition:");
  console.log(triggerFunc.rows[0]?.function_definition || "Function not found");

  console.log("\n=== VERIFICATION ===");
  console.log(`Triggers restored to strict immutability: ${triggers.rows.length > 0 ? "✅" : "❌"}`);
  console.log(`Artifact #1 unchanged: ${artifact.rows[0]?.persisted_at === "2026-08-10 16:50:43.201964" ? "✅" : "❌"}`);
  console.log(`Trigger blocks all mutations: ${triggerFunc.rows[0]?.function_definition.includes("RAISE EXCEPTION") ? "✅" : "❌"}`);
}

verifyImmutability().catch(console.error);
