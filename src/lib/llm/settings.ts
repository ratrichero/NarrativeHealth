// LLM-CONFIG-01 — Admin-editable provider chain, stored in `app_settings`.
//
// Precedence is per tier: a tier configured and enabled in the DB wins; a tier
// absent from the DB (or an unreadable/corrupt row) falls back to the env vars
// that `provider-chain.ts` has always used. A tier explicitly disabled in the
// DB is skipped — that is an operator decision, not a reason to use env.
//
// Safety valves:
//  - LLM_FORCE_ENV=1 ignores the DB entirely (bad config cannot lock you out).
//  - Keys are AES-256-GCM encrypted at rest with LLM_CONFIG_SECRET (or
//    AUTH_SECRET); a `v1:` payload that cannot be decrypted is dropped, and the
//    tier then has NO keys — it never silently borrows the env key.
//  - Every save keeps the previous config in `llm.chain.history` (max 5) for
//    rollback, with who/when.
//
// Reads are cached; the cache is dropped immediately on save (same process) and
// through Postgres NOTIFY `llm_config_changed` (other instances), with a 30s TTL
// as a last-resort fallback when NOTIFY cannot be used.

import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

export const LLM_SETTINGS_KEY = "llm.chain";
export const LLM_HISTORY_KEY = "llm.chain.history";
export const LLM_NOTIFY_CHANNEL = "llm_config_changed";
export const LLM_TIER_IDS = ["google", "primary", "fallback1", "fallback2"] as const;
export type LlmTierId = (typeof LLM_TIER_IDS)[number];

/** Per-feature tier ordering (LLM-PROFILE-01). */
export const LLM_FEATURE_PROFILES = ["chat", "square", "movers"] as const;
export type LlmFeatureProfile = (typeof LLM_FEATURE_PROFILES)[number];

const CACHE_TTL_MS = 30_000;
const HISTORY_LIMIT = 5;
const ENC_PREFIX = "v1";
const ENC_SALT = "narrativehealth:llm-config";

/** One tier as stored in the DB. `keys` are encrypted strings. */
export interface StoredTier {
  enabled: boolean;
  baseUrl?: string;
  model?: string;
  keys: string[];
  /** Per-tier overrides; unset falls back to the env knobs in config.ts. */
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
}

export interface StoredLlmSettings {
  version: 1;
  tiers: Partial<Record<LlmTierId, StoredTier>>;
  /** Tier order per feature; missing feature keeps the chain order. */
  profiles?: Partial<Record<LlmFeatureProfile, LlmTierId[]>>;
  updatedAt: string;
  updatedBy?: string;
}

/** One tier after decryption, ready for the resolver. */
export interface RuntimeTier {
  enabled: boolean;
  baseUrl?: string;
  model?: string;
  keys: string[];
  /** Keys that could not be decrypted (wrong/rotated secret). */
  unreadable: number;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
}

export interface RuntimeLlmSettings {
  tiers: Partial<Record<LlmTierId, RuntimeTier>>;
  profiles?: Partial<Record<LlmFeatureProfile, LlmTierId[]>>;
  updatedAt: string;
  updatedBy?: string;
}

export interface LlmHistoryEntry {
  updatedAt: string;
  updatedBy: string;
  tiers: Partial<Record<LlmTierId, StoredTier>>;
  profiles?: Partial<Record<LlmFeatureProfile, LlmTierId[]>>;
}

// ─── Encryption ─────────────────────────────────────────

function configSecret(): string | null {
  const secret = process.env.LLM_CONFIG_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
  return secret && secret.length >= 16 ? secret : null;
}

export function llmConfigSecretConfigured(): boolean {
  return configSecret() !== null;
}

function aesKey(secret: string): Buffer {
  return crypto.scryptSync(secret, ENC_SALT, 32);
}

