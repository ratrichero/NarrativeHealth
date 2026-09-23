/**
 * SQ-LLM-DIAG: One-off diagnostic — test the exact provider chain used by the
 * Square content generator. Loads env like the app does, resolves the chain
 * (primary → fallback1 → fallback2), calls each endpoint, and reports result
 * or the precise failure reason per provider. Never prints key values.
 */
import "dotenv/config";

interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

function resolveProviderChain(): ProviderConfig[] {
  const chain: ProviderConfig[] = [];

  const primaryKey = process.env.OPENAI_API_KEY;
  if (primaryKey) {
    chain.push({
      name: "primary",
      baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      apiKey: primaryKey,
      model: process.env.MODEL_NAME || "gpt-4o-mini",
    });
  }

  const fallbackKey = process.env.FALLBACK_OPENAI_API_KEY;
  if (fallbackKey && process.env.FALLBACK_MODEL_NAME) {
    chain.push({
      name: "fallback1",
      baseUrl: (process.env.FALLBACK_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      apiKey: fallbackKey,
      model: process.env.FALLBACK_MODEL_NAME,
    });
  }

  const fallback2Key = process.env.FALLBACK2_OPENAI_API_KEY;
  if (fallback2Key && process.env.FALLBACK2_MODEL_NAME) {
    chain.push({
      name: "fallback2",
      baseUrl: (process.env.FALLBACK2_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      apiKey: fallback2Key,
      model: process.env.FALLBACK2_MODEL_NAME,
    });
  }

  return chain;
}

async function testProvider(p: ProviderConfig): Promise<{ ok: boolean; detail: string }> {
  const start = Date.now();
  try {
    // SQ-DIAG: use the same max_tokens as the real generator (800). Earlier
    // runs with max_tokens=20 produced false negatives: reasoning models
    // (qwen3, DeepSeek-V4) spend the whole budget on <think> tokens before
    // emitting any content, so the response looked "empty" even though the
    // provider was perfectly healthy.
    const res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${p.apiKey}`,
      },
      body: JSON.stringify({
        model: p.model,
        messages: [
          {
            role: "user",
            content:
              'Reply with exactly this JSON and nothing else: {"status":"ok"}',
          },
        ],
        temperature: 0,
        max_tokens: 800,
      }),
      signal: AbortSignal.timeout(30000),
    });

    const ms = Date.now() - start;

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        detail: `HTTP ${res.status} (${ms}ms): ${body.slice(0, 250)}`,
      };
    }

    const data = await res.json();
    const usage = data.usage ?? {};
    const rawText: unknown = data.choices?.[0]?.message?.content;
    const finishReason: string = data.choices?.[0]?.finish_reason ?? "?";
    // Strip reasoning blocks exactly like the generator does.
    const text = typeof rawText === "string" ? rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim() : "";

    if (typeof rawText !== "string" || text.length === 0) {
      return {
        ok: false,
        detail: `Empty content (${ms}ms, finish=${finishReason}, reasoning_tokens=${usage.reasoning_tokens ?? 0}). Raw: ${JSON.stringify(data).slice(0, 250)}`,
      };
    }

    return { ok: true, detail: `OK (${ms}ms, finish=${finishReason}, completion_tokens=${usage.completion_tokens ?? "?"}): ${text.slice(0, 80)}` };
  } catch (err) {
    const ms = Date.now() - start;
    return {
      ok: false,
      detail: `Request failed (${ms}ms): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function main() {
  const chain = resolveProviderChain();
  console.log(`Resolved provider chain: ${chain.length} provider(s)\n`);

  if (chain.length === 0) {
    console.log("NO PROVIDERS — OPENAI_API_KEY is missing. This is why posts use template.");
    return;
  }

  let anyOk = false;
  for (const p of chain) {
    // Show masked key prefix so we can tell keys apart without exposing them
    const maskedKey = `${p.apiKey.slice(0, 5)}…${p.apiKey.slice(-3)}`;
    console.log(`[${p.name}] ${p.baseUrl} | model=${p.model} | key=${maskedKey}`);
    const result = await testProvider(p);
    console.log(`  → ${result.ok ? "✅" : "❌"} ${result.detail}\n`);
    if (result.ok) anyOk = true;
  }

  console.log(
    anyOk
      ? "CONCLUSION: at least one provider works. If posts still use template, the failure is inside generation/validation at publish time — check [SQ-LLM] warnings in the pipeline logs."
      : "CONCLUSION: ALL providers failed. This is why every post uses template."
  );
}

main();
