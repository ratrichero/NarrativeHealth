// GKEY-01 — Google AI multi-key pool shared by the Square and chat LLM chains.
//
// Different Google Cloud / AI Studio projects each carry their own
// GOOGLE_AI_API_KEY with separate free-tier quotas. This pool lets one app
// rotate across all of them instead of burning a single project's quota:
//
//  - GOOGLE_AI_API_KEYS="key1,key2,…" (preferred, comma-separated)
//  - GOOGLE_AI_API_KEY (legacy single key) — used when the list is unset
//
// Behavior:
//  - Round-robin start index per resolve() so consecutive posts spread load
//    across projects (the pipeline publishes sequentially with a stagger).
//  - A key answering 429/5xx gets a short cooldown (default 60s,
//    GOOGLE_AI_KEY_COOLDOWN_MS); an invalid or suspended project key
//    (401/403) gets a long one (default 10min, GOOGLE_AI_KEY_AUTH_COOLDOWN_MS).
//  - Any successful HTTP 200 clears the cooldown immediately.
//  - An empty or fully-cooled pool returns [] — callers simply continue with
//    the next provider tier (Groq, OpenRouter, …), never blocking posting.
//
// State lives at module scope: correct for the long-lived Next.js server
// process that runs the Square pipeline and chat route.

export interface GooglePooledProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Identity used to report call outcomes back to the pool. */
  googlePoolKey: string;
}

export const GOOGLE_POOL_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";

function shortCooldownMs(): number {
  return Number(process.env.GOOGLE_AI_KEY_COOLDOWN_MS ?? 60_000);
}
function authCooldownMs(): number {
  return Number(process.env.GOOGLE_AI_KEY_AUTH_COOLDOWN_MS ?? 600_000);
}

interface KeyState {
  key: string;
  failedUntil: number;
  lastStatus: number | null;
  successCount: number;
  failCount: number;
}

const states = new Map<string, KeyState>();
let nextStart = 0;

function configuredKeys(): string[] {
  const raw =
    process.env.GOOGLE_AI_API_KEYS?.trim() ||
    process.env.GOOGLE_AI_API_KEY?.trim() ||
    "";
  const keys = raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  return [...new Set(keys)];
}

/**
 * Build the google provider entries for the current chain position — one per
 * configured key that is not in cooldown, rotated round-robin. Returns []
 * when nothing is usable (caller falls through to the next tier).
 */
export function resolveGooglePool(model: string): GooglePooledProvider[] {
  const keys = configuredKeys();
  if (keys.length === 0) return [];

  // Track new keys; drop keys removed from env (runtime env change).
  for (const k of keys) {
    if (!states.has(k)) {
      states.set(k, {
        key: k,
        failedUntil: 0,
        lastStatus: null,
        successCount: 0,
        failCount: 0,
      });
    }
  }
  for (const k of [...states.keys()]) {
    if (!keys.includes(k)) states.delete(k);
  }

  const now = Date.now();
  const available = keys.filter((k) => (states.get(k)?.failedUntil ?? 0) <= now);
  if (available.length === 0) {
    console.warn(
      `[GKEY-POOL] all ${keys.length} google key(s) in cooldown — skipping google tier.`
    );
    return [];
  }
  if (available.length > 1) {
    console.info(
      `[GKEY-POOL] rotating ${available.length}/${keys.length} google key(s)`
    );
  }

  const start = nextStart++ % available.length;
  const ordered = [...available.slice(start), ...available.slice(0, start)];
  return ordered.map((k) => ({
    name: "google",
    baseUrl: GOOGLE_POOL_BASE_URL,
    apiKey: k,
    model,
    googlePoolKey: k,
  }));
}

/**
 * Report the outcome of one HTTP attempt against a pooled key so cooldowns
 * stay accurate. `status` is the HTTP status (or undefined for transport
 * errors). 200 clears cooldown; 401/403 → long cooldown; everything else
 * → short cooldown.
 */
export function reportGoogleKeyOutcome(
  key: string,
  ok: boolean,
  status?: number
): void {
  // Lazy-create: callers always report keys they got from resolveGooglePool,
  // but report may legally arrive before any resolve in the same process —
  // the next resolve() syncs unknown keys out anyway.
  let s = states.get(key);
  if (!s) {
    s = { key, failedUntil: 0, lastStatus: null, successCount: 0, failCount: 0 };
    states.set(key, s);
  }
  if (ok) {
    s.failedUntil = 0;
    s.lastStatus = status ?? 200;
    s.successCount++;
    return;
  }
  const auth = status === 401 || status === 403;
  s.failedUntil = Date.now() + (auth ? authCooldownMs() : shortCooldownMs());
  s.lastStatus = status ?? 0;
  s.failCount++;
  console.warn(
    `[GKEY-POOL] key …${key.slice(-4)} ${
      auth ? "auth-failed/suspended" : `HTTP ${status ?? "transport error"}`
    } — cooldown ${Math.round((auth ? authCooldownMs() : shortCooldownMs()) / 1000)}s`
  );
}

/** Introspection for logs/debug tooling. */
export function googlePoolStats(): {
  total: number;
  available: number;
  failed: number;
  perKey: { suffix: string; lastStatus: number | null; successCount: number; failCount: number; cooling: boolean }[];
} {
  const now = Date.now();
  const perKey = [...states.values()].map((s) => ({
    suffix: `…${s.key.slice(-4)}`,
    lastStatus: s.lastStatus,
    successCount: s.successCount,
    failCount: s.failCount,
    cooling: s.failedUntil > now,
  }));
  return {
    total: perKey.length,
    available: perKey.filter((p) => !p.cooling).length,
    failed: perKey.filter((p) => p.cooling).length,
    perKey,
  };
}

/** Test-only: wipe pool state so unit tests start clean. */
export function _resetGoogleKeyPool(): void {
  states.clear();
  nextStart = 0;
}
