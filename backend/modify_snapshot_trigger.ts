import { db } from "@/db";
import { sql } from "drizzle-orm";

async function modifySnapshotTrigger() {
  console.log("Modifying snapshot trigger to allow deletion for invalid artifacts...\n");

  try {
    // Create the function
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION prevent_p3_history_mutation_for_valid_snapshots()
      RETURNS TRIGGER AS $$
      DECLARE
        parent_availability text;
      BEGIN
        -- Only block updates/deletes if the parent intelligence is VALID
        SELECT availability_state INTO parent_availability
        FROM p3_narrative_intelligence
        WHERE id = OLD.intelligence_id;
        
        IF parent_availability = 'VALID' THEN
          RAISE EXCEPTION 'P3 historical records are immutable';
        END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql
    `);
    console.log("Created/updated snapshot trigger function");

    // Drop the existing trigger
    await db.execute(sql`
      DROP TRIGGER IF EXISTS p3_constituent_snapshots_immutable ON p3_constituent_snapshots
    `);
    console.log("Dropped existing snapshot trigger");

    // Create a new trigger
    await db.execute(sql`
      CREATE TRIGGER p3_constituent_snapshots_immutable
      BEFORE DELETE OR UPDATE ON p3_constituent_snapshots
      FOR EACH ROW
      EXECUTE FUNCTION prevent_p3_history_mutation_for_valid_snapshots()
    `);
    console.log("Created new snapshot trigger (only blocks VALID parent artifacts)");

    console.log("\nSnapshot trigger modification complete.");
  } catch (error) {
    console.error("ERROR:", error);
    if (error instanceof Error) {
      console.error("Message:", error.message);
    }
  }
}

modifySnapshotTrigger().catch(console.error);
