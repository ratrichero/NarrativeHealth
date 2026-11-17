// LLM-CONFIG-01 — the provider chain must read tiers from app_settings first
// and fall back to env per tier, never break an LLM call when the DB row is
// missing/corrupt, and never expose a key to the admin UI.

jest.mock("@/db", () => {
  const store = new Map<string, unknown>();
  return {
    __store: store,
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () =>
              store.has("llm.chain")
                ? [{ key: "llm.chain", value: store.get("llm.chain"), updatedAt: new Date() }]
                : [],
          }),
        }),
      }),
      insert: () => ({
        values: (row: { key: string; value: unknown }) => ({
          onConflictDoUpdate: async () => {
            store.set(row.key, row.value);
          },
        }),
      }),
      delete: () => ({
        where: async () => {
          store.clear();
        },
      }),
    },
  };
});

import { resolveProviderChain } from "../provider-chain";
import { _resetGoogleKeyPool } from "../google-key-pool";
import {
  clearStoredLlmSettings,
  decryptSecret,
  encryptSecret,
  invalidateLlmSettingsCache,
  loadLlmRuntimeSettings,
  maskKey,
  saveStoredLlmSettings,
  type StoredLlmSettings,
} from "../settings";
import { mergeTiers } from "../tier-input";
import { isolateLlmEnv, type LlmTestEnv } from "./llm-env";

// Opt back into the DB path (settings.ts skips it for every other suite so a
// unit test never opens a connection to the workspace .env database).
process.env.LLM_SETTINGS_TEST_DB = "1";

const store = (jest.requireMock("@/db") as { __store: Map<string, unknown> }).__store;

let env: LlmTestEnv;

/** Store a config row. `keys` are plaintext and get encrypted here. */
async function storeTiers(
  tiers: StoredLlmSettings["tiers"],
  updatedAt = new Date().toISOString()
): Promise<void> {
  const encrypted = { ...tiers };
  for (const [tier, row] of Object.entries(encrypted)) {
    if (row) encrypted[tier as keyof typeof tiers] = { ...row, keys: row.keys.map(encryptSecret) };
  }
  await saveStoredLlmSettings({ version: 1, tiers: encrypted, updatedAt });
}

const names = (chain: { name: string }[]) => chain.map((p) => p.name);

beforeEach(() => {
  env = isolateLlmEnv();
  process.env.LLM_CONFIG_SECRET = "test-secret-0123456789";
  store.clear();
  invalidateLlmSettingsCache();
  _resetGoogleKeyPool();
});

afterEach(() => {
  env.restore();
  delete process.env.LLM_CONFIG_SECRET;
});

describe("resolveProviderChain precedence", () => {
  it("uses env for every tier when nothing is stored", async () => {
    process.env.OPENAI_API_KEY = "env-primary-key";
    process.env.MODEL_NAME = "env-model";

    const chain = await resolveProviderChain();

    expect(names(chain)).toEqual(["google", "primary"]);
    expect(chain[1]).toMatchObject({ apiKey: "env-primary-key", model: "env-model" });
  });

  it("overrides only the tiers declared in the DB", async () => {
    process.env.OPENAI_API_KEY = "env-primary-key";
    process.env.MODEL_NAME = "env-model";
    process.env.FALLBACK_OPENAI_API_KEY = "env-fallback-key";
    process.env.FALLBACK_MODEL_NAME = "env-fallback-model";
    await storeTiers({
      primary: { enabled: true, model: "db-model", baseUrl: "https://db.example/v1", keys: ["db-key"] },
    });

    const chain = await resolveProviderChain();

    expect(names(chain)).toEqual(["google", "primary", "fallback1"]);
    expect(chain[1]).toMatchObject({
      apiKey: "db-key",
      model: "db-model",
      baseUrl: "https://db.example/v1",
    });
    expect(chain[2]).toMatchObject({ apiKey: "env-fallback-key" });
  });

  it("skips a tier disabled in the DB instead of falling back to env", async () => {
    process.env.OPENAI_API_KEY = "env-primary-key";
    process.env.MODEL_NAME = "env-model";
    await storeTiers({ primary: { enabled: false, model: "env-model", keys: [] } });

    const chain = await resolveProviderChain();

    expect(names(chain)).toEqual(["google"]);
  });

  it("feeds the google pool from DB keys (one entry per key)", async () => {
    await storeTiers({
      google: { enabled: true, model: "gemini-db", keys: ["db-google-1", "db-google-2"] },
    });

    const chain = await resolveProviderChain();
    const google = chain.filter((p) => p.name === "google");

    expect(google.map((p) => p.apiKey)).toEqual(["db-google-1", "db-google-2"]);
    expect(google[0]?.model).toBe("gemini-db");
    // The env key must not leak into a DB-configured pool.
    expect(google.some((p) => p.apiKey === "test-google-key-1234")).toBe(false);
  });

  it("falls back to env when the stored row is unusable", async () => {
    process.env.OPENAI_API_KEY = "env-primary-key";
    process.env.MODEL_NAME = "env-model";
    store.set("llm.chain", { version: 99, tiers: {} }); // unknown schema version
    invalidateLlmSettingsCache();

    const chain = await resolveProviderChain();

    expect(names(chain)).toEqual(["google", "primary"]);
    expect(chain[1]?.apiKey).toBe("env-primary-key");
  });

  it("keeps a DB google tier with unreadable keys OUT of the env pool", async () => {
    // Env still has test-google-key-1234; the DB row exists but its key is
    // garbage, so the tier must contribute nothing at all.
    store.set("llm.chain", {
      version: 1,
      updatedAt: new Date().toISOString(),
      tiers: {
        google: { enabled: true, model: "gemini-db", keys: ["v1:bm90:dmFsaWQ=:bm90LWEta2V5"] },
      },
    });
    invalidateLlmSettingsCache();

    const chain = await resolveProviderChain();

    expect(chain.some((p) => p.name === "google")).toBe(false);
    expect(chain.some((p) => p.apiKey === "test-google-key-1234")).toBe(false);
  });

  it("drops keys it cannot decrypt and reports them as unreadable", async () => {
    store.set("llm.chain", {
      version: 1,
      updatedAt: new Date().toISOString(),
      tiers: {
        primary: { enabled: true, model: "m", keys: ["v1:bm90:dmFsaWQ=:bm90LWEta2V5"] },
      },
    });
    invalidateLlmSettingsCache();

    const runtime = await loadLlmRuntimeSettings();
    const chain = await resolveProviderChain();

    expect(runtime?.tiers.primary).toMatchObject({ keys: [], unreadable: 1 });
    expect(names(chain)).toEqual(["google"]);
  });
});

