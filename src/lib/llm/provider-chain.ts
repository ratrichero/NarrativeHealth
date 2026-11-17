// Shared provider chain for every LLM consumer (Square setup posts, Movers
// recap posts, chat): google pool → primary → fallback1 → fallback2.
//
// The google tier is a multi-key pool (GKEY-01), so a 429 on one project key
// flows to the next key before the tier is abandoned. Square and chat used to
// duplicate this resolution logic and had already drifted apart (chat lacked
// the transient retry, one side stopped reporting pool outcomes), so it lives
// here now.

import { resolveGooglePool, type GooglePooledProvider } from "./google-key-pool";

export interface LlmProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Masked key suffix for logs and the LLM monitor — never leaks the key. */
export function keyHint(apiKey: string): string {
  return apiKey.length > 10 ? `…${apiKey.slice(-4)}` : "…";
}

export function resolveProviderChain(): LlmProvider[] {
  const chain: LlmProvider[] = [];

  // SQ-LLM-GOOGLE: tried FIRST. Model defaults to gemini-2.5-flash-lite
  // (fast, non-thinking, passes post validation); override via
  // GOOGLE_AI_MODEL_NAME. One chain entry per available pool key.
  const googleModel = process.env.GOOGLE_AI_MODEL_NAME || "gemini-2.5-flash-lite";
  chain.push(
    ...resolveGooglePool(googleModel).map(
      (p: GooglePooledProvider): LlmProvider => ({
        name: p.name,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        model: p.model,
      })
    )
  );

  const primaryKey = process.env.OPENAI_API_KEY;
  if (primaryKey) {
    chain.push({
      name: "primary",
      baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      apiKey: primaryKey,
      model: process.env.MODEL_NAME || "gpt-4o-mini",
    });
  }

  const fallback1Key = process.env.FALLBACK_OPENAI_API_KEY;
  if (fallback1Key && process.env.FALLBACK_MODEL_NAME) {
    chain.push({
      name: "fallback1",
      baseUrl: (process.env.FALLBACK_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      apiKey: fallback1Key,
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
