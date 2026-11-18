// Shared provider chain for every LLM consumer (Square setup posts, Movers
// recap posts, chat): google pool → primary → fallback1 → fallback2.
//
// LLM-CONFIG-01: each tier is resolved independently. A tier saved and enabled
// in the admin panel (app_settings.llm.chain) wins; a tier missing there falls
// back to the env vars below; a tier explicitly disabled there is skipped. So
// an operator can move primary/fallback to new keys from the dashboard without
// restarting the app, while env keeps working for anything not configured.
//
// A DB google tier whose keys cannot be decrypted contributes NOTHING — it must
// never silently borrow the env pool, because that would send traffic with a
// key the operator believes is retired.
//
// The google tier is a multi-key pool (GKEY-01), so a 429 on one project key
// flows to the next key before the tier is abandoned.

import {
  resolveGooglePool,
  setGooglePoolKeys,
  type GooglePooledProvider,
} from "./google-key-pool";
import {
  loadLlmRuntimeSettings,
  type LlmFeatureProfile,
  type LlmTierId,
  type RuntimeLlmSettings,
  type RuntimeTier,
} from "./settings";
import { keyOverBudget } from "./budget";
import { hydrateLlmBreakers, isBreakerOpen } from "./breaker";

export interface LlmProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Per-tier overrides from the admin panel (undefined → env/config default). */
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
}

/** Masked key suffix for logs and the LLM monitor — never leaks the key. */
export function keyHint(apiKey: string): string {
  return apiKey.length > 10 ? `…${apiKey.slice(-4)}` : "…";
}

function tierOverrides(row: RuntimeTier | undefined) {
  return {
    temperature: row?.temperature,
    maxTokens: row?.maxTokens,
    timeoutMs: row?.timeoutMs,
    extraHeaders: row?.extraHeaders,
  };
}

interface TierEnv {
  key?: string;
  baseUrl?: string;
  model?: string;
  defaultBaseUrl: string;
}

function envTier(
  chain: LlmProvider[],
  name: LlmTierId,
  stored: RuntimeTier | undefined,
  env: TierEnv
): void {
  // Configured in the DB: only the DB decides (a disabled tier stays off, and a
  // tier with no decryptable key contributes nothing).
  if (stored) {
    const apiKey = stored.keys[0];
    const model = stored.model ?? env.model;
    if (!stored.enabled || !apiKey || !model) return;
    chain.push({
      name,
      baseUrl: (stored.baseUrl ?? env.baseUrl ?? env.defaultBaseUrl).replace(/\/$/, ""),
      apiKey,
      model,
      ...tierOverrides(stored),
    });
    return;
  }

  if (!env.key || !env.model) return;
  chain.push({
    name,
    baseUrl: (env.baseUrl || env.defaultBaseUrl).replace(/\/$/, ""),
    apiKey: env.key,
    model: env.model,
  });
}

/**
 * Pure chain builder: takes the DB settings (or null) and reads env for the
 * tiers that are not configured there. Exported so the admin API can preview a
 * draft config without saving it.
 */
export function buildChainFromSettings(
  stored: RuntimeLlmSettings | null,
  profile?: LlmFeatureProfile
): LlmProvider[] {
  const chain: LlmProvider[] = [];

  // ─── google pool (tried first) ───
  const googleStored = stored?.tiers.google;
  const googleModel =
    googleStored?.model || process.env.GOOGLE_AI_MODEL_NAME || "gemini-2.5-flash-lite";

  if (!googleStored) {
    setGooglePoolKeys(null); // env GOOGLE_AI_API_KEYS / GOOGLE_AI_API_KEY
    chain.push(...googleEntries(googleModel, undefined));
  } else if (googleStored.enabled && googleStored.keys.length > 0) {
    setGooglePoolKeys(googleStored.keys);
    chain.push(...googleEntries(googleModel, googleStored));
  }
  // googleStored disabled, or enabled with zero decryptable keys → no google
  // entry, and the env pool is NOT consulted.

  envTier(chain, "primary", stored?.tiers.primary, {
    key: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.MODEL_NAME,
    defaultBaseUrl: "https://api.openai.com/v1",
  });

  envTier(chain, "fallback1", stored?.tiers.fallback1, {
    key: process.env.FALLBACK_OPENAI_API_KEY,
    baseUrl: process.env.FALLBACK_OPENAI_BASE_URL,
    model: process.env.FALLBACK_MODEL_NAME,
    defaultBaseUrl: "https://api.openai.com/v1",
  });

  envTier(chain, "fallback2", stored?.tiers.fallback2, {
    key: process.env.FALLBACK2_OPENAI_API_KEY,
    baseUrl: process.env.FALLBACK2_OPENAI_BASE_URL,
    model: process.env.FALLBACK2_MODEL_NAME,
    defaultBaseUrl: "https://api.openai.com/v1",
  });

  return filterUnavailable(applyProfile(chain, stored, profile));
}

/**
 * LLM-PROFILE-01: a feature may pin its own tier order (e.g. chat prefers the
 * fast Groq tier while Square prefers Google's longer context). Tiers missing
 * from the profile list are dropped for that feature only.
 */
function applyProfile(
  chain: LlmProvider[],
  stored: RuntimeLlmSettings | null,
  profile: LlmFeatureProfile | undefined
): LlmProvider[] {
  const order = profile ? stored?.profiles?.[profile] : undefined;
  if (!order || order.length === 0) return chain;
  const rank = new Map(order.map((name, index) => [name, index]));
  return chain
    .filter((provider) => rank.has(provider.name as LlmTierId))
    .sort((a, b) => (rank.get(a.name as LlmTierId) ?? 0) - (rank.get(b.name as LlmTierId) ?? 0));
}

/**
 * LLM-BUDGET-01: a key that already spent its per-minute token window should
 * not be tried first (the request would only earn a 429).
 *
 * LLM-BREAKER-01: a tier whose breaker is open (2 real provider failures in 5
 * minutes, persisted across restarts) is skipped for its cooldown.
 *
 * When EVERY tier is filtered out the chain is returned untouched: a stale
 * breaker must never turn a degraded system into a dead one — the caller may
 * still succeed, and a success closes the breaker again.
 */
function filterUnavailable(chain: LlmProvider[]): LlmProvider[] {
  // Unit tests share one process and a handful of fake keys across suites, so
  // breaker state would leak between them. Breaker accounting still runs; only
  // the chain-level gate is opt-in for tests (LLM_BREAKER_TEST=1).
  const breakerGate = process.env.NODE_ENV !== "test" || process.env.LLM_BREAKER_TEST === "1";
  const available = chain.filter(
    (provider) =>
      !(breakerGate && isBreakerOpen(provider.name, provider.apiKey)) &&
      !keyOverBudget(provider.apiKey, 800)
  );
  return available.length > 0 ? available : chain;
}

function googleEntries(model: string, row: RuntimeTier | undefined): LlmProvider[] {
  return resolveGooglePool(model).map(
    (p: GooglePooledProvider): LlmProvider => ({
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: p.model,
      ...tierOverrides(row),
    })
  );
}

export async function resolveProviderChain(
  profile?: LlmFeatureProfile
): Promise<LlmProvider[]> {
  // Breakers live in app_settings; load them before filtering so a restarted
  // process skips the tier that was failing before the restart.
  await hydrateLlmBreakers();
  return buildChainFromSettings(await loadLlmRuntimeSettings(), profile);
}