describe("mergeTiers (admin save validation)", () => {
  const previous = {
    version: 1 as const,
    updatedAt: new Date().toISOString(),
    tiers: {
      primary: { enabled: true, model: "old-model", keys: ["v1:a:b:c"] },
    },
  };

  it("allows model/base URL edits without a config secret", () => {
    delete process.env.LLM_CONFIG_SECRET;
    delete process.env.AUTH_SECRET;

    const { tiers, errors } = mergeTiers(previous, {
      primary: { model: "new-model", baseUrl: "https://new.example/v1" },
    });

    expect(errors).toEqual([]);
    expect(tiers.primary?.model).toBe("new-model");
    expect(tiers.primary?.keys).toEqual(["v1:a:b:c"]); // stored keys kept
  });

  it("still blocks storing new keys without a config secret", () => {
    delete process.env.LLM_CONFIG_SECRET;
    delete process.env.AUTH_SECRET;

    const { errors } = mergeTiers(previous, { primary: { keys: ["brand-new-key"] } });

    expect(errors.join(" ")).toMatch(/LLM_CONFIG_SECRET/);
  });

  it("rejects out-of-range advanced fields", () => {
    const { errors } = mergeTiers(previous, {
      primary: { temperature: 4, maxTokens: 99999, timeoutMs: 10 },
    });

    expect(errors).toHaveLength(3);
  });
});

describe("settings storage", () => {
  it("encrypts keys at rest and round-trips them", () => {
    const payload = encryptSecret("plain-key-value");

    expect(payload.startsWith("v1:")).toBe(true);
    expect(payload).not.toContain("plain-key-value");
    expect(decryptSecret(payload)).toBe("plain-key-value");
    expect(maskKey("plain-key-value")).toBe("…alue");
  });

  it("makes a save visible immediately (cache invalidated)", async () => {
    expect(names(await resolveProviderChain())).toEqual(["google"]);

    await storeTiers({
      primary: { enabled: true, model: "db-model", baseUrl: "https://db.example/v1", keys: ["db-key"] },
    });

    expect(names(await resolveProviderChain())).toEqual(["google", "primary"]);
  });

  it("returns the env chain again after clearing the DB config", async () => {
    process.env.OPENAI_API_KEY = "env-primary-key";
    process.env.MODEL_NAME = "env-model";
    await storeTiers({
      primary: { enabled: true, model: "db-model", baseUrl: "https://db.example/v1", keys: ["db-key"] },
    });
    expect(names(await resolveProviderChain())).toContain("primary");

    await clearStoredLlmSettings();
    const chain = await resolveProviderChain();

    expect(chain.find((p) => p.name === "primary")?.apiKey).toBe("env-primary-key");
  });
});
