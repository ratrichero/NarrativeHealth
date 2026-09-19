// One-off: create chat tables directly (additive only, mirrors src/db/schema.ts)
import { Client } from "pg";

const SQL = `
CREATE TABLE IF NOT EXISTS chat_sessions (
  id varchar(64) PRIMARY KEY,
  client_fingerprint varchar(128),
  title varchar(200),
  message_count integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_sessions_updated_idx ON chat_sessions (updated_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id bigserial PRIMARY KEY,
  session_id varchar(64) NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL,
  content text NOT NULL,
  tool_calls jsonb,
  llm_provider varchar(20),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages (session_id, created_at);
`;

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
  try {
    await c.connect();
    await c.query(SQL);
    const t = await c.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name IN ('chat_sessions','chat_messages') ORDER BY table_name"
    );
    console.log("chat tables now present:", t.rows.map((r) => r.table_name).join(", "));
  } catch (e) {
    console.log("ERROR:", e instanceof Error ? e.message.slice(0, 250) : String(e));
    process.exitCode = 1;
  } finally {
    await c.end().catch(() => {});
  }
}
main();
