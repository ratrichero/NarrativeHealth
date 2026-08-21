import { db } from "@/db";
import { sql } from "drizzle-orm";

async function restoreOriginalTriggers() {
  console.log("Restoring original immutability triggers...\n");

  try {
    // Restore original trigger function
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION prevent_p3_history_mutation()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'P3 historical records are immutable';
      END;
      $$ LANGUAGE plpgsql
    `);
    console.log("Restored original trigger function");

    // Restore intelligence trigger
    await db.execute(sql`
      DROP TRIGGER IF EXISTS p3_narrative_intelligence_immutable ON p3_narrative_intelligence
    `);
    await db.execute(sql`
      CREATE TRIGGER p3_narrative_intelligence_immutable
      BEFORE DELETE OR UPDATE ON p3_narrative_intelligence
      FOR EACH ROW
      EXECUTE FUNCTION prevent_p3_history_mutation()
    `);
    console.log("Restored intelligence trigger");

    // Restore snapshot trigger
    await db.execute(sql`
      DROP TRIGGER IF EXISTS p3_constituent_snapshots_immutable ON p3_constituent_snapshots
    `);
    await db.execute(sql`
      CREATE TRIGGER p3_constituent_snapshots_immutable
      BEFORE DELETE OR UPDATE ON p3_constituent_snapshots
      FOR EACH ROW
      EXECUTE FUNCTION prevent_p3_history_mutation()
    `);
    console.log("Restored snapshot trigger");

    // Restore snapshot members trigger
    await db.execute(sql`
      DROP TRIGGER IF EXISTS p3_constituent_snapshot_members_immutable ON p3_constituent_snapshot_members
    `);
    await db.execute(sql`
      CREATE TRIGGER p3_constituent_snapshot_members_immutable
      BEFORE DELETE OR UPDATE ON p3_constituent_snapshot_members
      FOR EACH ROW
      EXECUTE FUNCTION prevent_p3_history_mutation()
    `);
    console.log("Restored snapshot members trigger");

    // Restore leadership trigger
    await db.execute(sql`
      DROP TRIGGER IF EXISTS p3_leadership_members_immutable ON p3_leadership_members
    `);
    await db.execute(sql`
      CREATE TRIGGER p3_leadership_members_immutable
      BEFORE DELETE OR UPDATE ON p3_leadership_members
      FOR EACH ROW
      EXECUTE FUNCTION prevent_p3_history_mutation()
    `);
    console.log("Restored leadership trigger");

    console.log("\n✅ All triggers restored to strict immutability");
  } catch (error) {
    console.error("ERROR:", error);
    if (error instanceof Error) {
      console.error("Message:", error.message);
    }
  }
}

restoreOriginalTriggers().catch(console.error);
