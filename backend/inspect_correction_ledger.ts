import { db } from "@/db";
import { sql } from "drizzle-orm";

async function inspectCorrectionLedger() {
  console.log("Inspecting correction ledger...\n");

  const result = await db.execute(sql`
    SELECT
      column_name,
      data_type,
      is_nullable
    FROM information_schema.columns
    WHERE table_name = 'p3_historical_corrections'
    ORDER BY ordinal_position
  `);

  console.log("Correction ledger columns:");
  console.table(result.rows);

  const existingCorrections = await db.execute(sql`
    SELECT
      id,
      intelligence_id,
      corrected_at,
      status
    FROM p3_historical_corrections
    ORDER BY id DESC
    LIMIT 5
  `);

  console.log("\nExisting corrections:");
  console.table(existingCorrections.rows);
}

inspectCorrectionLedger().catch(console.error);
