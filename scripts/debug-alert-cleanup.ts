import { signSession, SESSION_COOKIE } from "../src/lib/auth/session";
async function main() {
  const token = await signSession({ sub: "admin", username: "diag" });
  const cookie = `${SESSION_COOKIE}=${token}`;
  const base = "http://127.0.0.1:3000";
  const j = (r: Response) => r.json().catch(() => ({}));

  // Idempotency: re-evaluate must fire 0 (already fired today)
  const ev2 = await j(await fetch(`${base}/api/admin/alerts/evaluate`, { method: "POST", headers: { cookie } }));
  console.log("re-evaluate fired:", ev2?.data?.alertsFired, "(phải = 0)");

  // Acknowledge the first unacknowledged alert
  const hist = await j(await fetch(`${base}/api/admin/alerts/history`, { headers: { cookie } }));
  const unacked = (hist?.data ?? []).find((h: any) => !h.acknowledged);
  if (unacked) {
    const ack = await j(await fetch(`${base}/api/admin/alerts/${unacked.id}/acknowledge`, {
      method: "POST", headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledgedBy: "e2e" }),
    }));
    console.log("ack alert", unacked.id, "→", ack?.success);
  }

  // Cleanup: delete all E2E probe rules
  const rules = await j(await fetch(`${base}/api/admin/alerts/rules`, { headers: { cookie } }));
  for (const rule of rules?.data ?? []) {
    if (String(rule.name).startsWith("[E2E]")) {
      const del = await fetch(`${base}/api/admin/alerts/rules/${rule.id}`, { method: "DELETE", headers: { cookie } });
      console.log("delete rule", rule.id, "→", del.status);
    }
  }

  process.exit(0);
}
main();
