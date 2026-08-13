import { db } from "@/db";
import { sql } from "drizzle-orm";

async function checkLeadershipData() {
  console.log("Checking leadership data in calculation result...\n");

  // Check if leadership data was calculated
  const result = await db.execute(sql`
    SELECT
      leader_coin_id,
      leader_score,
      concentration_top1,
      concentration_top3,
      concentration_classification
    FROM p3_narrative_intelligence
    WHERE id = 1
  `);

  console.log("Leadership data in artifact:");
  console.table(result.rows);

  if (result.rows[0]?.leader_coin_id) {
    console.log("\n✅ Leadership data persisted correctly");
  } else {
    console.log("\n❌ Leadership data missing from artifact");
  }
}

checkLeadershipData().catch(console.error);
