// LLM-CANARY-01/02 — periodic probes that do not cry wolf.
//
// Without traffic, a suspended key or a free tier that stopped working stays
// invisible until a user hits it, so each tier is pinged with a 1-token
// request. LLM-CANARY-02 fixes the false failures seen on the tokenlab
// fallback2 tier: 1-token probes normally answer in <1s, yet the canary used a
// hardcoded 10s budget (real traffic gets LLM_REQUEST_TIMEOUT, 30s) and treated
// a single timeout as a dead tier.
//
// Rules now:
//  - budget = max(provider.timeoutMs, LLM_CANARY_TIMEOUT_MS or the request
//    timeout), so the probe is never stricter than production;
//  - one retry for timeout/429/5xx before a miss is counted;
//  - a timeout/5xx is “degraded” (alive, slow) and only becomes a failure after
//    LIMIT consecutive missed sweeps; auth/request errors fail immediately;
//  - probes run sequentially with a stagger, so a low-quota tier is not hit by
//    a burst of parallel probes, and the interval has jitter;
//  - LLM_CANARY_SKIP=fallback2 (names or models, comma-separated) keeps a tier
//    out of probes entirely — its health then comes from real traffic;
//  - LLM_CANARY_PREFLIGHT=1 checks GET /models first and only spends a token
//    when the endpoint answers (opt-in: not every provider implements it).

import { resolveProviderChain, type LlmProvider } from "./provider-chain";
import { recordLlmOutcome } from "./monitor";
import { recordLlmTelemetry } from "./telemetry";
import { classifyLlmFailure, type LlmFailureKind } from "./errors";
import { llmRequestTimeoutMs, sleep } from "./config";
import { noteTierSuccess } from "./breaker";

export interface CanaryResult {
  provider: string;
  model: string;
  ok: boolean;
  /** Alive but slow (first timeout/5xx of a streak) — not a failure. */
  degraded?: boolean;
  kind?: "timeout" | LlmFailureKind;
  status: number;
  latencyMs: number;
  at: string;
  detail?: string;
  /** Missed sweeps in a row (0 when the probe passed). */
  consecutiveMisses: number;
}

const MISSES_BEFORE_FAIL = 2;
const history: CanaryResult[] = [];
const misses = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | null = null;

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function canaryTimeoutMs(provider: LlmProvider): number {
  const configured = numberEnv("LLM_CANARY_TIMEOUT_MS", 0);
  const budget = configured > 0 ? configured : llmRequestTimeoutMs();
  return Math.max(provider.timeoutMs ?? 0, budget);
}

function skippedTiers(): string[] {
  return (process.env.LLM_CANARY_SKIP ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function isTimeoutError(error: unknown): boolean {
  const name = (error as Error | undefined)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

function headerAuth(provider: LlmProvider): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
    ...(provider.extraHeaders ?? {}),
  };
}

interface Attempt {
  ok: boolean;
  degraded?: boolean;
  status: number;
  latencyMs: number;
  detail?: string;
  kind?: "timeout" | LlmFailureKind;
}

async function probeOnce(provider: LlmProvider, timeoutMs: number): Promise<Attempt> {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: headerAuth(provider),
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const detail = response.ok
      ? undefined
      : (await response.text().catch(() => "")).slice(0, 160);
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      detail,
      kind: response.ok ? undefined : classifyLlmFailure(response.status, detail ?? ""),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      detail: (error as Error).message.slice(0, 160),
      kind: isTimeoutError(error) ? "timeout" : "transport",
    };
  }
}

/** Retry a transient probe failure once; a real outage survives both attempts. */
async function probeWithRetry(provider: LlmProvider, timeoutMs: number): Promise<Attempt> {
  const first = await probeOnce(provider, timeoutMs);
  if (first.ok) return first;

  const transient =
    first.kind === "timeout" ||
    first.kind === "transport" ||
    first.kind === "rate_limit" ||
    first.kind === "capacity" ||
    first.status === 0 ||
    first.status === 429 ||
    first.status >= 500;
  if (!transient) return first;

  await sleep(numberEnv("LLM_CANARY_RETRY_DELAY_MS", 1500));
  return probeOnce(provider, timeoutMs);
}

async function preflightOk(provider: LlmProvider, timeoutMs: number): Promise<boolean | null> {
  if (process.env.LLM_CANARY_PREFLIGHT !== "1") return null;
  try {
    const response = await fetch(`${provider.baseUrl}/models`, {
      method: "GET",
      headers: headerAuth(provider),
      signal: AbortSignal.timeout(Math.min(timeoutMs, 5_000)),
    });
    const body = await response.text().catch(() => "");
    // Some providers do not implement /models — that is not a tier failure.
    if (response.status === 404 || response.status === 405 || response.status === 501) return null;
    return response.ok && body.length > 0;
  } catch {
    return false;
  }
}

