import { db } from "@/db";
import { sql } from "drizzle-orm";

async function inspectP3Schema() {
  console.log("Inspecting p3_narrative_intelligence schema...\n");

  // Get column information
  const columns = await db.execute(sql`
    SELECT
      column_name,
      data_type,
      character_maximum_length,
      is_nullable,
      column_default
    FROM information_schema.columns
    WHERE table_name = 'p3_narrative_intelligence'
    ORDER BY ordinal_position
  `);

  console.log("Columns:");
  console.table(columns.rows);

  // Get check constraints
  const constraints = await db.execute(sql`
    SELECT
      conname as constraint_name,
      pg_get_constraintdef(oid) as constraint_definition
    FROM pg_constraint
    WHERE conrelid = 'p3_narrative_intelligence'::regclass
      AND contype = 'c'
  `);

  console.log("\nCheck Constraints:");
  console.table(constraints.rows);

  // Get enum types
  const enums = await db.execute(sql`
    SELECT
      t.typname as enum_name,
      e.enumlabel as enum_value
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname LIKE '%regime%' OR t.typname LIKE '%rotation%'
    ORDER BY t.typname, e.enumsortorder
  `);

  console.log("\nEnum Types:");
  console.table(enums.rows);

  // Get any existing rows
  const existingRows = await db.execute(sql`
    SELECT
      id,
      narrative_id,
      window_end,
      algorithm_key,
      regime,
      rotation,
      availability_state
    FROM p3_narrative_intelligence
    ORDER BY id DESC
    LIMIT 5
  `);

  console.log("\nExisting Rows (sample):");
  console.table(existingRows.rows);
}

inspectP3Schema().catch(console.error);
