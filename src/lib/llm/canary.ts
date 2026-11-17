// LLM-CANARY-01 — periodic probes.
//
// Without traffic, a suspended key or a free-tier that stopped working stays
// invisible until a user hits it. A cheap 1-token ping per tier every few
// minutes records into the monitor + telemetry, so the admin page shows a dead
// tier (and the reason) even when nobody is chatting.

import { resolveProviderChain } from "./provider-chain";
import { recordLlmOutcome } from "./monitor";
import { recordLlmTelemetry } from "./telemetry";
import { classifyLlmFailure } from "./errors";

export interface CanaryResult {
  provider: string;
  model: string;
  ok: boolean;
  status: number;
  latencyMs: number;
  at: string;
  detail?: string;
}

const history: CanaryResult[] = [];
const MAX_HISTORY = 60;
let timer: ReturnType<typeof setInterval> | null = null;

function record(result: CanaryResult): void {
  history.push(result);
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);

  recordLlmOutcome({
    provider: result.provider,
    model: result.model,
    source: "canary",
    ok: result.ok,
    status: result.status,
    durationMs: result.latencyMs,
    error: result.ok ? undefined : result.detail,
  });
  recordLlmTelemetry({
    provider: result.provider,
    source: "canary",
    ok: result.ok,
    status: result.status,
    durationMs: result.latencyMs,
    kind: result.ok ? undefined : classifyLlmFailure(result.status, result.detail ?? ""),
  });
}

export async function runLlmCanary(): Promise<CanaryResult[]> {
  const chain = await resolveProviderChain("chat");
  const results: CanaryResult[] = [];

  await Promise.all(
    chain.map(async (provider) => {
      const startedAt = Date.now();
      try {
        const response = await fetch(`${provider.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${provider.apiKey}`,
            ...(provider.extraHeaders ?? {}),
          },
          body: JSON.stringify({
            model: provider.model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
            temperature: 0,
          }),
          signal: AbortSignal.timeout(provider.timeoutMs ?? 10_000),
        });
        const detail = response.ok ? undefined : (await response.text().catch(() => "")).slice(0, 160);
        const result: CanaryResult = {
          provider: provider.name,
          model: provider.model,
          ok: response.ok,
          status: response.status,
          latencyMs: Date.now() - startedAt,
          at: new Date().toISOString(),
          detail,
        };
        record(result);
        results.push(result);
      } catch (error) {
        const result: CanaryResult = {
          provider: provider.name,
          model: provider.model,
          ok: false,
          status: 0,
          latencyMs: Date.now() - startedAt,
          at: new Date().toISOString(),
          detail: (error as Error).message.slice(0, 160),
        };
        record(result);
        results.push(result);
      }
    })
  );

  return results;
}

/** Start the background probe loop once per process (opt-out: LLM_CANARY_ENABLED=0). */
export function startLlmCanary(intervalMs = 5 * 60_000): void {
  if (timer) return;
  if (process.env.NODE_ENV === "test") return;
  if (process.env.LLM_CANARY_ENABLED === "0") return;

  timer = setInterval(() => {
    void runLlmCanary().catch((error) =>
      console.warn("[LLM-CANARY] probe run failed:", (error as Error).message)
    );
  }, intervalMs);
  timer.unref?.();
}

export function canarySnapshot(): {
  running: boolean;
  last: CanaryResult[];
} {
  return { running: timer !== null, last: [...history].slice(-20) };
}

/** Test-only. */
export function _stopLlmCanary(): void {
  if (timer) clearInterval(timer);
  timer = null;
  history.length = 0;
}
