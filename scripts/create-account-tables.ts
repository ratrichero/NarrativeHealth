// ACC-MGMT — additive DDL for account management (mirrors src/db/schema.ts):
//   1. admin_users.role column (superadmin default for existing rows)
//   2. users table for open self-signup end-user accounts
// Idempotent: safe to run repeatedly.
import { Client } from "pg";

const SQL = `
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role varchar(20) NOT NULL DEFAULT 'superadmin';

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  username varchar(50) NOT NULL,
  password_hash text NOT NULL,
  display_name varchar(100),
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (username);
`;

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
  try {
    await c.connect();
    await c.query(SQL);
    const t = await c.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name IN ('users','admin_users') ORDER BY table_name"
    );
    const role = await c.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='admin_users' AND column_name='role'"
    );
    console.log("tables:", t.rows.map((r) => r.table_name).join(", "));
    console.log("admin_users.role column:", role.rows.length > 0 ? "OK" : "MISSING");
  } catch (e) {
    console.log("ERROR:", e instanceof Error ? e.message.slice(0, 300) : String(e));
    process.exitCode = 1;
  } finally {
    await c.end().catch(() => {});
  }
}
main();
