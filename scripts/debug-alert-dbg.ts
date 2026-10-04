import { db } from "../src/db";
import { healthScores, features } from "../src/db/schema";
import { eq, and } from "drizzle-orm";
import { getBusinessDate } from "../src/lib/utils";

async function main() {
  const today = getBusinessDate();
  console.log("business date:", today);
  const rows = await db
    .select({ coinId: healthScores.coinId, health: healthScores.healthScore, trend: features.trendScore })
    .from(healthScores)
    .leftJoin(features, and(eq(features.coinId, healthScores.coinId), eq(features.date, healthScores.date)))
    .where(eq(healthScores.date, today))
    .limit(5);
  console.log("joined rows:", rows.length, JSON.stringify(rows));
  process.exit(0);
}
main();
