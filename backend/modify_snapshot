import { db } from "@/db";
import { sql } from "drizzle-orm";

async function modifySnapshotMembersTrigger() {
  console.log("Modifying snapshot members trigger to allow deletion for invalid artifacts...\n");

  try {
    // Create the function
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION prevent_p3_history_mutation_for_valid_snapshot_members()
      RETURNS TRIGGER AS $$
      DECLARE
        parent_availability text;
      BEGIN
        -- Only block updates/deletes if the parent intelligence is VALID
        SELECT i.availability_state INTO parent_availability
        FROM p3_narrative_intelligence i
        JOIN p3_constituent_snapshots s ON s.intelligence_id = i.id
        WHERE s.id = OLD.snapshot_id;
        
        IF parent_availability = 'VALID' THEN
          RAISE EXCEPTION 'P3 historical records are immutable';
        END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql
    `);
    console.log("Created/updated snapshot members trigger function");

    // Drop the existing trigger
    await db.execute(sql`
      DROP TRIGGER IF EXISTS p3_constituent_snapshot_members_immutable ON p3_constituent_snapshot_members
    `);
    console.log("Dropped existing snapshot members trigger");

    // Create a new trigger
    await db.execute(sql`
      CREATE TRIGGER p3_constituent_snapshot_members_immutable
      BEFORE DELETE OR UPDATE ON p3_constituent_snapshot_members
      FOR EACH ROW
      EXECUTE FUNCTION prevent_p3_history_mutation_for_valid_snapshot_members()
    `);
    console.log("Created new snapshot members trigger (only blocks VALID parent artifacts)");

    console.log("\nSnapshot members trigger modification complete.");
  } catch (error) {
    console.error("ERROR:", error);
    if (error instanceof Error) {
      console.error("Message:", error.message);
    }
  }
}

modifySnapshotMembersTrigger().catch(console.error);
