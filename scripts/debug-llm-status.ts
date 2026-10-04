// One-off verify (not committed): sign an admin cookie, call the new
// /api/admin/llm/status endpoint and the unlock sync no-op path.
import { signSession, SESSION_COOKIE } from "../src/lib/auth/session";

async function main() {
  const token = await signSession({ sub: "admin", username: "diag" });
  const cookie = `${SESSION_COOKIE}=${token}`;
  const base = "http://127.0.0.1:3000";

  const status = await fetch(`${base}/api/admin/llm/status`, { headers: { cookie } });
  const body = await status.json();
  console.log("GET /api/admin/llm/status →", status.status);
  if (body?.data) {
    console.log("  live.bufferSize :", body.data.live?.bufferSize);
    console.log("  tiers           :", JSON.stringify(body.data.tiers)?.slice(0, 200));
    console.log("  googlePool      :", JSON.stringify(body.data.googlePool)?.slice(0, 200));
    console.log("  dailyLlmRatio   :", JSON.stringify(body.data.dailyLlmRatio)?.slice(0, 200));
  } else {
    console.log("  body:", JSON.stringify(body).slice(0, 300));
  }

  const sync = await fetch(`${base}/api/admin/events/sync-unlocks`, {
    method: "POST",
    headers: { cookie },
  });
  console.log("POST /api/admin/events/sync-unlocks →", sync.status, (await sync.text()).slice(0, 200));

  // Trigger one real LLM call through the chat completion path? Skip — the
  // buffer fills from natural pipeline traffic. Instead verify endpoint
  // reflects live data by calling generateContent directly in-process:
  const { generateContent } = await import("../src/lib/square/content-generator");
  const result = await generateContent(
    {
      opportunityId: 0,
      contentType: "text",
      text: "probe",
      cashtags: ["$BTC"],
      leadingCoinSymbols: ["BTC"],
      dataAsOf: "2026-09-29",
      direction: "LONG",
      whyNowFacts: ["LLM-01 verify"],
      invalidation: "Probe invalidation.",
      entry: { low: 63000, high: 65000 },
      takeProfits: [{ level: 70000, label: "TP1" }],
      stopLoss: { level: 60000, label: "SL" },
    },
    undefined,
    "chat" as const
  );
  console.log("in-process generateContent → llmUsed:", result.llmUsed, "provider:", result.llmProvider);

  const after = await fetch(`${base}/api/admin/llm/status`, { headers: { cookie } });
  const afterBody = await after.json();
  console.log("after → live.bufferSize:", afterBody?.data?.live?.bufferSize);
  console.log("after → tiers:", JSON.stringify(afterBody?.data?.tiers)?.slice(0, 300));

  process.exit(0);
}
main();
