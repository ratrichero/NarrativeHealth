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
  /**
   * Latency histogram (LLM-TRACE-01 follow-up): counts per millisecond edge in
   * MS_EDGES plus a final overflow bucket. `msSum` alone only gives an average,
   * which hides the tail that users actually feel.
   */
  msBuckets?: number[];
  maxMs?: number;
}

/** Histogram edges in ms; bucket i counts durations <= MS_EDGES[i]. */
export const MS_EDGES = [250, 500, 1000, 2000, 5000, 10_000, 30_000] as const;

function bucketFor(ms: number): number {
  for (let i = 0; i < MS_EDGES.length; i++) {
    if (ms <= MS_EDGES[i]) return i;
  }
  return MS_EDGES.length;
}

function emptyHistogram(): number[] {
  return new Array(MS_EDGES.length + 1).fill(0);
}

function histogramOf(bucket: LlmTelemetryBucket): number[] {
  const hist = bucket.msBuckets?.slice(0, MS_EDGES.length + 1) ?? emptyHistogram();
  while (hist.length < MS_EDGES.length + 1) hist.push(0);
  return hist;
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
  const targetHist = histogramOf(target);
  const srcHist = histogramOf(src);
  for (let i = 0; i < targetHist.length; i++) targetHist[i] += srcHist[i];
  target.msBuckets = targetHist;
  target.maxMs = Math.max(target.maxMs ?? 0, src.maxMs ?? 0);
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
    else
      byId.set(id, {
        ...bucket,
        statuses: { ...bucket.statuses },
        kinds: { ...bucket.kinds },
        msBuckets: [...histogramOf(bucket)],
      });
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
    msBuckets: Object.assign(emptyHistogram(), {
      [bucketFor(input.durationMs)]: 1,
    }) as number[],
    maxMs: input.durationMs,
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

/** Approximate percentile from the histogram (upper edge of its bucket). */
export function percentileFromHistogram(hist: number[], p: number): number | null {
  const total = hist.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  const target = total * p;
  let seen = 0;
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i];
    if (seen >= target) return MS_EDGES[i] ?? MS_EDGES[MS_EDGES.length - 1] * 2;
  }
  return MS_EDGES[MS_EDGES.length - 1] * 2;
}

export interface TelemetrySeriesPoint {
  hour: string;
  provider: string;
  source: string;
  calls: number;
  ok: number;
  fail: number;
  tokens: number;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

/**
 * Hourly series for the admin charts: per provider, newest first, limited to
 * the requested window. Latency percentiles are histogram estimates.
 */
export function telemetrySeries(
  buckets: LlmTelemetryBucket[],
  options: { hours?: number; provider?: string } = {}
): TelemetrySeriesPoint[] {
  const hours = options.hours ?? 12;
  const since = Date.now() - hours * 3600_000;
  const byId = new Map<string, TelemetrySeriesPoint>();

  for (const bucket of buckets) {
    if (new Date(bucket.hour).getTime() < since) continue;
    if (options.provider && bucket.provider !== options.provider) continue;
    const id = `${bucket.hour}|${bucket.provider}`;
    const point = byId.get(id) ?? {
      hour: bucket.hour,
      provider: bucket.provider,
      source: bucket.source,
      calls: 0,
      ok: 0,
      fail: 0,
      tokens: 0,
      avgMs: null,
      p50Ms: null,
      p95Ms: null,
      maxMs: null,
    };
    point.calls += bucket.calls;
    point.ok += bucket.ok;
    point.fail += bucket.fail;
    point.tokens += bucket.tokens;
    const hist = histogramOf(bucket);
    const previous = (point as TelemetrySeriesPoint & { _hist?: number[] })._hist ?? emptyHistogram();
    for (let i = 0; i < hist.length; i++) previous[i] += hist[i];
    (point as TelemetrySeriesPoint & { _hist?: number[] })._hist = previous;
    point.maxMs = Math.max(point.maxMs ?? 0, bucket.maxMs ?? 0);
    byId.set(id, point);
  }

  return [...byId.values()]
    .map((point) => {
      const hist = (point as TelemetrySeriesPoint & { _hist?: number[] })._hist ?? [];
      const total = hist.reduce((sum, count) => sum + count, 0);
      const sumMs = buckets
        .filter((b) => b.hour === point.hour && b.provider === point.provider)
        .reduce((sum, b) => sum + b.msSum, 0);
      const clean = { ...point };
      delete (clean as TelemetrySeriesPoint & { _hist?: number[] })._hist;
      return {
        ...clean,
        avgMs: total > 0 ? Math.round(sumMs / total) : null,
        p50Ms: percentileFromHistogram(hist, 0.5),
        p95Ms: percentileFromHistogram(hist, 0.95),
      };
    })
    .sort((a, b) => b.hour.localeCompare(a.hour) || a.provider.localeCompare(b.provider));
}

/** Test-only. */
export function _resetLlmTelemetry(): void {
  pending = [];
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  inFlight = null;
  writeWarned = false;
}
