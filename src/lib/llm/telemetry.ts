// LLM-TELEMETRY-01 — persistent hourly counters in app_settings.
//
// The in-memory monitor is wiped by a restart, which is exactly how the
// production 400-storm stayed invisible until the next deploy. Each outcome is
// also folded into hour buckets and flushed to `app_settings.llm.telemetry`
// (no migration needed), so incidents survive restarts and can be alerted on.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import type { LlmFailureKind } from "./errors";

export const LLM_TELEMETRY_KEY = "llm.telemetry";
const RETENTION_HOURS = 48;
const FLUSH_DEBOUNCE_MS = 10_000;

export interface LlmTelemetryBucket {
  /** ISO hour, e.g. 2026-11-17T04:00:00.000Z */
  hour: string;
  provider: string;
  source: string;
  calls: number;
  ok: number;
  fail: number;
  msSum: number;
  tokens: number;
  statuses: Record<string, number>;
  kinds: Partial<Record<LlmFailureKind, number>>;
}

export interface LlmTelemetryStore {
  version: 1;
  buckets: LlmTelemetryBucket[];
}

let pending: LlmTelemetryBucket[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let writeWarned = false;
let inFlight: Promise<void> | null = null;

const hourOf = (at: string | Date = new Date()) =>
  new Date(at).toISOString().slice(0, 13) + ":00:00.000Z";

function mergeInto(target: LlmTelemetryBucket, src: LlmTelemetryBucket): void {
  target.calls += src.calls;
  target.ok += src.ok;
  target.fail += src.fail;
  target.msSum += src.msSum;
  target.tokens += src.tokens;
  for (const [status, count] of Object.entries(src.statuses)) {
    target.statuses[status] = (target.statuses[status] ?? 0) + count;
  }
  for (const [kind, count] of Object.entries(src.kinds)) {
    const key = kind as LlmFailureKind;
    target.kinds[key] = (target.kinds[key] ?? 0) + (count ?? 0);
  }
}

function mergeBuckets(buckets: LlmTelemetryBucket[]): LlmTelemetryBucket[] {
  const byId = new Map<string, LlmTelemetryBucket>();
  for (const bucket of buckets) {
    const id = `${bucket.hour}|${bucket.provider}|${bucket.source}`;
    const existing = byId.get(id);
    if (existing) mergeInto(existing, bucket);
    else byId.set(id, { ...bucket, statuses: { ...bucket.statuses }, kinds: { ...bucket.kinds } });
  }
  const cutoff = Date.now() - RETENTION_HOURS * 3600_000;
  return [...byId.values()]
    .filter((bucket) => new Date(bucket.hour).getTime() >= cutoff)
    .sort((a, b) => a.hour.localeCompare(b.hour) || a.provider.localeCompare(b.provider));
}

/** Fold one outcome into the pending buffer (never throws, never blocks). */
export function recordLlmTelemetry(input: {
  provider: string;
  source: string;
  ok: boolean;
  status: number;
  durationMs: number;
  tokens?: number;
  kind?: LlmFailureKind;
  at?: string;
}): void {
  pending.push({
    hour: hourOf(input.at ?? new Date()),
    provider: input.provider,
    source: input.source,
    calls: 1,
    ok: input.ok ? 1 : 0,
    fail: input.ok ? 0 : 1,
    msSum: input.durationMs,
    tokens: input.tokens ?? 0,
    statuses: { [String(input.status)]: 1 },
    kinds: input.ok || !input.kind ? {} : { [input.kind]: 1 },
  });

  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushLlmTelemetry();
  }, FLUSH_DEBOUNCE_MS);
  flushTimer.unref?.();
}

export async function flushLlmTelemetry(): Promise<void> {
  if (pending.length === 0) return;
  if (inFlight) return inFlight;
  const batch = pending;
  pending = [];

  inFlight = (async () => {
    try {
      const [row] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, LLM_TELEMETRY_KEY))
        .limit(1);
      const stored = row?.value as LlmTelemetryStore | undefined;
      const base = stored?.version === 1 ? stored.buckets : [];
      const buckets = mergeBuckets([...base, ...batch]);
      await db
        .insert(appSettings)
        .values({ key: LLM_TELEMETRY_KEY, value: { version: 1, buckets }, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: { version: 1, buckets }, updatedAt: new Date() },
        });
    } catch (error) {
      pending = [...batch, ...pending].slice(-500);
      if (!writeWarned) {
        writeWarned = true;
        console.warn("[LLM-TELEMETRY] cannot persist counters:", (error as Error).message);
      }
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Hour buckets including not-yet-flushed traffic. */
export async function llmTelemetrySnapshot(): Promise<{
  version: 1;
  buckets: LlmTelemetryBucket[];
  pending: number;
}> {
  let stored: LlmTelemetryBucket[] = [];
  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, LLM_TELEMETRY_KEY))
      .limit(1);
    const value = row?.value as LlmTelemetryStore | undefined;
    if (value?.version === 1) stored = value.buckets;
  } catch {
    stored = [];
  }
  return { version: 1, buckets: mergeBuckets([...stored, ...pending]), pending: pending.length };
}

export interface LlmStormAlert {
  provider: string;
  calls: number;
  ok: number;
  fail: number;
  windowMinutes: number;
  message: string;
}

/** “Tier fails 100% with real traffic” and “400-rate is high” alerts. */
export function detectLlmStorms(
  buckets: LlmTelemetryBucket[],
  windowMinutes = 15
): LlmStormAlert[] {
  const since = Date.now() - windowMinutes * 60_000;
  const byProvider = new Map<string, { calls: number; ok: number; fail: number; invalid: number }>();

  for (const bucket of buckets) {
    if (new Date(bucket.hour).getTime() + 3600_000 < since) continue;
    const entry = byProvider.get(bucket.provider) ?? { calls: 0, ok: 0, fail: 0, invalid: 0 };
    entry.calls += bucket.calls;
    entry.ok += bucket.ok;
    entry.fail += bucket.fail;
    entry.invalid += bucket.kinds.request_invalid ?? 0;
    byProvider.set(bucket.provider, entry);
  }

  const alerts: LlmStormAlert[] = [];
  for (const [provider, entry] of byProvider) {
    if (entry.calls >= 3 && entry.ok === 0) {
      alerts.push({
        provider,
        calls: entry.calls,
        ok: entry.ok,
        fail: entry.fail,
        windowMinutes,
        message: `${provider} failed ${entry.fail}/${entry.calls} calls in ${windowMinutes}m`,
      });
    } else if (entry.invalid >= 3) {
      alerts.push({
        provider,
        calls: entry.calls,
        ok: entry.ok,
        fail: entry.fail,
        windowMinutes,
        message: `${provider} rejected ${entry.invalid} payload(s) as invalid in ${windowMinutes}m — check request shape`,
      });
    }
  }
  return alerts;
}

/** Test-only. */
export function _resetLlmTelemetry(): void {
  pending = [];
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  inFlight = null;
  writeWarned = false;
}
