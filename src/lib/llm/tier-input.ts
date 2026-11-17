// LLM-CONFIG-01 — validation of the admin tier payload.
//
// Kept free of Next.js/auth imports so unit tests can exercise it directly and
// the route stays a thin HTTP layer.

import { buildChainFromSettings, type LlmProvider } from "./provider-chain";
import {
  LLM_TIER_IDS,
  decryptSecret,
  encryptSecret,
  llmConfigSecretConfigured,
  type LlmTierId,
  type RuntimeLlmSettings,
  type StoredLlmSettings,
  type StoredTier,
} from "./settings";

export interface TierEnv {
  key?: string;
  baseUrl?: string;
  model?: string;
  defaultBaseUrl: string;
}

export function envForTier(tier: LlmTierId): TierEnv {
  switch (tier) {
    case "google":
      return {
        key: process.env.GOOGLE_AI_API_KEYS || process.env.GOOGLE_AI_API_KEY,
        model: process.env.GOOGLE_AI_MODEL_NAME,
        defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      };
    case "primary":
      return {
        key: process.env.OPENAI_API_KEY,
        baseUrl: process.env.OPENAI_BASE_URL,
        model: process.env.MODEL_NAME,
        defaultBaseUrl: "https://api.openai.com/v1",
      };
    case "fallback1":
      return {
        key: process.env.FALLBACK_OPENAI_API_KEY,
        baseUrl: process.env.FALLBACK_OPENAI_BASE_URL,
        model: process.env.FALLBACK_MODEL_NAME,
        defaultBaseUrl: "https://api.openai.com/v1",
      };
    case "fallback2":
      return {
        key: process.env.FALLBACK2_OPENAI_API_KEY,
        baseUrl: process.env.FALLBACK2_OPENAI_BASE_URL,
        model: process.env.FALLBACK2_MODEL_NAME,
        defaultBaseUrl: "https://api.openai.com/v1",
      };
  }
}

export interface TierInput {
  enabled?: boolean;
  model?: string | null;
  baseUrl?: string | null;
  /** Plaintext keys. Omit (or null) to keep the stored ones, `[]` to clear. */
  keys?: string[] | null;
  temperature?: number | null;
  maxTokens?: number | null;
  timeoutMs?: number | null;
}

function encryptionPayload(key: string): string {
  return key.startsWith("v1:") ? key : encryptSecret(key);
}

/**
 * Merge a PUT/import patch over the stored config. Model/base URL/advanced
 * fields can always change; only NEW keys require the encryption secret.
 */
export function mergeTiers(
  existing: StoredLlmSettings | null,
  input: Partial<Record<LlmTierId, TierInput>>
): { tiers: Partial<Record<LlmTierId, StoredTier>>; errors: string[] } {
  const tiers: Partial<Record<LlmTierId, StoredTier>> = { ...(existing?.tiers ?? {}) };
  const errors: string[] = [];

  for (const tier of LLM_TIER_IDS) {
    const patch = input[tier];
    if (!patch) continue;
    const previous = existing?.tiers?.[tier];
    const env = envForTier(tier);

    const providedKeys = Array.isArray(patch.keys)
      ? patch.keys.map((k) => k.trim()).filter((k) => k.length > 0)
      : null;
    if (providedKeys && providedKeys.length > 0 && !llmConfigSecretConfigured()) {
      errors.push(`${tier}: LLM_CONFIG_SECRET (or AUTH_SECRET) must be set before keys can be stored.`);
      continue;
    }

    const keys = providedKeys ? providedKeys.map(encryptionPayload) : (previous?.keys ?? []);
    const model = patch.model?.trim() || previous?.model || undefined;
    const enabled = patch.enabled ?? previous?.enabled ?? true;

    if (enabled && keys.length === 0) {
      errors.push(`${tier}: at least one API key is required when the tier is enabled.`);
    }
    if (enabled && !model && tier !== "google" && !env.model) {
      errors.push(`${tier}: a model name is required.`);
    }
    if (typeof patch.temperature === "number" && (patch.temperature < 0 || patch.temperature > 1.5)) {
      errors.push(`${tier}: temperature must be between 0 and 1.5.`);
    }
    if (typeof patch.maxTokens === "number" && (patch.maxTokens < 1 || patch.maxTokens > 8192)) {
      errors.push(`${tier}: maxTokens must be between 1 and 8192.`);
    }
    if (typeof patch.timeoutMs === "number" && (patch.timeoutMs < 1000 || patch.timeoutMs > 120_000)) {
      errors.push(`${tier}: timeoutMs must be between 1000 and 120000.`);
    }

    tiers[tier] = {
      enabled,
      keys,
      model,
      baseUrl: tier === "google" ? undefined : patch.baseUrl?.trim() || previous?.baseUrl || undefined,
      temperature: patch.temperature ?? previous?.temperature,
      maxTokens: patch.maxTokens ?? previous?.maxTokens,
      timeoutMs: patch.timeoutMs ?? previous?.timeoutMs,
      extraHeaders: previous?.extraHeaders,
    };
  }

  return { tiers, errors };
}

/** Chain that WOULD be used for a draft config (decrypted in memory only). */
export function previewChain(
  tiers: Partial<Record<LlmTierId, StoredTier>>,
  existing: StoredLlmSettings | null
): LlmProvider[] {
  const runtime: RuntimeLlmSettings = { tiers: {}, updatedAt: existing?.updatedAt ?? "" };
  for (const tier of LLM_TIER_IDS) {
    const row = tiers[tier];
    if (!row) continue;
    const keys: string[] = [];
    let unreadable = 0;
    for (const payload of row.keys ?? []) {
      const plain = decryptSecret(payload);
      if (plain) keys.push(plain);
      else unreadable++;
    }
    runtime.tiers[tier] = {
      enabled: row.enabled !== false,
      baseUrl: row.baseUrl,
      model: row.model,
      keys,
      unreadable,
      temperature: row.temperature,
      maxTokens: row.maxTokens,
      timeoutMs: row.timeoutMs,
      extraHeaders: row.extraHeaders,
    };
  }
  return buildChainFromSettings(runtime);
}
