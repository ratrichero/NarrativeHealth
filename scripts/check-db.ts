// One-off DB connectivity check (uses env-injected DATABASE_URL)
import { Client } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("NO_DATABASE_URL");
    process.exit(1);
  }
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 15000 });
  const t0 = Date.now();
  try {
    await c.connect();
    console.log("CONNECT OK in", Date.now() - t0, "ms");
    const ping = await c.query("SELECT 1 as ok");
    console.log("PING:", ping.rows[0].ok === 1 ? "OK" : "FAIL");
    const t = await c.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name IN ('chat_sessions','chat_messages','health_scores','indicators') ORDER BY table_name"
    );
    console.log("tables:", t.rows.map((r) => r.table_name).join(", ") || "NONE");
    const hs = await c.query("SELECT COUNT(*)::int AS n, MAX(date) AS latest FROM health_scores");
    console.log("health_scores rows:", hs.rows[0].n, "latest:", hs.rows[0].latest);
  } catch (e) {
    console.log("DB ERROR:", e instanceof Error ? e.message.slice(0, 250) : String(e));
    process.exitCode = 1;
  } finally {
    await c.end().catch(() => {});
  }
}
main();
