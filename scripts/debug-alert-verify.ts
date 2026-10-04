// ALERT verify: exercise the new admin endpoints with a signed admin cookie.
import { signSession, SESSION_COOKIE } from "../src/lib/auth/session";

async function main() {
  const token = await signSession({ sub: "admin", username: "diag" });
  const cookie = `${SESSION_COOKIE}=${token}`;
  const base = "http://127.0.0.1:3000";

  // 1. Alert evaluation (no rules yet → zeros)
  const evaluate = await fetch(`${base}/api/admin/alerts/evaluate`, {
    method: "POST",
    headers: { cookie },
  });
  console.log("POST /api/admin/alerts/evaluate →", evaluate.status, (await evaluate.text()).slice(0, 200));

  // 2. Rule version dry-run
  const dry = await fetch(`${base}/api/admin/rule-versions/1/dry-run`, { method: "POST", headers: { cookie } });
  const dryBody = await dry.json();
  console.log("POST /api/admin/rule-versions/1/dry-run →", dry.status);
  if (dryBody?.data) {
    console.log("  sampleSize:", dryBody.data.sampleSize, "| changed:", dryBody.data.changedCount, "| date:", dryBody.data.dateUsed);
    console.log("  distribution:", JSON.stringify(dryBody.data.distribution));
  } else {
    console.log("  body:", JSON.stringify(dryBody).slice(0, 200));
  }

  // 3. Unlock sync (no UNLOCK_DATA_URL → configured:false no-op)
  const sync = await fetch(`${base}/api/admin/events/sync-unlocks`, { method: "POST", headers: { cookie } });
  console.log("POST /api/admin/events/sync-unlocks →", sync.status, (await sync.text()).slice(0, 200));

  // 4. Admin users list (regression check for ACC-MGMT)
  const users = await fetch(`${base}/api/admin/users`, { headers: { cookie } });
  const usersBody = await users.json();
  console.log("GET /api/admin/users →", users.status, "| count:", Array.isArray(usersBody?.data) ? usersBody.data.length : "?");

  process.exit(0);
}
main();
