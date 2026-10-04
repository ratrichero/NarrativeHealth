// One-off: inspect recent chat sessions/messages
import { Client } from "pg";

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000,
  });
  await c.connect();
  const s = await c.query(
    "SELECT id, title, message_count, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT 8"
  );
  console.log("SESSIONS (" + s.rows.length + "):");
  for (const r of s.rows)
    console.log(" ", r.id, "| count:", r.message_count, "| title:", (r.title || "").slice(0, 40), "| upd:", r.updated_at);

  const m = await c.query(
    "SELECT session_id, role, llm_provider, tool_calls IS NOT NULL AS has_tools, created_at FROM chat_messages ORDER BY created_at DESC LIMIT 12"
  );
  console.log("MESSAGES (" + m.rows.length + "):");
  for (const r of m.rows)
    console.log(" ", r.session_id, "|", r.role, "| provider:", r.llm_provider, "| tools:", r.has_tools, "|", r.created_at);

  const counts = await c.query(
    "SELECT role, COUNT(*)::int AS n FROM chat_messages GROUP BY role"
  );
  console.log("COUNTS BY ROLE:");
  for (const r of counts.rows) console.log(" ", r.role, "=", r.n);

  await c.end();
}
main();
