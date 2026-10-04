// One-off diagnostic (do not commit): probe every LLM tier with the CURRENT
// env values. Never prints key values (masked prefixes only).
import "dotenv/config";

function mask(v?: string): string {
  if (!v) return "(missing)";
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}

interface Tier {
  name: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
}

const tiers: Tier[] = [
  {
    name: "google (Gemini OpenAI-compat)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: process.env.GOOGLE_AI_API_KEY,
    model: process.env.GOOGLE_AI_MODEL_NAME || "gemini-2.5-flash-lite",
  },
  {
    name: "primary (OPENAI_API_KEY tier)",
    baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.MODEL_NAME || "gpt-4o-mini",
  },
  {
    name: "fallback1",
    baseUrl: (process.env.FALLBACK_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    apiKey: process.env.FALLBACK_OPENAI_API_KEY,
    model: process.env.FALLBACK_MODEL_NAME || "",
  },
  {
    name: "fallback2",
    baseUrl: (process.env.FALLBACK2_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    apiKey: process.env.FALLBACK2_OPENAI_API_KEY,
    model: process.env.FALLBACK2_MODEL_NAME || "",
  },
];

const briefs: Record<string, string> = {
  "google (Gemini OpenAI-compat)": "GOOGLE_AI_API_KEY",
  "primary (OPENAI_API_KEY tier)": "OPENAI_API_KEY",
  fallback1: "FALLBACK_OPENAI_API_KEY",
  fallback2: "FALLBACK2_OPENAI_API_KEY",
};

for (const t of tiers) {
  console.log(`\n=== ${t.name} ===`);
  console.log(`base: ${t.baseUrl}  model: ${t.model || "(none)"}  key(${briefs[t.name]}): ${mask(t.apiKey)}`);
  if (!t.apiKey || !t.model) {
    console.log("SKIP — key or model missing");
    continue;
  }
  const started = Date.now();
  try {
    const res = await fetch(`${t.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${t.apiKey}`,
      },
      body: JSON.stringify({
        model: t.model,
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        temperature: 0,
        max_tokens: 10,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const ms = Date.now() - started;
    const body = await res.text();
    if (res.ok) {
      const data = JSON.parse(body);
      const text = data.choices?.[0]?.message?.content;
      console.log(`HTTP 200 in ${ms}ms → "${String(text).slice(0, 40)}"`);
    } else {
      const short = body.replace(/\s+/g, " ").slice(0, 160);
      console.log(`HTTP ${res.status} in ${ms}ms → ${short}`);
    }
  } catch (e) {
    const ms = Date.now() - started;
    console.log(`TRANSPORT ERROR after ${ms}ms: ${e instanceof Error ? e.message : String(e)}`);
  }
}
