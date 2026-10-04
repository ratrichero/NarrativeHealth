import { signSession, SESSION_COOKIE } from "../src/lib/auth/session";
async function main() {
  const token = await signSession({ sub: "admin", username: "diag" });
  const cookie = `${SESSION_COOKIE}=${token}`;
  const base = "http://127.0.0.1:3000";
  const j = (r: Response) => r.json().catch(() => ({}));

  // Create a rule that fires for most coins (health_above 0)
  const create = await j(await fetch(`${base}/api/admin/alerts/rules`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "[E2E] health high probe", scope: "global", triggerType: "health_above", triggerValue: 0, isActive: true }),
  }));
  console.log("create rule →", JSON.stringify(create).slice(0, 120));
  const ruleId = create?.data?.id;

  // Evaluate all rules
  const ev = await j(await fetch(`${base}/api/admin/alerts/evaluate`, { method: "POST", headers: { cookie } }));
  console.log("evaluate →", JSON.stringify(ev.data));

  // Check history
  const hist = await j(await fetch(`${base}/api/admin/alerts/history`, { headers: { cookie } }));
  const fired = (hist?.data ?? []).filter((h: any) => h.ruleId === ruleId);
  console.log("history for rule:", fired.length, "| sample:", JSON.stringify(fired[0]?.triggerDetail ?? {}).slice(0, 200));

  // Re-evaluate → idempotency: no new fires
  const ev2 = await j(await fetch(`${base}/api/admin/alerts/evaluate`, { method: "POST", headers: { cookie } }));
  console.log("re-evaluate fired:", ev2?.data?.alertsFired, "(phải = 0)");

  // Acknowledge first alert
  if (fired[0]) {
    const ack = await j(await fetch(`${base}/api/admin/alerts/${fired[0].id}/acknowledge`, {
      method: "POST", headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledgedBy: "e2e" }),
    }));
    console.log("ack →", JSON.stringify(ack).slice(0, 100));
  }

  // Cleanup: delete the probe rule
  const del = await fetch(`${base}/api/admin/alerts/rules/${ruleId}`, { method: "DELETE", headers: { cookie } });
  console.log("delete rule →", del.status);

  process.exit(0);
}
main();
