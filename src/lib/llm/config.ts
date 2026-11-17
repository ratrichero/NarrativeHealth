// Shared LLM chain configuration, read from the same env vars documented in
// .env / .env.example so operator tuning actually takes effect. Used by both
// the Square content chain and the chat chain (they previously hardcoded
// 3 attempts / 30s / 0.3–0.4 temperature, silently ignoring LLM_MAX_RETRIES,
// LLM_REQUEST_TIMEOUT and LLM_TEMPERATURE).
//
// Every value is clamped so a typo in .env cannot stall the pipeline: at most
// 4 attempts per provider, at most 120s per request, temperature 0–1.5.

const DEFAULT_MAX_ATTEMPTS = 3; // initial try + 2 transient-status retries
const MAX_ATTEMPTS_CAP = 4;
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RETRY_DELAY_MS = 10_000;

function numberFromEnv(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** HTTP attempts per provider: 1 + LLM_MAX_RETRIES, clamped to 1..4. */
export function llmMaxHttpAttempts(): number {
  const retries = numberFromEnv("LLM_MAX_RETRIES");
  if (retries === null) return DEFAULT_MAX_ATTEMPTS;
  return clamp(1 + Math.floor(Math.max(0, retries)), 1, MAX_ATTEMPTS_CAP);
}

/** Per-request timeout in ms. LLM_REQUEST_TIMEOUT is in seconds (30.0 → 30 000). */
export function llmRequestTimeoutMs(fallbackMs = DEFAULT_TIMEOUT_MS): number {
  const seconds = numberFromEnv("LLM_REQUEST_TIMEOUT");
  if (seconds === null) return fallbackMs;
  return clamp(Math.round(seconds * 1000), MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
}

/** Sampling temperature from LLM_TEMPERATURE, falling back to the call-site default. */
export function llmTemperature(fallback: number): number {
  const value = numberFromEnv("LLM_TEMPERATURE");
  if (value === null) return fallback;
  return clamp(value, 0, 1.5);
}

/** Backoff before retrying a transient status: Retry-After if present, else 2s × attempt. */
export function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(retryAfter * 1000, MAX_RETRY_DELAY_MS)
    : 2000 * attempt;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
