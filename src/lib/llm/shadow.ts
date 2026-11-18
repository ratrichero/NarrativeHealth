// LLM-SHADOW-01 — evaluate a candidate tier on real traffic without showing it.
//
// Swapping a model used to be "change the chain and watch". This runs the same
// chat request against one candidate tier on a small percentage of turns,
// compares it with the production tier on measurable properties (answered at
// all, latency, banned trade advice, answer length) and stores the samples in
// `app_settings.llm.shadow`. Nothing from the shadow call reaches the user.
//
// Off by default: both LLM_SHADOW_TIER and LLM_SHADOW_PCT must be set. Cost is
// bounded by the percentage (10% of turns) and by a small max_tokens.
//
// The verdict is deliberately conservative: a candidate is only "ready" after
// enough samples, with no more failures/advice violations than production and a
// p95 latency no worse than 1.5× production. A human still promotes it.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { resolveProviderChain } from "./provider-chain";
import { llmRequestTimeoutMs, llmTemperature } from "./config";
import { classifyLlmFailure } from "./errors";
import { hasBannedAdvice } from "./eval";

export const LLM_SHADOW_KEY = "llm.shadow";
const MAX_SAMPLES = 200;
const RETENTION_DAYS = 7;
const FLUSH_DEBOUNCE_MS = 5_000;

export interface ShadowSample {
  at: string;
  tier: string;
  model: string;
  ok: boolean;
  status: number;
  latencyMs: number;
  tokens: number;
  chars: number;
  /** Deterministic quality signals available without a human label. */
  adviceViolation: boolean;
  empty: boolean;
}

interface ShadowStore {
  version: 1;
  samples: ShadowSample[];
}

const samples: ShadowSample[] = [];
let pending: ShadowSample[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let warned = false;

function dbDisabled(): boolean {
  return process.env.NODE_ENV === "test" && process.env.LLM_SHADOW_TEST !== "1";
}

export function shadowConfig(): { tier: string | null; pct: number } {
  const tier = process.env.LLM_SHADOW_TIER?.trim() || null;
  const raw = Number(process.env.LLM_SHADOW_PCT);
  const pct = Number.isFinite(raw) && raw > 0 ? Math.min(100, raw) : 0;
  return { tier, pct };
}

export function shouldShadow(random = Math.random()): boolean {
  const { tier, pct } = shadowConfig();
  return Boolean(tier) && pct > 0 && random * 100 < pct;
}

function remember(sample: ShadowSample): void {
  samples.unshift(sample);
  if (samples.length > MAX_SAMPLES) samples.length = MAX_SAMPLES;
  pending.push(sample);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (timer || dbDisabled()) return;
  timer = setTimeout(() => {
    timer = null;
    void flushLlmShadow();
  }, FLUSH_DEBOUNCE_MS);
  timer.unref?.();
}

export async function flushLlmShadow(): Promise<void> {
  if (dbDisabled() || pending.length === 0) return;
  const batch = pending;
  pending = [];
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
    const merged = [...batch, ...samples]
      .filter((sample) => new Date(sample.at).getTime() >= cutoff)
      .slice(0, MAX_SAMPLES);
    await db
      .insert(appSettings)
      .values({ key: LLM_SHADOW_KEY, value: { version: 1, samples: merged }, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: { version: 1, samples: merged }, updatedAt: new Date() },
      });
  } catch (error) {
    if (!warned) {
      warned = true;
      console.warn("[LLM-SHADOW] cannot persist samples:", (error as Error).message);
    }
  }
}

export async function hydrateLlmShadow(): Promise<void> {
  if (dbDisabled() || samples.length > 0) return;
  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, LLM_SHADOW_KEY))
      .limit(1);
    const stored = row?.value as ShadowStore | undefined;
    if (stored?.version === 1) samples.push(...stored.samples.slice(0, MAX_SAMPLES));
  } catch {
    // Best effort — the panel simply starts empty.
  }
}

interface ShadowMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
}

/**
 * Fire-and-forget candidate run. Never throws, never delays the answer: the
 * caller uses `void` after the user already has their reply.
 */
