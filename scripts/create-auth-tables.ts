// AUTH-01: create the two auth tables additively (mirrors src/db/schema.ts).
// Rationale: `drizzle-kit push` stops on an interactive prompt about an
// unrelated legacy unique constraint on narrative_membership_events, and we
// must NOT truncate that table (it holds data). CREATE TABLE IF NOT EXISTS is
// safe and additive-only.
import { Client } from "pg";

const SQL = `
CREATE TABLE IF NOT EXISTS admin_users (
  id serial PRIMARY KEY,
  username varchar(50) NOT NULL,
  password_hash text NOT NULL,
  display_name varchar(100),
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT admin_users_username_unique UNIQUE (username)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key varchar(100) PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);
`;

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000,
  });
  try {
    await c.connect();
    await c.query(SQL);
    const t = await c.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name IN ('admin_users','app_settings') ORDER BY table_name"
    );
    console.log("auth tables now present:", t.rows.map((r) => r.table_name).join(", "));
    const idx = await c.query(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'admin_users' ORDER BY indexname"
    );
    console.log("admin_users indexes:", idx.rows.map((r) => r.indexname).join(", "));
  } catch (e) {
    console.log("ERROR:", e instanceof Error ? e.message.slice(0, 250) : String(e));
    process.exitCode = 1;
  } finally {
    await c.end().catch(() => {});
  }
}
main();
