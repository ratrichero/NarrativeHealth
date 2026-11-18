// LLM-COST-01 — token spend in money, per day, with a warning threshold.
//
// budget.ts limits tokens per key per MINUTE (free-tier 429 avoidance). It says
// nothing about the daily bill, and the admin panel showed tokens only: the
// google/primary keys can be paid while the free fallbacks cost nothing, so
// "12k tokens" hides which tier actually costs money.
//
// Prices are USD per 1M tokens, from a small built-in table. Providers report
// only a total token count on the OpenAI-compatible usage object, so the
// input/output split is estimated (LLM_COST_INPUT_SHARE, default 0.7) — this is
// an estimate with a documented assumption, not an invoice.
//
// LLM_DAILY_BUDGET_USD is a WARNING threshold only: the admin panel shows the
// over-budget state, chat keeps working. Silently switching chat to short,
// tool-less answers based on a guessed price was more surprising than useful.
//
// Ledger: `app_settings.llm.cost`, kept for 31 days, debounced writes. The
// total is per instance (read-modify-write), so it is an estimate, not billing.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { llmPersistenceDisabled } from "./persistence";

export const LLM_COST_KEY = "llm.cost";
const RETENTION_DAYS = 31;
const FLUSH_DEBOUNCE_MS = 5_000;

interface Price {
  pattern: RegExp;
  input: number;
  output: number;
}

const DEFAULT_PRICES: Price[] = [
  { pattern: /flash-lite/i, input: 0.075, output: 0.3 },
  { pattern: /gemini/i, input: 0.3, output: 2.5 },
  { pattern: /deepseek.*(flash|lite)/i, input: 0.05, output: 0.2 },
  { pattern: /deepseek/i, input: 0.14, output: 0.28 },
  { pattern: /qwen|groq/i, input: 0.05, output: 0.2 },
  { pattern: /gpt|openai/i, input: 0.5, output: 1.5 },
];
const FALLBACK_PRICE = { input: 0.5, output: 1.5 };

interface CostDay {
  totalUsd: number;
  tokens: number;
  byProvider: Record<string, number>;
}

interface CostStore {
  version: 1;
  days: Record<string, CostDay>;
}

const days = new Map<string, CostDay>();
let loadedFromDb = false;
let loadInFlight: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let warned = false;

function dayKey(at = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export function priceFor(model: string): Price {
  const found = DEFAULT_PRICES.find((price) => price.pattern.test(model));
  return found ?? { pattern: /.*/, ...FALLBACK_PRICE };
}

/** USD estimate for a call. `inputTokens` optional; defaults to the configured share. */
export function estimateCostUsd(
  model: string,
  totalTokens: number,
  inputTokens?: number
): number {
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return 0;
  const shareRaw = Number(process.env.LLM_COST_INPUT_SHARE);
  const share = Number.isFinite(shareRaw) && shareRaw >= 0 && shareRaw <= 1 ? shareRaw : 0.7;
  const input = Math.max(0, Math.min(totalTokens, inputTokens ?? totalTokens * share));
  const output = Math.max(0, totalTokens - input);
  const price = priceFor(model);
  return (input / 1_000_000) * price.input + (output / 1_000_000) * price.output;
}

function emptyDay(): CostDay {
  return { totalUsd: 0, tokens: 0, byProvider: {} };
}

function accumulate(day: CostDay, provider: string, tokens: number, usd: number): void {
  day.totalUsd += usd;
  day.tokens += tokens;
  day.byProvider[provider] = (day.byProvider[provider] ?? 0) + usd;
}

/** Record one successful call. Never throws and never blocks. */
export function recordLlmCost(input: {
  provider: string;
  model: string;
  tokens: number;
  at?: Date;
}): void {
  const tokens = Math.max(0, Math.round(input.tokens ?? 0));
  if (tokens === 0) return;
  const usd = estimateCostUsd(input.model, tokens);
  const key = dayKey(input.at);
  const day = days.get(key) ?? emptyDay();
  accumulate(day, input.provider, tokens, usd);
  days.set(key, day);
  scheduleFlush();
}

export function costTodayUsd(): number {
  return days.get(dayKey())?.totalUsd ?? 0;
}

export function dailyBudgetUsd(): number {
  const value = Number(process.env.LLM_DAILY_BUDGET_USD);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** True only when a cap is configured and today's estimate reached it. */
export function overDailyBudget(now = new Date()): boolean {
  const cap = dailyBudgetUsd();
  return cap > 0 && (days.get(dayKey(now))?.totalUsd ?? 0) >= cap;
}

function scheduleFlush(): void {
  if (flushTimer || llmPersistenceDisabled()) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushLlmCost();
  }, FLUSH_DEBOUNCE_MS);
  flushTimer.unref?.();
}

/** Load the persisted ledger once per process (best effort). */
export async function hydrateLlmCost(): Promise<void> {
  if (loadedFromDb || llmPersistenceDisabled()) {
    loadedFromDb = true;
    return;
  }
  if (loadInFlight) return loadInFlight;
  loadInFlight = (async () => {
    try {
      const [row] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, LLM_COST_KEY))
        .limit(1);
      const stored = row?.value as CostStore | undefined;
      for (const [key, day] of Object.entries(stored?.version === 1 ? stored.days : {})) {
        const existing = days.get(key);
        if (!existing) {
          days.set(key, day);
          continue;
        }
        existing.totalUsd += day.totalUsd;
        existing.tokens += day.tokens;
        for (const [provider, usd] of Object.entries(day.byProvider ?? {})) {
          existing.byProvider[provider] = (existing.byProvider[provider] ?? 0) + usd;
        }
      }
    } catch (error) {
      if (!warned) {
        warned = true;
        console.warn("[LLM-COST] cannot read ledger:", (error as Error).message);
      }
    } finally {
      loadedFromDb = true;
      loadInFlight = null;
    }
  })();
  return loadInFlight;
}

export async function flushLlmCost(): Promise<void> {
  if (llmPersistenceDisabled() || days.size === 0) return;
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  const trimmed: Record<string, CostDay> = {};
  for (const [key, day] of days) {
    if (new Date(`${key}T00:00:00.000Z`).getTime() >= cutoff) trimmed[key] = day;
  }
  try {
    await db
      .insert(appSettings)
      .values({ key: LLM_COST_KEY, value: { version: 1, days: trimmed }, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: { version: 1, days: trimmed }, updatedAt: new Date() },
      });
  } catch (error) {
    if (!warned) {
      warned = true;
      console.warn("[LLM-COST] cannot persist ledger:", (error as Error).message);
    }
  }
}

export function costSnapshot(now = new Date()): {
  today: CostDay & { date: string };
  budgetUsd: number;
  overBudget: boolean;
  priceNote: string;
} {
  return {
    today: { ...(days.get(dayKey(now)) ?? emptyDay()), date: dayKey(now) },
    budgetUsd: dailyBudgetUsd(),
    overBudget: overDailyBudget(now),
    priceNote: "USD estimate: total tokens split by LLM_COST_INPUT_SHARE (default 0.7)",
  };
}

/** Test-only. */
export function _resetLlmCost(): void {
  days.clear();
  loadedFromDb = false;
  loadInFlight = null;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  warned = false;
}