export function encryptSecret(plain: string): string {
  const secret = configSecret();
  if (!secret) {
    throw new Error("LLM_CONFIG_SECRET (or AUTH_SECRET) is required to store provider keys.");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    ENC_PREFIX,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/** Returns null when the payload cannot be decrypted (rotated secret, garbage). */
export function decryptSecret(payload: string): string | null {
  if (!payload.startsWith(`${ENC_PREFIX}:`)) return payload; // hand-seeded plaintext
  const secret = configSecret();
  if (!secret) return null;
  try {
    const [, ivB64, tagB64, dataB64] = payload.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      aesKey(secret),
      Buffer.from(ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** `…abcd` for the admin UI — never the whole key. */
export function maskKey(key: string): string {
  return key.length > 8 ? `…${key.slice(-4)}` : "…";
}

// ─── Cache / invalidation ───────────────────────────────

let cache: { at: number; value: RuntimeLlmSettings | null } | null = null;
let dbWarned = false;
let listenerStarted = false;

export function invalidateLlmSettingsCache(): void {
  cache = null;
}

/** LLM_FORCE_ENV=1 (or true) → behave as if the DB config did not exist. */
export function llmConfigForcedEnv(): boolean {
  const raw = process.env.LLM_FORCE_ENV?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Tests load the workspace .env (production DATABASE_URL), so a unit test must
 * never open a connection just to resolve a chain. The settings suite opts back
 * in with LLM_SETTINGS_TEST_DB=1 — it mocks @/db.
 */
function dbDisabled(): boolean {
  return process.env.NODE_ENV === "test" && process.env.LLM_SETTINGS_TEST_DB !== "1";
}

/**
 * Cross-instance invalidation: a dedicated connection LISTENs on
 * `llm_config_changed`, which save/clear/rollback/import publish. Falls back to
 * the cache TTL when the connection cannot be established (single instance,
 * restricted DB role, tests).
 */
function startListener(): void {
  if (listenerStarted || dbDisabled()) return;
  listenerStarted = true;

  const url = process.env.DATABASE_URL?.replace("postgresql+asyncpg://", "postgresql://");
  if (!url) return;

  void (async () => {
    try {
      const { Client } = await import("pg");
      const client = new Client({ connectionString: url });
      client.on("notification", () => invalidateLlmSettingsCache());
      client.on("error", () => {
        listenerStarted = false;
        void client.end().catch(() => undefined);
      });
      await client.connect();
      await client.query(`LISTEN ${LLM_NOTIFY_CHANNEL}`);
      console.info(`[LLM-CONFIG] listening on ${LLM_NOTIFY_CHANNEL}`);
    } catch (error) {
      listenerStarted = false;
      console.warn(
        "[LLM-CONFIG] NOTIFY listener unavailable, relying on the 30s cache TTL:",
        (error as Error).message
      );
    }
  })();
}

async function publishChange(): Promise<void> {
  try {
    await db.execute(sql`select pg_notify(${LLM_NOTIFY_CHANNEL}, '')`);
  } catch {
    // Best effort: the saving instance already invalidated its own cache.
  }
}

function toRuntime(stored: StoredLlmSettings): RuntimeLlmSettings {
  const tiers: Partial<Record<LlmTierId, RuntimeTier>> = {};
  for (const tier of LLM_TIER_IDS) {
    const row = stored.tiers?.[tier];
    if (!row) continue;
    const keys: string[] = [];
    let unreadable = 0;
    for (const payload of row.keys ?? []) {
      const plain = decryptSecret(payload);
      if (plain) keys.push(plain);
      else unreadable++;
    }
    tiers[tier] = {
      enabled: row.enabled !== false,
      baseUrl: row.baseUrl?.trim() || undefined,
      model: row.model?.trim() || undefined,
      keys,
      unreadable,
      temperature: row.temperature,
      maxTokens: row.maxTokens,
      timeoutMs: row.timeoutMs,
      extraHeaders: row.extraHeaders,
    };
  }
  return {
    tiers,
    profiles: stored.profiles,
    updatedAt: stored.updatedAt,
    updatedBy: stored.updatedBy,
  };
}

/**
 * Cached DB config. Never throws: a DB outage or a corrupt row must degrade to
 * the env chain, not break every LLM call.
 */
export async function loadLlmRuntimeSettings(
  force = false
): Promise<RuntimeLlmSettings | null> {
  if (llmConfigForcedEnv()) return null;
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (dbDisabled()) return null;

  startListener();

  let value: RuntimeLlmSettings | null = null;
  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, LLM_SETTINGS_KEY))
      .limit(1);
    const stored = row?.value as StoredLlmSettings | undefined;
    if (stored && stored.version === 1 && stored.tiers) value = toRuntime(stored);
  } catch (error) {
    if (!dbWarned) {
      dbWarned = true;
      console.warn(
        "[LLM-CONFIG] cannot read app_settings.llm.chain — falling back to env:",
        (error as Error).message
      );
    }
    value = null;
  }

  cache = { at: Date.now(), value };
  return value;
}

export async function readStoredLlmSettings(): Promise<StoredLlmSettings | null> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, LLM_SETTINGS_KEY))
    .limit(1);
  const stored = row?.value as StoredLlmSettings | undefined;
  return stored && stored.version === 1 ? stored : null;
}

export async function readLlmHistory(): Promise<LlmHistoryEntry[]> {
  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, LLM_HISTORY_KEY))
      .limit(1);
    const entries = row?.value as LlmHistoryEntry[] | undefined;
    return Array.isArray(entries) ? entries.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

async function writeHistory(entries: LlmHistoryEntry[]): Promise<void> {
  const value = entries.slice(0, HISTORY_LIMIT);
  await db
    .insert(appSettings)
    .values({ key: LLM_HISTORY_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/** Keep the replaced config in history, then store the new one. */
export async function saveStoredLlmSettings(
  stored: StoredLlmSettings,
  options: { updatedBy?: string; keepHistory?: boolean } = {}
): Promise<void> {
  if (options.keepHistory !== false) {
    const previous = await readStoredLlmSettings().catch(() => null);
    if (previous) {
      const history = await readLlmHistory();
      await writeHistory([
        {
          updatedAt: previous.updatedAt,
          updatedBy: previous.updatedBy ?? "admin",
          tiers: previous.tiers,
          profiles: previous.profiles,
        },
        ...history,
      ]);
    }
  }

  const value: StoredLlmSettings = { ...stored, updatedBy: options.updatedBy ?? "admin" };
  await db
    .insert(appSettings)
    .values({ key: LLM_SETTINGS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  invalidateLlmSettingsCache();
  await publishChange();
}

export async function clearStoredLlmSettings(updatedBy = "admin"): Promise<void> {
  const previous = await readStoredLlmSettings().catch(() => null);
  if (previous) {
    const history = await readLlmHistory();
    await writeHistory([
      {
        updatedAt: previous.updatedAt,
        updatedBy: previous.updatedBy ?? "admin",
        tiers: previous.tiers,
        profiles: previous.profiles,
      },
      ...history,
    ]);
  }
  await db.delete(appSettings).where(eq(appSettings.key, LLM_SETTINGS_KEY));
  invalidateLlmSettingsCache();
  await publishChange();
  void updatedBy;
}

/** Restore history entry `index` (0 = most recent replaced config). */
export async function rollbackLlmSettings(
  index: number,
  updatedBy = "admin"
): Promise<boolean> {
  const history = await readLlmHistory();
  const entry = history[index];
  if (!entry) return false;
  await saveStoredLlmSettings(
    {
      version: 1,
      tiers: entry.tiers,
      profiles: entry.profiles,
      updatedAt: new Date().toISOString(),
    },
    { updatedBy }
  );
  return true;
}
