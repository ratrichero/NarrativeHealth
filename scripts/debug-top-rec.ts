// One-off diagnostic (not committed): inspect health_scores/recommendations
// for the latest data date — used while diagnosing the 0-LONG padding case.
import { Client } from "pg";

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000,
  });
  await c.connect();
  const q = await c.query(`
    SELECT c.symbol, hs.health_score, hs.score_change, r.signal
    FROM health_scores hs
    JOIN coins c ON c.id = hs.coin_id AND c.is_active = true
    LEFT JOIN recommendations r ON r.coin_id = hs.coin_id AND r.date = hs.date
    WHERE hs.date = (SELECT MAX(date) FROM health_scores)
    ORDER BY hs.health_score DESC
  `);
  console.log("coins on latest data date:", q.rows.length);
  for (const r of q.rows) {
    const health = r.health_score != null ? Number(r.health_score).toFixed(1) : "null";
    const change = r.score_change != null ? Number(r.score_change).toFixed(1) : "null";
    console.log(
      String(r.symbol).padEnd(10),
      "health=" + health.padStart(5),
      "change=" + String(change).padStart(6),
      "signal=" + String(r.signal ?? "none").padEnd(13)
    );
  }
  await c.end();
}
main().catch((e) => {
  console.error("ERR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