function record(result: CanaryResult): void {
  history.push(result);
  if (history.length > 60) history.splice(0, history.length - 60);

  const alive = result.ok || Boolean(result.degraded);
  recordLlmOutcome({
    provider: result.provider,
    model: result.model,
    source: "canary",
    ok: alive,
    degraded: result.degraded,
    status: result.status,
    durationMs: result.latencyMs,
    error: alive
      ? result.degraded
        ? `degraded: ${result.kind ?? "slow"} (${result.consecutiveMisses}/${MISSES_BEFORE_FAIL})`
        : undefined
      : result.detail,
  });
  recordLlmTelemetry({
    provider: result.provider,
    source: "canary",
    ok: alive,
    status: result.status,
    durationMs: result.latencyMs,
    kind: alive ? undefined : result.kind,
  });
}

async function persistResult(provider: LlmProvider, attempt: Attempt): Promise<CanaryResult> {
  const previous = misses.get(provider.name) ?? 0;
  const fatal =
    attempt.kind === "auth" ||
    attempt.kind === "request_invalid" ||
    attempt.kind === "content_policy";
  const consecutiveMisses = attempt.ok ? 0 : previous + 1;
  if (attempt.ok) {
    misses.delete(provider.name);
    // LLM-BREAKER-01: a healthy probe closes a breaker opened by stale traffic,
    // so a fixed key does not stay skipped for the rest of its cooldown.
    noteTierSuccess(provider.name, provider.apiKey);
  } else misses.set(provider.name, consecutiveMisses);

  // A single timeout/5xx is a slow tier, not a dead one. Auth errors are not.
  const degraded = !attempt.ok && !fatal && consecutiveMisses < MISSES_BEFORE_FAIL;

  const result: CanaryResult = {
    provider: provider.name,
    model: provider.model,
    ok: attempt.ok,
    degraded,
    kind: attempt.ok ? undefined : attempt.kind,
    status: attempt.status,
    latencyMs: attempt.latencyMs,
    at: new Date().toISOString(),
    detail: attempt.detail,
    consecutiveMisses,
  };
  record(result);
  return result;
}

export async function runLlmCanary(): Promise<CanaryResult[]> {
  const chain = await resolveProviderChain("chat");
  const skip = skippedTiers();
  const stagger = numberEnv("LLM_CANARY_STAGGER_MS", 300);
  const results: CanaryResult[] = [];
  let probed = 0;

  // Sequential + staggered: parallel probes against a low-quota tier look like
  // a burst and get queued/429'd, which is exactly the false failure we avoid.
  for (const provider of chain) {
    if (skip.includes(provider.name) || skip.includes(provider.model)) continue;
    if (probed > 0 && stagger > 0) await sleep(stagger);
    probed++;

    const timeoutMs = canaryTimeoutMs(provider);
    const preflight = await preflightOk(provider, timeoutMs);
    if (preflight === false) {
      results.push(
        await persistResult(provider, {
          ok: false,
          status: 0,
          latencyMs: 0,
          detail: "preflight GET /models failed",
          kind: "timeout",
        })
      );
      continue;
    }

    results.push(await persistResult(provider, await probeWithRetry(provider, timeoutMs)));
  }

  return results;
}

function scheduleNext(intervalMs: number): void {
  const jitter = intervalMs * (Math.random() * 0.4 - 0.2); // ±20%
  timer = setTimeout(async () => {
    await runLlmCanary().catch((error) =>
      console.warn("[LLM-CANARY] probe run failed:", (error as Error).message)
    );
    scheduleNext(intervalMs);
  }, Math.max(30_000, Math.round(intervalMs + jitter)));
  timer.unref?.();
}

/** Start the background probe loop once per process (opt-out: LLM_CANARY_ENABLED=0). */
export function startLlmCanary(intervalMs = 5 * 60_000): void {
  if (timer) return;
  if (process.env.NODE_ENV === "test") return;
  if (process.env.LLM_CANARY_ENABLED === "0") return;
  scheduleNext(intervalMs);
}

export function canarySnapshot(): {
  running: boolean;
  last: CanaryResult[];
} {
  return { running: timer !== null, last: [...history].slice(-20) };
}

/** Test-only. */
export function _resetLlmCanary(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  history.length = 0;
  misses.clear();
}

/** Exported for tests. */
export const CANARY_MISSES_BEFORE_FAIL = MISSES_BEFORE_FAIL;