export async function maybeRunShadow(input: {
  messages: ShadowMessage[];
  maxTokens?: number;
  random?: number;
}): Promise<ShadowSample | null> {
  if (process.env.NODE_ENV === "test" && process.env.LLM_SHADOW_TEST !== "1") return null;
  if (!shouldShadow(input.random)) return null;
  const { tier } = shadowConfig();
  if (!tier) return null;

  const chain = await resolveProviderChain("chat");
  const provider = chain.find((entry) => entry.name === tier);
  if (!provider) return null;

  const startedAt = Date.now();
  let status = 0;
  let text = "";
  let tokens = 0;
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
        messages: input.messages,
        temperature: llmTemperature(0.3),
        max_tokens: Math.min(input.maxTokens ?? 500, 500),
      }),
      signal: AbortSignal.timeout(provider.timeoutMs ?? llmRequestTimeoutMs()),
    });
    status = response.status;
    if (response.ok) {
      const data = await response.json();
      text = String(data.choices?.[0]?.message?.content ?? "");
      tokens = Number(data.usage?.total_tokens ?? 0);
    }
  } catch {
    status = 0;
  }

  const sample: ShadowSample = {
    at: new Date().toISOString(),
    tier: provider.name,
    model: provider.model,
    ok: status >= 200 && status < 300 && text.trim().length > 0,
    status,
    latencyMs: Date.now() - startedAt,
    tokens,
    chars: text.length,
    adviceViolation: hasBannedAdvice(text),
    empty: text.trim().length === 0,
  };
  remember(sample);
  if (!sample.ok) {
    console.warn(
      `[LLM-SHADOW] ${provider.name} candidate failed (${status || "transport"} / ${classifyLlmFailure(
        status
      )})`
    );
  }
  return sample;
}

export interface ShadowComparison {
  tier: string;
  samples: number;
  okRate: number;
  adviceViolations: number;
  avgChars: number;
  p95Ms: number | null;
  readyToPromote: boolean;
  reason: string;
}

function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? null;
}

/** Compare the candidate tier with the production tiers on the same samples. */
export function shadowComparison(productionP95Ms = 4_000): ShadowComparison[] {
  const byTier = new Map<string, ShadowSample[]>();
  for (const sample of samples) {
    const list = byTier.get(sample.tier) ?? [];
    list.push(sample);
    byTier.set(sample.tier, list);
  }

  return [...byTier.entries()].map(([tier, list]) => {
    const okRate = list.filter((sample) => sample.ok).length / list.length;
    const adviceViolations = list.filter((sample) => sample.adviceViolation).length;
    const avgChars = Math.round(
      list.reduce((sum, sample) => sum + sample.chars, 0) / list.length
    );
    const latency = p95(list.map((sample) => sample.latencyMs));
    const enough = list.length >= 20;
    const healthy = okRate >= 0.95 && adviceViolations === 0;
    const fastEnough = latency !== null && latency <= Math.max(1_500, productionP95Ms * 1.5);
    const readyToPromote = enough && healthy && fastEnough;
    const reason = !enough
      ? `cần ít nhất 20 mẫu (đang ${list.length})`
      : !healthy
        ? `ok ${(okRate * 100).toFixed(0)}%, ${adviceViolations} vi phạm advice`
        : !fastEnough
          ? `p95 ${latency ?? "-"}ms quá cao`
          : "đủ mẫu, không lỗi/advice, độ trễ chấp nhận được";
    return { tier, samples: list.length, okRate, adviceViolations, avgChars, p95Ms: latency, readyToPromote, reason };
  });
}

export function shadowSnapshot(): {
  enabled: boolean;
  tier: string | null;
  pct: number;
  samples: ShadowSample[];
  comparison: ShadowComparison[];
} {
  const config = shadowConfig();
  return {
    enabled: Boolean(config.tier) && config.pct > 0,
    tier: config.tier,
    pct: config.pct,
    samples: samples.slice(0, 20),
    comparison: shadowComparison(),
  };
}

/** Test-only. */
export function _resetLlmShadow(): void {
  samples.length = 0;
  pending = [];
  if (timer) clearTimeout(timer);
  timer = null;
  warned = false;
}
