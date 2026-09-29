// Raw SQL migration runner for the smart deploy script (no psql needed —
// uses the pg driver already installed). Every migration file in
// drizzle/migrations/*.sql is idempotent (CREATE TABLE IF NOT EXISTS /
// ADD COLUMN IF NOT EXISTS ...), so re-running the whole set is safe; the
// sha256 of each applied file is recorded in _raw_migrations to skip work
// and to re-run a file when its content changes.
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Pool } from "pg";

const dir = "drizzle/migrations";
const databaseUrl = process.env.DATABASE_URL?.replace(
  "postgresql+asyncpg://",
  "postgresql://"
);
if (!databaseUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 15000 });

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _raw_migrations (
      filename VARCHAR(200) PRIMARY KEY,
      hash VARCHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows: applied } = await pool.query(
    "SELECT filename, hash FROM _raw_migrations"
  );
  const appliedMap = new Map(applied.map((r) => [r.filename as string, r.hash as string]));

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ran = 0;
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    if (appliedMap.get(file) === hash) continue;

    process.stdout.write(`  ${file} … `);
    try {
      // Files are written idempotent by convention; multi-statement strings
      // are fine through pg's simple query protocol.
      await pool.query(sql);
      await pool.query(
        `INSERT INTO _raw_migrations (filename, hash) VALUES ($1, $2)
         ON CONFLICT (filename) DO UPDATE SET hash = EXCLUDED.hash, applied_at = now()`,
        [file, hash]
      );
      console.log(appliedMap.has(file) ? "re-applied (changed)" : "applied");
      ran++;
    } catch (e) {
      console.log("ERROR");
      console.error(`    ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
      // Continue: one bad statement must not block the remaining files.
    }
  }

  if (ran === 0) console.log("  all migrations up to date");
  else console.log(`  ${ran} migration file(s) applied`);
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error("migration runner failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
