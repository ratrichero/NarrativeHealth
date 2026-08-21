import { db } from "@/db";
import { sql } from "drizzle-orm";

async function modifyTriggerForInvalidArtifacts() {
  console.log("Modifying trigger to allow updates on invalid artifacts...\n");

  try {
    // Create the function first
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION prevent_p3_history_mutation_for_valid()
      RETURNS TRIGGER AS $$
      BEGIN
        -- Only block updates if the artifact is currently VALID
        IF OLD.availability_state = 'VALID' THEN
          RAISE EXCEPTION 'P3 historical records are immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    console.log("Created/updated trigger function");

    // Drop the existing trigger
    await db.execute(sql`
      DROP TRIGGER IF EXISTS p3_narrative_intelligence_immutable ON p3_narrative_intelligence
    `);
    console.log("Dropped existing trigger");

    // Create a new trigger that only blocks updates on VALID artifacts
    await db.execute(sql`
      CREATE TRIGGER p3_narrative_intelligence_immutable
      BEFORE UPDATE ON p3_narrative_intelligence
      FOR EACH ROW
      EXECUTE FUNCTION prevent_p3_history_mutation_for_valid()
    `);
    console.log("Created new trigger (only blocks VALID artifacts)");

    console.log("\nTrigger modification complete. Ready for authoritative execution.");
  } catch (error) {
    console.error("ERROR:", error);
    if (error instanceof Error) {
      console.error("Message:", error.message);
    }
  }
}

modifyTriggerForInvalidArtifacts().catch(console.error);
