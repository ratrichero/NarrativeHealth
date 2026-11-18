// LLM-BREAKER-01 — circuit breaker that survives restarts.
//
// The google key pool keeps cooldowns in memory, and a suspended key stayed
// invisible across a redeploy: every new process retried it first, paid one 401
// and only then moved on. A tier that failed 2 real calls in 5 minutes should
// be skipped for a cooldown, and that state must live in `app_settings` so a
// restart does not reopen the same wound.
//
// Only failures that are about the provider count (auth, rate limit, capacity,
// transport, timeout). `request_invalid` / `content_policy` are about OUR
// payload or the specific model, and blocking the tier would hide the real bug.
//
// Breakers are keyed by tier + last4 of the key, so one dead key in the google
// pool does not remove the other keys of that tier.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import type { LlmFailureKind } from "./errors";

export const LLM_BREAKER_KEY = "llm.breakers";
const FAIL_WINDOW_MS = 5 * 60_000;
const FAILS_TO_OPEN = 2;
const DEFAULT_COOLDOWN_MS = 5 * 60_000;
const AUTH_COOLDOWN_MS = 30 * 60_000;
const FLUSH_DEBOUNCE_MS = 2_000;

interface BreakerEntry {
  tier: string;
  keySuffix: string;
  until: number;
  reason: string;
  fails: number;
  openedAt: number;
}

interface BreakerStore {
  version: 1;
  entries: BreakerEntry[];
}

const open = new Map<string, BreakerEntry>();
/** Recent failure timestamps per key while the breaker is still closed. */
const recentFailures = new Map<string, number[]>();
let hydrated = false;
let hydrating: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let warned = false;

function dbDisabled(): boolean {
  return process.env.NODE_ENV === "test" && process.env.LLM_OPS_TEST_DB !== "1";
}

function suffix(apiKey: string): string {
  return apiKey.length > 8 ? apiKey.slice(-4) : "?";
}

export function breakerKey(tier: string, apiKey: string): string {
  return `${tier}:${suffix(apiKey)}`;
}

function cooldownFor(kind: LlmFailureKind | "timeout", authMs: number, otherMs: number): number {
  return kind === "auth" || kind === "content_policy" ? authMs : otherMs;
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function scheduleFlush(): void {
  if (timer || dbDisabled()) return;
  timer = setTimeout(() => {
    timer = null;
    void flushLlmBreakers();
  }, FLUSH_DEBOUNCE_MS);
  timer.unref?.();
}

/** Load persisted breakers once per process (idempotent, best effort). */
export async function hydrateLlmBreakers(): Promise<void> {
  if (hydrated || dbDisabled()) {
    hydrated = true;
    return;
  }
  if (hydrating) return hydrating;
  hydrating = (async () => {
    try {
      const [row] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, LLM_BREAKER_KEY))
        .limit(1);
      const stored = row?.value as BreakerStore | undefined;
      const now = Date.now();
      for (const entry of stored?.version === 1 ? stored.entries : []) {
        if (entry.until > now) {
          open.set(`${entry.tier}:${entry.keySuffix}`, entry);
        }
      }
    } catch (error) {
      if (!warned) {
        warned = true;
        console.warn("[LLM-BREAKER] cannot read breakers:", (error as Error).message);
      }
    } finally {
      hydrated = true;
      hydrating = null;
    }
  })();
  return hydrating;
}

export function isBreakerOpen(tier: string, apiKey: string, now = Date.now()): boolean {
  const key = breakerKey(tier, apiKey);
  const entry = open.get(key);
  if (!entry) return false;
  if (entry.until <= now) {
    open.delete(key);
    scheduleFlush();
    return false;
  }
  return true;
}

/** Count a real provider failure; the breaker opens at FAILS_TO_OPEN. */
export function noteTierFailure(
  tier: string,
  apiKey: string,
  kind: LlmFailureKind | "timeout",
  at = Date.now()
): void {
  if (kind === "request_invalid" || kind === "content_policy") return;
  const key = breakerKey(tier, apiKey);
  const now = at;
  const recent = (recentFailures.get(key) ?? []).filter((t) => now - t < FAIL_WINDOW_MS);
  recent.push(now);
  recentFailures.set(key, recent);

  if (recent.length < FAILS_TO_OPEN) return;

  const cooldown = cooldownFor(
    kind,
    numberEnv("LLM_BREAKER_AUTH_COOLDOWN_MS", AUTH_COOLDOWN_MS),
    numberEnv("LLM_BREAKER_COOLDOWN_MS", DEFAULT_COOLDOWN_MS)
  );
  open.set(key, {
    tier,
    keySuffix: suffix(apiKey),
    until: now + cooldown,
    reason: kind,
    fails: recent.length,
    openedAt: now,
  });
  recentFailures.delete(key);
  console.warn(`[LLM-BREAKER] ${key} open for ${Math.round(cooldown / 1000)}s (${kind})`);
  scheduleFlush();
}

/** A success closes the breaker and clears the failure window. */
export function noteTierSuccess(tier: string, apiKey: string): void {
  const key = breakerKey(tier, apiKey);
  const hadState = open.delete(key) || recentFailures.delete(key);
  if (hadState) scheduleFlush();
}

export interface BreakerView {
  tier: string;
  keyHint: string;
  reason: string;
  fails: number;
  openedAt: string;
  until: string;
  remainingMs: number;
}

export function breakerSnapshot(now = Date.now()): BreakerView[] {
  return [...open.values()]
    .filter((entry) => entry.until > now)
    .sort((a, b) => b.openedAt - a.openedAt)
    .map((entry) => ({
      tier: entry.tier,
      keyHint: `…${entry.keySuffix}`,
      reason: entry.reason,
      fails: entry.fails,
      openedAt: new Date(entry.openedAt).toISOString(),
      until: new Date(entry.until).toISOString(),
      remainingMs: entry.until - now,
    }));
}

/** Admin action: close breakers for a tier (or every tier when omitted). */
export async function resetLlmBreakers(tier?: string): Promise<number> {
  let removed = 0;
  for (const [key, entry] of open) {
    if (!tier || entry.tier === tier) {
      open.delete(key);
      removed++;
    }
  }
  if (!tier) recentFailures.clear();
  if (removed > 0) await flushLlmBreakers();
  return removed;
}

export async function flushLlmBreakers(): Promise<void> {
  if (dbDisabled()) return;
  const entries = [...open.values()].filter((entry) => entry.until > Date.now());
  try {
    await db
      .insert(appSettings)
      .values({ key: LLM_BREAKER_KEY, value: { version: 1, entries }, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: { version: 1, entries }, updatedAt: new Date() },
      });
  } catch (error) {
    if (!warned) {
      warned = true;
      console.warn("[LLM-BREAKER] cannot persist breakers:", (error as Error).message);
    }
  }
}

/** Test-only. */
export function _resetLlmBreakers(): void {
  open.clear();
  recentFailures.clear();
  hydrated = false;
  hydrating = null;
  if (timer) clearTimeout(timer);
  timer = null;
  warned = false;
}

export const BREAKER_FAILS_TO_OPEN = FAILS_TO_OPEN;
