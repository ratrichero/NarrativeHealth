// GKEY-01 — unit tests for the Google multi-key pool.

import {
  resolveGooglePool,
  reportGoogleKeyOutcome,
  googlePoolStats,
  _resetGoogleKeyPool,
} from "../google-key-pool";

const MODEL = "gemini-2.5-flash-lite";

function setEnv(keys: string | undefined) {
  if (keys === undefined) {
    delete process.env.GOOGLE_AI_API_KEYS;
    delete process.env.GOOGLE_AI_API_KEY;
  } else {
    process.env.GOOGLE_AI_API_KEYS = keys;
  }
}

describe("GKEY-01: google key pool", () => {
  beforeEach(() => {
    _resetGoogleKeyPool();
    // Isolate from the real workspace env (the sandbox injects a real key).
    delete process.env["GOOGLE_AI_" + "API_KEY"];
    delete process.env["GOOGLE_AI_KEY_" + "COOLDOWN_MS"];
    delete process.env["GOOGLE_AI_KEY_AUTH_" + "COOLDOWN_MS"];
  });

  afterAll(() => {
    setEnv(undefined);
  });

  it("returns empty list when no keys are configured", () => {
    setEnv(undefined);
    expect(resolveGooglePool(MODEL)).toEqual([]);
  });

  it("expands comma-separated keys into one provider per key", () => {
    setEnv("keyA,keyB,keyC");
    const providers = resolveGooglePool(MODEL);
    expect(providers).toHaveLength(3);
    expect(providers.map((p) => p.apiKey)).toEqual(["keyA", "keyB", "keyC"]);
    for (const p of providers) {
      expect(p.name).toBe("google");
      expect(p.model).toBe(MODEL);
      expect(p.baseUrl).toContain("generativelanguage.googleapis.com");
    }
  });

  it("falls back to the legacy single GOOGLE_AI_API_KEY", () => {
    setEnv(undefined);
    process.env.GOOGLE_AI_API_KEY = "legacy-key";
    const providers = resolveGooglePool(MODEL);
    expect(providers).toHaveLength(1);
    expect(providers[0].apiKey).toBe("legacy-key");
  });

  it("deduplicates repeated keys", () => {
    setEnv("keyA,keyA,keyB");
    const providers = resolveGooglePool(MODEL);
    expect(providers.map((p) => p.apiKey)).toEqual(["keyA", "keyB"]);
  });

  it("rotates the starting key round-robin across consecutive resolves", () => {
    setEnv("keyA,keyB");
    const first = resolveGooglePool(MODEL).map((p) => p.apiKey);
    const second = resolveGooglePool(MODEL).map((p) => p.apiKey);
    expect(first).toEqual(["keyA", "keyB"]);
    expect(second).toEqual(["keyB", "keyA"]);
  });

  it("a 429 puts the key on short cooldown and traffic flows to the other key", () => {
    setEnv("keyA,keyB");
    reportGoogleKeyOutcome("keyA", false, 429);
    const providers = resolveGooglePool(MODEL);
    expect(providers.map((p) => p.apiKey)).toEqual(["keyB"]);
    const stats = googlePoolStats();
    expect(stats.available).toBe(1);
    expect(stats.failed).toBe(1);
  });

  it("a 403 suspended key is excluded from the pool", () => {
    setEnv("keyA,keyB,keyC");
    reportGoogleKeyOutcome("keyB", false, 403);
    const providers = resolveGooglePool(MODEL);
    expect(providers.map((p) => p.apiKey)).toEqual(["keyA", "keyC"]);
  });

  it("a success clears the cooldown immediately", () => {
    setEnv("keyA,keyB");
    reportGoogleKeyOutcome("keyA", false, 429);
    reportGoogleKeyOutcome("keyA", true, 200);
    const providers = resolveGooglePool(MODEL);
    expect(providers).toHaveLength(2);
    const stats = googlePoolStats();
    expect(stats.available).toBe(2);
    expect(stats.failed).toBe(0);
  });

  it("all keys cooling → empty pool so callers continue with the next tier", () => {
    setEnv("keyA,keyB");
    reportGoogleKeyOutcome("keyA", false, 429);
    reportGoogleKeyOutcome("keyB", false, 503);
    expect(resolveGooglePool(MODEL)).toEqual([]);
  });

  it("short cooldown honours GOOGLE_AI_KEY_COOLDOWN_MS", () => {
    setEnv("keyA");
    process.env.GOOGLE_AI_KEY_COOLDOWN_MS = "50";
    reportGoogleKeyOutcome("keyA", false, 429);
    expect(resolveGooglePool(MODEL)).toEqual([]);
    return new Promise((resolve) => setTimeout(resolve, 80)).then(() => {
      expect(resolveGooglePool(MODEL)).toHaveLength(1);
    });
  });

  it("stats track success and failure counts per key", () => {
    setEnv("keyA,keyB");
    resolveGooglePool(MODEL); // vend both keys first — realistic flow
    reportGoogleKeyOutcome("keyA", true, 200);
    reportGoogleKeyOutcome("keyA", false, 429);
    const stats = googlePoolStats();
    const a = stats.perKey.find((p) => p.suffix === "…keyA");
    const b = stats.perKey.find((p) => p.suffix === "…keyB");
    expect(a?.successCount).toBe(1);
    expect(a?.failCount).toBe(1);
    expect(a?.cooling).toBe(true);
    expect(b?.cooling).toBe(false);
  });
});
