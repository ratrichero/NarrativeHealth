// One-off (not committed): verify subject_id nullability
import { Client } from "pg";

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    "SELECT is_nullable FROM information_schema.columns WHERE table_name='square_opportunities' AND column_name='subject_id'"
  );
  console.log("subject_id nullable:", r.rows[0]?.is_nullable);
  await c.end();
}
main();
